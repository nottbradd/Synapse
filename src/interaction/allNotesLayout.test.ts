import { describe, expect, it } from "vitest";
import { layoutNetwork } from "./allNotesLayout";

describe("vault network layout", () => {
  it("finds separate communities in one subject and keeps tightly linked subjects together", () => {
    const links: number[] = [];
    for (const start of [0, 8, 16]) {
      for (let i = start; i < start + 8; i++)
        for (let j = i + 1; j < start + 8; j++) links.push(i, j);
    }
    links.push(7, 8, 15, 16);
    const subjects = new Uint32Array(25);
    const input = { subjects, edges: Uint32Array.from(links) };
    for (const multi of [false, true]) {
      if (multi) for (let i = 0; i < 24; i++) subjects[i] = i % 2;
      const layout = layoutNetwork(input);
      for (const start of [0, 8, 16])
        expect(new Set(layout.community.slice(start, start + 8)).size).toBe(1);
      expect(new Set(layout.community).size).toBe(4);
      expect(layoutNetwork(input)).toEqual(layout);
      const { left, right, top, bottom } = layout.bounds;
      for (let i = 0; i < 25; i++) {
        expect(layout.xy[2 * i]).toBeGreaterThanOrEqual(left);
        expect(layout.xy[2 * i]).toBeLessThanOrEqual(right);
        expect(layout.xy[2 * i + 1]).toBeGreaterThanOrEqual(top);
        expect(layout.xy[2 * i + 1]).toBeLessThanOrEqual(bottom);
      }
    }
  });
  it("handles empty vaults and positions every isolated note separately", () => {
    const result = (count: number) =>
      layoutNetwork({
        subjects: new Uint32Array(count),
        edges: new Uint32Array(),
      });
    expect(result(0).bounds).toEqual({ left: 0, top: 0, right: 0, bottom: 0 });
    const { xy, community } = result(120);
    const points = Array.from(
      community,
      (_, i) => xy[i * 2] + "," + xy[i * 2 + 1],
    );
    expect(new Set(points).size).toBe(120);
    expect(new Set(community).size).toBe(120);
  });
});
