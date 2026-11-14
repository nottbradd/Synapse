import { chromium, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const context = browser.contexts()[0],
  page = context.pages()[0];
if (page.url().includes(":1420"))
  throw new Error("Run this check against the production executable.");
await expect(page.locator(".note-list .note-item")).toHaveCount(7);
await page.locator(".revision-entry button").click();
await expect(page.locator(".review-meta")).toContainText("6 new");
await page.getByRole("button", { name: "Close review", exact: true }).click();
await context.setOffline(true);
await page.reload();
await expect(page.locator(".note-list .note-item")).toHaveCount(7);
await page.locator(".note-item").filter({ hasText: "Smoke check" }).click();
const editor = page.getByRole("textbox", { name: "Markdown editor" });
await expect(page.locator(".preview .katex")).toHaveCount(2);
await editor.press("Control+End");
await editor.pressSequentially("\nOffline edit");
await page.evaluate(() =>
  window.__TAURI_INTERNALS__.invoke("plugin:window|close", { label: "main" }),
);
await expect(page.getByRole("alertdialog")).toBeVisible();
await page.getByRole("button", { name: "Cancel", exact: true }).click();
await editor.press("Control+s");
await expect(page.locator(".editor-status")).toContainText("All changes saved");
await page.locator(".revision-entry button").click();
await page.getByLabel("Review subject").selectOption("physics");
await page.getByRole("button", { name: "Reveal answer" }).click();
await page.getByRole("button", { name: /Easy 4/ }).click();
await expect(page.locator(".review-meta")).toContainText("1 reviewed");
const snapshot = await page.evaluate(() =>
  window.__TAURI_INTERNALS__.invoke("restore_vault"),
);
if (
  !(
    await readFile(
      snapshot.root.replace(/^\\\\\?\\/, "") + "/Physics/Smoke check.md",
      "utf8",
    )
  ).includes("Offline edit")
)
  throw new Error("Offline save absent");
await page.getByRole("button", { name: "Close review", exact: true }).click();
await page.screenshot({ path: ".local/production-offline.png" });
await context.setOffline(false);
console.log(
  JSON.stringify({
    result: "passed",
    origin: page.url(),
    checks: [
      "process restart restores vault",
      "process restart preserves review history",
      "production loads offline",
      "math renders offline",
      "notes save offline",
      "reviews persist offline",
    ],
  }),
);
await browser.close();
