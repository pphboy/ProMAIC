import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { LocalDatabase } from '@/lib/persistence/sqlite/database.mjs';

const dirs: string[] = [];
const connections: LocalDatabase[] = [];
function open(filename?: string) {
  if (!filename) {
    const dir = mkdtempSync(join(tmpdir(), 'promaic-sqlite-'));
    dirs.push(dir);
    filename = join(dir, '测试 用户', 'openmaic.sqlite');
  }
  const db = new LocalDatabase(filename, { busyTimeoutMs: 30 });
  connections.push(db);
  return { db, filename };
}
afterEach(() => {
  for (const db of connections.splice(0)) db.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('real SQLite lifecycle', () => {
  it('persists and upgrades on disk with checksummed idempotent migrations', () => {
    const { db, filename } = open();
    const first = [
      { version: 1, sql: 'CREATE TABLE courses (id TEXT PRIMARY KEY, data TEXT NOT NULL)' },
    ];
    db.migrate('courses', first);
    db.prepare('INSERT INTO courses VALUES (?, ?)').run('one', JSON.stringify({ name: '课程' }));
    db.close();
    const reopened = open(filename).db;
    const second = [...first, { version: 2, sql: 'ALTER TABLE courses ADD COLUMN folder TEXT' }];
    reopened.migrate('courses', second);
    reopened.migrate('courses', second);
    expect(reopened.prepare('SELECT * FROM courses').get()).toMatchObject({
      id: 'one',
      data: '{"name":"课程"}',
      folder: null,
    });
    expect(() => reopened.migrate('courses', first)).toThrow('future schema');
    expect(() =>
      reopened.migrate('courses', [{ version: 1, sql: 'different' }, second[1]]),
    ).toThrow('checksum');
  });

  it('rolls back the complete failed migration batch', () => {
    const { db } = open();
    expect(() =>
      db.migrate('broken', [
        { version: 1, sql: 'CREATE TABLE partial (id TEXT)' },
        { version: 2, sql: 'not valid SQL' },
      ]),
    ).toThrow();
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE name = 'partial'").get(),
    ).toBeUndefined();
    db.migrate('broken', [{ version: 1, sql: 'CREATE TABLE partial (id TEXT)' }]);
  });

  it('rolls back failed aggregate writes and nested savepoints', () => {
    const { db } = open();
    db.exec('CREATE TABLE rows (id INTEGER PRIMARY KEY)');
    db.transaction(() => {
      db.prepare('INSERT INTO rows VALUES (?)').run(1);
      expect(() =>
        db.transaction(() => {
          db.prepare('INSERT INTO rows VALUES (?)').run(2);
          throw new Error('interrupted');
        }),
      ).toThrow('interrupted');
      db.prepare('INSERT INTO rows VALUES (?)').run(3);
    });
    expect(
      db
        .prepare('SELECT id FROM rows ORDER BY id')
        .all()
        .map((row: { id: number }) => row.id),
    ).toEqual([1, 3]);
    expect(() =>
      db.transaction(() => {
        db.prepare('INSERT INTO rows VALUES (?)').run(4);
        throw new Error('rollback');
      }),
    ).toThrow('rollback');
    expect(db.prepare('SELECT id FROM rows WHERE id = 4').get()).toBeUndefined();
    expect(() => db.transaction(async () => {})).toThrow('synchronous');
  });

  it('enforces foreign keys and bounded write contention across connections', () => {
    const { db, filename } = open();
    const other = open(filename).db;
    db.exec(
      'CREATE TABLE parent(id TEXT PRIMARY KEY); CREATE TABLE child(parent TEXT REFERENCES parent(id))',
    );
    expect(() => db.prepare('INSERT INTO child VALUES (?)').run('missing')).toThrow();
    db.transaction(() => {
      db.prepare('INSERT INTO parent VALUES (?)').run('one');
      expect(() =>
        other.transaction(() => other.prepare('INSERT INTO parent VALUES (?)').run('two')),
      ).toThrow(/locked/);
    });
    other.transaction(() => other.prepare('INSERT INTO parent VALUES (?)').run('two'));
    expect(db.prepare('SELECT count(*) AS count FROM parent').get()?.count).toBe(2);
  });
});
