import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface RenderFolder {
  id: string;
  path: string;
}

export interface RenderNote {
  title: string;
  folderId: string | null;
  content: string;
}

export interface RenderInput {
  outDir: string;
  folders: RenderFolder[];
  notes: RenderNote[];
}

const INVALID_CHARS = /[/\\:*?"<>|]/g;

function sanitiseFileName(name: string): string {
  const trimmed = name.trim().replace(INVALID_CHARS, "-");
  return trimmed.length === 0 ? "Untitled" : trimmed;
}

export async function renderVaultToDirectory(input: RenderInput): Promise<void> {
  const folderById = new Map<string, RenderFolder>();
  for (const f of input.folders) folderById.set(f.id, f);

  for (const folder of input.folders) {
    if (folder.path === "") continue;
    await mkdir(join(input.outDir, folder.path), { recursive: true });
  }
  await mkdir(input.outDir, { recursive: true });

  const usedByDir = new Map<string, Set<string>>();

  for (const note of input.notes) {
    const folder = note.folderId ? folderById.get(note.folderId) : undefined;
    const relDir = folder ? folder.path : "";
    const baseDir = join(input.outDir, relDir);
    await mkdir(baseDir, { recursive: true });

    const base = sanitiseFileName(note.title);
    const used = usedByDir.get(relDir) ?? new Set<string>();
    let candidate = `${base}.md`;
    let i = 2;
    while (used.has(candidate)) {
      candidate = `${base} (${i}).md`;
      i += 1;
    }
    used.add(candidate);
    usedByDir.set(relDir, used);

    await writeFile(join(baseDir, candidate), note.content, "utf8");
  }
}
