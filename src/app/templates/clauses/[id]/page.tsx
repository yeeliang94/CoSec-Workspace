'use client';
import { use } from 'react';
import { useDocumentTitle } from '@/components/workspace';
import { ClauseEditor } from '@/components/resolution/clause-editor';
export default function ClausePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  useDocumentTitle('Wording');
  return <ClauseEditor id={id} />;
}
