import { prisma } from "@km/db";
import { Role, roleAtLeast } from "@km/shared";

export class AuthzError extends Error {
  status: number;
  constructor(message: string, status = 403) {
    super(message);
    this.name = "AuthzError";
    this.status = status;
  }
}

export interface VaultAccess {
  vault: { id: string; ownerType: "USER" | "WORKSPACE"; ownerId: string; name: string };
  role: Role;
}

export async function assertCanAccessVault(
  userId: string,
  vaultId: string,
  requiredRole: Role
): Promise<VaultAccess> {
  if (!userId) throw new AuthzError("Not authenticated", 401);

  const vault = await prisma.vault.findUnique({
    where: { id: vaultId },
    select: { id: true, ownerType: true, ownerId: true, name: true },
  });
  if (!vault) throw new AuthzError("Vault not found", 404);

  if (vault.ownerType === "USER") {
    if (vault.ownerId !== userId) {
      throw new AuthzError("Forbidden");
    }
    return { vault, role: "OWNER" };
  }

  const membership = await prisma.membership.findFirst({
    where: { workspaceId: vault.ownerId, userId },
    select: { role: true },
  });
  if (!membership) throw new AuthzError("Forbidden");
  if (!roleAtLeast(membership.role as Role, requiredRole)) {
    throw new AuthzError("Insufficient role");
  }
  return { vault, role: membership.role as Role };
}
