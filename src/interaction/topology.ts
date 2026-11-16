import { inLocation, type Note, type Snapshot } from "../types";
import {
  type GraphScope,
  type FocusView,
  type SemanticRole,
} from "./exploration";
import { network, NetworkMotion, placements } from "./network";
export type SceneNode = Note & {
  role?: SemanticRole;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number;
  fy?: number;
};
export type SceneLink = {
  source: string | SceneNode;
  target: string | SceneNode;
};
export const idOf = (value: unknown) =>
  typeof value === "object" && value !== null && "id" in value
    ? String(value.id)
    : String(value);
export const nodeRadius = (n: Note) =>
  n.neighbors < 2 ? 3.7 : Math.min(10, 5.5 + Math.sqrt(n.neighbors) * 0.85);
export const nodeScreenRadius = (n: SceneNode, zoom: number) =>
  (n.role === "subnetwork" ? 13 : nodeRadius(n)) *
  Math.max(0.8, Math.min(1.15, 0.94 + Math.log2(Math.max(0.1, zoom)) * 0.08));
function hash(text: string) {
  let n = 0;
  for (const c of text) n = (Math.imul(n, 31) + c.charCodeAt(0)) | 0;
  return n >>> 0;
}
// Frame every small subject, trimming only unusually distant points inside a
// large cluster. Fit all bypasses this, so deliberate pins/orphans stay reachable.
export function compositionNodes(nodes: SceneNode[]) {
  const groups = new Map<string, SceneNode[]>();
  for (const n of nodes) {
    if (!groups.has(n.subject_id)) groups.set(n.subject_id, []);
    groups.get(n.subject_id)!.push(n);
  }
  return [...groups.values()].flatMap((group) => {
    if (group.length <= 12) return group;
    const xs = group.map((n) => n.x ?? 0).sort((a, b) => a - b),
      ys = group.map((n) => n.y ?? 0).sort((a, b) => a - b),
      trim = Math.floor(group.length * 0.05);
    return group.filter(
      (n) =>
        (n.x ?? 0) >= xs[trim] &&
        (n.x ?? 0) <= xs[xs.length - 1 - trim] &&
        (n.y ?? 0) >= ys[trim] &&
        (n.y ?? 0) <= ys[ys.length - 1 - trim],
    );
  });
}
export class GraphTopology {
  reveal = new NetworkMotion();
  nested = false;
  private entry = -1;
  positions = new Map<string, SceneNode>();
  anchors = new Map<string, { x: number; y: number }>();
  key = "";
  layoutChanged = true;
  private laidOutKey = "";
  data: { nodes: SceneNode[]; links: SceneLink[] } = { nodes: [], links: [] };
  update(
    snapshot: Snapshot,
    scope?: GraphScope,
    revision = 0,
    restore?: FocusView,
  ) {
    if (scope) return this.updateNetwork(snapshot, scope, revision, restore);
    const layoutKey = JSON.stringify([
      snapshot.notes.map((n) => [n.id, n.subject_id]),
      snapshot.edges,
    ]);
    let introduced = false;
    const occupied = new Set(snapshot.notes.map((n) => n.subject_id));
    for (const subject of snapshot.organization.subjects
      .filter((s) => occupied.has(s.id))
      .sort((a, b) => a.id.localeCompare(b.id)))
      if (!this.anchors.has(subject.id)) {
        const i = this.anchors.size,
          angle = i * 2.3999632297,
          spread = Math.sqrt(i) * 150;
        this.anchors.set(subject.id, {
          x: Math.cos(angle) * spread * 1.12,
          y: Math.sin(angle) * spread * 0.9,
        });
      }
    const existing = new Set(snapshot.notes.map((n) => n.id));
    for (const id of this.positions.keys())
      if (!existing.has(id)) this.positions.delete(id);
    const nodes = snapshot.notes
      .filter((n) => inLocation(n, snapshot.organization.location))
      .map((n) => {
        const old = this.positions.get(n.id);
        if (old) {
          Object.assign(old, n);
          return old;
        }
        const anchor = this.anchors.get(n.subject_id) ?? { x: 0, y: 0 },
          h = hash(n.id),
          angle = h * 0.001;
        introduced = true;
        const node = {
          ...n,
          x: anchor.x + Math.cos(angle) * (35 + (h % 95)),
          y: anchor.y + Math.sin(angle) * (35 + (h % 95)),
        };
        this.positions.set(n.id, node);
        return node;
      });
    const visible = new Set(nodes.map((n) => n.id)),
      links = snapshot.edges.filter(
        (e) => visible.has(e.source) && visible.has(e.target),
      );
    const key = JSON.stringify([nodes.map((n) => [n.id, n.subject_id]), links]);
    if (this.key !== key) {
      this.key = key;
      this.layoutChanged = introduced || layoutKey !== this.laidOutKey;
      if (this.layoutChanged) this.laidOutKey = layoutKey;
      this.data = { nodes, links: links.map((e) => ({ ...e })) };
    }
    return this.data;
  }
  get visibleNodes() {
    return this.nested
      ? this.data.nodes.filter((n) => this.reveal.visible.has(n.id))
      : this.data.nodes;
  }
  private updateNetwork(
    snapshot: Snapshot,
    scope: GraphScope,
    revision: number,
    restore?: FocusView,
  ) {
    this.nested = true;
    const wanted = network(snapshot, scope);
    const key = JSON.stringify([
      wanted.nodes.map((n) => [n.id, n.subject_id]),
      wanted.links,
    ]);
    const changed = key !== this.key || revision !== this.entry;
    const origin =
      scope.kind === "topic"
        ? (this.positions.get(scope.note) ?? { x: 0, y: 0 })
        : { x: 0, y: 0 };
    const anchor = { x: origin.x ?? 0, y: origin.y ?? 0 };
    const nodes = wanted.nodes.map((n) => {
      const old = this.positions.get(n.id);
      if (old) {
        Object.assign(old, n);
        return old;
      }
      const node = { ...n, x: anchor.x, y: anchor.y };
      this.positions.set(n.id, node);
      return node;
    });
    if (changed) {
      const ids = new Set(nodes.map((n) => n.id));
      const outgoing = this.data.nodes.filter(
        (n) => !ids.has(n.id) && this.reveal.alpha(n.id) > 0.01,
      );
      const targets = placements(nodes, scope, anchor);
      for (const n of nodes) {
        const saved = restore?.positions[n.id];
        if (saved) targets.set(n.id, saved);
      }
      const edgeKey = (e: SceneLink) =>
        JSON.stringify([idOf(e.source), idOf(e.target)].sort());
      const desiredEdges = new Set(wanted.links.map(edgeKey));
      const present = new Set([...nodes, ...outgoing].map((n) => n.id));
      const links = [
        ...wanted.links,
        ...this.data.links.filter(
          (e) =>
            !desiredEdges.has(edgeKey(e)) &&
            present.has(idOf(e.source)) &&
            present.has(idOf(e.target)),
        ),
      ];
      this.data = { nodes: [...nodes, ...outgoing], links };
      this.reveal.retarget(
        this.data.nodes,
        targets,
        performance.now(),
        anchor,
        false,
      );
      this.reveal.retargetEdges(links.map(edgeKey), desiredEdges);
      this.key = key;
      this.entry = revision;
      this.layoutChanged = false;
    }
    const valid = new Set([
      ...snapshot.notes.map((n) => n.id),
      ...snapshot.organization.subjects.map((s) => `\u0000subject:${s.id}`),
    ]);
    for (const id of this.positions.keys())
      if (!valid.has(id)) this.positions.delete(id);
    return this.data;
  }
}
