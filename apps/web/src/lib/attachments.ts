import { createReadStream } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

const DATA_DIR = process.env.DATA_DIR ?? '/data';
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const ALLOWED_MIME_PREFIXES = ['image/', 'application/pdf', 'text/', 'video/', 'audio/'];

export class AttachmentTooLargeError extends Error {
  constructor() {
    super('attachment too large');
  }
}

export class AttachmentTypeError extends Error {
  constructor(mime: string) {
    super(`unsupported mime type: ${mime}`);
  }
}

export function attachmentDir(vaultId: string): string {
  return path.join(DATA_DIR, 'vaults', vaultId, 'attachments');
}

export function attachmentPath(vaultId: string, id: string, filename: string): string {
  return path.join(attachmentDir(vaultId), `${id}-${sanitizeFilename(filename)}`);
}

export function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'file';
}

export function validateMime(mime: string): void {
  if (!ALLOWED_MIME_PREFIXES.some((p) => mime.startsWith(p))) {
    throw new AttachmentTypeError(mime);
  }
}

export async function persistAttachment(params: {
  vaultId: string;
  filename: string;
  mimeType: string;
  buffer: Buffer;
}): Promise<{ id: string; storagePath: string; size: number }> {
  if (params.buffer.byteLength > MAX_ATTACHMENT_BYTES) {
    throw new AttachmentTooLargeError();
  }
  validateMime(params.mimeType);
  const id = randomUUID();
  const dir = attachmentDir(params.vaultId);
  await mkdir(dir, { recursive: true });
  const storagePath = attachmentPath(params.vaultId, id, params.filename);
  await writeFile(storagePath, params.buffer);
  return { id, storagePath, size: params.buffer.byteLength };
}

export async function openAttachment(storagePath: string) {
  const s = await stat(storagePath);
  return { size: s.size, stream: createReadStream(storagePath) };
}
