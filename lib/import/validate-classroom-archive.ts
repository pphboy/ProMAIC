import type JSZip from 'jszip';

import { CLASSROOM_ZIP_FORMAT_VERSION } from '@/lib/export/classroom-zip-types';
import type { ClassroomManifest } from '@/lib/export/classroom-zip-types';

function safePath(path: string) {
  return (
    !!path &&
    !path.startsWith('/') &&
    !/[\\:\u0000]/.test(path) &&
    !path.split('/').some((segment) => segment === '.' || segment === '..')
  );
}

/** Validate before allocating any media or publishing a course. */
export function validateClassroomArchive(zip: JSZip, manifest: ClassroomManifest): void {
  if (manifest.formatVersion !== CLASSROOM_ZIP_FORMAT_VERSION) {
    throw new Error(`不支持的课程包版本：${String(manifest.formatVersion)}`);
  }
  if (!manifest.stage || !Array.isArray(manifest.scenes))
    throw new Error('课程包缺少课程或场景数据');
  for (const [name, entry] of Object.entries(zip.files)) {
    const original =
      (entry as typeof entry & { unsafeOriginalName?: string }).unsafeOriginalName ?? name;
    if (!safePath(name) || !safePath(original))
      throw new Error(`课程包包含不安全路径：${original}`);
  }
  for (const [path, meta] of Object.entries(manifest.mediaIndex ?? {})) {
    if (!safePath(path)) throw new Error(`课程包包含不安全媒体路径：${path}`);
    if (!meta || typeof meta !== 'object') throw new Error(`媒体索引无效：${path}`);
    if (!meta.missing && !zip.file(path)) throw new Error(`课程包缺少媒体文件：${path}`);
  }
}
