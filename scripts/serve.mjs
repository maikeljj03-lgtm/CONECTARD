import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const angularCli = path.join(projectRoot, 'node_modules', '@angular', 'cli', 'bin', 'ng.js');
const child = spawn(process.execPath, [angularCli, 'serve', '--host=localhost', '--port=8100'], {
  cwd: projectRoot,
  stdio: 'inherit',
});

child.on('exit', (code) => process.exit(code ?? 0));
child.on('error', (error) => {
  console.error(`No se pudo iniciar Ionic: ${error.message}`);
  process.exit(1);
});
