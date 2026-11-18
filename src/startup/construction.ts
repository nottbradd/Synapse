import {
  clamp,
  curve,
  smooth,
  SWARM,
  type Point,
  type Rect,
  type Target,
} from "./geometry";
import {
  orbitPosition,
  penPosition,
  type Agent,
  type Plan,
  type Task,
} from "./plan";
import type { GraphPresentation, PresentationNode } from "./presentation";
import {
  alignment,
  completionPulse,
  letters,
  selection,
  spacing,
  wire,
} from "./drafting";
import { layer } from "./layer";

// The reference mark uses a 512-unit construction grid and open-centred terminals.
// Mask just the connecting strokes so an agent can pass behind the actual ink.
const markSvg = `<svg viewBox="0 0 512 512" focusable="false" fill="none" stroke="#e4e4e7" stroke-width="24" stroke-linecap="round">
  <defs><mask id="swarm-terminal-holes" maskUnits="userSpaceOnUse" x="0" y="0" width="512" height="512"><rect width="512" height="512" fill="white" stroke="none"/><g fill="black" stroke="none"><circle cx="166" cy="139" r="27"/><circle cx="166" cy="373" r="27"/><circle cx="346" cy="164" r="27"/></g></mask></defs>
  <path mask="url(#swarm-terminal-holes)" d="M166 147v218m0-109c0 56 180 56 180-22v-43"/>
  <circle cx="166" cy="139" r="27"/><circle cx="166" cy="373" r="27"/><circle cx="346" cy="164" r="27"/>
</svg>`;
const crosshair = `<svg viewBox="-13 -13 26 26" width="26" height="26" focusable="false" fill="none" stroke="currentColor" stroke-width="1.4"><circle r="5.5"/><path d="M7 0h4.5m-18.5 0h-4.5M0 7v4.5M0 -7v-4.5"/><circle r="1.6" fill="currentColor" stroke="none"/></svg>`;

function cursor(agent: Agent, tasks: Task[], host: HTMLElement) {
  const element = document.createElement("div"),
    name = document.createElement("span");
  element.className = "swarm-cursor";
  element.dataset.agent = String(agent.id);
  element.style.setProperty("--agent-color", agent.color);
  element.innerHTML = crosshair;
  name.className = "swarm-name";
  name.textContent = agent.name;
  element.append(name);
  host.append(element);
  return {
    agent,
    element,
    name,
    tasks: tasks.filter((t) => t.agent === agent.id),
  };
}
const workProgress = (t: Task, at: number) =>
  clamp((at - t.work) / (t.end - t.work));
