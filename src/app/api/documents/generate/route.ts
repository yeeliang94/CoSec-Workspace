import { requireActor } from '@/server/auth';
import { endpoint } from '@/server/http';
import { generateIllustrativePack } from '@/server/support';
export async function POST(request: Request) {
  return endpoint(request, async () =>
    generateIllustrativePack(await requireActor(request), await request.json()),
  );
}
