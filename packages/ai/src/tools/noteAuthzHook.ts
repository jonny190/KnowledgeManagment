export type NoteAuthzFn = (
  userId: string,
  noteId: string,
  required: "VIEW" | "EDIT" | "OWNER",
) => Promise<{ effectiveRole: "VIEW" | "EDIT" | "OWNER" }>;

let noteAuthzHook: NoteAuthzFn | null = null;

export function setNoteAuthzHook(fn: NoteAuthzFn): void {
  noteAuthzHook = fn;
}

export function __resetNoteAuthzHookForTests(): void {
  noteAuthzHook = null;
}

export function getNoteAuthzHook(): NoteAuthzFn | null {
  return noteAuthzHook;
}
