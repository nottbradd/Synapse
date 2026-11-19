import {
  SWARM,
  graphemes,
  measureLetters,
  type Lettering,
  type Point,
  type Target,
} from "./geometry";
import type { GraphPresentation } from "./presentation";
import { curveLength } from "../interaction/connections";
import { LABEL_FONT } from "../interaction/fonts";

export interface Task {
  id: string;
  kind: "guide" | "box" | "text" | "duplicate" | "node" | "connection";
  agent: number;
  dependencies: string[];
  target?: number;
  caption?: number;
  master?: number;
  node?: number;
  edge?: number;
  run?: Lettering;
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
  name: string;
  color: string;
  radius: number;
  angle: number;
  speed: number;
  bend: number;
  departure: number;
  gone: number;
}
export interface Plan {
  tasks: Task[];
  agents: Agent[];
  centre: Point;
  scale: number;
  orbitEnd: number;
  constructionEnd: number;
  duration: number;
  graphEnd: number;
}
const roster = [
  ["Ohm", "#713138"],
  ["Volta", "#65505d"],
  ["Hertz", "#50484d"],
  ["Watt", "#656055"],
  ["Tesla", "#84484e"],
  ["Henry", "#695749"],
  ["Farad", "#5f545d"],
  ["Gauss", "#764750"],
  ["Weber", "#5e5952"],
  ["Ampere", "#504c52"],
  ["Kelvin", "#775647"],
  ["Joule", "#665d56"],
  ["Maxwell", "#715361"],
  ["Siemens", "#565058"],
] as const;
export function random(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function orbitPosition(
  agent: Agent,
  centre: Point,
  elapsed: number,
): Point {
  const angle = agent.angle + (agent.speed * elapsed) / 1000;
  return {
    x: centre.x + agent.radius * Math.cos(angle),
    y: centre.y + agent.radius * 0.6 * Math.sin(angle),
  };
}
export function penPosition(run: Lettering, count: number): Point {
  return {
    x: run.x + (run.widths[count - 1] ?? 0) + 6,
    y: run.y - (run.baseline === "middle" ? 0 : run.size * 0.24),
  };
}
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const centreOf = (t: Target) => ({
  x: t.rect.x + t.rect.width / 2,
  y: t.rect.y + t.rect.height / 2,
});
export function makePlan(
  targets: Target[],
  graph: GraphPresentation | undefined,
  width: number,
  height: number,
): Plan {
  const nodes = graph?.nodes ?? [],
    edges = graph?.edges ?? [];
  const rng = random(11 + targets.length * 31 + nodes.length);
  const centre = { x: width / 2, y: height / 2 };
  const scale = Math.min(
    1.5,
    Math.max(0.62, Math.min(width / 1000, height / 600)),
  );
  const populated = nodes.length >= 3 && targets.length >= 5;
  const compact = width < 950 || height < 650;
  const jobs = targets.length + nodes.length + edges.length;
  const count = Math.min(
    jobs,
    populated
      ? compact
        ? 8
        : SWARM.agents
      : Math.min(7, Math.max(2, Math.ceil(jobs / 2))),
  );
  const orbitEnd = populated
    ? SWARM.orbit
    : Math.min(SWARM.orbit, 450 + jobs * 32);
  const agents = roster.slice(0, count).map(([name, color], id) => ({
    id,
    name,
    color,
    radius: (70 + ((id * 37) % 100)) * scale,
    angle: id * 0.9,
    speed: (4 + (id % 4)) * (id % 2 ? -1 : 1),
    bend: (id % 2 ? -1 : 1) * (0.055 + rng() * 0.07),
    departure: 0,
    gone: 0,
  }));
  const tasks: Task[] = [],
    byId = new Map<string, Task>();
  const last: (Task | undefined)[] = Array.from({ length: count });
  const available = agents.map((a) => a.id * 30);
  function nextAgent(preferred?: number) {
    if (preferred !== undefined && preferred < count) return preferred;
    const fresh = agents.find((a) => !last[a.id]);
    return fresh?.id ?? available.indexOf(Math.min(...available));
  }
  type TaskInput = Pick<Task, "id" | "kind" | "anchor" | "destination"> &
    Partial<
      Pick<
        Task,
        | "target"
        | "caption"
        | "master"
        | "node"
        | "edge"
        | "run"
        | "dependencies"
      >
    >;
  function add(input: TaskInput, workMs: number, preferred?: number) {
    const agent = nextAgent(preferred),
      dependencies = input.dependencies ?? [];
    const after = Math.max(0, ...dependencies.map((id) => byId.get(id)!.end));
    const start = Math.max(
      available[agent],
      after + (dependencies.length ? 15 + rng() * 32 : 0),
    );
    const from =
      last[agent]?.destination ??
      orbitPosition(agents[agent], centre, orbitEnd + start);
    const travel =
      72 + Math.sqrt(distance(from, input.anchor)) * (10 + rng() * 4);
    const typing: number[] = [];
    if (input.run) {
      let at = 0;
      for (const char of input.run.text) {
        at +=
          14 +
          rng() * 28 +
          (/\s/u.test(char) ? rng() * 38 : 0) +
          (rng() < 0.04 ? 55 + rng() * 85 : 0);
        typing.push(at);
      }
      workMs = at + 32;
    }
    const work = start + travel + 28;
    const task: Task = {
      ...input,
      agent,
      dependencies,
      from,
      start,
      work,
      end: work + workMs,
      typing,
    };
    tasks.push(task);
    byId.set(task.id, task);
    last[agent] = task;
    available[agent] = task.end + 22 + rng() * 40;
    return task;
  }
  function type(
    id: string,
    run: Lettering,
    details: Partial<Pick<Task, "target" | "caption" | "node">>,
    dependencies: string[],
    worker?: number,
  ) {
    return add(
      {
        id,
        kind: "text",
        run,
        anchor: penPosition(run, 0),
        destination: penPosition(run, run.text.length),
        dependencies,
        ...details,
      },
      0,
      worker,
    );
  }
  const surface = targets.findIndex((t) => t.kind === "surface");
  const heading = targets.findIndex((t) =>
    t.element.matches(".graph-heading h1"),
  );
  const master = targets.findIndex((t) => t.kind === "duplicate");
  if (heading >= 0 && nodes.length) {
    const x = targets[heading].rect.x,
      y = centre.y;
    add(
      {
        id: "guide",
        kind: "guide",
        anchor: { x: 10, y },
        destination: { x, y },
      },
      210,
      0,
    );
  }
  function ui(i: number, worker?: number) {
    const t = targets[i],
      r = t.rect,
      dependencies: string[] = [];
    if (
      surface >= 0 &&
      i !== surface &&
      targets[surface].element.contains(t.element)
    )
      dependencies.push(`ui-${surface}`);
    if (heading === i && byId.has("guide")) dependencies.push("guide");
    const title = byId.get(`ui-${heading}`);
    if (title && t.element.matches(".graph-heading > span")) {
      dependencies.push(title.id);
      worker = title.agent;
    }
    if (t.kind === "text") {
      type(
        `ui-${i}`,
        t.captions[0].run,
        { target: i, caption: 0 },
        dependencies,
        worker,
      );
      return;
    }
    const copy = t.kind === "duplicate" && i !== master;
    if (copy) dependencies.push(`ui-${master}`);
    const anchor = copy ? centreOf(targets[master]) : { x: r.x, y: r.y };
    const destination = copy
      ? centreOf(t)
      : { x: r.x + r.width, y: r.y + r.height };
    const carrier = add(
      {
        id: `ui-${i}`,
        kind: copy ? "duplicate" : "box",
        target: i,
        master: copy ? master : undefined,
        anchor,
        destination,
        dependencies,
      },
      120 + Math.sqrt(distance(anchor, destination)) * 13,
      worker,
    );
    let previous = carrier;
    t.captions.forEach((caption, j) => {
      previous = type(
        `caption-${i}-${j}`,
        caption.run,
        { target: i, caption: j },
        [previous.id],
        carrier.agent,
      );
    });
  }
  if (surface >= 0) {
    ui(surface, 1);
    // As in the reference, the panel builder retires when the panel is placed.
    if (populated && count === SWARM.agents) available[1] = Infinity;
  }
  const ctx = document.createElement("canvas").getContext("2d")!;
  const copyWorkers = [10, 11, 12, 13, 0];
  nodes.forEach((n, i) => {
    const anchor = i
      ? { x: nodes[0].x, y: nodes[0].y }
      : { x: n.x - n.radius, y: n.y - n.radius };
    const destination = i
      ? { x: n.x, y: n.y }
      : { x: n.x + n.radius, y: n.y + n.radius };
    const carrier = add(
      {
        id: `node-${i}`,
        kind: "node",
        node: i,
        anchor,
        destination,
        dependencies: i ? ["node-0"] : [],
      },
      115 + Math.sqrt(distance(anchor, destination)) * 15,
      i ? copyWorkers[i - 1] : 2,
    );
    if (n.label) {
      const text = graphemes(n.label.text);
      if (text.length) {
        const widths = measureLetters(ctx, text, LABEL_FONT);
        type(
          `label-${i}`,
          {
            text,
            widths,
            font: LABEL_FONT,
            size: 14,
            baseline: "middle",
            spacing: "0px",
            alpha: n.label.alpha,
            color: n.label.color,
            x: n.label.x - widths[widths.length - 1] / 2,
            y: n.label.y,
          },
          { node: i },
          [carrier.id],
          carrier.agent,
        );
      }
    }
  });
  if (master >= 0) ui(master);
  targets.forEach((_, i) => {
    if (i !== surface && i !== master) ui(i);
  });
  edges.forEach((edge, i) => {
    const dependencies = [edge.source, edge.target].map(
      (id) => `node-${nodes.findIndex((n) => n.id === id)}`,
    );
    add(
      {
        id: `edge-${i}`,
        kind: "connection",
        edge: i,
        anchor: edge.path.a,
        destination: edge.path.d,
        dependencies,
      },
      210 + Math.sqrt(curveLength(edge.path)) * 14,
    );
  });
  const raw = Math.max(0, ...tasks.map((t) => t.end));
  const constructionEnd = populated
    ? SWARM.constructionEnd
    : orbitEnd + Math.min(2260, raw);
  const rate = raw ? (constructionEnd - orbitEnd) / raw : 1;
  const used = agents.filter((a) => last[a.id]);
  for (const task of tasks) {
    task.start = orbitEnd + task.start * rate;
    task.work = orbitEnd + task.work * rate;
    task.end = orbitEnd + task.end * rate;
    task.typing = task.typing.map((t) => t * rate);
  }
  for (const a of used) {
    const first = tasks.find((t) => t.agent === a.id)!;
    // Scaling travel/work must never disconnect the peel from the live orbit.
    first.from = orbitPosition(a, centre, first.start);
    a.departure = last[a.id]!.end;
    a.gone = a.departure + SWARM.departure;
  }
  return {
    tasks,
    agents: used,
    centre,
    scale,
    orbitEnd,
    constructionEnd,
    duration: constructionEnd + (nodes.length ? 400 : 220),
    graphEnd: Math.max(
      0,
      ...tasks
        .filter((t) => t.node !== undefined || t.edge !== undefined)
        .map((t) => t.end),
    ),
  };
}
