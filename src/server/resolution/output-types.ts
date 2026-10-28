import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { assertCapability, DomainError } from '../../domain/access';
import type { Actor } from '../../domain/model';
import { type OutputType } from '../../domain/resolution/model';
import { OUTPUT_TYPE_ID, plainText } from '../../domain/resolution/schema';
import { db, transaction, type Transaction } from '../db';
import { prior, remember, requestKey } from '../repository';
import * as s from '../schema';
import { auditChange, requestId } from './shared';

export async function listOutputTypes(tx: Transaction | typeof db = db): Promise<OutputType[]> {
  return (await tx.select().from(s.outputTypes))
    .map((r) => r.data)
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------- output types
const outputTypeAction = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('create'),
    requestId,
    id: z.string().regex(OUTPUT_TYPE_ID),
    name: plainText(120).trim().min(1),
    body: z.enum(['directors', 'members']),
    order: z.number().int().min(0).max(1000).default(100),
  }),
  z.strictObject({
    action: z.literal('update'),
    requestId,
    id: z.string().regex(OUTPUT_TYPE_ID),
    name: plainText(120).trim().min(1).optional(),
    active: z.boolean().optional(),
    order: z.number().int().min(0).max(1000).optional(),
  }),
]);
export async function applyOutputTypeAction(actor: Actor, input: unknown) {
  assertCapability(actor, 'manage_templates');
  const action = outputTypeAction.parse(input);
  const key = requestKey(actor, `output_type:${action.id}`, action.requestId);
  await transaction(async (tx) => {
    if (await prior(tx, key)) return;
    const [row] = await tx.select().from(s.outputTypes).where(eq(s.outputTypes.id, action.id));
    const before: OutputType | null = row?.data ?? null;
    let next: OutputType;
    if (action.action === 'create') {
      if (row)
        throw new DomainError('An output type with this id already exists.', 'DUPLICATE', 409);
      next = {
        id: action.id,
        name: action.name,
        body: action.body,
        active: true,
        order: action.order,
      };
      await tx.insert(s.outputTypes).values({ id: next.id, data: next });
    } else {
      if (!row) throw new DomainError('The output type is unavailable.', 'NOT_FOUND', 404);
      next = {
        ...row.data,
        ...(action.name !== undefined ? { name: action.name } : {}),
        ...(action.active !== undefined ? { active: action.active } : {}),
        ...(action.order !== undefined ? { order: action.order } : {}),
      };
      await tx.update(s.outputTypes).set({ data: next }).where(eq(s.outputTypes.id, next.id));
    }
    await auditChange(tx, actor, {
      companyId: null,
      entityType: 'output_type',
      entityId: next.id,
      action: `output_type.${action.action === 'create' ? 'created' : 'updated'}`,
      before,
      after: next,
      requestId: action.requestId,
    });
    await remember(tx, key, { id: next.id });
  });
  return listOutputTypes();
}
