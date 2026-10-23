import { requireActor } from '@/server/auth';
import { endpoint } from '@/server/http';
import { MAX_UPLOAD_BYTES, storeUpload } from '@/server/storage';
import { DomainError } from '@/domain/access';
/** Room for the multipart boundaries and the small text fields sent with the file. */
const MAX_REQUEST_BYTES = MAX_UPLOAD_BYTES + 64 * 1024;
export async function POST(request: Request) {
  return endpoint(request, async () => {
    const actor = await requireActor(request);
    // Reject before parsing: formData() buffers the whole body in memory.
    const declared = Number(request.headers.get('content-length'));
    if (!declared) throw new DomainError('The upload size is unavailable. Try again.', 'SIZE', 411);
    if (declared > MAX_REQUEST_BYTES)
      throw new DomainError('Files must be 15 MiB or smaller.', 'SIZE', 413);
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) throw new DomainError('Choose a file.');
    return storeUpload(actor, {
      companyId: String(form.get('companyId') ?? ''),
      jobId: form.get('jobId') ? String(form.get('jobId')) : undefined,
      title: String(form.get('title') ?? ''),
      file,
    });
  });
}
