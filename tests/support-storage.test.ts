import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Actor, Document } from '../src/domain/model';
import { defaultPreferences } from '../src/domain/model';
const repo = vi.hoisted(() => ({
  documents: new Map<string, unknown>(),
  audit: vi.fn(),
  failInsert: false,
}));
vi.mock('../src/server/repository', () => ({
  audit: repo.audit,
  getDocument: async (actor: Actor, id: string) => {
    const doc = repo.documents.get(id) as Document;
    if (!doc || !actor.companyIds.includes(doc.companyId))
      throw new Error('Company access is unavailable.');
    return doc;
  },
  getJob: async () => ({ companyId: 'company' }),
  insertDocument: async (_actor: Actor, doc: Document) => {
    if (repo.failInsert) throw new Error('Database unavailable');
    repo.documents.set(doc.id, doc);
  },
}));
import {
  MAX_UPLOAD_BYTES,
  readDownload,
  safeStoragePath,
  storeUpload,
  validateFile,
} from '../src/server/storage';
const actor: Actor = {
  id: 'executive',
  name: 'Executive',
  email: 'exec@example.test',
  capabilities: ['prepare_job'],
  companyIds: ['company'],
  preferences: defaultPreferences,
};
let dir = '';
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'cosec-storage-'));
  process.env.STORAGE_DIR = dir;
  repo.documents.clear();
  repo.audit.mockReset();
  repo.failInsert = false;
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  delete process.env.STORAGE_DIR;
});
describe('private immutable evidence', () => {
  it('rejects spoofed, active, oversized and traversal content', () => {
    expect(() =>
      validateFile('fake.pdf', 'application/pdf', Buffer.from('<html>bad</html>')),
    ).toThrow('content');
    expect(() => validateFile('script.html', 'text/html', Buffer.from('x'))).toThrow('PDF');
    expect(() => validateFile('data.txt', 'text/plain', Buffer.from([0, 1, 2]))).toThrow('binary');
    expect(() =>
      validateFile('large.txt', 'text/plain', new Uint8Array(MAX_UPLOAD_BYTES + 1)),
    ).toThrow('15 MiB');
    expect(() => safeStoragePath('../../secret.txt')).toThrow('invalid');
  });
  it('keeps files outside public storage, omits private paths and checks company download scope', async () => {
    const result = await storeUpload(actor, {
      companyId: 'company',
      title: 'Client response',
      file: new File(['Fictional response'], 'response.txt', { type: 'text/plain' }),
    });
    expect(result).not.toHaveProperty('storageKey');
    const doc = repo.documents.get(result.id) as Document;
    expect(await readFile(path.join(dir, doc.storageKey), 'utf8')).toBe('Fictional response');
    const download = await readDownload(actor, result.id);
    expect(download.bytes.toString()).toBe('Fictional response');
    expect(repo.audit).toHaveBeenCalledWith(actor, 'company', 'document.download', result.id, {
      sha256: doc.sha256,
    });
    await expect(readDownload({ ...actor, companyIds: [] }, result.id)).rejects.toThrow('access');
    await expect(
      storeUpload(
        { ...actor, companyIds: [] },
        { companyId: 'company', title: 'Denied', file: new File(['x'], 'x.txt') },
      ),
    ).rejects.toThrow('access');
  });
  it('rejects tampered attachment bytes', async () => {
    const result = await storeUpload(actor, {
      companyId: 'company',
      title: 'Evidence',
      file: new File(['Evidence'], 'evidence.txt', { type: 'text/plain' }),
    });
    const doc = repo.documents.get(result.id) as Document;
    await writeFile(path.join(dir, doc.storageKey), 'Tampered');
    await expect(readDownload(actor, result.id)).rejects.toThrow('integrity');
  });
});
