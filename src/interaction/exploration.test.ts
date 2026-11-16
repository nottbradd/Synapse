import { describe, expect, it } from "vitest";
import type { Snapshot } from "../types";
import {
  Exploration,
  scopedNotes,
  subjectNodeId,
  type FocusView,
} from "./exploration";
import { network, NetworkMotion, placements } from "./network";
import { GraphTopology, type SceneNode } from "./topology";
import { nodeVoice } from "./note";
import { LayoutMotion, project, usable } from "./motion";

const snapshot = (): Snapshot => ({
  root: "synthetic",
  name: "Synthetic revision",
  notes: ["Momentum", "Impulse", "Velocity", "Unlinked"].map((title, i) => ({
    id: `${title}.md`,
    title,
    subject: "physics",
    subject_id: i === 2 ? "s2" : "s1",
    neuron_id: i === 2 ? "n2" : "n1",
    revision: "r",
    neighbors: i < 3 ? 2 : 0,
  })),
  edges: [
    { source: "Momentum.md", target: "Impulse.md" },
    { source: "Impulse.md", target: "Velocity.md" },
    { source: "Velocity.md", target: "Momentum.md" },
  ],
  organization: {
    schema_version: 1,
    fallback_subject: "s1",
    location: { neuron_id: null, subject_id: null },
    neurons: [
      { id: "n1", name: "Revision", path: "Revision" },
      { id: "n2", name: "Other", path: "Other" },
    ],
    subjects: ["s1", "s2"].map((id, i) => ({
      id,
      name: "Physics",
      neuron_id: `n${i + 1}`,
      color: "#32d4ad",
      preset: "physics",
      root: null,
      legacy: false,
    })),
  },
  links: [],
  cards: [],
  history: { schema_version: 1, cards: {} },
  warnings: [],
  review_error: null,
});
const frame = { x: 31, y: -19, zoom: 0.86, drawer: 0 };
describe("bounded knowledge views", () => {
  it("uses subject UUIDs, distinguishes duplicate names and aggregates only real cross-subject links", () => {
    const s = snapshot(),
      data = network(s, { kind: "overview", neuron: null });
    expect(data.nodes.map((n) => n.id)).toEqual([
      subjectNodeId("s1"),
      subjectNodeId("s2"),
    ]);
    expect(data.nodes.map((n) => n.title)).toEqual([
      "Physics · Revision",
      "Physics · Other",
    ]);
    expect(data.links).toHaveLength(1);
    s.edges = [];
    expect(network(s, { kind: "overview", neuron: null }).links).toEqual([]);
  });
  it("keeps membership unchanged while following cyclic links across subjects", () => {
    const s = snapshot(),
      before = structuredClone(s);
    expect(
      scopedNotes(s, { kind: "subnetwork", subject: "s1" }).map((n) => n.id),
    ).not.toContain("Velocity.md");
    for (const note of ["Momentum.md", "Impulse.md", "Velocity.md"])
      expect(network(s, { kind: "topic", note, level: 2 }).nodes).toHaveLength(
        3,
      );
    expect(
      network(s, { kind: "topic", note: "Unlinked.md", level: 1 }).links,
    ).toEqual([]);
    expect(s).toEqual(before);
  });
  it("captures exact camera, selected note, drawer and layout; ignores repeated selections and bounds cycles", () => {
    const nav = new Exploration();
    nav.sync(snapshot());
    const positions = { "Momentum.md": { x: 72, y: 11, fx: 72, fy: 11 } };
    nav.capture = (): FocusView => ({
      scope: nav.scope,
      frame: { ...frame },
      positions,
      selected: "Momentum.md",
    });
    nav.enter({ kind: "subnetwork", subject: "s1" });
    const first = nav.history[0];
    expect(nav.enterNote("Momentum.md")).toEqual({ role: "topic", level: 1 });
    nav.enterNote("Momentum.md");
    expect(nav.history).toHaveLength(2);
    nav.enterNote("Impulse.md");
    expect(nav.scope).toEqual({ kind: "topic", note: "Impulse.md", level: 2 });
    nav.back();
    nav.back();
    expect(nav.back()).toEqual(first);
    expect(nav.restore?.frame).toEqual(frame);
    expect(nav.restore?.positions).toEqual(positions);
    for (let i = 0; i < 150; i++)
      nav.enterNote(i % 2 ? "Impulse.md" : "Momentum.md");
    expect(nav.history).toHaveLength(64);
    expect(nav.scope).toHaveProperty("level", 2);
  });
  it("recovers from deletion, prunes stale history and follows changed links without stale nodes", () => {
    const s = snapshot(),
      nav = new Exploration();
    nav.sync(s);
    nav.capture = () => ({ scope: nav.scope, frame, positions: {} });
    nav.enter({ kind: "subnetwork", subject: "s1" });
    nav.enterNote("Momentum.md");
    s.notes = s.notes.filter((n) => n.id !== "Momentum.md");
    nav.sync(s);
    expect(nav.scope).toEqual({ kind: "subnetwork", subject: "s1" });
    s.edges = [];
    expect(
      network(s, { kind: "topic", note: "Impulse.md", level: 1 }).nodes,
    ).toHaveLength(1);
    s.organization.location = { neuron_id: "n2", subject_id: "s2" };
    nav.sync(s);
    expect(nav.history).toEqual([]);
    expect(nav.scope).toEqual({ kind: "subnetwork", subject: "s2" });
  });
  it("reuses canonical node objects and restores their exact layout across different scopes", () => {
    const s = snapshot(),
      topo = new GraphTopology(),
      scope = { kind: "subnetwork", subject: "s1" } as const;
    topo.update(s, scope, 0);
    topo.reveal.advance(topo.data.nodes, performance.now() + 3000, false);
    const node = topo.positions.get("Momentum.md")!;
    const positions = Object.fromEntries(
      topo.visibleNodes.map((n) => [n.id, { x: n.x!, y: n.y! }]),
    );
    topo.update(s, { kind: "topic", note: "Momentum.md", level: 1 }, 1);
    expect(topo.positions.get(node.id)).toBe(node);
    topo.update(s, scope, 2, { scope, frame, positions });
    topo.reveal.advance(topo.data.nodes, performance.now() + 6000, false);
    for (const n of topo.visibleNodes)
      expect({ x: n.x, y: n.y }).toEqual(positions[n.id]);
  });
});
describe("continuous spatial reveal", () => {
  it("extends and retracts changed relationships continuously without restarting on retarget", () => {
    const motion = new NetworkMotion();
    const key = JSON.stringify(["a", "b"]);
    motion.retargetEdges([key], new Set([key]));
    expect(motion.edgeProgress("a", "b")).toBe(0);
    motion.advance([], 80, false);
    const progress = motion.edgeProgress("a", "b");
    expect(progress).toBeGreaterThan(0);
    expect(progress).toBeLessThan(1);
    motion.retargetEdges([key], new Set());
    expect(motion.edgeProgress("a", "b")).toBe(progress);
    motion.advance([], 3000, false);
    expect(motion.edgeProgress("a", "b")).toBe(0);
    expect(motion.active).toBe(false);
    motion.retargetEdges([key], new Set([key]));
    motion.advance([], 3010, true);
    expect(motion.edgeProgress("a", "b")).toBe(1);
    expect(motion.active).toBe(false);
  });
  it("preserves current positions on rapid retarget, settles and snaps identically in Reduced", () => {
    const nodes: SceneNode[] = snapshot().notes.map((n) => ({
      ...n,
      x: 0,
      y: 0,
    }));
    const motion = new NetworkMotion(),
      first = new Map(nodes.map((n) => [n.id, { x: 200, y: 100 }]));
    motion.retarget(nodes, first, 0, { x: 0, y: 0 }, false);
    motion.advance(nodes, 70, false);
    const at = nodes.map((n) => n.x);
    const second = new Map(nodes.map((n) => [n.id, { x: -100, y: 20 }]));
    motion.retarget(nodes, second, 70, { x: 0, y: 0 }, false);
    expect(nodes.map((n) => n.x)).toEqual(at);
    motion.advance(nodes, 3000, false);
    expect(motion.active).toBe(false);
    expect(nodes.every((n) => n.x === -100 && n.y === 20)).toBe(true);
    motion.retarget(nodes, first, 3010, { x: 0, y: 0 }, true);
    expect(motion.active).toBe(false);
    expect(nodes.every((n) => n.x === 200)).toBe(true);
  });
  it("keeps dense positions distinct and the focal node inside a small uncovered canvas", () => {
    const nodes = Array.from({ length: 160 }, (_, i) => ({
      ...snapshot().notes[0],
      id: `n${i}`,
    }));
    const scope = { kind: "topic", note: "n0", level: 1 } as const;
    const targets = placements(nodes, scope);
    expect(
      new Set([...targets.values()].map((p) => `${p.x},${p.y}`)).size,
    ).toBe(160);
    const view = { width: 900, height: 600, left: 312 },
      m = new LayoutMotion(frame, 0);
    m.retarget({ x: 0, y: 0, zoom: 1, drawer: 352 }, 0);
    const f = m.advance(3000),
      point = project(targets.get("n0")!, f, view),
      bounds = usable(view, f.drawer);
    expect(point.x).toBeGreaterThan(bounds.x);
    expect(point.x).toBeLessThan(bounds.x + bounds.width);
  });
});
describe("original semantic sound family", () => {
  it("keeps stable pitches, bounded variation and quieter, shorter upper voices", () => {
    for (const role of ["subnetwork", "topic", "concept"] as const) {
      const base = nodeVoice({ node: "Momentum.md", role });
      for (let i = 0; i < 100; i++) {
        const v = nodeVoice({ node: "Momentum.md", role }, i);
        expect(v.frequency).toBe(base.frequency);
        expect(Math.abs(v.detune)).toBeLessThanOrEqual(1.5);
        expect(v.gain / base.gain).toBeGreaterThanOrEqual(0.96);
        expect(v.gain / base.gain).toBeLessThanOrEqual(1 / 0.96);
      }
    }
    const low = nodeVoice({ role: "subnetwork" }),
      mid = nodeVoice({ role: "topic" }),
      high = nodeVoice({ role: "concept" });
    expect(low.frequency).toBeLessThan(400);
    expect(mid.frequency).toBeGreaterThan(500);
    expect(high.frequency).toBeGreaterThan(1000);
    expect(low.gain).toBeGreaterThan(mid.gain);
    expect(mid.gain).toBeGreaterThan(high.gain);
    expect(low.duration).toBeGreaterThan(mid.duration);
    expect(mid.duration).toBeGreaterThan(high.duration);
    expect(nodeVoice({ level: 100 })).toEqual(nodeVoice({ level: 2 }));
  });
});
