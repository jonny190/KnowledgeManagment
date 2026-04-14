import { redirect } from "next/navigation";
import { getCurrentUserId } from "@/lib/session";
import { assertCanAccessVault, AuthzError } from "@/lib/authz";
import { VaultSwitcher } from "@/components/VaultSwitcher";
import { FileTree } from "@/components/FileTree";
import { TagsSidebar } from "@/components/TagsSidebar";

export default async function VaultShell({ params }: { params: { vaultId: string } }) {
  const userId = await getCurrentUserId();
  if (!userId) redirect("/login");
  try {
    await assertCanAccessVault(userId, params.vaultId, "MEMBER");
  } catch (e) {
    if (e instanceof AuthzError) redirect("/workspaces");
    throw e;
  }
  return (
    <div className="grid grid-cols-[260px_1fr] h-screen">
      <aside className="border-r p-3 space-y-3 overflow-auto">
        <VaultSwitcher currentVaultId={params.vaultId} />
        <FileTree vaultId={params.vaultId} />
        <TagsSidebar />
      </aside>
      <section className="p-6 text-gray-500">Select or create a note.</section>
    </div>
  );
}
