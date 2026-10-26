import { requireActor } from '@/server/auth';
import { endpoint } from '@/server/http';
import {
  applyOutputTypeAction,
  assertTemplateReader,
  listOutputTypes,
} from '@/server/resolution/templates';

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
