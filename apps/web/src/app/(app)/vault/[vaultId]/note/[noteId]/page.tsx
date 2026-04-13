import { redirect, notFound } from "next/navigation";
import { prisma } from "@km/db";
import { getCurrentUserId } from "@/lib/session";
import { assertCanAccessVault, AuthzError } from "@/lib/authz";
import { VaultSwitcher } from "@/components/VaultSwitcher";
import { FileTree } from "@/components/FileTree";
import { NoteEditor } from "@/components/NoteEditor";

export default async function NotePage({
  params,
}: {
  params: { vaultId: string; noteId: string };
}) {
  const userId = await getCurrentUserId();
  if (!userId) redirect("/login");
  try {
    await assertCanAccessVault(userId, params.vaultId, "MEMBER");
  } catch (e) {
    if (e instanceof AuthzError) redirect("/workspaces");
    throw e;
  }
  const note = await prisma.note.findUnique({ where: { id: params.noteId } });
  if (!note || note.vaultId !== params.vaultId) notFound();

  return (
    <div className="grid grid-cols-[260px_1fr] h-screen">
      <aside className="border-r p-3 space-y-3 overflow-auto">
        <VaultSwitcher currentVaultId={params.vaultId} />
        <FileTree vaultId={params.vaultId} />
      </aside>
      <section className="h-screen">
        <NoteEditor noteId={note.id} initialTitle={note.title} initialContent={note.content} />
      </section>
    </div>
  );
}
