'use client';
import { use } from 'react';
import { JobWorkspace } from '@/components/job-workspace';
export default function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <JobWorkspace id={id} />;
}
