import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { TextDecoder } from 'node:util';
import { z } from 'zod';
import { assertCompany, DomainError } from '../domain/access';
import type { Actor, Document } from '../domain/model';
import { audit, getDocument, getJob, insertDocument, type Transaction } from './repository';
import * as schema from './schema';

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
  // .docx keys are written only by storeGenerated; uploads still reject Word files.
  if (!/^[0-9a-f-]{36}\.(pdf|png|jpg|jpeg|txt|docx)$/.test(storageKey))
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

/** `audit: false` only for callers that record their own, more specific download audit. */
export async function readDownload(actor: Actor, id: string, options: { audit?: boolean } = {}) {
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
  if (options.audit !== false)
    await audit(actor, document.companyId, 'document.download', document.id, {
      sha256: document.sha256,
    });
  return { document, bytes };
}

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
/**
 * Stores server-generated DOCX bytes privately: a new unique file, then the document row and
 * audit (inside the caller's transaction when given). The file is removed if the insert fails;
 * a caller whose transaction later rolls back must remove `storageKey` itself.
 */
export async function storeGenerated(
  actor: Actor,
  input: {
    companyId: string;
    jobId: string | null;
    title: string;
    fileName: string;
    bytes: Buffer;
    generationId: string;
    /** Pre-allocated `<uuid>.docx` key, so a caller can clean up after a later failure. */
    storageKey?: string;
  },
  tx?: Transaction,
) {
  assertCompany(actor, input.companyId);
  if (!actor.capabilities.some((cap) => ['generate_documents', 'prepare_job'].includes(cap)))
    throw new DomainError('You do not have permission to generate documents.', 'FORBIDDEN', 403);
  const b = input.bytes;
  if (!b.byteLength || b.subarray(0, 4).toString('binary') !== 'PK\x03\x04')
    throw new DomainError('The generated document is not a Word package.', 'STORAGE', 500);
  const storageKey = input.storageKey ?? `${randomUUID()}.docx`;
  if (!storageKey.endsWith('.docx'))
    throw new DomainError('Generated files must be Word documents.', 'STORAGE', 500);
  const doc: Document = {
    id: randomUUID(),
    companyId: input.companyId,
    jobId: input.jobId,
    title: metadataSchema.shape.title.parse(input.title.slice(0, 200)),
    originalName: path
      .basename(input.fileName)
      .replace(/[\r\n\x00-\x1f"\\/]/g, '')
      .slice(0, 200),
    mimeType: DOCX_MIME,
    size: b.byteLength,
    sha256: createHash('sha256').update(b).digest('hex'),
    storageKey,
    createdBy: actor.id,
    createdAt: new Date().toISOString(),
    classification: 'General',
    generationId: input.generationId,
  };
  await mkdir(root(), { recursive: true, mode: 0o700 });
  const destination = safeStoragePath(storageKey);
  await writeFile(destination, b, { flag: 'wx', mode: 0o600 });
  const insert = async (t: Transaction) => {
    await t.insert(schema.documents).values({ id: doc.id, companyId: doc.companyId, data: doc });
    await audit(
      actor,
      doc.companyId,
      'document.stored',
      doc.id,
      { sha256: doc.sha256, size: doc.size, generationId: input.generationId },
      t,
    );
  };
  try {
    if (tx) await insert(tx);
    else await (await import('./db')).transaction(insert);
  } catch (error) {
    await unlink(destination).catch(() => undefined);
    throw error;
  }
  return doc;
}

/** Removes a stored file by key (orphan cleanup). Missing files are ignored. */
export async function removeStoredFile(storageKey: string) {
  await unlink(safeStoragePath(storageKey)).catch(() => undefined);
}
/** Generated files on disk, for orphan reconciliation. */
export async function listGeneratedFiles() {
  const names = await readdir(root()).catch(() => [] as string[]);
  const out: { storageKey: string; modifiedAt: number }[] = [];
  for (const name of names)
    if (/^[0-9a-f-]{36}\.docx$/.test(name))
      out.push({ storageKey: name, modifiedAt: (await stat(path.join(root(), name))).mtimeMs });
  return out;
}
