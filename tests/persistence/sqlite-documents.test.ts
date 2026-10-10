import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

// Run upstream's existing contract against this backend. Share constructors
// with the application's compiled package to keep instanceof checks meaningful.
vi.mock('../../packages/@openmaic/storage/src/index.js', async () => import('@openmaic/storage'));
import {
  makeDocument,
  runDocumentStoreContract,
} from '../../packages/@openmaic/storage/test/document-contract';
import { LocalDatabase } from '@/lib/persistence/sqlite/database.mjs';
import { SqliteDocumentStore } from '@/lib/persistence/sqlite/documents';

const connections: LocalDatabase[] = [];
const dirs: string[] = [];
function open() {
  const dir = mkdtempSync(join(tmpdir(), 'promaic-documents-'));
  dirs.push(dir);
  const db = new LocalDatabase(join(dir, 'courses.sqlite'));
  connections.push(db);
  return { store: new SqliteDocumentStore(db), db };
}
afterEach(() => {
  for (const db of connections.splice(0)) db.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

runDocumentStoreContract('SQLite on disk', () => {
  const { store, db } = open();
  return {
    store,
    seedStoredVersion: async (id, version) => {
      db.prepare('UPDATE local_documents SET version=? WHERE id=?').run(version ?? null, id);
    },
  };
});

describe('SQLite folders and revisions', () => {
  it('keeps folder membership through aggregate replacement and ungrouping', async () => {
    const { store } = open();
    const doc = makeDocument();
    await store.saveDocument(doc);
    await store.createFolder('folder', '课程');
    expect(await store.setStageFolder(doc.stage.id, 'folder')).toBe(true);
    await store.saveDocument({ ...doc, stage: { ...doc.stage, name: 'Updated' } });
    expect(await store.listDocuments('folder')).toMatchObject([
      { name: 'Updated', folderId: 'folder' },
    ]);
    await store.deleteFolder('folder', 'ungroup');
    expect((await store.listDocuments())[0].folderId).toBeUndefined();
    expect(await store.loadDocument(doc.stage.id)).not.toBeNull();
  });

  it('deduplicates names and respects the folder limit', async () => {
    const { store } = open();
    await store.createFolder('first', 'Lessons', 1);
    expect((await store.createFolder('other', 'LESSONS', 1)).reused).toBe(true);
    await expect(store.createFolder('second', 'Another', 1)).rejects.toThrow('limit');
    expect(await store.setStageFolder('unknown', 'first')).toBe(false);
  });

  it('advances freshness for scene mutations and cascades scene deletion', async () => {
    const { store, db } = open();
    const doc = makeDocument();
    await store.saveDocument(doc);
    const before = await store.readFreshnessManifest(doc.stage.id);
    await store.putScene(doc.stage.id, { ...doc.scenes[0], title: 'Changed' });
    const after = await store.readFreshnessManifest(doc.stage.id);
    expect(after!.rev).toBeGreaterThan(before!.rev);
    expect(after!.scenes[0].rev).toBeGreaterThan(before!.scenes[0].rev);
    await store.deleteDocument(doc.stage.id);
    expect(db.prepare('SELECT count(*) AS count FROM local_scenes').get().count).toBe(0);
  });
});
