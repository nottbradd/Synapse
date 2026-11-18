import {
  clamp,
  smooth,
  type Lettering,
  type Point,
  type Rect,
} from "./geometry";
import { junction } from "../interaction/connections";
import type { NodeOutline, PresentationEdge } from "./presentation";

const blue = "#38a8ff",
  magenta = "#ff4d8d";
function line(ctx: CanvasRenderingContext2D, a: Point, b: Point) {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}
function handle(ctx: CanvasRenderingContext2D, p: Point, size: number) {
  ctx.fillStyle = "#fff";
  ctx.strokeStyle = blue;
  ctx.lineWidth = 1;
  ctx.fillRect(p.x - size / 2, p.y - size / 2, size, size);
  ctx.strokeRect(p.x - size / 2, p.y - size / 2, size, size);
}
function badge(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
) {
  ctx.font = "600 10.5px 'Segoe UI', sans-serif";
  ctx.textBaseline = "middle";
  const w = ctx.measureText(text).width + 9;
  x = Math.max(2, Math.min(innerWidth - w - 2, x));
  y = Math.max(2, Math.min(innerHeight - 17, y));
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x, y, w, 15, 3);
  ctx.fill();
  ctx.fillStyle = "#0b0f14";
  ctx.fillText(text, x + 4.5, y + 7.5);
}
export function selection(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  dimensions: boolean,
) {
  ctx.strokeStyle = blue;
  ctx.lineWidth = 1;
  ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.width, r.height);
  if (!dimensions) return;
  for (const x of [r.x, r.x + r.width])
    for (const y of [r.y, r.y + r.height]) handle(ctx, { x, y }, 5);
  badge(
    ctx,
    `${Math.round(r.width)} × ${Math.round(r.height)}`,
    r.x + r.width / 2 - 19,
    r.y + r.height + 6,
    blue,
  );
}
export function spacing(
  ctx: CanvasRenderingContext2D,
  source: Point,
  head: Point,
) {
  ctx.strokeStyle = magenta;
  ctx.lineWidth = 1;
  line(ctx, source, head);
  const delta = Math.round(
    Math.max(Math.abs(head.x - source.x), Math.abs(head.y - source.y)),
  );
  badge(
    ctx,
    String(delta),
    (source.x + head.x) / 2 + 6,
    (source.y + head.y) / 2 - 8,
    magenta,
  );
}
export function alignment(
  ctx: CanvasRenderingContext2D,
  x: number,
  height: number,
) {
  ctx.strokeStyle = magenta;
  ctx.lineWidth = 0.8;
  line(ctx, { x, y: 0 }, { x, y: height });
}
export function letters(
  ctx: CanvasRenderingContext2D,
  run: Lettering,
  count: number,
  caret: boolean,
) {
  ctx.save();
  ctx.font = run.font;
  ctx.letterSpacing = run.spacing;
  ctx.textAlign = "left";
  ctx.textBaseline = run.baseline;
  ctx.globalAlpha *= run.alpha;
  ctx.fillStyle = run.color;
  ctx.fillText(run.text.slice(0, count).join(""), run.x, run.y);
  if (caret)
    ctx.fillRect(
      run.x + (run.widths[count - 1] ?? 0) + 1,
      run.y - run.size * (run.baseline === "middle" ? 0.52 : 0.82),
      1.5,
      run.size * 1.06,
    );
  ctx.restore();
}
export function wire(
  ctx: CanvasRenderingContext2D,
  edge: PresentationEdge,
  color: string,
  head: Point,
  progress: number,
) {
  const path = edge.path,
    live = progress < 0.68,
    settle = smooth((progress - 0.68) / 0.32);
  ctx.strokeStyle = live ? color : edge.color;
  ctx.lineWidth = live ? 1 : edge.width;
  ctx.beginPath();
  ctx.moveTo(path.a.x, path.a.y);
  if (live) ctx.lineTo(head.x, head.y);
  else {
    const control = (p: Point, f: number, axis: "x" | "y") => {
      const line = path.a[axis] + (path.d[axis] - path.a[axis]) * f;
      return line + (p[axis] - line) * settle;
    };
    ctx.bezierCurveTo(
      control(path.b, 1 / 3, "x"),
      control(path.b, 1 / 3, "y"),
      control(path.c, 2 / 3, "x"),
      control(path.c, 2 / 3, "y"),
      path.d.x,
      path.d.y,
    );
  }
  ctx.stroke();
  if (progress < 1) {
    ctx.save();
    ctx.globalAlpha *= 1 - settle;
    handle(ctx, path.a, 5);
    handle(ctx, head, 5);
    ctx.restore();
  }
}
export function completionPulse(
  ctx: CanvasRenderingContext2D,
  nodes: NodeOutline[],
  progress: number,
  scale: number,
) {
  if (progress <= 0 || progress >= 1) return;
  const reach = (1 - (1 - clamp(progress)) ** 3) * 14 * scale;
  ctx.save();
  ctx.globalAlpha = 0.6 * (1 - progress);
  ctx.lineWidth = 1.4;
  for (const n of nodes) {
    const r = n.radius + reach;
    ctx.strokeStyle = n.color;
    if (n.shape === "diamond") {
      ctx.beginPath();
      ctx.moveTo(n.x, n.y - r);
      ctx.lineTo(n.x + r, n.y);
      ctx.lineTo(n.x, n.y + r);
      ctx.lineTo(n.x - r, n.y);
      ctx.closePath();
    } else junction(ctx, n.x, n.y, r, n.shape === "port");
    ctx.stroke();
  }
  ctx.restore();
}
