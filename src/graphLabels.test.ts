import { describe, it, expect } from "vitest";
import { overlaps, placeLabels, type LabelNode } from "./graphLabels";
describe("Screen-space graph labels", () => {
  const measure = (s: string) => Array.from(s).length * 7;
  it("prioritizes selection, truncates long titles and avoids nodes, labels and viewport edges", () => {
    const nodes: LabelNode[] = Array.from({ length: 100 }, (_, i) => ({
      id: String(i),
      x: 70 + (i % 10) * 40,
      y: 90 + Math.floor(i / 10) * 35,
      radius: 6,
      title: i === 0 ? "A very long title ".repeat(20) : `Note ${i}`,
      priority: i === 0 ? 1000 : 100,
    }));
    const bounds = { x: 24, y: 40, width: 520, height: 450 };
    const labels = placeLabels(nodes, bounds, measure);
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.length).toBeLessThan(nodes.length);
    expect(labels[0].id).toBe("0");
    expect(labels[0].text.endsWith("…")).toBe(true);
    for (const l of labels) {
      expect(l.x).toBeGreaterThanOrEqual(bounds.x);
      expect(l.x + l.width).toBeLessThanOrEqual(bounds.x + bounds.width);
      expect(l.y + l.height).toBeLessThanOrEqual(bounds.y + bounds.height);
      for (const n of nodes)
        expect(
          overlaps(l, {
            x: n.x - n.radius - 5,
            y: n.y - n.radius - 5,
            width: n.radius * 2 + 10,
            height: n.radius * 2 + 10,
          }),
        ).toBe(false);
      for (const other of labels)
        if (l !== other) expect(overlaps(l, other, 5)).toBe(false);
    }
  });
  it("culls labels at distant zoom without scaling text down", () =>
    expect(
      placeLabels(
        [{ id: "a", x: 50, y: 50, radius: 4, title: "Label", priority: 0 }],
        { x: 0, y: 0, width: 200, height: 200 },
        measure,
      ),
    ).toEqual([]));
});
