import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import { eq } from 'drizzle-orm';
import { db, transaction } from './db';
import { user, account, session, companies } from './schema';
import { audit } from './repository';
import { assertCapability, DomainError } from '../domain/access';
import { defaultPreferences, ROLE_CAPABILITIES, type Actor } from '../domain/model';
const fields = z
  .object({
    name: z.string().trim().min(2).max(200),
    role: z.enum(['admin', 'user']),
    companyIds: z.array(z.string().min(1).max(36)).max(200),
  })
  .transform(({ role, ...rest }) => ({ ...rest, capabilities: ROLE_CAPABILITIES[role] }));
export async function readUsers(actor: Actor) {
  assertCapability(actor, 'manage_users');
  const [users, records] = await Promise.all([
    db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        capabilities: user.capabilities,
        companyIds: user.companyIds,
        active: user.active,
        updatedAt: user.updatedAt,
      })
      .from(user),
    db.select().from(companies),
  ]);
  return { users, companies: records.map((r) => ({ id: r.id, name: r.data.name })) };
}
export async function changeUser(actor: Actor, input: unknown) {
  assertCapability(actor, 'manage_users');
  const base = z.object({ action: z.enum(['create', 'update']) }).parse(input);
  const data = fields.parse(input);
  const companyRows = await db.select({ id: companies.id }).from(companies);
  if (data.companyIds.some((id) => !companyRows.some((c) => c.id === id)))
    throw new DomainError('Choose existing companies.');
  if (base.action === 'create') {
    const extra = z
      .object({ email: z.email().max(255), password: z.string().min(12).max(128) })
      .parse(input);
    const id = randomUUID(),
      now = new Date(),
      password = await hashPassword(extra.password);
    await transaction(async (tx) => {
      await tx.insert(user).values({
        id,
        name: data.name,
        email: extra.email.toLowerCase(),
        emailVerified: true,
        capabilities: data.capabilities,
        companyIds: data.companyIds,
        preferences: defaultPreferences,
        active: true,
        createdAt: now,
        updatedAt: now,
      });
      await tx.insert(account).values({
        id: randomUUID(),
        accountId: id,
        providerId: 'credential',
        userId: id,
        password,
        createdAt: now,
        updatedAt: now,
      });
      await audit(
        actor,
        null,
        'user.created',
        id,
        { capabilities: data.capabilities, companyIds: data.companyIds },
        tx,
      );
    });
    return { id };
  }
  const extra = z
    .object({
      id: z.string(),
      expectedUpdatedAt: z.string(),
      active: z.boolean(),
      password: z.string().min(12).max(128).optional(),
    })
    .parse(input);
  if (extra.id === actor.id && (!extra.active || !data.capabilities.includes('manage_users')))
    throw new DomainError(
      'Keep your own Admin role and account active. Ask another admin to change it.',
    );
  const password = extra.password ? await hashPassword(extra.password) : null;
  await transaction(async (tx) => {
    const [current] = await tx.select().from(user).where(eq(user.id, extra.id));
    if (!current) throw new DomainError('User is unavailable.', 'NOT_FOUND', 404);
    if (
      new Date(current.updatedAt).toISOString() !== new Date(extra.expectedUpdatedAt).toISOString()
    )
      throw new DomainError('This user changed. Refresh before saving.', 'STALE', 409);
    await tx
      .update(user)
      .set({ ...data, active: extra.active, updatedAt: new Date() })
      .where(eq(user.id, extra.id));
    if (password)
      await tx
        .update(account)
        .set({ password, updatedAt: new Date() })
        .where(eq(account.userId, extra.id));
    await tx.delete(session).where(eq(session.userId, extra.id));
    await audit(
      actor,
      null,
      'user.updated',
      extra.id,
      {
        capabilities: data.capabilities,
        companyIds: data.companyIds,
        active: extra.active,
        passwordReset: !!password,
      },
      tx,
    );
  });
  return { id: extra.id };
}
