'use client';
import { RecordVersion } from '../registers/record-version';
import type { JobSectionProps as Props } from './shared';
import { useState } from 'react';
import { useWorkspace, formatDate, currentDate, request } from '../workspace';
import { UploadForm } from '../forms';
import { jobFields, JobAction, EvidenceLinks } from './shared';
export function Documents({ job, data }: Props) {
  const { evidence, version } = jobFields(job, data);
  const pack = job.packs.at(-1);
  const [generated, setGenerated] = useState('');
  const { refresh } = useWorkspace();
  const prepare = data.actor.capabilities.includes('prepare_job');
  return (
    <>
      <section className="section">
        <h2>Current pack · v{version}</h2>
        <dl className="record-meta">
          <div>
            <dt>Document state</dt>
            <dd>{pack?.state || 'Draft'}</dd>
          </div>
          <div>
            <dt>Prepared</dt>
            <dd>{formatDate(pack?.createdAt)}</dd>
          </div>
        </dl>
        {pack?.notes ? <p style={{ marginTop: 12 }}>{pack.notes}</p> : null}
        <ul className="document-list">
          {pack?.documentIds.map((id) => (
            <li key={id}>
              <div>
                <EvidenceLinks ids={[id]} data={data} />
              </div>
            </li>
          ))}
        </ul>
        {prepare ? (
          <details className="disclosure">
            <summary>Prepare a new pack version</summary>
            <div>
              <JobAction
                job={job}
                action="revise_pack"
                label="Save new pack version"
                primary
                fields={[
                  {
                    name: 'notes',
                    label: 'Preparation and revision notes',
                    type: 'textarea',
                    required: true,
                    full: true,
                  },
                  {
                    name: 'documentIds',
                    label: 'Pack documents',
                    type: 'multi',
                    options: evidence,
                    required: true,
                    full: true,
                  },
                  {
                    name: 'requiredSigners',
                    label: 'Required signers (one per line)',
                    type: 'list',
                    value: pack?.requiredSigners.join('\n') || job.personName || '',
                    full: true,
                  },
                  {
                    name: 'templateVersionId',
                    label: 'Internal template version',
                    type: 'select',
                    options: data.settings.catalogue
                      .filter((v) => v.kind === 'template' && v.status === 'Published')
                      .map((v) => ({ value: v.id, label: v.name + ' v' + v.version })),
                  },
                ]}
              />
            </div>
          </details>
        ) : null}
      </section>
      <section className="section">
        <h2>Execution evidence</h2>
        {pack?.requiredSigners.length ? (
          <ul className="list-plain">
            {pack.requiredSigners.map((signer) => {
              const signature = pack.signatures.find((s) => s.signer === signer);
              return (
                <li key={signer}>
                  <strong>{signer}</strong>
                  <p className={signature ? 'metadata success' : 'metadata'}>
                    {signature
                      ? 'Received ' + formatDate(signature.receivedDate)
                      : 'Signature outstanding'}
                  </p>
                  {signature ? <EvidenceLinks ids={[signature.evidenceId]} data={data} /> : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="muted">No signers specified in this pack</p>
        )}
        {prepare && pack?.requiredSigners.length ? (
          <JobAction
            job={job}
            action="sign"
            label={'Record signature on v' + version}
            fields={[
              {
                name: 'signer',
                label: 'Signer',
                type: 'select',
                required: true,
                options: pack.requiredSigners.map((value) => ({ value, label: value })),
              },
              {
                name: 'receivedDate',
                label: 'Signed evidence received',
                type: 'date',
                required: true,
                value: currentDate(),
              },
              {
                name: 'evidenceId',
                label: 'Execution evidence',
                type: 'select',
                options: evidence,
                required: true,
                full: true,
              },
            ]}
          />
        ) : null}
      </section>
      <section className="section">
        <h2>Private evidence</h2>
        <ul className="document-list">
          {data.documents
            .filter(
              (d) =>
                d.companyId === job.companyId &&
                (d.jobId === job.id || !d.jobId) &&
                (d.classification === 'BO') === (job.activity === 'W06'),
            )
            .map((d) => (
              <li key={d.id}>
                <div>
                  <a href={'/api/documents/' + d.id}>{d.title}</a>
                  <details className="file-details">
                    <summary>File details</summary>
                    <dl className="record-meta">
                      <div>
                        <dt>Filename</dt>
                        <dd>{d.originalName}</dd>
                      </div>
                      <div>
                        <dt>Uploaded</dt>
                        <dd>{formatDate(d.createdAt)}</dd>
                      </div>
                    </dl>
                  </details>
                </div>
                <span className="metadata">{Math.max(1, Math.round(d.size / 1024))} KB</span>
              </li>
            ))}
        </ul>
        {prepare ? (
          <div className="form-section">
            <UploadForm companyId={job.companyId} jobId={job.id} />
          </div>
        ) : null}
      </section>
      {prepare ? (
        <section className="section">
          <h2>Illustrative internal pack</h2>
          <form
            className="form-grid"
            onSubmit={async (event) => {
              event.preventDefault();
              setGenerated('');
              try {
                const form = new FormData(event.currentTarget);
                await request('/api/documents/generate', {
                  jobId: job.id,
                  templateVersionId: form.get('templateVersionId'),
                });
                await refresh();
                setGenerated(
                  'Illustrative document added to evidence. Select it in a new pack version.',
                );
              } catch (e) {
                setGenerated(e instanceof Error ? e.message : 'Generation failed');
              }
            }}
          >
            <label>
              Published template
              <select name="templateVersionId" required>
                <option value="">Select…</option>
                {data.settings.catalogue
                  .filter((v) => v.kind === 'template' && v.status === 'Published')
                  .map((v) => (
                    <option value={v.id} key={v.id}>
                      {v.name} v{v.version}
                    </option>
                  ))}
              </select>
            </label>
            <div className="actions">
              <button>Generate illustrative document</button>
            </div>
          </form>
          {generated ? (
            <p className="feedback" role="status">
              {generated}
            </p>
          ) : null}
        </section>
      ) : null}
      <details className="disclosure">
        <summary>Pack version history</summary>
        <div>
          <ul className="list-plain">
            {[...job.packs].reverse().map((p) => (
              <li key={p.version}>
                <strong>Version {p.version}</strong> · {p.state}
                <p className="metadata">
                  {formatDate(p.createdAt)} · {data.users.find((u) => u.id === p.createdBy)?.name}
                </p>
                <p>{p.notes}</p>
                <RecordVersion snapshot={p.recordSnapshot} />
                <EvidenceLinks ids={p.documentIds} data={data} />
              </li>
            ))}
          </ul>
        </div>
      </details>
    </>
  );
}
