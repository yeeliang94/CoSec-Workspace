'use client';
import { use } from 'react';
import { CaseWorkspace } from '@/components/resolution/case-workspace';
export default function ResolutionCasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <CaseWorkspace id={id} />;
}
