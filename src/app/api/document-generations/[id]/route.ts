import { requireActor } from '@/server/auth';
import {
  applyGenerationAction,
  attachGenerationToPack,
  getGeneration,
} from '@/server/resolution/generation';
import { respond } from '@/server/resolution/templates';

type Params = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Params) {
  return respond(request, async () =>
    getGeneration(await requireActor(request), (await params).id),
  );
}

export async function POST(request: Request, { params }: Params) {
  return respond(request, async () => {
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
