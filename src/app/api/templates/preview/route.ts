import { requireActor } from '@/server/auth';
import { endpoint } from '@/server/http';
import { previewTemplate, previewTemplateDocx } from '@/server/resolution/template-preview';

/** JSON preview of a saved version or an unsaved draft, with fictional values only. */
export async function POST(request: Request) {
  return endpoint(request, async () =>
    previewTemplate(await requireActor(request), await request.json()),
  );
}

/** `?kind=&versionId=&outputTypeId=&format=docx` returns a sample DOCX labelled as fictional. */
export async function GET(request: Request) {
  let file: Awaited<ReturnType<typeof previewTemplateDocx>> | undefined;
  const q = new URL(request.url).searchParams;
  const input = {
    kind: q.get('kind') ?? undefined,
    versionId: q.get('versionId') ?? undefined,
    ...(q.get('outputTypeId') ? { outputTypeId: q.get('outputTypeId') } : {}),
  };
  const result = await endpoint(request, async () => {
    const actor = await requireActor(request);
    if (q.get('format') !== 'docx') return previewTemplate(actor, input);
    file = await previewTemplateDocx(actor, input);
    return null;
  });
  if (!file) return result;
  return new Response(new Uint8Array(file.bytes), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
