import { overlaps, type Rect, type LabelNode } from "../graphLabels";
import { MOTION } from "./motion";
export interface AnimatedLabel {
  id: string;
  text: string;
  width: number;
  height: number;
  priority: number;
  theta: number;
  target: number;
  preferred: number;
  lastFlip: number;
  radius: number;
  targetRadius: number;
  alpha: number;
  show: boolean;
  leader: number;
  ox: number;
  oy: number;
}
export interface DrawLabel extends AnimatedLabel {
  x: number;
  y: number;
}
export function labelOffset(
  theta: number,
  radius: number,
  width: number,
  height: number,
) {
  return {
    x: Math.cos(theta) * (radius + 10 + width / 2),
    y:
      -Math.sin(theta) *
      (radius + 12 + height / 2 + Math.min(38, width * 0.22)),
  };
}
const boxAt = (n: LabelNode, l: AnimatedLabel, theta: number): Rect => {
  const o = labelOffset(theta, n.radius, l.width, l.height);
  return {
    x: n.x + o.x - l.width / 2,
    y: n.y + o.y - l.height / 2,
    width: l.width,
    height: l.height,
  };
};
export function intrusion(r: Rect, v: Rect) {
  return Math.max(
    v.x - r.x,
    v.y - r.y,
    r.x + r.width - v.x - v.width,
    r.y + r.height - v.y - v.height,
    0,
  );
}
const clearance = (r: Rect, v: Rect) =>
  Math.min(
    r.x - v.x,
    r.y - v.y,
    v.x + v.width - r.x - r.width,
    v.y + v.height - r.y - r.height,
  );
