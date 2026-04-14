"use client";
import { useEffect, useState } from "react";
import { Command } from "cmdk";
import { useRouter } from "next/navigation";
import { pluginRegistry } from "@/lib/plugins/registry";
import { useActiveVault } from "@/hooks/useActiveVault";
import { useTheme } from "./ThemeProvider";
import type { SearchHit } from "@/lib/search";

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const router = useRouter();
  const vaultId = useActiveVault();
  const { toggle: toggleTheme } = useTheme();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open || !vaultId || query.length < 2) {
      setHits([]);
      return;
    }
    const h = setTimeout(async () => {
      try {
        const r = await fetch(
          `/api/search?vaultId=${vaultId}&q=${encodeURIComponent(query)}&limit=8`,
        );
        if (!r.ok) return;
        const { results } = await r.json();
        setHits(results ?? []);
      } catch {
        // Search errors are non-fatal.
      }
    }, 150);
    return () => clearTimeout(h);
  }, [open, query, vaultId]);

  function go(path: string) {
    setOpen(false);
    router.push(path);
  }

  return (
    <Command.Dialog open={open} onOpenChange={setOpen} label="Command palette">
      <Command.Input
        value={query}
        onValueChange={setQuery}
        placeholder="Type a command or search..."
      />
      <Command.List>
        {hits.length > 0 && (
          <Command.Group heading="Notes">
            {hits.map((h) => (
              <Command.Item
                key={h.id}
                onSelect={() => go(`/vault/${vaultId}/note/${h.id}`)}
              >
                {h.title}
              </Command.Item>
            ))}
          </Command.Group>
        )}
        <Command.Group heading="Core">
          {vaultId && (
            <Command.Item onSelect={() => go(`/vault/${vaultId}/graph`)}>
              Open graph view
            </Command.Item>
          )}
          <Command.Item onSelect={() => go("/search")}>Search notes</Command.Item>
          <Command.Item
            onSelect={() => {
              setOpen(false);
              toggleTheme();
            }}
          >
            Toggle dark mode
          </Command.Item>
          <Command.Item onSelect={() => go("/api/auth/signout")}>Log out</Command.Item>
        </Command.Group>
        {[...pluginRegistry.commands.values()].length > 0 && (
          <Command.Group heading="Plugins">
            {[...pluginRegistry.commands.values()].map(({ item }) => (
              <Command.Item
                key={item.id}
                onSelect={() => {
                  setOpen(false);
                  item.run();
                }}
              >
                {item.label}
              </Command.Item>
            ))}
          </Command.Group>
        )}
      </Command.List>
    </Command.Dialog>
  );
}
