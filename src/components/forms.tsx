'use client';
import { useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { request, useWorkspace } from './workspace';
export type Field = {
  name: string;
  label: string;
  type?:
    'text' | 'date' | 'number' | 'textarea' | 'select' | 'multi' | 'rich' | 'checkbox' | 'list';
  required?: boolean;
  value?: string | number | boolean;
  options?: { value: string; label: string }[];
  full?: boolean;
  min?: number;
  max?: number;
};
const RichEditor = dynamic(() => import('./rich-editor').then((module) => module.RichEditor), {
  ssr: false,
  loading: () => (
    <div className="skeleton" role="status">
      Loading editor…
    </div>
  ),
});

export function FormFields({ fields }: { fields: Field[] }) {
  return (
    <div className="form-grid">
      {fields.map((field) => (
        <label className={field.full ? 'full' : ''} key={field.name}>
          {field.label}
          {field.type === 'textarea' || field.type === 'list' ? (
            <textarea
              name={field.name}
              defaultValue={String(field.value || '')}
              required={field.required}
            />
          ) : field.type === 'rich' ? (
            <RichEditor name={field.name} initial={String(field.value || '')} />
          ) : field.type === 'select' || field.type === 'multi' ? (
            <select
              name={field.name}
              required={field.required}
              multiple={field.type === 'multi'}
              defaultValue={field.type === 'multi' ? undefined : String(field.value || '')}
            >
              <option value="">Select…</option>
              {field.options?.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          ) : field.type === 'checkbox' ? (
            <input name={field.name} type="checkbox" defaultChecked={Boolean(field.value)} />
          ) : (
            <input
              name={field.name}
              type={field.type || 'text'}
              defaultValue={field.value === undefined ? '' : String(field.value)}
              required={field.required}
              min={field.min}
              max={field.max}
            />
          )}
        </label>
      ))}
    </div>
  );
}
export function ActionForm({
  url,
  action,
  fields = [],
  extra = {},
  label,
  onSuccess,
  confirmation,
  primary = false,
}: {
  url: string;
  action?: string;
  fields?: Field[];
  extra?: Record<string, unknown>;
  label: string;
  onSuccess?: () => void;
  confirmation?: string;
  primary?: boolean;
}) {
  const { refresh } = useWorkspace();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [dirty, setDirty] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const requestKey = useRef('');
  async function save() {
    if (!form.current) return;
    const formData = new FormData(form.current);
    const payload: Record<string, unknown> = {
      ...extra,
      requestId: requestKey.current || (requestKey.current = crypto.randomUUID()),
      ...(action ? { action } : {}),
    };
    for (const field of fields) {
      payload[field.name] =
        field.type === 'list'
          ? String(formData.get(field.name) || '')
              .split('\n')
              .map((value) => value.trim())
              .filter(Boolean)
          : field.type === 'multi'
            ? formData.getAll(field.name).filter(Boolean)
            : field.type === 'number'
              ? Number(formData.get(field.name))
              : field.type === 'checkbox'
                ? formData.get(field.name) === 'on'
                : formData.get(field.name) || null;
      if (
        payload[field.name] === null &&
        (field.type === 'text' || field.type === 'textarea' || !field.type)
      )
        delete payload[field.name];
    }
    setPending(true);
    setError('');
    setSaved('');
    try {
      await request(url, payload);
      setDirty(false);
      requestKey.current = '';
      if (form.current) form.current.dataset.dirty = 'false';
      setConfirming(false);
      setSaved('Saved');
      await refresh();
      onSuccess?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The change could not be saved.');
    } finally {
      setPending(false);
    }
  }
  return (
    <form
      className="action-form"
      inert={pending}
      aria-busy={pending}
      ref={form}
      onInput={() => {
        setDirty(true);
        requestKey.current = '';
        if (form.current) form.current.dataset.dirty = 'true';
        setSaved('');
      }}
      onChange={() => {
        setDirty(true);
        requestKey.current = '';
        if (form.current) form.current.dataset.dirty = 'true';
        setSaved('');
      }}
      onSubmit={(event) => {
        event.preventDefault();
        if (confirmation && !confirming) setConfirming(true);
        else void save();
      }}
    >
      {fields.length ? <FormFields fields={fields} /> : null}
      {error ? (
        <div className="feedback error" role="alert">
          {error}
        </div>
      ) : null}
      {confirming ? (
        <div className="confirmation">
          <p>{confirmation}</p>
          <div className="actions">
            <button className="primary" disabled={pending} type="submit">
              {pending ? 'Saving…' : label}
            </button>
            <button type="button" onClick={() => setConfirming(false)}>
              Keep editing
            </button>
          </div>
        </div>
      ) : (
        <div className="actions">
          <button className={primary ? 'primary' : ''} disabled={pending}>
            {pending ? 'Saving…' : label}
          </button>
          {saved ? (
            <span role="status" className="success">
              {saved}
            </span>
          ) : dirty ? (
            <span className="metadata">Unsaved changes</span>
          ) : null}
        </div>
      )}
    </form>
  );
}
export function UploadForm({ companyId, jobId }: { companyId: string; jobId?: string }) {
  const { refresh } = useWorkspace();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  return (
    <form
      inert={pending}
      aria-busy={pending}
      className="form-grid"
      onChange={(event) => {
        event.currentTarget.dataset.dirty = 'true';
      }}
      onSubmit={async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        data.set('companyId', companyId);
        if (jobId) data.set('jobId', jobId);
        setPending(true);
        setError('');
        setSaved('');
        try {
          await request('/api/documents', data);
          await refresh();
          form.reset();
          form.dataset.dirty = 'false';
          setSaved('Evidence uploaded');
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Upload failed');
        } finally {
          setPending(false);
        }
      }}
    >
      <label>
        Evidence title
        <input name="title" required />
      </label>
      <label>
        File
        <input name="file" type="file" accept=".pdf,.png,.jpg,.jpeg,.txt" required />
      </label>
      <div className="full form-footer">
        {error ? (
          <div className="feedback error" role="alert">
            {error}
          </div>
        ) : null}
        <div className="actions">
          <button disabled={pending}>{pending ? 'Uploading…' : 'Upload evidence'}</button>
          <span role="status" className="success">
            {saved}
          </span>
        </div>
      </div>
    </form>
  );
}

export { canLeaveEditing } from './edit-guard';
