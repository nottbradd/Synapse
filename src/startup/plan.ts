import { SWARM, type Point, type Target } from "./geometry";
import type { GraphPresentation } from "./presentation";
import { curveLength } from "../interaction/connections";
import { subjects } from "../types";
export type Job =
  | "layout"
  | "typography"
  | "navigation"
  | "placement"
  | "connections"
  | "controls";
export interface Task {
  id: string;
  kind: "box" | "text" | "duplicate" | "node" | "connection";
  agent: number;
  dependencies: string[];
  target?: number;
  node?: number;
  edge?: number;
  from: Point;
  anchor: Point;
  destination: Point;
  start: number;
  work: number;
  end: number;
  typing: number[];
}
export interface Agent {
  id: number;
  role: Job;
  name: string;
  color: string;
  entrance: Point;
  exit: Point;
  bend: number;
  departure: number;
  gone: number;
}
export interface Plan {
  tasks: Task[];
  agents: Agent[];
  duration: number;
  graphEnd: number;
}
export function random(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const length = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const centre = (t: Target) => ({
  x: t.rect.x + t.rect.width / 2,
  y: t.rect.y + t.rect.height / 2,
});
export function makePlan(
  targets: Target[],
  graph: GraphPresentation | undefined,
  width: number,
  height: number,
): Plan {
  const rng = random(117 + targets.length * 31 + (graph?.nodes.length ?? 0));
  const compact = width < 950 || height < 650;
  const roles: Job[] = compact
    ? [
        "layout",
        "typography",
        "navigation",
        "placement",
        "connections",
        "controls",
      ]
    : [
        "layout",
        "typography",
        "navigation",
        "navigation",
        "placement",
        "placement",
        "connections",
        "connections",
        "controls",
      ];
  const palette = [
    ...subjects.slice(0, 4).map((s) => s.color),
    "#a3bac7",
    "#7f95a6",
  ];
  const entrances: Point[] = [
    { x: -20, y: height * 0.16 },
    { x: width * 0.3, y: -20 },
    { x: -20, y: height * 0.55 },
    { x: width * 0.16, y: height + 20 },
    { x: width + 20, y: height * 0.25 },
    { x: width * 0.68, y: height + 20 },
    { x: width * 0.72, y: -20 },
    { x: width + 20, y: height * 0.74 },
    { x: width * 0.4, y: height + 20 },
  ];
  const agents: Agent[] = roles.map((role, id) => ({
    id,
    role,
    name: {
      layout: "Frame",
      typography: "Type",
      navigation: "Nav",
      placement: "Place",
      connections: "Link",
      controls: "Tools",
    }[role],
    color: palette[id % palette.length],
    entrance: entrances[id],
    exit: entrances[id],
    bend: (id % 2 ? -1 : 1) * (8 + rng() * 15),
    departure: 0,
    gone: 0,
  }));
  const tasks: Task[] = [],
    free = agents.map((_, i) => 20 + (i % 3) * 34 + rng() * 45);
  const last = agents.map((a) => a.entrance);
  function add(
    id: string,
    kind: Task["kind"],
    role: Job,
    anchor: Point,
    destination: Point,
    work: number,
    dependencies: string[],
    extra: Partial<Task> = {},
  ) {
    const candidates = agents.filter((a) => a.role === role);
    const agent =
      candidates.sort((a, b) => free[a.id] - free[b.id])[0] ?? agents[0];
    const dependencyEnd = Math.max(
      0,
      ...dependencies.map((d) => tasks.find((t) => t.id === d)!.end),
    );
    const start = Math.max(
      free[agent.id],
      dependencyEnd + (dependencies.length ? 24 + rng() * 35 : 0),
    );
    const travel = Math.min(
      480,
      120 + Math.sqrt(length(last[agent.id], anchor)) * (8.5 + rng() * 3),
    );
    const task: Task = {
      id,
      kind,
      agent: agent.id,
      dependencies,
      from: last[agent.id],
      anchor,
      destination,
      start,
      work: start + travel,
      end: start + travel + work * (0.94 + rng() * 0.12),
      typing: [],
      ...extra,
    };
    if (kind === "text") {
      let at = 0;
      task.typing = targets[task.target!].text.map(
        (char) =>
          (at += 16 + rng() * 27 + (/\s/u.test(char) ? 38 + rng() * 30 : 0)),
      );
      task.typing = task.typing.map((t) => (t / at) * (task.end - task.work));
    }
    tasks.push(task);
    free[agent.id] = task.end + 25 + rng() * 30;
    last[agent.id] = destination;
    return id;
  }
  const surface = targets.findIndex((t) => t.kind === "surface");
  const master = targets.findIndex((t) => t.kind === "duplicate");
  targets.forEach((target, i) => {
    const r = target.rect,
      dependencies: string[] = [];
    if (
      surface >= 0 &&
      i !== surface &&
      targets[surface].element.contains(target.element)
    )
      dependencies.push(`ui-${surface}`);
    const isCopy = target.kind === "duplicate" && i !== master && master >= 0;
    if (isCopy) dependencies.push(`ui-${master}`);
    const kind = target.kind === "text" ? "text" : isCopy ? "duplicate" : "box";
    const anchor = isCopy
      ? centre(targets[master])
      : { x: r.x, y: kind === "text" ? target.baseline : r.y };
    const destination = isCopy
      ? centre(target)
      : {
          x:
            r.x +
            (kind === "text" ? (target.widths.at(-1) ?? r.width) : r.width),
          y: kind === "text" ? target.baseline : r.y + r.height,
        };
    const work =
      kind === "text"
        ? Math.min(760, 80 + target.text.length * 32)
        : isCopy
          ? Math.min(550, 210 + length(anchor, destination) * 0.52)
          : Math.min(630, 210 + Math.hypot(r.width, r.height) * 0.42);
    add(
      `ui-${i}`,
      kind,
      target.group,
      anchor,
      destination,
      work,
      dependencies,
      { target: i },
    );
  });
  graph?.nodes.forEach((n, i) => {
    const source = i ? graph.nodes[0] : { x: n.x - 22, y: n.y - 18 };
    add(
      `node-${i}`,
      "node",
      "placement",
      source,
      n,
      Math.min(670, 240 + length(source, n) * 0.65),
      i ? ["node-0"] : [],
      { node: i },
    );
  });
  graph?.edges.forEach((e, i) =>
    add(
      `edge-${i}`,
      "connection",
      "connections",
      e.path.a,
      e.path.d,
      Math.min(850, 260 + curveLength(e.path) * 0.58),
      [e.source, e.target].map(
        (id) => `node-${graph.nodes.findIndex((n) => n.id === id)}`,
      ),
      { edge: i },
    ),
  );
  const used = agents.filter((a) => tasks.some((t) => t.agent === a.id));
  for (const a of used) {
    a.departure = tasks.filter((t) => t.agent === a.id).at(-1)!.end + 24;
    a.gone = a.departure + 160 + rng() * 95;
    a.exit = {
      x: last[a.id].x + (a.id % 2 ? 42 : -35),
      y: last[a.id].y + (a.id % 3 ? -36 : 31),
    };
  }
  const raw = Math.max(0, ...used.map((a) => a.gone));
  // Normal populated layouts use the approved 3.5 s envelope. Sparse screens
  // keep their naturally shorter work; no filler tasks or shared finale.
  const desired =
    tasks.length >= 18 && (graph?.nodes.length ?? 0) >= 3
      ? SWARM.end
      : Math.min(2800, raw);
  const scale = raw ? desired / raw : 1;
  for (const t of tasks) {
    t.start *= scale;
    t.work *= scale;
    t.end *= scale;
    t.typing = t.typing.map((v) => v * scale);
  }
  for (const a of used) {
    a.departure *= scale;
    a.gone *= scale;
  }
  return {
    tasks,
    agents: used,
    duration: desired,
    graphEnd: Math.max(
      0,
      ...tasks
        .filter((t) => t.node !== undefined || t.edge !== undefined)
        .map((t) => t.end),
    ),
  };
}
