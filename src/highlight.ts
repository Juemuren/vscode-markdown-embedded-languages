import * as vscode from 'vscode';
import * as oniguruma from 'vscode-oniguruma';
import * as textmate from 'vscode-textmate';
import { type Fence, parseFences } from './fences';

export interface HighlightSettings {
  grammar: string;
  grammars?: Record<string, string>;
}

export interface LanguageSettings {
  language?: string;
  highlight?: HighlightSettings;
}

const tokenTypes = [
  'comment', 'string', 'keyword', 'number', 'regexp', 'operator',
  'namespace', 'class', 'type', 'function', 'method', 'property',
  'variable', 'macro', 'decorator',
];
const legend = new vscode.SemanticTokensLegend(tokenTypes);
const typeIndexes = new Map(tokenTypes.map((type, index) => [type, index]));
const builtinGrammars = require('../builtin/grammars.json') as Record<string, HighlightSettings>;

let onigurumaReady: Promise<void> | undefined;
function ensureOniguruma(): Promise<void> {
  onigurumaReady ??= Promise.resolve(vscode.workspace.fs.readFile(
    vscode.Uri.file(require.resolve('vscode-oniguruma/release/onig.wasm')),
  )).then(data => oniguruma.loadWASM(data));
  return onigurumaReady;
}

function resolveGrammar(context: vscode.ExtensionContext, document: vscode.TextDocument, grammarPath: string): vscode.Uri {
  if (grammarPath.startsWith('builtin:')) {
    return vscode.Uri.joinPath(context.extensionUri, 'builtin', grammarPath.slice('builtin:'.length));
  }
  if (/^(?:[a-zA-Z]:[\\/]|[\\/]{2})/.test(grammarPath)) return vscode.Uri.file(grammarPath);
  const folder = vscode.workspace.getWorkspaceFolder(document.uri);
  const base = folder?.uri ?? vscode.Uri.joinPath(document.uri, '..');
  return vscode.Uri.joinPath(base, grammarPath.replace(/\\/g, '/'));
}

function classify(scopes: string[]): number | undefined {
  for (let index = scopes.length - 1; index >= 0; index--) {
    const scope = scopes[index];
    let type: string | undefined;
    if (scope.startsWith('comment.')) type = 'comment';
    else if (scope.startsWith('string.regexp.')) type = 'regexp';
    else if (scope.startsWith('string.')) type = 'string';
    else if (scope.startsWith('constant.numeric.')) type = 'number';
    else if (scope.startsWith('keyword.operator.')) type = 'operator';
    else if (scope.startsWith('keyword.') || scope.startsWith('storage.')) type = 'keyword';
    else if (scope.startsWith('entity.name.function.')) type = 'function';
    else if (scope.startsWith('entity.name.type.')) type = 'type';
    else if (scope.startsWith('support.function.')) type = 'function';
    else if (scope.startsWith('support.class.')) type = 'class';
    else if (scope.startsWith('support.type.')) type = 'type';
    else if (scope.startsWith('variable.')) type = 'variable';
    else if (scope.startsWith('entity.name.namespace.')) type = 'namespace';
    else if (scope.startsWith('entity.name.tag.')) type = 'class';
    if (type) return typeIndexes.get(type);
  }
  return undefined;
}

export function registerHighlighting(context: vscode.ExtensionContext): vscode.Disposable {
  const changed = new vscode.EventEmitter<void>();
  const output = vscode.window.createOutputChannel('Markdown Embedded Languages');
  const grammars = new Map<string, Promise<textmate.IGrammar | null>>();
  context.subscriptions.push(changed, output);

  async function loadGrammar(document: vscode.TextDocument, settings: HighlightSettings): Promise<textmate.IGrammar | null> {
    const rootUri = resolveGrammar(context, document, settings.grammar);
    const key = rootUri.toString() + JSON.stringify(settings.grammars ?? {});
    let pending = grammars.get(key);
    if (!pending) {
      pending = (async () => {
        await ensureOniguruma();
        const root = textmate.parseRawGrammar(
          Buffer.from(await vscode.workspace.fs.readFile(rootUri)).toString('utf8'), rootUri.path,
        );
        const registry = new textmate.Registry({
          onigLib: Promise.resolve({
            createOnigScanner: patterns => new oniguruma.OnigScanner(patterns),
            createOnigString: value => new oniguruma.OnigString(value),
          }),
          async loadGrammar(scopeName) {
            if (scopeName === root.scopeName) return root;
            const dependency = settings.grammars?.[scopeName];
            if (!dependency) {
              output.appendLine(`Missing grammar for scope ${scopeName} (referenced by ${settings.grammar})`);
              return null;
            }
            const uri = resolveGrammar(context, document, dependency);
            return textmate.parseRawGrammar(
              Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8'), uri.path,
            );
          },
        });
        return registry.loadGrammar(root.scopeName);
      })().catch(error => {
        output.appendLine(`Cannot load ${settings.grammar}: ${String(error)}`);
        return null;
      });
      grammars.set(key, pending);
    }
    return pending;
  }

  function addFenceTokens(
    document: vscode.TextDocument, fence: Fence, grammar: textmate.IGrammar,
    builder: vscode.SemanticTokensBuilder,
  ): void {
    let state = textmate.INITIAL;
    for (let line = fence.startLine; line < fence.endLine; line++) {
      const column = fence.contentStartColumns[line - fence.startLine];
      const content = document.lineAt(line).text.slice(column);
      const result = grammar.tokenizeLine(content, state);
      state = result.ruleStack;
      for (const token of result.tokens) {
        const tokenType = classify(token.scopes);
        const length = Math.min(token.endIndex, content.length) - token.startIndex;
        if (tokenType !== undefined && length > 0) {
          builder.push(line, column + token.startIndex, length, tokenType, 0);
        }
      }
    }
  }

  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
    if (event.affectsConfiguration('markdownEmbeddedLanguages.languages')) {
      grammars.clear();
      changed.fire();
    }
  }));

  return vscode.languages.registerDocumentSemanticTokensProvider(
    [{ language: 'markdown' }],
    {
      onDidChangeSemanticTokens: changed.event,
      async provideDocumentSemanticTokens(document, token) {
        const settings = vscode.workspace.getConfiguration('markdownEmbeddedLanguages', document.uri)
          .get<Record<string, LanguageSettings>>('languages', {});
        const builder = new vscode.SemanticTokensBuilder(legend);
        for (const fence of parseFences(document.getText())) {
          if (token.isCancellationRequested) break;
          const language = settings[fence.alias];
          const highlight = language?.highlight ?? (language?.language
            ? builtinGrammars[language.language]
            : undefined);
          if (!highlight?.grammar) continue;
          const grammar = await loadGrammar(document, highlight);
          if (grammar) addFenceTokens(document, fence, grammar, builder);
        }
        return builder.build();
      },
    }, legend,
  );
}
