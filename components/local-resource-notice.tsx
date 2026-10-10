'use client';

import { useEffect, useState } from 'react';
import type { LocalResourceIssue } from '@/lib/persistence/local-course-resources';

export function LocalResourceNotice({ courseId }: { courseId: string }) {
  const [issues, setIssues] = useState<LocalResourceIssue[]>([]);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    let active = true;
    fetch(`/api/stages/${encodeURIComponent(courseId)}/resources`)
      .then(async (response) => {
        if (response.ok && active) setIssues((await response.json()).issues);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [courseId]);
  if (!issues.length || dismissed) return null;
  return (
    <aside
      role="alert"
      className="fixed left-4 right-4 top-4 z-[100] mx-auto max-w-3xl rounded-lg border bg-background p-4 shadow-lg"
    >
      <div className="flex items-start justify-between gap-4">
        <p>
          课程包有 {issues.length} 项外部资源未包含在本地，相关内容可能无法显示。其他场景仍可播放。
        </p>
        <button onClick={() => setDismissed(true)} aria-label="关闭资源提示">
          关闭
        </button>
      </div>
      <details className="mt-2 text-sm">
        <summary>查看缺失资源</summary>
        <ul className="mt-2 max-h-48 overflow-auto">
          {issues.map((issue, index) => (
            <li key={index} className="break-all py-1">
              {issue.scene} · {issue.kind} · {issue.url}
            </li>
          ))}
        </ul>
      </details>
    </aside>
  );
}
