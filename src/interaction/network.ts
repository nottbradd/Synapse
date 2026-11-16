import type { Snapshot } from "../types";
import {
  scopedNotes,
  subjectNodeId,
  type GraphScope,
  type NodePlacement,
} from "./exploration";
import { stepSpring, type Spring } from "./motion";
import type { SceneLink, SceneNode } from "./topology";

export function network(snapshot: Snapshot, scope: GraphScope) {
  if (scope.kind !== "overview") {
    const nodes = scopedNotes(snapshot, scope);
    const ids = new Set(nodes.map((n) => n.id));
    return {
      nodes: nodes.map((n): SceneNode => ({
        ...n,
        role:
          scope.kind === "topic" && n.id !== scope.note ? "concept" : "topic",
      })),
      links: snapshot.edges
        .filter((e) => ids.has(e.source) && ids.has(e.target))
        .map((e) => ({ ...e })),
    };
  }
  const subjects = snapshot.organization.subjects.filter(
    (s) => !scope.neuron || s.neuron_id === scope.neuron,
  );
  const ids = new Set(subjects.map((s) => s.id));
  const membership = new Map(snapshot.notes.map((n) => [n.id, n.subject_id]));
  const links = new Map<string, SceneLink>();
  for (const edge of snapshot.edges) {
    const a = membership.get(edge.source),
      b = membership.get(edge.target);
    if (!a || !b || a === b || !ids.has(a) || !ids.has(b)) continue;
    const [source, target] = [subjectNodeId(a), subjectNodeId(b)].sort();
    links.set(JSON.stringify([source, target]), { source, target });
  }
  return {
    nodes: subjects.map((s): SceneNode => ({
      id: subjectNodeId(s.id),
      subject_id: s.id,
      neuron_id: s.neuron_id,
      subject: s.preset,
      title:
        s.name +
        (subjects.filter((o) => o.name === s.name).length > 1
          ? ` · ${snapshot.organization.neurons.find((n) => n.id === s.neuron_id)?.name ?? "Neuron"}`
          : ""),
      neighbors: snapshot.notes.filter((n) => n.subject_id === s.id).length,
      revision: "",
      role: "subnetwork",
    })),
    links: [...links.values()],
  };
}

export function placements(
  nodes: SceneNode[],
  scope: GraphScope,
  anchor = { x: 0, y: 0 },
) {
  const result = new Map<string, NodePlacement>();
  const ordered = nodes
    .filter((n) => scope.kind !== "topic" || n.id !== scope.note)
    .sort((a, b) => a.id.localeCompare(b.id));
  if (scope.kind === "topic") result.set(scope.note, anchor);
  for (const [i, node] of ordered.entries()) {
    // Stable concentric rings leave space for labels without inventing hierarchy.
    const ring = Math.floor(i / 8),
      slot = i % 8;
    const count = Math.min(8, ordered.length - ring * 8);
    const angle = (slot / count) * Math.PI * 2 - Math.PI / 2 + ring * 0.28;
    const radius =
      scope.kind === "overview" ? 130 + ring * 170 : 115 + ring * 115;
    result.set(node.id, {
      x:
        anchor.x +
        Math.cos(angle) * radius * (scope.kind === "overview" ? 1.5 : 1.2),
      y: anchor.y + Math.sin(angle) * radius,
    });
  }
  return result;
}

type Reveal = { x: Spring; y: Spring; alpha: Spring };
const spring = (value: number): Spring => ({
  value,
  velocity: 0,
  target: value,
});
export class NetworkMotion {
  private edges = new Map<string, Spring>();
  private states = new Map<string, Reveal>();
  private time = 0;
  targets = new Map<string, NodePlacement>();
  visible = new Set<string>();
  get active() {
    return (
      [...this.edges.values()].some(
        (s) => s.value !== s.target || s.velocity !== 0,
      ) ||
      [...this.states.values()].some((s) =>
        [s.x, s.y, s.alpha].some(
          (v) => v.value !== v.target || v.velocity !== 0,
        ),
      )
    );
  }
  edgeProgress(source: string, target: string) {
    return this.edges.get(JSON.stringify([source, target].sort()))?.value ?? 1;
  }
  retargetEdges(all: string[], desired: Set<string>) {
    const keep = new Set(all);
    for (const key of this.edges.keys())
      if (!keep.has(key)) this.edges.delete(key);
    for (const key of all) {
      const state = this.edges.get(key) ?? spring(0);
      state.target = desired.has(key) ? 1 : 0;
      this.edges.set(key, state);
    }
  }
  retarget(
    nodes: SceneNode[],
    targets: Map<string, NodePlacement>,
    time: number,
    origin: NodePlacement,
    reduced: boolean,
  ) {
    this.advance(nodes, time, reduced);
    this.targets = targets;
    this.visible = new Set(targets.keys());
    for (const n of nodes) {
      const p = targets.get(n.id);
      let state = this.states.get(n.id);
      if (!state) {
        state = {
          x: spring(n.x ?? origin.x),
          y: spring(n.y ?? origin.y),
          alpha: spring(0),
        };
        this.states.set(n.id, state);
      }
      state.x.target = p?.x ?? state.x.value;
      state.y.target = p?.y ?? state.y.value;
      state.alpha.target = p ? 1 : 0;
    }
    const keep = new Set(nodes.map((n) => n.id));
    for (const id of this.states.keys())
      if (!keep.has(id)) this.states.delete(id);
    this.advance(nodes, time, reduced);
  }
  pin(node: SceneNode) {
    const state = this.states.get(node.id);
    if (!state) return;
    state.x = spring(node.x ?? 0);
    state.y = spring(node.y ?? 0);
    this.targets.set(node.id, {
      x: node.x ?? 0,
      y: node.y ?? 0,
      fx: node.x,
      fy: node.y,
    });
  }
  alpha(id: string) {
    return this.states.get(id)?.alpha.value ?? 1;
  }
  advance(nodes: SceneNode[], time: number, reduced: boolean) {
    const dt = Math.max(0, (time - this.time) / 1000);
    this.time = time;
    for (const [key, s] of this.edges)
      this.edges.set(key, reduced ? spring(s.target) : stepSpring(s, dt));
    for (const n of nodes) {
      const s = this.states.get(n.id);
      if (!s) continue;
      for (const k of ["x", "y", "alpha"] as const)
        s[k] = reduced ? spring(s[k].target) : stepSpring(s[k], dt);
      n.x = n.fx = s.x.value;
      n.y = n.fy = s.y.value;
      n.vx = n.vy = 0;
    }
  }
}
