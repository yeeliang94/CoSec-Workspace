import { requireActor } from '@/server/auth';
import { endpoint } from '@/server/http';
import { applyJobAction } from '@/server/workflows';
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return endpoint(request, async () =>
    applyJobAction(await requireActor(request), (await params).id, await request.json()),
  );
}
