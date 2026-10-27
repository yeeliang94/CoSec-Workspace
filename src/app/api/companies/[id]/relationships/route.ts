import { requireActor } from '@/server/auth';
import { endpoint } from '@/server/http';
import { today } from '@/domain/access';
import { changeRelationship, listCompanyRelationships } from '@/server/records/relationships';
import { date, relationshipInput } from '@/server/records/inputs';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return endpoint(request, async () => {
    const actor = await requireActor(request);
    const asAt = date.parse(new URL(request.url).searchParams.get('asAt') || today());
    return listCompanyRelationships(actor, (await params).id, asAt);
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return endpoint(request, async () => {
    const actor = await requireActor(request);
    const body = relationshipInput.parse(await request.json());
    return changeRelationship(actor, (await params).id, body);
  });
}
