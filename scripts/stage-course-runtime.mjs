import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'public', 'vendor', 'course-runtime');
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
const three = resolve(dirname(require.resolve('three')), '..');
for (const folder of ['build', 'examples/jsm', 'src'])
  cpSync(join(three, folder), join(target, 'three', folder), { recursive: true });
cpSync(join(three, 'LICENSE'), join(target, 'three', 'LICENSE'));
const katex = dirname(require.resolve('katex'));
cpSync(katex, join(target, 'katex'), { recursive: true });
cpSync(join(katex, '..', 'LICENSE'), join(target, 'katex', 'LICENSE'));
const tailwind = require.resolve('@tailwindcss/browser');
mkdirSync(join(target, 'tailwind'), { recursive: true });
cpSync(tailwind, join(target, 'tailwind', 'index.global.js'));
cpSync(join(dirname(tailwind), '..', 'LICENSE'), join(target, 'tailwind', 'LICENSE'));
for (const asset of JSON.parse(
  readFileSync(join(root, 'assets/course-runtime-cdn.json'), 'utf8'),
)) {
  const cache = join(root, 'build/asset-cache', `${asset.name}.js`);
  let bytes = existsSync(cache) ? readFileSync(cache) : undefined;
  if (!bytes || createHash('sha256').update(bytes).digest('hex') !== asset.sha256) {
    const response = await fetch(asset.url, { signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error(`Dependency download failed: ${asset.name}`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  if (createHash('sha256').update(bytes).digest('hex') !== asset.sha256)
    throw new Error(`Dependency integrity mismatch: ${asset.name}`);
  mkdirSync(dirname(cache), { recursive: true });
  writeFileSync(cache, bytes);
  writeFileSync(join(target, asset.target), bytes);
}
console.log('Local course runtime staged: Three.js, KaTeX, Tailwind 3/4');
