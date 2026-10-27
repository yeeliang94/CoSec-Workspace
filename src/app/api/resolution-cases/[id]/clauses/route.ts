import { requireActor } from '@/server/auth';
import { applyClauseAction, getCaseClauses } from '@/server/resolution/selection';
import { respond } from '@/server/resolution/templates';

type Params = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Params) {
  return respond(request, async () =>
    getCaseClauses(await requireActor(request), (await params).id),
  );
}

export async function POST(request: Request, { params }: Params) {
  return respond(request, async () =>
    applyClauseAction(await requireActor(request), (await params).id, await request.json()),
  );
}
