import { eq } from 'drizzle-orm';
import { db, type Transaction } from '../db';
import * as s from '../schema';
import { prior, remember, requestKey } from '../repository';
import { auditChange } from '../resolution/shared';
import { assertCapability, DomainError } from '../../domain/access';
import type { Actor } from '../../domain/model';
import type {
  CustomFieldScope,
  CustomValues,
  DatedValue,
  RecordFieldDefinition,
} from '../../domain/resolution/model';
import { FIELD_ID, OPTION_ID, validateFieldValue } from '../../domain/resolution/records';

export async function listFieldDefinitions(
  options: { scope?: CustomFieldScope; includeArchived?: boolean } = {},
) {
  const rows = await (options.scope
    ? db
        .select()
        .from(s.recordFieldDefinitions)
        .where(eq(s.recordFieldDefinitions.scope, options.scope))
    : db.select().from(s.recordFieldDefinitions));
  return rows
    .map((r) => r.data)
    .filter((d) => options.includeArchived || !d.archived)
    .sort((a, b) => a.scope.localeCompare(b.scope) || a.label.localeCompare(b.label));
}

export async function readDefinition(id: string, scope: CustomFieldScope, tx?: Transaction) {
  const [row] = await (tx ?? db)
    .select()
    .from(s.recordFieldDefinitions)
    .where(eq(s.recordFieldDefinitions.id, id));
  if (!row || row.data.scope !== scope)
    throw new DomainError('Choose an existing field for this kind of record.');
  return row.data;
}

/** Validates against the current definition and appends a dated value (newest last). */
export async function appendCustomValue(
  actor: Actor,
  values: CustomValues,
  input: { definitionId: string; value: unknown; effectiveDate: string; reason: string },
  scope: CustomFieldScope,
  tx: Transaction,
): Promise<CustomValues> {
  const definition = await readDefinition(input.definitionId, scope, tx);
  const entry: DatedValue = {
    value: validateFieldValue(definition, input.value),
    effectiveDate: input.effectiveDate,
    definitionVersion: definition.version,
    recordedAt: new Date().toISOString(),
    actorId: actor.id,
    reason: input.reason.trim(),
  };
  const history = Object.hasOwn(values, definition.id) ? values[definition.id] : [];
  return { ...values, [definition.id]: [...history, entry] };
}

type Option = { id: string; label: string };
export type FieldDefinitionInput =
  | {
      action: 'create';
      requestId: string;
      id: string;
      scope: CustomFieldScope;
      label: string;
      valueType: RecordFieldDefinition['valueType'];
      options?: Option[];
    }
  | {
      action: 'update';
      id: string;
      expectedRevision: number;
      requestId: string;
      label?: string;
      options?: Option[];
      reason: string;
    }
  | { action: 'archive'; id: string; expectedRevision: number; requestId: string; reason: string };

function checkOptions(valueType: RecordFieldDefinition['valueType'], options?: Option[]) {
  if (valueType !== 'choice') {
    if (options?.length) throw new DomainError('Only choice fields have options.');
    return undefined;
  }
  if (!options?.length) throw new DomainError('A choice field needs at least one option.');
  const ids = options.map((o) => o.id);
  if (ids.some((id) => !OPTION_ID.test(id)) || new Set(ids).size !== ids.length)
    throw new DomainError('Option ids must be unique lowercase identifiers.');
  return options.map((o) => ({ id: o.id, label: o.label.trim() }));
}

export async function changeFieldDefinition(actor: Actor, input: FieldDefinitionInput) {
  assertCapability(actor, 'manage_templates');
  if (!FIELD_ID.test(input.id))
    throw new DomainError('Field ids are lowercase letters, digits and underscores (2–64).');
  const key = requestKey(actor, `field:${input.id}`, input.requestId);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(s.recordFieldDefinitions)
      .where(eq(s.recordFieldDefinitions.id, input.id))
      .for('update');
    const replay = await prior(tx, key);
    if (replay && row) return row.data;
    if (input.action === 'create') {
      if (row) throw new DomainError('A field with this id already exists.', 'DUPLICATE', 409);
      const options = checkOptions(input.valueType, input.options);
      const definition: RecordFieldDefinition = {
        id: input.id,
        scope: input.scope,
        label: input.label.trim(),
        valueType: input.valueType,
        ...(options ? { options } : {}),
        version: 1,
        archived: false,
        createdBy: actor.id,
        createdAt: new Date().toISOString(),
        revision: 1,
      };
      await tx.insert(s.recordFieldDefinitions).values({
        id: definition.id,
        scope: definition.scope,
        revision: 1,
        data: definition,
      });
      await auditChange(tx, actor, {
        companyId: null,
        entityType: 'record_field',
        entityId: definition.id,
        action: 'record_field.created',
        before: null,
        after: definition,
        requestId: input.requestId,
      });
      await remember(tx, key, { id: definition.id, revision: 1 });
      return definition;
    }
    if (!row) throw new DomainError('Field definition is unavailable.', 'NOT_FOUND', 404);
    if (row.revision !== input.expectedRevision)
      throw new DomainError('This field changed. Refresh and try again.', 'STALE', 409);
    const before = row.data;
    const next = structuredClone(before);
    if (input.action === 'archive') {
      if (before.archived) throw new DomainError('This field is already archived.');
      next.archived = true;
    } else {
      if (before.archived) throw new DomainError('Archived fields cannot be changed.');
      if (input.label !== undefined) next.label = input.label.trim();
      if (input.options !== undefined) {
        const options = checkOptions(before.valueType, input.options)!;
        // Stored values reference option ids, so an option can be relabelled but never removed.
        const removed = (before.options ?? []).filter((o) => !options.some((n) => n.id === o.id));
        if (removed.length)
          throw new DomainError(
            `Options cannot be removed once offered: ${removed.map((o) => o.label).join(', ')}.`,
          );
        next.options = options;
      }
      if (JSON.stringify(next) === JSON.stringify(before))
        throw new DomainError('No change to save.');
      next.version = before.version + 1;
    }
    next.revision = before.revision + 1;
    await tx
      .update(s.recordFieldDefinitions)
      .set({ revision: next.revision, data: next })
      .where(eq(s.recordFieldDefinitions.id, next.id));
    await auditChange(tx, actor, {
      companyId: null,
      entityType: 'record_field',
      entityId: next.id,
      action: `record_field.${input.action === 'archive' ? 'archived' : 'updated'}`,
      before,
      after: next,
      reason: input.reason,
      requestId: input.requestId,
    });
    await remember(tx, key, { id: next.id, revision: next.revision });
    return next;
  });
}
