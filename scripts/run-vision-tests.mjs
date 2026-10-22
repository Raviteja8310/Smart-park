import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const visionRoot = resolve(projectRoot, 'services', 'vision');
const pythonCommands = process.platform === 'win32'
  ? [{ command: 'py', args: ['-3'] }, { command: 'python', args: [] }]
  : [{ command: 'python3', args: [] }, { command: 'python', args: [] }];
let result;
let selectedCommand;

for (const candidate of pythonCommands) {
  result = spawnSync(
    candidate.command,
    [...candidate.args, '-m', 'unittest', 'discover', '-s', 'tests', '-v'],
    {
      cwd: visionRoot,
      env: { ...process.env, PYTHONPATH: visionRoot },
      stdio: 'inherit'
    }
  );
  if (!result.error) {
    selectedCommand = candidate.command;
    break;
  }
}

if (!selectedCommand) {
  console.error('Unable to find a Python interpreter for the vision tests.');
  process.exit(1);
}
process.exit(result.status ?? 1);
