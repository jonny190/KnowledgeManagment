"use client";
import { useEffect } from "react";
import { useSession } from "next-auth/react";
import { useActiveVault } from "@/hooks/useActiveVault";
import { loadPlugins } from "@/lib/plugins/loader";

/**
 * Mounts once inside the authenticated shell and loads the user's enabled
 * plugins from the API.  Renders nothing visible.
 */
export function PluginBootstrap() {
  const { data: session } = useSession();
  const vaultId = useActiveVault();
  const userId = (session?.user as { id?: string } | undefined)?.id;

  useEffect(() => {
    if (!userId || !vaultId) return;

    (async () => {
      try {
        const r = await fetch("/api/plugins");
        if (!r.ok) return;
        const { plugins } = await r.json();
        const allowList = (process.env.NEXT_PUBLIC_PLUGIN_ALLOWLIST ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        await loadPlugins({
          urls: (plugins as { enabled: boolean; url: string }[]).filter((p) => p.enabled).map((p) => p.url),
          allowList,
          origin: window.location.origin,
          vaultId,
          userId,
        });
      } catch {
        // Plugin loading is best-effort; errors are non-fatal.
      }
    })();
  }, [userId, vaultId]);

  return null;
}
