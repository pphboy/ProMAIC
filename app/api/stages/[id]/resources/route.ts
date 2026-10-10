import { isLocalPlaybackConfigured } from '@/lib/config/feature-flags';
import { diagnoseLocalCourseResources } from '@/lib/persistence/local-course-resources';
import { getLocalPersistenceProvider } from '@/lib/persistence/sqlite/provider';

export const runtime = 'nodejs';
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isLocalPlaybackConfigured()) return new Response('Not found', { status: 404 });
  const { id } = await params;
  const doc = await getLocalPersistenceProvider().documents.loadDocument(id);
  if (!doc) return new Response('Not found', { status: 404 });
  const issues = [
    ...diagnoseLocalCourseResources(doc.stage),
    ...doc.scenes.flatMap((scene) => diagnoseLocalCourseResources(scene, scene.title || scene.id)),
  ];
  return Response.json({ issues }, { headers: { 'cache-control': 'private, no-store' } });
}
