/* eslint-disable @typescript-eslint/no-require-imports -- Standalone utility entry is intentionally CommonJS. */
const { createServer } = require('node:http');
const { createRequire } = require('node:module');
const { join } = require('node:path');
const { DatabaseSync } = require('node:sqlite');

// Fail before showing the player if the bundled runtime cannot provide SQLite.
const probe = new DatabaseSync(':memory:');
probe.exec('CREATE TABLE probe (id INTEGER)');
probe.close();

// Node IPC is also supported for headless packaged-runtime smoke tests.
const parent =
  process.parentPort ??
  (process.send
    ? {
        postMessage: (message) => process.send(message),
        on: (event, callback) => process.on(event, (data) => callback({ data })),
      }
    : undefined);
if (!parent) throw new Error('The desktop server must run as an Electron utility process');
let server;
let nextApp;
let stopping = false;

async function shutdown() {
  if (stopping) return;
  stopping = true;
  if (server) {
    server.closeIdleConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  await nextApp?.close();
  process.exit(0);
}
parent.on('message', ({ data }) => {
  if (data?.type === 'shutdown') void shutdown();
});

(async () => {
  const root = process.env.OPENMAIC_SERVER_ROOT;
  if (!root) throw new Error('OPENMAIC_SERVER_ROOT is required');
  const requireServer = createRequire(join(root, 'package.json'));
  const next = requireServer('next');
  const { config } = requireServer(join(root, '.next', 'required-server-files.json'));
  process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(config);
  let handler;
  server = createServer((req, res) => {
    if (!handler) {
      res.writeHead(503);
      res.end('Starting local player');
      return;
    }
    handler(req, res).catch((error) => {
      console.error(error);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  nextApp = next({
    dev: false,
    dir: root,
    conf: config,
    hostname: '127.0.0.1',
    port: server.address().port,
  });
  await nextApp.prepare();
  if (stopping) return;
  handler = nextApp.getRequestHandler();
  parent.postMessage({ type: 'ready', port: server.address().port });
})().catch((error) => {
  parent.postMessage({ type: 'error', message: error.message });
  console.error(error);
  process.exit(1);
});
