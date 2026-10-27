import { requireActor } from '@/server/auth';
import { endpoint } from '@/server/http';
import { listTemplates, templateAction } from '@/server/resolution/templates';

export async function GET(request: Request) {
  return endpoint(request, async () => {
    const actor = await requireActor(request);
    const q = new URL(request.url).searchParams;
    return {
      assemblies: await listTemplates(actor, 'assembly', {
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
  return endpoint(request, async () =>
    templateAction(await requireActor(request), 'assembly', await request.json()),
  );
}
