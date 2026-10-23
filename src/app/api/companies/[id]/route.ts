import { z } from 'zod';
import { requireActor } from '@/server/auth';
import { endpoint } from '@/server/http';
import { getCompany, listOfficerEvents, reviewOpening } from '@/server/repository';
import { officersAt } from '@/domain/workflows';
import { assertCompany, today } from '@/domain/access';
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return endpoint(request, async () => {
    const actor = await requireActor(request);
    const { id } = await params;
    assertCompany(actor, id);
    const asAt = z.iso.date().parse(new URL(request.url).searchParams.get('asAt') ?? today());
    const [company, events] = await Promise.all([getCompany(id), listOfficerEvents(id)]);
    return { company, officers: officersAt(events, asAt), events, asAt };
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return endpoint(request, async () => {
    const actor = await requireActor(request);
    const body = z
      .object({
        action: z.literal('review_opening'),
        expectedRevision: z.number().int().positive(),
        requestId: z.string().uuid(),
        sourceEvidenceId: z.string().min(1).max(36),
        basis: z.string().trim().min(1).max(4000),
        confirmed: z.literal(true),
      })
      .parse(await request.json());
    return reviewOpening(actor, (await params).id, body);
  });
}
