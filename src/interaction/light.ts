import { project, type Frame, type Viewport } from "./motion";
import type { SceneNode } from "./topology";

const rgb = (color: string) =>
  [1, 3, 5].map((i) => Number.parseInt(color.slice(i, i + 2), 16));
export function litColor(color: string, white = 0) {
  return `rgb(${rgb(color)
    .map((c) => Math.round(c + (255 - c) * white))
    .join(" ")})`;
}
export function lightColor(color: string, alpha: number) {
  return `rgba(${rgb(color).join(",")},${alpha})`;
}
// Small cached textures, never a per-frame full-canvas blur or ambient loop.
export class GraphLight {
  private textures = new Map<string, HTMLCanvasElement>();
  texture(color: string, field = false) {
    const key = `${color}:${field}`;
    let canvas = this.textures.get(key);
    if (canvas) return canvas;
    canvas = document.createElement("canvas");
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext("2d")!,
      g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    for (const [at, alpha] of field
      ? [
          [0, 0.21],
          [0.25, 0.14],
          [0.6, 0.05],
          [1, 0],
        ]
      : [
          [0, 0.7],
          [0.18, 0.4],
          [0.4, 0.14],
          [0.7, 0.025],
          [1, 0],
        ])
      g.addColorStop(at, lightColor(color, alpha));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    if (this.textures.size >= 64)
      this.textures.delete(this.textures.keys().next().value!);
    this.textures.set(key, canvas);
    return canvas;
  }
  clear() {
    this.textures.clear();
  }
  render(
    canvas: HTMLCanvasElement,
    nodes: SceneNode[],
    colors: Map<string, string>,
    frame: Frame,
    view: Viewport,
    density: number,
  ) {
    const dpr = window.devicePixelRatio || 1;
    const width = Math.round(view.width * dpr),
      height = Math.round(view.height * dpr);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, view.width, view.height);
    ctx.globalCompositeOperation = "lighter";
    const groups = new Map<string, SceneNode[]>();
    for (const n of nodes) {
      if (!groups.has(n.subject_id)) groups.set(n.subject_id, []);
      groups.get(n.subject_id)!.push(n);
    }
    for (const [id, group] of groups) {
      const xs = group.map((n) => n.x ?? 0).sort((a, b) => a - b),
        ys = group.map((n) => n.y ?? 0).sort((a, b) => a - b);
      const trim = group.length > 12 ? Math.floor(group.length * 0.05) : 0;
      const minX = xs[trim],
        maxX = xs[xs.length - 1 - trim],
        minY = ys[trim],
        maxY = ys[ys.length - 1 - trim];
      const centre = project(
        { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
        frame,
        view,
      );
      const spread = Math.min(230, 170 + 40 * frame.zoom);
      const rx = Math.min(520, ((maxX - minX) * frame.zoom) / 2 + spread),
        ry = Math.min(460, ((maxY - minY) * frame.zoom) / 2 + spread);
      ctx.globalAlpha = 0.95 * density;
      ctx.drawImage(
        this.texture(colors.get(id) ?? "#95a6b8", true),
        centre.x - rx,
        centre.y - ry,
        rx * 2,
        ry * 2,
      );
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }
}
