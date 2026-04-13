import { redirect } from "next/navigation";
import { getCurrentUserId } from "@/lib/session";
import { acceptInvite } from "@/app/actions/invites";
import { prisma } from "@km/db";
import { hashInviteToken } from "@/lib/invite-token";

export default async function AcceptInvitePage({ params }: { params: { token: string } }) {
  const userId = await getCurrentUserId();
  if (!userId) {
    redirect(`/login?callbackUrl=${encodeURIComponent(`/invites/${params.token}`)}`);
  }
  const invite = await prisma.invite.findUnique({
    where: { tokenHash: hashInviteToken(params.token) },
    include: { workspace: true },
  });

  async function accept() {
    "use server";
    const uid = await getCurrentUserId();
    if (!uid) redirect(`/login?callbackUrl=${encodeURIComponent(`/invites/${params.token}`)}`);
    const result = await acceptInvite(uid, params.token);
    if (result.ok) redirect(`/workspaces/${result.workspaceId}/members`);
    redirect("/workspaces");
  }

  if (!invite) return <main className="p-6">This invite is not valid.</main>;
  if (invite.acceptedAt) return <main className="p-6">This invite has already been accepted.</main>;
  if (invite.expiresAt.getTime() < Date.now()) return <main className="p-6">This invite has expired.</main>;

  return (
    <main className="p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Join {invite.workspace.name}</h1>
      <p>You have been invited as <strong>{invite.role}</strong>.</p>
      <form action={accept}>
        <button type="submit" className="border rounded px-3 py-1">Accept invite</button>
      </form>
    </main>
  );
}
