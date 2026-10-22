import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const scriptDir = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_ROOT = resolve(scriptDir, '..');

const REQUIRED_FILES = [
  'README.md',
  'CHANGELOG.md',
  '.env.example',
  '.gitignore',
  'package.json',
  'apps/web/package.json',
  'services/api/package.json',
  'services/api/src/app.js',
  'services/api/src/scripts/migrate.js',
  'scripts/preflight-production.mjs',
  'scripts/integration-smoke.mjs',
  'docs/api-specification.md',
  'docs/integration-testing.md',
  'docs/production-deployment.md',
  'docs/deployment-security-checklist.md',
  'docs/release-checklist.md',
  'docs/phase15-final-release.md',
  'deployment/Dockerfile.api',
  'deployment/Dockerfile.web',
  'deployment/Caddyfile',
  'deployment/nginx.conf',
  'docker-compose.production.yml',
  'services/vision/requirements.txt',
];

const FORBIDDEN_ARTIFACT_PATTERNS = [
  /(^|\/)node_modules\//,
  /(^|\/)dist\//,
  /(^|\/)\.venv\//,
  /(^|\/)__pycache__\//,
  /(^|\/)uploads\/marketplace\//,
  /\.(?:pem|p12|pfx|jks)$/i,
  /(^|\/)(?:id_rsa|id_ed25519|credentials\.json)$/i,
  /\.(?:dump|sql\.gz|tar)$/i,
  /\.pt$/i,
];

const SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\brzp_live_[A-Za-z0-9]{12,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bghp_[A-Za-z0-9]{36}\b/,
  /\bsk_live_[A-Za-z0-9]{20,}\b/,
];

function check(statuses, name, result, detail) {
  statuses.push({ name, status: result, detail });
}

export function migrationSequenceIssue(names) {
  const migrations = names
    .filter((name) => /^\d{3}_[a-z0-9_-]+\.sql$/i.test(name))
    .sort();
  if (migrations.length === 0) return 'No numbered SQL migrations found.';
  for (let i = 0; i < migrations.length; i += 1) {
    const expected = String(i + 1).padStart(3, '0');
    if (migrations[i].slice(0, 3) !== expected) {
      return `Migration sequence gap: expected ${expected}, found ${migrations[i]}.`;
    }
  }
  return null;
}

