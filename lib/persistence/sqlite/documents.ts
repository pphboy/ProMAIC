import {
  DSL_VERSION,
  dslVersionOf,
  migrate,
  needsMigration,
  validateScene,
  validateStage,
} from '@openmaic/dsl';
import type { Scene, Stage } from '@openmaic/dsl';
import {
  DocumentFolderLimitError,
  DocumentNotFoundError,
  DocumentVersionError,
} from '@openmaic/storage';
import type {
  DocumentFolder,
  DocumentFolderStore,
  DocumentStore,
  DocumentSummary,
  MaicDocument,
  SceneLike,
  SceneValidator,
  StageValidator,
} from '@openmaic/storage';

import { LocalDatabase } from './database.mjs';

export const DOCUMENT_MIGRATIONS = [
  {
    version: 1,
    sql: `
CREATE TABLE local_folders (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, name_key TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE local_documents (
  id TEXT PRIMARY KEY, data TEXT NOT NULL, version TEXT,
  outline TEXT, folder_id TEXT REFERENCES local_folders(id) ON DELETE SET NULL,
  rev INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE local_scenes (
  stage_id TEXT NOT NULL REFERENCES local_documents(id) ON DELETE CASCADE,
  id TEXT NOT NULL, scene_order REAL NOT NULL, data TEXT NOT NULL,
  rev INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(stage_id, id)
);
CREATE INDEX local_scenes_order ON local_scenes(stage_id, scene_order);
`,
  },
];

interface DocumentRow {
  id: string;
  data: string;
  version: string | null;
  outline: string | null;
  folder_id: string | null;
  rev: number;
}
interface SceneRow {
  data: string;
  id: string;
  scene_order: number;
  rev: number;
}
interface FolderRow {
  id: string;
  name: string;
  sort_order: number;
  created_at: number;
  updated_at: number;
}