function truncate(text: string, max: number, measure: (s: string) => number) {
  const chars = Array.from(text);
  if (measure(text) <= max) return text;
  let low = 0,
    high = chars.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (measure(chars.slice(0, mid).join("") + "…") <= max) low = mid;
    else high = mid - 1;
  }
  return chars.slice(0, low).join("") + "…";
}
export class AnimatedLabels {
  readonly states = new Map<string, AnimatedLabel>();
  clear() {
    this.states.clear();
  }
  get active() {
    return [...this.states.values()].some(
      (l) =>
        Math.abs(l.theta - l.target) > 0.002 ||
        Math.abs(l.radius - l.targetRadius) > 0.02 ||
        Math.abs(l.alpha - (l.show ? 1 : 0)) > 0.005,
    );
  }
  plan(
    nodes: LabelNode[],
    viewport: Rect,
    measure: (s: string) => number,
    now: number,
    captions: Rect[] = [],
    height = 20,
  ) {
    const ids = new Set(nodes.map((n) => n.id));
    for (const id of this.states.keys())
      if (!ids.has(id)) this.states.delete(id);
    for (const l of this.states.values()) l.show = false;
    const obstacles = [
      ...captions,
      ...nodes.map((n) => ({
        x: n.x - n.radius - 4,
        y: n.y - n.radius - 4,
        width: n.radius * 2 + 8,
        height: n.radius * 2 + 8,
      })),
    ];
    const placed: Rect[] = [];
    for (const n of [...nodes]
      .filter((n) => n.priority > 0)
      .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))
      .slice(0, 120)) {
      const limit = Math.min(
        n.priority >= 700 ? 260 : 205,
        viewport.width - 24,
      );
      if (limit < 40) continue;
      const text = truncate(n.title, limit, measure),
        width = measure(text) + 8;
      let l = this.states.get(n.id);
      if (!l) {
        l = {
          id: n.id,
          text,
          width,
          height,
          priority: n.priority,
          theta: 0,
          target: 0,
          preferred: 0,
          lastFlip: -Infinity,
          radius: n.radius,
          targetRadius: n.radius,
          alpha: 0,
          show: false,
          leader: 0,
          ox: 0,
          oy: 0,
        };
        this.states.set(n.id, l);
      }
      Object.assign(l, {
        text,
        width,
        height,
        priority: n.priority,
        targetRadius: n.radius,
      });
      const collision = (r: Rect) =>
        [...obstacles, ...placed].some((o) => overlaps(r, o, 3));
      const clean = (angle: number) => {
        const r = boxAt(n, l, angle);
        return intrusion(r, viewport) === 0 && !collision(r);
      };
      const normal = boxAt(n, l, l.preferred),
        current = boxAt(n, l, l.target);
      const overlapsDepth = Math.max(
        0,
        ...[...obstacles, ...placed]
          .filter((o) => overlaps(current, o, 3))
          .map(
            (o) =>
              Math.min(
                current.x + current.width - o.x,
                o.x + o.width - current.x,
                current.y + current.height - o.y,
                o.y + o.height - current.y,
              ) + 3,
          ),
      );
      let target = l.target;
      if (
        l.target !== l.preferred &&
        clearance(normal, viewport) >= MOTION.restoreClearance &&
        !collision(normal)
      )
        target = l.preferred;
      else if (
        Math.max(intrusion(current, viewport), overlapsDepth) >
        MOTION.flipOverlap
      ) {
        target =
          [l.target < Math.PI / 2 ? Math.PI : 0, Math.PI / 2].find(clean) ??
          l.target;
      }
      if (target !== l.target && now - l.lastFlip >= MOTION.flipInterval) {
        l.target = target;
        l.lastFlip = now;
      }
      l.show = clean(l.target);
      if (l.show) placed.push(boxAt(n, l, l.target));
    }
  }
  advance(
    nodes: LabelNode[],
    dt: number,
    reduced: boolean,
    viewport: Rect,
    captions: Rect[] = [],
  ): DrawLabel[] {
    const k = reduced ? 1 : 1 - Math.exp(-Math.max(0, dt) / MOTION.labelTau),
      ka = reduced ? 1 : 1 - Math.exp(-Math.max(0, dt) / 0.045);
    const byId = new Map(nodes.map((n) => [n.id, n])),
      out: DrawLabel[] = [],
      boxes: Rect[] = [...captions];
    const obstacles = nodes.map((n) => ({
      x: n.x - n.radius - 3,
      y: n.y - n.radius - 3,
      width: n.radius * 2 + 6,
      height: n.radius * 2 + 6,
    }));
    for (const l of [...this.states.values()].sort(
      (a, b) => b.priority - a.priority,
    )) {
      const n = byId.get(l.id);
      if (!n) continue;
      l.targetRadius = n.radius;
      l.theta += (l.target - l.theta) * k;
      l.radius += (n.radius - l.radius) * k;
      if (Math.abs(l.radius - n.radius) < 0.02) l.radius = n.radius;
      l.alpha += ((l.show ? 1 : 0) - l.alpha) * ka;
      if (Math.abs(l.theta - l.target) < 0.002) l.theta = l.target;
      if (Math.abs(l.alpha - (l.show ? 1 : 0)) < 0.005)
        l.alpha = l.show ? 1 : 0;
      const o = labelOffset(l.theta, l.radius, l.width, l.height),
        normal = labelOffset(l.preferred, l.radius, l.width, l.height);
      l.ox = o.x;
      l.oy = o.y;
      l.leader +=
        ((Math.hypot(o.x - normal.x, o.y - normal.y) > MOTION.leaderDistance
          ? 1
          : 0) -
          l.leader) *
        ka;
      const x = n.x + o.x,
        y = n.y + o.y,
        r = {
          x: x - l.width / 2,
          y: y - l.height / 2,
          width: l.width,
          height: l.height,
        };
      // Offsets always follow the current node projection. Intervening obstacles
      // hide a moving label rather than allowing text to pass through a node.
      if (
        l.alpha < 0.01 ||
        intrusion(r, viewport) > 0 ||
        obstacles.some((b) => overlaps(r, b)) ||
        boxes.some((b) => overlaps(r, b, 4))
      )
        continue;
      boxes.push(r);
      out.push({ ...l, x, y });
    }
    return out;
  }
}
export class SelectionRings {
  private rings = new Map<string, { from: number; to: number; at: number }>();
  private selected?: string;
  value(id: string, time: number, reduced = false) {
    const r = this.rings.get(id);
    if (!r) return 0;
    const t = reduced
      ? 1
      : Math.min(
          1,
          Math.max(0, (time - r.at) / (r.to ? MOTION.ringIn : MOTION.ringOut)),
        );
    return r.from + (r.to - r.from) * (t * t * (3 - 2 * t));
  }
  select(id: string | undefined, time: number) {
    if (id === this.selected) return;
    for (const key of this.rings.keys())
      this.rings.set(key, { from: this.value(key, time), to: 0, at: time });
    if (id) this.rings.set(id, { from: this.value(id, time), to: 1, at: time });
    this.selected = id;
  }
  active(time: number) {
    for (const [id, r] of this.rings)
      if (r.to === 0 && time - r.at > MOTION.ringOut) this.rings.delete(id);
    return [...this.rings.values()].some(
      (r) => time - r.at < (r.to ? MOTION.ringIn : MOTION.ringOut),
    );
  }
}
