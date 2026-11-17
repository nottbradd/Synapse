import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { Crosshair, MousePointer2, TextCursor, Move } from "lucide-react";
import {
  clamp,
  curve,
  smooth,
  SWARM,
  type Point,
  type Target,
  type Rect,
} from "./geometry";
import type { Plan, Task } from "./plan";
import type { GraphPresentation } from "./presentation";
import { pointOn } from "../interaction/connections";
import { LABEL_FONT } from "../interaction/fonts";

function layer(name: string, deadline: number) {
  const element = document.createElement("div");
  element.className = `swarm-overlay ${name}`;
  element.setAttribute("aria-hidden", "true");
  element.style.animationDuration = `${deadline}ms`;
  const canvas = document.createElement("canvas");
  const ratio = Math.min(
    devicePixelRatio || 1,
    2,
    Math.sqrt(8_000_000 / (innerWidth * innerHeight)),
  );
  canvas.width = Math.ceil(innerWidth * ratio);
  canvas.height = Math.ceil(innerHeight * ratio);
  canvas.style.width = `${innerWidth}px`;
  canvas.style.height = `${innerHeight}px`;
  element.append(canvas);
  const ctx = canvas.getContext("2d")!;
  ctx.scale(ratio, ratio);
  return {
    element,
    ctx,
    clear: () => ctx.clearRect(0, 0, innerWidth, innerHeight),
  };
}
const position = (element: HTMLElement, p: Point) => {
  element.style.transform = `translate3d(${p.x}px,${p.y}px,0)`;
};
function strokePart(
  ctx: CanvasRenderingContext2D,
  path: GraphPresentation["edges"][number]["path"],
  start: number,
  end: number,
) {
  const first = pointOn(path, start);
  ctx.beginPath();
  ctx.moveTo(first.x, first.y);
  for (let i = 1; i <= 20; i++) {
    const p = pointOn(path, start + ((end - start) * i) / 20);
    ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
}
export function createOverlay(
  targets: Target[],
  graph: GraphPresentation | undefined,
  plan: Plan,
  reveal: (index: number) => void,
  revealGraph: () => void,
) {
  const view = layer("swarm-startup", SWARM.deadline),
    { element, ctx } = view;
  const host = document.createElement("div");
  element.append(host);
  const react = createRoot(host);
  try {
    flushSync(() =>
      react.render(
        <>
          {plan.agents.map((a) => (
            <div
              className="swarm-cursor"
              key={a.id}
              data-agent={a.id}
              style={{ color: a.color }}
            >
              <MousePointer2 className="swarm-pointer" size={17} />
              <Crosshair className="swarm-crosshair" size={17} />
              <TextCursor className="swarm-text-cursor" size={18} />
              <Move className="swarm-move" size={17} />
              <span className="swarm-name">{a.name}</span>
            </div>
          ))}
        </>,
      ),
    );
    const cursors = new Map(
      Array.from(element.querySelectorAll<HTMLElement>(".swarm-cursor")).map(
        (e) => [Number(e.dataset.agent), e],
      ),
    );
    const marks = targets.map((t) => {
      const mark = document.createElement("div");
      mark.className = `swarm-mark swarm-${t.kind === "text" ? "text" : "box"}`;
      position(mark, t.rect);
      mark.style.color = "#a3bac7";
      if (t.kind === "text") {
        mark.style.font = t.font;
        mark.style.lineHeight = t.lineHeight;
        mark.style.letterSpacing = t.letterSpacing;
        mark.style.color = t.color;
      } else {
        for (let i = 0; i < 4; i++) {
          const h = document.createElement("i");
          h.className = `swarm-handle corner-${i}`;
          mark.append(h);
        }
        const dimension = document.createElement("span");
        dimension.className = "swarm-dimension";
        mark.append(dimension);
      }
      element.append(mark);
      return mark;
    });
    const copies = new Map<string, HTMLDivElement>();
    for (const task of plan.tasks.filter((t) => t.kind === "duplicate")) {
      const target = targets[task.target!],
        copy = document.createElement("div");
      copy.className = "swarm-copy";
      copy.style.width = `${target.rect.width}px`;
      copy.style.height = `${target.rect.height}px`;
      copy.style.font = target.font;
      copy.style.color = target.color;
      copy.style.borderRadius = target.radius;
      copy.textContent = (target.element.textContent ?? "").trim().slice(0, 64);
      element.append(copy);
      copies.set(task.id, copy);
    }
    document.body.append(element);
    const completed = new Set<string>();
    const taskPosition = (t: Task, elapsed: number) => {
      if (elapsed < t.work)
        return curve(
          t.from,
          t.anchor,
          (elapsed - t.start) / (t.work - t.start),
          plan.agents.find((a) => a.id === t.agent)!.bend,
        );
      const p = clamp((elapsed - t.work) / (t.end - t.work));
      if (t.kind === "connection")
        return pointOn(graph!.edges[t.edge!].path, smooth(p));
      if (t.kind === "text") {
        const target = targets[t.target!],
          count = t.typing.filter((at) => at <= elapsed - t.work).length;
        return {
          x: target.rect.x + (target.widths[count - 1] ?? 0) + 2,
          y:
            target.baseline - parseFloat(target.lineHeight) * 0.35 ||
            target.rect.y + target.rect.height / 2,
        };
      }
      return curve(
        t.anchor,
        t.destination,
        p,
        t.kind === "duplicate" || t.kind === "node" ? 5 : 0,
      );
    };
    return {
      element,
      draw(elapsed: number) {
        view.clear();
        for (const task of plan.tasks) {
          if (elapsed < task.start) continue;
          if (elapsed >= task.end && !completed.has(task.id)) {
            completed.add(task.id);
            if (task.target !== undefined) {
              reveal(task.target);
              marks[task.target].style.opacity = "0";
            }
            copies.get(task.id)?.remove();
          }
          if (
            task.target === undefined ||
            elapsed < task.work ||
            elapsed >= task.end
          )
            continue;
          const target = targets[task.target],
            mark = marks[task.target],
            p = clamp((elapsed - task.work) / (task.end - task.work));
          mark.style.opacity = "1";
          if (task.kind === "text")
            mark.textContent = target.text
              .slice(
                0,
                task.typing.filter((at) => at <= elapsed - task.work).length,
              )
              .join("");
          else if (task.kind === "duplicate") {
            mark.style.opacity = "0";
            const copy = copies.get(task.id)!,
              q = taskPosition(task, elapsed);
            copy.style.opacity = ".75";
            position(copy, {
              x: q.x - target.rect.width / 2,
              y: q.y - target.rect.height / 2,
            });
            ctx.save();
            ctx.strokeStyle = "#a3bac780";
            ctx.lineWidth = 0.7;
            ctx.setLineDash([3, 4]);
            ctx.beginPath();
            ctx.moveTo(task.anchor.x, task.anchor.y);
            ctx.lineTo(task.anchor.x, q.y);
            ctx.lineTo(q.x, q.y);
            ctx.stroke();
            ctx.restore();
          } else {
            const w = Math.max(1, target.rect.width * smooth(p)),
              h = Math.max(1, target.rect.height * smooth(p));
            mark.style.width = `${w}px`;
            mark.style.height = `${h}px`;
            mark.style.color = plan.agents.find(
              (a) => a.id === task.agent,
            )!.color;
            mark.querySelector("span")!.textContent =
              `${Math.round(w)} × ${Math.round(h)}`;
          }
        }
        if (graph && elapsed < plan.graphEnd + 90) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(
            graph.clip.x,
            graph.clip.y,
            graph.clip.width,
            graph.clip.height,
          );
          ctx.clip();
          for (const task of plan.tasks.filter((t) => t.edge !== undefined)) {
            if (elapsed < task.work) continue;
            const edge = graph.edges[task.edge!],
              p = clamp((elapsed - task.work) / (task.end - task.work));
            ctx.strokeStyle =
              p === 1
                ? edge.color
                : graph.nodes.find((n) => n.id === edge.source)!.color;
            ctx.lineWidth = p === 1 ? edge.width : 0.9;
            strokePart(ctx, edge.path, 0, smooth(p));
            if (p < 1) {
              const end = pointOn(edge.path, smooth(p));
              ctx.fillStyle = "#d7e6ed";
              ctx.fillRect(edge.path.a.x - 1.5, edge.path.a.y - 1.5, 3, 3);
              ctx.fillRect(end.x - 1.5, end.y - 1.5, 3, 3);
            }
          }
          for (const task of plan.tasks.filter((t) => t.node !== undefined)) {
            if (elapsed < task.work) continue;
            const node = graph.nodes[task.node!],
              p = clamp((elapsed - task.work) / (task.end - task.work)),
              q = taskPosition(task, elapsed);
            ctx.globalAlpha = 0.45 + 0.55 * smooth(p);
            ctx.drawImage(
              node.sprite,
              q.x - node.extent,
              q.y - node.extent,
              node.extent * 2,
              node.extent * 2,
            );
            if (p < 1) {
              ctx.strokeStyle = `${node.color}88`;
              ctx.lineWidth = 0.7;
              ctx.setLineDash([3, 4]);
              ctx.beginPath();
              ctx.moveTo(task.anchor.x, q.y);
              ctx.lineTo(q.x, q.y);
              ctx.stroke();
              ctx.setLineDash([]);
            }
            if (node.label && elapsed >= task.end) {
              ctx.globalAlpha =
                node.label.alpha * clamp((elapsed - task.end) / 80);
              ctx.font = LABEL_FONT;
              ctx.textAlign = "center";
              ctx.textBaseline = "middle";
              ctx.fillStyle = node.label.color;
              ctx.fillText(node.label.text, node.label.x, node.label.y);
            }
          }
          ctx.restore();
        } else if (graph) revealGraph();
        for (const agent of plan.agents) {
          const cursor = cursors.get(agent.id)!,
            own = plan.tasks.filter((t) => t.agent === agent.id);
          if (elapsed < own[0].start || elapsed >= agent.gone) {
            cursor.style.opacity = "0";
            continue;
          }
          const task = own.find((t) => elapsed < t.end) ?? own.at(-1)!;
          let q = taskPosition(task, elapsed),
            mode =
              elapsed < task.work
                ? "pointer"
                : task.kind === "text"
                  ? "text"
                  : task.kind === "node" || task.kind === "duplicate"
                    ? "move"
                    : "crosshair";
          let alpha = clamp((elapsed - own[0].start) / 70);
          if (elapsed > agent.departure) {
            const p =
              (elapsed - agent.departure) / (agent.gone - agent.departure);
            q = curve(own.at(-1)!.destination, agent.exit, p, agent.bend * 0.4);
            alpha = 1 - smooth(p);
            mode = "pointer";
          }
          cursor.dataset.mode = mode;
          cursor.style.opacity = `${alpha}`;
          position(cursor, q);
          cursor.querySelector<HTMLElement>(".swarm-name")!.style.opacity =
            elapsed >= task.work && elapsed < task.end ? ".7" : "0";
        }
      },
      remove() {
        element.remove();
        copies.clear();
        queueMicrotask(() => react.unmount());
      },
    };
  } catch (error) {
    element.remove();
    queueMicrotask(() => react.unmount());
    throw error;
  }
}