function checked(result: ReturnType<StageValidator>, label: string) {
  if (!result.valid)
    throw new Error(
      `Invalid ${label}: ${result.errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`,
    );
}
function normalize<TScene extends SceneLike, TStage extends Stage>(
  doc: MaicDocument<TScene, TStage>,
  allowFuture = false,
) {
  if (!allowFuture && !needsMigration(doc) && dslVersionOf(doc) !== DSL_VERSION) {
    throw new DocumentVersionError(
      doc.stage.id,
      'future',
      dslVersionOf(doc),
      'Document was written by a newer version',
    );
  }
  const { outline, ...core } = doc;
  const normalized = migrate(core) as MaicDocument<TScene, TStage>;
  return outline === undefined ? normalized : { ...normalized, outline };
}
function folder(row: FolderRow): DocumentFolder {
  return {
    id: row.id,
    name: row.name,
    order: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Single-user store; the trusted provider owns the identity, never a request parameter. */
export class SqliteDocumentStore<TScene extends SceneLike = Scene, TStage extends Stage = Stage>
  implements DocumentStore<TScene, TStage>, DocumentFolderStore
{
  private readonly validateScene: SceneValidator;
  private readonly validateStage: StageValidator;

  constructor(
    readonly db: LocalDatabase,
    private readonly options: {
      validateScene?: SceneValidator;
      validateStage?: StageValidator;
      transformStage?: (stage: TStage) => TStage;
      transformScene?: (scene: TScene) => TScene;
      onMutation?: (stageId: string) => void;
      onDelete?: (stageId: string) => void;
    } = {},
  ) {
    this.validateScene = options.validateScene ?? validateScene;
    this.validateStage = options.validateStage ?? validateStage;
    db.migrate('documents', DOCUMENT_MIGRATIONS);
  }

  private row(id: string): DocumentRow | undefined {
    return this.db.prepare('SELECT * FROM local_documents WHERE id = ?').get(id);
  }
  private current(id: string): DocumentRow {
    const row = this.row(id);
    if (!row) throw new DocumentNotFoundError(id, 'missing document');
    if (row.version !== DSL_VERSION) {
      const core = { dslVersion: row.version ?? undefined };
      throw new DocumentVersionError(
        id,
        needsMigration(core) ? 'not-current' : 'future',
        row.version ?? undefined,
        'Load and save the document before incremental writes',
      );
    }
    return row;
  }
  private validateStoredScene(scene: TScene, stageId: string) {
    checked(this.validateScene(scene), `scene ${scene.id}`);
    if (
      typeof scene.id !== 'string' ||
      scene.stageId !== stageId ||
      !Number.isFinite(scene.order)
    ) {
      throw new Error('Scene id, stageId and finite order must match its document');
    }
  }
  private writeScene(stageId: string, scene: TScene) {
    this.db
      .prepare(
        `INSERT INTO local_scenes(stage_id,id,scene_order,data) VALUES (?,?,?,?)
      ON CONFLICT(stage_id,id) DO UPDATE SET scene_order=excluded.scene_order,data=excluded.data,rev=local_scenes.rev+1`,
      )
      .run(stageId, scene.id, scene.order, JSON.stringify(scene));
  }

  async saveDocument(input: MaicDocument<TScene, TStage>): Promise<void> {
    const doc = normalize({
      ...input,
      stage: this.options.transformStage?.(input.stage) ?? input.stage,
      scenes: input.scenes.map((scene) => this.options.transformScene?.(scene) ?? scene),
    });
    checked(this.validateStage(doc.stage), 'stage');
    const ids = new Set<string>();
    for (const scene of doc.scenes) {
      this.validateStoredScene(scene, doc.stage.id);
      if (ids.has(scene.id)) throw new Error(`Duplicate scene id ${scene.id}`);
      ids.add(scene.id);
    }
    const data = JSON.stringify(doc.stage);
    const outline = doc.outline === undefined ? null : JSON.stringify(doc.outline);
    this.db.transaction(() => {
      const existing = this.row(doc.stage.id);
      if (
        existing &&
        !needsMigration({ dslVersion: existing.version ?? undefined }) &&
        existing.version !== DSL_VERSION
      ) {
        throw new DocumentVersionError(
          doc.stage.id,
          'future',
          existing.version ?? undefined,
          'Stored document is newer',
        );
      }
      this.db
        .prepare(
          `INSERT INTO local_documents(id,data,version,outline) VALUES (?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET data=excluded.data,version=excluded.version,outline=excluded.outline,rev=local_documents.rev+1`,
        )
        .run(doc.stage.id, data, DSL_VERSION, outline);
      const old: { id: string }[] = this.db
        .prepare('SELECT id FROM local_scenes WHERE stage_id=?')
        .all(doc.stage.id);
      for (const row of old)
        if (!ids.has(row.id))
          this.db
            .prepare('DELETE FROM local_scenes WHERE stage_id=? AND id=?')
            .run(doc.stage.id, row.id);
      for (const scene of doc.scenes) this.writeScene(doc.stage.id, scene);
      this.options.onMutation?.(doc.stage.id);
    });
  }

  async loadDocument(id: string): Promise<MaicDocument<TScene, TStage> | null> {
    return this.db.transaction(() => {
      const row = this.row(id);
      if (!row) return null;
      const scenes: SceneRow[] = this.db
        .prepare('SELECT * FROM local_scenes WHERE stage_id=? ORDER BY scene_order,id')
        .all(id);
      return normalize<TScene, TStage>(
        {
          stage: JSON.parse(row.data),
          scenes: scenes.map((s) => JSON.parse(s.data)),
          dslVersion: row.version ?? undefined,
          ...(row.outline === null ? {} : { outline: JSON.parse(row.outline) }),
        },
        true,
      );
    });
  }

  async listDocuments(folderId?: string): Promise<DocumentSummary[]> {
    const rows: (DocumentRow & { scene_count: number })[] = this.db
      .prepare(
        `SELECT d.*,
      (SELECT count(*) FROM local_scenes s WHERE s.stage_id=d.id) AS scene_count FROM local_documents d
      ${folderId === undefined ? '' : 'WHERE folder_id=?'}`,
      )
      .all(...(folderId === undefined ? [] : [folderId]));
    return rows
      .map((row) => {
        const stage: TStage = JSON.parse(row.data);
        return {
          id: row.id,
          name: stage.name,
          createdAt: stage.createdAt,
          updatedAt: stage.updatedAt,
          ...(stage.description === undefined ? {} : { description: stage.description }),
          sceneCount: row.scene_count,
          ...(row.folder_id === null ? {} : { folderId: row.folder_id }),
        };
      })
      .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
  }
  async deleteDocument(id: string) {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM local_documents WHERE id=?').run(id);
      this.options.onDelete?.(id);
    });
  }
  async putStage(id: string, stage: TStage) {
    stage = this.options.transformStage?.(stage) ?? stage;
    if (id !== stage.id) throw new Error('Stage id mismatch');
    checked(this.validateStage(stage), 'stage');
    this.db.transaction(() => {
      this.current(id);
      this.db
        .prepare('UPDATE local_documents SET data=?,rev=rev+1 WHERE id=?')
        .run(JSON.stringify(stage), id);
      this.options.onMutation?.(id);
    });
  }
  async putScene(id: string, scene: TScene) {
    scene = this.options.transformScene?.(scene) ?? scene;
    this.validateStoredScene(scene, id);
    this.db.transaction(() => {
      this.current(id);
      this.writeScene(id, scene);
      this.db.prepare('UPDATE local_documents SET rev=rev+1 WHERE id=?').run(id);
      this.options.onMutation?.(id);
    });
  }
  async getScene(id: string, sceneId: string) {
    return (await this.loadDocument(id))?.scenes.find((s) => s.id === sceneId) ?? null;
  }
  async deleteScene(id: string, sceneId: string) {
    this.db.transaction(() => {
      if (!this.row(id)) return;
      this.current(id);
      const result = this.db
        .prepare('DELETE FROM local_scenes WHERE stage_id=? AND id=?')
        .run(id, sceneId);
      if (result.changes)
        this.db.prepare('UPDATE local_documents SET rev=rev+1 WHERE id=?').run(id);
      this.options.onMutation?.(id);
    });
  }
  async readFreshnessManifest(id: string) {
    return this.db.transaction(() => {
      const doc = this.row(id);
      if (!doc) return null;
      const scenes: SceneRow[] = this.db
        .prepare(
          'SELECT id,scene_order,rev FROM local_scenes WHERE stage_id=? ORDER BY scene_order,id',
        )
        .all(id);
      return {
        rev: doc.rev,
        scenes: scenes.map((s) => ({ id: s.id, order: s.scene_order, rev: s.rev })),
      };
    });
  }
  async listFolders() {
    const rows: FolderRow[] = this.db
      .prepare('SELECT * FROM local_folders ORDER BY sort_order,id')
      .all();
    return rows.map(folder);
  }
  async createFolder(id: string, name: string, limit = 100) {
    if (!id || !name.trim()) throw new Error('Folder id and name are required');
    return this.db.transaction(() => {
      const existing: FolderRow | undefined = this.db
        .prepare('SELECT * FROM local_folders WHERE name_key=?')
        .get(name.trim().toLowerCase());
      if (existing) return { folder: folder(existing), reused: true };
      const { count } = this.db.prepare('SELECT count(*) AS count FROM local_folders').get();
      if (count >= limit) throw new DocumentFolderLimitError(limit);
      const { next } = this.db
        .prepare('SELECT coalesce(max(sort_order),-1)+1 AS next FROM local_folders')
        .get();
      const now = Date.now();
      this.db
        .prepare('INSERT INTO local_folders VALUES (?,?,?,?,?,?)')
        .run(id, name.trim(), name.trim().toLowerCase(), next, now, now);
      return {
        folder: { id, name: name.trim(), order: next, createdAt: now, updatedAt: now },
        reused: false,
      };
    });
  }
  async renameFolder(id: string, name: string) {
    if (!name.trim()) throw new Error('Folder name is required');
    return this.db.transaction(() => {
      const result = this.db
        .prepare('UPDATE local_folders SET name=?,name_key=?,updated_at=? WHERE id=?')
        .run(name.trim(), name.trim().toLowerCase(), Date.now(), id);
      return result.changes
        ? folder(this.db.prepare('SELECT * FROM local_folders WHERE id=?').get(id))
        : null;
    });
  }
  async deleteFolder(id: string, mode: 'ungroup' | 'remove') {
    return this.db.transaction(() => {
      if (!this.db.prepare('SELECT id FROM local_folders WHERE id=?').get(id)) return null;
      const rows: { id: string }[] = this.db
        .prepare('SELECT id FROM local_documents WHERE folder_id=?')
        .all(id);
      this.db.prepare('DELETE FROM local_folders WHERE id=?').run(id);
      return { removedStageIds: mode === 'remove' ? rows.map((r) => r.id) : [] };
    });
  }
  async moveDocumentToFolder(id: string, folderId: string) {
    return this.setStageFolder(id, folderId);
  }
  async setStageFolder(id: string, folderId: string | null) {
    return this.db.transaction(() => {
      if (
        folderId !== null &&
        !this.db.prepare('SELECT id FROM local_folders WHERE id=?').get(folderId)
      )
        return false;
      return Boolean(
        this.db.prepare('UPDATE local_documents SET folder_id=? WHERE id=?').run(folderId, id)
          .changes,
      );
    });
  }
}