export async function collectReleaseAudit(root = DEFAULT_ROOT, options = {}) {
  const statuses = [];
  const projectRoot = resolve(root);
  const nodeVersion = options.nodeVersion ?? process.versions.node;
  const [major] = nodeVersion.split('.').map(Number);
  check(statuses, 'Node.js runtime', major >= 22 ? 'PASS' : 'FAIL', `Detected Node.js ${nodeVersion}; Node.js 22 or newer is required.`);

  const requiredMissing = [];
  for (const file of REQUIRED_FILES) {
    try {
      const fileStat = await stat(join(projectRoot, file));
      if (!fileStat.isFile()) requiredMissing.push(file);
    } catch {
      requiredMissing.push(file);
    }
  }
  check(statuses, 'Required project files', requiredMissing.length ? 'FAIL' : 'PASS', requiredMissing.length ? `Missing: ${requiredMissing.join(', ')}` : `${REQUIRED_FILES.length} required files are present.`);

  let packageJson;
  try {
    packageJson = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8'));
  } catch {
    packageJson = null;
  }
  const expectedScripts = ['test:api', 'test:vision', 'test:all', 'build', 'migrate', 'test:integration', 'preflight:production', 'verify:release'];
  const scriptsMissing = expectedScripts.filter((key) => !packageJson?.scripts?.[key]);
  check(statuses, 'Release commands', scriptsMissing.length ? 'FAIL' : 'PASS', scriptsMissing.length ? `Missing package scripts: ${scriptsMissing.join(', ')}` : `Required commands are present: ${expectedScripts.join(', ')}.`);

  let migrationNames = [];
  try {
    migrationNames = await readdir(join(projectRoot, 'database', 'migrations'));
  } catch {
    // Required files check reports missing migration directory through this check.
  }
  const migrationIssue = migrationSequenceIssue(migrationNames);
  const baselineSource = await readFile(join(projectRoot, 'services/api/src/scripts/migrate.js'), 'utf8').catch(() => '');
  const latestVersion = migrationNames.filter((name) => /^\d{3}_[a-z0-9_-]+\.sql$/i.test(name)).length;
  const baselineCovered = baselineSource.includes(`version: ${latestVersion},`);
  check(statuses, 'Database migration sequence', !migrationIssue && baselineCovered ? 'PASS' : 'FAIL', migrationIssue ?? (baselineCovered ? `${latestVersion} numbered migrations are contiguous and the baseline references the latest version.` : `Migration baseline does not reference version ${latestVersion}.`));

  let ignoreText = '';
  try { ignoreText = await readFile(join(projectRoot, '.gitignore'), 'utf8'); } catch { /* required files check */ }
  const ignoreRulesMissing = ['.env', 'node_modules/', 'services/vision/*.pt', 'services/api/uploads/marketplace/']
    .filter((rule) => !ignoreText.includes(rule));
  check(statuses, 'Sensitive/runtime ignore rules', ignoreRulesMissing.length ? 'FAIL' : 'PASS', ignoreRulesMissing.length ? `Missing .gitignore entries: ${ignoreRulesMissing.join(', ')}` : 'Environment files, dependency folders, detector weights and uploaded marketplace photos are ignored.');

  const prohibitedFiles = [];
  const suspiciousFiles = [];
  const secretMatches = [];
  const excludedDirs = new Set(['.git', 'node_modules', 'dist', '.venv', '__pycache__', '.pytest_cache', 'coverage']);
  const scan = async (dir) => {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const absolute = join(dir, entry.name);
      const rel = relative(projectRoot, absolute).replaceAll('\\', '/');
      if (entry.isDirectory()) {
        if (excludedDirs.has(entry.name)) continue;
        await scan(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      if (FORBIDDEN_ARTIFACT_PATTERNS.some((pattern) => pattern.test(rel))) prohibitedFiles.push(rel);
      if (/^\.env(?:$|\.)/i.test(entry.name) && entry.name !== '.env.example') suspiciousFiles.push(rel);
      if (!/\.(?:js|mjs|cjs|jsx|ts|tsx|json|yml|yaml|md|py|sql|conf|html|css|txt)$/i.test(entry.name)) continue;
      if ((await stat(absolute)).size > 5_000_000) continue;
      const content = await readFile(absolute, 'utf8').catch(() => '');
      if (SECRET_PATTERNS.some((pattern) => pattern.test(content))) secretMatches.push(rel);
    }
  };
  await scan(projectRoot);
  check(statuses, 'Release artifact hygiene', prohibitedFiles.length || secretMatches.length ? 'FAIL' : 'PASS', [
    prohibitedFiles.length ? `Prohibited build/runtime/credential artifacts found: ${prohibitedFiles.join(', ')}.` : 'No prohibited private-key, database-dump, model-weight or source-packaging artifacts were found in scanned source paths (ignored dependency/cache directories are not scanned).',
    secretMatches.length ? `High-confidence secret pattern detected in: ${secretMatches.join(', ')}.` : 'No high-confidence private-key or live-token patterns detected in scanned text files.',
  ].join(' '));
  if (suspiciousFiles.length) {
    check(statuses, 'Environment-file review', 'WARN', `Non-example environment files exist in this working tree: ${suspiciousFiles.join(', ')}. Keep them local; do not add them to release archives or Git.`);
  }

  const lockfileExists = options.lockfileExists ?? await stat(join(projectRoot, 'package-lock.json')).then((s) => s.isFile()).catch(() => false);
  check(statuses, 'Dependency lockfile', lockfileExists ? 'PASS' : 'WARN', lockfileExists ? 'Root package-lock.json is present for reproducible installs.' : 'package-lock.json is missing. On a network-enabled development machine, run npm install, retain the generated lockfile, and verify with npm ci before deployment.');

  const hasNodeModules = await stat(join(projectRoot, 'node_modules')).then((s) => s.isDirectory()).catch(() => false);
  const viteExists = await stat(join(projectRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'vite.cmd' : 'vite')).then((s) => s.isFile()).catch(() => false);
  check(statuses, 'Frontend build availability', viteExists ? 'PASS' : 'WARN', viteExists ? 'Vite executable is installed; run npm run build as a separate gate.' : `${hasNodeModules ? 'node_modules exists but Vite executable is missing' : 'Dependencies are not installed'}; the production frontend build has not been verified in this environment.`);

  const dockerProbe = options.dockerAvailable === undefined
    ? spawnSync('docker', ['--version'], { encoding: 'utf8', timeout: 2000 })
    : null;
  const hasDocker = options.dockerAvailable ?? (dockerProbe?.status === 0);
  check(statuses, 'Container runtime availability', hasDocker ? 'PASS' : 'WARN', hasDocker ? 'Docker CLI is available; production Compose validation can be run.' : 'Docker is unavailable in this environment; image builds, startup, health checks and TLS require validation on the deployment host.');

  const hardFailures = statuses.filter((item) => item.status === 'FAIL').length;
  const warnings = statuses.filter((item) => item.status === 'WARN').length;
  return { root: projectRoot, nodeVersion, checkedAt: options.checkedAt ?? new Date().toISOString(), summary: { pass: statuses.filter((s) => s.status === 'PASS').length, warnings, failures: hardFailures }, status: hardFailures ? 'FAIL' : warnings ? 'PASS_WITH_WARNINGS' : 'PASS', checks: statuses };
}


export function formatAuditReport(report) {
  const lines = [
    'SmartPark release audit (static checks only)',
    `Result: ${report.status}`,
    `Node.js: ${report.nodeVersion}`,
    `Summary: ${report.summary.pass} pass, ${report.summary.warnings} warning(s), ${report.summary.failures} failure(s)`,
    '',
  ];
  for (const item of report.checks) lines.push(`[${item.status}] ${item.name}: ${item.detail}`);
  lines.push('', 'This audit does not certify the production build, live database, payment provider, SMTP, TLS, backups, camera accuracy or gate hardware.');
  return lines.join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const report = await collectReleaseAudit(DEFAULT_ROOT, { dockerAvailable: false });
  console.log(formatAuditReport(report));
  if (report.summary.failures > 0) process.exitCode = 1;
}
