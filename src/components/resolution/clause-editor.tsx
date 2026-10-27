'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  CLAUSE_CATEGORIES,
  type BlockNode,
  type ClauseCategory,
  type ClauseVersion,
  type FieldDefinition,
  type UsageContext,
} from '@/domain/resolution/model';
import { Icon, useWorkspace } from '@/components/workspace';
import {
  TemplateEditor,
  type SelectionContext,
  type TemplateEditorHandle,
} from '@/components/template-editor/editor';
import { toTiptap, type ConvertIssue } from '@/components/template-editor/convert';
import { FieldInspector } from '@/components/template-editor/field-inspector';
import { ApiError, errorText, latest, USAGE_CONTEXTS, type ClauseWithVersions } from './api';
import { VersionHistory, VersionLifecycle } from './lifecycle';
import {
  DiffSummary,
  IssueList,
  SamplePreview,
  SaveBar,
  useTemplateVersion,
} from './template-page';
import { LoadState } from './use-load';
import { ActionFeedback, useAction } from './use-action';
import { confirmAction } from '@/components/edit-guard';

type Draft = {
  wordings: Record<string, BlockNode[]>;
  fields: FieldDefinition[];
  source: string;
  effectiveDate: string | null;
};
const SECTIONS = [
  ['wording', 'Wording'],
  ['details', 'Details'],
  ['preview', 'Preview'],
  ['versions', 'Versions'],
] as const;
type Section = (typeof SECTIONS)[number][0];

export function ClauseEditor({ id }: { id: string }) {
  const page = useTemplateVersion('clause', id);
  if (!page.state)
    return (
      <>
        <Link href="/templates" className="back-link">
          <Icon kind="back" />
          Clause library
        </Link>
        <LoadState
          loading={page.loading}
          error={page.error}
          reload={() => void page.reload()}
          label="clause"
        />
      </>
    );
  return <ClauseWorkbench key={`${page.state.version.id}:${page.generation}`} page={page} />;
}

