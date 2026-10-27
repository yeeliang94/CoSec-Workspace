'use client';
import { useRef, useState } from 'react';
import type { Job } from '@/domain/model';
import type { DocumentGeneration } from '@/domain/resolution/model';
import { useWorkspace } from '@/components/workspace';
import { newRequestId, postJson } from './api';
import { ActionFeedback, useAction } from './use-action';

export function AttachGeneration({
  generation,
  onChanged,
}: {
  generation: DocumentGeneration;
  onChanged: () => Promise<void>;
}) {
  const { data, refresh } = useWorkspace();
  const [confirming, setConfirming] = useState(false);
  const action = useAction();
  const request = useRef({ revision: 0, id: '' });
  const job = data?.jobs.find((j) => j.id === generation.jobId);
  if (!job || !data?.actor.capabilities.includes('prepare_job') || generation.status !== 'Ready')
    return null;
  const pack = job.packs.at(-1)!;
  const attached = Boolean(
    generation.documentId && pack.documentIds.includes(generation.documentId),
  );
  const closed =
    ['Complete', 'Cancelled'].includes(job.state) ||
    Boolean(job.recordEventId) ||
    ['Submitted', 'Resubmitted', 'Outcome confirmed'].includes(job.filingState);
  if (closed && !attached) return null;
  return (
    <div>
      {attached ? (
        <p className="metadata">Attached to pack v{pack.version}</p>
      ) : confirming ? (
        <div className="confirmation form-stack">
          <p>
            Attach this exact document to {job.title} as pack v{pack.version + 1}? The new pack
            requires independent review and signature evidence for this document.
          </p>
          <div className="actions">
            <button
              type="button"
              className="primary"
              disabled={action.pending}
              onClick={async () => {
                if (!request.current.id || request.current.revision !== job.revision)
                  request.current = { revision: job.revision, id: newRequestId() };
                const result = await action.run(
                  () =>
                    postJson<Job>(`/api/document-generations/${generation.id}`, {
                      action: 'attach_to_pack',
                      expectedJobRevision: job.revision,
                      requestId: request.current.id,
                    }),
                  `Attached to pack v${pack.version + 1}`,
                );
                if (result) {
                  setConfirming(false);
                  request.current.id = '';
                  await refresh();
                  await onChanged();
                }
              }}
            >
              {action.pending ? 'Attaching…' : `Attach to pack v${pack.version + 1}`}
            </button>
            <button type="button" disabled={action.pending} onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setConfirming(true)}>
          Attach to director change pack
        </button>
      )}
      <ActionFeedback
        error={action.error}
        status={action.status}
        conflict={action.conflict}
        onReload={() => void refresh()}
      />
    </div>
  );
}
