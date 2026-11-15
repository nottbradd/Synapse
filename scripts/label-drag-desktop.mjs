// Exercise a genuine pointer drag, without changing label placement constraints.
import { chromium, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222"),
  page = browser.contexts()[0].pages()[0];
if (!page.url().includes(":1420"))
  throw Error("Development instrumentation only");
const fixture = JSON.parse(
  await readFile(".local/refinement-fixture.json", "utf8"),
);
await page.evaluate(async (path) => {
  const s = await window.__TAURI_INTERNALS__.invoke("open_vault", { path });
  await window.__TAURI_INTERNALS__.invoke("organize", {
    vaultRoot: s.root,
    action: { kind: "select", location: { neuron_id: null, subject_id: null } },
  });
}, fixture.root);
await page.reload();
await page.setViewportSize({ width: 1600, height: 1000 });
await expect(page.locator(".sidebar")).toBeVisible();
await page.evaluate(async () => {
  const live = performance
    .getEntriesByType("resource")
    .find(
      (r) => new URL(r.name).pathname === "/src/interaction/graphScene.ts",
    ).name;
  const { GraphScene } = await import(live);
  const configure = GraphScene.prototype.configure;
  GraphScene.prototype.configure = function (...args) {
    window.dragScene = this;
    return configure.apply(this, args);
  };
});
await page.getByLabel("Search notes", { exact: true }).fill("x");
await page.getByLabel("Search notes", { exact: true }).fill("");
await page.waitForTimeout(1600);
await page.getByRole("button", { name: "Fit graph", exact: true }).click();
await page.waitForTimeout(1000);
const overview = await page.evaluate(() => ({
  frame: window.dragScene.motion.frame,
  positions: window.dragScene.topology.data.nodes.map((n) => [n.id, n.x, n.y]),
}));
await page
  .locator(".subject-row .row-name")
  .filter({ hasText: /^Physics$/ })
  .click();
await page.waitForTimeout(1600);
const scoped = await page.evaluate(() =>
  window.dragScene.topology.data.nodes.map((n) => [n.id, n.x, n.y]),
);
expect(scoped).toEqual(
  overview.positions.filter(([id]) => id.startsWith("Physics/")),
);
await page.getByRole("button", { name: "All Neurons", exact: true }).click();
await page.waitForTimeout(1000);
expect(await page.evaluate(() => window.dragScene.motion.frame)).toEqual(
  overview.frame,
);
expect(
  await page.evaluate(() =>
    window.dragScene.topology.data.nodes.map((n) => [n.id, n.x, n.y]),
  ),
).toEqual(overview.positions);
await page
  .locator(".note-row")
  .filter({ hasText: "Conservation of momentum" })
  .click();
await page.waitForTimeout(1200);
const state = () =>
  page.evaluate(() => {
    const s = window.dragScene,
      n = s.topology.positions.get(s.selected),
      l = s.labels.states.get(s.selected);
    return {
      point: s.api.graph2ScreenCoords(n.x, n.y),
      target: l.target,
      theta: l.theta,
      frame: s.motion.frame,
      show: l.show,
    };
  });
const start = await state();
await page.mouse.move(start.point.x, start.point.y);
await page.waitForTimeout(120);
await page.mouse.down();
await page.mouse.move(1000, 340, { steps: 45 });
await page.mouse.up();
await page.mouse.move(1550, 970);
await page.waitForTimeout(700);
const outward = await state();
await page.screenshot({ path: ".local/refinement-label-outward.png" });
expect(start.target).toBe(0);
expect(outward.target).toBe(Math.PI);
expect(outward.show).toBe(true);
expect(outward.frame).toEqual(start.frame);
await writeFile(
  ".local/label-drag-report.json",
  JSON.stringify(
    { start, outward, scopePositionsStable: true, overviewRestored: true },
    null,
    2,
  ),
);
console.log(JSON.stringify({ start, outward }));
await page.reload();
await browser.close();
