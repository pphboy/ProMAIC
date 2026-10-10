import { stageRuntimeModules } from './stage-runtime-modules.mjs';
import { cpSync, existsSync, lstatSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, '.next', 'standalone');
const target = join(root, 'build', 'desktop', 'server');
for (const path of [
  join(source, 'server.js'),
  join(root, '.next', 'required-server-files.json'),
  join(root, '.next', 'static'),
]) {
  if (!existsSync(path))
    throw new Error(`Missing production build input: ${path}. Run pnpm build first.`);
}
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
// A traced backend must never recursively embed earlier builds or operator secrets.
const allowedRoots = new Set([
  '.next',
  'package.json',
  'server.js',
  'lib',
  'packages',
  'skills',
  'configs',
  'assets',
  'LICENSE',
]);
cpSync(source, target, {
  recursive: true,
  dereference: true,
  filter: (path) => {
    const pathFromSource = relative(source, path);
    if (pathFromSource === join('.next', 'node_modules')) return false;
    if (pathFromSource && !allowedRoots.has(pathFromSource.split(sep)[0])) return false;
    if (lstatSync(path).isSymbolicLink()) {
      try {
        statSync(path);
      } catch (error) {
        if (error.code === 'ENOENT') return false;
        throw error;
      }
    }
    return true;
  },
});
stageRuntimeModules(join(source, 'node_modules'), join(target, 'node_modules'), [
  [join(source, '.next', 'node_modules'), join(target, '.next', 'node_modules')],
]);
// Windows standalone tracing can omit dynamically loaded route runtimes.
cpSync(
  join(root, 'node_modules', 'next', 'dist', 'compiled', 'next-server'),
  join(target, 'node_modules', 'next', 'dist', 'compiled', 'next-server'),
  { recursive: true },
);
cpSync(join(root, '.next', 'static'), join(target, '.next', 'static'), { recursive: true });
cpSync(
  join(root, '.next', 'required-server-files.json'),
  join(target, '.next', 'required-server-files.json'),
);
cpSync(join(root, 'public'), join(target, 'public'), { recursive: true });
for (const path of [
  'node_modules/next/package.json',
  'node_modules/next/dist/compiled/next-server/app-route-turbo.runtime.prod.js',
  'public/vendor/course-fonts/fonts.css',
  '.next/required-server-files.json',
]) {
  if (!existsSync(join(target, path))) throw new Error(`Desktop staging is incomplete: ${path}`);
}
console.log(`Desktop server staged at ${target}`);
