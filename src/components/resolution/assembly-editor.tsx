'use client';
import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import type {
  AssemblyVersion,
  BlockNode,
  FieldDefinition,
  InlineNode,
  PageLayout,
  SignatureSettings,
  UsageContext,
} from '@/domain/resolution/model';
import { Icon, useWorkspace } from '@/components/workspace';
import {
  TemplateEditor,
  type SelectionContext,
  type TemplateEditorHandle,
} from '@/components/template-editor/editor';
import { toTiptap, type ConvertIssue } from '@/components/template-editor/convert';
import { FieldInspector } from '@/components/template-editor/field-inspector';
import { latest, USAGE_CONTEXTS } from './api';
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

type Part = 'header' | 'closing';
type Draft = {
  header: BlockNode[];
  closing: BlockNode[];
  signature: SignatureSettings;
  starterClauseIds: string[];
  fields: FieldDefinition[];
  layout: PageLayout;
  source: string;
  effectiveDate: string | null;
};
const SECTIONS = [
  ['content', 'Content'],
  ['signatures', 'Signatures and layout'],
  ['starters', 'Starter clauses'],
  ['details', 'Details'],
  ['preview', 'Preview'],
  ['versions', 'Versions'],
] as const;
type Section = (typeof SECTIONS)[number][0];

/** Running header/footer text: plain text with {{field_id}} for a field. */
export function inlineToText(nodes: InlineNode[]) {
  return nodes
    .map((n) => (n.type === 'text' ? n.text : n.type === 'field' ? `{{${n.fieldId}}}` : ' '))
    .join('');
}
export function textToInline(text: string): InlineNode[] {
  const out: InlineNode[] = [];
  const pattern = /\{\{([a-z][a-z0-9_]{1,63})\}\}/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) out.push({ type: 'text', text: text.slice(last, match.index) });
    out.push({ type: 'field', fieldId: match[1] });
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push({ type: 'text', text: text.slice(last) });
  return out;
}

export function AssemblyEditor({ id }: { id: string }) {
  const page = useTemplateVersion('assembly', id);
  if (!page.state)
    return (
      <>
        <Link href="/templates#assemblies" className="back-link">
          <Icon kind="back" />
          Clause library
        </Link>
        <LoadState
          loading={page.loading}
          error={page.error}
          reload={() => void page.reload()}
          label="assembly"
        />
      </>
    );
  return <AssemblyWorkbench key={`${page.state.version.id}:${page.generation}`} page={page} />;
}

