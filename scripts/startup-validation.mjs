// Browser fixtures mount the production Graph/GraphScene and both controllers.
// Native process claims, Alt-Tab and installed recordings are checked separately.
import { chromium } from "@playwright/test";
import { createServer } from "vite";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const { version } = JSON.parse(await readFile("package.json", "utf8"));
const out = `.local/swarm-${version}`;
await mkdir(out, { recursive: true });
const server = await createServer({
  server: { host: "127.0.0.1", port: 1431, strictPort: true },
});
await server.listen();
const browser = await chromium.launch({ channel: "msedge", headless: true });
const results = [];
const startupCases = [
  "full",
  "welcome",
  "collapsed",
  "small",
  "large",
  "scale150",
  "scale200",
  "drawer",
  "empty",
  "dense",
  "reduced",
  "system-reduced",
  "system-full",
  "disabled",
  "slow-restore",
  "slow-fonts",
  "late-claim",
  "late-attach",
  "pointer",
  "keyboard",
  "touch",
  "wheel",
  "scroll",
  "composition",
  "focus",
  "resize",
  "dpr",
  "late-fonts",
  "layout",
  "modal",
  "unmount",
  "strict",
  "background",
  "hidden-start",
  "hidden-dom-focus",
  "hidden-stale-claim",
  "hidden-native-show",
  "hidden-show-unfocused",
  "once",
  "storage-failure",
  "error",
  "css-fallback",
];
const returnCases = [
  "return",
  "return-bounce",
  "return-chatter",
  "return-cooldown",
  "return-dialog",
  "return-dialog-error",
  "return-editor",
  "return-pointer",
  "return-keyboard",
  "return-composition",
  "return-reduced",
  "return-disabled",
  "return-modal",
  "return-empty",
  "return-resize",
  "return-initial",
];
const cases = process.argv[2]
  ? [process.argv[2]]
  : [...startupCases, ...returnCases];
