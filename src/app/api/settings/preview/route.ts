import { requireActor } from '@/server/auth';
import { endpoint } from '@/server/http';
import { previewCatalogue } from '@/server/support';
export async function GET(request: Request) {
  return endpoint(request, async () =>
    previewCatalogue(
      await requireActor(request),
      new URL(request.url).searchParams.get('versionId') ?? '',
    ),
  );
}
