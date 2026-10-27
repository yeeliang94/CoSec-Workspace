import { requireActor } from '@/server/auth';
import { endpoint } from '@/server/http';
import { getPerson } from '@/server/records/people';
import { recordId } from '@/server/records/inputs';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return endpoint(request, async () => {
    const actor = await requireActor(request);
    return getPerson(actor, recordId.parse((await params).id));
  });
}
