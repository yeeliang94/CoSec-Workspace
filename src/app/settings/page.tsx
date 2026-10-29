'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Capability, CatalogueVersion, Company, Preferences } from '@/domain/model';
import { ROLE_LABELS, roleOf } from '@/domain/model';
import { useWorkspace, PageHeader, request, formatDate } from '@/components/workspace';
import { ActionForm, canLeaveEditing } from '@/components/forms';
function Personal() {
  const { data, refresh } = useWorkspace();
  const [status, setStatus] = useState('');
  const [pending, setPending] = useState(false);
  const [draft, setDraft] = useState<Preferences | null>(null);
  const savedPreferences = data?.actor.preferences;
  useEffect(() => {
    if (!savedPreferences) return;
    const app = document.querySelector('.application');
    function apply(value: Preferences) {
      if (!app) return;
      app.classList.remove(
        'text-default',
        'text-large',
        'text-larger',
        'density-comfortable',
        'density-compact',
        'reduce-motion',
      );
      app.classList.add('text-' + value.textSize, 'density-' + value.density);
      if (value.reducedMotion) app.classList.add('reduce-motion');
    }
    apply(draft ?? savedPreferences);
    return () => apply(savedPreferences);
  }, [draft, savedPreferences]);
  if (!data) return null;
  const preferences = draft || data.actor.preferences;
  function preview(next: Preferences) {
    setDraft(next);
  }
  async function save(value: Preferences) {
    setPending(true);
    setStatus('');
    try {
      await request('/api/preferences', value);
      await refresh();
      setDraft(null);
      setStatus('Preferences saved');
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Preferences could not be saved');
    } finally {
      setPending(false);
    }
  }
  return (
    <section data-dirty={draft ? 'true' : 'false'}>
      <h2>Personal preferences</h2>
      <div className="form-grid">
        <label>
          Text size
          <select
            value={preferences.textSize}
            onChange={(e) =>
              preview({ ...preferences, textSize: e.target.value as Preferences['textSize'] })
            }
          >
            <option value="default">Default</option>
            <option value="large">Large</option>
            <option value="larger">Larger</option>
          </select>
        </label>
        <label>
          List density
          <select
            value={preferences.density}
            onChange={(e) =>
              preview({ ...preferences, density: e.target.value as Preferences['density'] })
            }
          >
            <option value="comfortable">Comfortable</option>
            <option value="compact">Compact</option>
          </select>
        </label>
        <label className="inline">
          <input
            type="checkbox"
            checked={preferences.reducedMotion}
            onChange={(e) => preview({ ...preferences, reducedMotion: e.target.checked })}
          />
          Reduce motion
        </label>
      </div>
      <div className="actions">
        <button disabled={pending} className="primary" onClick={() => void save(preferences)}>
          {pending ? 'Saving…' : 'Save preferences'}
        </button>
        <button
          disabled={pending}
          onClick={() => {
            const value: Preferences = {
              textSize: 'default',
              density: 'comfortable',
              reducedMotion: false,
            };
            preview(value);
            void save(value);
          }}
        >
          Reset preferences
        </button>
        <span role="status" className="metadata">
          {status}
        </span>
      </div>
    </section>
  );
}
function CataloguePreview({
  version,
  onClose,
}: {
  version: CatalogueVersion;
  onClose: () => void;
}) {
  const { data, refresh } = useWorkspace();
  const [preview, setPreview] = useState<{
    sampleHtml: string;
    affectedJobs: { id: string; title: string; companyId: string }[];
    effect: string;
  } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    fetch('/api/settings/preview?versionId=' + version.id, { cache: 'no-store' })
      .then(async (response) => {
        const value = await response.json();
        if (!response.ok) throw new Error(value.error || 'Preview unavailable');
        setPreview(value);
      })
      .catch((e) => setError(e.message));
  }, [version.id]);
  if (!data) return null;
  return (
    <div className="form-section">
      <div className="page-header">
        <h3>
          {version.name} · v{version.version}
        </h3>
        <button type="button" onClick={onClose}>
          Close preview
        </button>
      </div>
      <dl className="record-meta">
        <div>
          <dt>Source</dt>
          <dd>{version.source}</dd>
        </div>
        <div>
          <dt>Effective date</dt>
          <dd>{formatDate(version.effectiveDate)}</dd>
        </div>
      </dl>
      {error ? (
        <div className="feedback error" role="alert">
          {error}
        </div>
      ) : preview ? (
        <>
          <div className="warning">Illustrative preview · {preview.effect}</div>
          <div
            className="template-preview prose"
            dangerouslySetInnerHTML={{ __html: preview.sampleHtml }}
          />
          <details className="disclosure">
            <summary>Affected open work ({preview.affectedJobs.length})</summary>
            <div>
              <ul className="list-plain">
                {preview.affectedJobs.map((job) => (
                  <li key={job.id}>
                    <Link href={'/jobs/' + job.id}>{job.title}</Link>
                  </li>
                ))}
              </ul>
            </div>
          </details>
          {version.status === 'Draft' && data.actor.capabilities.includes('review_pack') ? (
            <ActionForm
              url="/api/settings"
              action="catalogue_publish"
              label={'Publish ' + version.name + ' v' + version.version}
              extra={{
                expectedRevision: data.settings.revision,
                versionId: version.id,
                confirmImpact: true,
              }}
              confirmation="Publish this exact catalogue version for future selection? Existing jobs retain their recorded versions. This requires independent internal review."
              onSuccess={() => void refresh()}
            />
          ) : null}
        </>
      ) : (
        <p className="muted" role="status">
          Loading preview…
        </p>
      )}
    </div>
  );
}
function Catalogues() {
  const { data } = useWorkspace();
  const [selected, setSelected] = useState<CatalogueVersion | null>(null);
  const [kind, setKind] = useState('template');
  const [predecessor, setPredecessor] = useState('');
  if (!data) return null;
  const previous = data.settings.catalogue.find((v) => v.id === predecessor);
  return (
    <section>
      <h2>Job templates, checklists and rules</h2>
      <div className="table-wrap">
        <table>
          <caption className="sr-only">Versioned internal catalogues</caption>
          <thead>
            <tr>
              <th>Name</th>
              <th>Kind</th>
              <th>Version</th>
              <th>Status</th>
              <th>Effective</th>
              <th>Review</th>
            </tr>
          </thead>
          <tbody>
            {data.settings.catalogue.map((version) => (
              <tr key={version.id}>
                <td>{version.name}</td>
                <td className="event-route">{version.kind}</td>
                <td>v{version.version}</td>
                <td>{version.status}</td>
                <td>{formatDate(version.effectiveDate)}</td>
                <td>
                  <button className="text-button" onClick={() => setSelected(version)}>
                    Preview and review
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!data.settings.catalogue.length ? (
        <p className="muted catalogue-empty">No catalogue versions</p>
      ) : null}
      {selected ? (
        <CataloguePreview
          version={data.settings.catalogue.find((v) => v.id === selected.id) || selected}
          onClose={() => setSelected(null)}
        />
      ) : null}
      <details className="disclosure">
        <summary>Create a draft version</summary>
        <div>
          <div className="form-grid" style={{ marginBottom: 16 }}>
            <label>
              Catalogue kind
              <select
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value);
                  setPredecessor('');
                }}
              >
                <option value="template">Internal template</option>
                <option value="checklist">Activity checklist</option>
                <option value="rule">Obligation rule</option>
              </select>
            </label>
            <label>
              Previous version
              <select value={predecessor} onChange={(e) => setPredecessor(e.target.value)}>
                <option value="">New catalogue entry</option>
                {data.settings.catalogue
                  .filter((v) => v.kind === kind)
                  .map((v) => (
                    <option value={v.id} key={v.id}>
                      {v.name} v{v.version}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          <ActionForm
            key={kind + predecessor}
            url="/api/settings"
            action="catalogue_draft"
            label="Save draft version"
            primary
            extra={{
              expectedRevision: data.settings.revision,
              kind,
              predecessorId: predecessor || null,
            }}
            fields={[
              { name: 'name', label: 'Name', required: true, value: previous?.name || '' },
              {
                name: 'effectiveDate',
                label: 'Effective date',
                type: 'date',
                value: previous?.effectiveDate || '',
              },
              {
                name: 'source',
                label: 'Source and version',
                type: 'textarea',
                required: true,
                value: previous?.source || '',
                full: true,
              },
              {
                name: 'content',
                label: 'Template or checklist content',
                type: 'rich',
                value: previous?.content || '',
                full: true,
              },
            ]}
          />
          <details className="disclosure">
            <summary>Template placeholders</summary>
            <div>
              <ul className="compact-list">
                {[
                  'company.name',
                  'company.registrationNumber',
                  'company.address',
                  'job.title',
                  'job.year',
                  'job.anniversaryDate',
                  'job.effectiveDate',
                  'firm.name',
                  'today',
                ].map((field) => (
                  <li key={field}>
                    <code>{'{{' + field + '}}'}</code>
                  </li>
                ))}
              </ul>
            </div>
          </details>
        </div>
      </details>
    </section>
  );
}
type AdminUser = {
  id: string;
  name: string;
  email: string;
  capabilities: Capability[];
  companyIds: string[];
  active: boolean;
  updatedAt: string;
};
function Users() {
  const { data } = useWorkspace();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  async function load() {
    try {
      const result = await request<{ users: AdminUser[]; companies: Company[] }>(
        '/api/users',
        undefined,
        'GET',
      );
      setUsers(result.users);
      setCompanies(result.companies);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Users unavailable');
    }
  }
  useEffect(() => {
    void load();
  }, []);
  if (!data) return null;
  return (
    <section>
      <div className="page-header">
        <h2>Users and company access</h2>
        <button
          onClick={() => {
            setSelected(null);
            setCreating(true);
          }}
        >
          Add user
        </button>
      </div>
      {error ? (
        <div className="feedback error" role="alert">
          {error}
        </div>
      ) : null}
      <div className="table-wrap">
        <table className="users-table">
          <caption className="sr-only">Internal staff accounts</caption>
          <thead>
            <tr>
              <th>Staff member</th>
              <th>Role</th>
              <th>Companies</th>
              <th>Status</th>
              <th>Access</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td>
                  {user.name}
                  <div className="metadata">{user.email}</div>
                </td>
                <td>{ROLE_LABELS[roleOf(user.capabilities)]}</td>
                <td>{user.companyIds.length}</td>
                <td>{user.active ? 'Active' : 'Inactive'}</td>
                <td>
                  <button
                    className="text-button"
                    onClick={() => {
                      setSelected(user);
                      setCreating(false);
                    }}
                  >
                    Edit access
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {selected || creating ? (
        <div className="form-section">
          <div className="page-header">
            <h3>{selected ? 'Edit ' + selected.name : 'New staff account'}</h3>
            <button
              onClick={() => {
                setSelected(null);
                setCreating(false);
              }}
            >
              Close form
            </button>
          </div>
          <form
            key={selected?.id || 'new'}
            onSubmit={async (event) => {
              event.preventDefault();
              setError('');
              setPending(true);
              const form = new FormData(event.currentTarget);
              const body: Record<string, unknown> = {
                action: selected ? 'update' : 'create',
                name: form.get('name'),
                role: form.get('role'),
                companyIds: form.getAll('companyIds'),
                requestId: crypto.randomUUID(),
              };
              if (selected) {
                body.id = selected.id;
                body.expectedUpdatedAt = selected.updatedAt;
                body.active = form.get('active') === 'on';
              } else body.email = form.get('email');
              if (form.get('password')) body.password = form.get('password');
              try {
                await request('/api/users', body);
                await load();
                setSelected(null);
                setCreating(false);
              } catch (e) {
                setError(e instanceof Error ? e.message : 'User could not be saved');
              } finally {
                setPending(false);
              }
            }}
          >
            <div className="form-grid">
              <label>
                Name
                <input name="name" defaultValue={selected?.name || ''} required />
              </label>
              {!selected ? (
                <label>
                  Email
                  <input name="email" type="email" required autoComplete="off" />
                </label>
              ) : (
                <label className="inline">
                  <input type="checkbox" name="active" defaultChecked={selected.active} />
                  Active account
                </label>
              )}
              <label className="full">
                {selected ? 'New password (optional)' : 'Initial password'}
                <input
                  name="password"
                  type="password"
                  required={!selected}
                  minLength={12}
                  autoComplete="new-password"
                />
              </label>
              <fieldset>
                <legend>Role</legend>
                <label className="inline">
                  <input
                    type="radio"
                    name="role"
                    value="user"
                    defaultChecked={!selected || roleOf(selected.capabilities) === 'user'}
                  />
                  User — prepares and reviews work
                </label>
                <label className="inline">
                  <input
                    type="radio"
                    name="role"
                    value="admin"
                    defaultChecked={selected ? roleOf(selected.capabilities) === 'admin' : false}
                  />
                  Admin — also manages users, settings and templates
                </label>
              </fieldset>
              <fieldset>
                <legend>Company access</legend>
                {companies.map((company) => (
                  <label className="inline" key={company.id}>
                    <input
                      type="checkbox"
                      name="companyIds"
                      value={company.id}
                      defaultChecked={selected?.companyIds.includes(company.id)}
                    />
                    {company.name}
                  </label>
                ))}
              </fieldset>
            </div>
            <div className="actions">
              <button className="primary" disabled={pending}>
                {pending ? 'Saving…' : 'Save account access'}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}
export default function Settings() {
  const { data } = useWorkspace();
  const [tab, setTab] = useState('Personal');
  if (!data) return null;
  const catalogue = data.actor.capabilities.includes('manage_catalogue');
  const admin = data.actor.capabilities.includes('manage_users');
  const tabs = [
    'Personal',
    ...(catalogue ? ['Work defaults', 'Catalogues'] : []),
    ...(admin ? ['Users'] : []),
  ];
  return (
    <>
      <PageHeader title="Settings">
        {data.actor.capabilities.includes('view_audit') ? (
          <Link className="button" href="/audit">
            Audit log
          </Link>
        ) : null}
      </PageHeader>
      <nav className="section-nav" aria-label="Settings sections">
        {tabs.map((item) => (
          <button
            key={item}
            className={tab === item ? 'active' : ''}
            aria-current={tab === item ? 'page' : undefined}
            onClick={async () => {
              if (await canLeaveEditing()) setTab(item);
            }}
          >
            {item}
          </button>
        ))}
      </nav>
      <div className="settings-sections">
        {tab === 'Personal' ? (
          <Personal />
        ) : tab === 'Work defaults' ? (
          <section>
            <h2>Firm and work defaults</h2>
            <ActionForm
              url="/api/settings"
              action="defaults"
              label="Save work defaults"
              primary
              extra={{ expectedRevision: data.settings.revision }}
              fields={[
                {
                  name: 'firmName',
                  label: 'Firm name',
                  value: data.settings.firmName,
                  required: true,
                  full: true,
                },
                {
                  name: 'preparationLeadDays',
                  label: 'Preparation lead days',
                  type: 'number',
                  value: data.settings.preparationLeadDays,
                  min: 0,
                  max: 365,
                  required: true,
                },
                {
                  name: 'chaseIntervalDays',
                  label: 'Client chase interval (days)',
                  type: 'number',
                  value: data.settings.chaseIntervalDays,
                  min: 1,
                  max: 90,
                  required: true,
                },
                {
                  name: 'defaultOwnerId',
                  label: 'Default assignment',
                  type: 'select',
                  value: data.settings.defaultOwnerId || '',
                  options: data.users.map((u) => ({ value: u.id, label: u.name })),
                  full: true,
                },
              ]}
            />
            <dl className="record-meta form-section">
              <div>
                <dt>Approval policy</dt>
                <dd>Independent review</dd>
              </div>
            </dl>
          </section>
        ) : tab === 'Catalogues' ? (
          <Catalogues />
        ) : (
          <Users />
        )}
      </div>
    </>
  );
}
