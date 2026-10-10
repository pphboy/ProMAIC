import {
  RUNTIME_DSL_VERSION,
  isChatMessageSkeleton,
  isQuizAttemptSkeleton,
  migrateRuntime,
  needsRuntimeMigration,
  runtimeDslVersionOf,
  validateRuntimeRecord,
  validateRuntimeSession,
} from '@openmaic/dsl';
import type {
  RuntimePayload,
  RuntimeRecord,
  RuntimeRecordInit,
  RuntimeSession,
  RuntimeSessionStatus,
} from '@openmaic/dsl';
import {
  assertJsonValue,
  RuntimeAppendConflictError,
  RuntimeSessionExistsError,
} from '@openmaic/storage';
import type {
  RuntimeAppendOptions,
  RuntimePayloadValidator,
  RuntimeSessionInit,
  RuntimeStore,
  RuntimeTailOptions,
} from '@openmaic/storage';

import { LocalDatabase } from './database.mjs';

const MIGRATIONS = [
  {
    version: 1,
    sql: `
CREATE TABLE local_runtime_sessions(id TEXT PRIMARY KEY, stage_id TEXT NOT NULL, learner_key TEXT NOT NULL, data TEXT NOT NULL);
CREATE INDEX local_runtime_partition ON local_runtime_sessions(stage_id,learner_key);
CREATE TABLE local_runtime_records(id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES local_runtime_sessions(id) ON DELETE CASCADE,
seq INTEGER NOT NULL, scene_id TEXT, data TEXT NOT NULL, UNIQUE(session_id,seq));
`,
  },
];
function checked(result: ReturnType<typeof validateRuntimeSession>, label: string) {
  if (!result.valid)
    throw new Error(
      `@openmaic/storage: invalid ${label}: ${result.errors.map((e) => `${e.path || '/'}: ${e.message}`).join('; ')}`,
    );
}

