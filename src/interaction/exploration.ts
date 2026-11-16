import { inLocation, type Location, type Snapshot } from "../types";
import type { Frame } from "./motion";

export type GraphScope =
  | { kind: "overview"; neuron: string | null }
  | { kind: "subnetwork"; subject: string }
  | { kind: "topic"; note: string; level: number };
export type SemanticRole = "subnetwork" | "topic" | "concept";
export interface NodePlacement {
  x: number;
  y: number;
  fx?: number;
  fy?: number;
}
export interface FocusView {
  panelWidth?: number;
  mode?: "edit" | "split" | "read";
  auxiliary?: "create" | "library";
  scope: GraphScope;
  selected?: string;
  frame: Frame;
  positions: Record<string, NodePlacement>;
}
export const subjectNodeId = (id: string) => `\u0000subject:${id}`;
export const scopeKey = (scope: GraphScope) =>
  scope.kind === "topic" ? `topic:${scope.note}` : JSON.stringify(scope);
export function baseScope(location: Location): GraphScope {
  return location.subject_id
    ? { kind: "subnetwork", subject: location.subject_id }
    : { kind: "overview", neuron: location.neuron_id };
}
export function validScope(scope: GraphScope, snapshot: Snapshot) {
  return scope.kind === "topic"
    ? snapshot.notes.some((n) => n.id === scope.note)
    : scope.kind === "subnetwork"
      ? snapshot.organization.subjects.some((s) => s.id === scope.subject)
      : !scope.neuron ||
        snapshot.organization.neurons.some((n) => n.id === scope.neuron);
}
export function scopedNotes(snapshot: Snapshot, scope: GraphScope) {
  if (scope.kind === "topic") {
    const ids = new Set([scope.note]);
    for (const e of snapshot.edges) {
      if (e.source === scope.note) ids.add(e.target);
      if (e.target === scope.note) ids.add(e.source);
    }
    return snapshot.notes.filter((n) => ids.has(n.id));
  }
  return snapshot.notes.filter((n) =>
    inLocation(n, {
      neuron_id: scope.kind === "overview" ? scope.neuron : null,
      subject_id: scope.kind === "subnetwork" ? scope.subject : null,
    }),
  );
}

// Presentation history never writes organization, note membership or review scope.
// Each entry is a single one-hop view, not a recursive copy of the knowledge graph.
export class Exploration {
  presentation: Pick<FocusView, "panelWidth" | "mode" | "auxiliary"> = {};
  restoreAuxiliary?: (
    view: "create" | "library" | undefined,
    selected?: string,
  ) => void;
  scope: GraphScope = { kind: "overview", neuron: null };
  history: FocusView[] = [];
  restore?: FocusView;
  revision = 0;
  capture?: () => FocusView;
  setPresentation(
    presentation: Exploration["presentation"],
    restore: Exploration["restoreAuxiliary"],
  ) {
    this.presentation = presentation;
    this.restoreAuxiliary = restore;
  }
  private origin = "";
  sync(snapshot: Snapshot) {
    const origin = JSON.stringify([
      snapshot.root,
      snapshot.organization.location,
    ]);
    if (origin !== this.origin) {
      this.origin = origin;
      this.scope = baseScope(snapshot.organization.location);
      this.history = [];
      this.restore = undefined;
      this.revision++;
    }
    this.history = this.history
      .filter((v) => validScope(v.scope, snapshot))
      .map((v) => ({
        ...v,
        selected: snapshot.notes.some((n) => n.id === v.selected)
          ? v.selected
          : undefined,
        frame: {
          ...v.frame,
          drawer:
            v.selected && !snapshot.notes.some((n) => n.id === v.selected)
              ? 0
              : v.frame.drawer,
        },
      }));
    if (!validScope(this.scope, snapshot)) {
      const prior = this.history.pop();
      this.scope = prior?.scope ?? baseScope(snapshot.organization.location);
      this.restore = prior;
      this.revision++;
    }
  }
  enter(scope: GraphScope) {
    if (scopeKey(scope) === scopeKey(this.scope)) return false;
    const previous = this.capture?.();
    if (previous) this.history.push(previous);
    // Cycles can be explored indefinitely without unbounded memory growth.
    this.history = this.history.slice(-64);
    this.scope = scope;
    this.restore = undefined;
    this.revision++;
    return true;
  }
  enterNote(id: string): { role: SemanticRole; level: number } {
    const level =
      this.scope.kind === "topic"
        ? this.scope.note === id
          ? this.scope.level
          : Math.min(2, this.scope.level + 1)
        : 1;
    const role = level === 1 ? "topic" : "concept";
    this.enter({ kind: "topic", note: id, level });
    return { role, level };
  }
  get previous() {
    return this.history.at(-1);
  }
  back() {
    const view = this.history.pop();
    if (!view) return;
    this.scope = view.scope;
    this.restore = view;
    this.revision++;
    return view;
  }
  overview(neuron: string | null) {
    const prior = this.history.find(
      (v) => v.scope.kind === "overview" && v.scope.neuron === neuron,
    );
    this.history = [];
    this.scope = { kind: "overview", neuron };
    this.restore = prior;
    this.revision++;
  }
}
