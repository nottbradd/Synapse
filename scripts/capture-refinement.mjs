// Packaged app footage, every compositor frame, original timestamps and live audio.
// No microphone, prototype, generated movement frames or application test hooks.
import { chromium, expect } from "@playwright/test";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const context = browser.contexts()[0],
  page = context.pages()[0];
const invoke = (command, args = {}) =>
  page.evaluate(
    ({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args),
    { command, args },
  );
if (!page.url().startsWith("http://tauri.localhost"))
  throw Error("Record the packaged release");
if (process.argv.includes("--prepare")) {
  const fixture = JSON.parse(
    await readFile(".local/refinement-fixture.json", "utf8"),
  );
  const root = path.join(
    tmpdir(),
    "synapse-desktop-qa",
    `film-${Date.now()}`,
    "Synapse visual verification",
  );
  await cp(fixture.root, root, {
    recursive: true,
    filter: (p) => path.basename(p) !== "flashcards.json",
  });
  const s = await invoke("open_vault", { path: root });
  await invoke("organize", {
    vaultRoot: s.root,
    action: { kind: "select", location: { neuron_id: null, subject_id: null } },
  });
  await writeFile(
    ".local/refinement-capture.json",
    JSON.stringify({ root, canonicalRoot: s.root }, null, 2),
  );
  await page.reload();
  await page.setViewportSize({ width: 1600, height: 1000 });
  await expect(page.locator(".sidebar")).toBeVisible();
  console.log(JSON.stringify({ root }));
  await browser.close();
  process.exit(0);
}
const qa = JSON.parse(await readFile(".local/refinement-capture.json", "utf8"));
await context.setOffline(false);
await page.emulateMedia({ reducedMotion: "no-preference" });
await page.setViewportSize({ width: 1600, height: 1000 });
await page.reload();
await expect(page.locator(".sidebar")).toBeVisible();
await page.waitForTimeout(1800);
await page.evaluate(() => {
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (...args) {
    const result = Reflect.apply(connect, this, args);
    if (
      args[0] === this.context.destination &&
      this.context instanceof AudioContext
    ) {
      const destination = this.context.createMediaStreamDestination();
      Reflect.apply(connect, this, [destination]);
      window.captureAudio = { destination, context: this.context };
    }
    return result;
  };
});
await page.getByRole("button", { name: "Fit graph", exact: true }).click();
await page.mouse.move(1550, 970);
await page.waitForTimeout(1000);
const focus = await invoke("plugin:window|is_focused", { label: "main" });
const audioReady = await page.evaluate(
  () => window.captureAudio?.context.state === "running",
);
if (!focus || !audioReady)
  throw Error(`Native focus/audio not ready: ${focus}/${audioReady}`);
const folder = path.resolve(".local", `refinement-frames-${Date.now()}`);
await mkdir(folder, { recursive: true });
const cdp = await context.newCDPSession(page),
  frames = [],
  writes = [],
  actions = [];
cdp.on("Page.screencastFrame", (event) => {
  void cdp.send("Page.screencastFrameAck", { sessionId: event.sessionId });
  const file = path.join(
    folder,
    `${String(frames.length).padStart(5, "0")}.jpg`,
  );
  frames.push({ file, time: event.metadata.timestamp });
  writes.push(writeFile(file, Buffer.from(event.data, "base64")));
});
await cdp.send("Page.startScreencast", {
  format: "jpeg",
  quality: 85,
  maxWidth: 1600,
  maxHeight: 1000,
  everyNthFrame: 1,
});
const start = await page.evaluate(() => {
  const recorder = new MediaRecorder(window.captureAudio.destination.stream, {
      mimeType: "audio/webm;codecs=opus",
    }),
    chunks = [];
  recorder.ondataavailable = (e) => chunks.push(e.data);
  window.captureRecording = { recorder, chunks };
  recorder.start();
  return (performance.timeOrigin + performance.now()) / 1000;
});
const mark = async (name, seconds = 0.65) => {
  const at = await page.evaluate(
    () => (performance.timeOrigin + performance.now()) / 1000,
  );
  const action = { name, at, seconds };
  actions.push(action);
  return action;
};
await page.waitForTimeout(850);
await mark("drawer opening");
await page
  .locator(".note-row")
  .filter({ hasText: "Conservation of momentum" })
  .click();
await page.waitForTimeout(1200);
await page.locator(".recall-toggle").focus();
await mark("recall reveal", 0.3);
await page.keyboard.press("Space");
await expect(page.locator(".recall-toggle")).toHaveAttribute(
  "aria-expanded",
  "true",
);
await page.waitForTimeout(1000);
// The selected node is centred by the real measured layout. This pointer path
// was separately verified to flip the label right -> left with an unchanged camera.
const centre = await page.evaluate(() => {
  const left = document.querySelector(".sidebar").getBoundingClientRect().right;
  const right =
    innerWidth -
    document.querySelector(".editor-panel").getBoundingClientRect().width -
    32;
  return { x: (left + right) / 2, y: 92 + (innerHeight - 180) / 2 };
});
await page.mouse.move(centre.x, centre.y);
await page.waitForTimeout(120);
const dragAction = await mark("pointer drag and label side change", 1.3);
await page.mouse.down();
for (let step = 1; step <= 45; step++) {
  await page.mouse.move(
    centre.x + ((1000 - centre.x) * step) / 45,
    centre.y + ((180 - centre.y) * step) / 45,
  );
  await page.waitForTimeout(16);
}
await page.mouse.up();
await page.mouse.move(1550, 970);
await page.waitForTimeout(700);
dragAction.seconds =
  (await page.evaluate(
    () => (performance.timeOrigin + performance.now()) / 1000,
  )) - dragAction.at;
await page.screenshot({ path: ".local/refinement-recorded-label.png" });
await mark("drawer closing");
await page.getByRole("button", { name: "Close note", exact: true }).click();
await page.waitForTimeout(1000);
await mark("subject focus");
await page
  .locator(".subject-row .row-name")
  .filter({ hasText: /^Physics$/ })
  .click();
await page.waitForTimeout(1400);
await mark("subject return");
await page.getByRole("button", { name: "All Neurons", exact: true }).click();
await page.waitForTimeout(1100);
await page
  .locator(".subject-row .row-name")
  .filter({ hasText: /^Physics$/ })
  .click();
await page.waitForTimeout(900);
await page.locator(".review-entry").click();
await page.waitForTimeout(700);
await page.getByRole("button", { name: /Reveal answer/ }).click();
await expect(page.locator(".ratings small")).toHaveText([
  "1 min",
  "12 hr",
  "1 day",
  "4 days",
]);
await page.waitForTimeout(900);
await mark("first successful rating", 0.4);
await page.keyboard.press("3");
await page.waitForTimeout(800);
await page.getByRole("button", { name: /Reveal answer/ }).click();
await page.waitForTimeout(700);
await mark("review completion", 0.4);
await page.keyboard.press("3");
await expect(page.getByText("Reviews complete", { exact: true })).toBeVisible();
await page.waitForTimeout(1200);
await page
  .getByRole("button", { name: "Close review", exact: true })
  .first()
  .click();
await page.getByRole("button", { name: "All Neurons", exact: true }).click();
await page.waitForTimeout(1300);
const end = await page.evaluate(async () => {
  const r = window.captureRecording,
    stop = new Promise((resolve) => (r.recorder.onstop = resolve));
  r.recorder.stop();
  await stop;
  return {
    time: (performance.timeOrigin + performance.now()) / 1000,
    bytes: Array.from(new Uint8Array(await new Blob(r.chunks).arrayBuffer())),
  };
});
await cdp.send("Page.stopScreencast");
await Promise.all(writes);
await writeFile(".local/Synapse-0.3.1-audio.webm", Buffer.from(end.bytes));
const selected = frames.filter((f) => f.time >= start && f.time < end.time);
if (!selected.length) throw Error("No source frames");
const preceding =
  frames.filter((f) => f.time < start).at(-1) ?? selected.shift();
const timeline = [
  { ...preceding, time: start },
  ...selected,
  { ...selected.at(-1), time: end.time },
];
let concat = "ffconcat version 1.0\n";
for (let i = 0; i < timeline.length; i++) {
  concat += `file '${timeline[i].file.replaceAll("\\", "/")}'\noption framerate 1000\n`;
  if (i < timeline.length - 1)
    concat += `duration ${Math.max(0.001, timeline[i + 1].time - timeline[i].time)}\n`;
}
await writeFile(".local/refinement-capture.ffconcat", concat);
const cadence = actions.map((a) => {
  const times = frames
    .filter((f) => f.time >= a.at && f.time < a.at + a.seconds)
    .map((f) => f.time);
  const gaps = times
    .slice(1)
    .map((t, i) => (t - times[i]) * 1000)
    .sort((a, b) => a - b);
  const percentile = (p) =>
    gaps[Math.min(gaps.length - 1, Math.floor(p * gaps.length))] ?? null;
  return {
    ...a,
    at: a.at - start,
    frames: times.length,
    framesPerSecond:
      times.length > 1 ? (times.length - 1) / (times.at(-1) - times[0]) : 0,
    medianGapMs: percentile(0.5),
    p95GapMs: percentile(0.95),
  };
});
const changedFrames = [];
let previousHash;
for (const frame of frames) {
  const hash = createHash("sha256")
    .update(await readFile(frame.file))
    .digest("hex");
  if (hash !== previousHash) changedFrames.push(frame);
  previousHash = hash;
}
for (const action of cadence) {
  const times = changedFrames
    .filter(
      (f) =>
        f.time >= start + action.at &&
        f.time < start + action.at + action.seconds,
    )
    .map((f) => f.time);
  action.changedFrames = times.length;
  action.changedFramesPerSecond =
    times.length > 1 ? (times.length - 1) / (times.at(-1) - times[0]) : 0;
}
const report = {
  url: page.url(),
  fixture: qa.root,
  start,
  end: end.time,
  duration: end.time - start,
  sourceFrames: frames.length,
  consecutiveUniqueFrames: changedFrames.length,
  identicalConsecutiveFrames: frames.length - changedFrames.length,
  timestampsMonotonic: frames.every(
    (frame, i) => i === 0 || frame.time > frames[i - 1].time,
  ),
  everyNthFrame: 1,
  audioBytes: end.bytes.length,
  nativeFocused: focus,
  encoding:
    "Variable frame rate from original compositor timestamps; no interpolated motion frames",
  cadence,
};
await writeFile(
  ".local/refinement-capture-report.json",
  JSON.stringify(report, null, 2),
);
await writeFile(
  ".local/refinement-frame-timestamps.json",
  JSON.stringify(frames, null, 2),
);
console.log(JSON.stringify(report));
await page.reload();
await browser.close();
