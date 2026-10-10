import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
  rmSync,
  readdirSync,
  lstatSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { expect, it } from 'vitest';
import { stageRuntimeModules } from '../../scripts/stage-runtime-modules.mjs';

it('relocates pnpm siblings and conflicting dependencies of Turbopack aliases without links', () => {
  const root = mkdtempSync(join(tmpdir(), 'runtime-stage-'));
  try {
    const source = join(root, 'source/node_modules');
    function pkg(
      name: string,
      version: string,
      dependencies = {},
      code = `module.exports = '${version}'`,
    ) {
      const dir = join(source, '.pnpm', `${name}@${version}`, 'node_modules', name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify({ name, version, main: 'index.js', dependencies }),
      );
      writeFileSync(join(dir, 'index.js'), code);
      return dir;
    }
    const one = pkg('shared', '1');
    pkg('shared', '2');
    const app = pkg('app', '1', { shared: '1' }, "module.exports = require('shared')");
    symlinkSync(one, join(app, '../shared'), 'junction');
    symlinkSync(app, join(source, 'app'), 'junction');
    const original = join(root, 'workspace/node_modules/.pnpm/shared@2/node_modules/shared');
    mkdirSync(original, { recursive: true });
    writeFileSync(
      join(original, 'package.json'),
      JSON.stringify({ name: 'shared', version: '2', main: 'index.js' }),
    );
    writeFileSync(join(original, 'index.js'), "module.exports = 'untraced-workspace'");
    symlinkSync(original, join(source, 'shared'), 'junction');
    const aliases = join(root, 'source/.next/node_modules');
    mkdirSync(aliases, { recursive: true });
    symlinkSync(app, join(aliases, 'app-hashed'), 'junction');
    const output = join(root, 'relocated');
    stageRuntimeModules(source, join(output, 'node_modules'), [
      [aliases, join(output, '.next/node_modules')],
    ]);
    // Remove the entire source so fallback resolution cannot mask missing files.
    rmSync(join(root, 'source'), { recursive: true });
    rmSync(join(root, 'workspace'), { recursive: true });
    const require = createRequire(join(output, 'probe.cjs'));
    expect(require('shared')).toBe('2');
    expect(require('app')).toBe('1');
    expect(require('./.next/node_modules/app-hashed')).toBe('1');
    function inspect(path: string) {
      for (const child of readdirSync(path)) {
        const entry = join(path, child);
        expect(lstatSync(entry).isSymbolicLink()).toBe(false);
        if (lstatSync(entry).isDirectory()) inspect(entry);
      }
    }
    inspect(output);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
