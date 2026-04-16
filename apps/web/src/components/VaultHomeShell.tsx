"use client";
import { useState, type ReactNode, Children } from "react";
import { Drawer } from "./Drawer";
import { MobileTopBar } from "./MobileTopBar";

export function VaultHomeShell({
  vaultId,
  children,
}: {
  vaultId: string;
  children: ReactNode;
}) {
  // children are expected in this order: [VaultSwitcher, FileTree, TagsSidebar]
  const [switcher, fileTree, tags] = Children.toArray(children);
  const [drawer, setDrawer] = useState<null | "tags">(null);

  return (
    <div className="flex h-screen flex-col md:grid md:grid-cols-[260px_1fr]">
      <MobileTopBar
        title="Vault"
        buttons={[
          { key: "tags", label: "Tags", onClick: () => setDrawer("tags") },
        ]}
      />

      <aside className="hidden md:flex md:flex-col md:gap-3 md:overflow-auto md:border-r md:p-3">
        {switcher}
        {fileTree}
        {tags}
      </aside>

      <div className="md:hidden flex-1 overflow-auto p-3">
        {switcher}
        {fileTree}
      </div>

      <section className="hidden md:block p-6 text-gray-500">Select or create a note.</section>

      <Drawer open={drawer === "tags"} onClose={() => setDrawer(null)} side="left" title="Tags">
        {tags}
      </Drawer>
    </div>
  );
}
