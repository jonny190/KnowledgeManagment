import { describe, it, expect, vi } from "vitest";
import { createFolder } from "../createFolder";

describe("createFolder tool", () => {
  it("rejects names outside 1..120 chars", () => {
    expect(() => createFolder.parse({ vaultId: "clvault", name: "" })).toThrow();
    expect(() => createFolder.parse({ vaultId: "clvault", name: "n".repeat(121) })).toThrow();
  });

  it("creates a folder at vault root when parentId omitted", async () => {
    const folderCreate = vi.fn(async ({ data }: { data: { path: string; name: string; vaultId: string; parentId: string | null } }) => ({
      id: "f1",
      ...data,
    }));
    const prisma = {
      folder: { findUnique: vi.fn(), create: folderCreate },
    };
    const ctx = {
      userId: "u1",
      vaultId: "clvault0000000000000000000",
      prisma: prisma as unknown as import("@km/db").PrismaClient,
    };
    const args = createFolder.parse({
      vaultId: "clvault0000000000000000000",
      name: "Projects",
    });
    const result = await createFolder.execute(args, ctx);
    expect(result).toEqual({
      folderId: "f1",
      path: "Projects",
      undo: { kind: "create_folder", id: "f1" },
    });
    expect(folderCreate).toHaveBeenCalledWith({
      data: {
        vaultId: "clvault0000000000000000000",
        parentId: null,
        name: "Projects",
        path: "Projects",
      },
    });
  });

  it("nests under a parent folder and computes the path", async () => {
    const folderCreate = vi.fn(async ({ data }: { data: { path: string } }) => ({
      id: "f2",
      ...data,
    }));
    const prisma = {
      folder: {
        findUnique: vi.fn().mockResolvedValue({
          vaultId: "clvault0000000000000000000",
          path: "Projects",
        }),
        create: folderCreate,
      },
    };
    const ctx = {
      userId: "u1",
      vaultId: "clvault0000000000000000000",
      prisma: prisma as unknown as import("@km/db").PrismaClient,
    };
    const args = createFolder.parse({
      vaultId: "clvault0000000000000000000",
      name: "Q2",
      parentId: "clparent0000000000000000000",
    });
    const result = await createFolder.execute(args, ctx);
    expect(result.path).toBe("Projects/Q2");
  });
});