export class SqliteRuntimeStore implements RuntimeStore {
  constructor(
    readonly db: LocalDatabase,
    readonly validators?: Record<string, RuntimePayloadValidator>,
  ) {
    db.migrate('runtime', MIGRATIONS);
  }
  private read(id: string, writing = false): RuntimeSession | undefined {
    const row = this.db.prepare('SELECT data FROM local_runtime_sessions WHERE id=?').get(id);
    if (!row) return undefined;
    let session: RuntimeSession = JSON.parse(row.data);
    if (
      writing &&
      !needsRuntimeMigration(session) &&
      runtimeDslVersionOf(session) !== RUNTIME_DSL_VERSION
    )
      throw new Error('Session was written at a newer runtime version');
    if (needsRuntimeMigration(session)) session = migrateRuntime(session) as RuntimeSession;
    checked(validateRuntimeSession(session), `runtime session ${JSON.stringify(id)}`);
    return session;
  }
  private write(session: RuntimeSession) {
    this.db
      .prepare('UPDATE local_runtime_sessions SET learner_key=?,data=? WHERE id=?')
      .run(session.learnerKey, JSON.stringify(session), session.id);
  }
  private checkTail(id: string, options: RuntimeTailOptions) {
    const expected = options.expectedLastSeq;
    if (
      expected !== undefined &&
      expected !== null &&
      (!Number.isSafeInteger(expected) || expected < 0)
    )
      throw new Error('expectedLastSeq must be null or a non-negative integer');
    const last: number | null = this.db
      .prepare('SELECT max(seq) AS last FROM local_runtime_records WHERE session_id=?')
      .get(id).last;
    if (expected !== undefined && expected !== last)
      throw new RuntimeAppendConflictError(id, expected, last);
    return last;
  }
  async createSession(init: RuntimeSessionInit) {
    const session = { ...init, runtimeDslVersion: RUNTIME_DSL_VERSION };
    checked(validateRuntimeSession(session), `runtime session ${JSON.stringify(init.id)}`);
    assertJsonValue(session, 'runtime session');
    return this.db.transaction(() => {
      if (this.db.prepare('SELECT id FROM local_runtime_sessions WHERE id=?').get(init.id))
        throw new RuntimeSessionExistsError(init.id);
      this.db
        .prepare('INSERT INTO local_runtime_sessions VALUES (?,?,?,?)')
        .run(init.id, init.stageId, init.learnerKey, JSON.stringify(session));
      return session;
    });
  }
  async getSession(id: string) {
    return this.read(id);
  }
  async listSessions(stageId: string, learnerKey: string) {
    const rows: { id: string }[] = this.db
      .prepare('SELECT id FROM local_runtime_sessions WHERE stage_id=? AND learner_key=?')
      .all(stageId, learnerKey);
    const result: RuntimeSession[] = [];
    for (const row of rows) {
      try {
        const session = this.read(row.id);
        if (session) result.push(session);
      } catch {
        /* omit corrupt listings; direct reads fail loud */
      }
    }
    return result.sort(
      (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id),
    );
  }
  async setSessionStatus(
    id: string,
    status: RuntimeSessionStatus,
    updatedAt: string,
    options: RuntimeTailOptions = {},
  ) {
    this.db.transaction(() => {
      const session = this.read(id, true);
      if (!session) throw new Error(`no session ${JSON.stringify(id)}`);
      this.checkTail(id, options);
      const updated = { ...session, status, updatedAt };
      checked(validateRuntimeSession(updated), `runtime session ${JSON.stringify(id)}`);
      assertJsonValue(updated, 'runtime session');
      this.write(updated);
    });
  }
  async appendRecord<T extends RuntimePayload>(
    init: RuntimeRecordInit<T>,
    options: RuntimeAppendOptions = {},
  ): Promise<RuntimeRecord<T>> {
    checked(
      validateRuntimeRecord({ ...init, seq: 0 }),
      `runtime record ${JSON.stringify(init.id)}`,
    );
    return this.db.transaction(() => {
      const session = this.read(init.sessionId, true);
      if (!session) throw new Error(`no session ${JSON.stringify(init.sessionId)}`);
      if (session.status !== 'active')
        throw new Error('Records may only be appended to an active session');
      const validator = this.validators?.[session.kind];
      if (validator) checked(validator(init.payload), `runtime record ${JSON.stringify(init.id)}`);
      else if (!this.validators) {
        if (session.kind === 'chat' && !isChatMessageSkeleton(init.payload))
          throw new Error('Invalid chat payload');
        if (session.kind === 'quizAttempt' && !isQuizAttemptSkeleton(init.payload))
          throw new Error('Invalid quizAttempt payload');
      }
      const last = this.checkTail(init.sessionId, options);
      const record = { ...init, seq: last === null ? 0 : last + 1 };
      checked(validateRuntimeRecord(record), `runtime record ${JSON.stringify(init.id)}`);
      const jsonRecord = { ...record } as Record<string, unknown>;
      for (const key of ['sceneId', 'actionIndex', 'subAnchor'])
        if (jsonRecord[key] === undefined) delete jsonRecord[key];
      assertJsonValue(jsonRecord, 'runtime record');
      const updated = options.sessionTransition
        ? { ...session, ...options.sessionTransition }
        : session;
      checked(validateRuntimeSession(updated), `runtime session ${JSON.stringify(session.id)}`);
      this.db
        .prepare('INSERT INTO local_runtime_records VALUES (?,?,?,?,?)')
        .run(
          record.id,
          record.sessionId,
          record.seq,
          record.sceneId ?? null,
          JSON.stringify(jsonRecord),
        );
      this.write(updated);
      return record;
    });
  }
  async listRecords(id: string, options: { sceneId?: string } = {}): Promise<RuntimeRecord[]> {
    if (!this.read(id)) return [];
    const rows: { data: string }[] = this.db
      .prepare(
        `SELECT data FROM local_runtime_records WHERE session_id=? ${options.sceneId === undefined ? '' : 'AND scene_id=?'} ORDER BY seq`,
      )
      .all(id, ...(options.sceneId === undefined ? [] : [options.sceneId]));
    return rows.map((row) => JSON.parse(row.data));
  }
  async deleteSession(id: string) {
    this.db.prepare('DELETE FROM local_runtime_sessions WHERE id=?').run(id);
  }
  async mergeLearner(from: string, to: string) {
    if (!from || !to) throw new Error('learnerKey must be non-empty');
    if (from === to) return 0;
    return this.db.transaction(() => {
      const rows: { id: string }[] = this.db
        .prepare('SELECT id FROM local_runtime_sessions WHERE learner_key=?')
        .all(from);
      for (const row of rows) {
        const session = this.read(row.id, true)!;
        const updated = { ...session, learnerKey: to };
        checked(validateRuntimeSession(updated), `runtime session ${JSON.stringify(row.id)}`);
        this.write(updated);
      }
      return rows.length;
    });
  }
  async deleteLearnerRuntime(stageId: string, learnerKey: string) {
    this.db
      .prepare('DELETE FROM local_runtime_sessions WHERE stage_id=? AND learner_key=?')
      .run(stageId, learnerKey);
  }
  async deleteStageRuntime(stageId: string) {
    this.db.prepare('DELETE FROM local_runtime_sessions WHERE stage_id=?').run(stageId);
  }
  async deleteAllRuntime() {
    this.db.exec('DELETE FROM local_runtime_sessions');
  }
}
