import type { ForceGraphMethods } from "react-force-graph-2d";
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
import { AnimatedLabels, SelectionRings } from "./labels";
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
import {
  connection,
  curveLength,
  pointOn,
  trace,
  junction,
} from "./connections";
type Caption = Rect & { text: string; color: string };
export class GraphScene {
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
  drawer: HTMLDivElement | null = null;
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
    const nearby = this.topology.data.nodes
      .filter((n) => linked.has(n.id))
      .map((n) => ({
        dx: Math.abs((n.x ?? 0) - (node.x ?? 0)),
        dy: Math.abs((n.y ?? 0) - (node.y ?? 0)),
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
          ? this.topology.data.nodes
          : compositionNodes(this.topology.data.nodes),
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
    const f = this.motion.advance(now, this.reduced),
      centre = cameraCentre(f, this.view);
    if (this.api) {
      this.applying = true;
      this.api.zoom(f.zoom, 0);
      this.api.centerAt(centre.x, centre.y, 0);
      this.applying = false;
    }
    if (this.drawer) {
      const fraction = Math.max(
        0,
        Math.min(1, f.drawer / (this.editorWidth + 32)),
      );
      this.drawer.style.transform = `translateX(${(this.editorWidth + 24) * (1 - fraction)}px)`;
      this.drawer.style.visibility =
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
      this.engine ||
      this.labels.active ||
      (!this.reduced && this.rings.active(now)) ||
      this.signals.packets.length ||
      --this.frames > 0
    ) {
      this.raf = requestAnimationFrame(this.tick);
    } else this.api?.pauseAnimation();
  };
  private projected(frame: Frame): LabelNode[] {
    const prominent = new Set<string>();
    for (const subject of this.colors.keys()) {
      this.topology.data.nodes
        .filter((n) => n.subject_id === subject)
        .sort((a, b) => b.neighbors - a.neighbors || a.id.localeCompare(b.id))
        .slice(0, frame.zoom < 1.5 ? 2 : 4)
        .forEach((n) => prominent.add(n.id));
    }
    return this.topology.data.nodes.map((n) => {
      const match = `${n.title} ${n.id}`
        .toLowerCase()
        .includes(this.query.toLowerCase());
      return {
        ...project(n, frame, this.view),
        id: n.id,
        title: n.title,
        radius: nodeScreenRadius(n, frame.zoom),
        priority:
          n.id === this.selected
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
        this.topology.data.nodes,
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
          destination = this.projected(target),
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
        this.reduced,
        bounds,
        captions,
      );
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
  }
  private lightDensity() {
    return Math.max(
      0.45,
      Math.min(1, 12 / Math.sqrt(Math.max(1, this.topology.data.nodes.length))),
    );
  }
  isInteractive(n: SceneNode) {
    return inside(
      project(n, this.motion.frame, this.view),
      usable(this.view, this.motion.frame.drawer),
    );
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
    ctx.beginPath();
    trace(
      ctx,
      connection(
        { x: (a.x ?? 0) * scale, y: (a.y ?? 0) * scale },
        { x: (b.x ?? 0) * scale, y: (b.y ?? 0) * scale },
        a.id,
        b.id,
      ),
      scale,
    );
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
    ctx.globalAlpha = alpha * this.lightDensity() * (connected ? 0.5 : 0.3);
    ctx.drawImage(
      this.light.texture(color),
      x - halo,
      y - halo,
      halo * 2,
      halo * 2,
    );
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = alpha;
    if (n.neighbors < 2) {
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
