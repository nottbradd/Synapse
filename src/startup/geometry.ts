const constructionEnd = 4060;
const end = constructionEnd + 400;
export const SWARM = {
  agents: 14,
  targets: 20,
  hardCap: 24,
  prepare: 250,
  orbit: 900,
  constructionEnd,
  end,
  departure: 160,
  pulse: 300,
  deadline: end + 440,
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
export interface Lettering {
  text: string[];
  widths: number[];
  x: number;
  y: number;
  font: string;
  size: number;
  spacing: string;
  color: string;
  alpha: number;
  baseline: "middle" | "alphabetic";
}
export interface Caption {
  element: HTMLElement;
  source: string;
  run: Lettering;
}
export interface Target {
  element: HTMLElement;
  kind: "surface" | "text" | "box" | "duplicate";
  rect: Rect;
  captions: Caption[];
  background: string;
  radius: number;
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
const segmenter =
  "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : undefined;
export function graphemes(text: string) {
  return segmenter ? Array.from(segmenter.segment(text), (s) => s.segment) : [];
}
// Prefix measurements include kerning. Both the drawn text and the writing
// agent use the same advances, including combining characters and spaces.
export function measureLetters(
  ctx: CanvasRenderingContext2D,
  text: string[],
  font: string,
  spacing = "0px",
) {
  ctx.font = font;
  ctx.letterSpacing = spacing;
  let prefix = "";
  return text.map((g) => ctx.measureText((prefix += g)).width);
}
export function captionSource(element: HTMLElement) {
  if (element instanceof HTMLInputElement)
    return element.matches("input[data-swarm-label]:placeholder-shown")
      ? element.placeholder
      : "";
  return element.textContent?.trim() ?? "";
}

function captionBounds(element: HTMLElement, source: string) {
  const box = element.getBoundingClientRect();
  if (element instanceof HTMLInputElement) {
    const style = getComputedStyle(element);
    const left =
      box.left +
      parseFloat(style.borderLeftWidth) +
      parseFloat(style.paddingLeft);
    return {
      left,
      top: box.top,
      height: box.height,
      css: getComputedStyle(element, "::placeholder"),
    };
  }
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const raw = node.textContent ?? "";
    if (raw.trim() !== source) continue;
    const css = getComputedStyle(node.parentElement!);
    if (css.visibility === "hidden" || css.display === "none") continue;
    const range = document.createRange(),
      start = raw.indexOf(source);
    range.setStart(node, start);
    range.setEnd(node, start + source.length);
    if (range.getClientRects().length !== 1) return;
    const bounds = range.getBoundingClientRect();
    if (
      bounds.width < 1 ||
      bounds.height < 1 ||
      bounds.right > box.right + 1 ||
      bounds.left < box.left - 1
    )
      return;
    return { left: bounds.left, top: bounds.top, height: bounds.height, css };
  }
}
function readCaption(
  element: HTMLElement,
  context: CanvasRenderingContext2D,
): Caption | undefined {
  const source = captionSource(element);
  if (
    !source ||
    source.length > 160 ||
    element.querySelector("input,textarea,[contenteditable=true]")
  )
    return;
  const bounds = captionBounds(element, source);
  if (!bounds) return;
  const text = graphemes(source),
    { css } = bounds;
  if (!text.length || text.length > 64) return;
  const font =
    css.fontStyle +
    " " +
    css.fontWeight +
    " " +
    css.fontSize +
    " " +
    css.fontFamily;
  const spacing = css.letterSpacing === "normal" ? "0px" : css.letterSpacing;
  const widths = measureLetters(context, text, font, spacing),
    metrics = context.measureText("Mg");
  const y =
    bounds.top +
    (bounds.height +
      metrics.fontBoundingBoxAscent -
      metrics.fontBoundingBoxDescent) /
      2;
  return {
    element,
    source,
    run: {
      text,
      widths,
      x: bounds.left,
      y,
      font,
      size: parseFloat(css.fontSize),
      spacing,
      color: css.color,
      alpha: 1,
      baseline: "alphabetic",
    },
  };
}

export function snapshot(root: HTMLElement): Target[] {
  const width = innerWidth,
    height = innerHeight,
    active = document.activeElement;
  const excluded =
    "[hidden], [inert], [aria-hidden='true'], [data-swarm-sensitive], textarea, [contenteditable='true'], .cm-editor";
  // Reserve room for the graph chrome even when the sidebar contains a long tree.
  const chrome = root.querySelectorAll<HTMLElement>(
    ".graph-heading [data-swarm],.graph-controls[data-swarm]",
  );
  const candidates = new Set([
    ...chrome,
    ...Array.from(
      root.querySelectorAll<HTMLElement>(
        "[data-swarm]:not([data-swarm='graph']), [data-swarm-surface]",
      ),
    ).slice(0, 64),
  ]);
  const context = document.createElement("canvas").getContext("2d")!;
  const targets: Target[] = [];
  for (const element of candidates) {
    if (targets.length >= SWARM.targets) break;
    const surface = element.hasAttribute("data-swarm-surface");
    if (
      element.closest(excluded) ||
      (!surface &&
        (element.querySelector(
          "input[type=password], textarea, [contenteditable='true'], .cm-editor",
        ) ||
          (active && active !== document.body && element.contains(active))))
    )
      continue;
    const bounds = element.getBoundingClientRect(),
      css = getComputedStyle(element);
    if (
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
    const scroll = element.closest(".hierarchy")?.getBoundingClientRect();
    if (scroll && (bounds.top < scroll.top || bounds.bottom > scroll.bottom))
      continue;
    const isText = element.dataset.swarm === "text";
    const labels = surface
      ? []
      : isText
        ? [element]
        : Array.from(
            element.querySelectorAll<HTMLElement>("[data-swarm-label]"),
          ).slice(0, 3);
    const captions = labels
      .filter((el) => !el.closest(excluded))
      .map((el) => readCaption(el, context))
      .filter((c): c is Caption => !!c);
    const kind = surface
      ? "surface"
      : isText && captions.length
        ? "text"
        : element.dataset.swarm === "duplicate"
          ? "duplicate"
          : "box";
    targets.push({
      element,
      kind,
      rect: {
        x: bounds.left,
        y: bounds.top,
        width: bounds.width,
        height: bounds.height,
      },
      captions,
      background: css.backgroundColor,
      radius: parseFloat(css.borderRadius) || 0,
    });
  }
  return targets;
}
