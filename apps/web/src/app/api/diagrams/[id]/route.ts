import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { requireUserId } from '@/lib/session';
import { assertCanAccessVault, AuthzError } from '@/lib/authz';
import { prisma } from '@km/db';
import { diagramPatchSchema, slugifyDiagramTitle } from '@km/shared';

type Ctx = { params: { id: string } };

async function loadDiagramAndAuthz(userId: string, diagramId: string) {
  const diagram = await prisma.diagram.findUnique({ where: { id: diagramId } });
  if (!diagram) return { error: NextResponse.json({ error: 'not found' }, { status: 404 }) };
  try {
    await assertCanAccessVault(userId, diagram.vaultId, 'MEMBER');
  } catch (e) {
    if (e instanceof AuthzError) return { error: NextResponse.json({ error: e.message }, { status: e.status }) };
    throw e;
  }
  return { diagram };
}

export async function GET(_req: Request, { params }: Ctx) {
  const userId = await requireUserId();
  const { error, diagram } = await loadDiagramAndAuthz(userId, params.id);
  if (error) return error;
  return NextResponse.json(diagram);
}

export async function PATCH(req: Request, { params }: Ctx) {
  const userId = await requireUserId();
  const { error, diagram } = await loadDiagramAndAuthz(userId, params.id);
  if (error) return error;

  let input;
  try {
    input = diagramPatchSchema.parse(await req.json());
  } catch (e) {
    if (e instanceof ZodError) return NextResponse.json({ error: e.flatten() }, { status: 400 });
    throw e;
  }

  if (
    input.expectedUpdatedAt &&
    new Date(input.expectedUpdatedAt).getTime() !== diagram!.updatedAt.getTime()
  ) {
    return NextResponse.json({ error: 'stale' }, { status: 409 });
  }

  const data: Record<string, unknown> = { updatedById: userId };
  if (input.title) {
    data['title'] = input.title;
    data['slug'] = await uniqueDiagramSlug(
      diagram!.vaultId,
      slugifyDiagramTitle(input.title) || 'diagram',
      diagram!.id,
    );
  }
  if (input.folderId !== undefined) data['folderId'] = input.folderId;
  if (input.xml !== undefined) {
    data['xml'] = input.xml;
    data['contentUpdatedAt'] = new Date();
  }

  const updated = await prisma.diagram.update({
    where: { id: diagram!.id },
    data,
  });
  return NextResponse.json(updated);
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const userId = await requireUserId();
  const { error, diagram } = await loadDiagramAndAuthz(userId, params.id);
  if (error) return error;
  await prisma.diagram.delete({ where: { id: diagram!.id } });
  return new NextResponse(null, { status: 204 });
}

async function uniqueDiagramSlug(
  vaultId: string,
  base: string,
  excludeId: string,
): Promise<string> {
  let slug = base;
  let n = 1;
  // eslint-disable-next-line no-constant-condition
  for (;;) {
    const existing = await prisma.diagram.findUnique({
      where: { vaultId_slug: { vaultId, slug } },
    });
    if (!existing || existing.id === excludeId) return slug;
    n += 1;
    slug = `${base}-${n}`;
  }
}
