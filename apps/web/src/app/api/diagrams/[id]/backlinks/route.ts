import { NextResponse } from 'next/server';
import { requireUserId } from '@/lib/session';
import { assertCanAccessVault, AuthzError } from '@/lib/authz';
import { prisma } from '@km/db';

type Ctx = { params: { id: string } };

export async function GET(_req: Request, { params }: Ctx) {
  const userId = await requireUserId();
  const diagram = await prisma.diagram.findUnique({ where: { id: params.id } });
  if (!diagram) return NextResponse.json({ error: 'not found' }, { status: 404 });
  try {
    await assertCanAccessVault(userId, diagram.vaultId, 'MEMBER');
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  const links = await prisma.link.findMany({
    where: { targetDiagramId: diagram.id },
    include: { sourceNote: { select: { id: true, title: true, slug: true } } },
  });
  return NextResponse.json({ links });
}
