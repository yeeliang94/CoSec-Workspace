'use client';
import { use } from 'react';
import { useDocumentTitle } from '@/components/workspace';
import { AssemblyEditor } from '@/components/resolution/assembly-editor';
export default function AssemblyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  useDocumentTitle('Layout');
  return <AssemblyEditor id={id} />;
}
