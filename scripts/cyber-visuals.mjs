// Comparable screenshots of the real Tauri WebView, with persistent fixture IDs.
import { chromium, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222"),
  context = browser.contexts()[0],
  page = context.pages()[0];
const phase = process.argv[2] ?? "after";
const output = path.resolve(".local", `cyber-${phase}`);
await mkdir(output, { recursive: true });
const invoke = (command, args = {}) =>
  page.evaluate(
    ({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args),
    { command, args },
  );
const fixture = JSON.parse(
  await readFile(".local/refinement-fixture.json", "utf8"),
);
await context.setOffline(false);
await page.emulateMedia({ reducedMotion: "no-preference" });
const open = async (root, location = { neuron_id: null, subject_id: null }) => {
  const s = await invoke("open_vault", { path: root });
  await invoke("organize", {
    vaultRoot: s.root,
    action: { kind: "select", location },
  });
  await page.reload();
  await expect(page.locator(".sidebar")).toBeVisible();
  await page.waitForTimeout(2100);
};
const shot = async (name) => {
  await page.mouse.move(1550, 970);
  await page.screenshot({ path: path.join(output, `${name}.png`) });
};
await page.setViewportSize({ width: 1600, height: 1000 });
await open(fixture.root);
await page.getByRole("button", { name: "Fit graph", exact: true }).click();
await page.waitForTimeout(1200);
await shot("overview");
await page
  .locator(".note-row")
  .filter({ hasText: "Conservation of momentum" })
  .click();
await page.waitForTimeout(1200);
await shot("drawer");
await page.getByRole("button", { name: "Close note", exact: true }).click();
await page
  .locator(".subject-row .row-name")
  .filter({ hasText: /^Physics$/ })
  .click();
await page.waitForTimeout(1300);
await shot("subject");
await page.locator(".review-entry").click();
await page.getByRole("button", { name: /Reveal answer/ }).click();
await page.waitForTimeout(300);
await shot("review");
await page
  .getByRole("button", { name: "Close review", exact: true })
  .first()
  .click();
await page.getByRole("button", { name: "All Neurons", exact: true }).click();
await page.setViewportSize({ width: 900, height: 600 });
await page.getByRole("button", { name: "Fit graph", exact: true }).click();
await page.waitForTimeout(1200);
await shot("small");
await page.setViewportSize({ width: 1600, height: 1000 });
await page.emulateMedia({ reducedMotion: "reduce" });
await page
  .locator(".note-row")
  .filter({ hasText: "Conservation of momentum" })
  .click();
await page.waitForTimeout(200);
await shot("reduced-motion");
await page.getByRole("button", { name: "Close note", exact: true }).click();
await page.emulateMedia({ reducedMotion: "no-preference" });
await page.getByRole("button", { name: "Fit graph", exact: true }).click();
await page.waitForTimeout(1200);
// The class is also used by the updated app's genuine @supports fallback rules.
await page.evaluate(() =>
  document.documentElement.classList.add("opaque-materials"),
);
const fallback =
  phase === "before"
    ? await page.addStyleTag({
        content:
          ".glass{backdrop-filter:none!important;background:#252e35!important}",
      })
    : null;
await shot("opaque-fallback");
await fallback?.evaluate((e) => e.remove());
await page.evaluate(() =>
  document.documentElement.classList.remove("opaque-materials"),
);
await open(fixture.denseRoot, {
  neuron_id: fixture.dense.neuron_id,
  subject_id: fixture.dense.id,
});
await page.getByRole("button", { name: "Fit graph", exact: true }).click();
await page.waitForTimeout(1200);
await shot("dense");
await open(fixture.root);
await page.getByRole("button", { name: "Preferences", exact: true }).click();
await shot("settings-api");
await page.getByLabel("Default timezone").scrollIntoViewIfNeeded();
await shot("settings-reminders");
await page
  .getByRole("button", { name: "Close preferences", exact: true })
  .click();
await page.getByRole("button", { name: "Create", exact: true }).click();
for (const kind of ["Quiz", "Flashcards", "Reminder"]) {
  await page.getByRole("tab", { name: kind, exact: true }).click();
  await page.waitForTimeout(250);
  await shot(`create-${kind.toLowerCase()}`);
}
await page
  .getByRole("button", { name: "Close study drawer", exact: true })
  .click();
const session = await context.newCDPSession(page);
await page.setViewportSize({ width: 1200, height: 800 });
for (const dpr of [1.5, 2]) {
  await session.send("Emulation.setDeviceMetricsOverride", {
    width: 1200,
    height: 800,
    deviceScaleFactor: dpr,
    mobile: false,
  });
  await page.reload();
  await expect(page.locator(".sidebar")).toBeVisible();
  await page.waitForTimeout(1800);
  await page.getByRole("button", { name: "Fit graph", exact: true }).click();
  await page.waitForTimeout(1000);
  expect(
    await page.evaluate(() =>
      [...document.querySelectorAll(".graph canvas")].map((c) => c.width),
    ),
  ).toEqual([1200 * dpr, 1200 * dpr]);
  // Capture directly: Playwright's screenshot viewport reset would undo the
  // explicit DPR override before the graph's ResizeObserver catches up.
  const captured = await session.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
  });
  await writeFile(
    path.join(output, `renderer-dpr-${dpr}.png`),
    Buffer.from(captured.data, "base64"),
  );
}
await session.send("Emulation.clearDeviceMetricsOverride");
await page.setViewportSize({ width: 900, height: 600 });
await page.reload();
await expect(page.locator(".sidebar")).toBeVisible();
await page.getByRole("button", { name: "Fit graph", exact: true }).click();
await page.waitForTimeout(1200);
const overviewZoom = await page.locator(".graph-controls span").innerText();
await page.getByRole("button", { name: "Create", exact: true }).click();
await page.waitForTimeout(900);
expect(await page.locator(".graph-controls span").innerText()).toBe(
  overviewZoom,
);
await shot("small-create");
await page
  .getByRole("button", { name: "Close study drawer", exact: true })
  .click();
await page.setViewportSize({ width: 1600, height: 1000 });
await context.setOffline(true);
await page
  .locator(".note-row")
  .filter({ hasText: "Conservation of momentum" })
  .click();
await page.waitForTimeout(800);
await shot("offline-note");
await context.setOffline(false);
await page.getByRole("button", { name: "Close note", exact: true }).click();
console.log(JSON.stringify({ phase, output, url: page.url(), fixture }));
await browser.close();
