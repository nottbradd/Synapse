// A multilevel layout. Weighted modularity groups densely connected notes, then
// the coarse graph and its children settle from large regions down to individual dots.
export interface LayoutInput {
  subjects: Uint32Array;
  edges: Uint32Array;
}
export interface SettledNetwork {
  xy: Float32Array;
  community: Uint32Array;
  bounds: { left: number; right: number; top: number; bottom: number };
}
type Neighbors = Map<number, number>[];
type Level = {
  links: Neighbors;
  mass: number[];
  subject: number[];
  parent?: number[];
};
function generator(seed: number) {
  return () => {
    let n = (seed += 0x6d2b79f5);
    n = Math.imul(n ^ (n >>> 15), n | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}
function accumulate(map: Map<number, number>, id: number, value: number) {
  map.set(id, (map.get(id) ?? 0) + value);
}
function contract(graph: Level, random: () => number): Level | undefined {
  const { links, mass, subject } = graph;
  const count = links.length;
  const order = Array.from({ length: count }, (_, i) => i);
  const membership = [...order];
  const degree = links.map((l) =>
    [...l.values()].reduce((sum, w) => sum + w, 0),
  );
  const volume = [...degree],
    total = degree.reduce((s, v) => s + v, 0);
  if (!total) return;
  for (let pass = 0; pass < 16; pass++) {
    for (let i = count - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    let moved = 0;
    for (const i of order) {
      const previous = membership[i],
        votes = new Map<number, number>();
      for (const [neighbor, w] of links[i])
        if (neighbor !== i) accumulate(votes, membership[neighbor], w);
      volume[previous] -= degree[i];
      const cost = degree[i] / total;
      let best = previous,
        score = (votes.get(previous) ?? 0) - cost * volume[previous];
      for (const [group, weight] of votes) {
        const next = weight - cost * volume[group];
        if (next > score + 1e-9) {
          best = group;
          score = next;
        }
      }
      membership[i] = best;
      volume[best] += degree[i];
      if (best !== previous) moved++;
    }
    if (!moved) break;
  }
  const ids = new Map<number, number>();
  const parent = membership.map((m) => {
    if (!ids.has(m)) ids.set(m, ids.size);
    return ids.get(m)!;
  });
  if (ids.size >= count * 0.94) return;
  graph.parent = parent;
  const coarse: Level = {
    links: Array.from({ length: ids.size }, () => new Map()),
    mass: Array(ids.size).fill(0),
    subject: [],
  };
  const groups = coarse.links.map(() => new Map<number, number>());
  for (let i = 0; i < count; i++) {
    const a = parent[i];
    coarse.mass[a] += mass[i];
    accumulate(groups[a], subject[i], mass[i]);
    for (const [j, w] of links[i]) accumulate(coarse.links[a], parent[j], w);
  }
  coarse.subject = groups.map(
    (v) => [...v].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0],
  );
  return coarse;
}

function settle(
  level: Level,
  parentXY: Float64Array | undefined,
  random: () => number,
  leaf: boolean,
) {
  const n = level.links.length,
    xy = new Float64Array(2 * n),
    force = new Float64Array(2 * n);
  const parent = level.parent;
  const radius = level.mass.map((m) => (leaf ? 4.8 : 7.4 * Math.sqrt(m) + 5));
  const scale = Math.sqrt(level.mass.reduce((a, b) => a + b, 0)) * 9;
  const groups = [...new Set(level.subject)],
    groupIndex = new Map(groups.map((s, i) => [s, i]));
  const subjectCentres = groups.map((_, i) => {
    const a = i * 2.399963;
    return groups.length > 1
      ? [Math.cos(a) * scale * 0.38, Math.sin(a) * scale * 0.34]
      : [0, 0];
  });
  const anchors = new Float64Array(n * 2);
  const siblings = new Map<number, number>();
  if (parent)
    for (let i = 0; i < n; i++) accumulate(siblings, parent[i], level.mass[i]);
  for (let i = 0; i < n; i++) {
    const sub = subjectCentres[groupIndex.get(level.subject[i])!];
    const grouped = parent && parentXY;
    const ax = grouped ? parentXY[parent[i] * 2] : sub[0],
      ay = grouped ? parentXY[parent[i] * 2 + 1] : sub[1];
    anchors[2 * i] = ax;
    anchors[2 * i + 1] = ay;
    const spread = grouped
      ? Math.sqrt(siblings.get(parent[i])!) * 7.2
      : scale * 0.8;
    const angle = random() * Math.PI * 2,
      r = Math.sqrt(random()) * spread;
    xy[2 * i] = ax + Math.cos(angle) * r;
    xy[2 * i + 1] = ay + Math.sin(angle) * r;
  }
  const step = 2.8 * radius.reduce((a, b) => Math.max(a, b), 1) + 14;
  const rounds = parent ? (leaf ? 95 : 115) : 170;
  for (let pass = 0; pass < rounds; pass++) {
    const temp = 1 - pass / rounds;
    const bins = new Map<number, number[]>();
    const cell = (x: number, y: number) => x + y * 1048576;
    for (let i = 0; i < n; i++) {
      const x = xy[2 * i],
        y = xy[2 * i + 1],
        bx = Math.floor(x / step),
        by = Math.floor(y / step);
      force[2 * i] = (anchors[2 * i] - x) * (parent ? 0.012 : 0.009);
      force[2 * i + 1] = (anchors[2 * i + 1] - y) * (parent ? 0.012 : 0.009);
      const id = cell(bx, by);
      let bin = bins.get(id);
      if (!bin) {
        bin = [];
        bins.set(id, bin);
      }
      bin.push(i);
    }
    for (let i = 0; i < n; i++) {
      const off = i * 2,
        x = xy[off],
        y = xy[off + 1],
        bx = Math.floor(x / step),
        by = Math.floor(y / step);
      for (let cy = by - 1; cy <= by + 1; cy++)
        for (let cx = bx - 1; cx <= bx + 1; cx++) {
          const bin = bins.get(cell(cx, cy));
          if (!bin) continue;
          for (const j of bin) {
            if (j <= i) continue;
            const dx = x - xy[j * 2],
              dy = y - xy[j * 2 + 1],
              range = radius[i] + radius[j] + (leaf ? 2 : 9);
            const dist = Math.max(0.01, Math.hypot(dx, dy));
            if (dist >= range * 1.35) continue;
            const push =
              (Math.max(0, range * 1.35 - dist) / dist) * (leaf ? 0.19 : 0.34);
            force[off] += dx * push;
            force[off + 1] += dy * push;
            force[j * 2] -= dx * push;
            force[j * 2 + 1] -= dy * push;
          }
        }
      for (const [j, w] of level.links[i]) {
        if (j <= i) continue;
        const dx = xy[2 * j] - x,
          dy = xy[2 * j + 1] - y,
          dist = Math.max(0.01, Math.hypot(dx, dy));
        const rest =
          (radius[i] + radius[j]) * (leaf ? 1.45 : 1.38) + (leaf ? 1 : 9);
        const across = parent && parent[i] !== parent[j];
        const strength =
          (across ? 0.0026 : leaf ? 0.037 : 0.036) * Math.min(3, Math.sqrt(w));
        const pull = ((dist - rest) / dist) * strength;
        const fx = dx * pull,
          fy = dy * pull;
        force[off] += fx;
        force[off + 1] += fy;
        force[2 * j] -= fx;
        force[2 * j + 1] -= fy;
      }
    }
    const maxStep = (leaf ? 4 : 10) * (0.13 + temp);
    for (let i = 0; i < xy.length; i++)
      xy[i] +=
        Math.max(-maxStep, Math.min(maxStep, force[i])) * (0.36 + 0.64 * temp);
  }
  return xy;
}
function extent(points: ArrayLike<number>) {
  let left = Infinity,
    top = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  for (let i = 0; i < points.length; i += 2) {
    left = Math.min(left, points[i]);
    right = Math.max(right, points[i]);
    top = Math.min(top, points[i + 1]);
    bottom = Math.max(bottom, points[i + 1]);
  }
  return points.length
    ? { left, top, right, bottom }
    : { left: 0, top: 0, right: 0, bottom: 0 };
}
export function layoutNetwork({
  subjects,
  edges,
}: LayoutInput): SettledNetwork {
  const n = subjects.length;
  const adj: Neighbors = Array.from({ length: n }, () => new Map());
  for (let i = 0; i < edges.length; i += 2) {
    const a = edges[i],
      b = edges[i + 1],
      w = subjects[a] === subjects[b] ? 1.13 : 1;
    adj[a].set(b, w);
    adj[b].set(a, w);
  }
  const seen = new Uint8Array(n),
    xy = new Float32Array(n * 2),
    community = new Uint32Array(n);
  const local = new Int32Array(n);
  let nextCommunity = 0;
  const pieces = [];
  for (let origin = 0; origin < n; origin++) {
    if (seen[origin]) continue;
    const ids = [origin];
    seen[origin] = 1;
    for (let h = 0; h < ids.length; h++)
      for (const j of adj[ids[h]].keys())
        if (!seen[j]) {
          seen[j] = 1;
          ids.push(j);
        }
    ids.sort((a, b) => a - b);
    ids.forEach((id, i) => {
      local[id] = i;
    });
    const base: Level = {
      links: ids.map(
        (id) => new Map([...adj[id]].map(([j, w]) => [local[j], w])),
      ),
      mass: ids.map(() => 1),
      subject: ids.map((id) => subjects[id]),
    };
    const levels = [base],
      random = generator(origin * 31 + ids.length * 971 + 17);
    const target = Math.max(5, Math.round(Math.sqrt(ids.length) * 0.55));
    while (
      levels.length < 8 &&
      levels[levels.length - 1].links.length > target
    ) {
      const coarse = contract(levels[levels.length - 1], random);
      if (!coarse) break;
      levels.push(coarse);
    }
    const communities = levels.length - 1;
    const last = levels[communities];
    if (communities && last.links.length >= 9 && last.links.length <= 160) {
      // At this scale internal links already belong to a community. Use its
      // bridges to place related communities together, even within one subject.
      const bridges: Level = {
        ...last,
        links: last.links.map(
          (links, i) => new Map([...links].filter(([j]) => i !== j)),
        ),
      };
      const regions = contract(bridges, random);
      if (regions) {
        last.parent = bridges.parent;
        levels.push(regions);
      }
    }
    let positions: Float64Array | undefined;
    if (ids.length === 1) positions = new Float64Array(2);
    else
      for (let l = levels.length - 1; l >= 0; l--)
        positions = settle(levels[l], positions, random, l === 0);
    const points = positions!;
    // Orient each connected component along its major axis without using the
    // viewport as a layout input. The same graph retains the same coordinates.
    if (ids.length > 2) {
      let x = 0,
        y = 0;
      for (let i = 0; i < points.length; i += 2) {
        x += points[i];
        y += points[i + 1];
      }
      x /= ids.length;
      y /= ids.length;
      let xx = 0,
        yy = 0,
        cross = 0;
      for (let i = 0; i < points.length; i += 2) {
        const dx = points[i] - x,
          dy = points[i + 1] - y;
        xx += dx * dx;
        yy += dy * dy;
        cross += dx * dy;
      }
      const angle = 0.5 * Math.atan2(2 * cross, xx - yy),
        cs = Math.cos(angle),
        sn = Math.sin(angle);
      for (let i = 0; i < points.length; i += 2) {
        const dx = points[i] - x,
          dy = points[i + 1] - y;
        points[i] = (dx * cs + dy * sn) * 1.12;
        points[i + 1] = (-dx * sn + dy * cs) * 0.9;
      }
    }
    const box = extent(points);
    ids.forEach((id, i) => {
      let c = i;
      for (let l = 0; l < communities; l++) c = levels[l].parent![c];
      community[id] = nextCommunity + (communities === 0 ? 0 : c);
    });
    nextCommunity += communities === 0 ? 1 : last.links.length;
    pieces.push({
      ids,
      points,
      box,
      width: box.right - box.left + 22,
      height: box.bottom - box.top + 22,
    });
  }
  // Pack disconnected components and isolated notes without inventing links.
  pieces.sort((a, b) => b.height - a.height || a.ids[0] - b.ids[0]);
  const width =
    Math.sqrt(pieces.reduce((s, c) => s + c.width * c.height, 0)) * 1.45;
  let x = 0,
    y = 0,
    row = 0;
  for (const p of pieces) {
    if (x && x + p.width > width) {
      x = 0;
      y += row;
      row = 0;
    }
    p.ids.forEach((id, i) => {
      xy[2 * id] = p.points[2 * i] - p.box.left + x;
      xy[2 * id + 1] = p.points[2 * i + 1] - p.box.top + y;
    });
    x += p.width;
    row = Math.max(row, p.height);
  }
  return { xy, community, bounds: extent(xy) };
}
