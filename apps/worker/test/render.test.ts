import { describe, it, expect } from "vitest";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderVaultToDirectory } from "../src/fs/render";

describe("renderVaultToDirectory", () => {
  it("writes notes under folders mirroring Folder.path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "render-"));
    await renderVaultToDirectory({
      outDir: dir,
      folders: [
        { id: "f1", path: "" },
        { id: "f2", path: "Projects" },
        { id: "f3", path: "Projects/Acme" },
      ],
      notes: [
        { title: "Welcome", folderId: "f1", content: "# Hi\n[[Other Note]]" },
        { title: "Plan", folderId: "f3", content: "body" },
      ],
    });

    const welcome = await readFile(join(dir, "Welcome.md"), "utf8");
    expect(welcome).toBe("# Hi\n[[Other Note]]");
    const plan = await readFile(join(dir, "Projects/Acme/Plan.md"), "utf8");
    expect(plan).toBe("body");
    const folderStat = await stat(join(dir, "Projects"));
    expect(folderStat.isDirectory()).toBe(true);
  });

  it("sanitises titles with slashes and preserves wiki-links verbatim", async () => {
    const dir = await mkdtemp(join(tmpdir(), "render-"));
    await renderVaultToDirectory({
      outDir: dir,
      folders: [{ id: "root", path: "" }],
      notes: [
        { title: "A/B: Test", folderId: "root", content: "[[Link|alias]]" },
      ],
    });
    const out = await readFile(join(dir, "A-B- Test.md"), "utf8");
    expect(out).toBe("[[Link|alias]]");
  });

  it("disambiguates duplicate titles in the same folder", async () => {
    const dir = await mkdtemp(join(tmpdir(), "render-"));
    await renderVaultToDirectory({
      outDir: dir,
      folders: [{ id: "root", path: "" }],
      notes: [
        { title: "Dup", folderId: "root", content: "one" },
        { title: "Dup", folderId: "root", content: "two" },
      ],
    });
    const a = await readFile(join(dir, "Dup.md"), "utf8");
    const b = await readFile(join(dir, "Dup (2).md"), "utf8");
    expect([a, b].sort()).toEqual(["one", "two"]);
  });
});
