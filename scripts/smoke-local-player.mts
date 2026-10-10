import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';
import JSZip from 'jszip';

const fixtureModule = await import('../tests/fixtures/standalone-html-classroom');
const { FIXTURE_PNG_BASE64, standaloneFixtureScenes, standaloneFixtureStage } = (
  'default' in fixtureModule ? fixtureModule.default : fixtureModule
) as typeof fixtureModule;

const require = createRequire(import.meta.url);
const { BackendLifecycle } = require('../desktop/lifecycle.cjs');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directory = mkdtempSync(join(tmpdir(), 'promaic-browser-smoke-'));
const serverPublicRequests: string[] = [];
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
        OPENMAIC_SERVER_ROOT: join(root, 'build/desktop/server'),
        DATABASE_URL: '',
        ASSET_S3_BUCKET: '',
        OWNER_SINGLE_USER: 'true',
        OWNER_SINGLE_USER_ID: 'local',
        NEXT_TELEMETRY_DISABLED: '1',
        OPENMAIC_SECRET_KEY: '',
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    child.on('message', (message: unknown) => {
      if (
        message &&
        typeof message === 'object' &&
        'type' in message &&
        message.type === 'network-blocked'
      )
        serverPublicRequests.push(JSON.stringify(message));
    });
    Object.assign(child, { postMessage: (message: unknown) => child.send(message as object) });
    return child;
  });

