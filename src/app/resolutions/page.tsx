'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { CaseKind, ResolutionCase } from '@/domain/resolution/model';
import { routeMatches } from '@/domain/resolution/cases';
import { Empty, formatDate, Icon, PageHeader, useWorkspace } from '@/components/workspace';
import {
  CASE_KINDS,
  errorText,
  getJson,
  kindLabel,
  newRequestId,
  postJson,
} from '@/components/resolution/api';
import { LoadState, useLoad } from '@/components/resolution/use-load';
import { canLeaveEditing } from '@/components/edit-guard';

export default function ResolutionsPage() {
  const { data } = useWorkspace();
  const [query, setQuery] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [kind, setKind] = useState('');
  const [state, setState] = useState('Open');
  const [ownerId, setOwnerId] = useState('');
  const [creating, setCreating] = useState(false);
  const cases = useLoad(
    () =>
      getJson<{ cases: ResolutionCase[] }>(
        '/api/resolution-cases' + (companyId ? `?companyId=${encodeURIComponent(companyId)}` : ''),
      ),
    [companyId],
  );
  const rows = useMemo(() => {
    const term = query.trim().toLowerCase();
    return (cases.data?.cases ?? [])
      .filter(
        (item) =>
          (!kind || item.kind === kind) &&
          (!state || item.state === state) &&
          (!ownerId || item.ownerId === ownerId) &&
          (!term ||
            [item.title, data?.companies.find((c) => c.id === item.companyId)?.name]
              .join(' ')
              .toLowerCase()
              .includes(term)),
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [cases.data, query, kind, state, ownerId, data]);
  if (!data) return null;
  const caps = data.actor.capabilities;
  const canCreate = caps.includes('generate_documents') || caps.includes('prepare_job');
  const filtered = Boolean(query || kind || ownerId || companyId || state !== 'Open');
  const userName = (id: string) => data.users.find((user) => user.id === id)?.name || id;
  return (
    <>
      <PageHeader title="Resolutions">
        <div className="header-actions">
          <Link className="button" href="/templates">
            Clause library
          </Link>
          <details className="overflow-menu">
            <summary className="button">More</summary>
            <div className="overflow-menu-list">
              <Link href="/people">People and relationships</Link>
              {caps.includes('view_audit') ? <Link href="/audit">Audit log</Link> : null}
            </div>
          </details>
          {canCreate ? (
            <button
              type="button"
              className="primary"
              aria-expanded={creating}
              onClick={async () => {
                if (creating && !(await canLeaveEditing())) return;
                setCreating(!creating);
              }}
            >
              New resolution
            </button>
          ) : null}
        </div>
      </PageHeader>
      {creating ? (
        <NewResolution
          onCancel={async () => {
            if (await canLeaveEditing()) setCreating(false);
          }}
        />
      ) : null}
      <div className="toolbar">
        <label className="search">
          <span className="sr-only">Search resolutions</span>
          <Icon kind="search" />
          <input
            type="search"
            value={query}
            placeholder="Search resolutions"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label>
          <span className="sr-only">Company</span>
          <select value={companyId} onChange={(event) => setCompanyId(event.target.value)}>
            <option value="">All companies</option>
            {data.companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Kind</span>
          <select value={kind} onChange={(event) => setKind(event.target.value)}>
            <option value="">All kinds</option>
            {CASE_KINDS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">State</span>
          <select value={state} onChange={(event) => setState(event.target.value)}>
            <option value="">All states</option>
            <option>Open</option>
            <option>Complete</option>
            <option>Cancelled</option>
          </select>
        </label>
        <label>
          <span className="sr-only">Owner</span>
          <select value={ownerId} onChange={(event) => setOwnerId(event.target.value)}>
            <option value="">All owners</option>
            {data.users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </select>
        </label>
        {filtered ? (
          <button
            type="button"
            className="quiet"
            onClick={() => {
              setQuery('');
              setKind('');
              setOwnerId('');
              setCompanyId('');
              setState('Open');
            }}
          >
            Clear filters
          </button>
        ) : null}
      </div>
      <LoadState
        loading={cases.loading && !cases.data}
        error={cases.error}
        reload={() => void cases.reload()}
        label="resolutions"
      />
      {cases.data ? (
        rows.length ? (
          <div className="table-wrap">
            <table className="resolution-table stack-table">
              <caption className="sr-only">Resolution cases</caption>
              <thead>
                <tr>
                  <th>Resolution</th>
                  <th>Company</th>
                  <th>Next step</th>
                  <th>Owner</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((item) => {
                  const next = item.steps.find(
                    (step) => step.state !== 'Complete' && step.state !== 'Not applicable',
                  );
                  return (
                    <tr key={item.id}>
                      <td>
                        <Link href={'/resolutions/' + item.id}>{item.title}</Link>
                        <div className="state">
                          {kindLabel(item.kind)} · {item.state}
                        </div>
                      </td>
                      <td data-label="Company">
                        <Link href={'/companies/' + item.companyId}>
                          {data.companies.find((c) => c.id === item.companyId)?.name || 'Company'}
                        </Link>
                      </td>
                      <td data-label="Next">
                        {item.state !== 'Open' ? (
                          <span className="muted">{item.state}</span>
                        ) : next ? (
                          <>
                            {next.label}
                            <div className="state">
                              {next.state}
                              {next.dueDate ? ` · due ${formatDate(next.dueDate)}` : ''}
                            </div>
                          </>
                        ) : (
                          <span className="muted">All steps done</span>
                        )}
                      </td>
                      <td data-label="Owner">{userName(item.ownerId)}</td>
                      <td data-label="Updated" className="nowrap">
                        {formatDate(item.updatedAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : filtered ? (
          <Empty>
            No matching resolutions
            <div>
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setKind('');
                  setOwnerId('');
                  setCompanyId('');
                  setState('Open');
                }}
              >
                Clear filters
              </button>
            </div>
          </Empty>
        ) : (
          <Empty>
            No resolutions yet
            {canCreate ? (
              <div>
                <button type="button" className="primary" onClick={() => setCreating(true)}>
                  New resolution
                </button>
              </div>
            ) : null}
          </Empty>
        )
      ) : null}
    </>
  );
}

function NewResolution({ onCancel }: { onCancel: () => void }) {
  const { data } = useWorkspace();
  const router = useRouter();
  const [companyId, setCompanyId] = useState('');
  const [kind, setKind] = useState<CaseKind>('board');
  const [title, setTitle] = useState('');
  const [jobId, setJobId] = useState('');
  const [instructionDate, setInstructionDate] = useState('');
  const [resolutionDate, setResolutionDate] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [requestId, setRequestId] = useState(newRequestId);
  if (!data) return null;
  const jobs = data.jobs.filter(
    (job) =>
      job.activity === 'W04' &&
      job.state !== 'Cancelled' &&
      job.companyId === companyId &&
      routeMatches(kind, job.route),
  );
  const director = kind !== 'board';
  const job = jobs.find((item) => item.id === jobId);
  return (
    <section className="new-resolution" aria-labelledby="new-resolution-title">
      <h2 id="new-resolution-title">New resolution</h2>
      <form
        className="form-grid"
        data-dirty={
          companyId ||
          title ||
          kind !== 'board' ||
          jobId ||
          instructionDate ||
          resolutionDate ||
          effectiveDate
            ? 'true'
            : 'false'
        }
        inert={pending}
        aria-busy={pending}
        onChange={() => setRequestId(newRequestId())}
        onSubmit={async (event) => {
          event.preventDefault();
          const formElement = event.currentTarget;
          setPending(true);
          setError('');
          try {
            const created = await postJson<ResolutionCase>('/api/resolution-cases', {
              requestId,
              companyId,
              kind,
              title: title.trim(),
              // Only a job still offered for this company and kind may be linked.
              jobId: director && job ? job.id : null,
              personId: director && job?.personId ? job.personId : null,
              instructionDate: instructionDate || null,
              resolutionDate: resolutionDate || null,
              effectiveDate: effectiveDate || (director && job?.effectiveDate) || null,
            });
            formElement.setAttribute('data-dirty', 'false');
            router.push('/resolutions/' + created.id);
          } catch (e) {
            setError(errorText(e));
            setPending(false);
          }
        }}
      >
        <label>
          Company
          <select
            required
            value={companyId}
            onChange={(event) => {
              setCompanyId(event.target.value);
              setJobId('');
            }}
          >
            <option value="">Select…</option>
            {data.companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Kind
          <select
            value={kind}
            onChange={(event) => {
              setKind(event.target.value as CaseKind);
              setJobId('');
            }}
          >
            {CASE_KINDS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="full">
          Title
          <input
            required
            maxLength={300}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        {director ? (
          <label className="full">
            Linked director change (W04)
            <select value={jobId} onChange={(event) => setJobId(event.target.value)}>
              <option value="">{companyId ? 'Not linked' : 'Choose a company first'}</option>
              {jobs.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                  {item.personName ? ` · ${item.personName}` : ''}
                  {item.effectiveDate ? ` · ${formatDate(item.effectiveDate)}` : ''}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label>
          Instruction date
          <input
            type="date"
            value={instructionDate}
            onChange={(event) => setInstructionDate(event.target.value)}
          />
        </label>
        <label>
          Resolution date
          <input
            type="date"
            value={resolutionDate}
            onChange={(event) => setResolutionDate(event.target.value)}
          />
        </label>
        <label>
          Effective date
          <input
            type="date"
            value={effectiveDate}
            onChange={(event) => setEffectiveDate(event.target.value)}
          />
        </label>
        <div className="full form-footer">
          {error ? (
            <div className="feedback error" role="alert">
              {error}
            </div>
          ) : null}
          <div className="actions">
            <button className="primary" disabled={pending}>
              {pending ? 'Creating…' : 'Create resolution'}
            </button>
            <button type="button" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}
