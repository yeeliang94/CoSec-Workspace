'use client';
import { useState } from 'react';
import { type OutputType } from '@/domain/resolution/model';
import { newRequestId, postJson } from '@/components/resolution/api';
import { ActionFeedback, useAction } from '@/components/resolution/use-action';
import { slugId } from '@/components/template-editor/fields';
import { Drawer } from '@/components/resolution/drawer';
import { canLeaveEditing } from '@/components/edit-guard';

export function OutputTypes({
  types,
  reload,
  creating,
  onCreating,
}: {
  types: OutputType[];
  reload: () => Promise<void>;
  creating: boolean;
  onCreating: (value: boolean) => void;
}) {
  const action = useAction();
  const [name, setName] = useState('');
  const [body, setBody] = useState<'directors' | 'members'>('directors');
  return (
    <section aria-labelledby="output-types">
      <h2 id="output-types" className="sr-only">
        Output types
      </h2>
      {!creating ? <ActionFeedback error={action.error} status={action.status} /> : null}
      <div className="table-wrap">
        <table>
          <caption className="sr-only">Output types</caption>
          <thead>
            <tr>
              <th>Document type</th>
              <th>Body</th>
              <th>State</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {types.map((type) => (
              <tr key={type.id}>
                <td>{type.name}</td>
                <td>{type.body === 'directors' ? 'Directors' : 'Members'}</td>
                <td>{type.active ? 'Active' : 'Inactive'}</td>
                <td>
                  <button
                    type="button"
                    className="quiet"
                    aria-label={`${type.active ? 'Deactivate' : 'Activate'} ${type.name}`}
                    onClick={async () => {
                      const ok = await action.run(
                        () =>
                          postJson('/api/output-types', {
                            action: 'update',
                            requestId: newRequestId(),
                            id: type.id,
                            active: !type.active,
                          }),
                        `${type.name} ${type.active ? 'deactivated' : 'activated'}`,
                      );
                      if (ok) await reload();
                    }}
                  >
                    {type.active ? 'Deactivate' : 'Activate'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {creating ? (
        <Drawer title="New document type" onClose={() => onCreating(false)}>
          <form
            className="form-grid"
            data-dirty={name ? 'true' : 'false'}
            onSubmit={async (event) => {
              event.preventDefault();
              const ok = await action.run(
                () =>
                  postJson('/api/output-types', {
                    action: 'create',
                    requestId: newRequestId(),
                    id: slugId(
                      name,
                      types.map((t) => t.id),
                    ),
                    name: name.trim(),
                    body,
                    order: (types.at(-1)?.order ?? 0) + 10,
                  }),
                `${name.trim()} added`,
              );
              if (ok) {
                setName('');
                await reload();
                onCreating(false);
              }
            }}
          >
            <label>
              Name
              <input
                required
                maxLength={120}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              Body
              <select value={body} onChange={(e) => setBody(e.target.value as typeof body)}>
                <option value="directors">Directors</option>
                <option value="members">Members</option>
              </select>
            </label>
            <div className="full">
              <ActionFeedback error={action.error} status={action.status} />
            </div>
            <div className="actions">
              <button className="primary" disabled={action.pending}>
                Add document type
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (await canLeaveEditing()) onCreating(false);
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        </Drawer>
      ) : null}
    </section>
  );
}
