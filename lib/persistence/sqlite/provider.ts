import { mkdirSync } from 'node:fs';

import { enumerateAssetManifest } from '@openmaic/dsl';
import type { RuntimeStore, AssetStore } from '@openmaic/storage';

import type { AppDocument } from '@/lib/document-store/persistence-types';
import { validateAppScene, validateAppStage } from '@/lib/document-store/validators';
import { resolveAssetQuotaBytes } from '@/lib/persistence/asset-quota';
import { resolvePersistenceBackend } from '@/lib/persistence/backend-config';
import { APP_RUNTIME_PAYLOAD_VALIDATORS } from '@/lib/runtime/payload-validators';
import { sanitizeSceneContent } from '@/lib/server/sanitize-scene-content';
import { rewriteLocalCourseResources } from '@/lib/persistence/local-course-resources';
import type { PersistenceStores, CourseDocumentStore } from '@/lib/persistence/provider-types';

import { LocalDatabase } from './database.mjs';
import { SqliteDocumentStore } from './documents';
import { SqliteRuntimeStore } from './runtime';
import { SqliteAssetStore } from './assets';

export const LOCAL_OWNER_ID = 'local';
export interface LocalPersistenceProvider extends PersistenceStores {
  documents: CourseDocumentStore<AppDocument['scenes'][number], AppDocument['stage']>;
  runtime: RuntimeStore;
  assets: AssetStore;
  close(): void;
}

export function createLocalPersistenceProvider(
  dataDir: string,
  databasePath: string,
  assetDir: string,
) {
  mkdirSync(dataDir, { recursive: true });
  const db = new LocalDatabase(databasePath);
  try {
    // Provision parents before assets' reference relation.
    new SqliteDocumentStore(db);
    const runtime = new SqliteRuntimeStore(db, APP_RUNTIME_PAYLOAD_VALIDATORS);
    const assets = new SqliteAssetStore(db, assetDir, resolveAssetQuotaBytes());
    const documents = new SqliteDocumentStore<AppDocument['scenes'][number], AppDocument['stage']>(
      db,
      {
        validateStage: validateAppStage,
        validateScene: validateAppScene,
        transformStage: (stage) => rewriteLocalCourseResources(sanitizeSceneContent(stage)),
        transformScene: (scene) => rewriteLocalCourseResources(sanitizeSceneContent(scene)),
        onMutation: (id) => {
          const row = db.prepare('SELECT data FROM local_documents WHERE id=?').get(id);
          const scenes: { data: string }[] = db
            .prepare('SELECT data FROM local_scenes WHERE stage_id=?')
            .all(id);
          const doc: AppDocument = {
            stage: JSON.parse(row.data),
            scenes: scenes.map((s) => JSON.parse(s.data)),
          };
          assets.trackReferences(id, enumerateAssetManifest(doc).referenceCounts.keys());
        },
        onDelete: (id) => {
          db.prepare('DELETE FROM local_runtime_sessions WHERE stage_id=?').run(id);
        },
      },
    );
    return {
      db,
      documents,
      runtime,
      assets,
      runtimeStore: runtime,
      assetStore: assets,
      close: () => db.close(),
    };
  } catch (error) {
    db.close();
    throw error;
  }
}

const KEY = Symbol.for('promaic.local-persistence');
const state = globalThis as typeof globalThis & {
  [KEY]?: { path: string; provider: ReturnType<typeof createLocalPersistenceProvider> };
};
export function getLocalPersistenceProvider() {
  const config = resolvePersistenceBackend();
  if (config.backend !== 'sqlite')
    throw new Error('Local persistence requested for PostgreSQL mode');
  if (state[KEY]?.path === config.databasePath) return state[KEY]!.provider;
  // Never silently switch a running instance to a different database.
  if (state[KEY]) throw new Error('Local data directory changed while the service was running');
  const provider = createLocalPersistenceProvider(
    config.dataDir,
    config.databasePath,
    config.assetDir,
  );
  state[KEY] = { path: config.databasePath, provider };
  return provider;
}
export function closeLocalPersistenceProvider() {
  state[KEY]?.provider.close();
  delete state[KEY];
}
