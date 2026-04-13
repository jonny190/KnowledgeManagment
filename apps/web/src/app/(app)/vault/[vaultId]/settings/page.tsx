import { redirect } from "next/navigation";
import { getCurrentUserId } from "@/lib/session";
import { assertCanAccessVault, AuthzError } from "@/lib/authz";
import { ExportPanel } from "./export-panel";

export default async function VaultSettingsPage({
  params,
}: {
  params: { vaultId: string };
}) {
  const userId = await getCurrentUserId();
  if (!userId) redirect("/login");
  try {
    await assertCanAccessVault(userId, params.vaultId, "MEMBER");
  } catch (e) {
    if (e instanceof AuthzError) redirect("/workspaces");
    throw e;
  }

  return (
    <main className="p-6 max-w-2xl">
      <h1 className="text-2xl font-semibold mb-6">Vault settings</h1>
      <ExportPanel vaultId={params.vaultId} />
    </main>
  );
}
