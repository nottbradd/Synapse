// Comparable screenshots of the real Tauri WebView, with persistent fixture IDs.
import { chromium, expect } from "@playwright/test";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222"),
  context = browser.contexts()[0],
  page = context.pages()[0];
const phase = process.argv[2] ?? "after";
const output = path.resolve(".local", `refinement-${phase}`);
await mkdir(output, { recursive: true });
const invoke = (command, args = {}) =>
  page.evaluate(
    ({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args),
    { command, args },
  );
let fixture;
if (phase === "before") {
  const source = JSON.parse(
    await readFile(".local/capture-vault.json", "utf8"),
  );
  const root = path.join(
    tmpdir(),
    "synapse-desktop-qa",
    `refinement-${Date.now()}`,
    "Synapse visual verification",
  );
  await cp(source.root, root, {
    recursive: true,
    filter: (file) => path.basename(file) !== "flashcards.json",
  });
  const snapshot = await invoke("open_vault", { path: root });
  const dense = JSON.parse(await readFile(".local/update-qa.json", "utf8"));
  fixture = {
    root,
    canonicalRoot: snapshot.root,
    denseRoot: dense.root,
    dense: dense.dense,
  };
  await writeFile(
    ".local/refinement-fixture.json",
    JSON.stringify(fixture, null, 2),
  );
} else
  fixture = JSON.parse(
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
console.log(JSON.stringify({ phase, output, url: page.url(), fixture }));
await browser.close();
