import { describe, it, expect } from "vitest";
import { prisma } from "@km/db";
import { searchNotes } from "./search";
import { makeVaultWithNotes } from "../test/factories";

describe("searchNotes", () => {
  it("returns empty for query shorter than 2 chars", async () => {
    const r = await searchNotes({ vaultId: "v", query: "a", limit: 10 });
    expect(r).toEqual([]);
  });

  it("ranks title matches above body matches", async () => {
    const { vault, user } = await makeVaultWithNotes([]);
    // Title match: "welcome" in title (weight A) and generic body
    await prisma.note.create({
      data: {
        vaultId: vault.id,
        title: "Welcome",
        slug: "welcome",
        content: "intro text",
        createdById: user.id,
        updatedById: user.id,
      },
    });
    // Body match only: "welcome" buried in body
    await prisma.note.create({
      data: {
        vaultId: vault.id,
        title: "Other",
        slug: "other",
        content: "welcome in body",
        createdById: user.id,
        updatedById: user.id,
      },
    });
    const r = await searchNotes({ vaultId: vault.id, query: "welcome", limit: 10 });
    expect(r[0].title).toBe("Welcome");
  });

  it("sanitises snippet to only <mark> tags", async () => {
    const { vault, user } = await makeVaultWithNotes([]);
    await prisma.note.create({
      data: {
        vaultId: vault.id,
        title: "hello script",
        slug: "script",
        content: "hello world danger text",
        createdById: user.id,
        updatedById: user.id,
      },
    });
    const r = await searchNotes({ vaultId: vault.id, query: "hello", limit: 10 });
    expect(r.length).toBeGreaterThan(0);
    expect(r[0].snippet).not.toContain("<script>");
    expect(r[0].snippet).toContain("<mark>");
  });
});
