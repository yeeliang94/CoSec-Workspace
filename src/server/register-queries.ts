import type { Actor } from '../domain/model';
import { assertCompany, assertCapability } from '../domain/access';
import { capitalAt, beneficialOwnersAt } from '../domain/records';
import { readRegisters } from './record-store';
import { audit } from './repository';

export async function capitalRegister(actor: Actor, companyId: string, asAt: string) {
  assertCompany(actor, companyId);
  const records = await readRegisters(companyId);
  return {
    revision: records.revision,
    asAt,
    position: capitalAt(records.capitalEvents, asAt),
    events: records.capitalEvents,
  };
}
export async function boRegister(actor: Actor, companyId: string, asAt: string) {
  assertCompany(actor, companyId, 'view_bo');
  assertCapability(actor, 'view_bo');
  const records = await readRegisters(companyId);
  await audit(actor, companyId, 'bo.register.read', companyId, { asAt });
  return {
    revision: records.revision,
    asAt,
    owners: beneficialOwnersAt(records.boEvents, asAt),
    events: records.boEvents,
  };
}
