import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { TextDecoder } from 'node:util';
import { z } from 'zod';
import { assertCompany, DomainError } from '../domain/access';
import type { Actor, Document } from '../domain/model';
import { audit, getDocument, getJob, insertDocument } from './repository';

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const metadataSchema = z.object({
  companyId: z.string().min(1).max(64),
  jobId: z.string().min(1).max(64).optional(),
  title: z.string().trim().min(1).max(200),
});
const root = () =>
  path.resolve(/* turbopackIgnore: true */ process.env.STORAGE_DIR || '.local/storage');
const fileTypes = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  txt: 'text/plain',
} as const;

/** Filename and declared MIME are hints; evidence type is checked against the bytes. */
export function validateFile(
  name: string,
  declaredType: string,
  bytes: Uint8Array,
): { extension: string; mimeType: string } {
  if (bytes.byteLength === 0) throw new DomainError('Choose a non-empty file.');
  if (bytes.byteLength > MAX_UPLOAD_BYTES)
    throw new DomainError('Files must be 15 MiB or smaller.');
  const extension = name.split('.').pop()?.toLowerCase();
  if (!extension || !(extension in fileTypes))
    throw new DomainError('Upload a PDF, PNG, JPEG or plain text file.');
  const mimeType = fileTypes[extension as keyof typeof fileTypes];
  if (declaredType && declaredType !== 'application/octet-stream' && declaredType !== mimeType)
    throw new DomainError('The file type does not match its name.');
  const b = Buffer.from(bytes);
  const valid =
    extension === 'pdf'
      ? b.subarray(0, 5).toString() === '%PDF-'
      : extension === 'png'
        ? b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : extension === 'jpg' || extension === 'jpeg'
          ? b[0] === 255 && b[1] === 216 && b[2] === 255
          : true;
  if (!valid) throw new DomainError('The file content does not match its type.');
  if (extension === 'txt') {
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw new DomainError('Text files must use UTF-8 encoding.');
    }
    if (b.includes(0)) throw new DomainError('The text file contains binary content.');
  }
  return { extension, mimeType };
}

export function safeStoragePath(storageKey: string) {
  if (!/^[0-9a-f-]{36}\.(pdf|png|jpg|jpeg|txt)$/.test(storageKey))
    throw new DomainError('Document storage reference is invalid.', 'STORAGE', 500);
  return path.join(/* turbopackIgnore: true */ root(), storageKey);
}

export async function storeUpload(
  actor: Actor,
  input: { companyId: string; jobId?: string; title: string; file: File },
) {
  const meta = metadataSchema.parse(input);
  assertCompany(actor, meta.companyId);
  if (
    !actor.capabilities.some((cap) => ['prepare_job', 'review_pack', 'record_filing'].includes(cap))
  )
    throw new DomainError('You do not have permission to attach evidence.', 'FORBIDDEN', 403);
  let classification: Document['classification'] = 'General';
  if (meta.jobId) {
    const job = await getJob(actor, meta.jobId);
    if (job.activity === 'W06') classification = 'BO';
    if (job.companyId !== meta.companyId)
      throw new DomainError('The job and evidence must belong to the same company.');
  }
  if (!input.file || typeof input.file.arrayBuffer !== 'function')
    throw new DomainError('Choose a file to upload.');
  if (input.file.size > MAX_UPLOAD_BYTES) throw new DomainError('Files must be 15 MiB or smaller.');
  const bytes = Buffer.from(await input.file.arrayBuffer());
  const { extension, mimeType } = validateFile(input.file.name, input.file.type, bytes);
  const storageKey = `${randomUUID()}.${extension}`;
  const doc: Document = {
    id: randomUUID(),
    companyId: meta.companyId,
    jobId: meta.jobId || null,
    title: meta.title,
    originalName: path
      .basename(input.file.name)
      .replace(/[\r\n\x00-\x1f]/g, '')
      .slice(0, 200),
    mimeType,
    size: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    storageKey,
    createdBy: actor.id,
    createdAt: new Date().toISOString(),
    classification,
  };
  await mkdir(root(), { recursive: true, mode: 0o700 });
  const destination = safeStoragePath(storageKey);
  await writeFile(destination, bytes, { flag: 'wx', mode: 0o600 });
  try {
    await insertDocument(actor, doc);
  } catch (error) {
    await unlink(destination).catch(() => undefined);
    throw error;
  }
  const { storageKey: privateKey, ...metadata } = doc;
  void privateKey;
  return metadata;
}

export async function readDownload(actor: Actor, id: string) {
  const document = await getDocument(actor, id);
  assertCompany(actor, document.companyId);
  let bytes: Buffer;
  try {
    bytes = await readFile(/* turbopackIgnore: true */ safeStoragePath(document.storageKey));
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw new DomainError(
      'The stored file is unavailable. Restore the coordinated file backup.',
      'STORAGE',
      503,
    );
  }
  if (
    bytes.byteLength !== document.size ||
    createHash('sha256').update(bytes).digest('hex') !== document.sha256
  )
    throw new DomainError('The stored file failed its integrity check.', 'STORAGE', 503);
  await audit(actor, document.companyId, 'document.download', document.id, {
    sha256: document.sha256,
  });
  return { document, bytes };
}
