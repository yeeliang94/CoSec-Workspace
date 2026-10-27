import { requireActor } from '@/server/auth';
import { applyVersionAction, getVersion, respond } from '@/server/resolution/templates';

type Params = { params: Promise<{ id: string; versionId: string }> };
export async function GET(request: Request, { params }: Params) {
  return respond(request, async () => {
    const { id, versionId } = await params;
    return getVersion(await requireActor(request), 'assembly', id, versionId);
  });
}

export async function POST(request: Request, { params }: Params) {
  return respond(request, async () => {
    const { id, versionId } = await params;
    return applyVersionAction(
      await requireActor(request),
      'assembly',
      id,
      versionId,
      await request.json(),
    );
  });
}
