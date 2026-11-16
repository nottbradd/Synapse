import { describe, expect, it, vi } from "vitest";
import {
  LayoutMotion,
  cameraCentre,
  fitFrame,
  frameFromCamera,
  project,
  stepSpring,
  usable,
} from "./motion";
import { AnimatedLabels, labelOffset, SelectionRings } from "./labels";
import { planSignals, SignalTimeline } from "./signals";
import { VoiceBudget, subjectRegister } from "./audio";
import {
  PreferenceStore,
  PREFERENCE_KEY,
  decodePreferences,
  resolveReducedMotion,
} from "./preferences";
import { TextMeasurements, watchFonts, LABEL_FONT } from "./fonts";
import {
  compositionNodes,
  GraphTopology,
  nodeScreenRadius,
  type SceneNode,
} from "./topology";
import { omitLeadingTitle } from "../components/Markdown";
import type { Root } from "mdast";
import type { Snapshot } from "../types";
const view = { width: 1600, height: 900, left: 296 },
  origin = { x: 0, y: 0, zoom: 1, drawer: 0 };
it("retires radius animation even for hidden labels after zoom settles", () => {
  const labels = new AnimatedLabels(),
    bounds = { x: 0, y: 0, width: 1000, height: 600 },
    n = { id: "a", x: 500, y: 300, radius: 5, title: "A", priority: 1000 };
  labels.plan([n], bounds, (t) => t.length * 7, 0);
  labels.plan([{ ...n, priority: 0 }], bounds, (t) => t.length * 7, 100);
  labels.advance([{ ...n, radius: 8 }], 1, true, bounds);
  expect(labels.active).toBe(false);
});
it("does not let a distant future gate suppress an earlier direct contact", () => {
  const budget = new VoiceBudget(),
    v = { id: "later", key: "select:s", at: 10, end: 10.14, priority: 10 };
  expect(budget.reserve(v).accepted).toBe(true);
  expect(budget.reserve({ ...v, id: "now", at: 0, end: 0.14 }).accepted).toBe(
    true,
  );
});
describe("one layout clock", () => {
  it.each([false, true])(
    "gives a selected label a clear side even for shallow overlaps (previously hidden: %s)",
    (previouslyHidden) => {
      const labels = new AnimatedLabels(),
        bounds = { x: 0, y: 0, width: 1000, height: 600 };
      const selected = {
        id: "selected",
        title: "Conservation of momentum",
        x: 500,
        y: 250,
        radius: 5,
        priority: 1000,
      };
      const obstacle = {
        id: "other",
        title: "Other",
        x: 550,
        y: 237,
        radius: 3,
        priority: 0,
      };
      if (previouslyHidden) {
        labels.plan(
          [{ ...selected, priority: 100 }, obstacle],
          bounds,
          (t) => t.length * 7,
          0,
        );
        expect(labels.states.get("selected")!.show).toBe(false);
      }
      labels.plan([selected, obstacle], bounds, (t) => t.length * 7, 1000);
      expect(labels.states.get("selected")!.target).toBe(Math.PI);
      expect(
        labels
          .advance([selected, obstacle], 1, true, bounds)
          .some((l) => l.id === "selected"),
      ).toBe(true);
    },
  );
  it("starts from rest and converges monotonically without secondary drift", () => {
    const m = new LayoutMotion(origin, 0),
      target = { x: 200, y: 90, zoom: 2, drawer: 480 };
    m.retarget(target, 0);
    expect(m.frame).toEqual(origin);
    expect(Object.values(m.velocities)).toEqual([0, 0, 0, 0]);
    let last = 0;
    for (let t = 16; t < 2000; t += 16) {
      const f = m.advance(t);
      expect(f.x).toBeGreaterThanOrEqual(last);
      expect(f.x).toBeLessThanOrEqual(200);
      last = f.x;
    }
    expect(m.active).toBe(false);
    expect(m.advance(60000)).toEqual(target);
  });
  it("coordinates drawer and camera with log zoom and continuous interruption", () => {
    const m = new LayoutMotion(origin, 0);
    m.retarget({ x: 200, y: 100, zoom: 4, drawer: 500 }, 0);
    const f = m.advance(75),
      v = m.velocities;
    expect(f.x / 200).toBeCloseTo(f.drawer / 500, 10);
    expect(Math.log(f.zoom) / Math.log(4)).toBeCloseTo(f.x / 200, 10);
    m.retarget(origin, 75);
    expect(m.frame).toEqual(f);
    expect(m.velocities).toEqual(v);
    m.advance(2000);
    expect(m.frame).toEqual(origin);
  });
  it("is independent of refresh rate and handles a long paused frame", () => {
    const a = stepSpring({ value: 0, target: 100, velocity: 0 }, 0.1);
    let b = { value: 0, target: 100, velocity: 0 };
    for (let i = 0; i < 10; i++) b = stepSpring(b, 0.01);
    expect(a.value).toBeCloseTo(b.value, 10);
    expect(stepSpring(a, 60).value).toBe(100);
  });
  it("centres in the measured uncovered rectangle at any zoom or drawer width", () => {
    for (const width of [900, 1600, 2400])
      for (const drawer of [0, 320, 600]) {
        const v = { ...view, width },
          f = { x: 123, y: -70, zoom: 1.4, drawer };
        const p = project(f, f, v),
          b = usable(v, drawer);
        expect(p.x).toBe(b.x + b.width / 2);
        expect(p.y).toBe(b.y + b.height / 2);
        expect(
          frameFromCamera(cameraCentre(f, v), f.zoom, drawer, v).x,
        ).toBeCloseTo(f.x);
      }
  });
  it("reduced motion uses the exact same destination immediately", () => {
    const m = new LayoutMotion(origin);
    m.retarget({ x: 15, y: 17, zoom: 1.8, drawer: 480 }, 100);
    expect(m.advance(150, true)).toEqual(m.destination);
    expect(m.active).toBe(false);
  });
  it("fit all includes extreme orphans while cluster framing can ignore outliers", () => {
    const points = Array.from({ length: 30 }, (_, i) => ({
      x: i * 10,
      y: i * 5,
    }));
    points.push({ x: 9000, y: 8000 });
    const all = fitFrame(points, view, 0),
      core = fitFrame(points, view, 0, true);
    expect(core.zoom).toBeGreaterThan(all.zoom * 5);
    for (const p of points) {
      const s = project(p, all, view),
        b = usable(view, 0);
      expect(s.x).toBeGreaterThan(b.x);
      expect(s.x).toBeLessThan(b.x + b.width);
    }
  });
});
describe("persistent node-relative labels", () => {
  const measure = (t: string) => t.length * 7,
    node = {
      id: "a",
      title: "Conservation of momentum",
      x: 500,
      y: 250,
      radius: 5,
      priority: 1000,
    },
    wide = { x: 0, y: 0, width: 900, height: 500 },
    narrow = { ...wide, width: 570 };
  it("forces both side changes with a pinned camera and traverses the upper arc", () => {
    const labels = new AnimatedLabels();
    labels.plan([node], wide, measure, 0);
    labels.advance([node], 1, true, wide);
    expect(labels.states.get("a")!.target).toBe(0);
    labels.plan([node], narrow, measure, 400);
    expect(labels.states.get("a")!.target).toBe(Math.PI);
    for (let i = 0; i < 40; i++) {
      labels.advance([node], 0.016, false, wide);
      const l = labels.states.get("a")!;
      expect(l.oy).toBeLessThanOrEqual(0);
      const o = labelOffset(l.theta, l.radius, l.width, l.height);
      expect(
        Math.abs(o.x) > l.width / 2 + node.radius ||
          Math.abs(o.y) > l.height / 2 + node.radius,
      ).toBe(true);
    }
    labels.plan([node], wide, measure, 1100);
    expect(labels.states.get("a")!.target).toBe(0);
    labels.advance([node], 0.03, false, wide);
    expect(labels.states.get("a")!.oy).toBeLessThan(0);
  });
  it("enforces 300ms hysteresis and 30px restoration clearance", () => {
    const labels = new AnimatedLabels();
    labels.plan([node], narrow, measure, 0);
    expect(labels.states.get("a")!.target).toBe(Math.PI);
    labels.plan([node], wide, measure, 150);
    expect(labels.states.get("a")!.target).toBe(Math.PI);
    labels.plan([node], { ...wide, width: 700 }, measure, 400);
    expect(labels.states.get("a")!.target).toBe(Math.PI);
    labels.plan([node], wide, measure, 500);
    expect(labels.states.get("a")!.target).toBe(0);
  });
  it("follows camera projection exactly, keeping only relative offsets smoothed", () => {
    const labels = new AnimatedLabels();
    labels.plan([node], wide, measure, 0);
    const a = labels.advance([node], 1, true, wide)[0],
      b = labels.advance([{ ...node, x: 520, y: 260 }], 0, false, wide)[0];
    expect(b.x - a.x).toBe(20);
    expect(b.y - a.y).toBe(10);
    expect(b.ox).toBe(a.ox);
  });
  it("uses time-based angular smoothing and immediate reduced motion", () => {
    const a = new AnimatedLabels(),
      b = new AnimatedLabels();
    for (const l of [a, b]) l.plan([node], narrow, measure, 0);
    a.advance([node], 0.032, false, wide);
    b.advance([node], 0.016, false, wide);
    b.advance([node], 0.016, false, wide);
    expect(a.states.get("a")!.theta).toBeCloseTo(b.states.get("a")!.theta, 10);
    a.advance([node], 0, true, wide);
    expect(a.states.get("a")!.theta).toBe(Math.PI);
  });
  it("preserves selected label width across selection and retires removed nodes", () => {
    const l = new AnimatedLabels();
    l.plan([{ ...node, priority: 200 }], wide, measure, 0);
    const width = l.states.get("a")!.width;
    l.plan([node], wide, measure, 400);
    expect(l.states.get("a")!.width).toBe(width);
    l.plan([], wide, measure, 800);
    expect(l.states.size).toBe(0);
  });
  it("rings fade in and out with separate durations", () => {
    const r = new SelectionRings();
    r.select("a", 0);
    expect(r.value("a", 0)).toBe(0);
    expect(r.value("a", 150)).toBe(1);
    r.select(undefined, 150);
    expect(r.value("a", 250)).toBeCloseTo(0.5);
    expect(r.value("a", 350)).toBe(0);
  });
});
describe("planned edge signals", () => {
  const nodes = [
      { id: "a", x: 0, y: 0, subject_id: "s" },
      { id: "b", x: 90, y: 0, subject_id: "s" },
      { id: "c", x: 270, y: 0, subject_id: "s" },
      { id: "outside", x: 5000, y: 0, subject_id: "s" },
    ],
    edges = [
      { source: "a", target: "b" },
      { source: "a", target: "c" },
      { source: "a", target: "outside" },
    ];
  it("shares frozen arrival timestamps and derives different durations from actual edges", () => {
    const p = planSignals(
      "op",
      "a",
      nodes,
      edges,
      origin,
      view,
      usable(view, 0),
      100,
      new Map(),
    );
    expect(p).toHaveLength(2);
    expect(p[0].duration).toBeCloseTo((90 / 560) * 1000);
    expect(p[1].duration).toBeGreaterThan((270 / 560) * 1000);
    expect(p[1].duration).toBeLessThan(510);
    expect(p.map((p) => p.start)).toEqual([100, 118]);
    expect(p.every((p) => p.arrival === p.start + p.duration)).toBe(true);
  });
  it("cancels removed or hidden targets without changing other arrival timestamps", () => {
    const t = new SignalTimeline(),
      p = planSignals(
        "op",
        "a",
        nodes,
        edges,
        origin,
        view,
        usable(view, 0),
        100,
        new Map(),
      );
    t.replace(p);
    expect(t.prune(300, new Set(["a", "c"]))).toEqual(["op:b"]);
    expect(t.packets[0].arrival).toBe(p[1].arrival);
    expect(t.cancel()).toEqual(["op:c"]);
    expect(t.packets).toEqual([]);
  });
  it("bounds hub packets and never invents an edge", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      id: `n${i}`,
      x: i + 30,
      y: 0,
      subject_id: "s",
    }));
    const p = planSignals(
      "op",
      "a",
      [nodes[0], ...many],
      many.map((n) => ({ source: "a", target: n.id })),
      origin,
      view,
      usable(view, 0),
      0,
      new Map(),
    );
    expect(p).toHaveLength(12);
    expect(
      planSignals(
        "op",
        "a",
        nodes,
        [],
        origin,
        view,
        usable(view, 0),
        0,
        new Map(),
      ),
    ).toEqual([]);
  });
});
describe("voice reservations and preferences", () => {
  const voice = (id: string, at = 0, priority = 1) => ({
    id,
    at,
    end: at + 0.14,
    key: id,
    priority,
  });
  it("caps concurrent contacts at six and gives direct feedback priority", () => {
    const b = new VoiceBudget();
    for (let i = 0; i < 6; i++)
      expect(b.reserve(voice(`a${i}`)).accepted).toBe(true);
    expect(b.reserve(voice("extra")).accepted).toBe(false);
    const direct = b.reserve(voice("direct", 0, 10));
    expect(direct.accepted).toBe(true);
    expect(direct.evicted).toHaveLength(1);
    expect(b.voices.size).toBe(6);
  });
  it("gates identical contacts for at least 60ms", () => {
    const b = new VoiceBudget();
    expect(b.reserve(voice("a")).accepted).toBe(true);
    expect(b.reserve({ ...voice("b", 0.059), key: "a" }).accepted).toBe(false);
    expect(b.reserve({ ...voice("c", 0.061), key: "a" }).accepted).toBe(true);
  });
  it("future reservations do not erase current voices or defeat the current cap", () => {
    const b = new VoiceBudget();
    for (let i = 0; i < 6; i++) b.reserve(voice(`a${i}`));
    b.reserve(voice("future", 1));
    expect(b.voices.size).toBe(7);
    expect(b.reserve(voice("now")).accepted).toBe(false);
    b.clear();
    expect(b.voices.size).toBe(0);
  });
  it("register follows stable identity rather than display name", () => {
    expect(subjectRegister("uuid-1")).toBe(subjectRegister("uuid-1"));
    expect(subjectRegister("uuid-1")).not.toBe(subjectRegister("uuid-2"));
  });
  it("persists independently and preserves malformed input until an explicit update", () => {
    const values = new Map([[PREFERENCE_KEY, "malformed"]]),
      storage = {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => {
          values.set(key, value);
        },
      };
    const a = new PreferenceStore(storage);
    expect(values.get(PREFERENCE_KEY)).toBe("malformed");
    a.update({ sound: false, volume: 0.21 });
    expect(new PreferenceStore(storage).get()).toEqual({
      schema_version: 1,
      sound: false,
      volume: 0.21,
      motion: "system",
      startupAnimation: true,
    });
    expect(decodePreferences('{"schema_version":99}').volume).toBe(0.7);
  });
  it("migrates existing sound settings without changing them or writing storage", () => {
    const raw = '{"schema_version":1,"sound":false,"volume":0.17}';
    const storage = { getItem: () => raw, setItem: vi.fn() };
    const store = new PreferenceStore(storage);
    expect(store.get()).toEqual({
      schema_version: 1,
      sound: false,
      volume: 0.17,
      motion: "system",
      startupAnimation: true,
    });
    expect(storage.setItem).not.toHaveBeenCalled();
    store.update({ motion: "full" });
    expect(JSON.parse(storage.setItem.mock.calls[0][1])).toEqual({
      schema_version: 1,
      sound: false,
      volume: 0.17,
      motion: "full",
      startupAnimation: true,
    });
  });
  it.each([
    ["system", true, true],
    ["system", false, false],
    ["full", true, false],
    ["full", false, false],
    ["reduced", true, true],
    ["reduced", false, true],
  ] as const)(
    "resolves %s with Windows reduced motion %s to %s",
    (motion, system, expected) => {
      expect(resolveReducedMotion(motion, system)).toBe(expected);
    },
  );
  it("preserves sound when an unknown motion value falls back to Windows", () => {
    expect(
      decodePreferences(
        '{"schema_version":1,"sound":false,"volume":0.2,"motion":"invalid"}',
      ),
    ).toEqual({
      schema_version: 1,
      sound: false,
      volume: 0.2,
      motion: "system",
      startupAnimation: true,
    });
  });
});
describe("font and data stability", () => {
  it("changes only visibility for settled scope transitions, but lays out actual new topology", () => {
    const s = {
      organization: {
        location: { neuron_id: null, subject_id: null },
        subjects: [{ id: "a" }, { id: "b" }],
      },
      notes: [
        { id: "one", subject_id: "a" },
        { id: "two", subject_id: "b" },
      ],
      edges: [],
    } as unknown as Snapshot;
    const topology = new GraphTopology();
    topology.update(s);
    expect(topology.layoutChanged).toBe(true);
    const positions = [...topology.positions.values()];
    topology.update({
      ...s,
      organization: {
        ...s.organization,
        location: { neuron_id: null, subject_id: "a" },
      },
    });
    expect(topology.layoutChanged).toBe(false);
    topology.update(s);
    expect(topology.layoutChanged).toBe(false);
    expect(topology.data.nodes).toEqual(positions);
    topology.update({ ...s, edges: [{ source: "one", target: "two" }] });
    expect(topology.layoutChanged).toBe(true);
  });
  it("does not reserve cluster space for empty subjects or move anchors on rename", () => {
    const s = {
      organization: {
        location: { neuron_id: null, subject_id: null },
        subjects: [{ id: "empty" }, { id: "occupied", name: "Physics" }],
      },
      notes: [{ id: "a", subject_id: "occupied", neighbors: 3 }],
      edges: [],
    } as unknown as Snapshot;
    const topology = new GraphTopology();
    topology.update(s);
    expect(topology.anchors.size).toBe(1);
    expect(topology.anchors.get("occupied")).toEqual({ x: 0, y: 0 });
    const original = { ...topology.positions.get("a") };
    topology.update({
      ...s,
      organization: {
        ...s.organization,
        subjects: s.organization.subjects.map((v) => ({
          ...v,
          name: "Renamed",
        })),
      },
    });
    expect(topology.positions.get("a")).toEqual(original);
  });
  it("keeps small subjects in the composition while bounding large-cluster outliers", () => {
    const core = Array.from({ length: 40 }, (_, i) => ({
      id: `n${i}`,
      subject_id: "large",
      x: i * 10,
      y: i * 4,
    })) as SceneNode[];
    const lone = {
      id: "minor",
      subject_id: "small",
      x: 450,
      y: 400,
    } as SceneNode;
    const outlier = {
      id: "outlier",
      subject_id: "large",
      x: 10000,
      y: 10000,
    } as SceneNode;
    const framed = compositionNodes([...core, lone, outlier]);
    expect(framed).toContain(lone);
    expect(framed).not.toContain(outlier);
    expect(fitFrame(framed, view, 0).zoom).toBeGreaterThan(
      fitFrame([...core, lone, outlier], view, 0).zoom * 10,
    );
  });
  it("keeps overview nodes legible and hub growth bounded across zoom levels", () => {
    const leaf = { neighbors: 0 } as SceneNode,
      hub = { neighbors: 10000 } as SceneNode;
    for (const zoom of [0.1, 0.4, 1, 2, 6]) {
      expect(nodeScreenRadius(leaf, zoom)).toBeGreaterThan(2.9);
      expect(nodeScreenRadius(hub, zoom)).toBeGreaterThan(
        nodeScreenRadius(leaf, zoom),
      );
      expect(nodeScreenRadius(hub, zoom)).toBeLessThan(12);
    }
  });
  it("waits for fonts and invalidates the old Canvas measurements on completion", async () => {
    const fonts = new EventTarget();
    Object.assign(fonts, { load: vi.fn().mockResolvedValue([]) });
    vi.stubGlobal("document", { fonts });
    const m = new TextMeasurements(),
      changed = vi.fn(),
      ctx = { measureText: vi.fn().mockReturnValue({ width: 42 }) };
    m.width(ctx, LABEL_FONT, "IPA əʃ");
    m.width(ctx, LABEL_FONT, "IPA əʃ");
    expect(ctx.measureText).toHaveBeenCalledTimes(1);
    const clean = watchFonts(m, changed);
    expect(m.ready).toBe(false);
    await vi.waitFor(() => expect(m.ready).toBe(true));
    m.width(ctx, LABEL_FONT, "IPA əʃ");
    expect(ctx.measureText).toHaveBeenCalledTimes(2);
    fonts.dispatchEvent(new Event("loadingdone"));
    expect(changed).toHaveBeenCalledTimes(2);
    clean();
    vi.unstubAllGlobals();
  });
  it("retains graph objects, pins, and topology for a body-only revision", () => {
    const s = {
      organization: {
        location: { neuron_id: null, subject_id: null },
        subjects: [{ id: "s", name: "Physics" }],
      },
      notes: [{ id: "a", subject_id: "s", title: "A", revision: "1" }],
      edges: [],
    } as unknown as Snapshot;
    const topology = new GraphTopology(),
      data = topology.update(s);
    Object.assign(data.nodes[0], { x: 30, y: 40, fx: 30, fy: 40 });
    const updated = topology.update({
      ...s,
      notes: s.notes.map((n) => ({ ...n, revision: "2" })),
    });
    expect(updated).toBe(data);
    expect(updated.nodes[0].x).toBe(30);
    expect(updated.nodes[0].fx).toBe(30);
    expect(updated.nodes[0].revision).toBe("2");
  });
  it("suppresses only a matching leading H1 in the presentation tree", () => {
    const tree: Root = {
      type: "root",
      children: [
        {
          type: "heading",
          depth: 1,
          children: [{ type: "text", value: "Title" }],
        },
        { type: "paragraph", children: [{ type: "text", value: "Body" }] },
      ],
    };
    const other = structuredClone(tree);
    omitLeadingTitle("Title")()(tree);
    expect(tree.children[0].type).toBe("paragraph");
    omitLeadingTitle("Different")()(other);
    expect(other.children[0].type).toBe("heading");
  });
});
