import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const executablePath = process.argv[2];
const profile = process.argv[3];
const expectedVersion = process.argv[4];
if (!executablePath || !profile) throw new Error('Usage: smoke-installed-player.mjs <executable> <profile-dir> [expected-version]');
const env = { ...process.env, OPENMAIC_DESKTOP_PROFILE_DIR: resolve(profile), NEXT_TELEMETRY_DISABLED: '1' };
delete env.ELECTRON_RUN_AS_NODE;
if (process.platform === 'win32') env.PATH = `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}`;
const child = spawn(resolve(executablePath), ['--remote-debugging-port=0', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], { env, stdio: ['ignore', 'pipe', 'pipe'] });
const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
const endpoint = new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('Desktop debugger did not become ready')), 30000);
  let output = '';
  child.stderr.on('data', chunk => {
    process.stderr.write(chunk); output += chunk.toString();
    const match = /DevTools listening on (ws:\/\/[^\s]+)/.exec(output);
    if (match) { clearTimeout(timer); resolve(match[1]); }
  });
  child.once('error', error => { clearTimeout(timer); reject(error); });
  child.once('exit', code => { clearTimeout(timer); reject(new Error(`Desktop exited before readiness: ${code}`)); });
});
child.stdout.on('data', chunk => process.stdout.write(chunk));
let browser, page, origin;
try {
  browser = await chromium.connectOverCDP(await endpoint);
  const context = browser.contexts()[0];
  page = context.pages()[0] ?? await context.waitForEvent('page', { timeout: 60000 });
  await page.getByRole('button', { name: '导入课程包' }).waitFor({ timeout: 60000 });
  origin = new URL(page.url()).origin;
  assert.equal(new URL(origin).hostname, '127.0.0.1');
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  assert.equal(await page.evaluate(() => typeof window.process), 'undefined');
  assert.ok(existsSync(join(resolve(profile), 'data', 'openmaic.sqlite')));
  const require = createRequire(import.meta.url);
  const builderRequire = createRequire(require.resolve('electron-builder'));
  const libraryRequire = createRequire(builderRequire.resolve('app-builder-lib'));
  const asar = libraryRequire('@electron/asar');
  const metadata = JSON.parse(asar.extractFile(join(dirname(resolve(executablePath)), 'resources', 'app.asar'), 'package.json').toString());
  if (expectedVersion) assert.equal(metadata.version, expectedVersion);
  const library = await (await fetch(`${origin}/api/stages`)).json();
  if (!library.stages.length) {
    await page.locator('input[type=file]').setInputFiles({ name: 'course.maic.zip', mimeType: 'application/zip', buffer: readFileSync(join(root, 'build/local-player-smoke.maic.zip')) });
    await page.waitForURL(/\/classroom\//, { timeout: 30000 });
  } else {
    assert.equal(library.stages[0].name, 'Local ZIP playback smoke');
    await page.getByRole('button', { name: 'Local ZIP playback smoke', exact: true }).click();
    await page.waitForURL(/\/classroom\//, { timeout: 30000 });
  }
  await page.getByRole('button', { name: 'Next scene', exact: true }).waitFor({ timeout: 60000 });
  await page.screenshot({ path: join(root, 'build', 'installed-player-smoke.png') });
  assert.equal((await (await fetch(`${origin}/api/stages`)).json()).stages.length, 1);
  console.log(`Native desktop window, bundled backend, Unicode profile, ZIP playback and retained data passed (${metadata.version})`);
  await page.close();
  await Promise.race([exited, new Promise((_, reject) => setTimeout(() => reject(new Error('Desktop did not stop')), 10000))]);
  await assert.rejects(fetch(`${origin}/api/stages`));
  console.log('Native application stopped its local listener on exit');
} catch (error) {
  if (existsSync(join(profile, 'desktop.log'))) console.error(readFileSync(join(profile, 'desktop.log'), 'utf8'));
  throw error;
} finally {
  await browser?.close().catch(() => {});
  if (child.exitCode === null) child.kill();
}
