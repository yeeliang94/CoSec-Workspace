import { requireActor } from '@/server/auth';
import { endpoint } from '@/server/http';
import { applySettingsAction } from '@/server/support';
export async function POST(request: Request) {
  return endpoint(request, async () =>
    applySettingsAction(await requireActor(request), await request.json()),
  );
}
