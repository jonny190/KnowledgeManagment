import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@km/db";
import { recomputeLinks } from "./links";

async function seed() {
  const user = await prisma.user.create({ data: { email: `u${Date.now()}@t.io` } });
  const vault = await prisma.vault.create({
    data: { ownerType: "USER", ownerId: user.id, name: "V" },
  });
  const source = await prisma.note.create({
    data: {
      vaultId: vault.id,
      title: "Source",
      slug: "source",
      content: "",
      createdById: user.id,
      updatedById: user.id,
    },
  });
  const target = await prisma.note.create({
    data: {
      vaultId: vault.id,
      title: "Target",
      slug: "target",
      content: "",
      createdById: user.id,
      updatedById: user.id,
    },
  });
  return { vault, source, target };
}

describe("recomputeLinks", () => {
  beforeEach(async () => {
    await prisma.link.deleteMany({});
    await prisma.note.deleteMany({});
    await prisma.vault.deleteMany({});
    await prisma.user.deleteMany({});
  });

  it("writes resolved and unresolved links", async () => {
    const { vault, source } = await seed();
    await prisma.$transaction((tx) =>
      recomputeLinks(tx, source.id, vault.id, "hi [[Target]] and [[Missing]]"),
    );
    const links = await prisma.link.findMany({ where: { sourceNoteId: source.id } });
    expect(links).toHaveLength(2);
    const resolved = links.find((l) => l.targetTitle === "Target");
    const missing = links.find((l) => l.targetTitle === "Missing");
    expect(resolved?.resolved).toBe(true);
    expect(missing?.resolved).toBe(false);
    expect(missing?.targetNoteId).toBeNull();
  });

  it("replaces previous links on re-run", async () => {
    const { vault, source } = await seed();
    await prisma.$transaction((tx) =>
      recomputeLinks(tx, source.id, vault.id, "[[Target]]"),
    );
    await prisma.$transaction((tx) =>
      recomputeLinks(tx, source.id, vault.id, "no links now"),
    );
    const links = await prisma.link.findMany({ where: { sourceNoteId: source.id } });
    expect(links).toHaveLength(0);
  });
});
