'use client';
import { useState } from 'react';
import { type OutputType } from '@/domain/resolution/model';
import { newRequestId, postJson } from '@/components/resolution/api';
import { ActionFeedback, useAction } from '@/components/resolution/use-action';
import { slugId } from '@/components/template-editor/fields';

export function OutputTypes({
  types,
  reload,
}: {
  types: OutputType[];
  reload: () => Promise<void>;
}) {
  const action = useAction();
  const [name, setName] = useState('');
  const [body, setBody] = useState<'directors' | 'members'>('directors');
  return (
    <section aria-labelledby="output-types">
      <h2 id="output-types" className="sr-only">
        Output types
      </h2>
      <ActionFeedback error={action.error} status={action.status} />
      <div className="table-wrap">
        <table>
          <caption className="sr-only">Output types</caption>
          <thead>
            <tr>
              <th>Document type</th>
              <th>Body</th>
              <th>ID</th>
              <th>State</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {types.map((type) => (
              <tr key={type.id}>
                <td>{type.name}</td>
                <td>{type.body === 'directors' ? 'Directors' : 'Members'}</td>
                <td>
                  <code>{type.id}</code>
                </td>
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
      <details className="disclosure">
        <summary>Add a document type</summary>
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
          {name.trim() ? (
            <p className="metadata full">
              ID:{' '}
              {slugId(
                name,
                types.map((t) => t.id),
              )}{' '}
              (stays the same if renamed)
            </p>
          ) : null}
          <div className="actions">
            <button disabled={action.pending}>Add document type</button>
          </div>
        </form>
      </details>
    </section>
  );
}
