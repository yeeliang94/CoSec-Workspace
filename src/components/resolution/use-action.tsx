'use client';
import { useRef, useState } from 'react';
import { ApiError, errorText } from './api';

/** Pending, error and result state for one consequential action. */
export function useAction() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [status, setStatus] = useState('');
  /** Code of the last failure, readable straight after `run` resolves. */
  const lastCode = useRef('');
  async function run<T>(fn: () => Promise<T>, done = ''): Promise<T | undefined> {
    setPending(true);
    setError('');
    setStatus('');
    setConflict(false);
    lastCode.current = '';
    try {
      const result = await fn();
      setStatus(done);
      return result;
    } catch (e) {
      setConflict(e instanceof ApiError && e.status === 409);
      lastCode.current = e instanceof ApiError ? e.code : 'ERROR';
      setError(errorText(e));
      return undefined;
    } finally {
      setPending(false);
    }
  }
  return { pending, error, status, conflict, run, setError, setStatus, lastCode };
}

export function ActionFeedback({
  error,
  status,
  conflict,
  onReload,
}: {
  error: string;
  status: string;
  conflict?: boolean;
  onReload?: () => void;
}) {
  return (
    <>
      {error ? (
        <div className="feedback error" role="alert">
          {error}
          {conflict && onReload ? (
            <>
              {' '}
              Someone else changed this record. Your entries are kept here.{' '}
              <button type="button" className="text-button" onClick={onReload}>
                Reload latest
              </button>
            </>
          ) : null}
        </div>
      ) : null}
      <span className="success action-status" role="status">
        {status}
      </span>
    </>
  );
}
