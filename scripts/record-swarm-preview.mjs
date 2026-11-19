// Browser fixture review only. These clips are NOT native launch/Alt-Tab evidence.
import { chromium } from "@playwright/test";
import { createServer } from "vite";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
const { version } = JSON.parse(await readFile("package.json", "utf8"));
const cases = process.argv[2] ? [process.argv[2]] : ["startup", "return"];
assert.ok(cases.every((name) => name === "startup" || name === "return"));
const server = await createServer({
  server: { host: "127.0.0.1", port: 1432, strictPort: true },
});
await server.listen();
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  for (const name of cases) {
    const out = path.resolve(`.local/release-${version}/browser-${name}`);
    await mkdir(out, { recursive: true });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      reducedMotion: "no-preference",
    });
    const page = await context.newPage();
    await page.route("**/swarm-preview", (r) =>
      r.fulfill({
        contentType: "text/html",
        body: `<!doctype html><html><head><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>t=>t;window.__vite_plugin_react_preamble_installed__=true;</script></head><body></body></html>`,
      }),
    );
    await page.goto("http://127.0.0.1:1432/swarm-preview");
    await page.evaluate(async (name) => {
      const { StartupController } = await import("/src/startup/controller.ts");
      const { ReturnController } = await import("/src/startup/return.ts");
      const { mountWorkspace } = await import("/scripts/startup-fixture.tsx");
      await Promise.all([
        document.fonts.load("400 24px Geist"),
        document.fonts.load("650 18px Manrope"),
      ]);
      const startup = new StartupController(async () => ({
        id: `preview-${name}`,
        foreground: true,
        visible: true,
        granted: true,
      }));
      const fixture = mountWorkspace(startup, {
        ready: false,
        reduced: false,
        enabled: name === "startup",
        blocked: false,
      });
      window.preview = { startup, fixture, ReturnController };
    }, name);
    await page.waitForSelector(".startup-restoring");
    if (name === "return") {
      await page.evaluate(() => window.preview.fixture.ready());
      await page.waitForSelector(".graph-controls");
      await page.waitForTimeout(500);
      await page.evaluate(() => {
        const q = window.preview;
        q.returns = new q.ReturnController(() => true, true);
        q.returns.attach(document.querySelector("main"));
        q.returns.update({
          ready: true,
          reduced: false,
          enabled: true,
          blocked: false,
        });
        q.returns.foreground(true);
        q.returns.foreground(false);
      });
      await page.waitForTimeout(700);
    }
    const cdp = await context.newCDPSession(page),
      frames = [],
      writes = [];
    cdp.on("Page.screencastFrame", (e) => {
      void cdp.send("Page.screencastFrameAck", { sessionId: e.sessionId });
      const file = path.join(
        out,
        `${String(frames.length).padStart(5, "0")}.jpg`,
      );
      frames.push({ file, time: e.metadata.timestamp });
      writes.push(writeFile(file, Buffer.from(e.data, "base64")));
    });
    await cdp.send("Page.startScreencast", {
      format: "jpeg",
      quality: 95,
      everyNthFrame: 1,
    });
    await page.waitForTimeout(100);
    await page.evaluate(
      (name) =>
        name === "startup"
          ? window.preview.fixture.ready()
          : window.preview.returns.foreground(true),
      name,
    );
    await page.waitForFunction(
      (name) => performance.getEntriesByName(`synapse.${name}`).length > 0,
      name,
      { timeout: 8000 },
    );
    await page.waitForTimeout(900);
    await cdp.send("Page.stopScreencast");
    await Promise.all(writes);
    const result = await page.evaluate(
      (name) => ({
        timeOrigin: performance.timeOrigin,
        measure: performance
          .getEntriesByName(`synapse.${name}`)
          .at(-1)
          .toJSON(),
        marks: performance
          .getEntriesByType("mark")
          .filter((e) => e.name.startsWith(`synapse.${name}`))
          .map((e) => ({ name: e.name, time: e.startTime, detail: e.detail })),
      }),
      name,
    );
    assert.ok(
      result.marks.at(-1).name.endsWith("complete"),
      JSON.stringify(result),
    );
    const start = (result.timeOrigin + result.measure.startTime) / 1000 - 0.08,
      end =
        (result.timeOrigin +
          result.measure.startTime +
          result.measure.duration) /
          1000 +
        0.75;
    const ordered = [...frames]
      .sort((a, b) => a.time - b.time)
      .filter((f, i, a) => !i || f.time !== a[i - 1].time);
    const prior = ordered.filter((f) => f.time <= start).at(-1);
    const selected = [
      ...(prior ? [{ ...prior, time: start }] : []),
      ...ordered.filter((f) => f.time > start && f.time < end),
    ];
    const lines = ["ffconcat version 1.0"];
    selected.forEach((f, i) =>
      lines.push(
        `file '${f.file.replaceAll("\\", "/")}'`,
        "option framerate 1000",
        `duration ${((selected[i + 1]?.time ?? end) - f.time).toFixed(6)}`,
      ),
    );
    lines.push(
      `file '${selected.at(-1).file.replaceAll("\\", "/")}'`,
      "option framerate 1000",
    );
    await writeFile(path.join(out, "clip.ffconcat"), lines.join("\n") + "\n");
    await writeFile(
      path.join(out, "report.json"),
      JSON.stringify(
        {
          native: false,
          fixture: true,
          trigger:
            name === "return"
              ? "Simulated focus lifecycle; not Alt-Tab"
              : "Browser fixture becoming ready; not a native launch",
          ...result,
          frames,
          clip: { start, end, duration: end - start, frames: selected.length },
        },
        null,
        2,
      ),
    );
    console.log(
      JSON.stringify({
        name,
        native: false,
        duration: result.measure.duration,
        frames: selected.length,
      }),
    );
    await context.close();
  }
} finally {
  await browser.close();
  await server.close();
}
