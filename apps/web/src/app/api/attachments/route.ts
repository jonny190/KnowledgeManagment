import { NextResponse } from 'next/server';
import { prisma } from '@km/db';
import { requireUserId } from '@/lib/session';
import { assertCanAccessVault, AuthzError } from '@/lib/authz';
import {
  persistAttachment,
  AttachmentTooLargeError,
  AttachmentTypeError,
} from '@/lib/attachments';

export async function POST(req: Request) {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const form = await req.formData();
  const vaultId = form.get('vaultId');
  const file = form.get('file');
  if (typeof vaultId !== 'string' || !(file instanceof Blob)) {
    return NextResponse.json({ error: 'bad request' }, { status: 400 });
  }

  try {
    await assertCanAccessVault(userId, vaultId, 'MEMBER');
  } catch (e) {
    if (e instanceof AuthzError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  const filename = (file as File).name ?? 'file';
  const mimeType = file.type || 'application/octet-stream';
  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    const persisted = await persistAttachment({ vaultId, filename, mimeType, buffer });
    const row = await prisma.attachment.create({
      data: {
        id: persisted.id,
        vaultId,
        filename,
        mimeType,
        size: persisted.size,
        storagePath: persisted.storagePath,
        uploadedById: userId,
      },
    });
    return NextResponse.json(
      { id: row.id, markdown: `![](/api/attachments/${row.id})` },
      { status: 201 },
    );
  } catch (e) {
    if (e instanceof AttachmentTooLargeError) {
      return NextResponse.json({ error: 'too large' }, { status: 413 });
    }
    if (e instanceof AttachmentTypeError) {
      return NextResponse.json({ error: 'unsupported type' }, { status: 415 });
    }
    throw e;
  }
}
