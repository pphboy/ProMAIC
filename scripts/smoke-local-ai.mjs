import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { BackendLifecycle } = require('../desktop/lifecycle.cjs');
const directory = mkdtempSync(join(tmpdir(), 'promaic-ai-smoke-'));
let calls = 0,
  directorTurns = 0;
const mock = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const input = JSON.parse(Buffer.concat(chunks).toString());
  calls++;
  const director = input.tools?.some((tool) => tool.function?.name === 'call_agent');
  let delta, finish;
  if (director && directorTurns++ < 2) {
    const first = directorTurns === 1;
    delta = {
      role: 'assistant',
      tool_calls: [
        {
          index: 0,
          id: `mock-call-${calls}`,
          type: 'function',
          function: {
            name: first ? 'call_agent' : 'cue_user',
            arguments: JSON.stringify(
              first ? { agentId: 'default-1', instruction: 'Give a short answer.' } : {},
            ),
          },
        },
      ],
    };
    finish = 'tool_calls';
  } else {
    delta = {
      role: 'assistant',
      content: director ? 'Done.' : 'Local mock answer: plants use light to make food.',
    };
    finish = 'stop';
  }
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const [part, reason] of [
    [delta, null],
    [{}, finish],
  ])
    response.write(
      `data: ${JSON.stringify({ id: 'chatcmpl-local', object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'mock-model', choices: [{ index: 0, delta: part, finish_reason: reason }] })}\n\n`,
    );
  response.end('data: [DONE]\n\n');
});
await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve));
writeFileSync(
  join(directory, 'mock-model.yml'),
  `providers:\n  mock:\n    preset: openai-compatible\n    apiKey: mock-test-key\n    baseUrl: http://127.0.0.1:${mock.address().port}/v1\n    models: [mock-model]\nslots:\n  llm: mock:mock-model\n`,
);
const makeServer = () =>
  new BackendLifecycle(() => {
    const child = fork(join(root, 'desktop/server.cjs'), [], {
      execPath: require('electron'),
      execArgv: ['--require', join(root, 'scripts/block-public-network.cjs')],
      cwd: join(root, 'build/desktop/server'),
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        NODE_ENV: 'production',
        OPENMAIC_STORAGE_BACKEND: 'sqlite',
        OPENMAIC_DATA_DIR: directory,
        OPENMAIC_CONFIG: join(directory, 'mock-model.yml'),
        OPENMAIC_SERVER_ROOT: join(root, 'build/desktop/server'),
        DATABASE_URL: '',
        ASSET_S3_BUCKET: '',
        OWNER_SINGLE_USER: 'true',
        OWNER_SINGLE_USER_ID: 'local',
        NEXT_TELEMETRY_DISABLED: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    Object.assign(child, { postMessage: (message) => child.send(message) });
    return child;
  });
let backend = makeServer();
try {
  let origin = await backend.start();
  const json = async (path, value) => {
    const response = await fetch(`${origin}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(value),
    });
    assert.ok(response.ok, await response.clone().text());
    return response.json();
  };
  const { stage } = await json('/api/stages', { name: 'AI optional course' });
  assert.equal(calls, 0, 'Course operations must not call AI');
  const body = {
    messages: [
      {
        id: 'user-1',
        role: 'user',
        parts: [{ type: 'text', text: 'What do plants use light for?' }],
      },
    ],
    storeState: {
      stage: { ...stage, whiteboard: [] },
      scenes: [],
      currentSceneId: null,
      mode: 'autonomous',
      whiteboardOpen: false,
    },
    config: {
      agentIds: ['default-1'],
      agentConfigs: [
        {
          id: 'default-1',
          name: 'Teacher',
          role: 'teacher',
          persona: 'Teach clearly.',
          priority: 10,
          avatar: '',
          color: '#3366ff',
          allowedActions: [],
        },
      ],
    },
  };
  const answer = await fetch(`${origin}/api/chat/pi`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const events = await answer.text();
  assert.equal(answer.status, 200, events);
  assert.ok(events.includes('Local mock answer'), events.slice(-2000));
  assert.ok(calls > 0);
  const now = new Date().toISOString();
  await json('/api/persistence/runtime/sessions', {
    id: 'local-ai-chat',
    stageId: stage.id,
    learnerKey: 'local',
    kind: 'chat',
    status: 'active',
    createdAt: now,
    updatedAt: now,
  });
  await json('/api/persistence/runtime/sessions/local-ai-chat/records', {
    id: 'question',
    sessionId: 'local-ai-chat',
    createdAt: now,
    payload: { role: 'user', content: 'What do plants use light for?' },
  });
  await json('/api/persistence/runtime/sessions/local-ai-chat/records', {
    id: 'answer',
    sessionId: 'local-ai-chat',
    createdAt: now,
    payload: { role: 'assistant', content: 'Local mock answer: plants use light to make food.' },
  });
  await backend.stop();
  backend = makeServer();
  origin = await backend.start();
  const records = await (
    await fetch(`${origin}/api/persistence/runtime/sessions/local-ai-chat/records`)
  ).json();
  assert.equal(records.length, 2);
  assert.ok(records[1].payload.content.includes('Local mock answer'));
  await new Promise((resolve) => mock.close(resolve));
  const failed = await fetch(`${origin}/api/chat/pi`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  await failed.text();
  assert.equal((await fetch(`${origin}/api/stages/${stage.id}`)).status, 200);
  console.log('Explicit mock AI dialogue, local history restart and AI outage isolation passed');
} finally {
  await backend.stop();
  if (mock.listening) await new Promise((resolve) => mock.close(resolve));
  rmSync(directory, { recursive: true, force: true });
}