function ClauseWorkbench({ page }: { page: ReturnType<typeof useTemplateVersion<'clause'>> }) {
  const { data } = useWorkspace();
  const state = page.state!;
  const { template, version, outputTypes } = state;
  const caps = data?.actor.capabilities ?? [];
  const editable =
    caps.includes('manage_templates') &&
    (version.status === 'Draft' || version.status === 'Returned');
  const [section, setSection] = useState<Section>('wording');
  const [draft, setDraft] = useState<Draft>(() => ({
    wordings: structuredClone(version.wordings),
    fields: structuredClone(version.fields),
    source: version.source,
    effectiveDate: version.effectiveDate,
  }));
  const [dirty, setDirty] = useState(false);
  // Counts edits so a save only clears `dirty` when nothing changed while it was in flight.
  const edits = useRef(0);
  const markDirty = () => {
    edits.current += 1;
    setDirty(true);
  };
  const typeList = useMemo(() => {
    const ids = new Set([
      ...outputTypes.filter((t) => t.active).map((t) => t.id),
      ...Object.keys(draft.wordings),
    ]);
    return outputTypes
      .filter((t) => ids.has(t.id))
      .concat(
        [...ids]
          .filter((id) => !outputTypes.some((t) => t.id === id))
          .map((id) => ({ id, name: id, body: 'directors' as const, active: false, order: 999 })),
      );
  }, [outputTypes, draft.wordings]);
  const [tab, setTab] = useState(
    () => typeList.find((t) => draft.wordings[t.id]?.length)?.id || typeList[0]?.id || '',
  );
  const [remount, setRemount] = useState(0);
  const [convertIssues, setConvertIssues] = useState<Record<string, ConvertIssue[]>>(() =>
    Object.fromEntries(
      Object.entries(version.wordings).map(([key, blocks]) => [key, toTiptap(blocks).issues]),
    ),
  );
  const [selection, setSelection] = useState<SelectionContext | null>(null);
  const editorRef = useRef<TemplateEditorHandle>(null);
  const newQuestionRef = useRef<HTMLInputElement>(null);
  const settingsRef = useRef<HTMLElement>(null);
  const [pendingFocus, setPendingFocus] = useState<number | null>(null);
  const save = useAction();
  const [conflict, setConflict] = useState(false);
  const [copyFrom, setCopyFrom] = useState('');

  useEffect(() => {
    if (pendingFocus === null) return;
    const timer = window.setTimeout(() => {
      editorRef.current?.focusBlock(pendingFocus);
      setPendingFocus(null);
    }, 50);
    return () => window.clearTimeout(timer);
  }, [pendingFocus, tab, remount]);

  const typeName = (key: string) => typeList.find((t) => t.id === key)?.name || key;
  const wordingRefs = Object.entries(draft.wordings).map(([key, blocks]) => ({
    key,
    name: typeName(key),
    blocks,
  }));
  const converter = Object.entries(convertIssues).flatMap(([wording, issues]) =>
    issues.map((issue) => ({ wording, name: typeName(wording), issue })),
  );
  const change = (patch: Partial<Draft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    markDirty();
    save.setStatus('');
  };
  const reusable = useMemo(() => {
    const seen = new Set<string>();
    return (state.otherClauses as ClauseWithVersions[])
      .filter((c) => c.id !== template.id && !c.archived)
      .flatMap((c) => {
        const v = latest(c.versions);
        return (v?.fields ?? [])
          .filter((f) => f.scope === 'case' && !seen.has(f.id) && seen.add(f.id))
          .map((f) => ({ ...f, from: c.name }));
      });
  }, [state.otherClauses, template.id]);

  async function doSave() {
    setConflict(false);
    const started = edits.current;
    const result = await save.run(
      () =>
        page.saveDraft({
          wordings: Object.fromEntries(
            Object.entries(draft.wordings).filter(([, blocks]) => blocks.length),
          ),
          fields: draft.fields,
          source: draft.source,
          effectiveDate: draft.effectiveDate || null,
        }),
      'Draft saved',
    );
    if (result && edits.current === started) setDirty(false);
    else if (save.lastCode.current === 'STALE') setConflict(true);
  }

  function navigate(target: { wording?: string; block?: number; location: string }) {
    let wording = target.wording;
    if (!wording) {
      const named = /wording "([^"]+)"/.exec(target.location)?.[1];
      wording = typeList.find((t) => t.name === named || t.id === named)?.id;
    }
    setSection('wording');
    if (wording && wording !== tab) setTab(wording);
    if (target.block !== undefined) setPendingFocus(target.block);
    else if (/field|source|effective/.test(target.location)) setSection('details');
  }

  const previous = useMemo(() => {
    const published = template.versions
      .filter((v) => v.status === 'Published' || v.status === 'Superseded')
      .filter((v) => v.id !== version.id && v.version < version.version)
      .sort((a, b) => b.version - a.version)[0];
    return published ?? null;
  }, [template.versions, version]);

  const blocked = converter.length > 0;
  return (
    <>
      <Link href="/templates" className="back-link">
        <Icon kind="back" />
        Clause library
      </Link>
      <header className="record-heading">
        <h1>{template.name}</h1>
        {template.hidden || template.archived ? (
          <dl className="record-meta">
            <div>
              <dt>Availability</dt>
              <dd>{template.archived ? 'Archived' : 'Hidden from new resolutions'}</dd>
            </div>
          </dl>
        ) : null}
      </header>
      <div className="template-status">
        <VersionLifecycle
          version={version}
          url={page.versionUrl(version.id)}
          dirty={dirty}
          diff={
            <DiffSummary
              previous={previous}
              current={draft}
              serverChanges={state.changes}
              wordings={typeList.map((t) => ({
                name: t.name,
                before: previous?.wordings[t.id]?.length ? previous.wordings[t.id] : undefined,
                after: draft.wordings[t.id]?.length ? draft.wordings[t.id] : undefined,
              }))}
            />
          }
          onChanged={page.reload}
          onNewVersion={(next) => {
            page.selectVersion(next);
          }}
        />
        <SaveBar
          dirty={dirty}
          pending={save.pending}
          readOnly={!editable}
          blocked={blocked}
          status={save.status}
          onSave={() => void doSave()}
        />
      </div>
      {save.error ? (
        <div className="feedback error" role="alert">
          {save.error}
          {conflict ? (
            <>
              {' '}
              Your edits are still here. Copy anything you need, then{' '}
              <button
                type="button"
                className="text-button"
                onClick={async () => {
                  if (
                    await confirmAction({
                      message: 'Reload the latest version and discard your unsaved edits?',
                      confirmLabel: 'Reload latest version',
                    })
                  )
                    void page.reload();
                }}
              >
                reload the latest version
              </button>
              .
            </>
          ) : null}
        </div>
      ) : null}
      <IssueList issues={state.issues} converter={converter} onNavigate={navigate} />
      <nav className="section-nav" aria-label="Clause sections">
        {SECTIONS.map(([key, label]) => (
          <button
            type="button"
            key={key}
            className={section === key ? 'active' : ''}
            aria-current={section === key ? 'page' : undefined}
            onClick={() => setSection(key)}
          >
            {label}
          </button>
        ))}
      </nav>
      <div data-dirty={dirty ? 'true' : 'false'}>
        {section === 'wording' ? (
          <section aria-label="Wording">
            <div className="wording-tabs" role="tablist" aria-label="Wording per output type">
              {typeList.map((type) => (
                <button
                  type="button"
                  role="tab"
                  key={type.id}
                  id={'wording-tab-' + type.id}
                  aria-selected={tab === type.id}
                  aria-controls="wording-panel"
                  tabIndex={tab === type.id ? 0 : -1}
                  className={tab === type.id ? 'active' : ''}
                  onKeyDown={(event) => {
                    const index = typeList.findIndex((item) => item.id === type.id);
                    const nextIndex =
                      event.key === 'ArrowRight'
                        ? (index + 1) % typeList.length
                        : event.key === 'ArrowLeft'
                          ? (index - 1 + typeList.length) % typeList.length
                          : event.key === 'Home'
                            ? 0
                            : event.key === 'End'
                              ? typeList.length - 1
                              : null;
                    if (nextIndex === null) return;
                    event.preventDefault();
                    const next = typeList[nextIndex];
                    setTab(next.id);
                    setSelection(null);
                    document.getElementById('wording-tab-' + next.id)?.focus();
                  }}
                  onClick={() => {
                    setTab(type.id);
                    setSelection(null);
                  }}
                >
                  {type.name}
                  {!draft.wordings[type.id]?.length ? (
                    <span className="metadata"> · no wording</span>
                  ) : null}
                </button>
              ))}
            </div>
            <div
              id="wording-panel"
              role="tabpanel"
              aria-labelledby={'wording-tab-' + tab}
              className="wording-panel"
            >
              {editable ? (
                <div className="wording-actions">
                  <label>
                    <span className="sr-only">Copy wording from</span>
                    <select value={copyFrom} onChange={(event) => setCopyFrom(event.target.value)}>
                      <option value="">Copy wording from…</option>
                      {typeList
                        .filter((t) => t.id !== tab && draft.wordings[t.id]?.length)
                        .map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    disabled={!copyFrom}
                    onClick={async () => {
                      if (
                        draft.wordings[tab]?.length &&
                        !(await confirmAction({
                          message: `Replace the ${typeName(tab)} wording?`,
                          confirmLabel: 'Replace wording',
                        }))
                      )
                        return;
                      change({
                        wordings: {
                          ...draft.wordings,
                          [tab]: structuredClone(draft.wordings[copyFrom]),
                        },
                      });
                      setConvertIssues((current) => ({
                        ...current,
                        [tab]: current[copyFrom] ?? [],
                      }));
                      setCopyFrom('');
                      setRemount((n) => n + 1);
                    }}
                  >
                    Copy
                  </button>
                  {draft.wordings[tab]?.length ? (
                    <button
                      type="button"
                      className="quiet danger"
                      onClick={async () => {
                        if (
                          !(await confirmAction({
                            message: `Remove the ${typeName(tab)} wording? This clause will not be offered for that output type.`,
                            confirmLabel: 'Remove wording',
                          }))
                        )
                          return;
                        const next = { ...draft.wordings };
                        delete next[tab];
                        change({ wordings: next });
                        setConvertIssues((current) => ({ ...current, [tab]: [] }));
                        setRemount((n) => n + 1);
                      }}
                    >
                      Remove this wording
                    </button>
                  ) : null}
                </div>
              ) : null}
              <div className="template-workbench">
                <div className="template-main">
                  {tab ? (
                    <TemplateEditor
                      key={`${tab}:${remount}`}
                      handleRef={editorRef}
                      mode="clause"
                      label={`${typeName(tab)} wording`}
                      value={draft.wordings[tab] ?? []}
                      fields={draft.fields}
                      readOnly={!editable}
                      onChange={(blocks, issues) => {
                        setDraft((current) => ({
                          ...current,
                          wordings: { ...current.wordings, [tab]: blocks },
                        }));
                        markDirty();
                        save.setStatus('');
                        setConvertIssues((current) => ({ ...current, [tab]: issues }));
                      }}
                      onSelection={setSelection}
                      onRequestField={() => {
                        newQuestionRef.current?.closest('details')?.setAttribute('open', '');
                        newQuestionRef.current?.focus();
                      }}
                      onEditNode={() =>
                        window.setTimeout(() => {
                          settingsRef.current?.closest('details')?.setAttribute('open', '');
                          settingsRef.current?.focus();
                        }, 30)
                      }
                    />
                  ) : (
                    <p className="metadata">Add an output type first.</p>
                  )}
                </div>
                <details className="inspector-disclosure" open>
                  <summary>Fields and settings</summary>
                  <FieldInspector
                    fields={draft.fields}
                    onFieldsChange={(fields) => change({ fields })}
                    wordings={wordingRefs}
                    selection={selection}
                    editor={editorRef}
                    readOnly={!editable}
                    defaultScope="clause"
                    reusable={reusable}
                    customDefinitions={state.definitions}
                    newQuestionRef={newQuestionRef}
                    settingsRef={settingsRef}
                  />
                </details>
              </div>
            </div>
          </section>
        ) : section === 'details' ? null : section === 'preview' ? (
          <SamplePreview
            kind="clause"
            versionId={version.id}
            outputTypes={typeList.filter((t) => draft.wordings[t.id]?.length)}
            defaultOutputType={tab}
            draft={editable ? { wordings: draft.wordings, fields: draft.fields } : null}
            dirty={dirty}
          />
        ) : (
          <section aria-labelledby="versions-title">
            <h2 id="versions-title" className="sr-only">
              Versions
            </h2>
            <VersionHistory
              versions={template.versions as ClauseVersion[]}
              currentId={version.id}
              hrefFor={(vid) => `/templates/clauses/${template.id}?version=${vid}`}
            />
          </section>
        )}
        {/* Kept mounted so unsaved template details survive a section switch. */}
        <div hidden={section !== 'details'}>
          <ClauseDetails page={page} draft={draft} editable={editable} onDraft={change} />
        </div>
      </div>
    </>
  );
}

