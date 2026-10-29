'use client';
import { canLeaveEditing } from '@/components/edit-guard';
import { Drawer } from '@/components/resolution/drawer';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type OutputType, type UsageContext } from '@/domain/resolution/model';
import { Empty } from '@/components/workspace';
import {
  newRequestId,
  postJson,
  type AssemblyWithVersions,
  statusOf,
} from '@/components/resolution/api';
import { ActionFeedback, useAction } from '@/components/resolution/use-action';
import { UsageChecks } from './clauses';

export function AssemblyLibrary({
  assemblies,
  outputTypes,
  canManage,
  creating,
  onCreating,
  reload,
}: {
  assemblies: AssemblyWithVersions[];
  outputTypes: OutputType[];
  canManage: boolean;
  creating: boolean;
  onCreating: (value: boolean) => void;
  reload: () => Promise<void>;
}) {
  const router = useRouter();
  const [showArchived, setShowArchived] = useState(false);
  const action = useAction();
  const typeName = (id: string) => outputTypes.find((t) => t.id === id)?.name || id;
  const rows = assemblies.filter((a) => showArchived || !a.archived);
  return (
    <>
      {creating ? (
        <CreateAssembly
          outputTypes={outputTypes.filter((t) => t.active)}
          onCancel={() => onCreating(false)}
          onCreated={(id) => router.push('/templates/assemblies/' + id)}
        />
      ) : null}
      <div className="toolbar">
        <label className="inline toolbar-check">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(event) => setShowArchived(event.target.checked)}
          />
          Show archived
        </label>
      </div>
      <ActionFeedback
        error={action.error}
        status={action.status}
        conflict={action.conflict}
        onReload={() => void reload()}
      />
      {rows.length ? (
        <div className="table-wrap">
          <table className="library-table stack-table">
            <caption className="sr-only">Assemblies</caption>
            <thead>
              <tr>
                <th>Layout</th>
                <th>Document type</th>
                <th>Version</th>
                {canManage ? <th>Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((assembly) => {
                const { last, published } = statusOf(assembly.versions);
                return (
                  <tr key={assembly.id}>
                    <td>
                      <Link href={'/templates/assemblies/' + assembly.id}>{assembly.name}</Link>
                      {assembly.archived ? <div className="state">Archived</div> : null}
                    </td>
                    <td data-label="Document type">{typeName(assembly.outputTypeId)}</td>
                    <td data-label="Version">
                      {last ? `v${last.version} · ${last.status}` : '—'}
                      {published && published.id !== last?.id ? (
                        <dl className="record-meta">
                          <div>
                            <dt>Published</dt>
                            <dd>v{published.version}</dd>
                          </div>
                        </dl>
                      ) : null}
                    </td>
                    {canManage ? (
                      <td>
                        <div className="row-actions">
                          <button
                            type="button"
                            className="quiet"
                            aria-label={`Copy ${assembly.name}`}
                            onClick={async () => {
                              const copy = await action.run(
                                () =>
                                  postJson<AssemblyWithVersions>('/api/resolution-assemblies', {
                                    action: 'copy',
                                    requestId: newRequestId(),
                                    sourceId: assembly.id,
                                    name: `Copy of ${assembly.name}`.slice(0, 160),
                                  }),
                                `Copied ${assembly.name}`,
                              );
                              if (copy) router.push('/templates/assemblies/' + copy.id);
                            }}
                          >
                            Copy
                          </button>
                          <button
                            type="button"
                            className="quiet"
                            aria-label={`${assembly.archived ? 'Restore' : 'Archive'} ${assembly.name}`}
                            onClick={async () => {
                              const ok = await action.run(
                                () =>
                                  postJson('/api/resolution-assemblies', {
                                    action: 'update',
                                    requestId: newRequestId(),
                                    id: assembly.id,
                                    expectedRevision: assembly.revision,
                                    archived: !assembly.archived,
                                  }),
                                `${assembly.name} ${assembly.archived ? 'restored' : 'archived'}`,
                              );
                              if (ok) await reload();
                            }}
                          >
                            {assembly.archived ? 'Restore' : 'Archive'}
                          </button>
                        </div>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>No layouts yet</Empty>
      )}
    </>
  );
}

function CreateAssembly({
  outputTypes,
  onCancel,
  onCreated,
}: {
  outputTypes: OutputType[];
  onCancel: () => void;
  onCreated: (id: string) => void;
}) {
  const action = useAction();
  const [requestId, setRequestId] = useState(newRequestId);
  const initialForm = {
    name: '',
    outputTypeId: outputTypes[0]?.id || '',
    description: '',
    usageContexts: ['board'] as UsageContext[],
  };
  const [form, setForm] = useState(initialForm);
  return (
    <Drawer title="New layout" onClose={onCancel}>
      <form
        className="form-grid"
        data-dirty={JSON.stringify(form) !== JSON.stringify(initialForm) ? 'true' : 'false'}
        onChange={() => setRequestId(newRequestId())}
        onSubmit={async (event) => {
          event.preventDefault();
          const formElement = event.currentTarget;
          const created = await action.run(
            () =>
              postJson<AssemblyWithVersions>('/api/resolution-assemblies', {
                action: 'create',
                requestId,
                name: form.name.trim(),
                outputTypeId: form.outputTypeId,
                description: form.description.trim(),
                usageContexts: form.usageContexts,
              }),
            'Assembly created',
          );
          if (created) {
            formElement.setAttribute('data-dirty', 'false');
            onCreated(created.id);
          }
        }}
      >
        <label className="full">
          Name
          <input
            required
            maxLength={160}
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
        </label>
        <label>
          Output type
          <select
            value={form.outputTypeId}
            onChange={(event) => setForm({ ...form, outputTypeId: event.target.value })}
          >
            {outputTypes.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
              </option>
            ))}
          </select>
        </label>
        <UsageChecks
          value={form.usageContexts}
          onChange={(usageContexts) => setForm({ ...form, usageContexts })}
        />
        <label className="full">
          Description
          <input
            maxLength={1000}
            value={form.description}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
          />
        </label>
        <div className="full form-footer">
          <ActionFeedback error={action.error} status={action.status} />
          <div className="actions">
            <button className="primary" disabled={action.pending || !form.usageContexts.length}>
              Create assembly
            </button>
            <button
              type="button"
              onClick={async () => {
                if (await canLeaveEditing()) onCancel();
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      </form>
    </Drawer>
  );
}
