import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { requireUserId } from '@/lib/session';
import { assertCanAccessVault, AuthzError } from '@/lib/authz';
import { prisma } from '@km/db';
import { diagramCreateSchema, slugifyDiagramTitle } from '@km/shared';
import { blankDrawio, blankBpmn } from '@km/diagrams';

export async function POST(req: Request) {
  const userId = await requireUserId();

  let input;
  try {
    input = diagramCreateSchema.parse(await req.json());
  } catch (e) {
    if (e instanceof ZodError) return NextResponse.json({ error: e.flatten() }, { status: 400 });
    throw e;
  }

  try {
    await assertCanAccessVault(userId, input.vaultId, 'MEMBER');
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  const baseSlug = slugifyDiagramTitle(input.title) || 'diagram';
  const slug = await uniqueDiagramSlug(input.vaultId, baseSlug);
  const xml = input.kind === 'DRAWIO' ? blankDrawio() : blankBpmn();

  const diagram = await prisma.diagram.create({
    data: {
      vaultId: input.vaultId,
      folderId: input.folderId ?? null,
      kind: input.kind,
      title: input.title,
      slug,
      xml,
      createdById: userId,
      updatedById: userId,
    },
  });

  return NextResponse.json(diagram, { status: 201 });
}

async function uniqueDiagramSlug(vaultId: string, base: string): Promise<string> {
  let slug = base;
  let n = 1;
  while (await prisma.diagram.findUnique({ where: { vaultId_slug: { vaultId, slug } } })) {
    n += 1;
    slug = `${base}-${n}`;
  }
  return slug;
}
