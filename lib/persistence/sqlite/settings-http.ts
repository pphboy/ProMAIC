import { WorkspaceConfigConflictError } from '@/lib/persistence/workspace-model-config';
import {
  applyModelSettingsChange,
  importModelSettings,
  modelSettingsView,
  ModelSettingsError,
} from '@/lib/server/model-config/settings';
import type {
  ModelSettingsChange,
  ModelSettingsProposal,
} from '@/lib/server/model-config/settings';

import { localOriginRefusal } from './http';
import { readLocalModelConfig, saveLocalModelConfig } from './settings';

export async function handleLocalModelSettings(
  request: Request,
  input?:
    | { revision: number | null; change: ModelSettingsChange }
    | { proposal: ModelSettingsProposal },
) {
  const refusal = localOriginRefusal(request);
  if (refusal) return refusal;
  try {
    const current = readLocalModelConfig();
    if (!input) return Response.json(modelSettingsView(current));
    if ('proposal' in input) {
      const result = await importModelSettings(current?.config ?? null, input.proposal);
      if (result.imported.length) saveLocalModelConfig(result.config, current?.revision ?? null);
      return Response.json({
        imported: result.imported,
        skipped: result.skipped,
        view: modelSettingsView(readLocalModelConfig()),
      });
    }
    if ((current?.revision ?? null) !== input.revision) throw new WorkspaceConfigConflictError();
    const next = await applyModelSettingsChange(current?.config ?? null, input.change);
    saveLocalModelConfig(next, input.revision);
    return Response.json(modelSettingsView(readLocalModelConfig()));
  } catch (cause) {
    const conflict = cause instanceof WorkspaceConfigConflictError;
    return Response.json(
      {
        error: {
          code: conflict
            ? 'CONFLICT'
            : cause instanceof ModelSettingsError
              ? cause.code
              : 'INVALID_SETTINGS',
          message: cause instanceof Error ? cause.message : 'Settings failed',
        },
      },
      { status: conflict ? 409 : 400 },
    );
  }
}
