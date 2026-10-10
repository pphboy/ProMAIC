'use client';

import { ClassroomSurface } from '@/components/classroom/ClassroomSurface';
import { useParams } from 'next/navigation';
import { LocalResourceNotice } from '@/components/local-resource-notice';

export default function ClassroomDetailPage() {
  const params = useParams<{ id: string }>();

  return (
    <>
      <LocalResourceNotice courseId={params.id} />
      <ClassroomSurface classroomId={params.id} variant="page" />
    </>
  );
}
