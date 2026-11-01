const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const project = path.resolve(__dirname, '..', '..');
const caseName = process.argv[2] ?? 'javascript';
const configDir = /^[\w-]+$/.test(caseName)
  ? path.join(__dirname, '..', 'configs', caseName)
  : path.resolve(caseName);
const configPath = path.join(configDir, 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const envDir = path.join(project, 'compat', 'envs');
const runDir = path.join(project, '.tmp', 'compat', `${Date.now()}-${process.pid}`);
const workspace = path.join(runDir, 'workspace');
const userDataDir = path.join(runDir, 'user-data');
const extensionsDir = path.join(runDir, 'extensions');
const resultPath = path.join(runDir, 'result.json');

function validatePosition(value, name, lines) {
  if (!value || !Number.isInteger(value.line) || !Number.isInteger(value.character) ||
      value.line < 0 || value.line >= lines.length || value.character < 0 ||
      value.character > lines[value.line].length) {
    throw new Error(`Invalid ${name} position in ${configPath}`);
  }
}

function caseFile(relativePath, name) {
  if (typeof relativePath !== 'string' || !relativePath || path.isAbsolute(relativePath)) {
    throw new Error(`Invalid ${name} path in ${configPath}`);
  }
  const fullPath = path.resolve(configDir, relativePath);
  const withinCase = path.relative(configDir, fullPath);
  if (!withinCase || withinCase === '..' || withinCase.startsWith(`..${path.sep}`) ||
      path.isAbsolute(withinCase)) {
    throw new Error(`Invalid ${name} path in ${configPath}`);
  }
  return fullPath;
}

if (!/^[\w-]+$/.test(config.language) || !/^[\w-]+$/.test(config.fence) ||
    (config.extension !== undefined &&
      (!config.extension || typeof config.extension !== 'object' ||
        Array.isArray(config.extension) ||
        (config.extension.id !== undefined &&
          (typeof config.extension.id !== 'string' || !config.extension.id))))) {
  throw new Error(`Invalid compatibility config: ${configPath}`);
}
const sourcePath = caseFile(config.source, 'source');
const templatePath = caseFile(config.template, 'template');
if (!/^\.[\w-]+$/.test(path.extname(sourcePath))) {
  throw new Error(`Invalid source path in ${configPath}`);
}
const baselinePath = path.join(workspace, `baseline${path.extname(sourcePath)}`);
const sourceText = fs.readFileSync(sourcePath, 'utf8');
if (!sourceText) throw new Error(`Empty source file: ${sourcePath}`);
const sourceLines = sourceText.split(/\r?\n/);
validatePosition(config.completion, 'completion', sourceLines);
validatePosition(config.hover, 'hover', sourceLines);
const template = fs.readFileSync(templatePath, 'utf8');
const sourceMarker = '{{source}}';
const fenceMarker = '{{fence}}';
const markerIndex = template.indexOf(sourceMarker);
if (markerIndex < 0 || template.indexOf(sourceMarker, markerIndex + sourceMarker.length) !== -1 ||
    !template.includes(fenceMarker)) {
  throw new Error(`Markdown template needs one ${sourceMarker} and at least one ${fenceMarker}: ${templatePath}`);
}
const beforeSource = template.slice(0, markerIndex).replaceAll(fenceMarker, config.fence);
const afterSource = template.slice(markerIndex + sourceMarker.length).replaceAll(fenceMarker, config.fence);
const prefixLines = beforeSource.split(/\r?\n/);
const markdownSourceStart = {
  line: prefixLines.length - 1,
  character: prefixLines[prefixLines.length - 1].length,
};
const vsix = config.extension?.vsix;
if (vsix !== undefined &&
    (typeof vsix !== 'string' || path.basename(vsix) !== vsix ||
      !/\.vsix$/i.test(vsix))) {
  throw new Error(`Invalid VSIX filename in ${configPath}`);
}
const vsixPath = vsix && path.join(envDir, 'extensions', vsix);
if (vsixPath && !fs.existsSync(vsixPath)) {
  throw new Error(`VSIX file not found: ${vsixPath}`);
}

fs.mkdirSync(path.join(workspace, '.vscode'), { recursive: true });
fs.mkdirSync(extensionsDir, { recursive: true });
fs.mkdirSync(path.join(userDataDir, 'User'), { recursive: true });
fs.copyFileSync(path.join(envDir, 'settings.json'), path.join(userDataDir, 'User', 'settings.json'));
fs.writeFileSync(path.join(workspace, '.vscode', 'settings.json'), JSON.stringify({
  'markdownEmbeddedLanguages.languages': { [config.fence]: { language: config.language } },
}, null, 2));
fs.copyFileSync(sourcePath, baselinePath);
fs.writeFileSync(path.join(workspace, 'sample.md'), beforeSource + sourceText + afterSource);
fs.writeFileSync(path.join(runDir, 'config.json'), JSON.stringify({ ...config, markdownSourceStart }, null, 2));

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
  console.log(`VS Code ${result.vscodeVersion}; language: ${config.language}`);
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
