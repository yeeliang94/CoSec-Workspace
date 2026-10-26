import { requireActor } from '@/server/auth';
import { endpoint } from '@/server/http';
import { exportAudit } from '@/server/records/audit';
import { auditFilterInput } from '@/server/records/inputs';

/** Returns CSV on success; errors use the standard JSON error envelope. */
export async function POST(request: Request) {
  let csv: string | null = null;
  const failure = await endpoint(request, async () => {
    const actor = await requireActor(request);
    const filters = auditFilterInput.parse(await request.json().catch(() => ({})));
    csv = (await exportAudit(actor, filters)).csv;
    return null;
  });
  if (csv === null) return failure;
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="audit-${stamp}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
