import { resolvePersistenceBackend } from '@/lib/persistence/backend-config';
import {
  WorkspaceConfigConflictError,
  WorkspaceConfigInvalidError,
} from '@/lib/persistence/workspace-model-config';
import type { WorkspaceModelConfig } from '@/lib/persistence/workspace-model-config';
import { checkModelConfigShape } from '@/lib/server/model-config/openmaic-yml';
import type { ModelConfigFile } from '@/lib/server/model-config/openmaic-yml';
import { instanceKey, openSecret, sealSecret } from '@/lib/server/secret-box';

import { getLocalPersistenceProvider } from './provider';

function connection() {
  const config = resolvePersistenceBackend();
  if (config.backend !== 'sqlite') throw new Error('Local settings require SQLite');
  const { db } = getLocalPersistenceProvider();
  db.migrate('settings', [
    {
      version: 1,
      sql: 'CREATE TABLE local_settings(id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL, revision INTEGER NOT NULL)',
    },
  ]);
  return { db, key: () => instanceKey(process.env, config.dataDir) };
}
export function readLocalModelConfig(): WorkspaceModelConfig | null {
  const { db, key } = connection();
  const row = db.prepare('SELECT data,revision FROM local_settings WHERE id=1').get();
  if (!row) return null;
  return {
    config: JSON.parse(openSecret(JSON.parse(row.data), 'local-workspace-config', key())),
    revision: row.revision,
    unreadableSecrets: [],
  };
}
export function saveLocalModelConfig(next: ModelConfigFile, expectedRevision: number | null) {
  const { config, issues } = checkModelConfigShape(next);
  if (!config) throw new WorkspaceConfigInvalidError(issues);
  if (config.lock !== undefined || config.allowUserKeys !== undefined)
    throw new WorkspaceConfigInvalidError([
      'Only deployment configuration sets lock or allowUserKeys',
    ]);
  const { db, key } = connection();
  const encrypted = JSON.stringify(
    sealSecret(JSON.stringify(config), 'local-workspace-config', key()),
  );
  return db.transaction(() => {
    const row = db.prepare('SELECT revision FROM local_settings WHERE id=1').get();
    if ((row?.revision ?? null) !== expectedRevision) throw new WorkspaceConfigConflictError();
    const revision = (row?.revision ?? 0) + 1;
    db.prepare(
      'INSERT INTO local_settings VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,revision=excluded.revision',
    ).run(encrypted, revision);
    return revision;
  });
}
