import { readdir, readFile, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

function loadTypeScript() {
  const override = process.env.SMARTPARK_TYPESCRIPT_PATH;
  if (override) return require(resolve(override));
  for (const base of [join(root, 'apps/web'), root]) {
    try { return require(require.resolve('typescript', { paths: [base] })); } catch { /* try next workspace */ }
  }
  throw new Error('TypeScript is not installed. Run `npm install` from the project root before checking frontend JSX/TSX syntax.');
}

async function walkFiles(directory, accept) {
  const output = [];
  const visit = async (current) => {
    let entries;
    try { entries = await readdir(current, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        if (!['node_modules', 'dist', '.venv', '__pycache__', '.git'].includes(entry.name)) await visit(full);
      } else if (entry.isFile() && accept(full)) output.push(full);
    }
  };
  await visit(directory);
  return output.sort();
}

const ts = loadTypeScript();
const webFiles = await walkFiles(join(root, 'apps/web/src'), (file) => /\.(?:js|jsx|ts|tsx)$/i.test(file));
const webErrors = [];
for (const file of webFiles) {
  const source = await readFile(file, 'utf8');
  const result = ts.transpileModule(source, {
    fileName: file,
    reportDiagnostics: true,
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      allowJs: true,
      checkJs: false,
    },
  });
  for (const diagnostic of result.diagnostics ?? []) {
    if (diagnostic.category === ts.DiagnosticCategory.Error) {
      webErrors.push(`${relative(root, file)}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`);
    }
  }
}

const serverFiles = [
  ...(await walkFiles(join(root, 'services/api'), (file) => /\.(?:js|mjs|cjs)$/i.test(file))),
  ...(await walkFiles(join(root, 'scripts'), (file) => /\.(?:js|mjs|cjs)$/i.test(file))),
];
const serverErrors = [];
for (const file of serverFiles) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8', timeout: 10000 });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || 'node --check failed').trim();
    serverErrors.push(`${relative(root, file)}: ${detail}`);
  }
}

console.log(`Frontend syntax: ${webFiles.length} JS/JSX/TS/TSX files checked with TypeScript transpilation.`);
console.log(`Server/script syntax: ${serverFiles.length} JS/MJS/CJS files checked with node --check.`);
if (webErrors.length || serverErrors.length) {
  console.error(`Syntax check failed (${webErrors.length + serverErrors.length} error(s)):`);
  for (const error of [...webErrors, ...serverErrors]) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log('All source syntax checks passed. This is a syntax check, not a type-check or production build.');
}