function AssemblyWorkbench({ page }: { page: ReturnType<typeof useTemplateVersion<'assembly'>> }) {
  const { data } = useWorkspace();
  const state = page.state!;
  const { template, version, outputTypes } = state;
  const editable =
    Boolean(data?.actor.capabilities.includes('manage_templates')) &&
    (version.status === 'Draft' || version.status === 'Returned');
  const [section, setSection] = useState<Section>('content');
  const [draft, setDraft] = useState<Draft>(() => ({
    header: structuredClone(version.header),
    closing: structuredClone(version.closing),
    signature: { ...version.signature },
    starterClauseIds: [...version.starterClauseIds],
    fields: structuredClone(version.fields),
    layout: structuredClone(version.layout),
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
  const [convertIssues, setConvertIssues] = useState<Record<Part, ConvertIssue[]>>(() => ({
    header: toTiptap(version.header, 'assembly').issues,
    closing: toTiptap(version.closing, 'assembly').issues,
  }));
  const [selection, setSelection] = useState<SelectionContext | null>(null);
  const [active, setActive] = useState<Part>('header');
  const headerRef = useRef<TemplateEditorHandle>(null);
  const closingRef = useRef<TemplateEditorHandle>(null);
  const activePart = useRef<Part>('header');
  activePart.current = active;
  // The inspector inserts into whichever canvas was used last.
  const activeRef = useMemo(
    () =>
      ({
        get current() {
          return activePart.current === 'header' ? headerRef.current : closingRef.current;
        },
      }) as React.RefObject<TemplateEditorHandle | null>,
    [],
  );
  const newQuestionRef = useRef<HTMLInputElement>(null);
  const settingsRef = useRef<HTMLElement>(null);
  const save = useAction();
  const [conflict, setConflict] = useState(false);
  const outputName =
    outputTypes.find((t) => t.id === template.outputTypeId)?.name || template.outputTypeId;

  const change = (patch: Partial<Draft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    markDirty();
    save.setStatus('');
  };
  const converter = (['header', 'closing'] as Part[]).flatMap((part) =>
    convertIssues[part].map((issue) => ({
      wording: part,
      name: part === 'header' ? 'Header' : 'Closing',
      issue,
    })),
  );
  const wordingRefs = [
    { key: 'header', name: 'Header', blocks: draft.header },
    { key: 'closing', name: 'Closing', blocks: draft.closing },
  ];
  const editorFor = (part: Part) => (
    <TemplateEditor
      handleRef={part === 'header' ? headerRef : closingRef}
      mode="assembly"
      label={part === 'header' ? 'Header wording' : 'Closing wording'}
      value={draft[part]}
      fields={draft.fields}
      readOnly={!editable}
      onChange={(blocks, issues) => {
        setDraft((current) => ({ ...current, [part]: blocks }));
        markDirty();
        save.setStatus('');
        setConvertIssues((current) => ({ ...current, [part]: issues }));
      }}
      onSelection={(context) => {
        activePart.current = part;
        setActive(part);
        setSelection(context);
      }}
      onRequestField={() => {
        activePart.current = part;
        setActive(part);
        newQuestionRef.current?.closest('details')?.setAttribute('open', '');
        newQuestionRef.current?.focus();
      }}
      onEditNode={() => {
        activePart.current = part;
        setActive(part);
        window.setTimeout(() => {
          settingsRef.current?.closest('details')?.setAttribute('open', '');
          settingsRef.current?.focus();
        }, 30);
      }}
    />
  );
  const previous = useMemo(
    () =>
      template.versions
        .filter(
          (v) =>
            (v.status === 'Published' || v.status === 'Superseded') && v.version < version.version,
        )
        .sort((a, b) => b.version - a.version)[0] ?? null,
    [template.versions, version.version],
  );

  async function doSave() {
    setConflict(false);
    const started = edits.current;
    const result = await save.run(
      () => page.saveDraft({ ...draft, effectiveDate: draft.effectiveDate || null }),
      'Draft saved',
    );
    if (result && edits.current === started) setDirty(false);
    else if (save.lastCode.current === 'STALE') setConflict(true);
  }

  const clauses = state.otherClauses.filter((c) => !c.archived);
  const clauseName = (cid: string) =>
    state.otherClauses.find((c) => c.id === cid)?.name || 'Unavailable clause';
  const [adding, setAdding] = useState('');
  const [starterStatus, setStarterStatus] = useState('');
  /**
   * Rows are keyed by clause id, so the pressed control stays mounted. Keep focus on it; when it
   * becomes disabled at the list edge, fall back to the opposite move button.
   */
  const moveStarter = (index: number, to: number, pressed?: HTMLButtonElement) => {
    if (to < 0 || to >= draft.starterClauseIds.length) return;
    const next = [...draft.starterClauseIds];
    const [item] = next.splice(index, 1);
    next.splice(to, 0, item);
    change({ starterClauseIds: next });
    setStarterStatus(`${clauseName(item)} moved to position ${to + 1} of ${next.length}.`);
    if (!pressed) return;
    window.setTimeout(() => {
      if (!pressed.disabled) return pressed.focus();
      const row = document.getElementById(`starter-${item}`);
      const fallback = [
        ...(row?.querySelectorAll<HTMLButtonElement>('.reorder-controls button') ?? []),
      ]
        .slice(0, 2)
        .find((button) => !button.disabled);
      (fallback ?? row)?.focus();
    }, 20);
  };

  return (
    <>
      <Link href="/templates#assemblies" className="back-link">
        <Icon kind="back" />
        Clause library
      </Link>
      <header className="record-heading">
        <p className="metadata">
          Assembly · {outputName}
          {template.archived ? ' · archived' : ''}
        </p>
        <h1>{template.name}</h1>
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
              wordings={[
                { name: 'Header', before: previous?.header, after: draft.header },
                { name: 'Closing', before: previous?.closing, after: draft.closing },
              ]}
            />
          }
          onChanged={page.reload}
          onNewVersion={(next) => page.selectVersion(next)}
        />
        <SaveBar
          dirty={dirty}
          pending={save.pending}
          readOnly={!editable}
          blocked={converter.length > 0}
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
              Your edits are still here.{' '}
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  if (window.confirm('Reload the latest version and discard your unsaved edits?'))
                    void page.reload();
                }}
              >
                Reload the latest version
              </button>
            </>
          ) : null}
        </div>
      ) : null}
      <IssueList
        issues={state.issues}
        converter={converter}
        onNavigate={(target) => {
          const part: Part | undefined =
            target.wording === 'closing' || /closing/i.test(target.location)
              ? 'closing'
              : target.wording === 'header' || /header/i.test(target.location)
                ? 'header'
                : undefined;
          if (part) {
            setSection('content');
            window.setTimeout(() => {
              const ref = part === 'header' ? headerRef : closingRef;
              if (target.block !== undefined) ref.current?.focusBlock(target.block);
              else ref.current?.focus();
            }, 60);
          } else if (/signature/i.test(target.location)) setSection('signatures');
          else if (/starter/i.test(target.location)) setSection('starters');
          else if (/source|effective/i.test(target.location)) setSection('details');
        }}
      />
      <nav className="section-nav" aria-label="Assembly sections">
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
        {section === 'content' ? (
          <div className="template-workbench">
            <div className="template-main">
              <h2 className="canvas-label">Header</h2>
              {editorFor('header')}
              <h2 className="canvas-label">Closing</h2>
              {editorFor('closing')}
              <p className="metadata">
                The clause slot marks where the preparer&apos;s clauses go. Signature blocks list
                the signers chosen for each role.
              </p>
            </div>
            <details className="inspector-disclosure" open>
              <summary>Shared questions and settings</summary>
              <p className="metadata inspector-note">
                Editing: {active === 'header' ? 'header' : 'closing'}. Fields here are asked once
                per resolution.
              </p>
              <FieldInspector
                fields={draft.fields}
                onFieldsChange={(fields) => change({ fields })}
                wordings={wordingRefs}
                selection={selection}
                editor={activeRef}
                readOnly={!editable}
                defaultScope="case"
                customDefinitions={state.definitions}
                newQuestionRef={newQuestionRef}
                settingsRef={settingsRef}
              />
            </details>
          </div>
        ) : section === 'signatures' ? (
          <fieldset className="plain-fieldset" disabled={!editable}>
            <section className="section" aria-labelledby="signature-settings">
              <h2 id="signature-settings">Signatures</h2>
              <p className="metadata">
                Add a signature block to the closing for each signer role. These settings apply to
                every block.
              </p>
              <div className="form-grid">
                <label>
                  Columns
                  <select
                    value={draft.signature.columns}
                    onChange={(event) =>
                      change({
                        signature: {
                          ...draft.signature,
                          columns: Number(event.target.value) as 1 | 2 | 3,
                        },
                      })
                    }
                  >
                    <option value={1}>1</option>
                    <option value={2}>2</option>
                    <option value={3}>3</option>
                  </select>
                </label>
                <label>
                  Label under each line
                  <input
                    value={draft.signature.label}
                    onChange={(event) =>
                      change({ signature: { ...draft.signature, label: event.target.value } })
                    }
                  />
                </label>
                <p className="metadata full">
                  Use {'{name}'} and {'{capacity}'} for the signer&apos;s name and capacity.
                </p>
                <label className="inline full">
                  <input
                    type="checkbox"
                    checked={draft.signature.showDate}
                    onChange={(event) =>
                      change({ signature: { ...draft.signature, showDate: event.target.checked } })
                    }
                  />
                  Show a date line under each signature
                </label>
              </div>
              <p className="metadata">
                Roles in use:{' '}
                {[...draft.header, ...draft.closing]
                  .filter((b) => b.type === 'signatureBlock')
                  .map((b) => (b.type === 'signatureBlock' ? b.role : ''))
                  .join(', ') || 'none — add a signature block in the content'}
              </p>
            </section>
            <section className="section" aria-labelledby="layout-settings">
              <h2 id="layout-settings">Page layout</h2>
              <div className="form-grid">
                <label>
                  Page size
                  <select
                    value={draft.layout.pageSize}
                    onChange={(event) =>
                      change({
                        layout: {
                          ...draft.layout,
                          pageSize: event.target.value as 'A4' | 'Letter',
                        },
                      })
                    }
                  >
                    <option>A4</option>
                    <option>Letter</option>
                  </select>
                </label>
                <label>
                  Font
                  <select
                    value={draft.layout.fontFamily}
                    onChange={(event) =>
                      change({
                        layout: {
                          ...draft.layout,
                          fontFamily: event.target.value as PageLayout['fontFamily'],
                        },
                      })
                    }
                  >
                    <option>Arial</option>
                    <option>Times New Roman</option>
                    <option>Calibri</option>
                  </select>
                </label>
                <label>
                  Font size (pt)
                  <input
                    type="number"
                    min={8}
                    max={16}
                    value={draft.layout.fontSizePt}
                    onChange={(event) =>
                      change({
                        layout: { ...draft.layout, fontSizePt: Number(event.target.value) || 11 },
                      })
                    }
                  />
                </label>
                <fieldset className="full margins">
                  <legend>Margins (mm)</legend>
                  {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
                    <label key={side}>
                      {side[0].toUpperCase() + side.slice(1)}
                      <input
                        type="number"
                        min={5}
                        max={60}
                        value={draft.layout.marginsMm[side]}
                        onChange={(event) =>
                          change({
                            layout: {
                              ...draft.layout,
                              marginsMm: {
                                ...draft.layout.marginsMm,
                                [side]: Number(event.target.value) || 5,
                              },
                            },
                          })
                        }
                      />
                    </label>
                  ))}
                </fieldset>
                <label className="full">
                  Running header
                  <input
                    value={inlineToText(draft.layout.header)}
                    onChange={(event) =>
                      change({
                        layout: { ...draft.layout, header: textToInline(event.target.value) },
                      })
                    }
                  />
                </label>
                <label className="full">
                  Running footer
                  <input
                    value={inlineToText(draft.layout.footer)}
                    onChange={(event) =>
                      change({
                        layout: { ...draft.layout, footer: textToInline(event.target.value) },
                      })
                    }
                  />
                </label>
                <p className="metadata full">
                  Insert a field with {'{{field_id}}'}, for example {'{{company_name}}'}.
                </p>
                <label className="inline full">
                  <input
                    type="checkbox"
                    checked={draft.layout.pageNumbers}
                    onChange={(event) =>
                      change({ layout: { ...draft.layout, pageNumbers: event.target.checked } })
                    }
                  />
                  Page numbers (&ldquo;Page X of Y&rdquo;)
                </label>
              </div>
            </section>
          </fieldset>
        ) : section === 'starters' ? (
          <section aria-labelledby="starters-title">
            <h2 id="starters-title">Starter clauses</h2>
            <p className="metadata">
              Added in this order when a preparer starts from this assembly. They can change the
              list in the case.
            </p>
            <p className="sr-only" role="status" aria-live="polite">
              {starterStatus}
            </p>
            {draft.starterClauseIds.length ? (
              <ol className="selected-clause-list starter-list">
                {draft.starterClauseIds.map((cid, index) => (
                  <li
                    key={cid}
                    id={`starter-${cid}`}
                    tabIndex={editable ? 0 : undefined}
                    aria-label={`${index + 1}. ${clauseName(cid)}${editable ? '. Alt plus arrow keys move it.' : ''}`}
                    onKeyDown={(event) => {
                      if (!editable || !event.altKey) return;
                      if (event.key === 'ArrowUp') {
                        event.preventDefault();
                        moveStarter(index, index - 1);
                      } else if (event.key === 'ArrowDown') {
                        event.preventDefault();
                        moveStarter(index, index + 1);
                      }
                    }}
                  >
                    <div className="selected-clause-row">
                      <span className="clause-index" aria-hidden="true">
                        {index + 1}
                      </span>
                      <div className="clause-meta">
                        <strong>{clauseName(cid)}</strong>
                        <div className="metadata">
                          {state.otherClauses.find((c) => c.id === cid)?.category}
                          {(() => {
                            const c = state.otherClauses.find((x) => x.id === cid);
                            const v = c && latest(c.versions);
                            return v ? ` · latest v${v.version} ${v.status.toLowerCase()}` : '';
                          })()}
                        </div>
                      </div>
                      {editable ? (
                        <div className="reorder-controls">
                          <button
                            type="button"
                            className="quiet"
                            aria-label={`Move ${clauseName(cid)} up`}
                            disabled={index === 0}
                            onClick={(event) => moveStarter(index, index - 1, event.currentTarget)}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            className="quiet"
                            aria-label={`Move ${clauseName(cid)} down`}
                            disabled={index === draft.starterClauseIds.length - 1}
                            onClick={(event) => moveStarter(index, index + 1, event.currentTarget)}
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            className="quiet danger"
                            aria-label={`Remove ${clauseName(cid)}`}
                            onClick={() =>
                              change({
                                starterClauseIds: draft.starterClauseIds.filter((x) => x !== cid),
                              })
                            }
                          >
                            Remove
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="metadata">No starter clauses.</p>
            )}
            {editable ? (
              <div className="toolbar add-starter">
                <label className="wide-select">
                  Add from library
                  <select value={adding} onChange={(event) => setAdding(event.target.value)}>
                    <option value="">Choose a clause…</option>
                    {clauses
                      .filter((c) => !draft.starterClauseIds.includes(c.id))
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.category} · {c.name}
                        </option>
                      ))}
                  </select>
                </label>
                <button
                  type="button"
                  disabled={!adding}
                  onClick={() => {
                    change({ starterClauseIds: [...draft.starterClauseIds, adding] });
                    setAdding('');
                  }}
                >
                  Add clause
                </button>
              </div>
            ) : null}
          </section>
        ) : section === 'details' ? (
          <AssemblyDetails page={page} draft={draft} editable={editable} onDraft={change} />
        ) : section === 'preview' ? (
          <SamplePreview
            kind="assembly"
            versionId={version.id}
            outputTypes={outputTypes.filter((t) => t.id === template.outputTypeId)}
            defaultOutputType={template.outputTypeId}
            draft={
              editable
                ? {
                    header: draft.header,
                    closing: draft.closing,
                    signature: draft.signature,
                    fields: draft.fields,
                    layout: draft.layout,
                    starterClauseIds: draft.starterClauseIds,
                  }
                : null
            }
            dirty={dirty}
          />
        ) : (
          <section aria-labelledby="versions-title">
            <h2 id="versions-title">Versions</h2>
            <VersionHistory
              versions={template.versions as AssemblyVersion[]}
              currentId={version.id}
              hrefFor={(vid) => `/templates/assemblies/${template.id}?version=${vid}`}
            />
          </section>
        )}
      </div>
    </>
  );
}

function AssemblyDetails({
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
        <h2 id="assembly-meta">Assembly details</h2>
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
        <h2 id="version-meta">This version</h2>
        <fieldset className="plain-fieldset form-grid" disabled={!editable}>
          <label className="full">
            Source or basis of wording
            <textarea
              maxLength={2000}
              value={draft.source}
              onChange={(event) => onDraft({ source: event.target.value })}
            />
          </label>
          <label>
            Effective date
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
