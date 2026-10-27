'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { errorText } from './api';

/** Loads data for a page; keeps the last good value while reloading. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const loader = useRef(load);
  loader.current = load;
  const sequence = useRef(0);
  const reload = useCallback(async () => {
    const id = ++sequence.current;
    setLoading(true);
    try {
      const value = await loader.current();
      if (id !== sequence.current) return;
      setData(value);
      setError('');
    } catch (e) {
      if (id !== sequence.current) return;
      setError(errorText(e));
    } finally {
      if (id === sequence.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    void reload();
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return { data, setData, error, loading, reload };
}

export function LoadState({
  loading,
  error,
  reload,
  label,
}: {
  loading: boolean;
  error: string;
  reload: () => void;
  label: string;
}) {
  if (error)
    return (
      <div className="feedback error" role="alert">
        {error}{' '}
        <button type="button" onClick={reload}>
          Retry
        </button>
      </div>
    );
  if (loading)
    return (
      <div className="loading" role="status">
        <div className="skeleton" />
        <div className="skeleton" />
        <span className="sr-only">Loading {label}</span>
      </div>
    );
  return null;
}
