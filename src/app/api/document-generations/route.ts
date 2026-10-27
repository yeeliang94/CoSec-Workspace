import { requireActor } from '@/server/auth';
import { generateDocument } from '@/server/resolution/generation';
import { respond } from '@/server/resolution/templates';

export async function POST(request: Request) {
  return respond(request, async () =>
    generateDocument(await requireActor(request), await request.json()),
  );
}
