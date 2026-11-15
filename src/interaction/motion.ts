export const MOTION = {
  omega: 20,
  positionEpsilon: 0.015,
  velocityEpsilon: 0.04,
  labelTau: 0.09,
  flipOverlap: 12,
  restoreClearance: 30,
  flipInterval: 300,
  leaderDistance: 14,
  ringIn: 150,
  ringOut: 200,
  titleDuration: 180,
  signalSpeed: 180,
  bloomDuration: 120,
} as const;

export interface Spring {
  value: number;
  velocity: number;
  target: number;
}
// Exact critically damped solution. Retargeting changes only the destination,
// retaining the current position and velocity even when an intent reverses.
export function stepSpring(
  s: Spring,
  seconds: number,
  omega = MOTION.omega,
): Spring {
  const dt = Math.max(0, seconds),
    error = s.value - s.target;
  const c = s.velocity + omega * error,
    decay = Math.exp(-omega * dt);
  const value = s.target + (error + c * dt) * decay;
  const velocity = (s.velocity - omega * c * dt) * decay;
  return Math.abs(value - s.target) < MOTION.positionEpsilon &&
    Math.abs(velocity) < MOTION.velocityEpsilon
    ? { value: s.target, target: s.target, velocity: 0 }
    : { value, velocity, target: s.target };
}
export interface Frame {
  x: number;
  y: number;
  zoom: number;
  drawer: number;
}
export interface Viewport {
  width: number;
  height: number;
  left: number;
}
export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
export function usable(v: Viewport, drawer: number): Bounds {
  return {
    x: v.left + 24,
    y: 92,
    width: Math.max(80, v.width - v.left - drawer - 48),
    height: Math.max(80, v.height - 180),
  };
}
export function project(
  p: { x?: number; y?: number },
  frame: Frame,
  view: Viewport,
) {
  const b = usable(view, frame.drawer);
  return {
    x: b.x + b.width / 2 + ((p.x ?? 0) - frame.x) * frame.zoom,
    y: b.y + b.height / 2 + ((p.y ?? 0) - frame.y) * frame.zoom,
  };
}
export function cameraCentre(frame: Frame, view: Viewport) {
  const b = usable(view, frame.drawer);
  return {
    x: frame.x + (view.width / 2 - b.x - b.width / 2) / frame.zoom,
    y: frame.y + (view.height / 2 - b.y - b.height / 2) / frame.zoom,
  };
}
export function frameFromCamera(
  centre: { x: number; y: number },
  zoom: number,
  drawer: number,
  view: Viewport,
): Frame {
  const b = usable(view, drawer);
  return {
    x: centre.x - (view.width / 2 - b.x - b.width / 2) / zoom,
    y: centre.y - (view.height / 2 - b.y - b.height / 2) / zoom,
    zoom,
    drawer,
  };
}
export function fitFrame(
  points: { x?: number; y?: number }[],
  view: Viewport,
  drawer: number,
  core = false,
): Frame {
  if (!points.length) return { x: 0, y: 0, zoom: 1, drawer };
  const xs = points.map((p) => p.x ?? 0).sort((a, b) => a - b),
    ys = points.map((p) => p.y ?? 0).sort((a, b) => a - b);
  const trim =
    core && points.length > 12 ? Math.floor(points.length * 0.05) : 0;
  const [minX, maxX, minY, maxY] = [
    xs[trim],
    xs[xs.length - 1 - trim],
    ys[trim],
    ys[ys.length - 1 - trim],
  ];
  const b = usable(view, drawer);
  return {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
    zoom: Math.min(
      2.2,
      Math.max(40, b.width - 128) / Math.max(70, maxX - minX),
      Math.max(40, b.height - 112) / Math.max(70, maxY - minY),
    ),
    drawer,
  };
}
export class LayoutMotion {
  private springs: Record<"x" | "y" | "zoom" | "drawer", Spring>;
  private time: number;
  constructor(frame: Frame, time = 0) {
    this.time = time;
    this.springs = this.make(frame);
  }
  private make(f: Frame) {
    return Object.fromEntries(
      Object.entries({ ...f, zoom: Math.log(f.zoom) }).map(([k, v]) => [
        k,
        { value: v, target: v, velocity: 0 },
      ]),
    ) as typeof this.springs;
  }
  get frame(): Frame {
    const s = this.springs;
    return {
      x: s.x.value,
      y: s.y.value,
      zoom: Math.exp(s.zoom.value),
      drawer: s.drawer.value,
    };
  }
  get destination(): Frame {
    const s = this.springs;
    return {
      x: s.x.target,
      y: s.y.target,
      zoom: Math.exp(s.zoom.target),
      drawer: s.drawer.target,
    };
  }
  get velocities() {
    return Object.fromEntries(
      Object.entries(this.springs).map(([k, s]) => [k, s.velocity]),
    );
  }
  get active() {
    return Object.values(this.springs).some(
      (s) => s.value !== s.target || s.velocity !== 0,
    );
  }
  retarget(frame: Frame, time: number, reduced = false) {
    this.advance(time);
    for (const [k, value] of Object.entries({
      ...frame,
      zoom: Math.log(frame.zoom),
    }))
      this.springs[k as keyof typeof this.springs].target = value;
    if (reduced) this.snap(frame, time);
  }
  snap(frame: Frame, time: number) {
    this.springs = this.make(frame);
    this.time = time;
  }
  advance(time: number, reduced = false): Frame {
    const dt = Math.max(0, (time - this.time) / 1000);
    this.time = time;
    for (const k of Object.keys(
      this.springs,
    ) as (keyof typeof this.springs)[]) {
      const s = this.springs[k];
      this.springs[k] = reduced
        ? { value: s.target, target: s.target, velocity: 0 }
        : stepSpring(s, dt);
    }
    return this.frame;
  }
}
