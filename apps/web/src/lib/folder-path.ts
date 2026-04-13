import type { PrismaClient, Prisma } from "@prisma/client";

export function computeChildPath(parentPath: string, childName: string): string {
  return parentPath.length === 0 ? childName : `${parentPath}/${childName}`;
}

type Tx = PrismaClient | Prisma.TransactionClient;

export async function recomputeDescendantPaths(tx: Tx, folderId: string): Promise<void> {
  const root = await tx.folder.findUnique({
    where: { id: folderId },
    select: { id: true, path: true, vaultId: true },
  });
  if (!root) return;

  const queue: Array<{ id: string; path: string }> = [{ id: root.id, path: root.path }];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const children = await tx.folder.findMany({
      where: { parentId: current.id },
      select: { id: true, name: true },
    });
    for (const child of children) {
      const newPath = computeChildPath(current.path, child.name);
      await tx.folder.update({ where: { id: child.id }, data: { path: newPath } });
      queue.push({ id: child.id, path: newPath });
    }
  }
}
