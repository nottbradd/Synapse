import type { Curve, Point } from "../interaction/connections";
import type { Rect } from "../graphLabels";
export interface PresentationNode extends Point {
  id: string;
  radius: number;
  color: string;
  sprite: HTMLCanvasElement;
  extent: number;
  label?: { text: string; x: number; y: number; color: string; alpha: number };
}
export interface PresentationEdge {
  id: string;
  source: string;
  target: string;
  path: Curve;
  color: string;
  width: number;
}
// Read-only pixels and geometry from the existing scene, never another layout.
export interface GraphPresentation {
  element: HTMLElement;
  clip: Rect;
  nodes: PresentationNode[];
  edges: PresentationEdge[];
  valid: () => boolean;
}
const sources = new Map<HTMLElement, () => GraphPresentation | undefined>();
export function registerPresentation(
  element: HTMLElement,
  read: () => GraphPresentation | undefined,
) {
  sources.set(element, read);
  return () => {
    if (sources.get(element) === read) sources.delete(element);
  };
}
export function graphPresentation(root: HTMLElement) {
  for (const [element, read] of sources)
    if (root.contains(element)) return read();
}
