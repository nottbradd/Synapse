// Run against a fresh QA desktop instance with a disposable Network Lab copy already open.
import assert from "node:assert/strict";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, expect } from "@playwright/test";

const [endpoint, vaultPath, output] = process.argv.slice(2);
if (!endpoint || !vaultPath || !output) {
  throw new Error(
    "Usage: node scripts/all-notes-desktop.mjs <loopback CDP URL> <open Network Lab folder> <capture directory>",
  );
}
assert(
  ["localhost", "127.0.0.1", "[::1]"].includes(new URL(endpoint).hostname),
);
const browser = await chromium.connectOverCDP(endpoint, { noDefaults: true });
try {
  const pages = browser.contexts().flatMap((context) => context.pages());
  const page = pages.find(
    (item) => new URL(item.url()).hostname === "tauri.localhost",
  );
  assert(
    page,
    "Open the packaged QA desktop app with WebView2 debugging enabled",
  );
  const button = (name) => page.getByRole("button", { name, exact: true });
  const drawer = page.locator(".note-title h2");
  const root = await page
    .locator(".vault-heading strong")
    .getAttribute("title");
  assert(root);
  assert.equal(
    await realpath(root),
    await realpath(vaultPath),
    "The QA vault must be open",
  );
  await expect(drawer).toBeHidden();
  const counts = await page.evaluate(async (root) => {
    const snapshot = await window.__TAURI_INTERNALS__.invoke("refresh_vault", {
      vaultRoot: root,
    });
    const hub = snapshot.notes.find((note) => note.title === "Mechanics");
    return {
      notes: snapshot.notes.length,
      links: snapshot.edges.length,
      neighbors: hub?.neighbors,
    };
  }, root);
  assert.deepEqual(counts, { notes: 4096, links: 10688, neighbors: 56 });
  await mkdir(output, { recursive: true });
  const heading = page.locator(".map-heading"),
    zoom = page.locator(".map-controls > span");
  const started = performance.now();
  const workers = new Set();
  page.on("worker", (worker) => workers.add(new URL(worker.url()).pathname));
  await button("All Notes").click();
  await expect(heading).toContainText("4,096 notes");
  await expect(heading).toContainText("10,688 links");
  await expect(page.locator(".map-status")).toHaveCount(0, { timeout: 60000 });
  await expect(zoom).toHaveText("100%");
  const openMs = Math.round(performance.now() - started);
  await page.evaluate(() => document.fonts.ready.then(() => null));
  await page.mouse.move(2, 2);
  await page.screenshot({ path: path.join(output, "all-notes.png") });
  await button("Jump to note").click();
  const input = page.getByRole("combobox", { name: "Find a note or hub" });
  await input.fill("Mechanics");
  await input.press("Enter");
  await expect(drawer).toHaveAttribute("title", "Mechanics");
  await button("Read").click();
  await expect(zoom).toHaveText("255%");
  await expect(
    page
      .locator(".wiki-link")
      .filter({ hasText: /^Momentum$/ })
      .first(),
  ).toBeVisible();
  // The zoom readout rounds to an integer before the last fraction of the shared spring settles.
  await expect
    .poll(() =>
      page
        .locator(".map-controls")
        .evaluate((el) =>
          el.closest(".all-notes-graph").style.getPropertyValue("--map-drawer"),
        ),
    )
    .toBe(
      (await page
        .locator(".editor-shell")
        .evaluate((el) => Math.round(el.getBoundingClientRect().width) + 32)) +
        "px",
    );
  await page.mouse.move(2, 2);
  await page.screenshot({ path: path.join(output, "all-notes-mechanics.png") });
  await button("Explore linked notes").click();
  await expect(page.locator(".graph-heading")).toContainText(
    "56 linked concepts",
  );
  await button("Back to previous network").click();
  await expect(drawer).toHaveAttribute("title", "Mechanics");
  await expect(zoom).toHaveText("255%");
  await button("Fit network").click();
  await expect(drawer).toBeHidden();
  await expect(zoom).toHaveText("100%");
  const assets = await page.evaluate(() =>
    [
      ...document.querySelectorAll(
        'script[type="module"][src], link[rel="stylesheet"][href]',
      ),
    ]
      .map((el) => new URL(el.src || el.href).pathname)
      .filter((name) => name.startsWith("/assets/")),
  );
  await writeFile(
    path.join(output, "all-notes.json"),
    JSON.stringify(
      { ...counts, openMs, assets: [...assets, ...workers] },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
