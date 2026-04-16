export type UndoToken = { kind: "create_note" | "create_folder"; id: string };

export function undoUrl(token: UndoToken): string {
  return token.kind === "create_note"
    ? `/api/notes/${token.id}`
    : `/api/folders/${token.id}`;
}
