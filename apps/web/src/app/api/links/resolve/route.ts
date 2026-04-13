import { NextResponse } from 'next/server';
import { requireUserId } from '@/lib/session';
import { assertCanAccessVault, AuthzError } from '@/lib/authz';
import { prisma } from '@km/db';
import { resolveLinkTargets } from '@/lib/links';

export async function GET(req: Request) {
  const userId = await requireUserId();
  const url = new URL(req.url);
  const vaultId = url.searchParams.get('vaultId');
  const title = url.searchParams.get('title');
  if (!vaultId || !title) {
    return NextResponse.json({ error: 'missing vaultId or title' }, { status: 400 });
  }
  try {
    await assertCanAccessVault(userId, vaultId, 'MEMBER');
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  const [target] = await resolveLinkTargets(prisma, vaultId, [title]);
  return NextResponse.json(target);
}
