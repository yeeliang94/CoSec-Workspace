import { requireActor } from '@/server/auth';
import { endpoint } from '@/server/http';
import {
  applyGenerationAction,
  attachGenerationToPack,
  getGeneration,
} from '@/server/resolution/generation-records';

type Params = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Params) {
  return endpoint(request, async () =>
    getGeneration(await requireActor(request), (await params).id),
  );
}

export async function POST(request: Request, { params }: Params) {
  return endpoint(request, async () => {
    const [actor, id, body] = [
      await requireActor(request),
      (await params).id,
      await request.json(),
    ];
    return body?.action === 'attach_to_pack'
      ? attachGenerationToPack(actor, id, body)
      : applyGenerationAction(actor, id, body);
  });
}
