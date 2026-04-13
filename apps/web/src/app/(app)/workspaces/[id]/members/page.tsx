import { redirect } from "next/navigation";
import { prisma } from "@km/db";
import { getCurrentUserId } from "@/lib/session";
import { generateInviteToken } from "@/lib/invite-token";
import { sendInviteEmail } from "@/lib/email";
import { roleAtLeast, Role } from "@km/shared";

export default async function MembersPage({ params }: { params: { id: string } }) {
  const userId = await getCurrentUserId();
  if (!userId) redirect("/login");
  const workspaceId = params.id;
  const membership = await prisma.membership.findFirst({ where: { workspaceId, userId } });
  if (!membership) redirect("/workspaces");
  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
  const members = await prisma.membership.findMany({
    where: { workspaceId },
    include: { user: true },
    orderBy: { role: "asc" },
  });
  const canInvite = roleAtLeast(membership.role as Role, "ADMIN");

  async function invite(formData: FormData) {
    "use server";
    const uid = await getCurrentUserId();
    if (!uid) redirect("/login");
    const m = await prisma.membership.findFirst({ where: { workspaceId, userId: uid } });
    if (!m || !roleAtLeast(m.role as Role, "ADMIN")) return;
    const email = String(formData.get("email") ?? "");
    const role = String(formData.get("role") ?? "MEMBER") as "ADMIN" | "MEMBER";
    const { token, tokenHash } = generateInviteToken();
    await prisma.invite.create({
      data: {
        workspaceId,
        email,
        tokenHash,
        role,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7),
      },
    });
    const inviter = await prisma.user.findUnique({ where: { id: uid }, select: { name: true } });
    const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
    await sendInviteEmail({
      to: email,
      workspaceName: workspace.name,
      acceptUrl: `${baseUrl}/invites/${token}`,
      inviterName: inviter?.name ?? null,
    });
  }

  return (
    <main className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold">{workspace.name} members</h1>
      <ul className="space-y-1">
        {members.map((m) => (
          <li key={m.id}>
            {m.user.email} <span className="text-sm text-gray-500">({m.role})</span>
          </li>
        ))}
      </ul>
      {canInvite && (
        <form action={invite} className="space-y-2 max-w-md">
          <h2 className="text-lg font-semibold">Invite a member</h2>
          <input name="email" type="email" required placeholder="email@example.com" className="border rounded px-2 py-1 w-full" />
          <select name="role" className="border rounded px-2 py-1 w-full">
            <option value="MEMBER">Member</option>
            <option value="ADMIN">Admin</option>
          </select>
          <button type="submit" className="border rounded px-3 py-1">Send invite</button>
          <p className="text-xs text-gray-500">The invite link is logged to the server console in v1.</p>
        </form>
      )}
    </main>
  );
}
