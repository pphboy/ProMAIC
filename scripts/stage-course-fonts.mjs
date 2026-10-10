import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'assets/course-fonts.json'), 'utf8'));
const target = join(root, 'public/vendor/course-fonts');
mkdirSync(target, { recursive: true });
await Promise.all(
  manifest.map(async (font) => {
    const path = join(target, `${font.family}.woff2`);
    let bytes = existsSync(path) ? readFileSync(path) : undefined;
    if (!bytes || createHash('sha256').update(bytes).digest('hex') !== font.sha256) {
      const response = await fetch(font.url, { signal: AbortSignal.timeout(60000) });
      if (!response.ok)
        throw new Error(`Font download failed (${response.status}): ${font.family}`);
      bytes = Buffer.from(await response.arrayBuffer());
    }
    if (
      bytes.subarray(0, 4).toString() !== 'wOF2' ||
      createHash('sha256').update(bytes).digest('hex') !== font.sha256
    )
      throw new Error(`Font integrity mismatch: ${font.family}`);
    writeFileSync(path, bytes);
  }),
);
writeFileSync(
  join(target, 'fonts.css'),
  manifest
    .map(
      (font) =>
        `@font-face{font-family:'${font.family}';font-display:swap;src:url('./${font.family}.woff2') format('woff2')}`,
    )
    .join('\n'),
);
cpSync(join(root, 'packages/@openmaic/renderer/font-licenses'), join(target, 'licenses'), {
  recursive: true,
});
cpSync(join(root, 'packages/@openmaic/renderer/FONTS.md'), join(target, 'ATTRIBUTION.md'));
console.log('Six pinned course fonts and their attribution staged locally');