export function createReturnOverlay(chrome: Rect[], graph?: GraphPresentation) {
  const view = layer("swarm-return", SWARM.returnDeadline),
    { ctx, element } = view;
  document.body.append(element);
  return {
    element,
    draw(elapsed: number) {
      view.clear();
      const progress = clamp(elapsed / SWARM.returnEnd),
        alpha = Math.sin(Math.PI * progress) * 0.58;
      ctx.save();
      ctx.strokeStyle = `rgba(176,205,216,${alpha})`;
      ctx.lineWidth = 0.8;
      chrome.slice(0, 3).forEach((r, i) => {
        const p = clamp((progress - i * 0.035) / 0.75),
          length = Math.min(150, r.width - 12);
        ctx.beginPath();
        ctx.moveTo(r.x + 6, r.y + 7);
        ctx.lineTo(r.x + 6 + length * smooth(p), r.y + 7);
        ctx.stroke();
      });
      if (graph) {
        ctx.beginPath();
        ctx.rect(
          graph.clip.x,
          graph.clip.y,
          graph.clip.width,
          graph.clip.height,
        );
        ctx.clip();
        graph.edges.slice(0, 3).forEach((edge, i) => {
          const p = (elapsed - 12 - i * 14) / 175,
            color = graph.nodes.find((n) => n.id === edge.target)!.color;
          ctx.strokeStyle = color;
          ctx.fillStyle = color;
          ctx.globalAlpha = 0.7;
          if (p >= 0 && p < 1) {
            ctx.lineWidth = 1.3;
            strokePart(ctx, edge.path, Math.max(0, p - 0.08), p);
          } else if (p >= 1 && p < 1.45) {
            const n = graph.nodes.find((n) => n.id === edge.target)!;
            ctx.globalAlpha = (1 - (p - 1) / 0.45) * 0.42;
            const r = n.radius * 0.5;
            ctx.fillRect(n.x - r, n.y - r, r * 2, r * 2);
          }
        });
      }
      ctx.restore();
    },
    remove: () => element.remove(),
  };
}
