import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { makeDocument } from '../../packages/@openmaic/storage/test/document-contract';
import { createLocalPersistenceProvider } from '@/lib/persistence/sqlite/provider';
import { SqliteAssetStore } from '@/lib/persistence/sqlite/assets';

const dirs: string[] = [];
const opened: ReturnType<typeof createLocalPersistenceProvider>[] = [];
function open(dir?: string) {
  dir ??= mkdtempSync(join(tmpdir(), 'promaic-local-'));
  if (!dirs.includes(dir)) dirs.push(dir);
  const provider = createLocalPersistenceProvider(
    dir,
    join(dir, 'courses.sqlite'),
    join(dir, 'assets'),
  );
  opened.push(provider);
  return { provider, dir };
}
afterEach(() => {
  for (const provider of opened.splice(0)) provider.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const principal = { key: 'local' };

describe('local provider and media', () => {
  it('reclaims files left before registry publication without touching referenced media', async () => {
    const { provider, dir } = open();
    const bounded = new SqliteAssetStore(provider.db, join(dir, 'assets'), 1);
    await expect(bounded.put(principal, new Blob(['oversized']))).rejects.toThrow('quota');
    expect(readdirSync(join(dir, 'assets'))).toHaveLength(1);
    expect(provider.db.prepare('SELECT count(*) AS count FROM local_assets').get().count).toBe(0);
    bounded.collect(Date.now() + 10000, 0);
    expect(readdirSync(join(dir, 'assets'))).toHaveLength(0);
  });
  it('allocates distinct IDs, deduplicates bytes, replaces and isolates principals', async () => {
    const { provider, dir } = open();
    const data = new Blob(['original'], { type: 'audio/wav' });
    const first = await provider.assets.put(principal, data);
    const second = await provider.assets.put(principal, data);
    expect(first).not.toBe(second);
    expect(readdirSync(join(dir, 'assets'))).toHaveLength(1);
    expect(await provider.assets.identify({ key: 'other' }, first)).toBeNull();
    expect(await provider.assets.replace(principal, first, new Blob(['new']))).toBe(2);
    expect(Buffer.from((await provider.assets.resolve(principal, second))!.bytes).toString()).toBe(
      'original',
    );
    expect(Buffer.from((await provider.assets.resolve(principal, first))!.bytes).toString()).toBe(
      'new',
    );
    expect(await provider.assets.resolve(principal, '../../outside')).toBeNull();
  });

  it('keeps referenced media and refuses a dangling asset at document publication', async () => {
    const { provider } = open();
    const id = await provider.assets.put(principal, new Blob(['audio'], { type: 'audio/wav' }));
    const doc = makeDocument();
    doc.scenes[0].actions = [{ id: 'speech-1', type: 'speech', text: 'hello', audioId: id }];
    await provider.documents.saveDocument(doc);
    await provider.assets.remove(principal, id);
    expect(await provider.assets.resolve(principal, id)).not.toBeNull();
    const second = {
      ...doc,
      stage: { ...doc.stage, id: 'second' },
      scenes: doc.scenes.map((s) => ({ ...s, stageId: 'second' })),
    };
    await provider.documents.saveDocument(second);
    await provider.documents.deleteDocument(doc.stage.id);
    provider.assets.collect(Date.now() + 10000, 0);
    expect(await provider.assets.resolve(principal, id)).not.toBeNull();
    const invalid = makeDocument('broken');
    invalid.scenes[0].actions = [
      { id: 'speech-1', type: 'speech', text: 'missing', audioId: 'ast_missing' },
    ];
    await expect(provider.documents.saveDocument(invalid)).rejects.toThrow('not stored');
    expect(await provider.documents.loadDocument('broken')).toBeNull();
  });

  it('restores courses, media and learner records from a stopped-service backup', async () => {
    const { provider, dir } = open();
    const id = await provider.assets.put(principal, new Blob(['audio']));
    const doc = makeDocument();
    doc.scenes[0].actions = [{ id: 'speech-1', type: 'speech', text: 'hello', audioId: id }];
    await provider.documents.saveDocument(doc);
    const time = new Date().toISOString();
    await provider.runtime.createSession({
      id: 'quiz',
      kind: 'custom',
      stageId: doc.stage.id,
      learnerKey: 'local',
      status: 'active',
      createdAt: time,
      updatedAt: time,
    });
    await provider.runtime.appendRecord({
      id: 'answer',
      sessionId: 'quiz',
      createdAt: time,
      payload: { answer: 'A' },
    });
    provider.close();
    const restoredDir = mkdtempSync(join(tmpdir(), 'promaic-restore-'));
    cpSync(dir, restoredDir, { recursive: true });
    const restored = open(restoredDir).provider;
    expect((await restored.documents.loadDocument(doc.stage.id))!.stage.name).toBe(doc.stage.name);
    expect(Buffer.from((await restored.assets.resolve(principal, id))!.bytes).toString()).toBe(
      'audio',
    );
    expect((await restored.runtime.listRecords('quiz'))[0].payload).toEqual({ answer: 'A' });
  });
});
