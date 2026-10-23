import type { Actor, Job, PackVersion } from '../domain/model';
import { currentPack } from '../domain/workflows';
export function appendVersion(job: Job, actor: Actor, patch: Partial<PackVersion> = {}) {
  const previous = currentPack(job);
  job.packs.push({
    ...structuredClone(previous),
    version: previous.version + 1,
    createdBy: actor.id,
    createdAt: new Date().toISOString(),
    signatures: [],
    state: 'Draft',
    ...patch,
    ...(['W05', 'W06'].includes(job.activity)
      ? {
          recordSnapshot: structuredClone({
            capitalProposal: job.capitalProposal,
            capitalReconciliation: job.capitalReconciliation,
            boCase: job.boCase,
            recordBaseRevision: job.recordBaseRevision,
            effectiveDate: job.effectiveDate,
            routeBasis: job.routeBasis,
          }),
        }
      : {}),
  });
  if (job.filingState === 'Ready' || job.filingState === 'Not required with reason') {
    job.filingState = 'Not ready';
    job.filingNotRequiredReason = null;
  }
  job.state = 'Preparing';
}
