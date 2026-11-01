import * as vscode from 'vscode';
import * as crypto from 'node:crypto';
import { type Fence, maskedContent, parseFences } from './fences';
import { type LanguageSettings, registerHighlighting } from './highlight';

type LanguageMap = Record<string, LanguageSettings>;

interface Entry {
  fence: Fence;
  language: string;
  uri: vscode.Uri;
  content: string;
  source: string;
}

interface SourceState {
  version: number;
  entries: Entry[];
}

const extensions: Record<string, string> = {
  javascript: 'js', javascriptreact: 'jsx', typescript: 'ts', typescriptreact: 'tsx',
  latex: 'tex', python: 'py', css: 'css', html: 'html', json: 'json',
};

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(registerHighlighting(context));
  const mirrorDir = vscode.Uri.joinPath(context.storageUri ?? context.globalStorageUri,
    `mirrors-${crypto.randomUUID()}`);
  const sources = new Map<string, SourceState>();
  const entries = new Map<string, Entry>();
  const mirrors = new Map<string, vscode.TextDocument>();
  const mirrorOwners = new Map<string, string>();
  const mirrorUpdates = new Map<string, Promise<void>>();
  const awaitingDiagnostics = new Set<string>();
  const diagnostics = vscode.languages.createDiagnosticCollection('markdownEmbeddedLanguages');

  context.subscriptions.push(diagnostics, {
    dispose: () => { void vscode.workspace.fs.delete(mirrorDir, { recursive: true }).then(undefined, () => {}); },
  });

  function sync(document: vscode.TextDocument): SourceState {
    const key = document.uri.toString();
    const previous = sources.get(key);
    if (previous?.version === document.version) return previous;

    const settings = vscode.workspace.getConfiguration('markdownEmbeddedLanguages', document.uri)
      .get<LanguageMap>('languages', {});
    const text = document.getText();
    const nextEntries = parseFences(text).flatMap((fence, index): Entry[] => {
      const language = settings[fence.alias]?.language;
      if (typeof language !== 'string' || !language.trim()) return [];
      const extension = (extensions[language] ?? language).replace(/[^a-zA-Z0-9_-]/g, '') || 'txt';
      const hash = crypto.createHash('sha256').update(key).digest('hex').slice(0, 20);
      const uri = vscode.Uri.joinPath(mirrorDir, `${hash}-block-${index}.${extension}`);
      return [{ fence, language, uri, source: key, content: maskedContent(text, fence) }];
    });

    for (const entry of previous?.entries ?? []) {
      if (!nextEntries.some(next => next.uri.toString() === entry.uri.toString())) {
        entries.delete(entry.uri.toString());
        void syncMirror(entry.uri.toString()).catch(console.error);
      }
    }
    for (const entry of nextEntries) {
      const key = entry.uri.toString();
      entries.set(key, entry);
      if (mirrors.get(key)?.getText() !== entry.content) awaitingDiagnostics.add(key);
    }
    const state = { version: document.version, entries: nextEntries };
    sources.set(key, state);
    diagnostics.delete(document.uri);
    return state;
  }

  function contains(entry: Entry, position: vscode.Position): boolean {
    return position.line >= entry.fence.startLine && position.line < entry.fence.endLine &&
      position.character >= entry.fence.contentStartColumns[position.line - entry.fence.startLine];
  }

  async function openMirror(entry: Entry): Promise<vscode.TextDocument> {
    await syncMirror(entry.uri.toString(), entry);
    return mirrors.get(entry.uri.toString())!;
  }

  async function entryAt(document: vscode.TextDocument, position: vscode.Position): Promise<Entry | undefined> {
    const entry = sync(document).entries.find(candidate => contains(candidate, position));
    if (entry) await openMirror(entry);
    return entry;
  }

  async function replaceText(document: vscode.TextDocument, content: string): Promise<void> {
    if (document.getText() === content) return;
    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), content);
    if (!await vscode.workspace.applyEdit(edit)) throw new Error(`Cannot update mirror ${document.uri}`);
  }

  function syncMirror(key: string, entry?: Entry): Promise<void> {
    const previous = mirrorUpdates.get(key) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(async () => {
      if (!entry) {
        mirrors.delete(key);
        mirrorOwners.delete(key);
        awaitingDiagnostics.delete(key);
        try { await vscode.workspace.fs.delete(vscode.Uri.parse(key)); }
        catch (error) { if (!(error instanceof vscode.FileSystemError && error.code === 'FileNotFound')) throw error; }
        return;
      }
      if (!sources.get(entry.source)?.entries.includes(entry)) return;
      let document = mirrors.get(key);
      if (!document) {
        await vscode.workspace.fs.createDirectory(mirrorDir);
        await vscode.workspace.fs.writeFile(entry.uri, Buffer.from(entry.content));
        document = await vscode.workspace.openTextDocument(entry.uri);
        mirrors.set(key, document);
      }
      if (document.languageId !== entry.language) {
        document = await vscode.languages.setTextDocumentLanguage(document, entry.language);
        mirrors.set(key, document);
      }
      mirrorOwners.set(document.uri.toString(), key);
      await replaceText(document, entry.content);
      if (document.isDirty && !await document.save()) throw new Error(`Cannot save mirror ${entry.uri}`);
      if (vscode.languages.getDiagnostics(document.uri).length) awaitingDiagnostics.delete(key);
    });
    mirrorUpdates.set(key, next);
    next.then(() => {
      if (mirrorUpdates.get(key) === next) mirrorUpdates.delete(key);
    }, () => {
      if (mirrorUpdates.get(key) === next) mirrorUpdates.delete(key);
    });
    return next;
  }

  function updateDiagnostics(document: vscode.TextDocument): void {
    const state = sources.get(document.uri.toString());
    const all = state?.entries.flatMap(entry => {
      const key = entry.uri.toString();
      const candidates = mirrors.has(key) && !awaitingDiagnostics.has(key)
        ? vscode.languages.getDiagnostics(entry.uri) : [];
      return candidates
      .filter(diagnostic => contains(entry, diagnostic.range.start) &&
        diagnostic.range.end.line < entry.fence.endLine);
    }) ?? [];
    diagnostics.set(document.uri, all);
  }

  async function refresh(document: vscode.TextDocument): Promise<void> {
    const state = sync(document);
    await Promise.allSettled(state.entries.map(entry => openMirror(entry)));
    if (sources.get(document.uri.toString()) === state) updateDiagnostics(document);
  }

  const selector: vscode.DocumentSelector = [{ language: 'markdown' }];
  context.subscriptions.push(vscode.languages.registerCompletionItemProvider(selector, {
    async provideCompletionItems(document, position, token, completionContext) {
      const entry = await entryAt(document, position);
      if (!entry || token.isCancellationRequested) return;
      const result = await vscode.commands.executeCommand<vscode.CompletionList>(
        'vscode.executeCompletionItemProvider', entry.uri, position,
        completionContext.triggerCharacter,
      );
      if (!result || token.isCancellationRequested) return;
      return new vscode.CompletionList(result.items.filter(item => {
        const edit = item.textEdit;
        if (edit && (!contains(entry, edit.range.start) || !contains(entry, edit.range.end))) return false;
        return !item.additionalTextEdits?.some(extra =>
          !contains(entry, extra.range.start) || !contains(entry, extra.range.end));
      }), result.isIncomplete);
    },
  }, '.', ':', '<', '/', '@', '#', '$', '"', "'", '{', '('));

  context.subscriptions.push(vscode.languages.registerHoverProvider(selector, {
    async provideHover(document, position, token) {
      const entry = await entryAt(document, position);
      if (!entry || token.isCancellationRequested) return;
      const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
        'vscode.executeHoverProvider', entry.uri, position,
      );
      return hovers?.find(hover => !hover.range || contains(entry, hover.range.start));
    },
  }));

  context.subscriptions.push(vscode.languages.onDidChangeDiagnostics(event => {
    for (const uri of event.uris) {
      const key = mirrorOwners.get(uri.toString());
      if (!key) continue;
      awaitingDiagnostics.delete(key);
      const entry = entries.get(key);
      if (!entry) continue;
      const source = vscode.workspace.textDocuments.find(document =>
        document.languageId === 'markdown' && document.uri.toString() === entry.source);
      if (source) updateDiagnostics(source);
    }
  }));

  context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(document => {
    if (document.languageId === 'markdown') void refresh(document);
  }));
  context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(event => {
    if (event.document.languageId === 'markdown') void refresh(event.document);
  }));
  context.subscriptions.push(vscode.workspace.onDidCloseTextDocument(document => {
    if (document.languageId !== 'markdown') return;
    const key = document.uri.toString();
    for (const entry of sources.get(key)?.entries ?? []) {
      entries.delete(entry.uri.toString());
      void syncMirror(entry.uri.toString()).catch(console.error);
    }
    sources.delete(key);
    diagnostics.delete(document.uri);
  }));
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
    if (!event.affectsConfiguration('markdownEmbeddedLanguages.languages')) return;
    for (const key of mirrors.keys()) void syncMirror(key).catch(console.error);
    sources.clear();
    entries.clear();
    for (const document of vscode.workspace.textDocuments) {
      if (document.languageId === 'markdown') void refresh(document);
    }
  }));

  for (const document of vscode.workspace.textDocuments) {
    if (document.languageId === 'markdown') void refresh(document);
  }
}

export function deactivate(): void {}
