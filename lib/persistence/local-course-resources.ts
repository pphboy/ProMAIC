import { collectAssetRefs } from '@/lib/export/html-asset-inventory';

export interface LocalResourceIssue {
  scene: string;
  kind: string;
  url: string;
}
const ROOT = '/vendor/course-runtime';

/** A deliberately small known dependency map. Unknown resources remain blocked and reported. */
export function localRuntimeResource(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (!['https:', 'http:'].includes(parsed.protocol)) return undefined;
  if (
    parsed.hostname === 'file.maic.chat' &&
    /^\/fonts\/(SourceHanSans|SourceHanSerif|LXGWWenKai|ZhuQueFangSong|WenDingPLKaiTi|ZcoolHappy)\.woff2$/.test(
      parsed.pathname,
    )
  )
    return `/vendor/course-fonts/${parsed.pathname.split('/').pop()}`;
  if (parsed.hostname === 'cdn.tailwindcss.com') return `${ROOT}/tailwind/legacy3.js`;
  if (!['cdn.jsdelivr.net', 'unpkg.com'].includes(parsed.hostname)) return undefined;
  const path = parsed.pathname.replace(/^\/npm\//, '/');
  const three = /^\/three(?:@([^/]+))?\/(build|examples\/jsm|src)\/(.+)$/.exec(path);
  if (
    three &&
    (!three[1] || /^0\.186(?:\.|$)/.test(three[1])) &&
    !three[3].split('/').includes('..')
  )
    return `${ROOT}/three/${three[2]}/${three[3]}`;
  if (/^\/@tailwindcss\/browser(?:@[^/]+)?(?:\/.*)?$/.test(path))
    return `${ROOT}/tailwind/index.global.js`;
  const katex = /^\/katex(?:@[^/]+)?\/dist\/(.+)$/.exec(path);
  if (katex && !katex[1].split('/').includes('..')) return `${ROOT}/katex/${katex[1]}`;
}

export function rewriteLocalCourseResources<T>(value: T): T {
  if (typeof value === 'string') {
    const direct = localRuntimeResource(value);
    if (direct) return direct as T;
    if (value.includes('<')) {
      let rewritten: string = value;
      for (const ref of collectAssetRefs(value)) {
        const local = localRuntimeResource(ref.url);
        if (local) rewritten = rewritten.split(ref.url).join(local);
      }
      return rewritten as T;
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(rewriteLocalCourseResources) as T;
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, rewriteLocalCourseResources(item)]),
    ) as T;
  return value;
}

export function diagnoseLocalCourseResources(value: unknown, scene = '课程'): LocalResourceIssue[] {
  const issues: LocalResourceIssue[] = [];
  const seen = new Set<string>();
  const add = (kind: string, url: string) => {
    if (!/^(?:https?:)?\/\//i.test(url) || localRuntimeResource(url)) return;
    const key = `${kind}:${url}`;
    if (!seen.has(key)) {
      seen.add(key);
      issues.push({ scene, kind, url });
    }
  };
  const visit = (item: unknown, key = '') => {
    if (typeof item === 'string') {
      if (item.includes('<')) for (const ref of collectAssetRefs(item)) add(ref.kind, ref.url);
      else if (['src', 'url', 'poster', 'avatar', 'audioUrl', 'backgroundImage'].includes(key))
        add(key, item);
    } else if (Array.isArray(item)) item.forEach((child) => visit(child, key));
    else if (item && typeof item === 'object')
      Object.entries(item).forEach(([name, child]) => visit(child, name));
  };
  visit(value);
  return issues;
}
