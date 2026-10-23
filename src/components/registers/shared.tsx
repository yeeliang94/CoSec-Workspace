'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { request, useWorkspace } from '../workspace';
import type { Job } from '@/domain/model';

export function useRegister<T>(url: string, refreshKey: unknown) {
  const [value, setValue] = useState<T | null>(null);
  const [loadedUrl, setLoadedUrl] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    request<T>(url, undefined, 'GET')
      .then((result) => {
        if (active) {
          setValue(result);
          setLoadedUrl(url);
        }
      })
      .catch((error) => {
        if (active)
          setError(error instanceof Error ? error.message : 'Records could not be loaded.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [url, refreshKey, retry]);
  return {
    value: loadedUrl === url ? value : null,
    error,
    loading: loading || (!error && loadedUrl !== url),
    reload: () => setRetry((n) => n + 1),
  };
}
export function RegisterState({
  error,
  loading,
  reload,
}: {
  error: string;
  loading: boolean;
  reload: () => void;
}) {
  return error ? (
    <div className="feedback error" role="alert">
      {error}
      <div className="actions">
        <button onClick={reload}>Retry records</button>
      </div>
    </div>
  ) : loading ? (
    <p className="metadata" role="status">
      Loading records…
    </p>
  ) : null;
}
export function RecordForm({
  job,
  action,
  label,
  children,
  build,
  onSaved,
}: {
  job: Job;
  action: string;
  label: string;
  children: ReactNode;
  build: (form: FormData) => Record<string, unknown>;
  onSaved?: (job: Job) => void;
}) {
  const { refresh } = useWorkspace();
  const [error, setError] = useState(''),
    [pending, setPending] = useState(false);
  const key = useRef('');
  return (
    <form
      className="form-stack"
      inert={pending}
      aria-busy={pending}
      onChange={(e) => {
        e.currentTarget.dataset.dirty = 'true';
        key.current = '';
      }}
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        setError('');
        setPending(true);
        try {
          const saved = await request<Job>('/api/jobs/' + job.id, {
            ...build(new FormData(form)),
            action,
            expectedRevision: job.revision,
            requestId: key.current || (key.current = crypto.randomUUID()),
          });
          form.dataset.dirty = 'false';
          key.current = '';
          onSaved?.(saved);
          await refresh();
        } catch (error) {
          setError(error instanceof Error ? error.message : 'The proposal could not be saved.');
        } finally {
          setPending(false);
        }
      }}
    >
      {children}
      {error ? (
        <div className="feedback error" role="alert">
          {error}
        </div>
      ) : null}
      <div className="actions">
        <button className="primary" disabled={pending}>
          {pending ? 'Saving…' : label}
        </button>
      </div>
    </form>
  );
}
export const fieldText = (form: FormData, name: string) => String(form.get(name) ?? '').trim();
