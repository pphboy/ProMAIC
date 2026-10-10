import { afterEach, vi } from 'vitest';

vi.mock('../../packages/@openmaic/storage/src/index.js', async () => import('@openmaic/storage'));
import { runRuntimeStoreContract } from '../../packages/@openmaic/storage/test/runtime-contract';
import { LocalDatabase } from '@/lib/persistence/sqlite/database.mjs';
import { SqliteRuntimeStore } from '@/lib/persistence/sqlite/runtime';

const connections: LocalDatabase[] = [];
afterEach(() => {
  for (const db of connections.splice(0)) db.close();
});
runRuntimeStoreContract('SQLite', () => {
  const db = new LocalDatabase(':memory:');
  connections.push(db);
  return new SqliteRuntimeStore(db);
});
