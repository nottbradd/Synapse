// Capture the installed app's first foreground presentation from a new native
// process started to the tray. No replacement UI or frontend reload/replay.
// Requires a disposable vault and temporarily enabled background mode. The
// caller backs up/restores owner settings; this script never calls a provider.
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
const name = process.argv[2] ?? "restored";
const existing = process.argv.includes("--existing");
const visible = process.argv.includes("--visible");
const executable = path.join(
  process.env.LOCALAPPDATA,
  "Synapse",
  "synapse.exe",
);
const out = path.resolve(`.local/release-0.7.0/startup-${name}`);
await mkdir(out, { recursive: true });
if (!existing)
  spawn(executable, visible ? [] : ["--background"], {
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9222",
    },
    detached: true,
    stdio: "ignore",
  }).unref();
let ready = false;
for (let i = 0; i < 120; i++) {
  try {
    ready = (await fetch("http://127.0.0.1:9222/json/version")).ok;
  } catch {
    /* WebView is starting. */
  }
  if (ready) break;
  await new Promise((resolve) => setTimeout(resolve, 100));
}
assert.ok(ready, "Installed WebView debug connection");
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const context = browser.contexts()[0],
  page = context.pages()[0];
await page.waitForFunction(() => !!window.__TAURI_INTERNALS__?.invoke);
const invoke = (command, args = {}) =>
  page.evaluate(
    ({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args),
    { command, args },
  );
await page.waitForSelector(name === "welcome" ? ".welcome" : ".sidebar", {
  state: "attached",
});
assert.equal(page.url(), "http://tauri.localhost/");
assert.equal(await invoke("plugin:app|version"), "0.7.0");
if (!existing && !visible)
  assert.equal(
    await invoke("plugin:window|is_visible", { label: "main" }),
    false,
  );
if (!visible) assert.equal(await page.locator(".swarm-overlay").count(), 0);
const prefs = await page.evaluate(() =>
  localStorage.getItem("synapse.preferences.v1"),
);
await page.evaluate(() => {
  window.startupAudioContexts = 0;
  if (window.originalAudioContext)
    window.AudioContext = window.originalAudioContext;
  window.originalAudioContext = window.AudioContext;
  window.AudioContext = new Proxy(window.AudioContext, {
    construct(target, args, receiver) {
      window.startupAudioContexts++;
      return Reflect.construct(target, args, receiver);
    },
  });
});
const cdp = await context.newCDPSession(page),
  frames = [],
  writes = [];
cdp.on("Page.screencastFrame", (e) => {
  void cdp.send("Page.screencastFrameAck", { sessionId: e.sessionId });
  const file = path.join(out, `${String(frames.length).padStart(5, "0")}.jpg`);
  frames.push({ file, time: e.metadata.timestamp });
  writes.push(writeFile(file, Buffer.from(e.data, "base64")));
});
await cdp.send("Page.startScreencast", {
  format: "jpeg",
  quality: 95,
  maxWidth: 1800,
  maxHeight: 1200,
  everyNthFrame: 1,
});
const requested = Date.now() / 1000;
// The existing single-instance handler shows/focuses the hidden native window.
if (!existing && !visible)
  spawn(executable, [], { detached: true, stdio: "ignore" }).unref();
console.log("Recording armed; waiting for genuine native foreground.");
await page.waitForFunction(
  () => performance.getEntriesByName("synapse.startup").length > 0,
  undefined,
  { timeout: 600000 },
);
await page.waitForTimeout(1200);
const result = await page.evaluate(() => ({
  timeOrigin: performance.timeOrigin,
  at: performance.now(),
  marks: performance
    .getEntriesByType("mark")
    .filter((e) => e.name.startsWith("synapse.startup"))
    .map((e) => ({ name: e.name, time: e.startTime, detail: e.detail })),
  measures: performance
    .getEntriesByName("synapse.startup")
    .map((e) => e.toJSON()),
  overlay: document.querySelectorAll(".swarm-overlay").length,
  hidden: document.querySelectorAll('[data-swarm-hidden="true"]').length,
  audioContexts: window.startupAudioContexts,
  heading: document.querySelector(".graph-heading h1, .welcome h1")
    ?.textContent,
  width: innerWidth,
  height: innerHeight,
  preferences: localStorage.getItem("synapse.preferences.v1"),
}));
await cdp.send("Page.stopScreencast");
await Promise.all(writes);
await page.evaluate(() => {
  window.AudioContext = window.originalAudioContext;
});
const report = {
  name,
  requested,
  ...result,
  frames,
  version: await invoke("plugin:app|version"),
  nativeFocus: await invoke("plugin:window|is_focused", { label: "main" }),
  replayClaim: await invoke("claim_startup"),
};
await writeFile(path.join(out, "report.json"), JSON.stringify(report, null, 2));
assert.ok(
  result.marks.at(-1).name.endsWith("complete"),
  JSON.stringify(result.marks),
);
assert.ok(
  result.measures.at(-1).duration >= 900 &&
    result.measures.at(-1).duration <= 1200,
);
assert.equal(result.overlay, 0);
assert.equal(result.hidden, 0);
assert.equal(result.audioContexts, 0);
assert.equal(result.preferences, prefs);
assert.equal(report.replayClaim.granted, false);
assert.ok(frames.length > 10);
const foreground =
  (result.timeOrigin + result.measures.at(-1).startTime) / 1000;
const end = (result.timeOrigin + result.marks.at(-1).time) / 1000 + 0.7;
const start = foreground - 0.08;
const ordered = [...frames]
  .sort((a, b) => a.time - b.time)
  .filter((f, i, all) => !i || f.time !== all[i - 1].time);
const prior = ordered.filter((f) => f.time <= start).at(-1);
const timeline = [
  ...(prior ? [{ ...prior, time: start }] : []),
  ...ordered.filter((f) => f.time > start && f.time < end),
];
const concat = ["ffconcat version 1.0"];
timeline.forEach((f, i) => {
  concat.push(
    `file '${f.file.replaceAll("\\", "/")}'`,
    "option framerate 1000",
    `duration ${Math.max(0.001, (timeline[i + 1]?.time ?? end) - f.time).toFixed(6)}`,
  );
});
concat.push(
  `file '${timeline.at(-1).file.replaceAll("\\", "/")}'`,
  "option framerate 1000",
);
await writeFile(path.join(out, "frames.ffconcat"), concat.join("\n") + "\n");
await page.reload();
await page.waitForSelector(name === "welcome" ? ".welcome" : ".sidebar");
await page.waitForTimeout(1300);
assert.equal(await page.locator(".swarm-overlay").count(), 0);
const replay = await page.evaluate(() =>
  performance
    .getEntriesByType("mark")
    .filter((e) => e.name.startsWith("synapse.startup"))
    .map((e) => e.name),
);
assert.ok(
  replay.some((n) => n.endsWith("already-presented")),
  JSON.stringify(replay),
);
await writeFile(
  path.join(out, "reload.json"),
  JSON.stringify({ replay, cleaned: true }, null, 2),
);
console.log(
  JSON.stringify(
    {
      name,
      frames: frames.length,
      duration: result.measures.at(-1).duration,
      targets: result.marks.find((m) => m.name.endsWith("snapshot"))?.detail,
      silent: result.audioContexts === 0,
      reloadedWithoutReplay: true,
      out,
    },
    null,
    2,
  ),
);
await browser.close();
