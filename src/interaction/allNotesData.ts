import type { Snapshot } from "../types";

export function allNotesData(snapshot: Snapshot) {
  const notes = [...snapshot.notes].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  const index = new Map(notes.map((n, i) => [n.id, i]));
  const count = notes.length;
  const pairs = new Set<number>();
  for (const edge of snapshot.edges) {
    const a = index.get(edge.source),
      b = index.get(edge.target);
    if (a !== undefined && b !== undefined && a !== b)
      pairs.add(Math.min(a, b) * count + Math.max(a, b));
  }
  const neighbors: number[][] = notes.map(() => []);
  const edges = new Uint32Array(pairs.size * 2);
  let cursor = 0;
  for (const pair of [...pairs].sort((a, b) => a - b)) {
    const a = Math.floor(pair / count),
      b = pair % count;
    edges[cursor++] = a;
    edges[cursor++] = b;
    neighbors[a].push(b);
    neighbors[b].push(a);
  }
  const rank = notes
    .map((_, i) => i)
    .sort((a, b) => neighbors[b].length - neighbors[a].length || a - b);
  const degreeOrder = (a: number, b: number) =>
    neighbors[b].length - neighbors[a].length || a - b;
  for (const list of neighbors) list.sort(degreeOrder);
  const hubs = rank
    .filter((i) => neighbors[i].length >= (count < 40 ? 2 : 5))
    .slice(0, Math.max(4, Math.ceil(Math.sqrt(count) * 0.54)));
  const role = new Uint8Array(count);
  const secondary = Math.max(
    3,
    neighbors[rank[Math.min(count - 1, Math.floor(count * 0.055))]]?.length ??
      3,
  );
  for (const i of rank) if (neighbors[i].length >= secondary) role[i] = 1;
  for (const i of hubs) role[i] = 2;
  const records = new Map(snapshot.organization.subjects.map((s) => [s.id, s]));
  const subjectIds = [...new Set(notes.map((n) => n.subject_id))].sort();
  const groups = subjectIds.map((id) => ({
    id,
    name: records.get(id)?.name ?? "Unassigned",
    color: records.get(id)?.color ?? "#8796a8",
  }));
  const indices = new Map(subjectIds.map((id, i) => [id, i]));
  const subjects = Uint32Array.from(notes, (n) => indices.get(n.subject_id)!);
  // Exact structural identity, independent of note text, titles, revision and input order.
  const key = JSON.stringify([
    subjectIds,
    notes.map((n, i) => [n.id, subjects[i]]),
    [...edges],
  ]);
  return {
    notes,
    index,
    edges,
    neighbors,
    rank,
    hubs,
    role,
    groups,
    subjects,
    key,
  };
}
export type AllNotesData = ReturnType<typeof allNotesData>;
