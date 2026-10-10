import { randomUUID } from 'node:crypto';

import { DocumentFolderLimitError, isStorageBusyError } from '@openmaic/storage';

import type { AppDocument } from '@/lib/document-store/persistence-types';
import { FOLDER_COUNT_LIMIT, validateFolderName } from '@/lib/utils/folder-name-validation';

import { localOriginRefusal } from './http';
import { getLocalPersistenceProvider, LOCAL_OWNER_ID } from './provider';

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { 'cache-control': 'private, no-store' } });
}
function error(code: string, message: string, status = 400) {
  return json({ error: { code, message } }, status);
}
async function body(request: Request): Promise<Record<string, unknown>> {
  const value = await request.json();
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Expected a JSON object');
  return value;
}
function name(value: unknown, max = 200) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max)
    throw new Error('A valid name is required');
  return value.trim();
}

/** Local library adaptation; PostgreSQL routes retain their implementation. */
export async function handleLocalLibraryRequest(request: Request): Promise<Response> {
  const refusal = localOriginRefusal(request);
  if (refusal) return refusal;
  try {
    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const family = parts[1];
    const id = parts[2];
    const action = parts[3];
    const method = request.method;
    const { documents: store } = getLocalPersistenceProvider();
    if (family === 'folders') {
      if (!id && method === 'GET')
        return json({
          folders: (await store.listFolders()).map((f) => ({ ...f, userKey: LOCAL_OWNER_ID })),
        });
      if (!id && method === 'POST') {
        const folderName = name((await body(request)).name);
        const check = validateFolderName(folderName);
        if (!check.ok) return error('FOLDER_NAME_INVALID', 'Invalid folder name');
        const result = await store.createFolder(randomUUID(), folderName, FOLDER_COUNT_LIMIT);
        if (result.reused) return error('FOLDER_NAME_EXISTS', 'Folder name already exists', 409);
        return json({ folder: { ...result.folder, userKey: LOCAL_OWNER_ID } });
      }
      if (id === 'members' && method === 'POST') {
        const data = await body(request);
        if (
          typeof data.stageId !== 'string' ||
          (data.folderId !== null && typeof data.folderId !== 'string')
        )
          return error('INVALID_REQUEST', 'stageId and folderId are required');
        return (await store.setStageFolder(data.stageId, data.folderId as string | null))
          ? json({ ok: true })
          : error('NOT_FOUND', 'Course or folder not found', 404);
      }
      if (id && method === 'PATCH') {
        const folderName = name((await body(request)).name);
        if (!validateFolderName(folderName).ok)
          return error('FOLDER_NAME_INVALID', 'Invalid folder name');
        const updated = await store.renameFolder(id, folderName);
        return updated
          ? json({ folder: { ...updated, userKey: LOCAL_OWNER_ID } })
          : error('FOLDER_NOT_FOUND', 'Folder not found', 404);
      }
      if (id && method === 'DELETE') {
        const result = await store.deleteFolder(
          id,
          url.searchParams.get('mode') === 'remove' ? 'remove' : 'ungroup',
        );
        if (!result) return error('FOLDER_NOT_FOUND', 'Folder not found', 404);
        for (const stageId of result.removedStageIds) await store.deleteDocument(stageId);
        return json({ ok: true, ...result });
      }
    }
    if (family === 'stages' && !id) {
      if (method === 'GET')
        return json({
          stages: await store.listDocuments(url.searchParams.get('folderId') ?? undefined),
        });
      if (method === 'POST') {
        const data = await body(request);
        const now = Date.now();
        const stage = {
          id: `stage-${randomUUID()}`,
          name: name(data.name),
          description: typeof data.description === 'string' ? data.description.trim() : undefined,
          createdAt: now,
          updatedAt: now,
        };
        await store.saveDocument({ stage, scenes: [] });
        return json({ stage: { ...stage, sceneCount: 0 } }, 201);
      }
    }
    if (id && (family === 'stages' || family === 'stage-meta')) {
      const document = await store.loadDocument(id);
      if (!document) return error('NOT_FOUND', 'Course not found', 404);
      if (family === 'stage-meta' && method === 'GET')
        return json({
          isOwner: true,
          isPublic: false,
          publishedAt: null,
          generationComplete: true,
        });
      if (action === 'status' && method === 'GET')
        return json({ isPublic: false, publishedAt: null });
      if (action === 'manifest' && method === 'GET')
        return json(await store.readFreshnessManifest(id));
      if (action === 'scenes' && method === 'GET') {
        const ids = new Set((url.searchParams.get('ids') ?? '').split(','));
        return json({ scenes: document.scenes.filter((scene) => ids.has(scene.id)) });
      }
      if (action === 'generation-complete' && method === 'POST') return json({ ok: true });
      if (action)
        return error(
          'CAPABILITY_UNAVAILABLE',
          'This feature is unavailable in the local player',
          501,
        );
      if (method === 'GET') return json(document);
      if (method === 'DELETE') {
        await store.deleteDocument(id);
        return json({ success: true });
      }
      if (method === 'PATCH') {
        const newName = name((await body(request)).name);
        await store.putStage(id, { ...document.stage, name: newName, updatedAt: Date.now() });
        return json({ success: true, name: newName });
      }
      if (method === 'PUT') {
        const candidate = (await body(request)) as unknown as AppDocument;
        if (candidate.stage?.id !== id || !Array.isArray(candidate.scenes))
          return error('INVALID_REQUEST', 'Document id must match the route');
        await store.saveDocument(candidate);
        return json({ success: true });
      }
    }
    return error('CAPABILITY_UNAVAILABLE', 'This feature is unavailable in the local player', 501);
  } catch (cause) {
    if (isStorageBusyError(cause))
      return Response.json(
        { error: { code: cause.code, message: cause.message } },
        { status: 503, headers: { 'retry-after': String(cause.retryAfterSeconds) } },
      );
    if (cause instanceof DocumentFolderLimitError)
      return error('FOLDER_LIMIT_REACHED', cause.message, 409);
    if (
      (cause as { code?: string }).code?.startsWith('SQLITE_CONSTRAINT') ||
      (((cause as { errcode?: number }).errcode ?? 0) & 255) === 19
    )
      return error('CONFLICT', 'The value already exists or is still referenced', 409);
    return error('INVALID_REQUEST', cause instanceof Error ? cause.message : 'Request failed');
  }
}
