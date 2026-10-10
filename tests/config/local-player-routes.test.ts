import { describe, expect, it } from 'vitest';
import { localPlayerApiAllowed, localPlayerOriginAllowed } from '@/lib/config/local-player-routes';

describe('local player capability boundary', () => {
  it('uses the actual loopback Host port rather than Next internal request URLs', () => {
    expect(
      localPlayerOriginAllowed({
        url: 'http://localhost:3000/api/stages',
        headers: new Headers({ host: '127.0.0.1:49999', origin: 'http://127.0.0.1:49999' }),
      }),
    ).toBe(true);
    expect(
      localPlayerOriginAllowed({
        url: 'http://localhost/api/stages',
        headers: new Headers({ host: 'untrusted.invalid', origin: 'http://untrusted.invalid' }),
      }),
    ).toBe(false);
    expect(
      localPlayerOriginAllowed({
        url: 'http://localhost/api/stages',
        headers: new Headers({ origin: 'null' }),
      }),
    ).toBe(false);
  });
  it('allows local storage and explicit classroom AI endpoints', () => {
    for (const path of [
      '/api/stages',
      '/api/folders/members',
      '/api/persistence/assets',
      '/api/model-config',
      '/api/chat/pi',
    ])
      expect(localPlayerApiAllowed(path), path).toBe(true);
  });
  it('rejects unrelated background, proxy and cloud media endpoints', () => {
    for (const path of [
      '/api/proxy-media',
      '/api/generate/tts',
      '/api/parse-pdf',
      '/api/generation-runs',
      '/api/agent/sessions',
      '/api/persistence-other',
    ])
      expect(localPlayerApiAllowed(path), path).toBe(false);
  });
});
