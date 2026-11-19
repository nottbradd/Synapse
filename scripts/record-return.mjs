// Observe one genuine native focus cycle. This script never synthesizes focus
// events; use Alt-Tab (human or Windows input automation) after it is armed.
import { chromium } from "@playwright/test";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import assert from "node:assert/strict";
const { version } = JSON.parse(await readFile("package.json", "utf8"));
const out = path.resolve(`.local/release-${version}/return`);
await mkdir(out, { recursive: true });
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222", {
    noDefaults: true,
  }),
  context = browser.contexts()[0],
  page = context.pages()[0];
const invoke = (command, args = {}) =>
  page.evaluate(
    ({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args),
    { command, args },
  );
assert.equal(await invoke("plugin:app|version"), version);
assert.equal(page.url(), "http://tauri.localhost/");
await page.waitForFunction(
  () => document.hasFocus() && !document.hidden,
  undefined,
  { timeout: 600000 },
);
assert.equal(await invoke("plugin:window|is_focused", { label: "main" }), true);
await page.waitForTimeout(1600);
const state = () =>
  page.evaluate(() => {
    const selection = window.getSelection();
    const nodePath = (node) => {
      const path = [];
      while (node?.parentNode && node !== document.body) {
        path.unshift(Array.from(node.parentNode.childNodes).indexOf(node));
        node = node.parentNode;
      }
      return path;
    };
    return {
      heading: document.querySelector(".graph-heading h1")?.textContent,
      editor: document.querySelector(".cm-content")?.textContent,
      scroll: Array.from(
        document.querySelectorAll(".cm-scroller,.hierarchy"),
      ).map((e) => ({ top: e.scrollTop, left: e.scrollLeft })),
      selection: selection
        ? {
            text: selection.toString(),
            anchor: nodePath(selection.anchorNode),
            anchorOffset: selection.anchorOffset,
            focus: nodePath(selection.focusNode),
            focusOffset: selection.focusOffset,
          }
        : null,
      focusedElement: nodePath(document.activeElement),
      preferences: localStorage.getItem("synapse.preferences.v1"),
    };
  });
const before = await state();
const canvas = () =>
  page
    .locator(".force-graph-container canvas")
    .first()
    .evaluate((c) => c.toDataURL());
const beforeCanvas = await canvas(),
  baseline = await page.evaluate(
    () => performance.getEntriesByName("synapse.return").length,
  );
await page.evaluate(() => {
  window.returnAudioContexts = 0;
  const Original = window.AudioContext;
  window.returnOriginalAudio = Original;
  window.AudioContext = new Proxy(Original, {
    construct(target, args, receiver) {
      window.returnAudioContexts++;
      return Reflect.construct(target, args, receiver);
    },
  });
  window.returnFocusLog = [];
  window.returnFocusListener = () =>
    window.returnFocusLog.push({
      at: performance.now(),
      focused: document.hasFocus(),
      hidden: document.hidden,
    });
  window.addEventListener("focus", window.returnFocusListener);
  window.addEventListener("blur", window.returnFocusListener);
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
console.log(
  "Return recording armed. Alt-Tab away for at least one second, then back.",
);
await page.waitForFunction(
  (n) => performance.getEntriesByName("synapse.return").length > n,
  baseline,
  { timeout: 600000 },
);
await page.waitForTimeout(900);
await cdp.send("Page.stopScreencast");
await Promise.all(writes);
const result = await page.evaluate(() => ({
  timeOrigin: performance.timeOrigin,
  marks: performance
    .getEntriesByType("mark")
    .filter((e) => e.name.startsWith("synapse.return"))
    .map((e) => ({ name: e.name, time: e.startTime, detail: e.detail })),
  measures: performance
    .getEntriesByName("synapse.return")
    .map((e) => e.toJSON()),
  audioContexts: window.returnAudioContexts,
  focus: window.returnFocusLog,
  overlays: document.querySelectorAll(".swarm-overlay").length,
  hidden: document.querySelectorAll("[data-swarm-hidden]").length,
}));
const after = await state(),
  afterCanvas = await canvas();
await page.evaluate(() => {
  window.AudioContext = window.returnOriginalAudio;
  window.removeEventListener("focus", window.returnFocusListener);
  window.removeEventListener("blur", window.returnFocusListener);
});
const measure = result.measures.at(-1);
const report = {
  ...result,
  native: true,
  version,
  frames,
  before,
  after,
  canvasBefore: createHash("sha256").update(beforeCanvas).digest("hex"),
  canvasAfter: createHash("sha256").update(afterCanvas).digest("hex"),
  nativeFocused: await invoke("plugin:window|is_focused", { label: "main" }),
};
await writeFile(path.join(out, "report.json"), JSON.stringify(report, null, 2));
assert.equal(result.measures.length, baseline + 1);
assert.ok(measure.duration >= 250 && measure.duration <= 400);
assert.equal(result.overlays + result.hidden + result.audioContexts, 0);
assert.deepEqual(after, before);
assert.equal(afterCanvas, beforeCanvas);
assert.equal(report.nativeFocused, true);
assert.ok(
  result.focus.some((e) => !e.focused) && result.focus.some((e) => e.focused),
  "Genuine window focus cycle",
);
console.log(
  JSON.stringify(
    {
      native: true,
      duration: measure.duration,
      frames: frames.length,
      unchanged: true,
      silent: true,
    },
    null,
    2,
  ),
);
await browser.close();
