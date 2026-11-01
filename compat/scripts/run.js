const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const project = path.resolve(__dirname, '..', '..');
const caseName = process.argv[2] ?? 'javascript';
const fixturePath = /^[\w-]+$/.test(caseName)
  ? path.join(__dirname, '..', 'configs', `${caseName}.json`)
  : path.resolve(caseName);
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const envDir = path.join(project, 'compat', 'envs');
const runDir = path.join(project, '.tmp', 'compat', `${Date.now()}-${process.pid}`);
const workspace = path.join(runDir, 'workspace');
const userDataDir = path.join(runDir, 'user-data');
const extensionsDir = path.join(runDir, 'extensions');
const resultPath = path.join(runDir, 'result.json');

function position(value, name, lines) {
  if (!value || !Number.isInteger(value.line) || !Number.isInteger(value.character) ||
      value.line < 0 || value.line >= lines.length || value.character < 0 ||
      value.character > lines[value.line].length) {
    throw new Error(`Invalid ${name} position in ${fixturePath}`);
  }
}

if (!/^[\w-]+$/.test(fixture.language) || !/^[\w-]+$/.test(fixture.alias) ||
    !/^[\w-]+$/.test(fixture.extension) || typeof fixture.source !== 'string' ||
    fixture.source.length === 0) {
  throw new Error(`Invalid compatibility fixture: ${fixturePath}`);
}
const lines = fixture.source.split(/\r?\n/);
position(fixture.completion, 'completion', lines);
position(fixture.hover, 'hover', lines);
if (fixture.vsix !== undefined &&
    (typeof fixture.vsix !== 'string' || path.basename(fixture.vsix) !== fixture.vsix ||
      !/\.vsix$/i.test(fixture.vsix))) {
  throw new Error(`Invalid VSIX filename in ${fixturePath}`);
}
const vsixPath = fixture.vsix && path.join(envDir, 'extensions', fixture.vsix);
if (vsixPath && !fs.existsSync(vsixPath)) {
  throw new Error(`VSIX file not found: ${vsixPath}`);
}

fs.mkdirSync(path.join(workspace, '.vscode'), { recursive: true });
fs.mkdirSync(extensionsDir, { recursive: true });
fs.mkdirSync(path.join(userDataDir, 'User'), { recursive: true });
fs.copyFileSync(path.join(envDir, 'settings.json'), path.join(userDataDir, 'User', 'settings.json'));
fs.writeFileSync(path.join(workspace, '.vscode', 'settings.json'), JSON.stringify({
  'markdownEmbeddedLanguages.languages': { [fixture.alias]: { language: fixture.language } },
}, null, 2));
fs.writeFileSync(path.join(workspace, `baseline.${fixture.extension}`), fixture.source);
fs.writeFileSync(path.join(workspace, 'sample.md'),
  `# Compatibility probe\n\n\`\`\`${fixture.alias}\n${fixture.source.endsWith('\n') ? fixture.source : `${fixture.source}\n`}\`\`\`\n`);
fs.writeFileSync(path.join(runDir, 'fixture.json'), JSON.stringify(fixture, null, 2));

function vscodeExecutable() {
  if (process.env.VSCODE_CLI) return process.env.VSCODE_CLI;
  if (process.platform !== 'win32') return 'code';
  const lookup = spawnSync('where.exe', ['code.cmd'], { encoding: 'utf8' });
  const launcher = lookup.stdout?.split(/\r?\n/).find(Boolean);
  if (launcher) {
    const executable = path.resolve(path.dirname(launcher), '..', 'Code.exe');
    if (fs.existsSync(executable)) return executable;
  }
  throw new Error('Cannot find code; set VSCODE_CLI to the VS Code executable path');
}

const code = vscodeExecutable();
const args = [
  `--extensionDevelopmentPath=${project}`,
  `--extensionTestsPath=${path.join(__dirname, 'host.js')}`,
  `--user-data-dir=${userDataDir}`,
  `--extensions-dir=${extensionsDir}`,
  '--disable-chromium-sandbox', '--disable-gpu', workspace,
];

async function run() {
  if (vsixPath) {
    const install = spawnSync(code, [
      '--install-extension', vsixPath,
      `--user-data-dir=${userDataDir}`,
      `--extensions-dir=${extensionsDir}`,
    ], { cwd: project, stdio: 'inherit' });
    if (install.error) throw install.error;
    if (install.status !== 0) {
      throw new Error(`VSIX installation failed: ${vsixPath} (${install.status ?? install.signal})`);
    }
  }
  const child = spawn(code, args, {
    cwd: project,
    env: { ...process.env, COMPAT_RUN_DIR: runDir },
    stdio: 'ignore',
  });
  let launchError;
  child.on('error', error => { launchError = error; });
  child.on('exit', (exitCode, signal) => {
    if (exitCode !== 0) launchError = new Error(`VS Code exited with ${exitCode ?? signal}`);
  });
  const deadline = Date.now() + 90000;
  while (!fs.existsSync(resultPath) && !launchError && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (launchError) throw launchError;
  if (!fs.existsSync(resultPath)) throw new Error(`VS Code test timed out; inspect ${runDir}`);
  const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
  console.log(`VS Code ${result.vscodeVersion}; language: ${fixture.language}`);
  if (result.extension) console.log(`Extension ${result.extension.id}: ${result.extension.present ? 'installed' : 'missing'}`);
  if (result.baseline && result.markdown) {
    console.log(`Completion: baseline ${result.baseline.completionCount}, Markdown ${result.markdown.completionCount} (${result.summary.completion})`);
    console.log(`Hover: baseline ${result.baseline.hoverText.length}, Markdown ${result.markdown.hoverText.length} (${result.summary.hover})`);
    console.log(`Diagnostics: baseline ${result.baseline.diagnostics.length}, Markdown ${result.markdown.diagnostics.length} (${result.summary.diagnostics})`);
    console.log(`Markdown semantic tokens: ${result.markdown.semanticTokenCount}`);
  }
  console.log(`Full result: ${resultPath}`);
  if (result.error) throw new Error(result.error);
}

run().catch(error => { console.error(error); process.exitCode = 1; });
