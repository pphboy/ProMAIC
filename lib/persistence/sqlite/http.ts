import { createStorageHttpHandler } from '@openmaic/storage/server';
import { localPlayerOriginAllowed } from '@/lib/config/local-player-routes';
import { validateAppScene, validateAppStage } from '@/lib/document-store/validators';

import { APP_RUNTIME_PAYLOAD_VALIDATORS } from '@/lib/runtime/payload-validators';

import {
  getLocalPersistenceProvider,
  LOCAL_OWNER_ID,
  type LocalPersistenceProvider,
} from './provider';

export function createLocalStorageHandler() {
  const provider: LocalPersistenceProvider = getLocalPersistenceProvider();
  return createStorageHttpHandler(provider.runtimeStore, provider.documents, {
    authenticate: async () => ({ key: LOCAL_OWNER_ID, learnerKey: LOCAL_OWNER_ID }),
    assetStore: provider.assetStore,
    payloadValidators: APP_RUNTIME_PAYLOAD_VALIDATORS,
    validateScene: validateAppScene,
    validateStage: validateAppStage,
  });
}

export function localOriginRefusal(request: Request): Response | undefined {
  if (!localPlayerOriginAllowed(request)) {
    return Response.json(
      {
        error: {
          code: 'INVALID_ORIGIN',
          message: 'Local player accepts same-origin requests only',
        },
      },
      { status: 403 },
    );
  }
}