let server = makeServer();
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
try {
  let origin: string = await server.start();
  const context = await browser.newContext();
  const publicRequests: string[] = [];
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin || ['data:', 'blob:', 'about:'].includes(url.protocol))
      await route.continue();
    else {
      publicRequests.push(url.href);
      await route.abort();
    }
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      console.error('BROWSER:', message.text());
      if (message.text().includes('Content Security Policy')) errors.push(message.text());
    }
  });
  page.on('response', async (response) => {
    if (response.status() >= 400)
      console.error(
        'HTTP:',
        response.status(),
        response.url(),
        (await response.text()).slice(0, 1000),
      );
  });
  await page.addInitScript(() => {
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      return play.call(this).then(() => {
        if (this.tagName === 'AUDIO')
          document.documentElement.dataset.localAudioPlayed = String(this.duration);
      });
    };
  });
  await page.goto(origin);
  await page.getByRole('button', { name: '导入课程包' }).waitFor();
  const zip = new JSZip();
  const fixture = standaloneFixtureScenes('fixture', {
    archivedImageRef: 'leaf-image',
    remoteImageUrl: `data:image/png;base64,${FIXTURE_PNG_BASE64}`,
  }).filter((scene) => scene.type !== 'pbl');
  const slide = fixture.find((scene) => scene.content.type === 'slide');
  if (slide?.content.type === 'slide')
    slide.content.canvas.elements.push({
      id: 'video',
      type: 'video',
      src: 'clip-video',
      autoplay: false,
      ext: 'webm',
      left: 60,
      top: 430,
      width: 100,
      height: 80,
      rotate: 0,
    });
  const scenes = fixture.map((scene) => ({
    title: scene.title,
    order: scene.order,
    content: scene.content,
    actions:
      scene.type === 'slide'
        ? [{ id: 'speech', type: 'speech', text: 'Local narration', audioRef: 'audio/clip.wav' }]
        : scene.actions,
  }));
  const audio = Buffer.alloc(44 + 8000);
  audio.write('RIFF', 0);
  audio.writeUInt32LE(audio.length - 8, 4);
  audio.write('WAVEfmt ', 8);
  audio.writeUInt32LE(16, 16);
  audio.writeUInt16LE(1, 20);
  audio.writeUInt16LE(1, 22);
  audio.writeUInt32LE(8000, 24);
  audio.writeUInt32LE(8000, 28);
  audio.writeUInt16LE(1, 32);
  audio.writeUInt16LE(8, 34);
  audio.write('data', 36);
  audio.writeUInt32LE(8000, 40);
  audio.fill(128, 44);
  zip.file('audio/clip.wav', audio);
  zip.file(
    'media/clip.webm',
    Buffer.from(
      readFileSync(join(root, 'tests/fixtures/local-player.webm.base64'), 'utf8').trim(),
      'base64',
    ),
  );
  zip.file('media/leaf.png', Buffer.from(FIXTURE_PNG_BASE64, 'base64'));
  zip.file(
    'manifest.json',
    JSON.stringify({
      formatVersion: 1,
      appVersion: '1.2.0',
      exportedAt: new Date().toISOString(),
      stage: { ...standaloneFixtureStage('fixture'), name: 'Local ZIP playback smoke' },
      scenes,
      agents: [],
      mediaIndex: {
        'media/clip.webm': { type: 'generated', mimeType: 'video/webm', sourceRef: 'clip-video' },
        'media/leaf.png': { type: 'image', mimeType: 'image/png', sourceRef: 'leaf-image' },
        'audio/clip.wav': { type: 'audio', mimeType: 'audio/wav', format: 'wav', duration: 1 },
      },
    }),
  );
  const originalArchive = await zip.generateAsync({ type: 'nodebuffer' });
  writeFileSync(join(root, 'build/local-player-smoke.maic.zip'), originalArchive);
  await page.locator('input[type=file]').setInputFiles({
    name: 'course.maic.zip',
    mimeType: 'application/zip',
    buffer: originalArchive,
  });
  try {
    await page.waitForURL(/\/classroom\//, { timeout: 30000 });
  } catch (error) {
    console.error('IMPORT PAGE:', await page.locator('body').innerText());
    console.error('PAGE ERRORS:', errors);
    await page.screenshot({
      path: join(root, 'build', 'local-player-import-failure.png'),
      fullPage: true,
    });
    throw error;
  }
  const courseId = new URL(page.url()).pathname.split('/').pop()!;
  const doc = await (await fetch(`${origin}/api/stages/${courseId}`)).json();
  assert.equal(doc.scenes.length, 3);
  assert.ok(doc.scenes[0].actions[0].audioId.startsWith('ast_'));
  const range = await fetch(
    `${origin}/api/persistence/assets/${doc.scenes[0].actions[0].audioId}/content`,
    { headers: { range: 'bytes=44-99' } },
  );
  assert.equal(range.status, 206);
  await page.waitForTimeout(1500);
  console.log('Imported mixed-scene ZIP into the local player');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForFunction(() => Number(document.documentElement.dataset.localAudioPlayed) > 0);
  const videoDuration = await page.evaluate(async () => {
    const video = document.querySelector('video');
    if (!video) throw new Error('Packaged video element was not rendered');
    video.muted = true;
    if (video.readyState < 1)
      await new Promise<void>((resolve, reject) => {
        video.addEventListener('loadedmetadata', () => resolve(), { once: true });
        video.addEventListener('error', () => reject(new Error('Local video failed')), {
          once: true,
        });
        video.load();
      });
    await video.play();
    await new Promise<void>((resolve) => {
      video.addEventListener('seeked', () => resolve(), { once: true });
      video.currentTime = Math.min(0.5, video.duration / 2);
    });
    video.pause();
    return video.duration;
  });
  assert.ok(videoDuration > 0, 'Packaged video must decode and seek');
  await page.getByRole('button', { name: 'Next scene', exact: true }).click();
  const interactive = page.locator('iframe:visible').first().contentFrame();
  await interactive.getByRole('slider', { name: 'Light intensity' }).waitFor();
  await interactive.getByRole('slider', { name: 'Light intensity' }).press('ArrowRight');
  assert.equal(await interactive.locator('#rate').innerText(), '49');
  await page.getByRole('button', { name: 'Next scene', exact: true }).click();
  await page.getByRole('button', { name: 'Start Quiz', exact: true }).click();
  await page.getByRole('button', { name: /Chloroplasts/ }).click();
  await page.waitForTimeout(1200);
  const sessions = await (
    await fetch(`${origin}/api/persistence/runtime/stages/${courseId}/learners/local/sessions`)
  ).json();
  const quizSession = sessions.find((session: { kind: string }) => session.kind === 'quizAttempt');
  assert.ok(quizSession, 'Quiz session must be persisted in SQLite');
  assert.deepEqual(serverPublicRequests, [], 'Backend attempted a public connection');
  await page.screenshot({ path: join(root, 'build', 'local-player-smoke.png'), fullPage: true });
  await page.waitForTimeout(1000);
  assert.deepEqual(publicRequests, [], 'Local playback attempted public requests');
  assert.deepEqual(errors, [], 'Browser errors during local playback');
  await page.close();
  await server.stop();
  server = makeServer();
  origin = await server.start();
  const restored = await (await fetch(`${origin}/api/stages/${courseId}`)).json();
  assert.equal(restored.stage.name, 'Local ZIP playback smoke');
  assert.equal(restored.scenes.length, 3);
  const restoredRecords = await (
    await fetch(
      `${origin}/api/persistence/runtime/sessions/${encodeURIComponent(quizSession.id)}/records`,
    )
  ).json();
  assert.ok(
    restoredRecords.some((record: { payload: { answers?: Record<string, unknown> } }) =>
      JSON.stringify(record.payload.answers ?? {}).includes('B'),
    ),
    'Recorded quiz answer must survive service restart',
  );
  assert.deepEqual(serverPublicRequests, [], 'Backend attempted a public connection');
  console.log(
    'Real browser ZIP import, audio/video playback and seek, interactive/quiz use, recorded-answer restart and browser/backend network boundary passed',
  );
} finally {
  await browser.close();
  await server.stop();
  rmSync(directory, { recursive: true, force: true });
}
