// Actual installed launch; native foreground is supplied by Windows/user input.
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdir, writeFile, access, readFile } from "node:fs/promises";
import path from "node:path";
import { startProbe, stopProbe } from "./native-probe.mjs";
const mode = process.argv[2] ?? "tray",
  name = process.argv[3] ?? mode;
const source = JSON.parse(await readFile("package.json", "utf8"));
const base = path.resolve(
    process.env.SYNAPSE_NATIVE_EVIDENCE ??
      `.local/native-acceptance-${source.version}`,
  ),
  out = path.join(base, name);
await mkdir(out, { recursive: true });
const executable = path.join(
  process.env.LOCALAPPDATA,
  "Synapse",
  "synapse.exe",
);
const child = spawn(executable, mode === "visible" ? [] : ["--background"], {
  env: {
    ...process.env,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9222",
  },
  detached: true,
  stdio: "ignore",
});
child.unref();
for (let i = 0; i < 300; i++) {
  try {
    if ((await fetch("http://127.0.0.1:9222/json/version")).ok) break;
  } catch {
    /* The new WebView has not opened its diagnostics port yet. */
  }
  await new Promise((r) => setTimeout(r, 25));
}
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222", {
    noDefaults: true,
  }),
  context = browser.contexts()[0],
  page = context.pages()[0];
await page.waitForFunction(() => !!window.__TAURI_INTERNALS__?.invoke);
const invoke = (command, args = {}) =>
  page.evaluate(
    ({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args),
    { command, args },
  );
const version = await invoke("plugin:app|version");
try {
  await access(path.join(base, "original-preferences.json"));
} catch {
  await writeFile(
    path.join(base, "original-preferences.json"),
    JSON.stringify(
      await page.evaluate(() => localStorage.getItem("synapse.preferences.v1")),
    ),
  );
}
await startProbe(page);
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
  maxWidth: 1920,
  maxHeight: 1200,
  everyNthFrame: 1,
});
console.log(
  JSON.stringify({
    armed: true,
    mode,
    name,
    version,
    pid: child.pid,
    visible: await invoke("plugin:window|is_visible", { label: "main" }),
    focused: await invoke("plugin:window|is_focused", { label: "main" }),
  }),
);
await page.waitForFunction(
  () =>
    performance
      .getEntriesByType("mark")
      .some((e) => e.name.startsWith("synapse.startup:finish:")),
  undefined,
  { timeout: 600000 },
);
await page.waitForTimeout(1100);
await cdp.send("Page.stopScreencast");
await Promise.all(writes);
const probe = await stopProbe(page);
const report = {
  native: true,
  mode,
  name,
  version,
  pid: child.pid,
  captureFrames: frames,
  ...probe,
};
await writeFile(path.join(out, "report.json"), JSON.stringify(report, null, 2));
console.log(
  JSON.stringify(
    {
      name,
      marks: probe.marks,
      measures: probe.measures,
      native: probe.native,
      gate: probe.gate,
      hidden: probe.concealed,
      overlays: probe.overlays,
      audio: probe.audio,
      frames: frames.length,
    },
    null,
    2,
  ),
);
await browser.close();
