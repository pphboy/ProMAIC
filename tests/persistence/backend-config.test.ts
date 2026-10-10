import { describe, expect, it } from 'vitest';

import { resolvePersistenceBackend } from '@/lib/persistence/backend-config';

describe('local persistence configuration', () => {
  it('defaults to a stable user directory, independent of cwd', () => {
    expect(resolvePersistenceBackend({}, { platform: 'linux', homeDir: '/home/test' })).toEqual({
      backend: 'sqlite',
      dataDir: '/home/test/ProMAIC/data',
      databasePath: '/home/test/ProMAIC/data/openmaic.sqlite',
      assetDir: '/home/test/ProMAIC/data/assets',
      tempDir: '/home/test/ProMAIC/data/tmp',
    });
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
