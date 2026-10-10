import { createHash, randomUUID } from 'node:crypto';
import {
  linkSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import type { AssetMeta, AssetRef, BinaryBlob } from '@openmaic/dsl';
import {
  AssetNotFoundError,
  AssetQuotaExceededError,
  assertJsonValue,
  newAssetId,
} from '@openmaic/storage';
import type { AssetId, AssetPrincipal, AssetStore } from '@openmaic/storage';

import { LocalDatabase } from './database.mjs';

const MIGRATIONS = [
  {
    version: 1,
    sql: `
CREATE TABLE local_assets(id TEXT PRIMARY KEY, principal TEXT NOT NULL, hash TEXT NOT NULL,
mime TEXT NOT NULL, bytes INTEGER NOT NULL, revision INTEGER NOT NULL, meta TEXT, touched_at INTEGER NOT NULL);
CREATE INDEX local_assets_hash ON local_assets(hash);
CREATE TABLE local_asset_refs(stage_id TEXT NOT NULL REFERENCES local_documents(id) ON DELETE CASCADE,
asset_id TEXT NOT NULL REFERENCES local_assets(id) ON DELETE RESTRICT, PRIMARY KEY(stage_id,asset_id));
`,
  },
];
interface AssetRow {
  id: string;
  principal: string;
  hash: string;
  mime: string;
  bytes: number;
  revision: number;
}

/** Files are published before registry updates; only the collector deletes bytes. */
export class SqliteAssetStore implements AssetStore {
  constructor(
    readonly db: LocalDatabase,
    readonly directory: string,
    readonly quotaBytes?: number,
  ) {
    mkdirSync(directory, { recursive: true });
    db.migrate('assets', MIGRATIONS);
  }
  private row(principal: AssetPrincipal, ref: AssetRef): AssetRow | undefined {
    return this.db
      .prepare('SELECT * FROM local_assets WHERE principal=? AND id=?')
      .get(principal.key, ref);
  }
  private file(hash: string) {
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Invalid local media identity');
    return join(this.directory, hash);
  }
  private publish(bytes: Uint8Array) {
    const hash = createHash('sha256').update(bytes).digest('hex');
    const temp = join(this.directory, `.tmp-${randomUUID()}`);
    writeFileSync(temp, bytes, { flag: 'wx', flush: true });
    try {
      try {
        linkSync(temp, this.file(hash));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
    } finally {
      unlinkSync(temp);
    }
    return hash;
  }
  private quota(principal: AssetPrincipal, size: number, replaceBytes = 0) {
    if (!principal.key) throw new Error('An asset principal is required');
    const used: number = this.db
      .prepare('SELECT coalesce(sum(bytes),0) AS total FROM local_assets WHERE principal=?')
      .get(principal.key).total;
    if (this.quotaBytes !== undefined && used - replaceBytes + size > this.quotaBytes)
      throw new AssetQuotaExceededError();
  }
  async put(principal: AssetPrincipal, data: BinaryBlob, meta?: AssetMeta): Promise<AssetId> {
    if (meta !== undefined) assertJsonValue(meta, 'asset metadata');
    const bytes = new Uint8Array(await data.arrayBuffer());
    const hash = this.publish(bytes);
    const id = newAssetId();
    this.db.transaction(() => {
      this.quota(principal, bytes.byteLength);
      this.db
        .prepare('INSERT INTO local_assets VALUES (?,?,?,?,?,?,?,?)')
        .run(
          id,
          principal.key,
          hash,
          meta?.contentType ?? data.type,
          bytes.byteLength,
          1,
          meta === undefined ? null : JSON.stringify(meta),
          Date.now(),
        );
    });
    return id;
  }
  async identify(principal: AssetPrincipal, ref: AssetRef) {
    const row = this.row(principal, ref);
    return row ? { mime: row.mime, revision: row.revision, byteLength: row.bytes } : null;
  }
  async resolve(principal: AssetPrincipal, ref: AssetRef) {
    return this.db.transaction(() => {
      const row = this.row(principal, ref);
      return row
        ? { bytes: readFileSync(this.file(row.hash)), mime: row.mime, revision: row.revision }
        : null;
    });
  }
  async replace(principal: AssetPrincipal, ref: AssetRef, data: BinaryBlob, meta?: AssetMeta) {
    if (meta !== undefined) assertJsonValue(meta, 'asset metadata');
    if (!this.row(principal, ref)) throw new AssetNotFoundError();
    const bytes = new Uint8Array(await data.arrayBuffer());
    const hash = this.publish(bytes);
    return this.db.transaction(() => {
      const row = this.row(principal, ref);
      if (!row) throw new AssetNotFoundError();
      this.quota(principal, bytes.byteLength, row.bytes);
      this.db
        .prepare(
          'UPDATE local_assets SET hash=?,mime=?,bytes=?,revision=revision+1,meta=coalesce(?,meta),touched_at=? WHERE id=? AND principal=?',
        )
        .run(
          hash,
          meta === undefined ? data.type || row.mime : (meta.contentType ?? data.type),
          bytes.byteLength,
          meta === undefined ? null : JSON.stringify(meta),
          Date.now(),
          ref,
          principal.key,
        );
      return row.revision + 1;
    });
  }
  async remove(principal: AssetPrincipal, ref: AssetRef) {
    this.db.transaction(() => {
      if (this.db.prepare('SELECT 1 FROM local_asset_refs WHERE asset_id=?').get(ref)) return;
      this.db
        .prepare('DELETE FROM local_assets WHERE id=? AND principal=?')
        .run(ref, principal.key);
    });
  }
  trackReferences(stageId: string, refs: Iterable<string>) {
    this.db.prepare('DELETE FROM local_asset_refs WHERE stage_id=?').run(stageId);
    for (const ref of new Set(refs)) {
      if (!ref.startsWith('ast_')) continue;
      const row: AssetRow | undefined = this.db
        .prepare('SELECT * FROM local_assets WHERE id=?')
        .get(ref);
      if (!row) throw new AssetNotFoundError('Course references media that is not stored locally');
      statSync(this.file(row.hash));
      this.db.prepare('INSERT INTO local_asset_refs VALUES (?,?)').run(stageId, ref);
    }
  }
  collect(now = Date.now(), graceMs = 24 * 60 * 60 * 1000) {
    if (!Number.isFinite(graceMs) || graceMs < 0) throw new Error('Invalid media collection grace');
    this.db.transaction(() => {
      this.db
        .prepare(
          'DELETE FROM local_assets WHERE touched_at<? AND NOT EXISTS (SELECT 1 FROM local_asset_refs r WHERE r.asset_id=local_assets.id)',
        )
        .run(now - graceMs);
      for (const filename of readdirSync(this.directory)) {
        if (!/^[a-f0-9]{64}$/.test(filename) && !/^\.tmp-[a-f0-9-]+$/.test(filename)) continue;
        const path = join(this.directory, filename);
        if (statSync(path).mtimeMs >= now - graceMs) continue;
        if (this.db.prepare('SELECT 1 FROM local_assets WHERE hash=?').get(filename)) continue;
        unlinkSync(path);
      }
    });
  }
}
