import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createZip } from "../src/fs/zip";

describe("createZip", () => {
  it("produces a readable zip containing source files", async () => {
    const src = await mkdtemp(join(tmpdir(), "zip-src-"));
    const outDir = await mkdtemp(join(tmpdir(), "zip-out-"));
    await mkdir(join(src, "nested"), { recursive: true });
    await writeFile(join(src, "a.md"), "hello");
    await writeFile(join(src, "nested/b.md"), "world");

    const zipPath = join(outDir, "out.zip");
    await createZip(src, zipPath);

    const listing = execFileSync("unzip", ["-Z1", zipPath], { encoding: "utf8" })
      .split("\n")
      .filter(Boolean)
      .sort();
    expect(listing).toEqual(["a.md", "nested/b.md"].sort());

    const extracted = await mkdtemp(join(tmpdir(), "zip-ex-"));
    execFileSync("unzip", ["-q", zipPath, "-d", extracted]);
    expect(await readFile(join(extracted, "a.md"), "utf8")).toBe("hello");
    expect(await readFile(join(extracted, "nested/b.md"), "utf8")).toBe("world");
  });
});
