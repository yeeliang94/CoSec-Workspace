import { requireActor } from '@/server/auth';
import { endpoint } from '@/server/http';
import { generateDocument } from '@/server/resolution/generation';

export async function POST(request: Request) {
  return endpoint(request, async () =>
    generateDocument(await requireActor(request), await request.json()),
  );
}
