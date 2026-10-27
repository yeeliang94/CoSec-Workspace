import type {
  DocumentGeneration,
  ExecutionRequirement,
  GenerationRecord,
} from '../../domain/resolution/model';
import { compileDocument } from '../../domain/resolution/compile';
import type { db, Transaction } from '../db';

/** Legacy rows are interpreted from their pinned versions and frozen inputs, never live answers. */
export async function generationRequirements(
  generation: DocumentGeneration,
  tx: Transaction | typeof db,
): Promise<ExecutionRequirement[]> {
  if (generation.executionRequirements) return generation.executionRequirements;
  const { loadCaseTemplate } = await import('./selection');
  const template = await loadCaseTemplate(tx, {
    outputTypeId: generation.outputTypeId,
    assemblyVersionId: generation.assemblyVersionId,
    // Only assembly blocks may contain signatures or control their conditions.
    clauses: [],
    revision: generation.selectionRevision,
    removals: [],
  });
  return compileDocument(
    {
      ...template,
      ctx: generation.snapshot,
      answers: generation.answers,
      signers: generation.signers,
    },
    'preview',
  ).executionRequirements;
}

export function satisfiesRequirement(
  record: GenerationRecord,
  generation: DocumentGeneration,
  requirement: ExecutionRequirement,
  requirements: ExecutionRequirement[],
) {
  return (
    record.kind === 'execution' &&
    record.generationId === generation.id &&
    record.sha256 === generation.sha256 &&
    record.signerPersonId === requirement.personId &&
    (record.signerRole === requirement.role ||
      (!record.signerRole &&
        requirements.filter((r) => r.personId === requirement.personId).length === 1))
  );
}
