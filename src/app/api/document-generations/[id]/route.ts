import { requireActor } from '@/server/auth';
import { endpoint } from '@/server/http';
import { applyGenerationAction, getGeneration } from '@/server/resolution/generation-records';

type Params = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Params) {
  return endpoint(request, async () =>
    getGeneration(await requireActor(request), (await params).id),
  );
}

export async function POST(request: Request, { params }: Params) {
  return endpoint(request, async () =>
    applyGenerationAction(await requireActor(request), (await params).id, await request.json()),
  );
}
