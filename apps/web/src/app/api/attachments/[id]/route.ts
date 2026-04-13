import { NextResponse } from 'next/server';
import { prisma } from '@km/db';
import { requireUserId } from '@/lib/session';
import { assertCanAccessVault, AuthzError } from '@/lib/authz';
import { openAttachment } from '@/lib/attachments';
import { Readable } from 'node:stream';

export async function GET(_req: Request, ctx: { params: { id: string } }) {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const row = await prisma.attachment.findUnique({ where: { id: ctx.params.id } });
  if (!row) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  try {
    await assertCanAccessVault(userId, row.vaultId, 'MEMBER');
  } catch (e) {
    if (e instanceof AuthzError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  const { stream, size } = await openAttachment(row.storagePath);
  const web = Readable.toWeb(stream) as unknown as ReadableStream;
  return new Response(web, {
    status: 200,
    headers: {
      'Content-Type': row.mimeType,
      'Content-Length': String(size),
      'Content-Disposition': `inline; filename="${row.filename.replace(/"/g, '')}"`,
    },
  });
}
