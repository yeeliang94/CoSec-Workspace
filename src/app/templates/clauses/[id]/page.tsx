'use client';
import { use } from 'react';
import { ClauseEditor } from '@/components/resolution/clause-editor';
export default function ClausePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <ClauseEditor id={id} />;
}
