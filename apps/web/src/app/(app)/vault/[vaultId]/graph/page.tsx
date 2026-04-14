"use client";
import { useEffect, useRef, useState, useMemo } from "react";
import { useRouter, useParams } from "next/navigation";

export default function GraphPage() {
  const { vaultId } = useParams<{ vaultId: string }>();
  const router = useRouter();
  const ref = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<any>(null);
  const [data, setData] = useState<{ nodes: any[]; edges: any[] } | null>(null);
  const [filter, setFilter] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/vaults/${vaultId}/graph`)
      .then((r) => r.json())
      .then(setData);
  }, [vaultId]);

  useEffect(() => {
    if (!data || !ref.current) return;

    let cy: any;
    let destroyed = false;

    (async () => {
      const [cytoscapeModule, fcoseModule] = await Promise.all([
        import("cytoscape"),
        import("cytoscape-fcose"),
      ]);
      const cytoscape = cytoscapeModule.default;
      const fcose = fcoseModule.default;

      if (!cytoscape.prototype.hasInitialisedPlugin?.("fcose")) {
        cytoscape.use(fcose);
      }

      if (destroyed || !ref.current) return;

      cy = cytoscape({
        container: ref.current,
        elements: [
          ...data.nodes.map((n) => ({
            data: { ...n },
            style: {
              width: 10 + Math.sqrt(n.backlinkCount) * 6,
              height: 10 + Math.sqrt(n.backlinkCount) * 6,
            },
          })),
          ...data.edges.map((e) => ({ data: e })),
        ],
        layout: { name: "fcose", animate: false } as any,
        style: [
          {
            selector: "node",
            style: {
              label: "data(label)",
              "background-color": "var(--accent, #2563eb)",
              color: "var(--fg, #111827)",
              "font-size": 10,
            },
          },
          {
            selector: "edge",
            style: {
              "line-color": "var(--border, #e5e7eb)",
              width: 1,
              opacity: 0.4,
            },
          },
          { selector: ".hidden", style: { display: "none" } },
        ],
      });

      cy.on("tap", "node", (evt: any) => {
        router.push(`/vault/${vaultId}/note/${evt.target.id()}`);
      });

      cyRef.current = cy;
    })();

    return () => {
      destroyed = true;
      cy?.destroy();
      cyRef.current = null;
    };
  }, [data, vaultId, router]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.nodes().forEach((n: any) => {
      const label = (n.data("label") ?? "").toLowerCase();
      const tags = (n.data("tags") ?? []) as string[];
      const passFilter = filter.length === 0 || label.includes(filter.toLowerCase());
      const passTag = !activeTag || tags.includes(activeTag);
      n.toggleClass("hidden", !(passFilter && passTag));
    });
  }, [filter, activeTag, data]);

  const allTags = useMemo(() => {
    const s = new Set<string>();
    data?.nodes.forEach((n) => n.tags.forEach((t: string) => s.add(t)));
    return [...s].sort();
  }, [data]);

  return (
    <div className="flex flex-col h-full">
      <div className="p-2 flex gap-2 border-b border-[var(--border,#e5e7eb)]">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by title..."
          className="rounded border px-2 py-1 bg-[var(--bg,#fff)]"
        />
        <select
          value={activeTag ?? ""}
          onChange={(e) => setActiveTag(e.target.value || null)}
          className="rounded border px-2 py-1 bg-[var(--bg,#fff)]"
        >
          <option value="">All tags</option>
          {allTags.map((t) => (
            <option key={t} value={t}>
              #{t}
            </option>
          ))}
        </select>
        <button
          onClick={() => cyRef.current?.layout({ name: "fcose", animate: false } as any).run()}
          className="rounded border px-2 py-1"
        >
          Reset layout
        </button>
      </div>
      <div ref={ref} className="flex-1" />
    </div>
  );
}
