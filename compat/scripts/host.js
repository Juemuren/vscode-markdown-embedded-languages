const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');

const runDir = process.env.COMPAT_RUN_DIR;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function diagnostics(document) {
  return vscode.languages.getDiagnostics(document.uri).map(item => ({
    line: item.range.start.line,
    message: item.message,
    source: item.source,
  }));
}

function unmatchedItems(expected, actual, key = item => item) {
  const counts = new Map();
  for (const item of actual) {
    const id = key(item);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return expected.filter(item => {
    const id = key(item);
    const count = counts.get(id) ?? 0;
    if (count === 0) return true;
    counts.set(id, count - 1);
    return false;
  });
}

function compareItems(baseline, markdown, key) {
  if (baseline.length === 0) return 'not exercised';
  if (markdown.length === 0) return 'missing';
  return unmatchedItems(baseline, markdown, key).length === 0 &&
    unmatchedItems(markdown, baseline, key).length === 0 ? 'forwarded' : 'partial';
}

function semanticTokens(tokens, legend) {
  const decoded = [];
  let line = 0;
  let character = 0;
  for (let index = 0; index < (tokens?.data?.length ?? 0); index += 5) {
    const lineDelta = tokens.data[index];
    line += lineDelta;
    character = lineDelta === 0 ? character + tokens.data[index + 1] : tokens.data[index + 1];
    decoded.push({
      line, character,
      length: tokens.data[index + 2],
      tokenType: legend?.tokenTypes?.[tokens.data[index + 3]] ?? `#${tokens.data[index + 3]}`,
      tokenModifiers: legend?.tokenModifiers?.filter((_, bit) =>
        (tokens.data[index + 4] & (1 << bit)) !== 0) ?? [`#${tokens.data[index + 4]}`],
    });
  }
  return decoded;
}

async function probe(document, completion, hover) {
  await vscode.window.showTextDocument(document);
  let items = [];
  let hovers = [];
  let problems = [];
  for (let attempt = 0; attempt < 20; attempt++) {
    const list = await vscode.commands.executeCommand('vscode.executeCompletionItemProvider',
      document.uri, new vscode.Position(completion.line, completion.character));
    items = list?.items ?? [];
    hovers = await vscode.commands.executeCommand('vscode.executeHoverProvider',
      document.uri, new vscode.Position(hover.line, hover.character)) ?? [];
    problems = diagnostics(document);
    if (items.length && hovers.length && problems.length) break;
    await pause(1000);
  }
  return {
    languageId: document.languageId,
    completionCount: items.length,
    completionLabels: items.map(item => String(item.label.label ?? item.label)),
    hoverText: hovers.flatMap(item => item.contents.map(content =>
      typeof content === 'string' ? content : content.value ?? String(content))),
    diagnostics: problems,
  };
}

exports.run = async function run() {
  const result = { vscodeVersion: vscode.version };
  try {
    if (!runDir) throw new Error('COMPAT_RUN_DIR is missing');
    const config = JSON.parse(fs.readFileSync(path.join(runDir, 'config.json'), 'utf8'));
    const workspace = path.join(runDir, 'workspace');
    const extensionId = config.extension?.id;
    const extension = extensionId && vscode.extensions.getExtension(extensionId);
    if (config.extension?.vsix && extensionId && !extension) {
      throw new Error(`Installed extension is unavailable in test host: ${extensionId}`);
    }
    result.extension = extensionId ? {
      id: extensionId, present: !!extension, activeBefore: extension?.isActive,
    } : undefined;
    const baseline = await vscode.workspace.openTextDocument(
      vscode.Uri.file(path.join(workspace, `baseline${path.extname(config.source)}`)));
    const markdown = await vscode.workspace.openTextDocument(
      vscode.Uri.file(path.join(workspace, 'sample.md')));
    if (baseline.languageId !== config.language) {
      throw new Error(`Baseline language is ${baseline.languageId}, expected ${config.language}`);
    }
    const markdownPosition = position => ({
      line: config.markdownSourceStart.line + position.line,
      character: position.character + (position.line === 0 ? config.markdownSourceStart.character : 0),
    });
    result.baseline = await probe(baseline, config.completion, config.hover);
    result.markdown = await probe(markdown,
      markdownPosition(config.completion), markdownPosition(config.hover));
    result.virtualDocuments = vscode.workspace.textDocuments
      .filter(document => document.uri.scheme === 'markdown-embedded-language')
      .map(document => ({ languageId: document.languageId, diagnostics: diagnostics(document) }));
    result.untitledDocuments = vscode.workspace.textDocuments
      .filter(document => document.uri.scheme === 'untitled' && document.languageId === config.language)
      .map(document => ({
        languageId: document.languageId,
        isDirty: document.isDirty,
        diagnostics: diagnostics(document),
      }));
    const baselineLegend = await vscode.commands.executeCommand(
      'vscode.provideDocumentSemanticTokensLegend', baseline.uri);
    const markdownLegend = await vscode.commands.executeCommand(
      'vscode.provideDocumentSemanticTokensLegend', markdown.uri);
    const baselineTokens = semanticTokens(await vscode.commands.executeCommand(
      'vscode.provideDocumentSemanticTokens', baseline.uri), baselineLegend);
    const markdownTokens = semanticTokens(await vscode.commands.executeCommand(
      'vscode.provideDocumentSemanticTokens', markdown.uri), markdownLegend);
    const { markdownSourceStart: start, markdownSourceEnd: end } = config;
    const embeddedTokens = markdownTokens.filter(token =>
      (token.line > start.line || (token.line === start.line && token.character >= start.character)) &&
      (token.line < end.line || (token.line === end.line && token.character < end.character)))
      .map(token => ({
        ...token,
        line: token.line - start.line,
        character: token.character - (token.line === start.line ? start.character : 0),
      }));
    result.baseline.semanticTokenCount = baselineTokens.length;
    result.markdown.semanticTokenCount = markdownTokens.length;
    result.markdown.embeddedSemanticTokenCount = embeddedTokens.length;
    if (result.extension) result.extension.activeAfter = extension?.isActive;
    const markdownDiagnostics = result.markdown.diagnostics.map(item => ({
      ...item, line: item.line - config.markdownSourceStart.line,
    }));
    const diagnosticKey = item => JSON.stringify([item.line, item.message, item.source]);
    result.summary = {
      completion: compareItems(result.baseline.completionLabels, result.markdown.completionLabels),
      hover: compareItems(result.baseline.hoverText, result.markdown.hoverText),
      diagnostics: compareItems(result.baseline.diagnostics, markdownDiagnostics, diagnosticKey),
    };
  } catch (error) {
    result.error = String(error?.stack ?? error);
  }
  fs.writeFileSync(path.join(runDir, 'result.json'), JSON.stringify(result, null, 2));
  if (result.error) throw new Error(result.error);
};
