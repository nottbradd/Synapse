import type { AllNotesData } from "./allNotesData";
import type { SettledNetwork } from "./allNotesLayout";
import {
  LayoutMotion,
  cameraCentre,
  type Frame,
  type Viewport,
} from "./motion";
import { TextMeasurements, watchFonts } from "./fonts";
import type {
  GraphPresentation,
  PresentationNode,
} from "../startup/presentation";

type Label = { id: number; x: number; y: number; w: number; h: number };
type Point = { x: number; y: number };
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));
const font = "500 11px Geist, sans-serif",
  bold = "600 12px Geist, sans-serif";
const tau = Math.PI * 2;
const canvasColor = "#090d13";
function socket(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
) {
  const c = r * 0.35;
  ctx.beginPath();
  ctx.moveTo(x - r + c, y - r);
  ctx.lineTo(x + r - c, y - r);
  ctx.lineTo(x + r, y - r + c);
  ctx.lineTo(x + r, y + r - c);
  ctx.lineTo(x + r - c, y + r);
  ctx.lineTo(x - r + c, y + r);
  ctx.lineTo(x - r, y + r - c);
  ctx.lineTo(x - r, y - r + c);
  ctx.closePath();
  ctx.stroke();
}
export class AllNotesCanvas {
  readonly motion = new LayoutMotion(
    { x: 0, y: 0, zoom: 1, drawer: 0 },
    performance.now(),
  );
  private ctx: CanvasRenderingContext2D;
  private texts = new TextMeasurements();
  private resize: ResizeObserver;
  private stopFonts: () => void;
  private abort = new AbortController();
  private raf = 0;
  private disposed = false;
  private width = 1;
  private height = 1;
  private dpr = 1;
  private baseZoom = 1;
  private revision = -1;
  private fitting = true;
  private reduced = false;
  private panelWidth = 480;
  private panelOpen = false;
  private selected?: string;
  private hover = -1;
  private drag?: { id: number; start: Point; frame: Frame; moved: boolean };
  private labels: Label[] = [];
  private screen = new Float32Array(0);
  private strokes: Uint32Array[] = [];
  private overviewHubs: number[] = [];
  private hubs: number[] = [];
  private roles = new Uint8Array(0);
  private data?: AllNotesData;
  private layout?: SettledNetwork;
  constructor(
    private canvas: HTMLCanvasElement,
    private host: HTMLElement,
    private zoomText: HTMLElement,
    private drawer: () => HTMLElement | null,
    private open: (id: string) => void,
  ) {
    this.ctx = canvas.getContext("2d", { alpha: false })!;
    this.resize = new ResizeObserver(() => this.resizeView());
    this.resize.observe(host);
    this.stopFonts = watchFonts(this.texts, () => this.wake());
    const opts = { signal: this.abort.signal };
    canvas.addEventListener("pointerdown", this.down, opts);
    canvas.addEventListener("pointermove", this.move, opts);
    canvas.addEventListener("pointerup", this.up, opts);
    canvas.addEventListener("pointercancel", this.cancel, opts);
    canvas.addEventListener("lostpointercapture", this.cancel, opts);
    canvas.addEventListener("pointerleave", () => this.setHover(-1), opts);
    canvas.addEventListener("wheel", this.wheel, { ...opts, passive: false });
    window.addEventListener("resize", () => this.resizeView(), opts);
    this.resizeView();
  }
  dispose() {
    this.disposed = true;
    this.abort.abort();
    this.resize.disconnect();
    this.stopFonts();
    cancelAnimationFrame(this.raf);
  }
  setData(data: AllNotesData, layout: SettledNetwork | undefined) {
    const changed = this.layout !== layout;
    this.data = data;
    this.layout = layout;
    if (changed) {
      this.hover = -1;
      this.labels = [];
    }
    if (changed && layout) {
      this.screen = new Float32Array(data.notes.length * 2);
      const paths: number[][] = [[], []];
      for (let i = 0; i < data.edges.length; i += 2) {
        const a = data.edges[i],
          b = data.edges[i + 1];
        paths[layout.community[a] === layout.community[b] ? 0 : 1].push(a, b);
      }
      this.strokes = paths.map((p) => Uint32Array.from(p));
      this.revision = -1;
      const scores = data.neighbors.map(
        (peers, i) =>
          peers.length +
          0.38 *
            peers
              .slice(0, 12)
              .reduce(
                (sum, j) => sum + Math.min(64, data.neighbors[j].length),
                0,
              ) +
          3 *
            new Set(
              peers
                .map((j) => layout.community[j])
                .filter((c) => c !== layout.community[i]),
            ).size,
      );
      const representatives = new Map<number, number>();
      for (const i of data.rank) {
        if (data.neighbors[i].length < (data.notes.length < 40 ? 2 : 5)) break;
        const c = layout.community[i],
          old = representatives.get(c);
        if (old === undefined || scores[i] > scores[old])
          representatives.set(c, i);
      }
      this.overviewHubs = [...representatives.values()].sort(
        (a, b) => scores[b] - scores[a] || a - b,
      );
      this.hubs = [...new Set([...this.overviewHubs, ...data.hubs])].slice(
        0,
        Math.max(5, Math.ceil(Math.sqrt(data.notes.length) * 0.85)),
      );
      this.overviewHubs = this.overviewHubs.slice(0, this.hubs.length);
      this.roles = data.role.map((role) => Math.min(role, 1));
      for (const i of this.hubs) this.roles[i] = 2;
    }
    this.wake();
  }
  configure(
    revision: number,
    restore: Frame | undefined,
    selected: string | undefined,
    width: number,
    auxiliary: boolean,
    reduced: boolean,
  ) {
    const open = !!selected || auxiliary,
      drawer = open ? width + 32 : 0;
    const changedPanel = this.panelOpen !== open || this.panelWidth !== width;
    this.panelOpen = open;
    this.panelWidth = width;
    this.selected = selected;
    this.reduced = reduced;
    if (!this.layout) {
      this.wake();
      return;
    }
    this.baseZoom = this.fitFrame(0).zoom;
    if (revision !== this.revision) {
      const first = this.revision === -1;
      this.revision = revision;
      this.hover = -1;
      const index =
        selected === undefined ? undefined : this.data?.index.get(selected);
      this.fitting = !restore && index === undefined;
      const target = restore
        ? { ...restore, drawer }
        : index !== undefined
          ? this.focusFrame(index, drawer)
          : this.fitFrame(drawer);
      if (first) this.motion.snap(target, performance.now());
      else this.motion.retarget(target, performance.now(), reduced);
    } else if (changedPanel) {
      // Closing the drawer only animates its width. The screen projection stays put.
      this.motion.retarget(
        { ...this.motion.destination, drawer },
        performance.now(),
        reduced,
      );
    } else if (reduced && this.motion.active)
      this.motion.snap(this.motion.destination, performance.now());
    this.wake();
  }
  private viewport(): Viewport {
    return {
      left: 0,
      width: this.width,
      height: this.height,
      top: 76,
      bottom: 62,
    };
  }
  private fitFrame(drawer: number): Frame {
    const b = this.layout?.bounds ?? { left: 0, right: 0, top: 0, bottom: 0 };
    const zoom = Math.min(
      3,
      Math.max(40, this.width - drawer - 72) / Math.max(48, b.right - b.left),
      Math.max(40, this.height - 166) / Math.max(48, b.bottom - b.top),
    );
    const frame = {
      x: (b.left + b.right) / 2,
      y: (b.top + b.bottom) / 2,
      zoom,
      drawer,
    };
    return { ...frame, ...cameraCentre(frame, this.viewport()) };
  }
  private focusFrame(index: number, drawer: number): Frame {
    const zoom = Math.max(
      this.motion.frame.zoom,
      this.baseZoom * (this.roles[index] === 2 ? 2.55 : 3.35),
    );
    const xy = this.layout!.xy;
    const frame = { x: xy[2 * index], y: xy[2 * index + 1], zoom, drawer };
    return { ...frame, ...cameraCentre(frame, this.viewport()) };
  }
  private resizeView() {
    const { width, height } = this.host.getBoundingClientRect(),
      dpr = window.devicePixelRatio || 1;
    if (width === this.width && height === this.height && dpr === this.dpr)
      return;
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.dpr = dpr;
    this.canvas.width = Math.round(this.width * dpr);
    this.canvas.height = Math.round(this.height * dpr);
    this.baseZoom = this.fitFrame(0).zoom;
    if (this.layout && this.fitting)
      this.motion.snap(
        this.fitFrame(this.motion.destination.drawer),
        performance.now(),
      );
    this.wake();
  }
  private local(e: MouseEvent): Point {
    const b = this.canvas.getBoundingClientRect();
    return { x: e.clientX - b.left, y: e.clientY - b.top };
  }
  private down = (e: PointerEvent) => {
    if (!this.layout || e.button !== 0 || !e.isPrimary) return;
    const start = this.local(e);
    this.drag = {
      id: e.pointerId,
      start,
      frame: this.motion.frame,
      moved: false,
    };
    this.canvas.setPointerCapture(e.pointerId);
  };
  private move = (e: PointerEvent) => {
    const p = this.local(e),
      d = this.drag;
    if (d && e.pointerId === d.id) {
      const dx = p.x - d.start.x,
        dy = p.y - d.start.y;
      if (!d.moved && Math.hypot(dx, dy) < 4) return;
      d.moved = true;
      this.fitting = false;
      this.canvas.dataset.dragging = "true";
      this.setHover(-1);
      this.manual({
        ...d.frame,
        x: d.frame.x - dx / d.frame.zoom,
        y: d.frame.y - dy / d.frame.zoom,
      });
      this.wake();
    } else if (!d) this.setHover(this.hit(p));
  };
  private up = (e: PointerEvent) => {
    const d = this.drag;
    if (!d || d.id !== e.pointerId) return;
    const id = !d.moved ? this.hit(this.local(e)) : -1;
    this.cancel();
    if (this.canvas.hasPointerCapture(e.pointerId))
      this.canvas.releasePointerCapture(e.pointerId);
    if (id >= 0) this.choose(this.data!.notes[id].id);
  };
  private cancel = () => {
    this.drag = undefined;
    delete this.canvas.dataset.dragging;
  };
  choose(id: string) {
    if (id !== this.selected) {
      this.open(id);
      return;
    }
    const i = this.data?.index.get(id);
    if (i !== undefined && this.layout) {
      this.fitting = false;
      this.motion.retarget(
        this.focusFrame(i, this.panelWidth + 32),
        performance.now(),
        this.reduced,
      );
      this.wake();
    }
  }
  private manual(frame: Frame) {
    const now = performance.now();
    this.motion.snap(frame, now);
    const drawer = this.panelOpen ? this.panelWidth + 32 : 0;
    if (frame.drawer !== drawer)
      this.motion.retarget({ ...frame, drawer }, now, this.reduced);
  }
  private setHover(id: number) {
    if (this.hover !== id) {
      this.hover = id;
      this.canvas.style.cursor = id < 0 ? "" : "pointer";
      this.wake();
    }
  }
  private wheel = (e: WheelEvent) => {
    e.preventDefault();
    const delta =
      e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.height : 1);
    this.zoomBy(Math.exp(clamp(-delta * 0.0015, -2, 2)), this.local(e), true);
  };
  zoomBy(factor: number, point?: Point, direct = false) {
    if (!this.layout) return;
    const f = direct ? this.motion.frame : this.motion.destination;
    const p = point ?? { x: (this.width - f.drawer) / 2, y: this.height / 2 };
    const z = clamp(f.zoom * factor, this.baseZoom * 0.35, this.baseZoom * 18);
    const px = p.x - this.width / 2,
      py = p.y - this.height / 2;
    const next = {
      ...f,
      x: f.x + px * (1 / f.zoom - 1 / z),
      y: f.y + py * (1 / f.zoom - 1 / z),
      zoom: z,
    };
    this.fitting = false;
    this.setHover(-1);
    if (direct) this.manual(next);
    else this.motion.retarget(next, performance.now(), this.reduced);
    this.wake();
  }
  private hit(p: Point) {
    if (
      !this.layout ||
      !this.data ||
      p.x > this.width - this.motion.frame.drawer
    )
      return -1;
    const label = this.labels.find(
      (l) =>
        p.x >= l.x - 2 &&
        p.x <= l.x + l.w + 2 &&
        p.y >= l.y - 2 &&
        p.y <= l.y + l.h + 2,
    );
    if (label) return label.id;
    let pick = -1,
      best = Infinity;
    for (const i of this.data.rank) {
      const dx = this.screen[2 * i] - p.x,
        dy = this.screen[2 * i + 1] - p.y;
      const limit = this.roles[i] === 2 ? 8 : 4.5;
      const d = dx * dx + dy * dy;
      if (d < limit * limit && d < best) {
        pick = i;
        best = d;
      }
    }
    return pick;
  }
  wake = () => {
    if (!this.raf && !this.disposed)
      this.raf = requestAnimationFrame(this.draw);
  };
  draw = (time: number) => {
    this.raf = 0;
    const f = this.motion.advance(time, this.reduced),
      ctx = this.ctx,
      z = f.zoom;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = canvasColor;
    ctx.fillRect(0, 0, this.width, this.height);
    const right = this.width - f.drawer,
      ratio = z / this.baseZoom;
    this.zoomText.textContent = Math.round(ratio * 100) + "%";
    this.host.style.setProperty("--map-drawer", f.drawer + "px");
    this.host.style.setProperty("--map-space", right + "px");
    this.host.toggleAttribute("data-narrow-map", right < 420);
    this.host.toggleAttribute("data-tight-map", right < 235);
    const drawer = this.drawer();
    if (drawer) {
      const part = clamp(f.drawer / (this.panelWidth + 32), 0, 1);
      drawer.style.transform =
        "translateX(" + (this.panelWidth + 24) * (1 - part) + "px)";
      drawer.style.visibility =
        !this.panelOpen && part === 0 ? "hidden" : "visible";
    }
    const data = this.data,
      layout = this.layout;
    if (data && layout) {
      const xy = layout.xy,
        s = this.screen,
        ox = this.width / 2 - f.x * z,
        oy = this.height / 2 - f.y * z;
      for (let i = 0; i < xy.length; i += 2) {
        s[i] = xy[i] * z + ox;
        s[i + 1] = xy[i + 1] * z + oy;
      }
      const active =
        this.hover >= 0
          ? this.hover
          : ((this.selected ? data.index.get(this.selected) : -1) ?? -1);
      const visible = (id: number) =>
        s[2 * id] > -10 &&
        s[2 * id] < right + 10 &&
        s[2 * id + 1] > -10 &&
        s[2 * id + 1] < this.height + 10;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, Math.max(0, right + 1), this.height);
      ctx.clip();
      this.strokes.forEach((pairs, group) => {
        ctx.beginPath();
        for (let i = 0; i < pairs.length; i += 2) {
          const a = 2 * pairs[i],
            b = 2 * pairs[i + 1],
            x = s[a],
            y = s[a + 1],
            u = s[b],
            v = s[b + 1];
          if (
            (x < 0 && u < 0) ||
            (x > right && u > right) ||
            (y < 0 && v < 0) ||
            (y > this.height && v > this.height)
          )
            continue;
          ctx.moveTo(x, y);
          ctx.lineTo(u, v);
        }
        ctx.globalAlpha = (group ? 0.17 : 0.28) * (active >= 0 ? 0.43 : 1);
        ctx.strokeStyle = group ? "#8294ad" : "#74849a";
        ctx.lineWidth = 0.63 * clamp(Math.sqrt(ratio), 0.8, 1.45);
        ctx.stroke();
      });
      const factor = clamp(0.78 + 0.24 * Math.sqrt(ratio), 0.8, 1.7);
      ctx.beginPath();
      for (let i = 0; i < data.notes.length; i++)
        if (!this.roles[i] && visible(i)) {
          const r = (data.neighbors[i].length <= 1 ? 0.69 : 0.85) * factor,
            x = s[2 * i],
            y = s[2 * i + 1];
          if (ratio < 0.7) ctx.rect(x - r, y - r, r * 2, r * 2);
          else {
            ctx.moveTo(x + r, y);
            ctx.arc(x, y, r, 0, tau);
          }
        }
      ctx.fillStyle = "#aab7c6";
      ctx.globalAlpha = active >= 0 ? 0.33 : 0.76;
      ctx.fill();
      for (const i of data.rank) {
        if (!this.roles[i] || !visible(i)) continue;
        const hub = this.roles[i] === 2,
          color = data.groups[data.subjects[i]].color,
          x = s[2 * i],
          y = s[2 * i + 1],
          r =
            (hub
              ? clamp(1 + Math.sqrt(data.neighbors[i].length) * 0.22, 2.1, 4.45)
              : 1.4) * factor;
        ctx.globalAlpha = active >= 0 ? 0.38 : 0.88;
        ctx.fillStyle = color;
        if (hub) {
          ctx.fillRect(x - r * 0.68, y - r * 0.68, r * 1.36, r * 1.36);
          if (ratio >= 0.7) {
            ctx.strokeStyle = color;
            ctx.lineWidth = 0.83;
            socket(ctx, x, y, r + 2.2);
          }
        } else {
          ctx.beginPath();
          ctx.arc(x, y, r, 0, tau);
          ctx.fill();
        }
      }
      if (active >= 0) {
        const x = s[2 * active],
          y = s[2 * active + 1],
          color = data.groups[data.subjects[active]].color;
        ctx.beginPath();
        for (const j of data.neighbors[active]) {
          ctx.moveTo(x, y);
          ctx.lineTo(s[2 * j], s[2 * j + 1]);
        }
        ctx.strokeStyle = "color-mix(in srgb, " + color + " 78%, #d2e1ee)";
        ctx.lineWidth = 0.95;
        ctx.globalAlpha = 0.9;
        ctx.stroke();
        ctx.globalAlpha = 1;
        for (const j of data.neighbors[active])
          if (visible(j)) {
            ctx.fillStyle = data.groups[data.subjects[j]].color;
            ctx.beginPath();
            ctx.arc(
              s[2 * j],
              s[2 * j + 1],
              (this.roles[j] ? 2.5 : 1.6) * factor,
              0,
              tau,
            );
            ctx.fill();
          }
        ctx.fillStyle = "#e4f2ee";
        ctx.fillRect(x - 2.6, y - 2.6, 5.2, 5.2);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.3;
        socket(ctx, x, y, 6.4 * factor);
      }
      this.drawLabels(active, ratio, right);
      ctx.restore();
    }
    if (this.motion.active) this.wake();
  };
  private drawLabels(active: number, ratio: number, right: number) {
    this.labels = [];
    const data = this.data!,
      s = this.screen,
      ctx = this.ctx;
    const budget =
      ratio < 0.7
        ? 5
        : right < 470
          ? 7
          : active >= 0
            ? 13
            : ratio < 1.3
              ? 10
              : ratio < 2
                ? 16
                : 26;
    const origin = this.host.getBoundingClientRect();
    const obstacles = Array.from(
      this.host.querySelectorAll(
        ".map-heading,.map-controls,.map-picker-popup,.map-legend",
      ),
      (el) => {
        const b = el.getBoundingClientRect();
        return {
          x: b.left - origin.left,
          y: b.top - origin.top,
          w: b.width,
          h: b.height,
        };
      },
    );
    const candidates =
      active >= 0
        ? [active, ...data.neighbors[active], ...this.hubs]
        : ratio < 1.3
          ? [...this.overviewHubs, ...this.hubs]
          : data.rank;
    for (const id of candidates) {
      if (this.labels.length >= budget) break;
      if (!this.roles[id] && active < 0 && ratio < 2.6) continue;
      if (this.labels.some((l) => l.id === id)) continue;
      const x = s[2 * id],
        y = s[2 * id + 1];
      if (x < 3 || y < 66 || x > right - 4 || y > this.height - 57) continue;
      const name = data.notes[id].title,
        emphasis = active === id;
      ctx.font = emphasis ? bold : font;
      const w = this.texts.width(ctx, ctx.font, name),
        h = 14,
        gap = this.roles[id] === 2 ? 10 : 6;
      for (const [lx, ly] of [
        [x + gap, y - h / 2],
        [x - w - gap, y - h / 2],
        [x - w / 2, y + gap],
        [x - w / 2, y - h - gap],
      ]) {
        if (
          lx < 7 ||
          lx + w >= right - 8 ||
          ly < 67 ||
          ly + h > this.height - 60
        )
          continue;
        if (
          obstacles.some(
            (l) =>
              lx < l.x + l.w + 4 &&
              lx + w + 4 > l.x &&
              ly < l.y + l.h + 3 &&
              ly + h + 3 > l.y,
          )
        )
          continue;
        if (
          this.labels.some(
            (l) =>
              lx < l.x + l.w + 7 &&
              lx + w + 7 > l.x &&
              ly < l.y + l.h + 3 &&
              ly + h + 3 > l.y,
          )
        )
          continue;
        if (
          this.hubs.some(
            (j) =>
              j !== id &&
              s[2 * j] > lx - 6 &&
              s[2 * j] < lx + w + 6 &&
              s[2 * j + 1] > ly - 6 &&
              s[2 * j + 1] < ly + h + 6,
          )
        )
          continue;
        this.labels.push({ id, x: lx, y: ly, w, h });
        ctx.globalAlpha = 1;
        ctx.textBaseline = "middle";
        ctx.lineJoin = "round";
        ctx.lineWidth = 3;
        ctx.strokeStyle = canvasColor;
        ctx.strokeText(name, lx, ly + h / 2);
        ctx.fillStyle = emphasis ? "#f2f6fa" : "#c1cddc";
        ctx.fillText(name, lx, ly + h / 2);
        break;
      }
    }
  }
  presentation(): GraphPresentation | undefined {
    const data = this.data,
      layout = this.layout;
    if (!data || !layout || this.motion.active) return;
    const bounds = this.canvas.getBoundingClientRect(),
      right = this.width - this.motion.frame.drawer;
    const eligible = (i: number) =>
      this.screen[i * 2] > 10 &&
      this.screen[i * 2] < right - 10 &&
      this.screen[i * 2 + 1] > 70 &&
      this.screen[i * 2 + 1] < this.height - 60;
    const nodes: PresentationNode[] = [],
      edges: GraphPresentation["edges"] = [];
    const get = (i: number) => {
      const id = data.notes[i].id,
        existing = nodes.find((n) => n.id === id);
      if (existing) return existing;
      const x = this.screen[2 * i],
        y = this.screen[2 * i + 1],
        radius = this.roles[i] === 2 ? 5 : 2,
        extent = 8,
        sprite = document.createElement("canvas");
      sprite.width = sprite.height = extent * 2;
      sprite
        .getContext("2d")
        ?.drawImage(
          this.canvas,
          (x - extent) * this.dpr,
          (y - extent) * this.dpr,
          2 * extent * this.dpr,
          2 * extent * this.dpr,
          0,
          0,
          2 * extent,
          2 * extent,
        );
      const node = {
        id,
        x: x + bounds.x,
        y: y + bounds.y,
        radius,
        extent,
        sprite,
        color: data.groups[data.subjects[i]].color,
      };
      nodes.push(node);
      return node;
    };
    for (const i of data.rank.slice(0, 96)) {
      if (edges.length >= 3 || nodes.length >= 5) break;
      if (!eligible(i)) continue;
      for (const j of data.neighbors[i].slice(0, 20)) {
        if (!eligible(j)) continue;
        const a = get(i),
          d = get(j);
        if (
          edges.some(
            (e) =>
              (e.source === a.id && e.target === d.id) ||
              (e.source === d.id && e.target === a.id),
          )
        )
          continue;
        edges.push({
          id: a.id + "|" + d.id,
          source: a.id,
          target: d.id,
          path: { a, b: a, c: d, d },
          color: a.color,
          width: 0.7,
        });
        break;
      }
    }
    return {
      element: this.canvas,
      clip: { x: bounds.x, y: bounds.y, width: right, height: bounds.height },
      nodes,
      edges,
      outlines: () => nodes.map((n) => ({ ...n, shape: "junction" as const })),
      valid: () =>
        this.layout === layout && !this.disposed && !this.motion.active,
    };
  }
}
