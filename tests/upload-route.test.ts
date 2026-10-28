import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ storeUpload: vi.fn() }));
vi.mock('@/server/auth', () => ({ requireActor: async () => ({ id: 'executive' }) }));
vi.mock('@/server/storage', () => ({
  MAX_UPLOAD_BYTES: 15 * 1024 * 1024,
  storeUpload: mock.storeUpload,
}));
import { POST } from '../src/app/api/documents/route';

const origin = new URL(process.env.BETTER_AUTH_URL ?? 'http://127.0.0.1:4300').origin;
function upload(contentLength: string | null) {
  const headers = new Headers({ origin });
  if (contentLength !== null) headers.set('content-length', contentLength);
  return new Request(`${origin}/api/documents`, { method: 'POST', headers });
}

describe('document upload route', () => {
  beforeEach(() => mock.storeUpload.mockReset());
  it('rejects an oversized upload before reading its body', async () => {
    const response = await POST(upload(String(16 * 1024 * 1024)));
    expect(response.status).toBe(413);
    expect(mock.storeUpload).not.toHaveBeenCalled();
  });
  it('rejects an upload that does not declare its size', async () => {
    const response = await POST(upload(null));
    expect(response.status).toBe(411);
    expect(mock.storeUpload).not.toHaveBeenCalled();
  });
});
