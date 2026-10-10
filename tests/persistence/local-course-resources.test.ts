import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  diagnoseLocalCourseResources,
  localRuntimeResource,
  rewriteLocalCourseResources,
} from '@/lib/persistence/local-course-resources';

describe('course resource local mapping', () => {
  it('maps supported dependencies and retains unknown origins for diagnosis', () => {
    expect(
      localRuntimeResource('https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.module.js'),
    ).toBe('/vendor/course-runtime/three/build/three.module.js');
    expect(
      localRuntimeResource(
        'https://unpkg.com/three@0.186.1/examples/jsm/controls/OrbitControls.js',
      ),
    ).toContain('/examples/jsm/controls/OrbitControls.js');
    expect(localRuntimeResource('https://cdn.tailwindcss.com')).toContain('/tailwind/');
    expect(localRuntimeResource('https://unknown.invalid/dependency.js')).toBeUndefined();
    expect(localRuntimeResource('https://unpkg.com/three@0.160.0/build/three.module.js')).toBeUndefined();
  });
  it('rewrites import maps and diagnoses unknown images, CSS and HTML references by scene', () => {
    const html =
      '<script type="importmap">{"imports":{"three":"https://unpkg.com/three/build/three.module.js"}}</script><img src="https://example.invalid/image.png"><style>body{background:url(https://example.invalid/bg.jpg)}</style>';
    const rewritten = rewriteLocalCourseResources({ html });
    expect(rewritten.html).toContain('/vendor/course-runtime/three/build/three.module.js');
    const issues = diagnoseLocalCourseResources(rewritten, '示例场景');
    expect(issues.map((issue) => issue.url)).toEqual(
      expect.arrayContaining([
        'https://example.invalid/image.png',
        'https://example.invalid/bg.jpg',
      ]),
    );
    expect(issues.every((issue) => issue.scene === '示例场景')).toBe(true);
  });
  it('stages nested Three imports, KaTeX font files and the Tailwind browser runtime', () => {
    const root = join(process.cwd(), 'public/vendor/course-runtime');
    for (const file of [
      'three/build/three.module.js',
      'three/build/three.core.js',
      'three/examples/jsm/controls/OrbitControls.js',
      'tailwind/index.global.js',
      'katex/katex.min.js',
      'katex/katex.min.css',
    ])
      expect(existsSync(join(root, file)), file).toBe(true);
    const css = readFileSync(join(root, 'katex/katex.min.css'), 'utf8');
    for (const match of css.matchAll(/url\(([^)]+\.woff2)\)/g))
      expect(existsSync(join(root, 'katex', match[1]))).toBe(true);
  });
});
