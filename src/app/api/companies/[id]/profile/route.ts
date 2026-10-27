import { requireActor } from '@/server/auth';
import { endpoint } from '@/server/http';
import { changeProfile, getProfile } from '@/server/records/profile';
import { profileInput } from '@/server/records/inputs';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return endpoint(request, async () => {
    const actor = await requireActor(request);
    return getProfile(actor, (await params).id);
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return endpoint(request, async () => {
    const actor = await requireActor(request);
    const body = profileInput.parse(await request.json());
    return changeProfile(actor, (await params).id, body);
  });
}
