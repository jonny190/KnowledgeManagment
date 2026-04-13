import { describe, it, expect, beforeEach } from "vitest";
import { resetDb, createUser, createWorkspaceFixture } from "../../tests/helpers/db";
import { assertCanAccessVault, AuthzError } from "./authz";
import { prisma } from "@km/db";

describe("assertCanAccessVault", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("allows the owner of a personal vault", async () => {
    const { user, vault } = await createUser();
    const result = await assertCanAccessVault(user.id, vault.id, "MEMBER");
    expect(result.vault.id).toBe(vault.id);
    expect(result.role).toBe("OWNER");
  });

  it("rejects a non-owner on a personal vault", async () => {
    const { vault } = await createUser();
    const { user: other } = await createUser();
    await expect(
      assertCanAccessVault(other.id, vault.id, "MEMBER")
    ).rejects.toBeInstanceOf(AuthzError);
  });

  it("allows a workspace MEMBER on their workspace vault", async () => {
    const { user: owner } = await createUser();
    const { workspace, vault } = await createWorkspaceFixture(owner.id);
    const { user: member } = await createUser();
    await prisma.membership.create({
      data: { workspaceId: workspace.id, userId: member.id, role: "MEMBER" },
    });
    const result = await assertCanAccessVault(member.id, vault.id, "MEMBER");
    expect(result.role).toBe("MEMBER");
  });

  it("rejects MEMBER when ADMIN is required", async () => {
    const { user: owner } = await createUser();
    const { workspace, vault } = await createWorkspaceFixture(owner.id);
    const { user: member } = await createUser();
    await prisma.membership.create({
      data: { workspaceId: workspace.id, userId: member.id, role: "MEMBER" },
    });
    await expect(
      assertCanAccessVault(member.id, vault.id, "ADMIN")
    ).rejects.toBeInstanceOf(AuthzError);
  });

  it("rejects a non-member on a workspace vault", async () => {
    const { user: owner } = await createUser();
    const { vault } = await createWorkspaceFixture(owner.id);
    const { user: stranger } = await createUser();
    await expect(
      assertCanAccessVault(stranger.id, vault.id, "MEMBER")
    ).rejects.toBeInstanceOf(AuthzError);
  });

  it("throws on missing vault", async () => {
    const { user } = await createUser();
    await expect(
      assertCanAccessVault(user.id, "clnonexistent00000000000", "MEMBER")
    ).rejects.toBeInstanceOf(AuthzError);
  });
});
