import { clamp, smooth, SWARM, type Rect } from "./geometry";
import type { GraphPresentation } from "./presentation";
import { pointOn } from "../interaction/connections";
import { layer } from "./layer";

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
