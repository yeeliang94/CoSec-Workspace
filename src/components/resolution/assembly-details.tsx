'use client';
import { useState } from 'react';
import type { UsageContext } from '@/domain/resolution/model';
import { useWorkspace } from '@/components/workspace';
import { USAGE_CONTEXTS } from './api';
import { useTemplateVersion } from './template-page';
import { ActionFeedback, useAction } from './use-action';
import type { Draft } from './assembly-editor';

export function AssemblyDetails({
  page,
  draft,
  editable,
  onDraft,
}: {
  page: ReturnType<typeof useTemplateVersion<'assembly'>>;
  draft: Draft;
  editable: boolean;
  onDraft: (patch: Partial<Draft>) => void;
}) {
  const { data } = useWorkspace();
  const template = page.state!.template;
  const canManage = Boolean(data?.actor.capabilities.includes('manage_templates'));
  const action = useAction();
  const [meta, setMeta] = useState({
    name: template.name,
    description: template.description,
    usageContexts: template.usageContexts,
  });
  const metaDirty =
    meta.name !== template.name ||
    meta.description !== template.description ||
    meta.usageContexts.join() !== template.usageContexts.join();
  return (
    <>
      <section className="section" aria-labelledby="assembly-meta">
        <h2 id="assembly-meta" className="sr-only">
          Assembly details
        </h2>
        <dl className="record-meta">
          <div>
            <dt>Document type</dt>
            <dd>
              {page.state!.outputTypes.find((type) => type.id === template.outputTypeId)?.name ||
                template.outputTypeId}
            </dd>
          </div>
        </dl>
        <form
          className="form-grid"
          data-dirty={metaDirty ? 'true' : 'false'}
          onSubmit={(event) => {
            event.preventDefault();
            void action.run(
              () =>
                page
                  .updateTemplate({
                    name: meta.name.trim(),
                    description: meta.description.trim(),
                    usageContexts: meta.usageContexts,
                  })
                  .then(() => true),
              'Assembly details saved',
            );
          }}
        >
          <fieldset className="plain-fieldset full form-grid" disabled={!canManage}>
            <label className="full">
              Name
              <input
                required
                maxLength={160}
                value={meta.name}
                onChange={(event) => setMeta({ ...meta, name: event.target.value })}
              />
            </label>
            <fieldset className="full">
              <legend>Used for</legend>
              {USAGE_CONTEXTS.map((context) => (
                <label className="inline" key={context.value}>
                  <input
                    type="checkbox"
                    checked={meta.usageContexts.includes(context.value)}
                    onChange={(event) =>
                      setMeta({
                        ...meta,
                        usageContexts: event.target.checked
                          ? [...meta.usageContexts, context.value as UsageContext]
                          : meta.usageContexts.filter((v) => v !== context.value),
                      })
                    }
                  />
                  {context.label}
                </label>
              ))}
            </fieldset>
            <label className="full">
              Description
              <input
                maxLength={1000}
                value={meta.description}
                onChange={(event) => setMeta({ ...meta, description: event.target.value })}
              />
            </label>
          </fieldset>
          {canManage ? (
            <div className="full form-footer">
              <ActionFeedback
                error={action.error}
                status={action.status}
                conflict={action.conflict}
                onReload={() => void page.reload()}
              />
              <div className="actions">
                <button disabled={action.pending || !metaDirty || !meta.usageContexts.length}>
                  Save assembly details
                </button>
              </div>
            </div>
          ) : null}
        </form>
      </section>
      <section className="section" aria-labelledby="version-meta">
        <h2 id="version-meta">Version {page.state!.version.version}</h2>
        <fieldset className="plain-fieldset form-grid" disabled={!editable}>
          <label className="full">
            Source or basis of wording{editable ? ' (required for review)' : ''}
            <textarea
              maxLength={2000}
              value={draft.source}
              onChange={(event) => onDraft({ source: event.target.value })}
            />
          </label>
          <label>
            Effective date{editable ? ' (required for review)' : ''}
            <input
              type="date"
              value={draft.effectiveDate || ''}
              onChange={(event) => onDraft({ effectiveDate: event.target.value || null })}
            />
          </label>
        </fieldset>
      </section>
    </>
  );
}
