import { requireActor } from '@/server/auth';
import { endpoint } from '@/server/http';
import { assertTemplateReader } from '@/server/resolution/templates';
import { applyOutputTypeAction, listOutputTypes } from '@/server/resolution/output-types';

export async function GET(request: Request) {
  return endpoint(request, async () => {
    assertTemplateReader(await requireActor(request));
    return { outputTypes: await listOutputTypes() };
  });
}

export async function POST(request: Request) {
  return endpoint(request, async () => ({
    outputTypes: await applyOutputTypeAction(await requireActor(request), await request.json()),
  }));
}
