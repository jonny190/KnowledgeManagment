import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@km/db";
import { getCurrentUserId } from "@/lib/session";

export default async function WorkspacesPage() {
  const userId = await getCurrentUserId();
  if (!userId) redirect("/login");
  const memberships = await prisma.membership.findMany({
    where: { userId },
    include: { workspace: true },
    orderBy: { workspace: { name: "asc" } },
  });

  return (
    <main className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Workspaces</h1>
        <Link className="underline" href="/workspaces/new">Create workspace</Link>
      </div>
      {memberships.length === 0 ? (
        <p>You are not a member of any workspaces yet.</p>
      ) : (
        <ul className="space-y-2">
          {memberships.map((m) => (
            <li key={m.id}>
              <Link href={`/workspaces/${m.workspace.id}/members`} className="underline">
                {m.workspace.name}
              </Link>{" "}
              <span className="text-sm text-gray-500">({m.role})</span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
