import { and, eq, inArray } from 'drizzle-orm';
import type { Actor, DocumentState, Job } from '../../domain/model';
import { currentPack, executionBlockers } from '../../domain/workflows';
import type { Transaction } from '../db';
import * as s from '../schema';
import { getDocuments } from '../repository';

/** Execution belongs to the exact attached generation and hash, independently of pack signatures. */
export async function generatedExecutionStatus(actor: Actor, job: Job, tx: Transaction) {
  const ids = currentPack(job).documentIds;
  const blockers: string[] = [];
  let required = 0;
  let signed = 0;
  if (!ids.length) return { blockers, required, signed };
  const documents = await getDocuments(actor, ids, tx);
  const generated = documents.filter((d) => d.generationId);
  if (!generated.length) return { blockers, required, signed };
  const generationIds = generated.map((d) => d.generationId!);
  const [generations, records] = await Promise.all([
    tx
      .select({ data: s.documentGenerations.data })
      .from(s.documentGenerations)
      .where(
        and(
          eq(s.documentGenerations.companyId, job.companyId),
          inArray(s.documentGenerations.id, generationIds),
        ),
      ),
    tx
      .select({ data: s.generationRecords.data })
      .from(s.generationRecords)
      .where(
        and(
          eq(s.generationRecords.companyId, job.companyId),
          inArray(s.generationRecords.generationId, generationIds),
        ),
      ),
  ]);
  for (const document of generated) {
    const generation = generations.find((g) => g.data.id === document.generationId)?.data;
    if (
      !generation ||
      generation.status !== 'Ready' ||
      generation.documentId !== document.id ||
      generation.sha256 !== document.sha256
    ) {
      blockers.push(`${document.title}: the attached generation cannot be verified.`);
      continue;
    }
    const people = [
      ...generation.snapshot.directors,
      ...generation.snapshot.members,
      ...generation.snapshot.companyPeople,
      ...generation.snapshot.proposedPeople,
    ];
    for (const personId of new Set(Object.values(generation.signers).flat())) {
      required++;
      const executed = records.some(
        ({ data: record }) =>
          record.kind === 'execution' &&
          record.generationId === generation.id &&
          record.sha256 === generation.sha256 &&
          record.signerPersonId === personId,
      );
      if (executed) signed++;
      else
        blockers.push(
          `${document.title}: ${people.find((p) => p.id === personId)?.name ?? personId} signature evidence is missing for generation ${generation.id}.`,
        );
    }
  }
  return { blockers, required, signed };
}

/** The pack state accounts for both its ordinary signatures and its generated documents. */
export async function reviewedExecutionState(
  actor: Actor,
  job: Job,
  tx: Transaction,
): Promise<DocumentState> {
  const generated = await generatedExecutionStatus(actor, job, tx);
  const pack = currentPack(job);
  if (executionBlockers(job).length || generated.blockers.length)
    return pack.signatures.length || generated.signed ? 'Partly signed' : 'Reviewed';
  return pack.requiredSigners.length || generated.required ? 'Fully signed' : 'Reviewed';
}
