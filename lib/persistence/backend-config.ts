import { homedir } from 'node:os';
import { posix, win32 } from 'node:path';

export type PersistenceBackendConfig =
  | { backend: 'postgres'; connectionString: string }
  | { backend: 'sqlite'; dataDir: string; databasePath: string; assetDir: string; tempDir: string };

interface ConfigOptions {
  platform?: NodeJS.Platform;
  homeDir?: string;
}

/** Server-only configuration. Desktop launches explicitly pass their userData directory. */
export function resolvePersistenceBackend(
  env: Record<string, string | undefined> = process.env,
  options: ConfigOptions = {},
): PersistenceBackendConfig {
  const selected = env.OPENMAIC_STORAGE_BACKEND?.trim();
  const connectionString = env.DATABASE_URL?.trim();
  if (selected && selected !== 'sqlite' && selected !== 'postgres') {
    throw new Error('OPENMAIC_STORAGE_BACKEND must be sqlite or postgres');
  }
  if (selected === 'sqlite' && connectionString) {
    throw new Error('SQLite mode conflicts with DATABASE_URL; remove DATABASE_URL');
  }
  if (selected === 'postgres' && !connectionString) {
    throw new Error('PostgreSQL mode requires DATABASE_URL');
  }
  if (selected === 'postgres' || (!selected && connectionString)) {
    return { backend: 'postgres', connectionString: connectionString! };
  }
  if (env.ASSET_S3_BUCKET?.trim()) {
    throw new Error('Local SQLite mode requires local media; remove ASSET_S3_BUCKET');
  }

  const platform = options.platform ?? process.platform;
  const path = platform === 'win32' ? win32 : posix;
  const configuredDir = env.OPENMAIC_DATA_DIR?.trim();
  if (configuredDir && !path.isAbsolute(configuredDir)) {
    throw new Error('OPENMAIC_DATA_DIR must be an absolute path');
  }
  const home = options.homeDir ?? homedir();
  const base = platform === 'win32' ? env.LOCALAPPDATA?.trim() || home : home;
  const dataDir = path.resolve(configuredDir ?? path.join(base, 'ProMAIC', 'data'));
  return {
    backend: 'sqlite',
    dataDir,
    databasePath: path.join(dataDir, 'openmaic.sqlite'),
    assetDir: path.join(dataDir, 'assets'),
    tempDir: path.join(dataDir, 'tmp'),
  };
}
