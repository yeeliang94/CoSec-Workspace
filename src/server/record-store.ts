import { eq } from 'drizzle-orm';
import { db, type Transaction } from './db';
import { companyRegisters } from './schema';
import { emptyRegisters, capitalAt, beneficialOwnersAt } from '../domain/records';
import type { CompanyRegisters } from '../domain/records';

export async function readRegisters(
  companyId: string,
  tx?: Transaction,
): Promise<CompanyRegisters> {
  // MySQL REPEATABLE READ may retain the pre-lock snapshot after waiting for the company lock.
  // A locking read observes the latest committed register and makes stale proposals fail.
  const query = (tx ?? db)
    .select()
    .from(companyRegisters)
    .where(eq(companyRegisters.companyId, companyId));
  const [row] = await (tx ? query.for('update') : query);
  return row?.data ?? emptyRegisters();
}
/** Caller holds the company row lock; all job/ledger/audit writes share this transaction. */
export async function writeRegisters(
  companyId: string,
  records: CompanyRegisters,
  tx: Transaction,
) {
  records.revision += 1;
  await tx
    .insert(companyRegisters)
    .values({ companyId, revision: records.revision, data: records })
    .onDuplicateKeyUpdate({ set: { revision: records.revision, data: records } });
}
export async function memberSnapshot(companyId: string, asAt: string, tx?: Transaction) {
  return capitalAt((await readRegisters(companyId, tx)).capitalEvents, asAt);
}

export async function activeBoReviewJobs(asAt: string) {
  const records = await db.select().from(companyRegisters);
  return new Set(
    records.flatMap((r) => beneficialOwnersAt(r.data.boEvents, asAt).map((e) => e.jobId)),
  );
}
