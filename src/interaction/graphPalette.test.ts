import { expect, it, vi } from "vitest";
import { GraphScene } from "./graphScene";
import { graphInk, linkOpacity } from "./graphPalette";
import type { SceneLink, SceneNode } from "./topology";

it("colours only incident edges, even when two neighbours link to each other", () => {
  const scene = new GraphScene();
  const nodes = ["a", "b", "c"].map((id, index): SceneNode => ({
    id,
    title: id,
    subject: "general",
    subject_id: id,
    neuron_id: "n",
    revision: "1",
    neighbors: 2,
    x: 20 * index,
    y: 10 * index,
  }));
  const [a, b, c] = nodes;
  // ForceGraph may replace either endpoint ID with its node object.
  const links: SceneLink[] = [
    { source: a, target: b.id },
    { source: a.id, target: c },
    { source: b, target: c },
  ];
  scene.topology.data = { nodes, links };
  scene.topology.positions = new Map(nodes.map((n) => [n.id, n]));
  const ctx = {
    save() {},
    restore() {},
    beginPath() {},
    moveTo() {},
    bezierCurveTo() {},
    stroke() {},
    strokeStyle: "",
    globalAlpha: 1,
  };
  const paint = () =>
    links.map((link) => {
      scene.drawEdge(link, ctx as unknown as CanvasRenderingContext2D, 1);
      return ctx.strokeStyle;
    });
  scene.wake = vi.fn();
  scene.selected = a.id;
  scene.updateRelated();
  expect(scene.related).toEqual(new Set(["a", "b", "c"]));
  expect(paint()).toEqual([graphInk.focus, graphInk.focus, graphInk.link]);
  scene.setHover(b.id);
  expect(paint()).toEqual([graphInk.focus, graphInk.link, graphInk.focus]);
  scene.setHover();
  expect(paint()).toEqual([graphInk.focus, graphInk.focus, graphInk.link]);
});

it("keeps ordinary links visible at overview density and strengthens them on zoom", () => {
  const dense = linkOpacity(10_688, 1, false);
  expect(dense).toBeLessThan(linkOpacity(6, 1, false));
  expect(dense).toBeLessThan(linkOpacity(10_688, 2.55, false));
  expect(linkOpacity(10_688, 0.35, true)).toBeGreaterThan(0.12);
});
