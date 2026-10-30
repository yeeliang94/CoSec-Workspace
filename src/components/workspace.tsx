'use client';
import { createContext, useCallback, useContext, useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { canLeaveEditing, installEditGuards } from './edit-guard';
import type { Workspace } from '@/domain/model';

type Context = {
  data: Workspace | null;
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
  workHref: string;
  rememberWork: (focusId: string) => void;
  restoreWork: () => void;
};
const WorkspaceContext = createContext<Context>({
  data: null,
  loading: true,
  error: '',
  refresh: async () => {},
  workHref: '/work',
  rememberWork: () => {},
  restoreWork: () => {},
});
export function useWorkspace() {
  return useContext(WorkspaceContext);
}
export async function request<T = unknown>(
  url: string,
  body?: unknown,
  method = 'POST',
): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    cache: 'no-store',
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error('The server did not respond. Try again.');
  }
  if (!response.ok)
    throw new Error(
      result.error?.message || result.error || result.message || 'The change could not be saved.',
    );
  return result as T;
}
const navigation = [
  ['/work', 'My work', 'work'],
  ['/companies', 'Companies', 'company'],
  ['/people', 'People', 'people'],
  ['/reviews', 'Reviews', 'review'],
  ['/calendar', 'Calendar', 'calendar'],
  ['/documents', 'Documents', 'document'],
  ['/resolutions', 'Resolutions', 'resolution'],
  ['/billing', 'Billing', 'billing'],
] as const;
export function Icon({ kind }: { kind: string }) {
  const paths: Record<string, React.ReactNode> = {
    work: (
      <>
        <rect x="3" y="5" width="18" height="15" rx="1" />
        <path d="M8 5V3h8v2M3 10h18M9 10v3h6v-3" />
      </>
    ),
    company: (
      <>
        <path d="M4 21V5l8-2v18M12 8h8v13M2 21h20M7 8h2M7 12h2M7 16h2M15 12h2M15 16h2" />
      </>
    ),
    review: (
      <>
        <rect x="5" y="4" width="14" height="17" rx="1" />
        <path d="M9 4V2h6v2M8 13l3 3 5-6" />
      </>
    ),
    calendar: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="1" />
        <path d="M7 3v5M17 3v5M3 10h18M7 14h3M14 14h3M7 18h3" />
      </>
    ),
    document: (
      <>
        <path d="M5 2h9l5 5v15H5zM14 2v6h5M8 12h8M8 16h8" />
      </>
    ),
    billing: (
      <>
        <rect x="3" y="5" width="18" height="15" rx="1" />
        <path d="M3 10h18M6 15h5M16 15h2" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="m9 3 1-1h4l1 3 3 1 3 3-1 3 1 3-3 3-3 1-1 3h-4l-1-3-3-1-3-3 1-3-1-3 3-3 3-1z" />
      </>
    ),
    resolution: (
      <>
        <path d="M6 2h12v20H6zM9 7h6M9 11h6M9 15h3M13 18l1.5 1.5L18 16" />
      </>
    ),
    people: (
      <>
        <circle cx="9" cy="8" r="3.5" />
        <path d="M2.5 20c.5-3.6 3.1-6 6.5-6s6 2.4 6.5 6M16 4.8a3.5 3.5 0 0 1 0 6.4M18.5 14.5c1.7.9 2.8 2.9 3 5.5" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    back: <path d="m14 5-7 7 7 7M7 12h14" />,
    search: (
      <>
        <circle cx="10" cy="10" r="6" />
        <path d="m15 15 6 6" />
      </>
    ),
  };
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[kind] || paths.document}
    </svg>
  );
}
const APP_NAME = 'CoSec Workspace';
const pageTitles: [RegExp, string][] = [
  [/^\/work(\/|$)/, 'My work'],
  [/^\/companies\/?$/, 'Companies'],
  [/^\/companies\//, 'Company'],
  [/^\/people(\/|$)/, 'People'],
  [/^\/reviews(\/|$)/, 'Reviews'],
  [/^\/calendar(\/|$)/, 'Calendar'],
  [/^\/documents(\/|$)/, 'Documents'],
  [/^\/resolutions\/?$/, 'Resolutions'],
  [/^\/resolutions\//, 'Resolution'],
  [/^\/jobs\//, 'Job'],
  [/^\/templates\/?$/, 'Templates'],
  [/^\/templates\//, 'Templates'],
  [/^\/billing(\/|$)/, 'Billing'],
  [/^\/settings(\/|$)/, 'Settings'],
  [/^\/audit(\/|$)/, 'Audit log'],
  [/^\/login(\/|$)/, 'Sign in'],
];
/** Page name for a pathname, used for the document title. */
export function pageTitleFor(pathname: string) {
  return pageTitles.find(([pattern]) => pattern.test(pathname))?.[1] || '';
}
function composeTitle(title: string) {
  return title ? `${title} – ${APP_NAME}` : APP_NAME;
}
const TitleOverrideContext = createContext<(title: string | null) => void>(() => {});
/**
 * Overrides the document title for the current page, for example with a record name.
 * Pass an empty value while the record loads to keep the section title.
 */
export function useDocumentTitle(title: string | null | undefined) {
  const setOverride = useContext(TitleOverrideContext);
  useEffect(() => {
    if (!title) return;
    setOverride(title);
    return () => setOverride(null);
  }, [title, setOverride]);
}
export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const pathname = usePathname();
  const navigationPath = /^\/templates(\/|$)/.test(pathname)
    ? '/resolutions'
    : /^\/audit(\/|$)/.test(pathname)
      ? '/settings'
      : pathname;
  const router = useRouter();
  const login = pathname === '/login';
  useEffect(installEditGuards, []);
  const [titleOverride, setTitleOverride] = useState<string | null>(null);

  const workMemory = useRef({ href: '/work', scrollY: 0, focusId: '' });
  const restorePending = useRef(false);
  const [workHref, setWorkHref] = useState('/work');
  function rememberWork(focusId: string) {
    if (!['/work', '/reviews'].includes(window.location.pathname)) return;
    const href = window.location.pathname + window.location.search;
    workMemory.current = { href, scrollY: window.scrollY, focusId };
    setWorkHref(href);
  }
  function restoreWork() {
    restorePending.current = true;
  }
  useEffect(() => {
    if (!restorePending.current || !data || pathname !== workMemory.current.href.split('?')[0])
      return;
    restorePending.current = false;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        window.scrollTo(0, workMemory.current.scrollY);
        document.getElementById(workMemory.current.focusId)?.focus({ preventScroll: true });
      }),
    );
  }, [pathname, data]);
  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/workspace', { cache: 'no-store' });
      if (response.status === 401) {
        setData(null);
        router.replace('/login');
        return;
      }
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || 'Workspace unavailable');
      setData(value);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Workspace unavailable');
    } finally {
      setLoading(false);
    }
  }, [router]);
  useEffect(() => {
    if (!login) {
      void refresh();
    } else setLoading(false);
  }, [login, refresh]);
  const prefs = data?.actor.preferences;
  return (
    <WorkspaceContext.Provider
      value={{ data, loading, error, refresh, workHref, rememberWork, restoreWork }}
    >
      <TitleOverrideContext.Provider value={setTitleOverride}>
        <title>{composeTitle(titleOverride || pageTitleFor(pathname))}</title>
        <div
          className={`application text-${prefs?.textSize || 'default'} density-${prefs?.density || 'comfortable'} ${prefs?.reducedMotion ? 'reduce-motion' : ''}`}
        >
          {login ? (
            children
          ) : (
            <>
              <a href="#main" className="skip-link">
                Skip to content
              </a>
              <aside className="sidebar">
                <Link href="/work" className="brand">
                  CoSec<span>Workspace</span>
                </Link>
                <div className="nav-label">Workspace</div>
                <nav aria-label="Main navigation">
                  {navigation.map(([href, label, icon]) => (
                    <Link
                      key={href}
                      href={href}
                      aria-current={
                        navigationPath === href || navigationPath.startsWith(href + '/')
                          ? 'page'
                          : undefined
                      }
                    >
                      <Icon kind={icon} />
                      {label}
                    </Link>
                  ))}
                </nav>
                <div className="sidebar-bottom">
                  <Link
                    href="/settings"
                    aria-current={navigationPath === '/settings' ? 'page' : undefined}
                  >
                    <Icon kind="settings" />
                    Settings
                  </Link>
                  <div className="sidebar-account">
                    <span>{data?.actor.name || 'Loading…'}</span>
                    <button
                      type="button"
                      className="sidebar-signout"
                      onClick={async () => {
                        if (!(await canLeaveEditing())) return;
                        await request('/api/auth/sign-out', {});
                        workMemory.current = { href: '/work', scrollY: 0, focusId: '' };
                        setWorkHref('/work');
                        setData(null);
                        router.push('/login');
                      }}
                    >
                      Sign out
                    </button>
                  </div>
                </div>
              </aside>
              <div className="workspace-main">
                <main id="main" tabIndex={-1}>
                  {error ? (
                    <div className="feedback error" role="alert">
                      {error}{' '}
                      <button type="button" onClick={() => void refresh()}>
                        Retry
                      </button>
                    </div>
                  ) : null}
                  {loading && !data ? (
                    <div className="loading" role="status">
                      <div className="skeleton heading" />
                      <div className="skeleton" />
                      <div className="skeleton" />
                      <div className="skeleton" />
                      <span className="sr-only">Loading workspace</span>
                    </div>
                  ) : data ? (
                    children
                  ) : null}
                </main>
              </div>
            </>
          )}
        </div>
      </TitleOverrideContext.Provider>
    </WorkspaceContext.Provider>
  );
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const klParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kuala_Lumpur',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});
/** Calendar fields of an instant in Kuala Lumpur time. */
function klFields(date: Date) {
  const parts = Object.fromEntries(klParts.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}
/**
 * Formats a date ("2026-11-05" → "5 Nov 2026") or a timestamp
 * ("2026-11-05T06:30:00Z" → "5 Nov 2026, 14:30", Kuala Lumpur time, no zone suffix).
 * Pass `{ seconds: true }` to include seconds on a timestamp.
 */
export function formatDate(value: string | null | undefined, options?: { seconds?: boolean }) {
  if (!value) return '—';
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  if (dateOnly) {
    const [year, month, day] = value.split('-').map(Number);
    if (month < 1 || month > 12) return value;
    return `${day} ${MONTHS[month - 1]} ${year}`;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const f = klFields(date);
  return `${f.day} ${MONTHS[f.month - 1]} ${f.year}, ${f.hour}:${f.minute}${options?.seconds ? ':' + f.second : ''}`;
}
const AUDIT_ENTITY_LABELS: Record<string, string> = Object.fromEntries([
  ['person', 'Person'],
  ['company_relationship', 'Company relationship'],
  ['company_profile', 'Company profile'],
  ['record_field', 'Custom field definition'],
  ['resolution_case', 'Resolution'],
  ['clause_template', 'Wording'],
  ['clause_version', 'Wording version'],
  ['assembly', 'Layout'],
  ['assembly_version', 'Layout version'],
  ['output_type', 'Document type'],
  ['document_generation', 'Generated document'],
  ['user', 'User'],
  ['relationship', 'Company relationship'],
  ['director', 'Director'],
  ['document', 'Document'],
  ['company', 'Company'],
  ['job', 'Job'],
  ['record', 'Record'],
  ['settings', 'Settings'],
  ['preferences', 'Preferences'],
]);

const AUDIT_ACTION_LABELS: Record<string, string> = {
  'person.projected': 'Person added from officer register',
  'relationship.projected': 'Directorship updated from officer register',
  'relationship.projection_skipped': 'Directorship not updated from officer register',
  'resolution_case.family_created': 'Resolution document started',
  'document_generation.execution_recorded': 'Signed document recorded',
  'document.stored': 'Document uploaded',
  'record.posted': 'Record entry posted',
  'audit.exported': 'Audit log exported',
  'bo.register.read': 'Beneficial ownership register viewed',
  'document.download': 'Document downloaded',
};
/** Past-tense wording for imperative action names such as "save_answers". */
const AUDIT_VERBS: Record<string, string> = {
  save_answers: 'answers saved',
  set_selection: 'wording selection changed',
  set_citation: 'citation changed',
  set_capacity: 'capacity changed',
  set_custom: 'custom value recorded',
  link_job: 'linked to job',
  record_decision: 'decision recorded',
  send_for_review: 'sent for review',
  review: 'reviewed',
  reopen: 'reopened',
  cancel: 'cancelled',
  complete: 'completed',
  archive: 'archived',
  create: 'created',
  update: 'updated',
  update_details: 'details updated',
  add: 'added',
  end: 'ended',
  add_step: 'step added',
  update_step: 'step updated',
  resolution_attached: 'resolution attached',
  document_generated: 'document generated',
  read: 'viewed',
};

/** Turns an identifier such as "draft_saved" or "fullName" into sentence case. */
export function sentenceCase(text: string) {
  const words = text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replaceAll(/[._]+/g, ' ')
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** A readable, sentence-case label for a stored audit action such as "assembly_version.draft_saved". */
export function auditActionLabel(action: string) {
  if (AUDIT_ACTION_LABELS[action]) return AUDIT_ACTION_LABELS[action];
  const dot = action.indexOf('.');
  if (dot < 0) return sentenceCase(action);
  const entity = AUDIT_ENTITY_LABELS[action.slice(0, dot)];
  const rest = action.slice(dot + 1);
  const verb = AUDIT_VERBS[rest] || sentenceCase(rest).toLowerCase();
  return entity ? `${entity} ${verb}` : sentenceCase(action);
}

export function currentDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
export function PageHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="page-header">
      <h1>{title}</h1>
      {children}
    </div>
  );
}
export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function BackToWork() {
  const { workHref, restoreWork } = useWorkspace();
  return (
    <Link href={workHref} className="back-link" onClick={restoreWork}>
      <Icon kind="back" />
      {workHref.startsWith('/reviews') ? 'Reviews' : 'My work'}
    </Link>
  );
}
