import { createWriteStream } from "node:fs";
import archiver from "archiver";

export function createZip(srcDir: string, outPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(outPath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    output.on("close", () => resolve());
    output.on("error", reject);
    archive.on("error", reject);
    archive.on("warning", (err) => {
      if (err.code !== "ENOENT") reject(err);
    });

    archive.pipe(output);
    archive.glob("**/*", { cwd: srcDir, dot: false, nodir: true });
    archive.finalize();
  });
}
