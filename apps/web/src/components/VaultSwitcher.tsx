"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

interface VaultItem {
  id: string;
  name: string;
  ownerType: "USER" | "WORKSPACE";
}

export function VaultSwitcher({ currentVaultId }: { currentVaultId: string }) {
  const router = useRouter();
  const [vaults, setVaults] = useState<VaultItem[]>([]);

  useEffect(() => {
    fetch("/api/vaults")
      .then((r) => r.json())
      .then((d) => setVaults(d.vaults ?? []));
  }, []);

  return (
    <select
      value={currentVaultId}
      onChange={(e) => router.push(`/vault/${e.target.value}`)}
      className="border rounded px-2 py-1 w-full"
    >
      {vaults.map((v) => (
        <option key={v.id} value={v.id}>
          {v.ownerType === "USER" ? "Personal" : v.name}
        </option>
      ))}
    </select>
  );
}