try {
  for (const name of cases) {
    const returning = name.startsWith("return");
    const context = await browser.newContext({
      viewport:
        name === "small"
          ? { width: 900, height: 600 }
          : name === "large"
            ? { width: 1920, height: 1080 }
            : { width: 1440, height: 900 },
      deviceScaleFactor:
        name === "scale150" ? 1.5 : name === "scale200" ? 2 : 1,
      reducedMotion: name === "system-full" ? "no-preference" : "reduce",
    });
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/swarm-check", (r) =>
      r.fulfill({
        contentType: "text/html",
        body: `<!doctype html><html><head><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>t=>t;window.__vite_plugin_react_preamble_installed__=true;</script></head><body></body></html>`,
      }),
    );
    await page.goto("http://127.0.0.1:1431/swarm-check");
    await page.evaluate(
      async ({ name, returning }) => {
        const { StartupController } =
          await import("/src/startup/controller.ts");
        const { preferences, resolveReducedMotion } =
          await import("/src/interaction/preferences.ts");
        const { mountWorkspace } = await import("/scripts/startup-fixture.tsx");
        const { graphPresentation } =
          await import("/src/startup/presentation.ts");
        await document.fonts.ready;
        // Normal-motion cases require ready fonts. Explicitly load the faces
        // before the ready workspace is mounted; fonts.ready alone does not
        // request a face that has not yet been used by a rendered element.
        await Promise.all([
          document.fonts.load("400 24px Geist"),
          document.fonts.load("650 18px Manrope"),
        ]);
        const motion =
          name === "reduced" || name === "return-reduced"
            ? "reduced"
            : name.startsWith("system-")
              ? "system"
              : "full";
        preferences.update({ motion });
        const q = (window.qa = {
          claims: 0,
          audio: 0,
          action: 0,
          foreground: !name.startsWith("hidden-"),
          visible: !name.startsWith("hidden-"),
          samples: [],
          name,
        });
        const Audio = window.AudioContext;
        window.AudioContext = class extends Audio {
          constructor(...args) {
            super(...args);
            q.audio++;
          }
        };
        if (name === "slow-fonts")
          Object.defineProperty(document.fonts, "status", {
            configurable: true,
            get: () => (q.fontsReady ? "loaded" : "loading"),
          });
        if (name === "storage-failure")
          Object.defineProperty(window, "sessionStorage", {
            get() {
              throw Error("Storage unavailable");
            },
          });
        if (name === "error") {
          const original = Element.prototype.setAttribute;
          let hits = 0;
          Element.prototype.setAttribute = function (k, v) {
            if (k === "data-swarm-hidden" && ++hits === 2)
              throw Error("Induced failure");
            return original.call(this, k, v);
          };
        }
        if (name.startsWith("hidden-"))
          Object.defineProperty(document, "hidden", {
            configurable: true,
            get: () => !q.visible,
          });
        q.claim = async () => {
          if (name === "late-claim")
            await new Promise((r) => setTimeout(r, 450));
          const result = {
            id: name,
            foreground: q.foreground,
            visible: q.visible,
            granted: q.foreground && ++q.claims === 1,
          };
          if (name === "hidden-stale-claim" && !q.foreground)
            await new Promise((resolve) => {
              q.releaseHiddenClaim = resolve;
            });
          return result;
        };
        q.controller = new StartupController(q.claim);
        q.state = {
          ready: name !== "slow-restore",
          enabled: !returning && name !== "disabled",
          reduced: resolveReducedMotion(
            motion,
            matchMedia("(prefers-reduced-motion: reduce)").matches,
          ),
          blocked: false,
        };
        q.fixture = mountWorkspace(q.controller, q.state, {
          strict: name === "strict",
          collapsed: name === "collapsed",
          welcome: name === "welcome",
          empty: name === "empty" || name === "return-empty",
          drawer: name === "drawer" || name === "return-editor",
          dense: name === "dense",
        });
        q.graph = () => graphPresentation(document.querySelector("main"));
        const action = (e) => {
          if (e.target.closest?.("#first")) {
            q.action++;
            q.atAction = {
              hidden: document.querySelectorAll('[data-swarm-hidden="true"]')
                .length,
              overlays: document.querySelectorAll(".swarm-overlay").length,
            };
          }
        };
        document.addEventListener("click", action);
        document.addEventListener("keydown", action);
        const sample = () => {
          const el = document.querySelector(".brand,.welcome h1");
          if (el)
            q.samples.push({
              at: performance.now(),
              opacity: getComputedStyle(el).opacity,
              phase: document.querySelector("main").dataset.swarmGate ?? "live",
              overlay: !!document.querySelector(".swarm-startup"),
            });
          if (!q.controller.settled)
            q.sampleFrame = requestAnimationFrame(sample);
        };
        q.sampleFrame = requestAnimationFrame(sample);
      },
      { name, returning },
    );
    if (name === "slow-restore") {
      await page.waitForTimeout(650);
      assert.equal(await page.locator(".swarm-overlay").count(), 0);
      assert.equal(
        await page.locator("[role=status]").textContent(),
        "Restoring your workspace…",
      );
      await page.evaluate(() => window.qa.fixture.ready());
    }
    if (name.startsWith("hidden-")) {
      await page.waitForTimeout(5050);
      assert.equal(await page.locator(".swarm-overlay").count(), 0);
      assert.equal(await page.evaluate(() => window.qa.claims), 0);
      await page.evaluate((name) => {
        const q = window.qa;
        q.visible = true;
        q.foreground = name !== "hidden-show-unfocused";
        if (["hidden-native-show", "hidden-show-unfocused"].includes(name))
          q.controller.shown();
        else if (name !== "hidden-start")
          window.dispatchEvent(new Event("focus"));
        else {
          document.dispatchEvent(new Event("visibilitychange"));
          q.controller.foreground(true);
        }
        q.releaseHiddenClaim?.();
      }, name);
    }
    if (returning) {
      await page.waitForFunction(
        () =>
          window.qa.controller.settled &&
          !!document.querySelector(".graph-controls"),
      );
      await page.waitForTimeout(500);
      await page.evaluate(async (name) => {
        const { ReturnController } = await import("/src/startup/return.ts"),
          q = window.qa;
        q.returns = new ReturnController(() => q.controller.settled, true);
        q.returns.attach(document.querySelector("main"));
        q.returns.update({
          ready: true,
          enabled: name !== "return-disabled",
          reduced: name === "return-reduced",
          blocked: name === "return-modal",
        });
        q.returns.foreground(true);
        q.before = JSON.stringify(q.fixture.exploration.capture());
        if (name === "return-editor") {
          const e = document.querySelector("#draft");
          e.focus();
          e.setSelectionRange(4, 17);
          e.scrollTop = 230;
          q.editorBefore = {
            value: e.value,
            start: e.selectionStart,
            end: e.selectionEnd,
            scroll: e.scrollTop,
          };
        }
      }, name);
      if (name === "return-initial") await page.waitForTimeout(500);
      else {
        if (name.startsWith("return-dialog"))
          await page.evaluate(async (name) => {
            const { withNativeDialog } =
              await import("/src/startup/suppression.ts");
            window.qa.dialog = withNativeDialog(
              () =>
                new Promise((resolve, reject) => {
                  window.qa.resolveDialog = () =>
                    name.endsWith("error")
                      ? reject(Error("Cancelled/error"))
                      : resolve(null);
                }),
            ).catch(() => {});
          }, name);
        await page.evaluate(() => window.qa.returns.foreground(false));
        await page.waitForTimeout(name === "return-bounce" ? 120 : 600);
        if (name.startsWith("return-dialog")) {
          await page.evaluate(() => window.qa.resolveDialog());
          await page.waitForTimeout(180);
        }
        await page.evaluate(() => {
          window.qa.returns.foreground(true);
          window.dispatchEvent(new Event("focus"));
          document.dispatchEvent(new Event("visibilitychange"));
          window.qa.returns.foreground(true);
        });
        const suppressed = [
          "return-bounce",
          "return-dialog",
          "return-dialog-error",
          "return-reduced",
          "return-disabled",
          "return-modal",
        ].includes(name);
        if (!suppressed) {
          await page.waitForSelector(".swarm-return", {
            state: "attached",
            timeout: 2000,
          });
          assert.equal(await page.locator(".swarm-cursor").count(), 0);
          assert.equal(await page.locator("[data-swarm-hidden]").count(), 0);
          if (name === "return")
            await page.screenshot({ path: `${out}/return.png` });
          if (name === "return-pointer")
            await page.locator("#first").click({ force: true });
          if (name === "return-keyboard")
            await page
              .locator("#first")
              .dispatchEvent("keydown", { key: "Enter" });
          if (name === "return-composition")
            await page.evaluate(() =>
              window.dispatchEvent(new Event("compositionstart")),
            );
          if (name === "return-resize")
            await page.setViewportSize({ width: 1360, height: 900 });
          if (name === "return-chatter")
            await page.evaluate(() => {
              window.qa.returns.foreground(true);
              window.dispatchEvent(new Event("focus"));
              document.dispatchEvent(new Event("visibilitychange"));
            });
        }
        await page.waitForTimeout(480);
        assert.equal(await page.locator(".swarm-return").count(), 0);
        const count = await page.evaluate(
          () => performance.getEntriesByName("synapse.return:start").length,
        );
        assert.equal(count, suppressed ? 0 : 1, name);
        if (name === "return-cooldown") {
          await page.evaluate(() => window.qa.returns.foreground(false));
          await page.waitForTimeout(550);
          await page.evaluate(() => window.qa.returns.foreground(true));
          await page.waitForTimeout(450);
          assert.equal(
            await page.evaluate(
              () => performance.getEntriesByName("synapse.return:start").length,
            ),
            1,
          );
        }
        if (name.startsWith("return-dialog")) {
          await page.waitForTimeout(1200);
          await page.evaluate(() => window.qa.returns.foreground(false));
          await page.waitForTimeout(550);
          await page.evaluate(() => window.qa.returns.foreground(true));
          await page.waitForTimeout(500);
          assert.equal(
            await page.evaluate(
              () => performance.getEntriesByName("synapse.return:start").length,
            ),
            1,
            "Suppression must expire",
          );
        }
      }
      const result = await page.evaluate(() => {
        const q = window.qa,
          e = document.querySelector("#draft");
        return {
          name: q.name,
          measures: performance
            .getEntriesByName("synapse.return")
            .map((x) => x.duration),
          marks: performance
            .getEntriesByType("mark")
            .filter((x) => x.name.startsWith("synapse.return"))
            .map((x) => ({ name: x.name, detail: x.detail })),
          audio: q.audio,
          raf: q.returns.raf,
          stable: q.returns.stable,
          timer: q.returns.deadline,
          before: q.before,
          after: JSON.stringify(q.fixture.exploration.capture()),
          action: q.action,
          atAction: q.atAction,
          editorBefore: q.editorBefore,
          editorAfter: e
            ? {
                value: e.value,
                start: e.selectionStart,
                end: e.selectionEnd,
                scroll: e.scrollTop,
                focused: document.activeElement === e,
              }
            : undefined,
        };
      });
      assert.equal(result.audio, 0);
      assert.equal(result.raf + result.stable + result.timer, 0);
      assert.ok(
        result.measures.every((d) => d <= 400),
        JSON.stringify(result),
      );
      if (name !== "return-resize")
        assert.equal(
          result.before,
          result.after,
          "Return changes no graph state",
        );
      if (name === "return-editor") {
        assert.equal(result.editorAfter.focused, true);
        const after = { ...result.editorAfter };
        delete after.focused;
        assert.deepEqual(after, result.editorBefore);
      }
      if (["return-pointer", "return-keyboard"].includes(name)) {
        assert.equal(result.action, 1);
        assert.deepEqual(result.atAction, { hidden: 0, overlays: 0 });
      }
      results.push(result);
    } else {
      const skip = [
        "reduced",
        "system-reduced",
        "disabled",
        "slow-fonts",
        "late-claim",
        "late-attach",
        "hidden-show-unfocused",
        "error",
      ].includes(name);
      if (name === "late-attach")
        await page.evaluate(() => {
          window.qa.controller.finish("test-preparation");
          window.qa.controller.attach(document.querySelector("main"), false);
        });
      let plan, graphBefore;
      if (!skip) {
        await page
          .waitForSelector(".swarm-startup", {
            state: "attached",
            timeout: 6000,
          })
          .catch(async (e) => {
            console.log(
              await page.evaluate(() => ({
                marks: performance
                  .getEntriesByType("mark")
                  .map((x) => ({ name: x.name, detail: x.detail })),
                controller: {
                  done: window.qa.controller.done,
                  ready: window.qa.controller.readyAt,
                  started: window.qa.controller.started,
                },
                graph: !!window.qa.graph(),
                errors: [],
              })),
            );
            throw e;
          });
        ({ plan, graphBefore } = await page.evaluate(() => ({
          plan: window.qa.controller.plan,
          graphBefore: window.qa
            .graph()
            ?.nodes.map((n) => ({ id: n.id, x: n.x, y: n.y })),
        })));
        assert.ok(plan.agents.length <= 14 && plan.tasks.length <= 64);
        for (const task of plan.tasks)
          for (const d of task.dependencies)
            assert.ok(task.work >= plan.tasks.find((t) => t.id === d).end);
        assert.equal(
          await page
            .locator(
              ".swarm-startup [tabindex],.swarm-startup button,.swarm-startup input",
            )
            .count(),
          0,
        );
        assert.equal(
          await page.locator(".swarm-startup").getAttribute("aria-hidden"),
          "true",
        );
        assert.equal(
          await page
            .locator(".swarm-startup")
            .evaluate((e) => getComputedStyle(e).pointerEvents),
          "none",
        );
        if (name === "full") {
          assert.equal(plan.agents.length, 14);
          assert.equal(plan.orbitEnd, 900);
          assert.equal(plan.constructionEnd, 4060);
          assert.equal(plan.duration, 4460);
          const names = await page.locator(".swarm-name").allTextContents();
          assert.equal(new Set(names).size, 14);
          for (const name of ["Ohm", "Volta", "Hertz", "Joule"])
            assert.ok(names.includes(name));
          assert.equal(new Set(plan.agents.map((a) => a.radius)).size, 14);
          assert.ok(
            plan.agents.some((a) => a.speed < 0) &&
              plan.agents.some((a) => a.speed > 0),
          );
          for (const a of plan.agents) {
            const own = plan.tasks.filter((t) => t.agent === a.id);
            const first = own[0],
              angle = a.angle + (a.speed * first.start) / 1000;
            assert.ok(first.start >= plan.orbitEnd);
            assert.ok(
              Math.hypot(
                first.from.x - plan.centre.x - a.radius * Math.cos(angle),
                first.from.y - plan.centre.y - 0.6 * a.radius * Math.sin(angle),
              ) < 0.001,
            );
            assert.equal(a.departure, own.at(-1).end);
            assert.ok(Math.abs(a.gone - a.departure - 160) < 0.001);
          }
          for (const kind of [
            "guide",
            "box",
            "text",
            "duplicate",
            "node",
            "connection",
          ])
            assert.ok(plan.tasks.some((t) => t.kind === kind));
          const graphLabels = plan.tasks.filter(
            (t) => t.kind === "text" && t.node !== undefined,
          );
          assert.ok(graphLabels.length >= 3);
          for (const t of graphLabels) {
            assert.ok(t.dependencies.includes(`node-${t.node}`));
            assert.equal(t.typing.length, t.run.text.length);
            assert.ok(
              t.typing.every(
                (time, i) => time > 0 && (i === 0 || time > t.typing[i - 1]),
              ),
            );
          }
          assert.ok(
            plan.tasks.some(
              (t) => t.id.startsWith("caption-") && t.typing.length > 2,
            ),
          );
          assert.ok(
            new Set(plan.tasks.map((t) => Math.round(t.end - t.work))).size > 8,
          );
          assert.ok(
            Math.max(...plan.agents.map((a) => a.gone)) -
              Math.min(...plan.agents.map((a) => a.gone)) >
              400,
          );
          await page.waitForTimeout(600);
          await page.screenshot({ path: `${out}/startup.png` });
        }
        if (name === "pointer")
          await page.locator("#first").click({ force: true });
        if (name === "keyboard")
          await page
            .locator("#first")
            .dispatchEvent("keydown", { key: "Enter" });
        if (name === "touch")
          await page.evaluate(() =>
            window.dispatchEvent(new Event("touchstart")),
          );
        if (name === "wheel") await page.mouse.wheel(0, 30);
        if (name === "scroll")
          await page.evaluate(() => window.dispatchEvent(new Event("scroll")));
        if (name === "composition")
          await page.evaluate(() =>
            window.dispatchEvent(new Event("compositionstart")),
          );
        if (name === "focus") await page.locator("input").first().focus();
        if (name === "resize")
          await page.setViewportSize({ width: 1360, height: 900 });
        if (name === "dpr") {
          const cdp = await context.newCDPSession(page);
          await cdp.send("Emulation.setDeviceMetricsOverride", {
            width: 1440,
            height: 900,
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
            () => (document.querySelector("#first").style.height = "100px"),
          );
        if (name === "modal")
          await page.evaluate(() => {
            const d = document.createElement("div");
            d.setAttribute("aria-modal", "true");
            document.querySelector("main").append(d);
          });
        if (name === "unmount")
          await page.evaluate(() => window.qa.fixture.unmount());
        if (name === "background")
          await page.evaluate(() => window.qa.controller.foreground(false));
        if (name === "css-fallback") {
          await page.evaluate(() => window.qa.controller.release());
          await page.waitForTimeout(3950);
          assert.equal(
            await page
              .locator("#first")
              .evaluate((e) => getComputedStyle(e).opacity),
            "0",
            "The former 3.8s watchdog must not reveal a running v3 intro",
          );
          await page.waitForTimeout(1150);
          assert.equal(
            await page
              .locator("#first")
              .evaluate((e) => getComputedStyle(e).opacity),
            "1",
          );
          assert.equal(
            await page
              .locator(".swarm-overlay")
              .evaluate((e) => getComputedStyle(e).visibility),
            "hidden",
          );
          await page.evaluate(() =>
            window.qa.controller.finish("css-recovery"),
          );
        }
      }
      await page.waitForFunction(
        () => window.qa.controller.settled,
        {},
        { timeout: 6000 },
      );
      const result = await page.evaluate(() => {
        const q = window.qa;
        return {
          name: q.name,
          marks: performance
            .getEntriesByType("mark")
            .filter((x) => x.name.startsWith("synapse.startup"))
            .map((x) => ({ name: x.name, detail: x.detail })),
          duration: performance.getEntriesByName("synapse.startup").at(-1)
            ?.duration,
          hidden: document.querySelectorAll(
            "[data-swarm-hidden],[data-swarm-surface-hidden],[data-swarm-gate]",
          ).length,
          overlay: document.querySelectorAll(".swarm-overlay").length,
          raf: q.controller.raf,
          timer: q.controller.timer,
          audio: q.audio,
          action: q.action,
          atAction: q.atAction,
          graphAfter: q
            .graph()
            ?.nodes.map((n) => ({ id: n.id, x: n.x, y: n.y })),
          samples: q.samples,
        };
      });
      assert.equal(
        result.hidden +
          result.overlay +
          result.raf +
          result.timer +
          result.audio,
        0,
        JSON.stringify(result),
      );
      if (name !== "css-fallback" && result.duration)
        assert.ok(result.duration <= 4900);
      if (
        [
          "full",
          "strict",
          "once",
          "storage-failure",
          "hidden-start",
          "hidden-dom-focus",
          "hidden-stale-claim",
          "hidden-native-show",
          "slow-restore",
          "dense",
          "scale150",
          "scale200",
          "large",
        ].includes(name)
      ) {
        assert.ok(
          result.marks.at(-1).name.endsWith("complete"),
          JSON.stringify(result),
        );
        assert.ok(
          result.duration >= 4400 && result.duration <= 4620,
          JSON.stringify(result),
        );
        assert.deepEqual(
          result.graphAfter,
          graphBefore,
          "Graph positions must match handover",
        );
      }
      if (["pointer", "keyboard"].includes(name)) {
        assert.equal(result.action, 1);
        assert.deepEqual(result.atAction, { hidden: 0, overlays: 0 });
      }
      if (name === "slow-fonts" || name === "late-claim")
        assert.ok(result.marks.at(-1).name.endsWith("readiness-budget"));
      if (name === "once" || name === "storage-failure") {
        await page.evaluate(async () => {
          const { StartupController } =
            await import("/src/startup/controller.ts");
          const q = window.qa;
          q.second = new StartupController(q.claim);
          q.second.update(q.state);
          q.second.attach(document.querySelector("main"));
        });
        await page.waitForTimeout(300);
        assert.equal(await page.locator(".swarm-startup").count(), 0);
        assert.equal(
          await page.evaluate(
            () => performance.getEntriesByName("synapse.startup:start").length,
          ),
          1,
        );
      }
      // Once a ready region has become visible it must never be hidden to restart.
      let shown = false;
      for (const sample of result.samples) {
        if (sample.opacity === "1") shown = true;
        else
          assert.equal(
            shown,
            false,
            `${name}: visible content was hidden later`,
          );
      }
      results.push({ ...result, plan });
    }
    assert.deepEqual(errors, [], name);
    console.log(`${name}: passed`);
    await context.close();
    await writeFile(
      `${out}/${process.argv[2] ? `browser-${process.argv[2]}` : "browser-report"}.json`,
      JSON.stringify(
        {
          success: results.length === cases.length,
          native: false,
          cases: results,
        },
        null,
        2,
      ),
    );
  }
} finally {
  await browser.close();
  await server.close();
}
