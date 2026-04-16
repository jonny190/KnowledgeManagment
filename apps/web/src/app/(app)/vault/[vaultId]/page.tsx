import { redirect } from "next/navigation";
import { getCurrentUserId } from "@/lib/session";
import { assertCanAccessVault, AuthzError } from "@/lib/authz";
import { VaultSwitcher } from "@/components/VaultSwitcher";
import { FileTree } from "@/components/FileTree";
import { TagsSidebar } from "@/components/TagsSidebar";
import { VaultHomeShell } from "@/components/VaultHomeShell";

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
    <VaultHomeShell vaultId={params.vaultId}>
      <VaultSwitcher currentVaultId={params.vaultId} />
      <FileTree vaultId={params.vaultId} />
      <TagsSidebar />
    </VaultHomeShell>
  );
}
