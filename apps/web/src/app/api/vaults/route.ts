import { NextResponse } from "next/server";
import { prisma } from "@km/db";
import { requireUserId } from "@/lib/session";

export async function GET(_req: Request) {
  const userId = await requireUserId();

  const personal = await prisma.vault.findMany({
    where: { ownerType: "USER", ownerId: userId },
    select: { id: true, name: true, ownerType: true, ownerId: true },
  });

  const memberships = await prisma.membership.findMany({
    where: { userId },
    select: { workspaceId: true, role: true },
  });
  const workspaceIds = memberships.map((m) => m.workspaceId);

  const workspaceVaults = await prisma.vault.findMany({
    where: { ownerType: "WORKSPACE", ownerId: { in: workspaceIds } },
    select: { id: true, name: true, ownerType: true, ownerId: true },
  });

  const vaults = [
    ...personal.map((v) => ({ ...v, workspaceId: null, role: "OWNER" as const })),
    ...workspaceVaults.map((v) => ({
      ...v,
      workspaceId: v.ownerId,
      role: memberships.find((m) => m.workspaceId === v.ownerId)!.role,
    })),
  ];

  return NextResponse.json({ vaults });
}
