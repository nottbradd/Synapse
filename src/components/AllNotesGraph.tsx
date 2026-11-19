import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Maximize, Minus, Plus } from "lucide-react";
import type { GraphProps } from "./Graph";
import { allNotesData } from "../interaction/allNotesData";
import { AllNotesCanvas } from "../interaction/allNotesCanvas";
import type { SettledNetwork } from "../interaction/allNotesLayout";
import { useReducedMotion } from "../hooks/useReducedMotion";
import { registerPresentation } from "../startup/presentation";
import NotePicker from "./NotePicker";
import "./allNotes.css";

export default function AllNotesGraph({
  snapshot,
  exploration,
  onNavigate,
  selected,
  left,
  drawer,
  editorWidth,
  auxiliaryOpen = false,
  onOpen,
  onNewNote,
  cache,
}: GraphProps & { cache: Map<string, SettledNetwork> }) {
  const host = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    zoom = useRef<HTMLSpanElement>(null),
    scene = useRef<AllNotesCanvas | null>(null);
  const data = useMemo(() => allNotesData(snapshot), [snapshot]),
    reduced = useReducedMotion();
  const latest = useRef({ data, onOpen, selected });
  latest.current = { data, onOpen, selected };
  const [result, setResult] = useState<{
      key: string;
      layout?: SettledNetwork;
      error?: string;
    }>(),
    [attempt, retry] = useState(0);
  const key = data.key,
    layout =
      cache.get(key) ?? (result?.key === key ? result.layout : undefined),
    error = result?.key === key ? result.error : undefined;
  useEffect(() => {
    if (cache.has(key)) return;
    let live = true,
      worker: Worker | undefined;
    const fail = () => {
      if (live) setResult({ key, error: "Could not lay out the network." });
      worker?.terminate();
    };
    try {
      worker = new Worker(
        new URL("../interaction/allNotes.worker.ts", import.meta.url),
        { type: "module" },
      );
      worker.onmessage = (e: MessageEvent<SettledNetwork>) => {
        if (!live) return;
        cache.clear();
        cache.set(key, e.data);
        setResult({ key, layout: e.data });
        worker?.terminate();
      };
      worker.onerror = fail;
      const { subjects, edges } = latest.current.data;
      worker.postMessage({ subjects, edges });
    } catch {
      fail();
    }
    return () => {
      live = false;
      worker?.terminate();
    };
  }, [key, cache, attempt]);
  useLayoutEffect(() => {
    const map = new AllNotesCanvas(
      canvas.current!,
      host.current!,
      zoom.current!,
      () => drawer.current,
      (id) => latest.current.onOpen(id),
    );
    scene.current = map;
    const capture = () => ({
      ...exploration.presentation,
      scope: { kind: "all-notes" as const },
      selected: latest.current.selected,
      frame: map.motion.frame,
      positions: {},
    });
    const releaseCapture = exploration.registerCapture(capture);
    const unregister = registerPresentation(host.current!, () =>
      map.presentation(),
    );
    return () => {
      unregister();
      map.dispose();
      scene.current = null;
      releaseCapture();
    };
  }, [drawer, exploration]);
  useLayoutEffect(() => {
    scene.current?.setData(data, layout);
  }, [data, layout]);
  useLayoutEffect(() => {
    scene.current?.configure(
      exploration.revision,
      exploration.restore?.frame,
      selected,
      editorWidth,
      auxiliaryOpen,
      reduced,
    );
  }, [
    exploration,
    exploration.revision,
    selected,
    editorWidth,
    auxiliaryOpen,
    reduced,
    layout,
  ]);
  return (
    <div
      ref={host}
      className="graph all-notes-graph"
      style={{ left }}
      onClickCapture={() => scene.current?.wake()}
      onFocusCapture={() => scene.current?.wake()}
      onBlurCapture={() => scene.current?.wake()}
    >
      <canvas
        ref={canvas}
        className="all-notes-canvas"
        data-swarm="graph"
        aria-label="All Notes network. Drag to pan, scroll to zoom, or use Jump to note."
        role="img"
      />
      <header className="graph-heading map-heading">
        {exploration.history.length > 0 && (
          <button
            className="graph-back"
            aria-label="Back to previous network"
            onClick={() => onNavigate("back")}
          >
            <ArrowLeft size={15} />
            Back
          </button>
        )}
        <div>
          <h1 data-swarm="text">All Notes</h1>
          <span data-swarm="text">
            {data.notes.length.toLocaleString()}{" "}
            {data.notes.length === 1 ? "note" : "notes"} ·{" "}
            {(data.edges.length / 2).toLocaleString()}{" "}
            {data.edges.length === 2 ? "link" : "links"}
          </span>
        </div>
      </header>
      {!data.notes.length ? (
        <div className="map-status">
          <h2>No notes yet</h2>
          <button onClick={onNewNote}>
            <Plus size={15} />
            New note
          </button>
        </div>
      ) : (
        !layout && (
          <div className="map-status" role="status">
            {error ?? "Laying out the network…"}
            {error && (
              <button
                onClick={() => {
                  setResult(undefined);
                  retry((n) => n + 1);
                }}
              >
                Retry
              </button>
            )}
          </div>
        )
      )}
      {data.groups.length > 0 && (
        <ul className="map-legend" aria-label="Subject colours">
          {data.groups.slice(0, 8).map((g) => (
            <li key={g.id}>
              <i style={{ background: g.color }} />
              {g.name}
            </li>
          ))}
          {data.groups.length > 8 && <li>+{data.groups.length - 8}</li>}
        </ul>
      )}
      <div
        className="graph-controls map-controls glass"
        role="group"
        aria-label="All Notes navigation"
      >
        <NotePicker data={data} onPick={(id) => scene.current?.choose(id)} />
        <button
          aria-label="Zoom out"
          title="Zoom out"
          onClick={() => scene.current?.zoomBy(1 / 1.3)}
        >
          <Minus size={15} />
        </button>
        <span ref={zoom}>100%</span>
        <button
          aria-label="Zoom in"
          title="Zoom in"
          onClick={() => scene.current?.zoomBy(1.3)}
        >
          <Plus size={15} />
        </button>
        <button
          aria-label="Fit network"
          title="Fit network"
          onClick={() => onNavigate("fit-network")}
        >
          <Maximize size={15} />
        </button>
      </div>
    </div>
  );
}
