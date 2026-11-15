import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
  type CSSProperties,
} from "react";
import ForceGraph2D, { type ForceGraphMethods } from "react-force-graph-2d";
import { Focus, Minus, Plus, RotateCcw } from "lucide-react";
import type { Snapshot } from "../types";
import { GraphScene } from "../interaction/graphScene";
import { idOf, nodeRadius, type SceneNode } from "../interaction/topology";
import { useReducedMotion } from "../hooks/useReducedMotion";
import TransitionTitle from "./TransitionTitle";
export default function Graph({
  snapshot,
  selected,
  query,
  left,
  drawer,
  editorWidth,
  onOpen,
  onNewNote,
}: {
  snapshot: Snapshot;
  selected?: string;
  query: string;
  left: number;
  drawer: RefObject<HTMLDivElement | null>;
  editorWidth: number;
  onOpen: (id: string) => void;
  onNewNote: () => void;
}) {
  const container = useRef<HTMLDivElement>(null),
    graph = useRef<ForceGraphMethods<SceneNode>>(undefined),
    heading = useRef<HTMLElement>(null),
    controls = useRef<HTMLDivElement>(null),
    zoomText = useRef<HTMLSpanElement>(null);
  const sceneRef = useRef<GraphScene | null>(null);
  if (!sceneRef.current) sceneRef.current = new GraphScene();
  const scene = sceneRef.current;
  const [size, setSize] = useState({
      width: window.innerWidth,
      height: window.innerHeight,
    }),
    reduced = useReducedMotion();
  const data = scene.topology.update(snapshot),
    topology = scene.topology.key;
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
    scene.drawer = drawer.current;
    scene.heading = heading.current;
    scene.controls = controls.current;
    scene.zoomText = zoomText.current;
    const sidebar = document.querySelector(".sidebar")?.getBoundingClientRect();
    scene.configure(
      snapshot,
      selected,
      query,
      { ...size, left: sidebar?.right ?? left },
      editorWidth,
      reduced,
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
  ]);
  useEffect(() => scene.installForces(), [scene, topology]);
  const location = snapshot.organization.location,
    title = location.subject_id
      ? snapshot.organization.subjects.find((s) => s.id === location.subject_id)
          ?.name
      : location.neuron_id
        ? snapshot.organization.neurons.find((n) => n.id === location.neuron_id)
            ?.name
        : "All Neurons";
  return (
    <div
      className="graph"
      ref={container}
      style={
        {
          "--mask-start": `${left - 16}px`,
          "--mask-end": `${left + 80}px`,
        } as CSSProperties
      }
      onPointerMove={scene.wake}
      onPointerDown={scene.wake}
      onWheel={scene.wake}
      onPointerLeave={() => scene.setHover()}
    >
      <ForceGraph2D
        ref={graph}
        width={size.width}
        height={size.height}
        graphData={data}
        backgroundColor="#091017"
        nodeId="id"
        nodeLabel=""
        autoPauseRedraw={false}
        onNodeClick={(n) => onOpen(n.id)}
        onNodeHover={(n) => scene.setHover(n?.id)}
        onZoom={() => scene.manual()}
        onNodeDrag={() => {
          scene.engine = true;
          scene.wake();
        }}
        onNodeDragEnd={(n) => {
          n.fx = n.x;
          n.fy = n.y;
          scene.wake();
        }}
        onEngineStop={() => scene.engineStopped()}
        cooldownTicks={90}
        warmupTicks={80}
        d3AlphaDecay={0.055}
        linkColor={(l) =>
          scene.related.has(idOf(l.source)) && scene.related.has(idOf(l.target))
            ? "#75899788"
            : "#667d9233"
        }
        linkWidth={0.65}
        nodeCanvasObject={(n, ctx, scale) => scene.drawNode(n, ctx, scale)}
        nodePointerAreaPaint={(n, color, ctx) => {
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(
            n.x ?? 0,
            n.y ?? 0,
            Math.max(nodeRadius(n), 8 / scene.motion.frame.zoom),
            0,
            Math.PI * 2,
          );
          ctx.fill();
        }}
        onRenderFramePost={(ctx) => scene.draw(ctx)}
      />
      <header
        className="graph-heading"
        ref={heading}
        style={{ left: left + 28 }}
      >
        <h1 title={title}>
          <TransitionTitle text={title ?? "All Neurons"} />
        </h1>
        <span>
          {data.nodes.length} {data.nodes.length === 1 ? "note" : "notes"}
        </span>
      </header>
      {!data.nodes.length && (
        <div
          className="graph-empty"
          style={{ left: left + 24, right: selected ? editorWidth + 56 : 24 }}
        >
          <h2>No notes yet</h2>
          <button onClick={onNewNote}>
            <Plus size={17} />
            New note
          </button>
        </div>
      )}
      <div className="graph-controls glass" ref={controls}>
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
          title="Reset graph view"
          aria-label="Reset graph view"
          onClick={() => scene.fit(false)}
        >
          <RotateCcw size={16} />
        </button>
      </div>
    </div>
  );
}
