import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const page = browser.contexts()[0].pages()[0];
// Canvas hit-test using the uniquely colored Specialist node.
const point = await page
  .locator(".graph canvas")
  .first()
  .evaluate((canvas) => {
    const data = canvas
      .getContext("2d")
      .getImageData(0, 0, canvas.width, canvas.height).data;
    let x = 0,
      y = 0,
      count = 0;
    for (let i = 0; i < data.length; i += 4)
      if (data[i] === 168 && data[i + 1] === 85 && data[i + 2] === 247) {
        const pixel = i / 4;
        x += pixel % canvas.width;
        y += Math.floor(pixel / canvas.width);
        count++;
      }
    if (!count) throw new Error("Specialist node not painted");
    const box = canvas.getBoundingClientRect();
    return {
      x: box.x + ((x / count) * box.width) / canvas.width,
      y: box.y + ((y / count) * box.height) / canvas.height,
    };
  });
await page.mouse.click(point.x, point.y);
await expect(page.locator(".editor-header")).toContainText(
  "Complex numbers.md",
);
await page.locator(".revision-entry button").click();
await page.getByLabel("Review subject").selectOption("specialist");
await page.getByRole("button", { name: "Reveal answer" }).click();
await page.getByRole("button", { name: /Again 1/ }).click();
await expect(
  page.getByText("Give it a moment.", { exact: true }),
).toBeVisible();
console.log(
  "Graph node click and Again deferral passed. Waiting for the actual 60-second due time.",
);
const performanceVault = path.resolve(
  ".local",
  `performance-vault-${Date.now()}`,
);
await mkdir(performanceVault, { recursive: true });
for (let i = 0; i < 500; i++)
  await writeFile(
    path.join(performanceVault, `${i}.md`),
    `---\nsubject: ${["physics", "methods", "spesh", "englang", "general"][i % 5]}\n---\n# Topic ${i}\n\n[[./${(i + 1) % 500}]]\n\nTerm ${i} :: Definition ${i}\n`,
  );
await expect(page.getByRole("button", { name: "Reveal answer" })).toBeVisible({
  timeout: 70000,
});
await page.getByRole("button", { name: "Reveal answer" }).click();
await page.getByRole("button", { name: /Good 3/ }).click();
await expect(
  page.getByText("You’re up to date.", { exact: true }),
).toBeVisible();
await page.getByRole("button", { name: "Back to your notes" }).click();
const before = Date.now();
const snapshot = await page.evaluate(
  (root) => window.__TAURI_INTERNALS__.invoke("open_vault", { path: root }),
  performanceVault,
);
const scanMs = Date.now() - before;
await page.reload();
await expect(page.locator(".note-list .note-item")).toHaveCount(500);
await expect(page.locator(".graph-caption")).toContainText("500 connections");
await page.getByRole("button", { name: "Fit graph", exact: true }).click();
await page.getByRole("button", { name: "Zoom in", exact: true }).click();
await page
  .getByRole("button", { name: "Reset graph view", exact: true })
  .click();
await page.getByLabel("Search notes", { exact: true }).fill("499");
await expect(page.locator(".note-list .note-item")).toHaveCount(1);
await page.locator(".note-item").click();
await expect(page.locator(".editor-header")).toContainText("499.md");
console.log(
  JSON.stringify({
    result: "passed",
    checks: [
      "canvas node click",
      "Again reappears after 60 seconds",
      "Good removes future card",
      "500-node graph load",
      "fit/zoom/reset",
      "500-note search and editor",
    ],
    notes: snapshot.notes.length,
    edges: snapshot.edges.length,
    scanAndIpcMs: scanMs,
    performanceVault,
  }),
);
await browser.close();
