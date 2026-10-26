import { requireActor } from '@/server/auth';
import { listTemplates, respond, templateAction } from '@/server/resolution/templates';

export async function GET(request: Request) {
  return respond(request, async () => {
    const actor = await requireActor(request);
    const q = new URL(request.url).searchParams;
    return {
      clauses: await listTemplates(actor, 'clause', {
        category: q.get('category') ?? undefined,
        act: q.get('act') ?? undefined,
        usage: q.get('usage') ?? undefined,
        outputTypeId: q.get('outputTypeId') ?? undefined,
        includeHidden: q.get('includeHidden') === 'true',
      }),
    };
  });
}

export async function POST(request: Request) {
  return respond(request, async () =>
    templateAction(await requireActor(request), 'clause', await request.json()),
  );
}
