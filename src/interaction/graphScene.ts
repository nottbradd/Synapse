import type { ForceGraphMethods } from "react-force-graph-2d";
import type { RefObject } from "react";
import type { Snapshot } from "../types";
import { overlaps, type LabelNode, type Rect } from "../graphLabels";
import {
  LayoutMotion,
  cameraCentre,
  fitFrame,
  frameFromCamera,
  project,
  usable,
  MOTION,
  type Frame,
  type Viewport,
} from "./motion";
import { AnimatedLabels, SelectionRings, type DrawLabel } from "./labels";
import type {
  GraphPresentation,
  PresentationNode,
} from "../startup/presentation";
import {
  CAPTION_FONT,
  LABEL_FONT,
  TextMeasurements,
  watchFonts,
} from "./fonts";
import { feedback, type InteractionEvent } from "./events";
import { SignalTimeline, inside, planSignals } from "./signals";
import {
  GraphTopology,
  nodeRadius,
  nodeScreenRadius,
  idOf,
  compositionNodes,
  type SceneNode,
} from "./topology";
import { GraphLight, litColor, lightColor } from "./light";
import type { Exploration, FocusView } from "./exploration";
import {
  connection,
  curveLength,
  pointOn,
  trace,
  junction,
} from "./connections";
type Caption = Rect & { text: string; color: string };
export class GraphScene {
  exploration?: Exploration;
  private navigationRevision = -1;
  capture = (): FocusView => ({
    ...this.exploration!.presentation,
    scope: this.exploration!.scope,
    selected: this.selected,
    frame: { ...this.motion.frame },
    positions: Object.fromEntries(
      this.topology.visibleNodes.map((n) => [
        n.id,
        {
          x: n.x ?? 0,
          y: n.y ?? 0,
          fx: n.fx,
          fy: n.fy,
        },
      ]),
    ),
  });
  topology = new GraphTopology();
  api?: ForceGraphMethods<SceneNode>;
  view: Viewport = { width: 1200, height: 800, left: 312 };
  motion = new LayoutMotion(
    { x: 0, y: 0, zoom: 1, drawer: 0 },
    performance.now(),
  );
  labels = new AnimatedLabels();
  rings = new SelectionRings();
  signals = new SignalTimeline();
  measurements = new TextMeasurements();
  light = new GraphLight();
  lightCanvas: HTMLCanvasElement | null = null;
  container: HTMLDivElement | null = null;
  snapshot?: Snapshot;
  selected?: string;
  auxiliaryOpen = false;
  hover?: string;
  query = "";
  reduced = false;
  colors = new Map<string, string>();
  related = new Set<string>();
  drawer: RefObject<HTMLDivElement | null> | null = null;
  heading: HTMLElement | null = null;
  controls: HTMLElement | null = null;
  zoomText: HTMLElement | null = null;
  editorWidth = 600;
  engine = true;
  applying = false;
  private raf = 0;
  private last = 0;
  private time = 0;
  private planAt = -Infinity;
  private dirty = true;
  private frames = 0;
  private scope = "";
  private beforeDrawer?: Frame;
  private overviews = new Map<string, Frame>();
  private pending?: InteractionEvent;
  private disposed = false;
  private initial = true;
  private firstDraw = true;
  private drawnLabels: DrawLabel[] = [];
  attach() {
    this.disposed = false;
    const fonts = watchFonts(this.measurements, () => {
      this.dirty = true;
      this.wake();
    });
    const events = feedback.subscribe((e) => {
      if (e.kind === "cancel") {
        this.signals.cancel();
        this.pending = undefined;
      } else if (
        e.event.intent.kind === "select" ||
        e.event.intent.kind === "follow" ||
        e.event.intent.kind === "connect" ||
        e.event.intent.kind === "complete"
      )
        this.pending = e.event;
      this.wake();
    });
    this.wake();
    return () => {
      this.disposed = true;
      fonts();
      events();
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      feedback.cancel(this.signals.cancel());
      this.labels.clear();
      this.light.clear();
    };
  }
  configure(
    snapshot: Snapshot,
    selected: string | undefined,
    query: string,
    view: Viewport,
    editorWidth: number,
    reduced: boolean,
    auxiliaryOpen = false,
  ) {
    if (this.exploration) {
      const now = performance.now(),
        navigation = this.exploration;
      const changed = navigation.revision !== this.navigationRevision;
      const selectionChanged = this.selected !== selected;
      const open = !!selected || auxiliaryOpen;
      const sizeChanged =
        JSON.stringify(view) !== JSON.stringify(this.view) ||
        editorWidth !== this.editorWidth;
      this.snapshot = snapshot;
      this.colors = new Map(
        snapshot.organization.subjects.map((s) => [s.id, s.color]),
      );
      this.view = view;
      this.editorWidth = editorWidth;
      this.reduced = reduced;
      this.query = query;
      this.exploration.capture = this.capture;
      if (changed) {
        feedback.cancel(this.signals.cancel());
        const restore = navigation.restore;
        const target =
          navigation.scope.kind === "topic"
            ? this.topology.reveal.targets.get(navigation.scope.note)
            : undefined;
        this.retarget(
          restore
            ? { ...restore.frame, drawer: open ? editorWidth + 32 : 0 }
            : target
              ? {
                  x: target.x,
                  y: target.y,
                  zoom: this.focusZoom(
                    this.topology.positions.get(
                      navigation.scope.kind === "topic"
                        ? navigation.scope.note
                        : "",
                    )!,
                    open ? editorWidth + 32 : 0,
                  ),
                  drawer: open ? editorWidth + 32 : 0,
                }
              : fitFrame(
                  [...this.topology.reveal.targets.values()],
                  view,
                  open ? editorWidth + 32 : 0,
                ),
          now,
        );
        // Initial placement has no previous view to transition from. Establish
        // the existing layout before its first paint; later navigation retains
        // the normal spring, reveal, camera and pinned-position behaviour.
        if (this.navigationRevision === -1) {
          this.motion.snap(this.motion.destination, now);
          this.topology.reveal.advance(this.topology.data.nodes, now, true);
        }
        this.navigationRevision = navigation.revision;
      } else if (
        selectionChanged ||
        auxiliaryOpen !== this.auxiliaryOpen ||
        sizeChanged
      ) {
        // Closing a drawer changes occlusion, never the current knowledge scope.
        this.retarget(
          { ...this.motion.destination, drawer: open ? editorWidth + 32 : 0 },
          now,
        );
      }
      if (selectionChanged) this.rings.select(selected, now);
      this.selected = selected;
      this.auxiliaryOpen = auxiliaryOpen;
      this.updateRelated();
      this.dirty = true;
      this.wake();
      return;
    }
    const now = performance.now(),
      scope = JSON.stringify(snapshot.organization.location),
      scopeChanged = scope !== this.scope;
    const sizeChanged =
      JSON.stringify(view) !== JSON.stringify(this.view) ||
      editorWidth !== this.editorWidth;
    const selectionChanged = this.selected !== selected;
    const wasOpen = !!this.selected || this.auxiliaryOpen;
    const isOpen = !!selected || auxiliaryOpen;
    if (scopeChanged && this.scope) {
      this.overviews.set(
        this.scope,
        this.beforeDrawer ?? { ...this.motion.destination, drawer: 0 },
      );
      feedback.cancel(this.signals.cancel());
    }
    this.snapshot = snapshot;
    this.colors = new Map(
      snapshot.organization.subjects.map((s) => [s.id, s.color]),
    );
    this.view = view;
    this.editorWidth = editorWidth;
    this.reduced = reduced;
    this.query = query;
    if (scopeChanged) {
      this.scope = scope;
      this.beforeDrawer = undefined;
      const saved = this.overviews.get(scope);
      this.retarget(
        saved ?? fitFrame(compositionNodes(this.topology.data.nodes), view, 0),
        now,
      );
    }
    if (selectionChanged || wasOpen !== isOpen) {
      this.rings.select(selected, now);
      if (selected) {
        const node = this.topology.positions.get(selected);
        if (node && this.topology.data.nodes.includes(node)) {
          if (!wasOpen)
            this.beforeDrawer = { ...this.motion.destination, drawer: 0 };
          this.retarget(
            {
              x: node.x ?? 0,
              y: node.y ?? 0,
              zoom: this.focusZoom(node, editorWidth + 32),
              drawer: editorWidth + 32,
            },
            now,
          );
        } else
          this.retarget(
            { ...this.motion.destination, drawer: editorWidth + 32 },
            now,
          );
      } else if (auxiliaryOpen) {
        if (!wasOpen)
          this.beforeDrawer = { ...this.motion.destination, drawer: 0 };
        this.retarget(
          { ...this.motion.destination, drawer: editorWidth + 32 },
          now,
        );
      } else
        this.retarget(
          { ...(this.beforeDrawer ?? this.motion.destination), drawer: 0 },
          now,
        );
    } else if (sizeChanged) {
      this.retarget(
        { ...this.motion.destination, drawer: isOpen ? editorWidth + 32 : 0 },
        now,
      );
    }
    this.selected = selected;
    this.auxiliaryOpen = auxiliaryOpen;
    this.updateRelated();
    this.dirty = true;
    this.wake();
  }
  focusZoom(node: SceneNode, drawer: number) {
    const linked = new Set(
      (this.snapshot?.edges ?? []).flatMap((e) =>
        e.source === node.id
          ? [e.target]
          : e.target === node.id
            ? [e.source]
            : [],
      ),
    );
    const centre = this.topology.reveal.targets.get(node.id) ?? node;
    const nearby = this.topology.visibleNodes
      .filter((n) => linked.has(n.id))
      .map((n) => this.topology.reveal.targets.get(n.id) ?? n)
      .map((n) => ({
        dx: Math.abs((n.x ?? 0) - (centre.x ?? 0)),
        dy: Math.abs((n.y ?? 0) - (centre.y ?? 0)),
      }))
      .sort((a, b) => Math.hypot(a.dx, a.dy) - Math.hypot(b.dx, b.dy))
      .slice(0, 8);
    const bounds = usable(this.view, drawer);
    return Math.max(
      0.85,
      Math.min(
        2.4,
        (bounds.width - 140) / (2 * Math.max(80, ...nearby.map((n) => n.dx))),
        (bounds.height - 100) / (2 * Math.max(80, ...nearby.map((n) => n.dy))),
      ),
    );
  }
  installForces() {
    const api = this.api;
    if (!api) return;
    if (this.topology.nested) {
      for (const force of ["charge", "link", "center", "subjects"])
        api.d3Force(force, null);
      this.engine = false;
      this.initial = false;
      this.wake();
      return;
    }
    (
      api.d3Force("charge") as unknown as { strength: (v: number) => void }
    )?.strength(-130);
    (
      api.d3Force("link") as unknown as {
        distance: (
          fn: (e: { source: SceneNode; target: SceneNode }) => number,
        ) => void;
      }
    )?.distance((e) =>
      e.source.subject_id === e.target.subject_id ? 120 : 225,
    );
    (
      api.d3Force("link") as unknown as {
        strength: (
          fn: (e: { source: SceneNode; target: SceneNode }) => number,
        ) => void;
      }
    )?.strength((e) =>
      e.source.subject_id === e.target.subject_id ? 0.25 : 0.025,
    );
    api.d3Force("center", null);
    api.d3Force("subjects", (alpha: number) => {
      for (const n of this.topology.data.nodes) {
        const a = this.topology.anchors.get(n.subject_id);
        if (a) {
          n.vx = (n.vx ?? 0) + (a.x - (n.x ?? 0)) * alpha * 0.055;
          n.vy = (n.vy ?? 0) + (a.y - (n.y ?? 0)) * alpha * 0.055;
        }
      }
      const cells = new Map<string, SceneNode[]>();
      for (const n of this.topology.data.nodes) {
        const cx = Math.floor((n.x ?? 0) / 48),
          cy = Math.floor((n.y ?? 0) / 48);
        for (let x = cx - 1; x <= cx + 1; x++)
          for (let y = cy - 1; y <= cy + 1; y++)
            for (const o of cells.get(`${x},${y}`) ?? []) {
              const dx = (n.x ?? 0) - (o.x ?? 0),
                dy = (n.y ?? 0) - (o.y ?? 0),
                d = Math.hypot(dx, dy) || 0.01,
                min = nodeRadius(n) + nodeRadius(o) + 20;
              if (d < min) {
                const p = ((min - d) / d) * alpha * 0.5;
                n.vx = (n.vx ?? 0) + dx * p;
                n.vy = (n.vy ?? 0) + dy * p;
                o.vx = (o.vx ?? 0) - dx * p;
                o.vy = (o.vy ?? 0) - dy * p;
              }
            }
        const key = `${cx},${cy}`;
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key)!.push(n);
      }
    });
    this.engine = this.topology.layoutChanged;
    if (this.engine) api.d3ReheatSimulation();
    this.wake();
  }
  engineStopped() {
    this.engine = false;
    if (this.initial) {
      this.initial = false;
      if (!this.selected) this.fit(false);
    }
    this.dirty = true;
    this.wake();
  }
  updateRelated() {
    this.related = new Set();
    const active = this.hover ?? this.selected;
    if (!active) return;
    this.related.add(active);
    for (const e of this.snapshot?.edges ?? []) {
      if (e.source === active) this.related.add(e.target);
      if (e.target === active) this.related.add(e.source);
    }
  }
  setHover(id?: string) {
    if (this.hover === id) return;
    this.hover = id;
    this.updateRelated();
    this.dirty = true;
    this.wake();
  }
  retarget(frame: Frame, time = performance.now()) {
    this.motion.retarget(frame, time, this.reduced);
    this.dirty = true;
    this.wake();
  }
  fit(all = true) {
    this.retarget(
      fitFrame(
        all
          ? this.topology.visibleNodes
          : compositionNodes(this.topology.visibleNodes),
        this.view,
        this.selected || this.auxiliaryOpen ? this.editorWidth + 32 : 0,
      ),
    );
  }
  zoomBy(factor: number) {
    const f = this.motion.frame;
    this.retarget({ ...f, zoom: Math.max(0.08, Math.min(6, f.zoom * factor)) });
  }
  manual() {
    if (this.applying || !this.api) return;
    const c = this.api.centerAt();
    this.motion.snap(
      frameFromCamera(c, this.api.zoom(), this.motion.frame.drawer, this.view),
      performance.now(),
    );
    this.dirty = true;
    this.wake();
  }
  wake = () => {
    if (this.disposed) return;
    this.frames = 2;
    if (!this.raf) {
      this.last = performance.now();
      this.api?.resumeAnimation();
      this.raf = requestAnimationFrame(this.tick);
    }
  };
  private tick = (now: number) => {
    this.raf = 0;
    this.time = now;
    this.topology.reveal.advance(this.topology.data.nodes, now, this.reduced);
    const f = this.motion.advance(now, this.reduced),
      centre = cameraCentre(f, this.view);
    if (this.api) {
      this.applying = true;
      this.api.zoom(f.zoom, 0);
      this.api.centerAt(centre.x, centre.y, 0);
      this.applying = false;
    }
    // The sibling drawer mounts after Graph's layout effect on the first selection.
    // Resolve its ref on the animation frame instead of retaining the earlier null.
    const drawer = this.drawer?.current;
    if (drawer) {
      const fraction = Math.max(
        0,
        Math.min(1, f.drawer / (this.editorWidth + 32)),
      );
      drawer.style.transform = `translateX(${(this.editorWidth + 24) * (1 - fraction)}px)`;
      drawer.style.visibility =
        fraction === 0 && !this.selected && !this.auxiliaryOpen
          ? "hidden"
          : "visible";
    }
    if (this.heading) {
      this.heading.style.right = `${f.drawer + 28}px`;
      this.heading.style.left = `${this.view.left + 28}px`;
    }
    if (this.controls)
      this.controls.style.left = `${this.view.left + (this.view.width - this.view.left - f.drawer) / 2}px`;
    if (this.zoomText)
      this.zoomText.textContent = `${Math.round(f.zoom * 100)}%`;
    this.container?.style.setProperty(
      "--scene-left",
      `${this.view.left + 8}px`,
    );
    this.container?.style.setProperty("--scene-right", `${f.drawer}px`);
    const visible = new Set(
      this.topology.data.nodes
        .filter((n) =>
          inside(project(n, f, this.view), usable(this.view, f.drawer)),
        )
        .map((n) => n.id),
    );
    feedback.cancel(this.signals.prune(now, visible));
    if (this.pending) {
      const event = this.pending,
        intent = event.intent;
      if (
        "node" in intent &&
        intent.node &&
        this.topology.data.nodes.some((node) => node.id === intent.node) &&
        (intent.kind === "complete" ||
          intent.kind === "connect" ||
          this.selected === intent.node)
      ) {
        const source =
          intent.kind === "follow"
            ? (intent.source ?? intent.node)
            : intent.node;
        const edges =
          intent.kind === "follow"
            ? this.snapshot!.edges.filter(
                (e) =>
                  (e.source === source && e.target === intent.node) ||
                  (e.target === source && e.source === intent.node),
              )
            : intent.kind === "connect" && intent.targets
              ? this.snapshot!.edges.filter(
                  (e) =>
                    (e.source === source &&
                      intent.targets!.includes(e.target)) ||
                    (e.target === source && intent.targets!.includes(e.source)),
                )
              : this.snapshot!.edges;
        const plan = planSignals(
          event.id,
          source,
          this.topology.data.nodes,
          edges,
          this.motion.destination,
          this.view,
          usable(this.view, this.motion.destination.drawer),
          event.at,
          this.colors,
        );
        feedback.cancel(this.signals.replace(this.reduced ? [] : plan));
        if (!this.reduced) feedback.arrivals(plan, intent.kind === "follow");
        this.pending = undefined;
      } else if (now - event.at > 150) this.pending = undefined;
    }
    if (
      this.motion.active ||
      this.topology.reveal.active ||
      this.engine ||
      this.labels.active ||
      (!this.reduced && this.rings.active(now)) ||
      this.signals.packets.length ||
      --this.frames > 0
    ) {
      this.raf = requestAnimationFrame(this.tick);
    } else this.api?.pauseAnimation();
  };
  private projected(frame: Frame, destination = false): LabelNode[] {
    const prominent = new Set<string>();
    for (const subject of this.colors.keys()) {
      this.topology.visibleNodes
        .filter((n) => n.subject_id === subject)
        .sort((a, b) => b.neighbors - a.neighbors || a.id.localeCompare(b.id))
        .slice(
          0,
          this.topology.visibleNodes.length <= 20
            ? 20
            : frame.zoom < 1.5
              ? 2
              : 4,
        )
        .forEach((n) => prominent.add(n.id));
    }
    return this.topology.visibleNodes.map((n) => {
      const match = `${n.title} ${n.id}`
        .toLowerCase()
        .includes(this.query.toLowerCase());
      return {
        ...project(
          destination ? (this.topology.reveal.targets.get(n.id) ?? n) : n,
          frame,
          this.view,
        ),
        id: n.id,
        title: n.title,
        radius: nodeScreenRadius(n, frame.zoom),
        priority:
          n.role === "subnetwork"
            ? 800
            : n.id === this.selected
              ? 1000
              : n.id === this.hover
                ? 900
                : this.query
                  ? match
                    ? 700
                    : 0
                  : frame.zoom < 0.5 ||
                      (!prominent.has(n.id) &&
                        !this.related.has(n.id) &&
                        frame.zoom < 1.8)
                    ? 0
                    : frame.zoom < 0.85 && n.neighbors < 3
                      ? 0
                      : 100 +
                        Math.min(n.neighbors, 60) +
                        (this.related.has(n.id) ? 80 : 0),
      };
    });
  }
  private captions(
    nodes: LabelNode[],
    bounds: Rect,
    ctx: CanvasRenderingContext2D,
  ): Caption[] {
    if (
      this.topology.nested ||
      !this.measurements.ready ||
      this.snapshot?.organization.location.subject_id
    )
      return [];
    ctx.font = CAPTION_FONT;
    const captions: Caption[] = [];
    for (const s of this.snapshot?.organization.subjects ?? []) {
      const group = nodes.filter(
        (n) => this.topology.positions.get(n.id)?.subject_id === s.id,
      );
      if (!group.length) continue;
      const duplicate =
        this.snapshot!.organization.subjects.filter(
          (other) => other.name === s.name,
        ).length > 1;
      const text =
          s.name +
          (duplicate
            ? ` · ${this.snapshot!.organization.neurons.find((n) => n.id === s.neuron_id)?.name ?? ""}`
            : ""),
        width = this.measurements.width(ctx, CAPTION_FONT, text) + 4;
      const xs = group.map((n) => n.x).sort((a, b) => a - b),
        ys = group.map((n) => n.y).sort((a, b) => a - b),
        x = xs[Math.floor(xs.length / 2)] - width / 2;
      for (const y of [ys[0] - 40, ys[ys.length - 1] + 25]) {
        const b = { x, y, width, height: 22 };
        if (
          inside({ x, y }, bounds) &&
          inside({ x: x + width, y: y + 22 }, bounds) &&
          !captions.some((c) => overlaps(c, b, 10)) &&
          !nodes.some((n) =>
            overlaps(b, {
              x: n.x - n.radius - 10,
              y: n.y - n.radius - 10,
              width: n.radius * 2 + 20,
              height: n.radius * 2 + 20,
            }),
          )
        ) {
          captions.push({ ...b, text, color: s.color });
          break;
        }
      }
    }
    return captions;
  }
  draw(ctx: CanvasRenderingContext2D) {
    if (!this.api) return;
    const now = this.time || performance.now(),
      dt = Math.max(0, Math.min(0.1, (now - this.last) / 1000));
    this.last = now;
    const f = this.motion.frame,
      bounds = usable(this.view, f.drawer),
      nodes = this.projected(f);
    if (this.lightCanvas)
      this.light.render(
        this.lightCanvas,
        this.topology.visibleNodes,
        this.colors,
        f,
        this.view,
        this.lightDensity(),
      );
    ctx.save();
    const ratio = ctx.canvas.width / this.view.width;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const captions = this.captions(nodes, bounds, ctx);
    if (this.measurements.ready) {
      if (this.dirty || (this.engine && now - this.planAt > 100)) {
        const target = this.motion.destination,
          destination = this.projected(target, true),
          b = usable(this.view, target.drawer),
          captionTargets = this.captions(destination, b, ctx);
        ctx.font = LABEL_FONT;
        this.labels.plan(
          destination,
          b,
          (t) => this.measurements.width(ctx, LABEL_FONT, t),
          now,
          captionTargets,
        );
        this.dirty = false;
        this.planAt = now;
      }
      ctx.font = CAPTION_FONT;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      for (const c of captions) {
        ctx.fillStyle = c.color;
        ctx.globalAlpha = 0.96;
        ctx.fillText(c.text, c.x, c.y + c.height / 2);
      }
      ctx.globalAlpha = 1;
      ctx.font = LABEL_FONT;
      ctx.textAlign = "center";
      const labels = this.labels.advance(
        nodes,
        dt,
        this.reduced || this.firstDraw,
        bounds,
        captions,
      );
      this.drawnLabels = labels;
      for (const l of labels) {
        const n = nodes.find((n) => n.id === l.id)!;
        if (l.leader > 0.01) {
          ctx.globalAlpha = l.alpha * l.leader * 0.3;
          ctx.strokeStyle = "#9aafbd";
          ctx.lineWidth = 0.65;
          ctx.beginPath();
          ctx.moveTo(n.x, n.y);
          ctx.lineTo(l.x, l.y);
          ctx.stroke();
        }
        ctx.globalAlpha = l.alpha;
        ctx.fillStyle = l.priority >= 700 ? "#edf4f8" : "#aab9c6";
        ctx.fillText(l.text, l.x, l.y);
      }
    }
    ctx.globalAlpha = 1;
    for (const n of nodes) {
      const value = this.rings.value(n.id, now, this.reduced);
      if (value > 0) {
        ctx.globalAlpha = value * 0.9;
        ctx.strokeStyle = "#f2f6fa";
        ctx.lineWidth = 1;
        junction(ctx, n.x, n.y, (n.radius + 5) * (0.8 + 0.2 * value), true);
        ctx.stroke();
      }
    }
    if (!this.reduced)
      for (const p of this.signals.packets) {
        const a = nodes.find((n) => n.id === p.source),
          b = nodes.find((n) => n.id === p.target);
        if (!a || !b) continue;
        const t = (now - p.start) / p.duration;
        const path = connection(a, b, p.source, p.target);
        ctx.fillStyle = p.color;
        ctx.strokeStyle = p.color;
        if (t >= 0 && t < 1) {
          ctx.globalAlpha = 0.85;
          ctx.lineWidth = 1.3;
          ctx.beginPath();
          const tail = Math.max(
            0,
            t - Math.min(0.16, 18 / Math.max(1, curveLength(path))),
          );
          const first = pointOn(path, tail),
            head = pointOn(path, t);
          ctx.moveTo(first.x, first.y);
          for (let i = 1; i <= 6; i++) {
            const point = pointOn(path, tail + ((t - tail) * i) / 6);
            ctx.lineTo(point.x, point.y);
          }
          ctx.stroke();
          ctx.beginPath();
          ctx.fillRect(head.x - 1.2, head.y - 1.2, 2.4, 2.4);
        } else if (t >= 1) {
          const bloom = (now - p.arrival) / MOTION.bloomDuration;
          if (bloom < 1) {
            ctx.globalAlpha = (1 - bloom) * 0.75;
            ctx.lineWidth = 1;
            junction(ctx, b.x, b.y, b.radius + 3 + bloom * 2, true);
            ctx.stroke();
          }
        }
      }
    ctx.restore();
    if (this.measurements.ready) this.firstDraw = false;
  }
  presentation(): GraphPresentation | undefined {
    if (
      !this.container ||
      !this.api ||
      this.firstDraw ||
      this.dirty ||
      this.engine ||
      this.motion.active ||
      this.topology.reveal.active ||
      this.labels.active ||
      !this.measurements.ready
    )
      return;
    const element = this.container.querySelector<HTMLElement>(".graph-surface");
    if (!element) return;
    const f = this.motion.frame,
      bounds = usable(this.view, f.drawer);
    const offset = this.container.getBoundingClientRect();
    const clip = { ...bounds, x: bounds.x + offset.x, y: bounds.y + offset.y };
    const candidates = this.topology.visibleNodes.slice(0, 96).filter((n) => {
      const p = project(n, f, this.view),
        r = nodeScreenRadius(n, f.zoom) + 4;
      return (
        p.x - r >= bounds.x &&
        p.x + r <= bounds.x + bounds.width &&
        p.y - r >= bounds.y &&
        p.y + r <= bounds.y + bounds.height
      );
    });
    const byId = new Map(candidates.map((n) => [n.id, n]));
    const picked = new Set<string>();
    const links = this.topology.data.links
      .slice(0, 256)
      .filter((e) => byId.has(idOf(e.source)) && byId.has(idOf(e.target)));
    const chosen = [];
    for (const e of links) {
      const a = idOf(e.source),
        b = idOf(e.target);
      if (new Set([...picked, a, b]).size > 6 || chosen.length >= 4) continue;
      picked.add(a);
      picked.add(b);
      chosen.push(e);
    }
    for (const n of candidates) {
      if (picked.size >= 6) break;
      picked.add(n.id);
    }
    const nodes: PresentationNode[] = [...picked].map((id) => {
      const n = byId.get(id)!,
        p = project(n, f, this.view),
        radius = nodeScreenRadius(n, f.zoom);
      const extent = Math.ceil(radius * 2.3 + 4),
        ratio = Math.min(devicePixelRatio || 1, 2);
      const sprite = document.createElement("canvas");
      sprite.width = sprite.height = Math.ceil(extent * 2 * ratio);
      const ctx = sprite.getContext("2d")!;
      ctx.scale(ratio, ratio);
      ctx.translate(extent, extent);
      ctx.scale(f.zoom, f.zoom);
      ctx.translate(-(n.x ?? 0), -(n.y ?? 0));
      this.drawNode(n, ctx, f.zoom);
      const label = this.drawnLabels.find((l) => l.id === id);
      return {
        id,
        x: p.x + offset.x,
        y: p.y + offset.y,
        radius,
        extent,
        sprite,
        color: this.colors.get(n.subject_id) ?? "#95a6b8",
        label: label
          ? {
              text: label.text,
              x: label.x + offset.x,
              y: label.y + offset.y,
              alpha: label.alpha,
              color: label.priority >= 700 ? "#edf4f8" : "#aab9c6",
            }
          : undefined,
      };
    });
    const positions = new Map(nodes.map((n) => [n.id, n]));
    const edges = chosen.map((e) => {
      const source = idOf(e.source),
        target = idOf(e.target),
        a = byId.get(source)!,
        b = byId.get(target)!;
      const same = a.subject_id === b.subject_id,
        active = this.related.has(source) && this.related.has(target);
      const color = this.colors.get(a.subject_id) ?? "#95a6b8";
      return {
        id: JSON.stringify([source, target]),
        source,
        target,
        path: connection(
          positions.get(source)!,
          positions.get(target)!,
          source,
          target,
        ),
        color: same
          ? lightColor(color, active ? 0.94 : 0.62)
          : active
            ? "#a5c3d08c"
            : "#839aaf3b",
        width: active ? 1.15 : same ? 0.7 : 0.5,
      };
    });
    const key = this.topology.key,
      revision = this.navigationRevision;
    const view = JSON.stringify(this.view),
      frame = JSON.stringify(f),
      selected = this.selected,
      hover = this.hover,
      query = this.query;
    return {
      element,
      clip,
      nodes,
      edges,
      valid: () =>
        element.isConnected &&
        key === this.topology.key &&
        revision === this.navigationRevision &&
        view === JSON.stringify(this.view) &&
        frame === JSON.stringify(this.motion.frame) &&
        selected === this.selected &&
        hover === this.hover &&
        query === this.query &&
        !this.motion.active &&
        !this.topology.reveal.active &&
        !this.engine,
    };
  }
  private lightDensity() {
    return Math.max(
      0.45,
      Math.min(1, 12 / Math.sqrt(Math.max(1, this.topology.data.nodes.length))),
    );
  }
  isInteractive(n: SceneNode) {
    return (
      (!this.topology.nested || this.topology.reveal.visible.has(n.id)) &&
      inside(
        project(n, this.motion.frame, this.view),
        usable(this.view, this.motion.frame.drawer),
      )
    );
  }
  hitTest(x: number, y: number) {
    // The renderer's colour-picking canvas is throttled by 800 ms. Navigation
    // must resolve against this frame, including during a reveal or reversal.
    return this.topology.visibleNodes
      .filter((n) => this.isInteractive(n))
      .map((n) => ({ n, p: project(n, this.motion.frame, this.view) }))
      .map(({ n, p }) => ({ n, distance: Math.hypot(p.x - x, p.y - y) }))
      .filter(
        ({ n, distance }) =>
          distance <=
          Math.max(10, nodeScreenRadius(n, this.motion.frame.zoom) + 3),
      )
      .sort((a, b) => a.distance - b.distance)[0]?.n;
  }
  drawEdge(
    edge: { source?: unknown; target?: unknown },
    ctx: CanvasRenderingContext2D,
    scale: number,
  ) {
    const a = this.topology.positions.get(idOf(edge.source)),
      b = this.topology.positions.get(idOf(edge.target));
    if (!a || !b) return;
    const same = a.subject_id === b.subject_id,
      active = this.related.has(a.id) && this.related.has(b.id);
    const color = this.colors.get(a.subject_id) ?? "#95a6b8";
    ctx.save();
    const progress = Math.max(
      0,
      Math.min(1, this.topology.reveal.edgeProgress(a.id, b.id)),
    );
    if (progress === 0) {
      ctx.restore();
      return;
    }
    ctx.globalAlpha =
      progress *
      Math.max(
        0,
        Math.min(
          this.topology.reveal.alpha(a.id),
          this.topology.reveal.alpha(b.id),
        ),
      );
    ctx.beginPath();
    const path = connection(
      { x: (a.x ?? 0) * scale, y: (a.y ?? 0) * scale },
      { x: (b.x ?? 0) * scale, y: (b.y ?? 0) * scale },
      a.id,
      b.id,
    );
    if (progress >= 0.999 || this.reduced) trace(ctx, path, scale);
    else {
      const first = pointOn(path, 0);
      ctx.moveTo(first.x / scale, first.y / scale);
      for (let i = 1; i <= 16; i++) {
        const p = pointOn(path, (progress * i) / 16);
        ctx.lineTo(p.x / scale, p.y / scale);
      }
    }
    if (same) {
      ctx.strokeStyle = lightColor(
        color,
        (active ? 0.13 : 0.025) * this.lightDensity(),
      );
      ctx.lineWidth = (active ? 2.5 : 1.6) / scale;
      ctx.stroke();
    }
    ctx.strokeStyle = same
      ? lightColor(color, active ? 0.94 : 0.62)
      : active
        ? "#a5c3d08c"
        : "#839aaf3b";
    ctx.lineWidth = (active ? 1.15 : same ? 0.7 : 0.5) / scale;
    ctx.stroke();
    ctx.restore();
  }
  drawNode(n: SceneNode, ctx: CanvasRenderingContext2D, scale: number) {
    const color = this.colors.get(n.subject_id) ?? "#95a6b8",
      r = nodeScreenRadius(n, scale) / scale,
      x = n.x ?? 0,
      y = n.y ?? 0;
    const active = n.id === this.selected || n.id === this.hover;
    const connected = this.related.has(n.id);
    ctx.save();
    const alpha =
      (this.query &&
        !`${n.title} ${n.id}`
          .toLowerCase()
          .includes(this.query.toLowerCase())) ||
      (this.hover && !this.related.has(n.id))
        ? 0.38
        : 1;
    const halo = r * (active ? 2.1 : 1.65);
    ctx.globalCompositeOperation = "lighter";
    const reveal = Math.max(0, this.topology.reveal.alpha(n.id));
    ctx.globalAlpha =
      alpha * reveal * this.lightDensity() * (connected ? 0.5 : 0.3);
    ctx.drawImage(
      this.light.texture(color),
      x - halo,
      y - halo,
      halo * 2,
      halo * 2,
    );
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = alpha * reveal;
    if (n.neighbors < 2 && n.role !== "subnetwork") {
      ctx.fillStyle = litColor(color, active ? 0.65 : 0.18);
      ctx.beginPath();
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r, y);
      ctx.lineTo(x, y + r);
      ctx.lineTo(x - r, y);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = litColor(color, 0.4);
      ctx.lineWidth = 0.65 / scale;
      ctx.beginPath();
      ctx.moveTo(x - r * 1.3, y);
      ctx.lineTo(x + r * 1.3, y);
      ctx.stroke();
    } else {
      ctx.fillStyle = "#080c10";
      junction(ctx, x, y, r);
      ctx.fill();
      ctx.strokeStyle = litColor(color, active ? 0.45 : 0.12);
      ctx.lineWidth = (n.neighbors >= 5 ? 1.1 : 0.85) / scale;
      junction(ctx, x, y, r, n.neighbors >= 5);
      ctx.stroke();
      ctx.fillStyle = litColor(color, active ? 0.8 : connected ? 0.3 : 0.12);
      const core = r * (n.neighbors >= 5 ? 0.48 : 0.44);
      ctx.fillRect(x - core, y - core, core * 2, core * 2);
      if (n.neighbors >= 5) {
        ctx.strokeStyle = litColor(color, 0.2);
        ctx.lineWidth = 0.75 / scale;
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + r + 3 / scale, y);
        ctx.stroke();
      }
    }
    ctx.restore();
  }
}
