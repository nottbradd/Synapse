import { expect, it } from "vitest";
import { curve, graphemes, SWARM } from "./geometry";
import {
  decodePreferences,
  DEFAULT_PREFERENCES,
} from "../interaction/preferences";
it("keeps combining marks and multi-codepoint emoji together", () => {
  expect(graphemes("A👩🏽‍💻é🇦🇺")).toEqual(["A", "👩🏽‍💻", "é", "🇦🇺"]);
});
it("settles exactly and stays independent of frame rate", () => {
  const a = { x: 20, y: 30 },
    b = { x: 500, y: 600 };
  expect(curve(a, b, 0)).toEqual(a);
  expect(curve(a, b, 1).x).toBeCloseTo(b.x);
  expect(curve(a, b, 1).y).toBeCloseTo(b.y);
  expect(curve(a, b, 800 / 1000)).toEqual(curve(a, b, 48 / 60));
  expect(SWARM.end).toBeLessThan(SWARM.deadline);
  expect(SWARM.targets).toBeLessThanOrEqual(SWARM.hardCap);
});
it("defaults new profiles to 70% while retaining every saved low/zero/owner volume", () => {
  expect(DEFAULT_PREFERENCES.volume).toBe(0.7);
  for (const volume of [0, 0.01, 0.17, 0.69, 1]) {
    const old = { schema_version: 1, sound: false, volume, motion: "full" };
    expect(decodePreferences(JSON.stringify(old))).toEqual({
      ...old,
      startupAnimation: true,
      returnAnimation: true,
    });
    expect(
      decodePreferences(JSON.stringify({ ...old, startupAnimation: false }))
        .startupAnimation,
    ).toBe(false);
    expect(
      decodePreferences(JSON.stringify({ ...old, returnAnimation: false }))
        .returnAnimation,
    ).toBe(false);
  }
});
