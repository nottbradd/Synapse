import { useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D, {
  type ForceGraphMethods,
  type NodeObject,
} from "react-force-graph-2d";
import { Focus, RotateCcw, Minus, Plus } from "lucide-react";
import { subjects, type Snapshot, type Subject, type Note } from "../types";
type GraphNode = NodeObject & Note;
export default function Graph({
  snapshot,
  selected,
  query,
  filters,
  onOpen,
}: {
  snapshot: Snapshot;
  selected?: string;
  query: string;
  filters: Set<Subject>;
  onOpen: (id: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null),
    graph = useRef<ForceGraphMethods<GraphNode>>(undefined),
    positions = useRef(new Map<string, GraphNode>());
  const [size, setSize] = useState({ width: 800, height: 700 }),
    [hover, setHover] = useState<string | null>(null),
    [zoom, setZoom] = useState(1);
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  useEffect(() => {
    const el = container.current!;
    const observer = new ResizeObserver(([entry]) =>
      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      }),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const data = useMemo(() => {
    const nodes = snapshot.notes
      .filter((n) => filters.has(n.subject))
      .map((n) => {
        const old = positions.current.get(n.id);
        const next = old ? Object.assign(old, n) : { ...n };
        positions.current.set(n.id, next);
        return next;
      });
    const visible = new Set(nodes.map((n) => n.id));
    return {
      nodes,
      links: snapshot.edges
        .filter((e) => visible.has(e.source) && visible.has(e.target))
        .map((e) => ({ ...e })),
    };
  }, [snapshot.notes, snapshot.edges, filters]);
  const related = useMemo(() => {
    const set = new Set<string>();
    if (hover) {
      set.add(hover);
      for (const edge of snapshot.edges) {
        if (edge.source === hover) set.add(edge.target);
        if (edge.target === hover) set.add(edge.source);
      }
    }
    return set;
  }, [hover, snapshot.edges]);
  const matches = useMemo(
    () =>
      new Set(
        snapshot.notes
          .filter((n) =>
            `${n.title} ${n.id}`.toLowerCase().includes(query.toLowerCase()),
          )
          .map((n) => n.id),
      ),
    [snapshot.notes, query],
  );
  const idOf = (n: unknown): string =>
    typeof n === "object" && n !== null && "id" in n ? String(n.id) : String(n);
  const duration = reduce ? 0 : 240;
  useEffect(() => {
    const api = graph.current;
    if (!api) return;
    (
      api.d3Force("charge") as { strength: (n: number) => void } | undefined
    )?.strength(-180);
    (
      api.d3Force("link") as { distance: (n: number) => void } | undefined
    )?.distance(95);
    api.d3ReheatSimulation();
  }, [snapshot.notes.length]);
  return (
    <div className="graph" ref={container}>
      <ForceGraph2D
        ref={graph}
        width={size.width}
        height={size.height}
        graphData={data}
        backgroundColor="#09090b"
        nodeId="id"
        nodeLabel={(n) => {
          const label = document.createElement("span");
          label.textContent = `${n.title} · ${n.id}`;
          return label.innerHTML;
        }}
        onNodeClick={(n) => onOpen(n.id)}
        onNodeHover={(n) => setHover(n?.id ?? null)}
        onZoom={({ k }) => setZoom(k)}
        onNodeDragEnd={(n) => {
          n.fx = n.x;
          n.fy = n.y;
        }}
        cooldownTicks={reduce ? 80 : 160}
        warmupTicks={30}
        d3AlphaDecay={0.035}
        nodeRelSize={5}
        linkColor={(link) =>
          hover &&
          related.has(idOf(link.source)) &&
          related.has(idOf(link.target))
            ? "#71717a"
            : hover
              ? "#18181b"
              : "#303036"
        }
        linkWidth={0.7}
        nodeCanvasObject={(n, ctx, scale) => {
          const color = subjects.find((s) => s.id === n.subject)!.color;
          const r = Math.min(10, 3.5 + Math.sqrt(n.neighbors) * 1.8);
          const x = n.x ?? 0,
            y = n.y ?? 0;
          const active = n.id === selected || n.id === hover;
          ctx.globalAlpha =
            (hover && !related.has(n.id)) || (query && !matches.has(n.id))
              ? 0.18
              : 1;
          if (active) {
            ctx.beginPath();
            ctx.arc(x, y, r + 4, 0, Math.PI * 2);
            ctx.strokeStyle = "#e4e4e7";
            ctx.lineWidth = 1.2 / scale;
            ctx.stroke();
          }
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.fill();
          if (scale > 1.25 || active || (query && matches.has(n.id))) {
            ctx.font = `${12 / scale}px Segoe UI, sans-serif`;
            ctx.textAlign = "center";
            ctx.fillStyle = active ? "#fafafa" : "#a1a1aa";
            ctx.fillText(n.title, x, y + r + 16 / scale);
          }
          ctx.globalAlpha = 1;
        }}
        nodePointerAreaPaint={(n, color, ctx) => {
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(
            n.x ?? 0,
            n.y ?? 0,
            Math.max(9, Math.min(10, 3.5 + Math.sqrt(n.neighbors) * 1.8)),
            0,
            Math.PI * 2,
          );
          ctx.fill();
        }}
      />
      <div className="graph-caption">
        <span className="eyebrow">KNOWLEDGE MAP</span>
        <span>
          {data.nodes.length} notes <span className="separator">/</span>{" "}
          {data.links.length} connections
        </span>
      </div>
      {!snapshot.notes.length && (
        <div className="graph-empty">
          <h2>A place for your thinking.</h2>
          <p>
            Create your first note. Connections begin with{" "}
            <code>[[a link]]</code>.
          </p>
        </div>
      )}
      {!!snapshot.notes.length && !data.nodes.length && (
        <div className="graph-empty">
          <p>No subjects selected. Enable a subject above.</p>
        </div>
      )}
      <div className="graph-bottom">
        <span>
          Drag to explore <span className="separator">·</span> Scroll to zoom
        </span>
        <div className="toolbar raised">
          <button
            aria-label="Zoom out"
            title="Zoom out"
            onClick={() => graph.current?.zoom(zoom / 1.4, duration)}
          >
            <Minus size={15} />
          </button>
          <span>{Math.round(zoom * 100)}%</span>
          <button
            aria-label="Zoom in"
            title="Zoom in"
            onClick={() => graph.current?.zoom(zoom * 1.4, duration)}
          >
            <Plus size={15} />
          </button>
          <i />
          <button
            aria-label="Fit graph"
            title="Fit to view"
            onClick={() => graph.current?.zoomToFit(duration, 60)}
          >
            <Focus size={16} />
          </button>
          <button
            aria-label="Reset graph view"
            title="Reset view"
            onClick={() => {
              graph.current?.centerAt(0, 0, duration);
              graph.current?.zoom(1, duration);
            }}
          >
            <RotateCcw size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}
