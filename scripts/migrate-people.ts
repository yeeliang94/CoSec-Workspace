/**
 * Legacy people migration: projects every company's posted officer events into people and
 * director relationships. Officer-event person ids are kept as people ids; matching names never
 * merge identities. Ids whose names differ are flagged for review with a company-neutral note and
 * one audit row per linked company (each scoped to that company only); which companies disagree is
 * printed only in this console report. Safe to re-run.
 */
import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { closeDatabase, db, transaction } from '../src/server/db';
import * as s from '../src/server/schema';
import { auditChange } from '../src/server/resolution/shared';
import { syncDirectorProjection } from '../src/server/records/relationships';
import { lockCompany, systemActor } from '../src/server/records/scope';

const companies = (
  await db.select({ id: s.companies.id, data: s.companies.data }).from(s.companies)
)
  .map((c) => ({ id: c.id, name: c.data.name }))
  .sort((a, b) => a.name.localeCompare(b.name));
const totals = {
  peopleCreated: 0,
  relationshipsCreated: 0,
  relationshipsUpdated: 0,
  peopleSkipped: 0,
};
console.log(`Projecting officer events for ${companies.length} companies…`);
for (const company of companies) {
  const result = await transaction(async (tx) => {
    await lockCompany(company.id, tx);
    return syncDirectorProjection(company.id, tx);
  });
  totals.peopleCreated += result.peopleCreated.length;
  totals.relationshipsCreated += result.relationshipsCreated.length;
  totals.relationshipsUpdated += result.relationshipsUpdated.length;
  totals.peopleSkipped += result.peopleSkipped.length;
  if (
    result.peopleCreated.length +
    result.relationshipsCreated.length +
    result.relationshipsUpdated.length +
    result.peopleSkipped.length
  )
    console.log(
      `  ${company.name}: people +${result.peopleCreated.length}, relationships +${result.relationshipsCreated.length}, updated ${result.relationshipsUpdated.length}, not linked (name differs) ${result.peopleSkipped.length}`,
    );
}

// Identity review: one person id carrying different names (across or within companies).
const names = new Map<string, Map<string, Set<string>>>();
for (const row of await db.select({ data: s.officerEvents.data }).from(s.officerEvents)) {
  const event = row.data;
  const byName = names.get(event.personId) ?? new Map<string, Set<string>>();
  byName.set(event.personName, (byName.get(event.personName) ?? new Set()).add(event.companyId));
  names.set(event.personId, byName);
}
const companyName = new Map(companies.map((c) => [c.id, c.name]));
const review: string[] = [];
const NOTE =
  'Officer events record different names for this person; review identity. Not merged or renamed by migration.';
let notesWritten = 0;
for (const [personId, byName] of names) {
  if (byName.size < 2) continue;
  const description = [...byName]
    .map(
      ([name, ids]) => `"${name}" (${[...ids].map((id) => companyName.get(id) ?? id).join(', ')})`,
    )
    .join(' vs ');
  // Company names stay in this console report only: the stored note and audit rows are read by
  // users of each linked company, who must not learn of the person's other companies.
  review.push(`  ${personId}: ${description}`);
  const linkedCompanies = [...new Set([...byName.values()].flatMap((ids) => [...ids]))].sort();
  await transaction(async (tx) => {
    const [row] = await tx.select().from(s.people).where(eq(s.people.id, personId));
    if (!row || row.data.migrationNote === NOTE) return;
    const next = { ...row.data, migrationNote: NOTE, revision: row.revision + 1 };
    await tx
      .update(s.people)
      .set({ revision: next.revision, data: next })
      .where(eq(s.people.id, personId));
    for (const companyId of linkedCompanies)
      await auditChange(tx, systemActor, {
        companyId,
        scopeCompanyIds: [companyId],
        entityType: 'person',
        entityId: personId,
        action: 'person.migration_flagged',
        before: { migrationNote: row.data.migrationNote ?? null },
        after: { migrationNote: NOTE },
      });
    notesWritten++;
  });
}

console.log('\nReconciliation report');
console.log(`  Companies processed:        ${companies.length}`);
console.log(`  People created:             ${totals.peopleCreated}`);
console.log(`  Relationships created:      ${totals.relationshipsCreated}`);
console.log(`  Relationships updated:      ${totals.relationshipsUpdated}`);
console.log(`  Links skipped (name):       ${totals.peopleSkipped}`);
console.log(
  `  Person ids needing review:  ${review.length} (notes written this run: ${notesWritten})`,
);
if (review.length) console.log(review.join('\n'));
closeDatabase();
