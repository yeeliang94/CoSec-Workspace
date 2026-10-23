import { requireActor } from '@/server/auth';
import { endpoint } from '@/server/http';
import { savePreferences } from '@/server/support';
export async function POST(request: Request) {
  return endpoint(request, async () =>
    savePreferences(await requireActor(request), await request.json()),
  );
}
