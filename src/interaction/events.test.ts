import { afterEach, beforeEach, expect, it, vi } from "vitest";
const spy = vi.hoisted(() => ({
  play: vi.fn(),
  cancel: vi.fn(),
  mute: vi.fn(),
  dispose: vi.fn(),
  close: vi.fn(),
  created: 0,
}));
vi.mock("./audio", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./audio")>()),
  TactileSynth: class {
    play = spy.play;
    cancel = spy.cancel;
    mute = spy.mute;
    dispose = spy.dispose;
  },
}));
import { Feedback } from "./events";
import { preferences } from "./preferences";
beforeEach(() => {
  vi.clearAllMocks();
  spy.created = 0;
  preferences.update({ sound: true, volume: 0.35 });
  vi.stubGlobal(
    "AudioContext",
    class {
      state = "running";
      currentTime = 20;
      constructor() {
        spy.created++;
      }
      resume() {
        this.state = "running";
        return Promise.resolve();
      }
      close = spy.close;
    },
  );
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal(
    "document",
    Object.assign(new EventTarget(), { hidden: false, hasFocus: () => true }),
  );
});
afterEach(() => vi.unstubAllGlobals());
it("keeps startup silent and lazily reuses one context", async () => {
  const f = new Feedback(),
    detach = f.attach();
  expect(spy.created).toBe(0);
  expect(spy.play).not.toHaveBeenCalled();
  await f.unlock();
  await f.unlock();
  expect(spy.created).toBe(1);
  f.action({ kind: "select", node: "a" });
  expect(spy.play).toHaveBeenCalledTimes(1);
  detach();
  expect(spy.dispose).toHaveBeenCalledTimes(1);
  expect(spy.close).toHaveBeenCalledTimes(1);
});
it("native blur dominates DOM focus, cancels queues, and never replays a backlog", async () => {
  const f = new Feedback(),
    detach = f.attach();
  await f.unlock();
  f.action({ kind: "select", node: "a" });
  f.setNativeFocus(false);
  expect(spy.mute).toHaveBeenLastCalledWith(true, 0.35);
  f.setFocus(true);
  f.action({ kind: "select", node: "b" });
  expect(spy.play).toHaveBeenCalledTimes(1);
  f.setNativeFocus(true);
  expect(spy.play).toHaveBeenCalledTimes(1);
  f.action({ kind: "select", node: "c" });
  expect(spy.play).toHaveBeenCalledTimes(2);
  expect(spy.cancel).toHaveBeenCalled();
  detach();
});
it("sound disable cancels scheduled contacts and skips actions until reenabled", async () => {
  const f = new Feedback(),
    detach = f.attach();
  await f.unlock();
  preferences.update({ sound: false });
  f.action({ kind: "complete" });
  expect(spy.play).not.toHaveBeenCalled();
  expect(spy.cancel).toHaveBeenCalled();
  preferences.update({ sound: true });
  expect(spy.play).not.toHaveBeenCalled();
  detach();
});
it("maps a frozen arrival to the audio clock and drops stale arrivals", async () => {
  const f = new Feedback();
  await f.unlock();
  vi.spyOn(performance, "now").mockReturnValue(1000);
  const p = {
    id: "p",
    operation: "o",
    source: "a",
    target: "b",
    start: 500,
    duration: 750,
    arrival: 1250,
    color: "#fff",
    level: 0.2,
    pan: 0.1,
    subject: "s",
  };
  f.arrivals([p]);
  expect(spy.play.mock.calls[0][0].at).toBeCloseTo(20.25);
  f.arrivals([{ ...p, id: "old", arrival: 800 }]);
  expect(spy.play).toHaveBeenCalledTimes(1);
  vi.restoreAllMocks();
});
