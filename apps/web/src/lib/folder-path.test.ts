import { describe, it, expect, beforeEach } from "vitest";
import { resetDb, createUser } from "../../tests/helpers/db";
import { prisma } from "@km/db";
import { computeChildPath, recomputeDescendantPaths } from "./folder-path";

describe("folder-path", () => {
  beforeEach(async () => { await resetDb(); });

  it("computeChildPath joins parent path with child name", () => {
    expect(computeChildPath("", "Projects")).toBe("Projects");
    expect(computeChildPath("Projects", "Acme")).toBe("Projects/Acme");
  });

  it("recomputeDescendantPaths rewrites nested folder paths after rename", async () => {
    const { vault } = await createUser();
    const a = await prisma.folder.create({ data: { vaultId: vault.id, name: "A", path: "A" } });
    const b = await prisma.folder.create({ data: { vaultId: vault.id, parentId: a.id, name: "B", path: "A/B" } });
    const c = await prisma.folder.create({ data: { vaultId: vault.id, parentId: b.id, name: "C", path: "A/B/C" } });

    await prisma.folder.update({ where: { id: a.id }, data: { name: "AA", path: "AA" } });
    await recomputeDescendantPaths(prisma, a.id);

    const refreshed = await prisma.folder.findMany({ where: { vaultId: vault.id }, orderBy: { path: "asc" } });
    const paths = refreshed.map((f) => f.path).filter((p) => p !== "");
    expect(paths).toEqual(["AA", "AA/B", "AA/B/C"]);
  });
});
