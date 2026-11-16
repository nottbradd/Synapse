// Installed-app regression: explicit motion must work with Windows animations off.
// No production instrumentation or API mocks. Only the later OS-change cases use media emulation.
import { chromium, expect } from "@playwright/test";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const page = browser.contexts()[0].pages()[0];
await page.waitForFunction(() => !!window.__TAURI_INTERNALS__?.invoke);
await expect(page.locator(".sidebar")).toBeVisible();
// Playwright defaults to no-preference even over CDP. Clear it before reading Windows.
await page.emulateMedia({ reducedMotion: null });
const invoke = (command, args = {}) =>
  page.evaluate(
    ({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args),
    { command, args },
  );
const fixture = JSON.parse(
  await readFile(".local/refinement-fixture.json", "utf8"),
);
const original = await invoke("restore_vault");
const root = path.join(tmpdir(), "synapse-desktop-qa", "motion-" + Date.now());
await cp(fixture.root, root, { recursive: true });
const output = path.resolve(".local/motion-0.4.1");
await mkdir(output, { recursive: true });
const beforePreferences = await page.evaluate(() =>
  localStorage.getItem("synapse.preferences.v1"),
);
const report = {
  version: await invoke("plugin:app|version"),
  nativeSystemReduced: await page.evaluate(
    () => matchMedia("(prefers-reduced-motion: reduce)").matches,
  ),
  root,
  cases: [],
};
assert.equal(report.version, "0.4.1");
const openPreferences = async () =>
  page.getByRole("button", { name: "Preferences", exact: true }).click();
const closePreferences = async () =>
  page.getByRole("button", { name: "Close preferences", exact: true }).click();
async function choose(value) {
  await openPreferences();
  await page.getByLabel("Animations", { exact: true }).selectOption(value);
  await closePreferences();
}
async function sample(name, animated) {
  const close = page.getByRole("button", { name: "Close note", exact: true });
  if (await close.count()) await close.click();
  await page.waitForTimeout(1000);
  const note = page
    .locator(".note-row")
    .filter({ hasText: "Conservation of momentum" });
  await note.scrollIntoViewIfNeeded();
  await page.evaluate(() => {
    window.motionSamples = [];
    const start = performance.now();
    const take = (at) => {
      const el = document.querySelector(".editor-shell");
      if (el) {
        const x = new DOMMatrix(getComputedStyle(el).transform).m41;
        window.motionSamples.push({
          at: at - start,
          x,
          width: el.clientWidth,
          zoom: document.querySelector(".graph-controls span")?.textContent,
          transform: el.style.transform,
        });
      }
      if (at - start < 1100) requestAnimationFrame(take);
    };
    requestAnimationFrame(take);
  });
  await note.click();
  await page.waitForTimeout(1200);
  const frames = await page.evaluate(() => window.motionSamples);
  const intermediate = frames.filter((f) => f.x > 2 && f.x < f.width - 2);
  const unique = new Set(intermediate.map((f) => Math.round(f.x)));
  const zooms = new Set(frames.map((f) => f.zoom)).size;
  await writeFile(
    path.join(output, name + "-frames.json"),
    JSON.stringify(frames),
  );
  assert.equal(
    await page.locator(".app").getAttribute("data-motion"),
    animated ? "full" : "reduced",
  );
  assert.ok(
    animated ? unique.size >= 5 : unique.size === 0,
    name +
      ": " +
      JSON.stringify({
        unique: unique.size,
        first: frames[0],
        last: frames.at(-1),
        zooms: new Set(frames.map((f) => f.zoom)).size,
      }),
  );
  assert.ok(Math.abs(frames.at(-1).x) < 1, name + ": drawer did not settle");
  assert.ok(
    animated ? zooms >= 5 : zooms <= 2,
    name + ": camera did not follow the selected motion mode",
  );
  report.cases.push({
    name,
    animated,
    intermediatePositions: unique.size,
    frames: frames.length,
    cameraZoomSteps: zooms,
  });
}
try {
  const snapshot = await invoke("open_vault", { path: root });
  await invoke("organize", {
    vaultRoot: snapshot.root,
    action: { kind: "select", location: { neuron_id: null, subject_id: null } },
  });
  await page.reload();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator(".sidebar")).toBeVisible();
  await page.waitForTimeout(1800);
  await choose("system");
  await openPreferences();
  await expect(page.locator("#motion-description")).toContainText(
    report.nativeSystemReduced
      ? "Windows animations are off"
      : "Windows animations are on",
  );
  await page.screenshot({ path: path.join(output, "follow-windows.png") });
  await closePreferences();
  await sample("native-system", !report.nativeSystemReduced);
  await choose("full");
  await openPreferences();
  await page.screenshot({ path: path.join(output, "full-motion.png") });
  const duration = await page
    .getByRole("button", { name: "Close preferences" })
    .evaluate((el) => getComputedStyle(el).transitionDuration);
  assert.notEqual(duration, "0s", "OS CSS rules must not override Full");
  await closePreferences();
  await sample("native-full", true);
  await page.reload();
  await expect(page.locator(".sidebar")).toBeVisible();
  await sample("full-after-reload", true);
  await choose("reduced");
  await sample("explicit-reduced", false);
  await choose("system");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await sample("system-live-full", true);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await sample("system-live-reduced", false);
  await choose("full");
  await sample("full-overrides-reduced", true);
  const after = JSON.parse(
    await page.evaluate(() => localStorage.getItem("synapse.preferences.v1")),
  );
  if (beforePreferences) {
    const before = JSON.parse(beforePreferences);
    assert.equal(after.sound, before.sound);
    assert.equal(after.volume, before.volume);
  }
  report.success = true;
} finally {
  // Restore real Windows media preference; retain the user's requested Full motion choice.
  await page.emulateMedia({ reducedMotion: null });
  if (report.success) await choose("full");
  else
    await page.evaluate((raw) => {
      if (raw === null) localStorage.removeItem("synapse.preferences.v1");
      else localStorage.setItem("synapse.preferences.v1", raw);
    }, beforePreferences);
  if (original) {
    await invoke("open_vault", { path: original.root });
    await invoke("organize", {
      vaultRoot: original.root,
      action: { kind: "select", location: original.organization.location },
    });
    await page.reload();
  }
  await writeFile(
    path.join(output, "report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
  await browser.close();
}
