import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

import type { ClassroomManifest } from '@/lib/export/classroom-zip-types';
import { validateClassroomArchive } from '@/lib/import/validate-classroom-archive';

function manifest(index = {}): ClassroomManifest {
  return {
    formatVersion: 1,
    stage: { name: '课程' },
    scenes: [],
    mediaIndex: index,
  } as unknown as ClassroomManifest;
}
describe('course archive preflight', () => {
  it('accepts existing format with all indexed bytes', () => {
    const zip = new JSZip().file('media/audio.wav', 'audio');
    expect(() =>
      validateClassroomArchive(zip, manifest({ 'media/audio.wav': { type: 'audio' } })),
    ).not.toThrow();
  });
  it('rejects unsupported versions and missing indexed media before writes', () => {
    expect(() =>
      validateClassroomArchive(new JSZip(), { ...manifest(), formatVersion: 2 }),
    ).toThrow('版本');
    expect(() =>
      validateClassroomArchive(new JSZip(), manifest({ 'media/missing.wav': { type: 'audio' } })),
    ).toThrow('缺少媒体');
  });
  it('rejects original traversal paths even when JSZip sanitized them', async () => {
    const bytes = await new JSZip()
      .file('../outside.wav', 'bad')
      .generateAsync({ type: 'uint8array' });
    const zip = await JSZip.loadAsync(bytes);
    expect(() => validateClassroomArchive(zip, manifest())).toThrow('不安全');
  });
});
