import type { Actor, Capability } from './model';
export class DomainError extends Error {
  constructor(
    message: string,
    public code = 'VALIDATION',
    public status = 400,
  ) {
    super(message);
  }
}
export function assertCapability(actor: Actor, capability: Capability) {
  if (!actor.capabilities.includes(capability))
    throw new DomainError('You do not have permission for this action.', 'FORBIDDEN', 403);
}
export function assertCompany(actor: Actor, companyId: string, capability?: Capability) {
  if (!actor.companyIds.includes(companyId))
    throw new DomainError('Company access is unavailable.', 'NOT_FOUND', 404);
  if (capability) assertCapability(actor, capability);
}
export function today() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function canReadJob(actor: Actor, job: { companyId: string; activity: string }) {
  return (
    actor.companyIds.includes(job.companyId) &&
    (job.activity !== 'W06' || actor.capabilities.includes('view_bo'))
  );
}
export function assertJobAccess(actor: Actor, job: { companyId: string; activity: string }) {
  if (!canReadJob(actor, job))
    throw new DomainError('Job access is unavailable.', 'NOT_FOUND', 404);
}
