import { project, type Frame, type Viewport } from "./motion";
import { nodeScreenRadius, type SceneNode } from "./topology";

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
  texture(color: string) {
    const key = color;
    let canvas = this.textures.get(key);
    if (canvas) return canvas;
    canvas = document.createElement("canvas");
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext("2d")!,
      g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    for (const [at, alpha] of [
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
    for (const node of nodes) {
      const centre = project(node, frame, view),
        radius = nodeScreenRadius(node, frame.zoom) * 1.8;
      ctx.globalAlpha = 0.38 * density;
      ctx.drawImage(
        this.texture(colors.get(node.subject_id) ?? "#95a6b8"),
        centre.x - radius,
        centre.y - radius,
        radius * 2,
        radius * 2,
      );
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }
}
