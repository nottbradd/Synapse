import {
  MOTION,
  project,
  type Bounds,
  type Frame,
  type Viewport,
} from "./motion";
import { connection, curveLength } from "./connections";
export interface SignalNode {
  id: string;
  x?: number;
  y?: number;
  subject_id: string;
}
export interface SignalPacket {
  id: string;
  operation: string;
  source: string;
  target: string;
  start: number;
  duration: number;
  arrival: number;
  color: string;
  level: number;
  pan: number;
  subject: string;
}
export const inside = (p: { x: number; y: number }, r: Bounds) =>
  p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
export function planSignals(
  operation: string,
  source: string,
  nodes: SignalNode[],
  edges: { source: string; target: string }[],
  frame: Frame,
  view: Viewport,
  bounds: Bounds,
  start: number,
  colors: Map<string, string>,
): SignalPacket[] {
  const byId = new Map(nodes.map((n) => [n.id, n])),
    from = byId.get(source);
  if (!from) return [];
  const a = project(from, frame, view);
  return edges
    .flatMap((e) => {
      const id =
          e.source === source
            ? e.target
            : e.target === source
              ? e.source
              : null,
        n = id ? byId.get(id) : null;
      if (!n) return [];
      const b = project(n, frame, view);
      if (!inside(a, bounds) || !inside(b, bounds)) return [];
      const duration = Math.max(
        80,
        Math.min(
          1100,
          (curveLength(connection(a, b, source, n.id)) / MOTION.signalSpeed) *
            1000,
        ),
      );
      return [
        {
          id: `${operation}:${n.id}`,
          operation,
          source,
          target: n.id,
          start,
          duration,
          arrival: start + duration,
          color: colors.get(n.subject_id) ?? "#95abbc",
          subject: n.subject_id,
          level: 0.22,
          pan: Math.max(
            -0.7,
            Math.min(0.7, (b.x - view.width / 2) / (view.width / 2)),
          ),
        },
      ];
    })
    .sort((a, b) => a.duration - b.duration || a.target.localeCompare(b.target))
    .slice(0, 12)
    .map((packet, i) => ({
      ...packet,
      start: packet.start + i * 18,
      arrival: packet.arrival + i * 18,
    }));
}
export class SignalTimeline {
  packets: SignalPacket[] = [];
  replace(packets: SignalPacket[]) {
    const old = this.packets.map((p) => p.id);
    this.packets = packets;
    return old;
  }
  prune(now: number, visible: Set<string>) {
    const cancelled = this.packets.filter(
      (p) => !visible.has(p.source) || !visible.has(p.target),
    );
    this.packets = this.packets.filter(
      (p) =>
        visible.has(p.source) &&
        visible.has(p.target) &&
        now <= p.arrival + MOTION.bloomDuration,
    );
    return cancelled.map((p) => p.id);
  }
  cancel() {
    const ids = this.packets.map((p) => p.id);
    this.packets = [];
    return ids;
  }
}
