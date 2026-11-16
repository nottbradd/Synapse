export const SWARM = {
  agents: 6,
  targets: 12,
  hardCap: 15,
  prepare: 230,
  gather: 120,
  buildEnd: 950,
  end: 1050,
  deadline: 1200,
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
  kind: "text" | "box";
  rect: Rect;
  text: string[];
  font: string;
  lineHeight: string;
  letterSpacing: string;
  color: string;
}
export const clamp = (n: number) => Math.max(0, Math.min(1, n));
export const smooth = (n: number) => {
  const t = clamp(n);
  return t * t * (3 - 2 * t);
};
export function curve(a: Point, b: Point, t: number, bend = 18): Point {
  const p = smooth(t),
    arc = Math.sin(Math.PI * p) * bend;
  return { x: a.x + (b.x - a.x) * p + arc, y: a.y + (b.y - a.y) * p - arc };
}
export function graphemes(text: string) {
  // WebView2 supports Segmenter. If unavailable, skip typing instead of
  // splitting a combining sequence or emoji into broken fragments.
  if (!("Segmenter" in Intl)) return [];
  const Segmenter = Intl.Segmenter;
  return Array.from(
    new Segmenter(undefined, { granularity: "grapheme" }).segment(text),
    (s) => s.segment,
  );
}
export function snapshot(root: HTMLElement): Target[] {
  const width = window.innerWidth,
    height = window.innerHeight;
  const excluded =
    "[hidden], [inert], [aria-hidden='true'], [data-swarm-sensitive], textarea, [contenteditable='true'], .cm-editor";
  const active = document.activeElement;
  // One bounded read phase. No geometry reads occur in the animation loop.
  const candidates = Array.from(
    root.querySelectorAll<HTMLElement>("[data-swarm]"),
  )
    .slice(0, 40)
    .map((element) => {
      const bounds = element.getBoundingClientRect(),
        css = getComputedStyle(element);
      return { element, bounds, css };
    });
  const sidebar = root.querySelector(".sidebar")?.getBoundingClientRect();
  const heading = root.querySelector(".graph-heading")?.getBoundingClientRect();
  const controls = root
    .querySelector(".graph-controls")
    ?.getBoundingClientRect();
  const targets: Target[] = [];
  for (const { element, bounds, css } of candidates) {
    if (targets.length >= Math.min(SWARM.targets, SWARM.hardCap)) break;
    if (
      element.closest(excluded) ||
      element.querySelector(
        "input[type=password], [data-swarm-sensitive], textarea, [contenteditable='true'], .cm-editor",
      ) ||
      (active && active !== document.body && element.contains(active)) ||
      !element.checkVisibility({
        checkOpacity: true,
        checkVisibilityCSS: true,
      }) ||
      css.opacity === "0" ||
      bounds.width < 8 ||
      bounds.height < 8 ||
      bounds.left < 0 ||
      bounds.top < 0 ||
      bounds.right > width + 1 ||
      bounds.bottom > height + 1 ||
      targets.some(
        (t) => t.element.contains(element) || element.contains(t.element),
      )
    )
      continue;
    let rect: Rect = {
      x: bounds.left,
      y: bounds.top,
      width: bounds.width,
      height: bounds.height,
    };
    if (element.dataset.swarm === "graph") {
      const left = Math.max(bounds.left, (sidebar?.right ?? 0) + 24),
        top = Math.max(bounds.top, (heading?.bottom ?? 0) + 24);
      rect = {
        x: left,
        y: top,
        width: bounds.right - left - 24,
        height: (controls?.top ?? bounds.bottom) - top - 24,
      };
      if (rect.width < 80 || rect.height < 80) continue;
    }
    const text =
      element.dataset.swarm === "text"
        ? graphemes(element.textContent?.trim() ?? "")
        : [];
    const type =
      text.length > 0 &&
      text.length <= 42 &&
      !element.querySelector("input,button,textarea")
        ? "text"
        : "box";
    targets.push({
      element,
      rect,
      kind: type,
      text: type === "text" ? text : [],
      font: css.font,
      lineHeight: css.lineHeight,
      letterSpacing: css.letterSpacing,
      color: css.color,
    });
  }
  return targets;
}
