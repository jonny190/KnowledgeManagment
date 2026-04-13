import Link from "next/link";
import { getServerAuthSession } from "@/lib/session";

export default async function HomePage() {
  const session = await getServerAuthSession();
  return (
    <main style={{ padding: 24, fontFamily: "system-ui" }}>
      <h1>Knowledge Management</h1>
      {session ? (
        <p>
          Signed in as {session.user?.email}. <Link href="/logout">Log out</Link>
        </p>
      ) : (
        <p>
          <Link href="/login">Log in</Link> or <Link href="/signup">Sign up</Link>
        </p>
      )}
    </main>
  );
}
