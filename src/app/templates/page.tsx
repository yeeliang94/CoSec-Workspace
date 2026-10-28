'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { type OutputType } from '@/domain/resolution/model';
import { Icon, PageHeader, useWorkspace } from '@/components/workspace';
import {
  getJson,
  type AssemblyWithVersions,
  type ClauseWithVersions,
} from '@/components/resolution/api';
import { LoadState, useLoad } from '@/components/resolution/use-load';
import { canLeaveEditing } from '@/components/edit-guard';
import { OutputTypes } from '@/components/template-library/output-types';
import { AssemblyLibrary } from '@/components/template-library/assemblies';
import { ClauseLibrary } from '@/components/template-library/clauses';

type Tab = 'clauses' | 'assemblies' | 'outputs';

export default function TemplatesPage() {
  const { data } = useWorkspace();
  const [tab, setTab] = useState<Tab>('clauses');
  const [creating, setCreating] = useState(false);
  const load = useLoad(async () => {
    const [clauses, assemblies, types] = await Promise.all([
      getJson<{ clauses: ClauseWithVersions[] }>('/api/clause-templates?includeHidden=true'),
      getJson<{ assemblies: AssemblyWithVersions[] }>(
        '/api/resolution-assemblies?includeHidden=true',
      ),
      getJson<{ outputTypes: OutputType[] }>('/api/output-types'),
    ]);
    return {
      clauses: clauses.clauses,
      assemblies: assemblies.assemblies,
      outputTypes: types.outputTypes,
    };
  }, []);
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (hash === 'assemblies' || hash === 'outputs') setTab(hash);
  }, []);
  if (!data) return null;
  const canManage = data.actor.capabilities.includes('manage_templates');
  const choose = async (next: Tab) => {
    if (next === tab || !(await canLeaveEditing())) return;
    setTab(next);
    setCreating(false);
    window.history.replaceState(window.history.state, '', '#' + next);
  };
  return (
    <>
      <Link href="/resolutions" className="back-link">
        <Icon kind="back" />
        Resolutions
      </Link>
      <PageHeader title="Resolution templates">
        {canManage && tab !== 'outputs' ? (
          <button
            type="button"
            className="primary"
            aria-expanded={creating}
            onClick={async () => {
              if (creating && !(await canLeaveEditing())) return;
              setCreating(!creating);
            }}
          >
            {tab === 'clauses' ? 'New paragraph' : 'New layout'}
          </button>
        ) : null}
      </PageHeader>
      <div className="filters" role="group" aria-label="Library sections">
        {(
          [
            ['clauses', 'Standard wording', load.data?.clauses.filter((c) => !c.archived).length],
            ['assemblies', 'Layouts', load.data?.assemblies.filter((a) => !a.archived).length],
            ...(canManage ? [['outputs', 'Document types', load.data?.outputTypes.length]] : []),
          ] as [Tab, string, number | undefined][]
        ).map(([key, label, count]) => (
          <button
            type="button"
            key={key}
            className={'filter' + (tab === key ? ' active' : '')}
            aria-pressed={tab === key}
            onClick={() => choose(key)}
          >
            {label}
            {count !== undefined ? <small>{count}</small> : null}
          </button>
        ))}
      </div>
      <LoadState
        loading={load.loading && !load.data}
        error={load.error}
        reload={() => void load.reload()}
        label="clause library"
      />
      {load.data ? (
        tab === 'clauses' ? (
          <ClauseLibrary
            clauses={load.data.clauses}
            canManage={canManage}
            creating={creating}
            onCreating={async (value) => {
              if (!value && !(await canLeaveEditing())) return;
              setCreating(value);
            }}
            reload={load.reload}
          />
        ) : tab === 'assemblies' ? (
          <AssemblyLibrary
            assemblies={load.data.assemblies}
            outputTypes={load.data.outputTypes}
            canManage={canManage}
            creating={creating}
            onCreating={async (value) => {
              if (!value && !(await canLeaveEditing())) return;
              setCreating(value);
            }}
            reload={load.reload}
          />
        ) : (
          <OutputTypes types={load.data.outputTypes} reload={load.reload} />
        )
      ) : null}
    </>
  );
}
