'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Capability, Company, Preferences } from '@/domain/model';
import { ROLE_LABELS, roleOf } from '@/domain/model';
import { useWorkspace, PageHeader, request } from '@/components/workspace';
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
        <button disabled={pending} onClick={() => void save(preferences)}>
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
              <th>Email</th>
              <th>Role</th>
              <th>Companies</th>
              <th>Status</th>
              <th>Access</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td>{user.name}</td>
                <td className="user-email">{user.email}</td>
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
              <button disabled={pending}>{pending ? 'Saving…' : 'Save account access'}</button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}
const tabParams: Record<string, string> = {
  Personal: 'personal',
  'Work defaults': 'work-defaults',
  Catalogues: 'catalogues',
  Users: 'users',
};
export default function Settings() {
  const { data } = useWorkspace();
  const [tab, setTab] = useState('Personal');
  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get('tab');
    const initial = Object.keys(tabParams).find((key) => tabParams[key] === param);
    if (initial) setTab(initial);
  }, []);
  if (!data) return null;
  const firm = data.actor.capabilities.includes('manage_catalogue');
  const admin = data.actor.capabilities.includes('manage_users');
  const tabs = ['Personal', ...(firm ? ['Firm'] : []), ...(admin ? ['Users'] : [])];
  const active = tabs.includes(tab) ? tab : 'Personal';
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
            className={active === item ? 'active' : ''}
            aria-current={active === item ? 'page' : undefined}
            onClick={async () => {
              if (item === active || !(await canLeaveEditing())) return;
              setTab(item);
              const url = new URL(window.location.href);
              if (item === 'Personal') url.searchParams.delete('tab');
              else url.searchParams.set('tab', tabParams[item]);
              window.history.replaceState(window.history.state, '', url.pathname + url.search);
            }}
          >
            {item}
          </button>
        ))}
      </nav>
      <div className="settings-sections">
        {active === 'Personal' ? (
          <Personal />
        ) : active === 'Firm' ? (
          <section>
            <h2>Firm</h2>
            <ActionForm
              url="/api/settings"
              action="defaults"
              label="Save firm details"
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
              ]}
            />
            <dl className="record-meta form-section">
              <div>
                <dt>Approval policy</dt>
                <dd>Independent review</dd>
              </div>
            </dl>
          </section>
        ) : (
          <Users />
        )}
      </div>
    </>
  );
}
