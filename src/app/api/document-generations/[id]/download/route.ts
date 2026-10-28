import { requireActor } from '@/server/auth';
import { endpoint } from '@/server/http';
import { downloadGeneration } from '@/server/resolution/generation-records';

/** Stored bytes of a Ready generation only; hash-checked and audited. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let download: Awaited<ReturnType<typeof downloadGeneration>> | undefined;
  const error = await endpoint(request, async () => {
    download = await downloadGeneration(await requireActor(request), (await params).id);
    return { ok: true };
  });
  if (!download) return error;
  const { document, bytes } = download;
  return new Response(new Uint8Array(bytes), {
    headers: {
      'Content-Type': document.mimeType,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(document.originalName)}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
