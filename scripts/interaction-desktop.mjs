// Developer-only inspection of the actual Tauri WebView. No test hooks ship in the app.
import { chromium, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222"),
  page = browser.contexts()[0].pages()[0];
if (!page.url().includes(":1420"))
  throw Error("Run this instrumentation against the development desktop build");
const qa = JSON.parse(await readFile(".local/update-qa.json", "utf8")),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
await page.evaluate(async (root) => {
  await window.__TAURI_INTERNALS__.invoke("open_vault", { path: root });
  await window.__TAURI_INTERNALS__.invoke("organize", {
    vaultRoot: root,
    action: { kind: "select", location: { neuron_id: null, subject_id: null } },
  });
}, qa.canonicalRoot);
await page.reload();
await page.setViewportSize({ width: 1600, height: 1000 });
await expect(page.locator(".sidebar")).toBeVisible();
await page.evaluate(async () => {
  const liveModule = (path) =>
    performance
      .getEntriesByType("resource")
      .find((r) => new URL(r.name).pathname === path)?.name ?? path;
  const { GraphScene } = await import(
    liveModule("/src/interaction/graphScene.ts")
  );
  const { feedback } = await import(liveModule("/src/interaction/events.ts"));
  const { preferences } = await import(
    liveModule("/src/interaction/preferences.ts")
  );
  const motion = await import("/src/interaction/motion.ts");
  window.qa = { feedback, preferences, motion, actions: [], draws: 0 };
  feedback.subscribe((e) => {
    if (e.kind === "action") window.qa.actions.push(e.event);
  });
  const configure = GraphScene.prototype.configure,
    draw = GraphScene.prototype.draw;
  GraphScene.prototype.configure = function (...args) {
    window.qa.scene = this;
    return configure.apply(this, args);
  };
  GraphScene.prototype.draw = function (...args) {
    window.qa.draws++;
    return draw.apply(this, args);
  };
});
await page.getByLabel("Search notes", { exact: true }).fill("x");
await page.getByLabel("Search notes", { exact: true }).fill("");
await page.waitForFunction(
  () =>
    window.qa.scene &&
    !window.qa.scene.engine &&
    !window.qa.scene.motion.active &&
    !window.qa.scene.labels.active,
);
await page.waitForTimeout(500);
const idle = await page.evaluate(() => window.qa.draws);
await page.waitForTimeout(1000);
expect(await page.evaluate((before) => window.qa.draws - before, idle)).toBe(0);
await page
  .locator(".note-row")
  .filter({ hasText: "Conservation of momentum" })
  .click();
await page.waitForFunction(
  () => !!window.qa.scene.selected && !window.qa.scene.motion.active,
);
const centre = await page.evaluate(() => {
  const s = window.qa.scene,
    n = s.topology.positions.get(s.selected),
    p = s.api.graph2ScreenCoords(n.x, n.y),
    b = window.qa.motion.usable(s.view, s.motion.frame.drawer);
  return { dx: p.x - b.x - b.width / 2, dy: p.y - b.y - b.height / 2 };
});
expect(Math.abs(centre.dx)).toBeLessThan(1);
expect(Math.abs(centre.dy)).toBeLessThan(1);
expect(await page.locator(".preview h1").count()).toBe(0);
const before = await page.evaluate(() => {
  const s = window.qa.scene;
  return {
    frame: s.motion.frame,
    positions: s.topology.data.nodes.map((n) => [n.id, n.x, n.y, n.fx, n.fy]),
  };
});
const file = `${qa.root}/Physics/Conservation of momentum.md`;
await writeFile(
  file,
  (await readFile(file, "utf8")) + "\nBody-only motion check\n",
);
await expect(page.locator(".preview")).toContainText("Body-only motion check");
const after = await page.evaluate(() => {
  const s = window.qa.scene;
  return {
    frame: s.motion.frame,
    positions: s.topology.data.nodes.map((n) => [n.id, n.x, n.y, n.fx, n.fy]),
  };
});
expect(after).toEqual(before);
await page.getByRole("button", { name: "Close note", exact: true }).click();
await page.waitForTimeout(65);
await page.locator(".note-row").filter({ hasText: "Impulse" }).first().click();
await page.waitForFunction(
  () =>
    window.qa.scene.selected?.endsWith("Impulse.md") &&
    !window.qa.scene.motion.active,
);
const settled = await page.evaluate(() => window.qa.scene.motion.frame);
await page.waitForTimeout(1200);
expect(await page.evaluate(() => window.qa.scene.motion.frame)).toEqual(
  settled,
);
await page.emulateMedia({ reducedMotion: "reduce" });
await page.getByRole("button", { name: "Close note", exact: true }).click();
await page.waitForTimeout(40);
expect(await page.evaluate(() => window.qa.scene.motion.active)).toBe(false);
await page.emulateMedia({ reducedMotion: "no-preference" });
// Exercise production label state in the production Canvas while the camera is pinned.
// Constrain only the placement rectangle, then restore it; node/camera coordinates never move.
await page
  .locator(".note-row")
  .filter({ hasText: "Conservation of momentum" })
  .click();
await page.waitForFunction(() => !window.qa.scene.motion.active);
await page.waitForTimeout(400);
const forced = await page.evaluate(async () => {
  const q = window.qa,
    s = q.scene,
    frame = { ...s.motion.frame },
    n = s.topology.positions.get(s.selected),
    p = s.api.graph2ScreenCoords(n.x, n.y);
  const full = q.motion.usable(s.view, frame.drawer),
    narrow = { ...full, width: p.x - full.x + 32 };
  const nodes = s.projected(frame),
    ctx = document.querySelector(".graph canvas").getContext("2d");
  ctx.font = "400 14px Geist";
  s.labels.clear();
  s.labels.plan(
    nodes,
    full,
    (t) => ctx.measureText(t).width,
    performance.now(),
  );
  s.labels.advance(nodes, 1, true, full);
  const initial = s.labels.states.get(n.id).target;
  s.dirty = false;
  s.labels.plan(
    nodes,
    narrow,
    (t) => ctx.measureText(t).width,
    performance.now() + 400,
  );
  s.wake();
  await new Promise((resolve) => requestAnimationFrame(() => resolve()));
  const outward = s.labels.states.get(n.id).target;
  await new Promise((resolve) => setTimeout(resolve, 500));
  const middle = s.labels.states.get(n.id).theta;
  s.labels.plan(
    nodes,
    full,
    (t) => ctx.measureText(t).width,
    performance.now() + 400,
  );
  s.wake();
  const inward = s.labels.states.get(n.id).target;
  await new Promise((resolve) => setTimeout(resolve, 600));
  return {
    initial,
    outward,
    middle,
    inward,
    cameraUnchanged: JSON.stringify(frame) === JSON.stringify(s.motion.frame),
  };
});
expect(forced.initial).toBe(0);
expect(forced.outward).toBe(Math.PI);
expect(forced.inward).toBe(0);
expect(forced.cameraUnchanged).toBe(true);
const audio = await page.evaluate(async () => {
  const { NoteSynth } = await import("/src/interaction/audio.ts");
  const cases = [];
  for (const name of ["default", "dense", "cancelled", "muted"]) {
    const context = new OfflineAudioContext(2, 24000, 48000),
      synth = new NoteSynth(context, name === "dense" ? 1 : 0.35);
    const count = name === "dense" ? 30 : 1;
    let accepted = 0;
    for (let i = 0; i < count; i++)
      if (
        synth.play({
          id: `v${i}`,
          at: 0.02,
          kind: i ? "arrival" : "select",
          subject: `s${i}`,
          level: i ? 0.22 : 0.8,
        })
      )
        accepted++;
    if (name === "cancelled") synth.cancel();
    if (name === "muted") synth.mute(true, 0.35);
    const buffer = await context.startRendering();
    let peak = 0,
      squares = 0;
    const samples = buffer.getChannelData(0);
    for (const x of samples) {
      peak = Math.max(peak, Math.abs(x));
      squares += x * x;
    }
    const result = {
      name,
      peak,
      rms: Math.sqrt(squares / samples.length),
      accepted,
      remaining: synth.activeVoices,
      reservations: synth.budget.voices.size,
    };
    if (name === "default") window.qa.audition = Array.from(samples);
    synth.dispose();
    cases.push(result);
  }
  return cases;
});
for (const c of audio) {
  expect(c.peak).toBeLessThan(0.241);
  expect(c.remaining).toBe(0);
  expect(c.reservations).toBe(0);
  if (c.name === "cancelled" || c.name === "muted") expect(c.peak).toBe(0);
}
expect(audio.find((c) => c.name === "dense").accepted).toBe(6);
expect(audio[0].peak).toBeGreaterThan(0.0001);
const samples = await page.evaluate(() => window.qa.audition),
  wav = Buffer.alloc(44 + samples.length * 2);
wav.write("RIFF");
wav.writeUInt32LE(wav.length - 8, 4);
wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(48000, 24);
wav.writeUInt32LE(96000, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write("data", 36);
wav.writeUInt32LE(samples.length * 2, 40);
samples.forEach((s, i) => wav.writeInt16LE(Math.round(s * 32767), 44 + i * 2));
await writeFile(".local/tactile-production.wav", wav);
await page.getByRole("button", { name: "Preferences", exact: true }).click();
await page.getByLabel("Sound volume", { exact: true }).fill("27");
await page.getByLabel("Sound", { exact: true }).uncheck();
await page.reload();
await page.getByRole("button", { name: "Preferences", exact: true }).click();
await expect(page.getByLabel("Sound", { exact: true })).not.toBeChecked();
await expect(page.getByLabel("Sound volume", { exact: true })).toHaveValue(
  "27",
);
await page.getByLabel("Sound", { exact: true }).check();
await page.getByLabel("Sound volume", { exact: true }).fill("35");
await page
  .getByRole("button", { name: "Close preferences", exact: true })
  .click();
expect(errors).toEqual([]);
await writeFile(
  ".local/interaction-qa.json",
  JSON.stringify(
    {
      centre,
      forced,
      audio,
      checks:
        "idle, save framing, reverse motion, runtime reduced motion, forced pinned-camera flips, audio render limits and cleanup, preference reload",
      errors,
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ centre, forced, audio, errors }));
await browser.close();
