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
    const fixture = JSON.parse(fs.readFileSync(path.join(runDir, 'fixture.json'), 'utf8'));
    const workspace = path.join(runDir, 'workspace');
    const extensionId = fixture.extension?.id;
    const extension = extensionId && vscode.extensions.getExtension(extensionId);
    result.extension = extensionId ? {
      id: extensionId, present: !!extension, activeBefore: extension?.isActive,
    } : undefined;
    const baseline = await vscode.workspace.openTextDocument(
      vscode.Uri.file(path.join(workspace, `baseline${path.extname(fixture.source)}`)));
    const markdown = await vscode.workspace.openTextDocument(
      vscode.Uri.file(path.join(workspace, 'sample.md')));
    if (baseline.languageId !== fixture.language) {
      throw new Error(`Baseline language is ${baseline.languageId}, expected ${fixture.language}`);
    }
    const shifted = position => ({ line: position.line + 3, character: position.character });
    result.baseline = await probe(baseline, fixture.completion, fixture.hover);
    result.markdown = await probe(markdown, shifted(fixture.completion), shifted(fixture.hover));
    result.virtualDocuments = vscode.workspace.textDocuments
      .filter(document => document.uri.scheme === 'markdown-embedded-language')
      .map(document => ({ languageId: document.languageId, diagnostics: diagnostics(document) }));
    result.untitledDocuments = vscode.workspace.textDocuments
      .filter(document => document.uri.scheme === 'untitled' && document.languageId === fixture.language)
      .map(document => ({
        languageId: document.languageId,
        isDirty: document.isDirty,
        diagnostics: diagnostics(document),
      }));
    const tokens = await vscode.commands.executeCommand('vscode.provideDocumentSemanticTokens', markdown.uri);
    result.markdown.semanticTokenCount = (tokens?.data?.length ?? 0) / 5;
    if (result.extension) result.extension.activeAfter = extension?.isActive;
    result.summary = {
      completion: result.baseline.completionCount === 0 ? 'not exercised' :
        result.markdown.completionCount > 0 ? 'forwarded' : 'missing',
      hover: result.baseline.hoverText.length === 0 ? 'not exercised' :
        result.markdown.hoverText.length > 0 ? 'forwarded' : 'missing',
      diagnostics: result.baseline.diagnostics.length === 0 ? 'not exercised' :
        result.markdown.diagnostics.length > 0 ? 'forwarded' : 'missing',
    };
  } catch (error) {
    result.error = String(error?.stack ?? error);
  }
  fs.writeFileSync(path.join(runDir, 'result.json'), JSON.stringify(result, null, 2));
  if (result.error) throw new Error(result.error);
};
