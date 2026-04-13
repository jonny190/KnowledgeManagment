import { redirect } from "next/navigation";
import { getCurrentUserId } from "@/lib/session";
import { createWorkspace } from "@/app/actions/workspaces";

export default async function NewWorkspacePage() {
  const userId = await getCurrentUserId();
  if (!userId) redirect("/login");

  async function action(formData: FormData) {
    "use server";
    const uid = await getCurrentUserId();
    if (!uid) redirect("/login");
    const { workspace } = await createWorkspace(uid, { name: String(formData.get("name") ?? "") });
    redirect(`/workspaces/${workspace.id}/members`);
  }

  return (
    <main className="p-6 max-w-md space-y-4">
      <h1 className="text-2xl font-semibold">New workspace</h1>
      <form action={action} className="space-y-3">
        <label className="block">
          <span className="block text-sm">Name</span>
          <input name="name" required className="border rounded px-2 py-1 w-full" />
        </label>
        <button type="submit" className="border rounded px-3 py-1">Create</button>
      </form>
    </main>
  );
}
