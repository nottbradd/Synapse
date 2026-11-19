import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import ForceGraph2D, { type ForceGraphMethods } from "react-force-graph-2d";
import { ArrowLeft, Focus, Minus, Plus, RotateCcw } from "lucide-react";
import type { Exploration, GraphAction } from "../interaction/exploration";
import type { SettledNetwork } from "../interaction/allNotesLayout";
import AllNotesGraph from "./AllNotesGraph";
import type { Snapshot } from "../types";
import { GraphScene } from "../interaction/graphScene";
import { nodeScreenRadius, type SceneNode } from "../interaction/topology";
import { useReducedMotion } from "../hooks/useReducedMotion";
import TransitionTitle from "./TransitionTitle";
import { registerPresentation } from "../startup/presentation";
export interface GraphProps {
  snapshot: Snapshot;
  exploration: Exploration;
  onNavigate: (action: GraphAction) => void;
  selected?: string;
  query: string;
  left: number;
  drawer: RefObject<HTMLDivElement | null>;
  editorWidth: number;
  auxiliaryOpen?: boolean;
  onOpen: (id: string) => void;
  onNewNote: () => void;
}
export default function Graph(props: GraphProps) {
  // App keys this component by vault root. Only this vault's last topology is retained.
  const [cache] = useState(() => new Map<string, SettledNetwork>());
  return props.exploration.scope.kind === "all-notes" ? (
    <AllNotesGraph {...props} cache={cache} />
  ) : (
    <ScopedGraph {...props} />
  );
}
function ScopedGraph({
  snapshot,
  exploration,
  onNavigate,
  selected,
  query,
  left,
  drawer,
  editorWidth,
  auxiliaryOpen = false,
  onOpen,
  onNewNote,
}: GraphProps) {
  const container = useRef<HTMLDivElement>(null),
    graph = useRef<ForceGraphMethods<SceneNode>>(undefined),
    heading = useRef<HTMLElement>(null),
    controls = useRef<HTMLDivElement>(null),
    zoomText = useRef<HTMLSpanElement>(null);
  const sceneRef = useRef<GraphScene | null>(null);
  if (!sceneRef.current) sceneRef.current = new GraphScene();
  const scene = sceneRef.current;
  scene.exploration = exploration;
  const [size, setSize] = useState({
      width: window.innerWidth,
      height: window.innerHeight,
    }),
    reduced = useReducedMotion();
  const data = scene.topology.update(
      snapshot,
      exploration.scope,
      exploration.revision,
      exploration.restore,
    ),
    topology = scene.topology.key;
  const [dragLayout, setDragLayout] = useState("");
  const openAt = (event: MouseEvent) => {
    const bounds = container.current?.getBoundingClientRect();
    if (!bounds) return;
    const node = scene.hitTest(
      event.clientX - bounds.left,
      event.clientY - bounds.top,
    );
    if (!node) return;
    if (node.role === "subnetwork") onNavigate({ subject: node.subject_id });
    else onOpen(node.id);
  };
  useEffect(() => scene.attach(), [scene]);
  useEffect(() => {
    let frame = 0;
    const observer = new ResizeObserver(([e]) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() =>
        setSize({ width: e.contentRect.width, height: e.contentRect.height }),
      );
    });
    observer.observe(container.current!);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);
  useLayoutEffect(() => {
    scene.api = graph.current;
    scene.container = container.current;
    scene.drawer = drawer;
    scene.heading = heading.current;
    scene.controls = controls.current;
    scene.zoomText = zoomText.current;
    const sidebar = document.querySelector(".sidebar")?.getBoundingClientRect();
    scene.configure(
      snapshot,
      selected,
      query,
      {
        ...size,
        left: sidebar?.right ?? left,
        top: (heading.current?.getBoundingClientRect().bottom ?? 68) + 24,
        bottom:
          size.height -
          (controls.current?.getBoundingClientRect().top ?? size.height - 64) +
          24,
      },
      editorWidth,
      reduced,
      auxiliaryOpen,
    );
  }, [
    snapshot,
    selected,
    query,
    size,
    left,
    editorWidth,
    reduced,
    scene,
    drawer,
    auxiliaryOpen,
    exploration,
    exploration.revision,
  ]);
  useEffect(() => scene.installForces(), [scene, topology]);
  useLayoutEffect(
    () => registerPresentation(container.current!, () => scene.presentation()),
    [scene],
  );
  const scope = exploration.scope,
    title =
      scope.kind === "topic"
        ? snapshot.notes.find((n) => n.id === scope.note)?.title
        : scope.kind === "subnetwork"
          ? snapshot.organization.subjects.find((s) => s.id === scope.subject)
              ?.name
          : scope.kind === "overview" && scope.neuron
            ? snapshot.organization.neurons.find((n) => n.id === scope.neuron)
                ?.name
            : "All Neurons";
  return (
    <div
      className="graph"
      ref={container}
      onPointerMove={scene.wake}
      onPointerDown={scene.wake}
      onWheel={scene.wake}
      onPointerLeave={() => scene.setHover()}
    >
      <div
        className="graph-surface"
        data-swarm="graph"
        onPointerLeave={() => scene.setHover()}
      >
        <ForceGraph2D
          ref={graph}
          width={size.width}
          height={size.height}
          graphData={data}
          backgroundColor="rgba(0,0,0,0)"
          nodeId="id"
          nodeLabel=""
          autoPauseRedraw={false}
          onNodeClick={(_node, event) => openAt(event)}
          onBackgroundClick={openAt}
          onLinkClick={(_link, event) => openAt(event)}
          onNodeHover={(n) =>
            scene.setHover(n && scene.isInteractive(n) ? n.id : undefined)
          }
          onZoom={() => scene.manual()}
          onNodeDrag={(n) => {
            scene.topology.reveal.pin(n);
            if (dragLayout !== topology) setDragLayout(topology);
            scene.engine = true;
            scene.wake();
          }}
          onNodeDragEnd={(n) => {
            n.fx = n.x;
            n.fy = n.y;
            scene.topology.reveal.pin(n);
            scene.wake();
          }}
          onEngineStop={() => scene.engineStopped()}
          cooldownTicks={
            scene.topology.nested
              ? 0
              : scene.topology.layoutChanged || dragLayout === topology
                ? 90
                : 0
          }
          warmupTicks={scene.topology.layoutChanged ? 80 : 0}
          d3AlphaDecay={0.055}
          linkCanvasObject={(link, ctx, scale) =>
            scene.drawEdge(link, ctx, scale)
          }
          linkCanvasObjectMode={() => "replace"}
          nodeCanvasObject={(n, ctx, scale) => scene.drawNode(n, ctx, scale)}
          nodePointerAreaPaint={(n, color, ctx) => {
            if (!scene.isInteractive(n)) return;
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(
              n.x ?? 0,
              n.y ?? 0,
              Math.max(nodeScreenRadius(n, scene.motion.frame.zoom), 8) /
                scene.motion.frame.zoom,
              0,
              Math.PI * 2,
            );
            ctx.fill();
          }}
          onRenderFramePost={(ctx) => scene.draw(ctx)}
        />
      </div>
      <header
        className="graph-heading"
        ref={heading}
        style={{ left: left + 28 }}
      >
        {exploration.history.length > 0 && (
          <button
            className="graph-back"
            aria-label="Back to previous network"
            onClick={() => onNavigate("back")}
          >
            <ArrowLeft size={17} /> Back
          </button>
        )}
        <h1 title={title} data-swarm="text">
          <TransitionTitle text={title ?? "All Neurons"} />
        </h1>
        <span data-swarm="text">
          {scope.kind === "overview"
            ? `${scene.topology.visibleNodes.length} subnetworks`
            : scope.kind === "topic"
              ? `${Math.max(0, scene.topology.visibleNodes.length - 1)} linked concepts`
              : `${scene.topology.visibleNodes.length} topics`}
        </span>
      </header>
      {scope.kind === "topic" && scene.topology.visibleNodes.length === 1 && (
        <div
          className="network-empty"
          data-swarm="box"
          style={{ left: left + 28, right: selected ? editorWidth + 60 : 28 }}
        >
          No linked concepts yet. Add a WikiLink in this note to connect
          existing knowledge.
        </div>
      )}
      {!scene.topology.visibleNodes.length && (
        <div
          className="graph-empty"
          data-swarm="box"
          style={{ left: left + 24, right: selected ? editorWidth + 56 : 24 }}
        >
          <h2>No notes yet</h2>
          <button onClick={onNewNote}>
            <Plus size={17} />
            New note
          </button>
        </div>
      )}
      <div className="graph-controls glass" ref={controls} data-swarm="box">
        <details className="network-browser">
          <summary aria-label="Browse current network">Browse</summary>
          <div>
            {scene.topology.visibleNodes.map((n) => (
              <button
                key={n.id}
                onClick={(e) => {
                  e.currentTarget.closest("details")?.removeAttribute("open");
                  if (n.role === "subnetwork")
                    onNavigate({ subject: n.subject_id });
                  else onOpen(n.id);
                }}
              >
                {n.title}
              </button>
            ))}
          </div>
        </details>
        <button
          title="Zoom out"
          aria-label="Zoom out"
          onClick={() => scene.zoomBy(1 / 1.3)}
        >
          <Minus size={16} />
        </button>
        <span ref={zoomText}>100%</span>
        <button
          title="Zoom in"
          aria-label="Zoom in"
          onClick={() => scene.zoomBy(1.3)}
        >
          <Plus size={16} />
        </button>
        <button
          title="Fit all notes"
          aria-label="Fit graph"
          onClick={() => scene.fit()}
        >
          <Focus size={17} />
        </button>
        <button
          title="Return to overview"
          aria-label="Return to overview"
          onClick={() => onNavigate("overview")}
        >
          <RotateCcw size={16} />
        </button>
      </div>
    </div>
  );
}
