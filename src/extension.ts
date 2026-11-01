import * as vscode from 'vscode';
import { type Fence, maskedContent, parseFences } from './fences';
import { type LanguageSettings, registerHighlighting } from './highlight';

const scheme = 'markdown-embedded-language';
type LanguageMap = Record<string, LanguageSettings>;

interface Entry {
  fence: Fence;
  language: string;
  uri: vscode.Uri;
  content: string;
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
  const sources = new Map<string, SourceState>();
  const virtual = new Map<string, Entry>();
  const mirrors = new Map<string, vscode.TextDocument>();
  const mirrorOwners = new Map<string, string>();
  const availableMirrors: vscode.TextDocument[] = [];
  const mirrorUpdates = new Map<string, Promise<void>>();
  const awaitingDiagnostics = new Set<string>();
  const changed = new vscode.EventEmitter<vscode.Uri>();
  const diagnostics = vscode.languages.createDiagnosticCollection('markdownEmbeddedLanguages');

  context.subscriptions.push(changed, diagnostics);
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(scheme, {
    onDidChange: changed.event,
    provideTextDocumentContent: uri => virtual.get(uri.toString())?.content ?? '',
  }));

  function sync(document: vscode.TextDocument): SourceState {
    const key = document.uri.toString();
    const previous = sources.get(key);
    if (previous?.version === document.version) return previous;

    const settings = vscode.workspace.getConfiguration('markdownEmbeddedLanguages', document.uri)
      .get<LanguageMap>('languages', {});
    const text = document.getText();
    const entries = parseFences(text).flatMap((fence, index): Entry[] => {
      const language = settings[fence.alias]?.language;
      if (typeof language !== 'string' || !language.trim()) return [];
      const extension = (extensions[language] ?? language).replace(/[^a-zA-Z0-9_-]/g, '') || 'txt';
      const uri = vscode.Uri.from({
        scheme, authority: 'fence', path: `/block-${index}.${extension}`,
        query: key,
      });
      return [{ fence, language, uri, content: maskedContent(text, fence) }];
    });

    for (const entry of previous?.entries ?? []) {
      if (!entries.some(next => next.uri.toString() === entry.uri.toString())) {
        virtual.delete(entry.uri.toString());
        void syncMirror(entry.uri.toString()).catch(console.error);
      }
    }
    for (const entry of entries) {
      const key = entry.uri.toString();
      virtual.set(key, entry);
      if (mirrors.get(key)?.getText() !== entry.content) awaitingDiagnostics.add(key);
      changed.fire(entry.uri);
    }
    const state = { version: document.version, entries };
    sources.set(key, state);
    diagnostics.delete(document.uri);
    return state;
  }

  function contains(entry: Entry, position: vscode.Position): boolean {
    return position.line >= entry.fence.startLine && position.line < entry.fence.endLine &&
      position.character >= entry.fence.contentStartColumns[position.line - entry.fence.startLine];
  }

  async function openVirtual(entry: Entry): Promise<vscode.TextDocument> {
    const document = await vscode.workspace.openTextDocument(entry.uri);
    return document.languageId === entry.language
      ? document
      : vscode.languages.setTextDocumentLanguage(document, entry.language);
  }

  async function entryAt(document: vscode.TextDocument, position: vscode.Position): Promise<Entry | undefined> {
    const entry = sync(document).entries.find(candidate => contains(candidate, position));
    if (entry) await openVirtual(entry);
    return entry;
  }

  async function replaceText(document: vscode.TextDocument, content: string): Promise<void> {
    if (document.getText() === content) return;
    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), content);
    if (!await vscode.workspace.applyEdit(edit)) throw new Error(`Cannot update diagnostic document ${document.uri}`);
  }

  function syncMirror(key: string, entry?: Entry): Promise<void> {
    const previous = mirrorUpdates.get(key) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(async () => {
      if (!entry) {
        const document = mirrors.get(key);
        if (!document) return;
        mirrors.delete(key);
        mirrorOwners.delete(document.uri.toString());
        awaitingDiagnostics.delete(key);
        await replaceText(document, '');
        availableMirrors.push(await vscode.languages.setTextDocumentLanguage(document, 'plaintext'));
        return;
      }
      if (!sources.get(entry.uri.query)?.entries.includes(entry)) return;
      let document = mirrors.get(key);
      const fresh = !document;
      if (!document) {
        while (availableMirrors.length && !vscode.workspace.textDocuments.includes(availableMirrors.at(-1)!)) {
          availableMirrors.pop();
        }
        document = availableMirrors.pop() ?? await vscode.workspace.openTextDocument({
          language: entry.language, content: entry.content,
        });
        mirrors.set(key, document);
      }
      if (document.languageId !== entry.language) {
        document = await vscode.languages.setTextDocumentLanguage(document, entry.language);
        mirrors.set(key, document);
      }
      mirrorOwners.set(document.uri.toString(), key);
      await replaceText(document, entry.content);
      if (fresh && vscode.languages.getDiagnostics(document.uri).length) awaitingDiagnostics.delete(key);
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
      const virtualDiagnostics = vscode.languages.getDiagnostics(entry.uri);
      const mirror = mirrors.get(key);
      const candidates = virtualDiagnostics.length ? virtualDiagnostics :
        mirror && !awaitingDiagnostics.has(key) ? vscode.languages.getDiagnostics(mirror.uri) : [];
      return candidates
      .filter(diagnostic => contains(entry, diagnostic.range.start) &&
        diagnostic.range.end.line < entry.fence.endLine);
    }) ?? [];
    diagnostics.set(document.uri, all);
  }

  async function refresh(document: vscode.TextDocument): Promise<void> {
    const state = sync(document);
    await Promise.allSettled(state.entries.flatMap(entry => [openVirtual(entry), syncMirror(entry.uri.toString(), entry)]));
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
      const key = uri.scheme === scheme ? uri.toString() : mirrorOwners.get(uri.toString());
      if (!key) continue;
      if (uri.scheme === 'untitled') awaitingDiagnostics.delete(key);
      const entry = virtual.get(key);
      if (!entry) continue;
      const source = vscode.workspace.textDocuments.find(document =>
        document.languageId === 'markdown' && document.uri.toString() === entry.uri.query);
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
    if (document.uri.scheme === 'untitled') {
      const availableIndex = availableMirrors.indexOf(document);
      if (availableIndex >= 0) availableMirrors.splice(availableIndex, 1);
      const key = mirrorOwners.get(document.uri.toString());
      if (key) {
        mirrors.delete(key);
        mirrorOwners.delete(document.uri.toString());
        awaitingDiagnostics.add(key);
        const entry = virtual.get(key);
        const source = entry && vscode.workspace.textDocuments.find(candidate =>
          candidate.uri.toString() === entry.uri.query);
        if (source) void refresh(source);
      }
      if (key || availableIndex >= 0) return;
    }
    if (document.languageId !== 'markdown') return;
    const key = document.uri.toString();
    for (const entry of sources.get(key)?.entries ?? []) {
      virtual.delete(entry.uri.toString());
      void syncMirror(entry.uri.toString()).catch(console.error);
    }
    sources.delete(key);
    diagnostics.delete(document.uri);
  }));
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
    if (!event.affectsConfiguration('markdownEmbeddedLanguages.languages')) return;
    for (const key of mirrors.keys()) void syncMirror(key).catch(console.error);
    sources.clear();
    virtual.clear();
    for (const document of vscode.workspace.textDocuments) {
      if (document.languageId === 'markdown') void refresh(document);
    }
  }));

  for (const document of vscode.workspace.textDocuments) {
    if (document.languageId === 'markdown') void refresh(document);
  }
}

export function deactivate(): void {}
