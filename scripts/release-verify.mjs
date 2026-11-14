import { chromium, expect } from "@playwright/test";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
const qa = JSON.parse(await readFile(".local/update-qa.json", "utf8"));
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const context = browser.contexts()[0],
  page = context.pages()[0];
await page.waitForFunction(() => !!window.__TAURI_INTERNALS__?.invoke);
if (!page.url().startsWith("http://tauri.localhost"))
  throw Error("Use the packaged release for this check");
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
const invoke = (command, args = {}) =>
  page.evaluate(
    ({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args),
    { command, args },
  );
await page.setViewportSize({ width: 1440, height: 900 });
await page.getByRole("button", { name: "University", exact: true }).click();
await expect(page.locator(".graph-heading")).toContainText("University");
await page
  .getByRole("button", { name: "New note", exact: true })
  .first()
  .click();
await page
  .getByLabel("Note name", { exact: true })
  .fill("nested/Release check");
await page.getByRole("button", { name: "Create note", exact: true }).click();
await expect(page.getByRole("dialog")).toHaveCount(0);
await page.getByRole("button", { name: "Split", exact: true }).click();
const editor = page.getByRole("textbox", { name: "Markdown editor" });
const text =
  "# Release check\n\n$$F=ma$$\n\n[[University/Physics/nested/Missing#Definition|Missing]]\n\nRelease term :: Release answer\n";
await editor.fill(text);
await editor.press("Control+s");
await expect(page.locator(".editor-status")).toContainText("All changes saved");
await expect(page.locator(".preview .katex")).toHaveCount(1);
await page.locator(".preview .wiki-link").click();
await page
  .getByRole("button", { name: "Create missing note", exact: true })
  .click();
await expect(
  page.getByLabel("Vault-relative note path", { exact: true }),
).toHaveValue("University/Physics/nested/Missing");
await page.getByRole("button", { name: "Create note", exact: true }).click();
await expect(page.getByRole("dialog")).toHaveCount(0);
expect(
  await readFile(
    path.join(qa.root, "University/Physics/nested/Missing.md"),
    "utf8",
  ),
).toContain("# Missing");
await page.getByRole("button", { name: "Close note", exact: true }).click();
await page.locator(".note-row").filter({ hasText: "Release check" }).click();
await editor.press("Control+End");
await editor.pressSequentially("Unsaved close check");
await invoke("plugin:window|close", { label: "main" });
await expect(page.getByRole("alertdialog")).toBeVisible();
await page.getByRole("button", { name: "Cancel", exact: true }).click();
await editor.press("Control+s");
await expect(page.locator(".editor-status")).toContainText("All changes saved");
await context.setOffline(true);
await page.reload();
await expect(page.locator(".graph-heading")).toContainText("University");
await page.locator(".note-row").filter({ hasText: "Release check" }).click();
await page.getByRole("button", { name: "Split", exact: true }).click();
await expect(page.locator(".preview .katex")).toHaveCount(1);
await editor.press("Control+End");
await editor.pressSequentially(" Offline save verified");
await editor.press("Control+s");
await expect(page.locator(".editor-status")).toContainText("All changes saved");
expect(
  await readFile(
    path.join(qa.root, "University/Physics/nested/Release check.md"),
    "utf8",
  ),
).toContain("Offline save verified");
await page.getByRole("button", { name: "Close note", exact: true }).click();
await page.locator(".review-entry").click();
await expect(page.locator(".review-content")).toContainText("Release term");
await page.getByRole("button", { name: /Reveal answer/ }).click();
await page.getByRole("button", { name: /Good 3/ }).click();
await expect(page.getByText("Reviews complete", { exact: true })).toBeVisible();
await page
  .getByRole("button", { name: "Close review", exact: true })
  .first()
  .click();
await context.setOffline(false);
// Several Neurons remain visible when note groups are collapsed.
while (
  await page.locator('.subject-row .disclosure[aria-expanded="true"]').count()
)
  await page
    .locator('.subject-row .disclosure[aria-expanded="true"]')
    .first()
    .click();
await page.getByRole("button", { name: qa.dense.name, exact: true }).click();
await page.waitForTimeout(2500);
await page.getByRole("button", { name: "Fit graph", exact: true }).click();
await page.waitForTimeout(500);
await page.screenshot({ path: path.resolve(".local/release-dense.png") });
const zoom = await page.locator(".graph-controls>span").innerText();
const before = await page.locator(".graph canvas").first().screenshot();
const notePath = path.join(qa.root, qa.dense.root, "Concept 0.md");
await writeFile(
  notePath,
  (await readFile(notePath, "utf8")) + "\n\nA plain body edit\n",
);
await page.waitForTimeout(1500);
const after = await page.locator(".graph canvas").first().screenshot();
expect(await page.locator(".graph-controls>span").innerText()).toBe(zoom);
if (!before.equals(after))
  throw Error("Ordinary edit changed graph camera, positions or rendering");
await page.getByLabel("Search notes", { exact: true }).fill("long note title");
await page.screenshot({ path: path.resolve(".local/release-search.png") });
await page.getByRole("button", { name: "Clear search" }).click();
const cdp = await context.newCDPSession(page),
  scales = [];
await page.setViewportSize({ width: 1000, height: 700 });
for (const scale of [1.5, 2]) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 1000,
    height: 700,
    screenWidth: 1000,
    screenHeight: 700,
    deviceScaleFactor: scale,
    mobile: false,
  });
  // Start the renderer at this density so the graph allocates its backing store
  // using the same DPR as the window, as it does on a scaled Windows display.
  await page.reload();
  await expect(page.locator(".graph-heading")).toContainText(qa.dense.name);
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: "Fit graph", exact: true }).click();
  await page.waitForTimeout(350);
  scales.push(
    await page.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
      dpr: devicePixelRatio,
      overflow: document.documentElement.scrollWidth > innerWidth,
      canvasWidth: document.querySelector(".graph canvas").width,
    })),
  );
  expect(scales.at(-1).canvasWidth).toBe(1000 * scale);
  await page.screenshot({
    path: path.resolve(`.local/release-scale-${scale}.png`),
  });
}
await cdp.send("Emulation.clearDeviceMetricsOverride");
await page.setViewportSize({ width: 1440, height: 900 });
await page.reload();
await expect(page.locator(".graph-heading")).toContainText(qa.dense.name);
await page.getByRole("button", { name: "New Neuron", exact: true }).click();
await expect(page.getByRole("dialog")).toBeVisible();
await page.keyboard.press("Escape");
await expect(page.getByRole("dialog")).toHaveCount(0);
expect(
  await page
    .getByRole("button", { name: "New Neuron", exact: true })
    .evaluate((e) => e === document.activeElement),
).toBe(true);
await page.emulateMedia({ reducedMotion: "reduce" });
await page.getByRole("button", { name: "Fit graph", exact: true }).click();
await page.screenshot({
  path: path.resolve(".local/release-reduced-motion.png"),
});
const style = await page.addStyleTag({
  content:
    ".glass{backdrop-filter:none!important;background:#252e35!important}",
});
await page.screenshot({
  path: path.resolve(".local/release-opaque-fallback.png"),
});
await style.evaluate((e) => e.remove());
const empty = path.resolve(".local", `empty-${Date.now()}`);
await mkdir(empty);
await invoke("open_vault", { path: empty });
await page.reload();
await expect(page.getByText("No notes yet", { exact: true })).toBeVisible();
await page.screenshot({ path: path.resolve(".local/release-empty.png") });
await invoke("open_vault", { path: qa.root });
await page.reload();
await expect(page.locator(".graph-heading")).toContainText(qa.dense.name);
const result = {
  errors,
  scales,
  stableCanvas: true,
  offline: true,
  explicitMissingLink: true,
  focusRestored: true,
  emptyState: true,
};
await writeFile(".local/release-qa.json", JSON.stringify(result, null, 2));
if (errors.length || scales.some((s) => s.overflow))
  throw Error(JSON.stringify(result));
console.log(JSON.stringify(result));
await browser.close();
