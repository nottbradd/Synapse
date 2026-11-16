export interface Point {
  x: number;
  y: number;
}
export interface Curve {
  a: Point;
  b: Point;
  c: Point;
  d: Point;
}
// One deterministic 2D path is shared by links, travelling current and timing.
// A smooth distance ramp avoids shape switches while the camera zooms.
export function connection(
  a: Point,
  d: Point,
  source: string,
  target: string,
): Curve {
  if (source > target) {
    const c = connection(d, a, target, source);
    return { a: c.d, b: c.c, c: c.b, d: c.a };
  }
  const dx = d.x - a.x,
    dy = d.y - a.y,
    length = Math.hypot(dx, dy) || 1;
  let hash = 0;
  for (const c of [source, target].sort().join(":"))
    hash = (Math.imul(hash, 31) + c.charCodeAt(0)) | 0;
  const sign = hash & 1 ? 1 : -1;
  const bend =
    Math.min(0.075, Math.max(0, (length - 90) / 2400)) * length * sign;
  return {
    a,
    d,
    b: {
      x: a.x + dx * 0.32 - (dy / length) * bend,
      y: a.y + dy * 0.32 + (dx / length) * bend,
    },
    c: {
      x: a.x + dx * 0.72 - (dy / length) * bend * 0.65,
      y: a.y + dy * 0.72 + (dx / length) * bend * 0.65,
    },
  };
}
export function pointOn(c: Curve, t: number): Point {
  const u = 1 - t;
  return {
    x:
      u * u * u * c.a.x +
      3 * u * u * t * c.b.x +
      3 * u * t * t * c.c.x +
      t * t * t * c.d.x,
    y:
      u * u * u * c.a.y +
      3 * u * u * t * c.b.y +
      3 * u * t * t * c.c.y +
      t * t * t * c.d.y,
  };
}
export function curveLength(c: Curve) {
  let length = 0,
    previous = c.a;
  for (let i = 1; i <= 16; i++) {
    const p = pointOn(c, i / 16);
    length += Math.hypot(p.x - previous.x, p.y - previous.y);
    previous = p;
  }
  return length;
}
export function trace(ctx: CanvasRenderingContext2D, c: Curve, scale = 1) {
  ctx.moveTo(c.a.x / scale, c.a.y / scale);
  ctx.bezierCurveTo(
    c.b.x / scale,
    c.b.y / scale,
    c.c.x / scale,
    c.c.y / scale,
    c.d.x / scale,
    c.d.y / scale,
  );
}
export function junction(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  port = false,
) {
  const cut = r * 0.38;
  ctx.beginPath();
  ctx.moveTo(x + r, y - r * 0.25);
  ctx.lineTo(x + r, y - r + cut);
  ctx.lineTo(x + r - cut, y - r);
  ctx.lineTo(x - r + cut, y - r);
  ctx.lineTo(x - r, y - r + cut);
  ctx.lineTo(x - r, y + r - cut);
  ctx.lineTo(x - r + cut, y + r);
  ctx.lineTo(x + r - cut, y + r);
  ctx.lineTo(x + r, y + r - cut);
  ctx.lineTo(x + r, y + r * 0.25);
  if (!port) ctx.closePath();
}
