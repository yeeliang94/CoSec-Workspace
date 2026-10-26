'use client';
import { use } from 'react';
import { AssemblyEditor } from '@/components/resolution/assembly-editor';
export default function AssemblyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <AssemblyEditor id={id} />;
}
