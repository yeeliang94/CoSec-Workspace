import { requireActor } from '@/server/auth';
import { endpoint } from '@/server/http';
import { applyClauseAction, getCaseClauses } from '@/server/resolution/selection';

type Params = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Params) {
  return endpoint(request, async () =>
    getCaseClauses(await requireActor(request), (await params).id),
  );
}

export async function POST(request: Request, { params }: Params) {
  return endpoint(request, async () =>
    applyClauseAction(await requireActor(request), (await params).id, await request.json()),
  );
}
