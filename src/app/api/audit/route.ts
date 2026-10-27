import { z } from 'zod';
import { requireActor } from '@/server/auth';
import { endpoint } from '@/server/http';
import { AUDIT_PAGE_MAX, queryAudit } from '@/server/records/audit';
import { auditFilterInput, searchParams } from '@/server/records/inputs';

export async function GET(request: Request) {
  return endpoint(request, async () => {
    const actor = await requireActor(request);
    const { cursor, limit, ...filters } = auditFilterInput
      .extend({
        cursor: z.string().max(500).optional(),
        limit: z.coerce.number().int().min(1).max(AUDIT_PAGE_MAX).optional(),
      })
      .parse(searchParams(request));
    return queryAudit(actor, filters, { cursor, limit });
  });
}
