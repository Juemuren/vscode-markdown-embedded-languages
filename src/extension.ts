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
      }
    }
    for (const entry of entries) {
      virtual.set(entry.uri.toString(), entry);
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

  function updateDiagnostics(document: vscode.TextDocument): void {
    const state = sources.get(document.uri.toString());
    const all = state?.entries.flatMap(entry => vscode.languages.getDiagnostics(entry.uri)
      .filter(diagnostic => contains(entry, diagnostic.range.start) &&
        diagnostic.range.end.line < entry.fence.endLine)) ?? [];
    diagnostics.set(document.uri, all);
  }

  async function refresh(document: vscode.TextDocument): Promise<void> {
    const state = sync(document);
    await Promise.allSettled(state.entries.map(openVirtual));
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
      if (uri.scheme !== scheme) continue;
      const source = vscode.workspace.textDocuments.find(document =>
        document.languageId === 'markdown' && document.uri.toString() === uri.query);
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
    for (const entry of sources.get(key)?.entries ?? []) virtual.delete(entry.uri.toString());
    sources.delete(key);
    diagnostics.delete(document.uri);
  }));
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
    if (!event.affectsConfiguration('markdownEmbeddedLanguages.languages')) return;
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
