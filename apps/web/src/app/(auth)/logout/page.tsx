"use client";
import { useEffect } from "react";
import { signOut } from "next-auth/react";

export default function LogoutPage() {
  useEffect(() => {
    signOut({ callbackUrl: "/" });
  }, []);
  return (
    <main style={{ padding: 24, fontFamily: "system-ui" }}>
      <p>Logging out...</p>
    </main>
  );
}
