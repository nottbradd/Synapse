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
import { GraphTopology, nodeRadius, type SceneNode } from "./topology";
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
  snapshot?: Snapshot;
  selected?: string;
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
        e.event.intent.kind === "follow"
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
    };
  }
  configure(
    snapshot: Snapshot,
    selected: string | undefined,
    query: string,
    view: Viewport,
    editorWidth: number,
    reduced: boolean,
  ) {
    const now = performance.now(),
      scope = JSON.stringify(snapshot.organization.location),
      scopeChanged = scope !== this.scope;
    const sizeChanged =
      JSON.stringify(view) !== JSON.stringify(this.view) ||
      editorWidth !== this.editorWidth;
    const selectionChanged = this.selected !== selected;
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
        saved ??
          fitFrame(
            this.topology.data.nodes,
            view,
            0,
            !!snapshot.organization.location.subject_id,
          ),
        now,
      );
    }
    if (selectionChanged) {
      this.rings.select(selected, now);
      if (selected) {
        const node = this.topology.positions.get(selected);
        if (node && this.topology.data.nodes.includes(node)) {
          if (!this.selected)
            this.beforeDrawer = { ...this.motion.destination, drawer: 0 };
          this.retarget(
            {
              x: node.x ?? 0,
              y: node.y ?? 0,
              zoom: Math.max(0.9, Math.min(1.8, this.motion.frame.zoom)),
              drawer: editorWidth + 32,
            },
            now,
          );
        } else
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
        { ...this.motion.destination, drawer: selected ? editorWidth + 32 : 0 },
        now,
      );
    }
    this.selected = selected;
    this.updateRelated();
    this.dirty = true;
    this.wake();
  }
  installForces() {
    const api = this.api;
    if (!api) return;
    (
      api.d3Force("charge") as unknown as { strength: (v: number) => void }
    )?.strength(-105);
    (
      api.d3Force("link") as unknown as {
        distance: (
          fn: (e: { source: SceneNode; target: SceneNode }) => number,
        ) => void;
      }
    )?.distance((e) =>
      e.source.subject_id === e.target.subject_id ? 105 : 300,
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
        const cx = Math.floor((n.x ?? 0) / 24),
          cy = Math.floor((n.y ?? 0) / 24);
        for (let x = cx - 1; x <= cx + 1; x++)
          for (let y = cy - 1; y <= cy + 1; y++)
            for (const o of cells.get(`${x},${y}`) ?? []) {
              const dx = (n.x ?? 0) - (o.x ?? 0),
                dy = (n.y ?? 0) - (o.y ?? 0),
                d = Math.hypot(dx, dy) || 0.01,
                min = nodeRadius(n) + nodeRadius(o) + 12;
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
    this.engine = true;
    api.d3ReheatSimulation();
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
        this.topology.data.nodes,
        this.view,
        this.selected ? this.editorWidth + 32 : 0,
        !all && !!this.snapshot?.organization.location.subject_id,
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
        fraction === 0 && !this.selected ? "hidden" : "visible";
    }
    if (this.heading) this.heading.style.right = `${f.drawer + 28}px`;
    if (this.controls)
      this.controls.style.left = `${this.view.left + (this.view.width - this.view.left - f.drawer) / 2}px`;
    if (this.zoomText)
      this.zoomText.textContent = `${Math.round(f.zoom * 100)}%`;
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
        (intent.kind === "select" || intent.kind === "follow") &&
        this.selected === intent.node
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
        feedback.cancel(this.signals.replace(plan));
        feedback.arrivals(plan, intent.kind === "follow");
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
    return this.topology.data.nodes.map((n) => {
      const match = `${n.title} ${n.id}`
        .toLowerCase()
        .includes(this.query.toLowerCase());
      return {
        ...project(n, frame, this.view),
        id: n.id,
        title: n.title,
        radius: Math.max(2.5, nodeRadius(n) * frame.zoom),
        priority:
          n.id === this.selected
            ? 1000
            : n.id === this.hover
              ? 900
              : this.query
                ? match
                  ? 700
                  : 0
                : frame.zoom < 0.5
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
        ctx.globalAlpha = 0.72;
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
        ctx.beginPath();
        ctx.arc(n.x, n.y, (n.radius + 6) * (0.8 + 0.2 * value), 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    if (!this.reduced)
      for (const p of this.signals.packets) {
        const a = nodes.find((n) => n.id === p.source),
          b = nodes.find((n) => n.id === p.target);
        if (!a || !b) continue;
        const t = (now - p.start) / p.duration;
        ctx.fillStyle = p.color;
        ctx.strokeStyle = p.color;
        if (t >= 0 && t < 1) {
          ctx.globalAlpha = 0.85;
          ctx.lineWidth = 1.3;
          ctx.beginPath();
          const tail = Math.max(
            0,
            t -
              Math.min(
                0.16,
                18 / Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
              ),
          );
          ctx.moveTo(a.x + (b.x - a.x) * tail, a.y + (b.y - a.y) * tail);
          ctx.lineTo(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(
            a.x + (b.x - a.x) * t,
            a.y + (b.y - a.y) * t,
            1.7,
            0,
            Math.PI * 2,
          );
          ctx.fill();
        } else if (t >= 1) {
          const bloom = (now - p.arrival) / MOTION.bloomDuration;
          if (bloom < 1) {
            ctx.globalAlpha = (1 - bloom) * 0.35;
            ctx.beginPath();
            ctx.arc(b.x, b.y, b.radius + 4 + bloom * 4, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    ctx.restore();
  }
  drawNode(n: SceneNode, ctx: CanvasRenderingContext2D, scale: number) {
    const color = this.colors.get(n.subject_id) ?? "#95a6b8",
      r = Math.max(nodeRadius(n), 2.5 / scale),
      x = n.x ?? 0,
      y = n.y ?? 0;
    const active = n.id === this.selected || n.id === this.hover;
    ctx.globalAlpha =
      (this.query &&
        !`${n.title} ${n.id}`
          .toLowerCase()
          .includes(this.query.toLowerCase())) ||
      (this.hover && !this.related.has(n.id))
        ? 0.25
        : 1;
    ctx.fillStyle = color + "12";
    ctx.beginPath();
    ctx.arc(x, y, r + 3 / scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = color + (active ? "b8" : "55");
    ctx.strokeStyle = color;
    ctx.lineWidth = 0.8 / scale;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = active ? "#f0f8ff" : color;
    ctx.beginPath();
    ctx.arc(x, y, Math.max(0.8, r * 0.32), 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}
