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
  ['/reviews', 'Reviews', 'review'],
  ['/calendar', 'Calendar', 'calendar'],
  ['/documents', 'Documents', 'document'],
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
export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const pathname = usePathname();
  const router = useRouter();
  const login = pathname === '/login';
  useEffect(installEditGuards, []);

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
                      pathname === href || pathname.startsWith(href + '/') ? 'page' : undefined
                    }
                  >
                    <Icon kind={icon} />
                    {label}
                  </Link>
                ))}
              </nav>
              <div className="sidebar-bottom">
                <Link href="/settings" aria-current={pathname === '/settings' ? 'page' : undefined}>
                  <Icon kind="settings" />
                  Settings
                </Link>
              </div>
            </aside>
            <div className="workspace-main">
              <header className="topbar">
                <span>{data?.settings.firmName || 'CoSec Workspace'}</span>
                <div className="account">
                  <span>{data?.actor.name || 'Loading…'}</span>
                  <button
                    type="button"
                    className="quiet"
                    onClick={async () => {
                      if (!canLeaveEditing()) return;
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
              </header>
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
    </WorkspaceContext.Provider>
  );
}
export function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value.length === 10 ? value + 'T00:00:00' : value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        ...(value.length > 10
          ? ({
              timeZone: 'Asia/Kuala_Lumpur',
              hour: '2-digit',
              minute: '2-digit',
              hour12: false,
              timeZoneName: 'short',
            } as const)
          : {}),
      }).format(date);
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
