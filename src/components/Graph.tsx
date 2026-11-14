import { useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D, {
  type ForceGraphMethods,
  type NodeObject,
} from "react-force-graph-2d";
import { Focus, Minus, Plus, RotateCcw } from "lucide-react";
import { inLocation, type Snapshot, type Note } from "../types";
import { placeLabels } from "../graphLabels";
type GraphNode = NodeObject & Note;
const radius = (n: Note) => Math.min(9, 4.5 + Math.sqrt(n.neighbors) * 0.8);
export default function Graph({
  snapshot,
  selected,
  query,
  left,
  right,
  onOpen,
  onNewNote,
}: {
  snapshot: Snapshot;
  selected?: string;
  query: string;
  left: number;
  right: number;
  onOpen: (id: string) => void;
  onNewNote: () => void;
}) {
  const container = useRef<HTMLDivElement>(null),
    graph = useRef<ForceGraphMethods<GraphNode>>(undefined),
    positions = useRef(new Map<string, GraphNode>()),
    zoomFrame = useRef<number | null>(null),
    nextZoom = useRef(1);
  const [size, setSize] = useState({ width: 1200, height: 800 }),
    [hover, setHover] = useState<string | null>(null),
    [zoom, setZoom] = useState(1);
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    duration = reduce ? 0 : 220;
  useEffect(() => {
    const observer = new ResizeObserver(([e]) =>
      setSize({ width: e.contentRect.width, height: e.contentRect.height }),
    );
    observer.observe(container.current!);
    return () => {
      observer.disconnect();
      if (zoomFrame.current !== null) cancelAnimationFrame(zoomFrame.current);
      zoomFrame.current = null;
    };
  }, []);
  const scope = snapshot.organization.location;
  const data = useMemo(() => {
    const nodes = snapshot.notes
      .filter((n) => inLocation(n, snapshot.organization.location))
      .map((n) => {
        const old = positions.current.get(n.id);
        const node = old ? Object.assign(old, n) : { ...n };
        positions.current.set(n.id, node);
        return node;
      });
    const visible = new Set(nodes.map((n) => n.id));
    return {
      nodes,
      links: snapshot.edges
        .filter((e) => visible.has(e.source) && visible.has(e.target))
        .map((e) => ({ ...e })),
    };
  }, [snapshot.notes, snapshot.edges, snapshot.organization.location]);
  const activeNodes = useRef<GraphNode[]>([]);
  activeNodes.current = data.nodes;
  const related = useMemo(() => {
    const set = new Set<string>();
    const active = hover ?? selected;
    if (active) {
      set.add(active);
      for (const e of snapshot.edges) {
        if (e.source === active) set.add(e.target);
        if (e.target === active) set.add(e.source);
      }
    }
    return set;
  }, [hover, selected, snapshot.edges]);
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
  const colors = new Map(
    snapshot.organization.subjects.map((s) => [s.id, s.color]),
  );
  useEffect(() => {
    const api = graph.current;
    if (!api) return;
    (
      api.d3Force("charge") as { strength: (n: number) => void } | undefined
    )?.strength(-190);
    (
      api.d3Force("link") as { distance: (n: number) => void } | undefined
    )?.distance(92);
    // A local grid keeps collision work bounded; labels use a separate screen-space pass.
    api.d3Force("collide", (alpha: number) => {
      const cells = new Map<string, GraphNode[]>();
      for (const n of activeNodes.current) {
        const cx = Math.floor((n.x ?? 0) / 28),
          cy = Math.floor((n.y ?? 0) / 28);
        for (let x = cx - 1; x <= cx + 1; x++)
          for (let y = cy - 1; y <= cy + 1; y++)
            for (const other of cells.get(`${x},${y}`) ?? []) {
              const dx = (n.x ?? 0) - (other.x ?? 0),
                dy = (n.y ?? 0) - (other.y ?? 0),
                distance = Math.hypot(dx, dy) || 0.1,
                min = radius(n) + radius(other) + 5;
              if (distance < min) {
                const push = ((min - distance) / distance) * alpha * 0.5;
                n.vx = (n.vx ?? 0) + dx * push;
                n.vy = (n.vy ?? 0) + dy * push;
                other.vx = (other.vx ?? 0) - dx * push;
                other.vy = (other.vy ?? 0) - dy * push;
              }
            }
        const key = `${cx},${cy}`;
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key)!.push(n);
      }
    });
    api.d3ReheatSimulation();
  }, [data.nodes.length]);
  const usable = {
    x: left + 24,
    y: 92,
    width: Math.max(60, size.width - left - right - 48),
    height: Math.max(60, size.height - 180),
  };
  function fit() {
    const api = graph.current,
      b = api?.getGraphBbox();
    if (!api || !b) return;
    const k = Math.min(
      2.2,
      usable.width / (b.x[1] - b.x[0] + 70),
      usable.height / (b.y[1] - b.y[0] + 70),
    );
    api.zoom(k, duration);
    api.centerAt(
      (b.x[0] + b.x[1]) / 2 -
        (usable.x + usable.width / 2 - size.width / 2) / k,
      (b.y[0] + b.y[1]) / 2 -
        (usable.y + usable.height / 2 - size.height / 2) / k,
      duration,
    );
  }
  const title = scope.subject_id
    ? snapshot.organization.subjects.find((s) => s.id === scope.subject_id)
        ?.name
    : scope.neuron_id
      ? snapshot.organization.neurons.find((n) => n.id === scope.neuron_id)
          ?.name
      : "All Neurons";
  const idOf = (n: unknown) =>
    typeof n === "object" && n !== null && "id" in n ? String(n.id) : String(n);
  return (
    <div className="graph" ref={container}>
      <ForceGraph2D
        ref={graph}
        width={size.width}
        height={size.height}
        graphData={data}
        backgroundColor="#14191d"
        nodeId="id"
        nodeLabel=""
        onNodeClick={(n) => onOpen(n.id)}
        onNodeHover={(n) => setHover(n?.id ?? null)}
        onZoom={({ k }) => {
          // The Canvas wrapper can report zoom synchronously while applying
          // resize props. Coalesce updates outside its React render phase.
          nextZoom.current = k;
          if (zoomFrame.current === null)
            zoomFrame.current = requestAnimationFrame(() => {
              zoomFrame.current = null;
              setZoom(nextZoom.current);
            });
        }}
        onNodeDragEnd={(n) => {
          n.fx = n.x;
          n.fy = n.y;
        }}
        onEngineStop={() => {
          for (const n of positions.current.values()) {
            n.fx = n.x;
            n.fy = n.y;
          }
        }}
        cooldownTicks={reduce ? 45 : 140}
        warmupTicks={40}
        d3AlphaDecay={0.035}
        linkColor={(l) =>
          related.has(idOf(l.source)) && related.has(idOf(l.target))
            ? "#78878d"
            : hover
              ? "#272f34"
              : "#354047"
        }
        linkWidth={0.7}
        nodeCanvasObject={(n, ctx, scale) => {
          const active = n.id === selected,
            over = n.id === hover,
            r = radius(n),
            x = n.x ?? 0,
            y = n.y ?? 0,
            color = colors.get(n.subject_id) ?? "#64748b";
          ctx.globalAlpha =
            (query && !matches.has(n.id)) || (hover && !related.has(n.id))
              ? 0.22
              : 1;
          ctx.beginPath();
          ctx.arc(x, y, r + (active ? 1.5 : 0), 0, Math.PI * 2);
          ctx.fillStyle = color + (active || over ? "cc" : "66");
          ctx.fill();
          ctx.strokeStyle = active ? "#f1f5f7" : over ? "#c7d2da" : color;
          ctx.lineWidth = (active ? 2 : 1) / scale;
          ctx.stroke();
          ctx.globalAlpha = 1;
        }}
        nodePointerAreaPaint={(n, color, ctx) => {
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(
            n.x ?? 0,
            n.y ?? 0,
            Math.max(radius(n), 7 / zoom),
            0,
            Math.PI * 2,
          );
          ctx.fill();
        }}
        onRenderFramePost={(ctx, scale) => {
          const api = graph.current;
          if (!api) return;
          ctx.save();
          const ratio = ctx.canvas.width / size.width;
          ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
          ctx.font = "13px Segoe UI, sans-serif";
          const height =
            Math.ceil(
              ctx.measureText("Ag").actualBoundingBoxAscent +
                ctx.measureText("Ag").actualBoundingBoxDescent,
            ) + 7;
          const nodes = data.nodes.map((n) => {
            const p = api.graph2ScreenCoords(n.x ?? 0, n.y ?? 0);
            return {
              id: n.id,
              x: p.x,
              y: p.y,
              radius: radius(n) * scale,
              title: n.title,
              priority:
                n.id === selected
                  ? 1000
                  : n.id === hover
                    ? 900
                    : query && matches.has(n.id)
                      ? 700
                      : query
                        ? 0
                        : scale < 0.65
                          ? 0
                          : scale < 1 && n.neighbors < 3
                            ? 0
                            : 100 +
                              Math.min(n.neighbors, 60) +
                              (related.has(n.id) ? 80 : 0),
            };
          });
          const labels = placeLabels(
            nodes,
            usable,
            (t) => ctx.measureText(t).width,
            height,
          );
          ctx.textAlign = "left";
          ctx.textBaseline = "middle";
          for (const l of labels) {
            ctx.fillStyle = "#14191de8";
            ctx.fillRect(l.x, l.y, l.width, l.height);
            ctx.fillStyle = l.priority >= 700 ? "#f0f4f6" : "#bac6cd";
            ctx.fillText(l.text, l.x + 4, l.y + l.height / 2);
          }
          ctx.restore();
        }}
      />
      <header
        className="graph-heading"
        style={{ left: left + 28, right: right + 28 }}
      >
        <h1 title={title}>{title}</h1>
        <span>
          {data.nodes.length} {data.nodes.length === 1 ? "note" : "notes"}
        </span>
      </header>
      {!data.nodes.length && (
        <div
          className="graph-empty"
          style={{ left: left + 24, right: right + 24 }}
        >
          <h2>No notes yet</h2>
          <button onClick={onNewNote}>
            <Plus size={17} />
            New note
          </button>
        </div>
      )}
      <div
        className="graph-controls glass"
        style={{ left: left + (size.width - left - right) / 2 }}
      >
        <button
          title="Zoom out"
          aria-label="Zoom out"
          onClick={() => graph.current?.zoom(zoom / 1.3, duration)}
        >
          <Minus size={16} />
        </button>
        <span>{Math.round(zoom * 100)}%</span>
        <button
          title="Zoom in"
          aria-label="Zoom in"
          onClick={() => graph.current?.zoom(zoom * 1.3, duration)}
        >
          <Plus size={16} />
        </button>
        <button title="Fit graph" aria-label="Fit graph" onClick={fit}>
          <Focus size={17} />
        </button>
        <button
          title="Reset graph view"
          aria-label="Reset graph view"
          onClick={() => {
            graph.current?.centerAt(0, 0, duration);
            graph.current?.zoom(1, duration);
          }}
        >
          <RotateCcw size={16} />
        </button>
      </div>
    </div>
  );
}
