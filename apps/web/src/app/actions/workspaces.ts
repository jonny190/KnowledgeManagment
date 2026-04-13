"use server";

import { prisma } from "@km/db";
import { createWorkspaceInput, slugify } from "@km/shared";

export async function createWorkspace(userId: string, rawInput: unknown) {
  const input = createWorkspaceInput.parse(rawInput);
  const baseSlug = slugify(input.name);

  return prisma.$transaction(async (tx) => {
    let slug = baseSlug;
    let suffix = 1;
    while (await tx.workspace.findUnique({ where: { slug } })) {
      suffix += 1;
      slug = `${baseSlug}-${suffix}`;
    }

    const ws = await tx.workspace.create({
      data: { name: input.name, slug, ownerId: userId },
    });
    await tx.membership.create({
      data: { workspaceId: ws.id, userId, role: "OWNER" },
    });
    const vault = await tx.vault.create({
      data: { ownerType: "WORKSPACE", ownerId: ws.id, name: input.name },
    });
    await tx.folder.create({
      data: { vaultId: vault.id, parentId: null, name: "", path: "" },
    });
    return { workspace: ws, vault };
  });
}
