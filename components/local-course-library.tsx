'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { DocumentSummary, DocumentFolder } from '@openmaic/storage';

import { SettingsDialog } from '@/components/settings';
import { Button } from '@/components/ui/button';
import { useImportClassroom } from '@/lib/import/use-import-classroom';

export function LocalCourseLibrary() {
  const router = useRouter();
  const [courses, setCourses] = useState<DocumentSummary[]>([]);
  const [failure, setFailure] = useState('');
  const [settings, setSettings] = useState(false);
  const [folders, setFolders] = useState<DocumentFolder[]>([]);
  const [folderId, setFolderId] = useState('*');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState<{
    kind: 'new-folder' | 'rename-folder' | 'rename-course' | 'delete-folder' | 'delete-course';
    id?: string;
    value: string;
  } | null>(null);
  const load = useCallback(async () => {
    try {
      const [response, folderResponse] = await Promise.all([
        fetch('/api/stages', { cache: 'no-store' }),
        fetch('/api/folders', { cache: 'no-store' }),
      ]);
      if (!response.ok || !folderResponse.ok) throw new Error('无法读取本地课程库');
      const [data, folderData] = await Promise.all([response.json(), folderResponse.json()]);
      setCourses(data.stages);
      setFolders(folderData.folders);
      setFailure('');
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : '读取失败');
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const importer = useImportClassroom((id) => router.push(`/classroom/${encodeURIComponent(id)}`));
  const mutate = async (path: string, method: string, data?: unknown) => {
    setBusy(true);
    try {
      const response = await fetch(path, {
        method,
        ...(data === undefined
          ? {}
          : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) }),
      });
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error?.message || '操作失败');
      }
      await load();
      return true;
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : '操作失败');
      return false;
    } finally {
      setBusy(false);
    }
  };
  const saveEditor = async () => {
    if (!editor) return;
    const deleting = editor.kind.startsWith('delete');
    const family = editor.kind.endsWith('course') ? 'stages' : 'folders';
    const path = `/api/${family}${editor.id ? `/${encodeURIComponent(editor.id)}` : ''}`;
    if (
      await mutate(
        path,
        deleting ? 'DELETE' : editor.id ? 'PATCH' : 'POST',
        deleting ? undefined : { name: editor.value },
      )
    ) {
      if (editor.kind === 'delete-folder' && folderId === editor.id) setFolderId('*');
      setEditor(null);
    }
  };
  const visibleCourses = courses.filter(
    (course) =>
      (folderId === '*' || (course.folderId ?? '') === folderId) &&
      course.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );

  return (
    <main className="mx-auto max-w-5xl px-8 py-12">
      <div className="mb-10 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">ProMAIC 本地课程库</h1>
          <p className="mt-2 text-muted-foreground">导入 ZIP 课程包，随时播放。</p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" onClick={() => setSettings(true)}>
            设置
          </Button>
          <Button onClick={importer.triggerFileSelect} disabled={importer.importing}>
            {importer.importing ? '正在导入…' : '导入课程包'}
          </Button>
        </div>
      </div>
      <input
        ref={importer.fileInputRef}
        type="file"
        accept=".zip,.maic.zip"
        hidden
        onChange={importer.handleFileChange}
      />
      {failure && (
        <p role="alert" className="mb-4 text-destructive">
          {failure}
          <Button variant="ghost" onClick={() => void load()}>
            重试
          </Button>
        </p>
      )}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <input
          aria-label="搜索课程"
          placeholder="搜索课程"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="rounded-md border bg-background px-3 py-2"
        />
        <select
          aria-label="课程文件夹"
          value={folderId}
          onChange={(event) => setFolderId(event.target.value)}
          className="rounded-md border bg-background px-3 py-2"
        >
          <option value="*">全部课程</option>
          <option value="">未分组</option>
          {folders.map((folder) => (
            <option key={folder.id} value={folder.id}>
              {folder.name}
            </option>
          ))}
        </select>
        <Button variant="outline" onClick={() => setEditor({ kind: 'new-folder', value: '' })}>
          新建文件夹
        </Button>
        {folderId && folderId !== '*' && (
          <>
            <Button
              variant="ghost"
              onClick={() =>
                setEditor({
                  kind: 'rename-folder',
                  id: folderId,
                  value: folders.find((folder) => folder.id === folderId)?.name ?? '',
                })
              }
            >
              重命名文件夹
            </Button>
            <Button
              variant="ghost"
              onClick={() =>
                setEditor({
                  kind: 'delete-folder',
                  id: folderId,
                  value: folders.find((folder) => folder.id === folderId)?.name ?? '',
                })
              }
            >
              删除文件夹
            </Button>
          </>
        )}
      </div>
      {editor && (
        <form
          className="mb-6 rounded-lg border p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void saveEditor();
          }}
        >
          {editor.kind.startsWith('delete') ? (
            <p className="mb-3">
              确认删除“{editor.value}”？
              {editor.kind === 'delete-folder'
                ? '文件夹内的课程会保留。'
                : '课程及学习记录将移除。'}
            </p>
          ) : (
            <input
              aria-label="名称"
              required
              maxLength={200}
              value={editor.value}
              onChange={(event) => setEditor({ ...editor, value: event.target.value })}
              className="mr-3 rounded-md border bg-background px-3 py-2"
            />
          )}
          <Button type="submit" disabled={busy}>
            {editor.kind.startsWith('delete') ? '确认删除' : '保存'}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setEditor(null)} disabled={busy}>
            取消
          </Button>
        </form>
      )}
      {!failure && !courses.length && (
        <div className="rounded-xl border border-dashed p-12 text-center text-muted-foreground">
          还没有课程。选择 OpenMAIC 导出的 .maic.zip 文件开始学习。
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visibleCourses.map((course) => (
          <article
            key={course.id}
            className="rounded-xl border p-6 text-left transition-colors hover:bg-accent"
          >
            <button
              className="text-left"
              onClick={() => router.push(`/classroom/${encodeURIComponent(course.id)}`)}
            >
              <h2 className="text-lg font-medium">{course.name}</h2>
            </button>
            {course.description && (
              <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
                {course.description}
              </p>
            )}
            <p className="mt-5 text-sm text-muted-foreground">{course.sceneCount} 个场景</p>
            <select
              aria-label={`${course.name}的文件夹`}
              value={course.folderId ?? ''}
              disabled={busy}
              onChange={(event) =>
                void mutate('/api/folders/members', 'POST', {
                  stageId: course.id,
                  folderId: event.target.value || null,
                })
              }
              className="mt-3 w-full rounded-md border bg-background p-2 text-sm"
            >
              <option value="">未分组</option>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name}
                </option>
              ))}
            </select>
            <div className="mt-3 flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setEditor({ kind: 'rename-course', id: course.id, value: course.name })
                }
              >
                重命名
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  setEditor({ kind: 'delete-course', id: course.id, value: course.name })
                }
              >
                删除
              </Button>
            </div>
          </article>
        ))}
      </div>
      <SettingsDialog open={settings} onOpenChange={setSettings} />
    </main>
  );
}
