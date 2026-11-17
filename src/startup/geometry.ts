export const SWARM = {
  agents: 9,
  targets: 20,
  hardCap: 24,
  prepare: 250,
  end: 3500,
  deadline: 3800,
  returnEnd: 280,
  returnDeadline: 400,
  away: 500,
  stable: 50,
  cooldown: 1500,
} as const;
export interface Point {
  x: number;
  y: number;
}
export interface Rect extends Point {
  width: number;
  height: number;
}
export interface Target {
  element: HTMLElement;
  kind: "surface" | "text" | "box" | "duplicate";
  rect: Rect;
  group: "layout" | "typography" | "navigation" | "controls";
  text: string[];
  widths: number[];
  baseline: number;
  font: string;
  lineHeight: string;
  letterSpacing: string;
  color: string;
  background: string;
  border: string;
  radius: string;
}
export const clamp = (n: number) => Math.max(0, Math.min(1, n));
export const smooth = (n: number) => {
  const t = clamp(n);
  return t * t * (3 - 2 * t);
};
export function curve(a: Point, b: Point, t: number, bend = 18): Point {
  const p = smooth(t),
    dx = b.x - a.x,
    dy = b.y - a.y;
  const arc = Math.sin(Math.PI * p) * bend,
    length = Math.hypot(dx, dy) || 1;
  return {
    x: a.x + dx * p - (dy / length) * arc,
    y: a.y + dy * p + (dx / length) * arc,
  };
}
export function graphemes(text: string) {
  if (!("Segmenter" in Intl)) return [];
  return Array.from(
    new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text),
    (s) => s.segment,
  );
}
export function snapshot(root: HTMLElement): Target[] {
  const width = innerWidth,
    height = innerHeight,
    active = document.activeElement;
  const excluded =
    "[hidden], [inert], [aria-hidden='true'], [data-swarm-sensitive], textarea, [contenteditable='true'], .cm-editor";
  const candidates = Array.from(
    root.querySelectorAll<HTMLElement>(
      "[data-swarm]:not([data-swarm='graph']), [data-swarm-surface]",
    ),
  )
    .slice(0, 64)
    .map((element) => ({
      element,
      bounds: element.getBoundingClientRect(),
      css: getComputedStyle(element),
    }));
  const context = document.createElement("canvas").getContext("2d")!;
  const targets: Target[] = [];
  for (const { element, bounds, css } of candidates) {
    if (targets.length >= SWARM.targets) break;
    const surface = element.hasAttribute("data-swarm-surface");
    if (
      element.closest(excluded) ||
      (!surface &&
        element.querySelector(
          "input[type=password], textarea, [contenteditable='true'], .cm-editor",
        )) ||
      (!surface &&
        active &&
        active !== document.body &&
        element.contains(active)) ||
      css.display === "none" ||
      css.visibility === "hidden" ||
      bounds.width < 8 ||
      bounds.height < 8 ||
      bounds.left < 0 ||
      bounds.top < 0 ||
      bounds.right > width + 1 ||
      bounds.bottom > height + 1 ||
      targets.some(
        (t) =>
          t.kind !== "surface" &&
          (t.element.contains(element) || element.contains(t.element)),
      )
    )
      continue;
    const scroll = element.closest(".hierarchy");
    if (scroll) {
      const r = scroll.getBoundingClientRect();
      if (bounds.top < r.top || bounds.bottom > r.bottom) continue;
    }
    let text =
      element.dataset.swarm === "text"
        ? graphemes(element.textContent?.trim() ?? "")
        : [];
    if (text.length > 48 || element.querySelector("input,button,textarea"))
      text = [];
    const kind = surface
      ? "surface"
      : text.length
        ? "text"
        : element.dataset.swarm === "duplicate"
          ? "duplicate"
          : "box";
    const rect = {
      x: bounds.left,
      y: bounds.top,
      width: bounds.width,
      height: bounds.height,
    };
    context.font = css.font;
    const spacing = parseFloat(css.letterSpacing) || 0;
    const widths = text.map(
      (_, i) =>
        context.measureText(text.slice(0, i + 1).join("")).width + i * spacing,
    );
    const metrics = context.measureText("Mg"),
      line = parseFloat(css.lineHeight) || parseFloat(css.fontSize) * 1.2;
    const ascent =
      metrics.fontBoundingBoxAscent || parseFloat(css.fontSize) * 0.8;
    const descent =
      metrics.fontBoundingBoxDescent || parseFloat(css.fontSize) * 0.2;
    targets.push({
      element,
      kind,
      rect,
      text,
      widths,
      baseline:
        rect.y +
        (parseFloat(css.paddingTop) || 0) +
        (line - ascent - descent) / 2 +
        ascent,
      group: surface
        ? "layout"
        : kind === "text"
          ? "typography"
          : element.closest(".sidebar")
            ? "navigation"
            : "controls",
      font: css.font,
      lineHeight: css.lineHeight,
      letterSpacing: css.letterSpacing,
      color: css.color,
      background: css.backgroundColor,
      border: css.borderColor,
      radius: css.borderRadius,
    });
  }
  return targets;
}
