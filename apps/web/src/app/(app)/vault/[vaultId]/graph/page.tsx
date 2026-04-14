"use client";
import { useEffect, useRef, useState, useMemo } from "react";
import { useRouter, useParams } from "next/navigation";

interface GraphNode {
  id: string;
  label: string;
  title: string;
  slug: string;
  backlinkCount: number;
  tags: string[];
}

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  targetTitle: string;
}

interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export default function GraphPage() {
  const { vaultId } = useParams<{ vaultId: string }>();
  const router = useRouter();
  const ref = useRef<HTMLDivElement | null>(null);
  // cytoscape Core is typed by @types/cytoscape but we load it dynamically, so keep as unknown
  const cyRef = useRef<unknown>(null);
  const [data, setData] = useState<GraphData | null>(null);
  const [filter, setFilter] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/vaults/${vaultId}/graph`)
      .then((r) => r.json())
      .then((d: GraphData) => setData(d));
  }, [vaultId]);

  useEffect(() => {
    if (!data || !ref.current) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cy.on("tap", "node", (evt: any) => {
        router.push(`/vault/${vaultId}/note/${evt.target.id()}`);
      });

      cyRef.current = cy;
    })();

    return () => {
      destroyed = true;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (cy as any)?.destroy();
      cyRef.current = null;
    };
  }, [data, vaultId, router]);

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cy = cyRef.current as any;
    if (!cy) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cy.nodes().forEach((n: any) => {
      const label = (n.data("label") ?? "") as string;
      const tags = (n.data("tags") ?? []) as string[];
      const passFilter = filter.length === 0 || label.toLowerCase().includes(filter.toLowerCase());
      const passTag = !activeTag || tags.includes(activeTag);
      n.toggleClass("hidden", !(passFilter && passTag));
    });
  }, [filter, activeTag, data]);

  const allTags = useMemo(() => {
    const s = new Set<string>();
    data?.nodes.forEach((n) => n.tags.forEach((t) => s.add(t)));
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
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onClick={() => (cyRef.current as any)?.layout({ name: "fcose", animate: false } as any).run()}
          className="rounded border px-2 py-1"
        >
          Reset layout
        </button>
      </div>
      <div ref={ref} className="flex-1" />
    </div>
  );
}
