"use client";

import { useEffect, useState } from "react";
import type { Awareness } from "y-protocols/awareness";

interface LiveUser {
  id: string;
  name: string;
  color: string;
}

export function ActiveUsers({ awareness }: { awareness: Awareness | null }) {
  const [users, setUsers] = useState<LiveUser[]>([]);

  useEffect(() => {
    if (!awareness) return;
    const read = () => {
      const out: LiveUser[] = [];
      awareness.getStates().forEach((state) => {
        const u = (state as { user?: LiveUser }).user;
        if (u && u.id) out.push(u);
      });
      // Dedupe by id.
      const seen = new Set<string>();
      setUsers(
        out.filter((u) => {
          if (seen.has(u.id)) return false;
          seen.add(u.id);
          return true;
        }),
      );
    };
    read();
    awareness.on("change", read);
    return () => awareness.off("change", read);
  }, [awareness]);

  return (
    <div data-testid="active-users" style={{ display: "flex", gap: 4 }}>
      {users.map((u) => (
        <span
          key={u.id}
          title={u.name}
          style={{
            width: 24,
            height: 24,
            borderRadius: 12,
            background: u.color,
            color: "white",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 11,
            fontWeight: 600,
          }}
        >
          {u.name.slice(0, 1).toUpperCase()}
        </span>
      ))}
    </div>
  );
}