function ClauseDetails({
  page,
  draft,
  editable,
  onDraft,
}: {
  page: ReturnType<typeof useTemplateVersion<'clause'>>;
  draft: Draft;
  editable: boolean;
  onDraft: (patch: Partial<Draft>) => void;
}) {
  const { data } = useWorkspace();
  const template = page.state!.template;
  const canManage = Boolean(data?.actor.capabilities.includes('manage_templates'));
  const [meta, setMeta] = useState({
    name: template.name,
    category: template.category,
    governingAct: template.governingAct,
    usageContexts: template.usageContexts,
    displayOrder: String(template.displayOrder),
    description: template.description,
  });
  const action = useAction();
  const metaDirty =
    meta.name !== template.name ||
    meta.category !== template.category ||
    meta.governingAct !== template.governingAct ||
    meta.usageContexts.join() !== template.usageContexts.join() ||
    meta.displayOrder !== String(template.displayOrder) ||
    meta.description !== template.description;
  return (
    <>
      <section className="section" aria-labelledby="clause-meta">
        <h2 id="clause-meta" className="sr-only">
          Clause details
        </h2>
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
                    category: meta.category,
                    governingAct: meta.governingAct.trim(),
                    usageContexts: meta.usageContexts,
                    displayOrder: Number(meta.displayOrder) || 0,
                    description: meta.description.trim(),
                  })
                  .then(() => true)
                  .catch((e) => {
                    throw e instanceof ApiError ? e : new Error(errorText(e));
                  }),
              'Clause details saved',
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
            <label>
              Category
              <select
                value={meta.category}
                onChange={(event) =>
                  setMeta({ ...meta, category: event.target.value as ClauseCategory })
                }
              >
                {CLAUSE_CATEGORIES.map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>
            </label>
            <label>
              Governing Act
              <input
                maxLength={160}
                value={meta.governingAct}
                onChange={(event) => setMeta({ ...meta, governingAct: event.target.value })}
              />
            </label>
            <label>
              Display order
              <input
                type="number"
                min={0}
                value={meta.displayOrder}
                onChange={(event) => setMeta({ ...meta, displayOrder: event.target.value })}
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
                  Save clause details
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
