import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@km/db";
import { getCurrentUserId } from "@/lib/session";
import { assertCanAccessVault, AuthzError } from "@/lib/authz";

export default async function TagIndexPage({
  params,
}: {
  params: { vaultId: string; name: string };
}) {
  const userId = await getCurrentUserId();
  if (!userId) redirect("/login");

  try {
    await assertCanAccessVault(userId, params.vaultId, "MEMBER");
  } catch (e) {
    if (e instanceof AuthzError) redirect("/workspaces");
    throw e;
  }

  const name = decodeURIComponent(params.name).toLowerCase();

  const notes = await prisma.note.findMany({
    where: {
      vaultId: params.vaultId,
      tags: { some: { tag: { name } } },
    },
    select: { id: true, title: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
  });

  return (
    <div className="p-6 max-w-3xl">
      <h1 className="text-xl font-semibold">#{name}</h1>
      <ul className="mt-4">
        {notes.map((n) => (
          <li key={n.id} className="py-1">
            <Link href={`/vault/${params.vaultId}/note/${n.id}`}>{n.title}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
