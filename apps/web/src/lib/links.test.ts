import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@km/db";
import { recomputeLinks, resolveLinkTargets } from "./links";

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
  return { vault, source, target, user };
}

async function cleanDb() {
  await prisma.link.deleteMany({});
  await prisma.note.deleteMany({});
  await prisma.diagram.deleteMany({});
  await prisma.folder.deleteMany({});
  await prisma.vault.deleteMany({});
  await prisma.user.deleteMany({});
}

describe("recomputeLinks", () => {
  beforeEach(async () => {
    await cleanDb();
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

  it("resolves diagram links when no note matches", async () => {
    const { vault, source, user } = await seed();
    await prisma.diagram.create({
      data: {
        vaultId: vault.id,
        kind: "DRAWIO",
        title: "FlowChart",
        slug: "flowchart",
        xml: "<mxfile/>",
        createdById: user.id,
        updatedById: user.id,
      },
    });
    await prisma.$transaction((tx) =>
      recomputeLinks(tx, source.id, vault.id, "see [[FlowChart]]"),
    );
    const links = await prisma.link.findMany({ where: { sourceNoteId: source.id } });
    expect(links).toHaveLength(1);
    expect(links[0]!.resolved).toBe(true);
    expect(links[0]!.targetDiagramId).toBeTruthy();
    expect(links[0]!.targetNoteId).toBeNull();
  });
});

describe("resolveLinkTargets", () => {
  beforeEach(async () => {
    await cleanDb();
  });

  it("resolves a title to a diagram when no matching note exists", async () => {
    const { vault, user } = await seed();
    await prisma.diagram.create({
      data: {
        vaultId: vault.id,
        kind: "DRAWIO",
        title: "Architecture",
        slug: "architecture",
        xml: "<mxfile/>",
        createdById: user.id,
        updatedById: user.id,
      },
    });
    const results = await resolveLinkTargets(prisma, vault.id, ["Architecture"]);
    expect(results[0]).toMatchObject({ title: "Architecture", kind: "diagram" });
    expect(results[0]!.id).toBeTruthy();
  });

  it("prefers note over diagram when both exist", async () => {
    const { vault, user } = await seed();
    await prisma.note.create({
      data: {
        vaultId: vault.id,
        title: "Overview",
        slug: "overview",
        content: "",
        createdById: user.id,
        updatedById: user.id,
      },
    });
    await prisma.diagram.create({
      data: {
        vaultId: vault.id,
        kind: "BPMN",
        title: "Overview",
        slug: "overview-d",
        xml: "<x/>",
        createdById: user.id,
        updatedById: user.id,
      },
    });
    const results = await resolveLinkTargets(prisma, vault.id, ["Overview"]);
    expect(results[0]!.kind).toBe("note");
  });

  it("returns kind null when no note or diagram matches", async () => {
    const { vault } = await seed();
    const results = await resolveLinkTargets(prisma, vault.id, ["Ghost"]);
    expect(results[0]).toMatchObject({ title: "Ghost", kind: null, id: null });
  });

  it("returns empty array for empty titles input", async () => {
    const { vault } = await seed();
    const results = await resolveLinkTargets(prisma, vault.id, []);
    expect(results).toHaveLength(0);
  });
});
