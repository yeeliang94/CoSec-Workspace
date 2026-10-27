import { requireActor } from '@/server/auth';
import { endpoint } from '@/server/http';
import { previewCase } from '@/server/resolution/selection';

/** Compiles the saved draft against live records; nothing is stored. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return endpoint(request, async () => previewCase(await requireActor(request), (await params).id));
}
