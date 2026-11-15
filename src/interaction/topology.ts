import { inLocation, type Note, type Snapshot } from "../types";
export type SceneNode = Note & {
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
  Math.min(6, 3.1 + Math.sqrt(n.neighbors) * 0.38);
function hash(text: string) {
  let n = 0;
  for (const c of text) n = (Math.imul(n, 31) + c.charCodeAt(0)) | 0;
  return n >>> 0;
}
export class GraphTopology {
  positions = new Map<string, SceneNode>();
  anchors = new Map<string, { x: number; y: number }>();
  key = "";
  data: { nodes: SceneNode[]; links: SceneLink[] } = { nodes: [], links: [] };
  update(snapshot: Snapshot) {
    for (const subject of [...snapshot.organization.subjects].sort((a, b) =>
      a.id.localeCompare(b.id),
    ))
      if (!this.anchors.has(subject.id)) {
        const i = this.anchors.size,
          angle = i * 2.3999632297,
          spread = Math.sqrt(i) * 360;
        this.anchors.set(subject.id, {
          x: Math.cos(angle) * spread,
          y: Math.sin(angle) * spread,
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
      this.data = { nodes, links: links.map((e) => ({ ...e })) };
    }
    return this.data;
  }
}
