import { getServerSession } from "next-auth";
import { authOptions } from "./auth";

export function getServerAuthSession() {
  return getServerSession(authOptions);
}

export async function getCurrentUserId(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  const user = session?.user as { id?: string } | undefined;
  return user?.id ?? null;
}

export async function requireUserId(): Promise<string> {
  const id = await getCurrentUserId();
  if (!id) {
    throw new Response("Unauthorized", { status: 401 });
  }
  return id;
}
