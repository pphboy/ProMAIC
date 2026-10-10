import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeLocalPersistenceProvider } from '@/lib/persistence/sqlite/provider';
import { readLocalModelConfig, saveLocalModelConfig } from '@/lib/persistence/sqlite/settings';
import { handleLocalModelSettings } from '@/lib/persistence/sqlite/settings-http';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'promaic-settings-'));
  vi.stubEnv('OPENMAIC_STORAGE_BACKEND', 'sqlite');
  vi.stubEnv('OPENMAIC_DATA_DIR', dir);
  vi.stubEnv('DATABASE_URL', '');
  vi.stubEnv('ASSET_S3_BUCKET', '');
  vi.stubEnv('OPENMAIC_SECRET_KEY', '');
});
afterEach(() => {
  closeLocalPersistenceProvider();
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe('local AI settings', () => {
  it('seals keys, restores settings after restart and returns masked views only', async () => {
    expect(readLocalModelConfig()).toBeNull();
    const config = {
      providers: { personal: { preset: 'openai', apiKey: 'sk-test-private-do-not-expose' } },
    };
    expect(saveLocalModelConfig(config, null)).toBe(1);
    const view = await handleLocalModelSettings(new Request('http://localhost/api/model-config'));
    expect(await view.text()).not.toContain('sk-test-private-do-not-expose');
    closeLocalPersistenceProvider();
    expect(readLocalModelConfig()?.config.providers?.personal.apiKey).toBe(
      'sk-test-private-do-not-expose',
    );
    expect(
      readFileSync(join(dir, 'openmaic.sqlite')).includes(
        Buffer.from('sk-test-private-do-not-expose'),
      ),
    ).toBe(false);
    expect(() => saveLocalModelConfig(config, null)).toThrow('changed');
    expect(saveLocalModelConfig(config, 1)).toBe(2);
  });
});
