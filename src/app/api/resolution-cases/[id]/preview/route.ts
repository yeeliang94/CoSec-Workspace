import { requireActor } from '@/server/auth';
import { previewCase } from '@/server/resolution/selection';
import { respond } from '@/server/resolution/templates';

/** Compiles the saved draft against live records; nothing is stored. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return respond(request, async () => previewCase(await requireActor(request), (await params).id));
}
