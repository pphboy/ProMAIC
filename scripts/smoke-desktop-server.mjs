import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { BackendLifecycle } = require('../desktop/lifecycle.cjs');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const data = mkdtempSync(join(tmpdir(), 'promaic-desktop-smoke-'));
const lifecycle = new BackendLifecycle(() => {
  const child = fork(join(root, 'desktop', 'server.cjs'), [], {
    execPath: require('electron'),
    execArgv: [],
    cwd: join(root, 'build', 'desktop', 'server'),
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      NODE_ENV: 'production',
      OPENMAIC_SERVER_ROOT: join(root, 'build', 'desktop', 'server'),
      OPENMAIC_DATA_DIR: data,
      OPENMAIC_STORAGE_BACKEND: 'sqlite',
      DATABASE_URL: '',
      ASSET_S3_BUCKET: '',
      OWNER_SINGLE_USER: 'true',
      OWNER_SINGLE_USER_ID: 'local',
      NEXT_TELEMETRY_DISABLED: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  child.postMessage = (message) => child.send(message);
  return child;
});

try {
  const origin = await lifecycle.start();
  const health = await fetch(`${origin}/api/agent/runtime`);
  const status = await health.json();
  assert.equal(status.persistence, true);
  assert.equal(status.enabled, false);
  const created = await fetch(`${origin}/api/stages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: '桌面 SQLite 测试' }),
  });
  assert.equal(created.status, 201, await created.clone().text());
  const { stage } = await created.json();
  const listing = await (await fetch(`${origin}/api/stages`)).json();
  assert.equal(listing.stages[0].id, stage.id);
  const document = await (await fetch(`${origin}/api/stages/${stage.id}`)).json();
  assert.equal(document.stage.name, '桌面 SQLite 测试');
  console.log('Packaged Electron runtime + staged Next server + SQLite course API smoke passed');
  await lifecycle.stop();
  await assert.rejects(fetch(`${origin}/api/stages`));
  console.log('Local listener closed after desktop backend shutdown');
} finally {
  await lifecycle.stop();
  rmSync(data, { recursive: true, force: true });
}
