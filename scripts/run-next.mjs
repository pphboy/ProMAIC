import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const command = process.argv[2];
if (!['dev', 'start', 'build'].includes(command)) throw new Error('Expected dev, start or build');
const args = [require.resolve('next/dist/bin/next'), command];
if (command !== 'build') args.push('--hostname', '127.0.0.1');
args.push(...process.argv.slice(3));
const child = spawn(process.execPath, args, {
  stdio: 'inherit',
  env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
});
child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
for (const signal of ['SIGTERM', 'SIGINT'])
  process.once(signal, () => {
    child.kill(signal);
  });
