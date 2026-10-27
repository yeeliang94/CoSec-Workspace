/**
 * Grants the resolution-builder capabilities to existing users through an explicit mapping
 * (src/domain/resolution/records.ts mappedResolutionCapabilities). Adds only; never removes.
 * Each change is audited. Safe to re-run.
 */
import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { db, pool } from '../src/server/db';
import * as s from '../src/server/schema';
import { auditChange } from '../src/server/resolution/shared';
import { systemActor } from '../src/server/records/scope';
import { mappedResolutionCapabilities } from '../src/domain/resolution/records';

const users = await db.select({ id: s.user.id }).from(s.user);
let changed = 0;
for (const { id } of users) {
  await db.transaction(async (tx) => {
    const [u] = await tx.select().from(s.user).where(eq(s.user.id, id)).for('update');
    if (!u) return;
    const added = mappedResolutionCapabilities(u.capabilities);
    if (!added.length) return;
    const capabilities = [...u.capabilities, ...added];
    await tx.update(s.user).set({ capabilities, updatedAt: new Date() }).where(eq(s.user.id, id));
    await auditChange(tx, systemActor, {
      companyId: null,
      entityType: 'user',
      entityId: id,
      action: 'user.capabilities_granted',
      before: { capabilities: u.capabilities },
      after: { capabilities },
      reason: 'Resolution builder capability mapping (scripts/grant-resolution-capabilities.ts)',
      detail: { added },
    });
    changed++;
    console.log(`  ${u.name} <${u.email}>: + ${added.join(', ')}`);
  });
}
console.log(`Granted resolution capabilities to ${changed} of ${users.length} users.`);
await pool.end();
