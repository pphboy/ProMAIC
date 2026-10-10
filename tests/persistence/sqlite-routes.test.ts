import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('pg', () => ({
  Pool: vi.fn(() => {
    throw new Error('Local routes must not create a PostgreSQL pool');
  }),
}));
import { Pool } from 'pg';
import { GET as list, POST as create } from '@/app/api/stages/route';
import { GET as read } from '@/app/api/stages/[id]/route';
import { handlePersistenceRequest } from '@/app/api/persistence/[...path]/route';
import { handleLocalLibraryRequest } from '@/lib/persistence/sqlite/library-http';
import {
  closeLocalPersistenceProvider,
  getLocalPersistenceProvider,
} from '@/lib/persistence/sqlite/provider';
import { LocalDatabase } from '@/lib/persistence/sqlite/database.mjs';

let dir: string;
beforeEach(() => {
  closeLocalPersistenceProvider();
  dir = mkdtempSync(join(tmpdir(), 'promaic-api-'));
  vi.stubEnv('OPENMAIC_DATA_DIR', dir);
  vi.stubEnv('OPENMAIC_STORAGE_BACKEND', 'sqlite');
  vi.stubEnv('DATABASE_URL', '');
  vi.stubEnv('ASSET_S3_BUCKET', '');
});
afterEach(() => {
  closeLocalPersistenceProvider();
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe('actual local course routes', () => {
  it('returns a retryable bounded error when another connection holds the write lock', async () => {
    const provider = getLocalPersistenceProvider();
    provider.db.exec('PRAGMA busy_timeout=20');
    const competing = new LocalDatabase(join(dir, 'openmaic.sqlite'));
    try {
      competing.exec('BEGIN IMMEDIATE');
      const response = await create(
        new NextRequest('http://localhost/api/stages', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'Contended' }),
        }),
      );
      expect(response.status).toBe(503);
      expect(response.headers.get('retry-after')).toBe('1');
      expect((await response.json()).error.code).toBe('SQLITE_BUSY');
    } finally {
      competing.exec('ROLLBACK');
      competing.close();
    }
  });
  it('creates, lists, reads and moves a course without initializing PostgreSQL', async () => {
    const request = new NextRequest('http://localhost/api/stages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Local course' }),
    });
    const created = await create(request);
    expect(created.status).toBe(201);
    const { stage } = await created.json();
    const listing = await list(new NextRequest('http://localhost/api/stages'));
    expect((await listing.json()).stages[0].id).toBe(stage.id);
    const document = await read(new NextRequest(`http://localhost/api/stages/${stage.id}`), {
      params: Promise.resolve({ id: stage.id }),
    });
    expect((await document.json()).stage.name).toBe('Local course');
    const folder = await handleLocalLibraryRequest(
      new Request('http://localhost/api/folders', {
        method: 'POST',
        body: JSON.stringify({ name: 'Lessons' }),
      }),
    );
    const { folder: target } = await folder.json();
    const moved = await handleLocalLibraryRequest(
      new Request('http://localhost/api/folders/members', {
        method: 'POST',
        body: JSON.stringify({ stageId: stage.id, folderId: target.id }),
      }),
    );
    expect(moved.status).toBe(200);
    expect(Pool).not.toHaveBeenCalled();
  });

  it('stores and serves media with HTTP ranges and rejects invalid ranges', async () => {
    const form = new FormData();
    form.append('meta', new Blob(['{}'], { type: 'application/json' }), 'meta.json');
    form.append('bytes', new Blob(['0123456789'], { type: 'audio/wav' }), 'audio.wav');
    const uploaded = await handlePersistenceRequest(
      new Request('http://localhost/api/persistence/assets', { method: 'POST', body: form }),
    );
    expect(uploaded.status, await uploaded.clone().text()).toBe(201);
    const response = await uploaded.json();
    const ref = response.id;
    expect(typeof ref).toBe('string');
    const partial = await handlePersistenceRequest(
      new Request(`http://localhost/api/persistence/assets/${ref}/content`, {
        headers: { range: 'bytes=2-5' },
      }),
    );
    expect(partial.status).toBe(206);
    expect(await partial.text()).toBe('2345');
    expect(partial.headers.get('content-range')).toBe('bytes 2-5/10');
    const invalid = await handlePersistenceRequest(
      new Request(`http://localhost/api/persistence/assets/${ref}/content`, {
        headers: { range: 'bytes=99-' },
      }),
    );
    expect(invalid.status).toBe(416);
  });

  it('rejects foreign and opaque origins', async () => {
    const response = await handlePersistenceRequest(
      new Request('http://localhost/api/persistence/learner-key', { headers: { origin: 'null' } }),
    );
    expect(response.status).toBe(403);
  });
});
