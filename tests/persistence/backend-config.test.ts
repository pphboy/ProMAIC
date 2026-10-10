import { describe, expect, it } from 'vitest';
import { posix, win32 } from 'node:path';

import { resolvePersistenceBackend } from '@/lib/persistence/backend-config';

describe('local persistence configuration', () => {
  it('defaults to a stable user directory, independent of cwd', () => {
    for (const { platform, homeDir, path } of [
      { platform: 'linux' as const, homeDir: '/home/test', path: posix },
      { platform: 'win32' as const, homeDir: 'C:\\Users\\test', path: win32 },
    ]) {
      const dataDir = path.join(homeDir, 'ProMAIC', 'data');
      expect(resolvePersistenceBackend({}, { platform, homeDir })).toEqual({
        backend: 'sqlite',
        dataDir,
        databasePath: path.join(dataDir, 'openmaic.sqlite'),
        assetDir: path.join(dataDir, 'assets'),
        tempDir: path.join(dataDir, 'tmp'),
      });
    }
  });

  it('preserves explicit existing PostgreSQL installations', () => {
    expect(resolvePersistenceBackend({ DATABASE_URL: ' postgres://local/db ' })).toEqual({
      backend: 'postgres',
      connectionString: 'postgres://local/db',
    });
  });

  it('rejects conflicting or incomplete configuration', () => {
    expect(() =>
      resolvePersistenceBackend({ OPENMAIC_STORAGE_BACKEND: 'sqlite', DATABASE_URL: 'pg' }),
    ).toThrow('conflicts');
    expect(() => resolvePersistenceBackend({ OPENMAIC_STORAGE_BACKEND: 'postgres' })).toThrow(
      'requires',
    );
    expect(() => resolvePersistenceBackend({ OPENMAIC_STORAGE_BACKEND: 'unknown' })).toThrow(
      'must be',
    );
    expect(() => resolvePersistenceBackend({ ASSET_S3_BUCKET: 'cloud-media' })).toThrow(
      'local media',
    );
    expect(() => resolvePersistenceBackend({ OPENMAIC_DATA_DIR: './data' })).toThrow('absolute');
  });

  it('honors desktop userData paths with Chinese characters and spaces', () => {
    const config = resolvePersistenceBackend(
      { OPENMAIC_DATA_DIR: 'C:\\Users\\测试 用户\\AppData\\Roaming\\ProMAIC\\data' },
      { platform: 'win32' },
    );
    expect(config.backend).toBe('sqlite');
    if (config.backend === 'sqlite') {
      expect(config.databasePath).toBe(
        'C:\\Users\\测试 用户\\AppData\\Roaming\\ProMAIC\\data\\openmaic.sqlite',
      );
    }
  });
});
