/**
 * Carries holders from the retired share register into member relationships, so members'
 * resolutions keep listing them. Safe to re-run; run after `npm run db:migrate`.
 */
import 'dotenv/config';
import { closeDatabase, db, transaction } from '../src/server/db';
import * as s from '../src/server/schema';
import { carryRegisterMembers } from '../src/server/records/register-members';
import { lockCompany } from '../src/server/records/scope';

let total = 0;
for (const { companyId } of await db
  .select({ companyId: s.companyRegisters.companyId })
  .from(s.companyRegisters)) {
  const created = await transaction(async (tx) => {
    await lockCompany(companyId, tx);
    return carryRegisterMembers(companyId, tx);
  });
  total += created.length;
}
if (total) console.log(`Recorded ${total} shareholders from the old share register as members.`);
closeDatabase();
