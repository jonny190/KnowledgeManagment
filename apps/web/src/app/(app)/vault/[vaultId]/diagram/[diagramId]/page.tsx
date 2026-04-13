import { notFound } from 'next/navigation';
import { requireUserId } from '@/lib/session';
import { assertCanAccessVault } from '@/lib/authz';
import { prisma } from '@km/db';
import { DiagramHost } from './DiagramHost';

export default async function DiagramPage({
  params,
}: {
  params: { vaultId: string; diagramId: string };
}) {
  const userId = await requireUserId();
  const diagram = await prisma.diagram.findUnique({
    where: { id: params.diagramId },
  });
  if (!diagram || diagram.vaultId !== params.vaultId) return notFound();
  try {
    await assertCanAccessVault(userId, diagram.vaultId, 'MEMBER');
  } catch {
    return notFound();
  }

  return (
    <div style={{ height: 'calc(100vh - 3rem)' }}>
      <DiagramHost
        id={diagram.id}
        kind={diagram.kind}
        title={diagram.title}
        xml={diagram.xml}
        updatedAt={diagram.updatedAt.toISOString()}
      />
    </div>
  );
}