function typedCount(t: Task, at: number) {
  const next = t.typing.findIndex((offset) => offset > at - t.work);
  return next === -1 ? t.typing.length : next;
}
function taskPosition(t: Task, at: number, agent: Agent): Point {
  if (at < t.work) {
    const distance = Math.hypot(t.from.x - t.anchor.x, t.from.y - t.anchor.y);
    return curve(
      t.from,
      t.anchor,
      (at - t.start) / Math.max(1, t.work - t.start - 25),
      agent.bend * Math.min(600, distance),
    );
  }
  if (t.run) return penPosition(t.run, typedCount(t, at));
  const p = workProgress(t, at);
  return curve(
    t.anchor,
    t.destination,
    t.kind === "connection" ? p / 0.68 : p,
    0,
  );
}
function sprite(
  ctx: CanvasRenderingContext2D,
  node: PresentationNode,
  point: Point,
  alpha = 1,
) {
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.drawImage(
    node.sprite,
    point.x - node.extent,
    point.y - node.extent,
    2 * node.extent,
    2 * node.extent,
  );
  ctx.restore();
}
function nodeRect(n: PresentationNode): Rect {
  return {
    x: n.x - n.radius,
    y: n.y - n.radius,
    width: 2 * n.radius,
    height: 2 * n.radius,
  };
}
function drawBox(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  p: number,
  tail: number,
) {
  if (tail <= 0) return;
  ctx.save();
  ctx.globalAlpha *= tail;
  selection(
    ctx,
    { ...r, width: r.width * smooth(p), height: r.height * smooth(p) },
    true,
  );
  ctx.restore();
}
function drawCopy(
  ctx: CanvasRenderingContext2D,
  master: Target,
  t: Task,
  point: Point,
) {
  const r = master.rect,
    x = point.x - r.width / 2,
    y = point.y - r.height / 2;
  ctx.save();
  ctx.globalAlpha = 0.6;
  ctx.fillStyle =
    master.background === "rgba(0, 0, 0, 0)" ? "#202b36" : master.background;
  ctx.beginPath();
  ctx.roundRect(x, y, r.width, r.height, master.radius);
  ctx.fill();
  if (master.captions[0]) {
    ctx.translate(x - r.x, y - r.y);
    const run = master.captions[0].run;
    letters(ctx, run, run.text.length, false);
  }
  ctx.restore();
  spacing(ctx, t.anchor, point);
}
export function createOverlay(
  targets: Target[],
  graph: GraphPresentation | undefined,
  plan: Plan,
  reveal: (element: HTMLElement) => void,
  revealGraph: () => void,
) {
  const view = layer("swarm-startup", SWARM.deadline),
    { ctx, element } = view;
  const shade = document.createElement("div"),
    mark = document.createElement("div");
  shade.className = "swarm-opening-shade";
  mark.className = "swarm-opening-mark";
  mark.innerHTML = markSvg;
  element.prepend(shade);
  const actors = plan.agents.map((a) => cursor(a, plan.tasks, element));
  element.append(mark);
  mark.style.width = mark.style.height = `${120 * plan.scale}px`;
  const outlines = graph?.outlines() ?? [];
  const ui = plan.tasks.filter(
    (t) => t.target !== undefined || t.kind === "guide",
  );
  const nodes = plan.tasks.filter((t) => t.kind === "node"),
    edges = plan.tasks.filter((t) => t.kind === "connection");
  const labels = plan.tasks.filter(
    (t) => t.kind === "text" && t.node !== undefined,
  );
  const agentMap = new Map(plan.agents.map((a) => [a.id, a]));
  const position = (t: Task, at: number) =>
    taskPosition(t, at, agentMap.get(t.agent)!);
  const completed = new Set<string>();
  let liveGraph = false;
  function drawUI(at: number) {
    const beforeClosing = clamp((plan.constructionEnd - at) / 160);
    for (const t of ui) {
      if (at < t.work) continue;
      const p = workProgress(t, at),
        tail = clamp(1 - (at - t.end - 50) / 110) * beforeClosing;
      if (t.kind === "guide") {
        ctx.save();
        ctx.globalAlpha = 0.72 * beforeClosing;
        alignment(ctx, position(t, at).x, innerHeight);
        ctx.restore();
        continue;
      }
      const target = targets[t.target!];
      if (at >= t.end && !completed.has(t.id)) {
        completed.add(t.id);
        reveal(
          t.caption === undefined
            ? target.element
            : target.captions[t.caption].element,
        );
      }
      if (t.run) {
        if (at < t.end) letters(ctx, t.run, typedCount(t, at), true);
      } else if (t.kind === "box") drawBox(ctx, target.rect, p, tail);
      else if (t.kind === "duplicate" && at < t.end) {
        const master = targets[t.master!];
        if (p < 0.68) selection(ctx, master.rect, false);
        drawCopy(ctx, master, t, position(t, at));
      }
    }
  }
  function drawGraph(at: number) {
    if (!graph) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(graph.clip.x, graph.clip.y, graph.clip.width, graph.clip.height);
    ctx.clip();
    if (at < plan.graphEnd) {
      for (const t of edges) {
        if (at < t.work) continue;
        const e = graph.edges[t.edge!],
          source = graph.nodes.find((n) => n.id === e.source)!;
        wire(ctx, e, source.color, position(t, at), workProgress(t, at));
      }
      for (const t of nodes) {
        if (at < t.work) continue;
        const n = graph.nodes[t.node!],
          p = workProgress(t, at);
        if (t.node === 0) {
          if (p === 1) sprite(ctx, n, n);
          drawBox(ctx, nodeRect(n), p, clamp(1 - (at - t.end - 40) / 110));
        } else if (p < 1) {
          const head = position(t, at),
            master = graph.nodes[0];
          if (p < 0.68) selection(ctx, nodeRect(master), false);
          sprite(ctx, master, head, 0.64);
          spacing(ctx, t.anchor, head);
        } else {
          const mix = clamp((at - t.end) / 120);
          if (mix < 1) sprite(ctx, graph.nodes[0], n, 1 - mix);
          sprite(ctx, n, n, mix);
        }
      }
      for (const t of labels)
        if (at >= t.work) letters(ctx, t.run!, typedCount(t, at), at < t.end);
    } else if (!liveGraph) {
      liveGraph = true;
      revealGraph();
    }
    completionPulse(
      ctx,
      outlines,
      (at - plan.constructionEnd) / SWARM.pulse,
      plan.scale,
    );
    ctx.restore();
  }
  function drawAgents(at: number) {
    const visualScale = Math.min(1.22, plan.scale);
    for (const { agent, element: el, name, tasks } of actors) {
      if (at >= agent.gone) {
        if (el.isConnected) el.remove();
        continue;
      }
      const first = tasks[0],
        last = tasks[tasks.length - 1];
      const task = tasks.find((t) => at < t.end) ?? last;
      const p =
        at < first.start
          ? orbitPosition(agent, plan.centre, at)
          : position(task, at);
      const retiring = clamp((at - agent.departure) / SWARM.departure);
      const press = at >= task.work - 28 && at <= task.work + 16 && !task.run;
      const scale = visualScale * (1 - 0.5 * retiring);
      el.style.transform = `translate3d(${p.x}px,${p.y}px,0) scale(${scale})`;
      el.style.opacity = String(clamp(at / 150) * (1 - retiring));
      el.classList.toggle("swarm-press", press);
      name.style.opacity = String(1 - clamp(retiring * 3));
    }
  }
  function draw(at: number) {
    view.clear();
    const fade = 1 - clamp((at - plan.orbitEnd) / 300);
    if (fade > 0) {
      shade.style.opacity = String(fade);
      mark.style.opacity = String(clamp(at / 250) * fade);
      mark.style.transform = `translate(-50%,-50%) scale(${0.9 + 0.1 * (1 - (1 - clamp(at / 300)) ** 3)})`;
    } else if (mark.isConnected) {
      shade.remove();
      mark.remove();
    }
    drawUI(at);
    drawGraph(at);
    drawAgents(at);
  }
  draw(0);
  document.body.append(element);
  return { element, draw, remove: () => element.remove() };
}
