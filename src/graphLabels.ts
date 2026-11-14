export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface LabelNode {
  id: string;
  x: number;
  y: number;
  radius: number;
  title: string;
  priority: number;
}
export interface PlacedLabel extends Rect {
  id: string;
  text: string;
  priority: number;
}
export function overlaps(a: Rect, b: Rect, padding = 0) {
  return (
    a.x < b.x + b.width + padding &&
    a.x + a.width + padding > b.x &&
    a.y < b.y + b.height + padding &&
    a.y + a.height + padding > b.y
  );
}
export function placeLabels(
  nodes: LabelNode[],
  viewport: Rect,
  measure: (text: string) => number,
  height = 17,
): PlacedLabel[] {
  const labels: PlacedLabel[] = [];
  const obstacles = nodes.map((n) => ({
    x: n.x - n.radius - 5,
    y: n.y - n.radius - 5,
    width: n.radius * 2 + 10,
    height: n.radius * 2 + 10,
  }));
  for (const node of [...nodes]
    .filter((n) => n.priority > 0)
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))) {
    let text = node.title;
    const limit = Math.min(
      node.priority >= 500 ? 260 : 190,
      viewport.width - 20,
    );
    if (limit < 45) continue;
    if (measure(text) > limit) {
      const chars = Array.from(text);
      let low = 0,
        high = chars.length;
      while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        if (measure(chars.slice(0, mid).join("") + "…") <= limit) low = mid;
        else high = mid - 1;
      }
      text = chars.slice(0, low).join("") + "…";
    }
    const width = measure(text) + 8,
      gap = node.radius + 9,
      x = node.x,
      y = node.y;
    const candidates = [
      [x - width / 2, y + gap],
      [x + gap, y - height / 2],
      [x - width / 2, y - gap - height],
      [x - gap - width, y - height / 2],
      [x + gap, y + gap],
      [x - gap - width, y + gap],
      [x + gap, y - gap - height],
      [x - gap - width, y - gap - height],
    ];
    for (const [cx, cy] of candidates) {
      const rect = { x: cx, y: cy, width, height };
      if (
        cx < viewport.x ||
        cy < viewport.y ||
        cx + width > viewport.x + viewport.width ||
        cy + height > viewport.y + viewport.height
      )
        continue;
      if (
        obstacles.some((o) => overlaps(rect, o)) ||
        labels.some((l) => overlaps(rect, l, 5))
      )
        continue;
      labels.push({ ...rect, id: node.id, text, priority: node.priority });
      break;
    }
  }
  return labels;
}
