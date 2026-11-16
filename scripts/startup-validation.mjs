// Browser lifecycle tests of the production controller and CSS, including real
// event propagation. Native process/installed startup is verified separately.
import { chromium } from "@playwright/test";
import { createServer } from "vite";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const out = ".local/startup-0.7.0";
await mkdir(out, { recursive: true });
const server = await createServer({
  server: { host: "127.0.0.1", port: 1431, strictPort: true },
});
await server.listen();
const browser = await chromium.launch({ channel: "msedge", headless: true });
const report = [];
const allCases = [
  "full",
  "system-full",
  "reduced",
  "system-reduced",
  "disabled",
  "slow-restore",
  "slow-fonts",
  "pointer",
  "keyboard",
  "touch",
  "wheel",
  "focus",
  "resize",
  "dpr",
  "late-fonts",
  "layout",
  "modal",
  "editor",
  "unmount",
  "strict",
  "background",
  "hidden-start",
  "native-focus",
  "once",
  "storage-failure",
  "error",
  "css-fallback",
];
const cases = process.argv[2] ? [process.argv[2]] : allCases;
try {
  for (const name of cases) {
    const context = await browser.newContext({
      viewport: { width: 1200, height: 800 },
      reducedMotion: name === "system-full" ? "no-preference" : "reduce",
    });
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/swarm-check", (r) =>
      r.fulfill({
        contentType: "text/html",
        body: `<!doctype html><html><head><style>
      body {margin:0;background:#070b10;color:#edf1f4;font:14px Arial} main {padding:24px;display:grid;grid-template-columns:240px 1fr;gap:20px}
      [data-swarm] {box-sizing:border-box;min-height:34px} button {padding:12px;background:#17212b;color:#edf1f4;border:1px solid #354553}
      .brand {font-size:22px} .region {height:100px;border:1px solid #354553} .offscreen {position:absolute;left:-400px}
      </style><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>t=>t;window.__vite_plugin_react_preamble_installed__=true;</script></head><body>
      <main class="app" data-motion="full"><h1 class="brand" data-swarm="text">Synapse 👩🏽‍💻</h1><button id="first" data-swarm="box">First action</button>
      ${Array.from({ length: 10 }, (_, i) => `<section class="region" data-swarm="box">Region ${i}<span data-swarm="text">Nested target excluded</span></section>`).join("")}
      <div hidden data-swarm="box">Hidden</div><div class="offscreen" data-swarm="box">Offscreen</div><div data-swarm="box" data-swarm-sensitive>Private</div>
      <input aria-label="Editor"><input type="password" data-swarm="box"></main></body></html>`,
      }),
    );
    await page.goto("http://127.0.0.1:1431/swarm-check");
    await page.evaluate(async (name) => {
      await import("/src/startup/startup.css");
      const { StartupController } = await import("/src/startup/controller.ts");
      const { resolveReducedMotion } =
        await import("/src/interaction/preferences.ts");
      window.test = {
        claims: 0,
        action: 0,
        errors: [],
        reads: 0,
        audio: 0,
        ids: new Set(),
        nativeForeground: name !== "hidden-start",
      };
      const t = window.test;
      const OriginalAudio = window.AudioContext;
      window.AudioContext = class extends OriginalAudio {
        constructor(...args) {
          super(...args);
          t.audio++;
        }
      };
      const rect = Element.prototype.getBoundingClientRect;
      Element.prototype.getBoundingClientRect = function () {
        t.reads++;
        return rect.call(this);
      };
      const raf = window.requestAnimationFrame,
        cancel = window.cancelAnimationFrame;
      window.requestAnimationFrame = (fn) => {
        const id = raf((now) => {
          t.ids.delete(id);
          fn(now);
        });
        t.ids.add(id);
        return id;
      };
      window.cancelAnimationFrame = (id) => {
        t.ids.delete(id);
        cancel(id);
      };
      const motion =
        name === "reduced"
          ? "reduced"
          : name.startsWith("system-")
            ? "system"
            : "full";
      t.state = {
        ready: name !== "slow-restore",
        reduced: resolveReducedMotion(
          motion,
          matchMedia("(prefers-reduced-motion: reduce)").matches,
        ),
        enabled: name !== "disabled",
        blocked: false,
      };
      t.root = document.querySelector("main");
      t.root.dataset.motion = t.state.reduced ? "reduced" : "full";
      if (name === "slow-fonts")
        Object.defineProperty(document.fonts, "status", {
          configurable: true,
          get: () => "loading",
        });
      if (name === "storage-failure")
        Object.defineProperty(window, "sessionStorage", {
          get() {
            throw Error("Unavailable storage");
          },
        });
      if (name === "editor") document.querySelector("input").focus();
      if (name === "error") {
        const attr = Element.prototype.setAttribute;
        let count = 0;
        Element.prototype.setAttribute = function (k, v) {
          if (k === "data-swarm-hidden" && ++count === 2)
            throw Error("Deliberate animation failure");
          return attr.call(this, k, v);
        };
      }
      t.claim = async () => {
        if (!t.nativeForeground)
          return { id: name, foreground: false, granted: false };
        return { id: name, foreground: true, granted: ++t.claims === 1 };
      };
      t.controller = new StartupController(t.claim);
      if (name === "native-focus") t.controller.foreground(false);
      if (name === "strict") {
        const { mountStrict } = await import("/scripts/startup-fixture.tsx");
        t.detach = mountStrict(t.controller, t.root, t.state);
      } else {
        t.detach = t.controller.attach(t.root);
        t.controller.update(t.state);
      }
      const action = () => {
        t.action++;
        t.atAction = {
          hidden: document.querySelectorAll('[data-swarm-hidden="true"]')
            .length,
          overlay: !!document.querySelector(".swarm-overlay"),
        };
      };
      document.getElementById("first").addEventListener("click", action);
      document.getElementById("first").addEventListener("keydown", action);
    }, name);
    if (name === "hidden-start") {
      await page.waitForTimeout(300);
      assert.deepEqual(
        await page.evaluate(() => ({
          claims: window.test.claims,
          overlay: !!document.querySelector(".swarm-overlay"),
          audio: window.test.audio,
        })),
        { claims: 0, overlay: false, audio: 0 },
      );
      await page.evaluate(() => {
        window.test.nativeForeground = true;
        window.dispatchEvent(new Event("focus"));
      });
    }
    if (name === "native-focus") {
      await page.waitForTimeout(300);
      assert.equal(await page.evaluate(() => window.test.claims), 0);
      await page.evaluate(() => window.test.controller.foreground(true));
    }
    const skip = [
      "reduced",
      "system-reduced",
      "disabled",
      "slow-restore",
      "slow-fonts",
      "editor",
      "error",
    ].includes(name);
    let atSnapshot;
    if (!skip) {
      await page
        .waitForSelector(".swarm-overlay", { state: "attached", timeout: 4000 })
        .catch(async (error) => {
          console.log(
            JSON.stringify({
              name,
              errors,
              debug: await page.evaluate(() => ({
                marks: performance.getEntriesByType("mark").map((e) => e.name),
                controller: {
                  done: window.test.controller.done,
                  started: window.test.controller.started,
                  root: !!window.test.controller.root,
                  claiming: window.test.controller.claiming,
                },
                focus: document.hasFocus(),
              })),
            }),
          );
          throw error;
        });
      atSnapshot = await page.evaluate(() => ({
        count: document.querySelectorAll('[data-swarm-hidden="true"]').length,
        cursors: document.querySelectorAll(".swarm-cursor").length,
        reads: window.test.reads,
        pointerEvents: getComputedStyle(
          document.querySelector(".swarm-overlay"),
        ).pointerEvents,
      }));
      assert.ok(atSnapshot.count > 0 && atSnapshot.count <= 15);
      assert.equal(atSnapshot.cursors, 6);
      assert.equal(atSnapshot.pointerEvents, "none");
      if (name === "full")
        await page.screenshot({ path: `${out}/construction.png` });
      if (name === "pointer")
        await page.locator("#first").click({ force: true });
      if (name === "keyboard")
        await page.evaluate(() =>
          document
            .getElementById("first")
            .dispatchEvent(
              new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
            ),
        );
      if (name === "touch")
        await page.evaluate(() =>
          window.dispatchEvent(new Event("touchstart")),
        );
      if (name === "wheel") await page.mouse.wheel(0, 50);
      if (name === "focus") await page.locator("input:not([type])").focus();
      if (name === "resize")
        await page.setViewportSize({ width: 1100, height: 800 });
      if (name === "dpr") {
        const cdp = await context.newCDPSession(page);
        await cdp.send("Emulation.setDeviceMetricsOverride", {
          width: 1200,
          height: 800,
          deviceScaleFactor: 1.5,
          mobile: false,
        });
      }
      if (name === "late-fonts")
        await page.evaluate(() =>
          document.fonts.dispatchEvent(new Event("loading")),
        );
      if (name === "layout")
        await page.evaluate(
          () => (document.getElementById("first").style.height = "90px"),
        );
      if (name === "modal")
        await page.evaluate(() => {
          const dialog = document.createElement("div");
          dialog.setAttribute("aria-modal", "true");
          window.test.root.append(dialog);
        });
      if (name === "unmount") await page.evaluate(() => window.test.detach());
      if (name === "background")
        await page.evaluate(() => window.dispatchEvent(new Event("blur")));
      if (name === "css-fallback") {
        await page.evaluate(() => {
          window.test.controller.release();
        });
        await page.waitForTimeout(1200);
        assert.equal(
          await page
            .locator("#first")
            .evaluate((el) => getComputedStyle(el).opacity),
          "1",
        );
        assert.equal(
          await page
            .locator(".swarm-overlay")
            .evaluate((el) => getComputedStyle(el).visibility),
          "hidden",
        );
        await page.evaluate(() =>
          window.test.controller.finish("css-recovery"),
        );
      }
    }
    await page.waitForFunction(
      () => performance.getEntriesByName("synapse.startup").length > 0,
    );
    const result = await page.evaluate(() => ({
      marks: performance
        .getEntriesByType("mark")
        .filter((e) => e.name.startsWith("synapse.startup"))
        .map((e) => ({ name: e.name, at: e.startTime, detail: e.detail })),
      duration: performance.getEntriesByName("synapse.startup").at(-1).duration,
      hidden: document.querySelectorAll('[data-swarm-hidden="true"]').length,
      overlay: !!document.querySelector(".swarm-overlay"),
      pendingFrames: window.test.ids.size,
      claims: window.test.claims,
      audio: window.test.audio,
      action: window.test.action,
      atAction: window.test.atAction,
      reads: window.test.reads,
    }));
    assert.equal(result.hidden, 0);
    assert.equal(result.overlay, false);
    assert.equal(result.pendingFrames, 0);
    assert.equal(result.audio, 0);
    if (name !== "css-fallback")
      assert.ok(result.duration <= 1200, JSON.stringify(result));
    if (
      [
        "full",
        "system-full",
        "strict",
        "once",
        "storage-failure",
        "hidden-start",
        "native-focus",
      ].includes(name)
    ) {
      assert.ok(result.duration >= 900, JSON.stringify(result));
      assert.ok(
        result.marks.at(-1).name.endsWith("complete"),
        JSON.stringify(result),
      );
    }
    if (["pointer", "keyboard"].includes(name)) {
      assert.equal(result.action, 1);
      assert.deepEqual(result.atAction, { hidden: 0, overlay: false });
    }
    if (name === "error") assert.ok(result.marks.at(-1).name.endsWith("error"));
    if (name === "once" || name === "storage-failure") {
      await page.evaluate(async () => {
        window.test.detach();
        const { StartupController } =
          await import("/src/startup/controller.ts");
        window.test.second = new StartupController(window.test.claim);
        window.test.second.attach(window.test.root);
        window.test.second.update(window.test.state);
      });
      await page.waitForTimeout(250);
      assert.equal(await page.locator(".swarm-overlay").count(), 0);
      assert.equal(
        await page.evaluate(
          () => performance.getEntriesByName("synapse.startup:snapshot").length,
        ),
        1,
      );
    }
    assert.deepEqual(errors, []);
    report.push({ name, atSnapshot, ...result });
    console.log(
      `${name}: ${result.marks.at(-1).name.split(":").at(-1)} ${result.duration.toFixed(1)}ms`,
    );
    await context.close();
  }
  await writeFile(
    `${out}/browser-report.json`,
    JSON.stringify({ success: true, cases: report }, null, 2),
  );
} finally {
  await browser.close();
  await server.close();
}
