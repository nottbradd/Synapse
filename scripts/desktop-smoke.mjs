// Runs against an actual Tauri WebView2 instance, never a mocked IPC layer.
// Start Synapse with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222.
import { chromium, expect } from "@playwright/test";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const context = browser.contexts()[0],
  page = context.pages()[0];
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const vault = path.resolve(".local", `smoke-vault-${Date.now()}`);
await mkdir(vault, { recursive: true });
await cp("fixtures/demo-vault", vault, { recursive: true });
await page.evaluate(
  async (root) =>
    await window.__TAURI_INTERNALS__.invoke("open_vault", { path: root }),
  vault,
);
await page.reload();
await expect(page.locator(".note-list .note-item")).toHaveCount(6);
await expect(page.locator(".graph-caption")).toContainText("6 notes");
await page.getByRole("button", { name: "Create note", exact: true }).click();
await page.getByLabel("Vault-relative path").fill("Physics/Smoke check");
await page
  .getByRole("button", { name: "Create note", exact: true })
  .last()
  .click();
const editor = page.getByRole("textbox", { name: "Markdown editor" });
await expect(editor).toBeVisible();
const content =
  "# Smoke check\n\nInline $F=ma$.\n\n$$\\int_0^1 x^2 dx = \\frac13$$\n\n[[Physics/Magnetic flux]]\n\nQ: What is acceleration?\nA: Rate of change of velocity.\n";
await editor.fill(content);
await editor.press("Control+s");
await expect(page.locator(".editor-status")).toContainText("All changes saved");
await expect(page.locator(".conflict")).toHaveCount(0);
await expect(page.locator(".notification")).toHaveCount(0);
await expect(page.locator(".preview .katex")).toHaveCount(2);
await expect(page.locator(".graph-caption")).toContainText("7 notes");
if (
  (await readFile(path.join(vault, "Physics/Smoke check.md"), "utf8")) !==
  content
)
  throw new Error("Saved bytes differ");
await editor.press("Control+End");
await editor.press("Enter");
await editor.pressSequentially("[[Mag", { delay: 70 });
await expect(page.locator(".cm-tooltip-autocomplete")).toBeVisible();
await editor.press("Enter");
await expect(editor).toContainText("[[Physics/Magnetic flux]]");
await editor.press("Control+s");
await expect(page.locator(".editor-status")).toContainText("All changes saved");
await editor.press("Control+End");
await editor.pressSequentially("\nUnsaved local change");
await page.locator(".note-item").filter({ hasText: "Register" }).click();
await expect(page.getByRole("alertdialog")).toBeVisible();
await page.getByRole("button", { name: "Cancel", exact: true }).click();
await writeFile(
  path.join(vault, "Physics/Smoke check.md"),
  content + "\nExternal change\n",
);
await expect(
  page.getByText("Changed outside Synapse", { exact: true }),
).toBeVisible({ timeout: 10000 });
await page.getByRole("button", { name: "Keep my edits", exact: true }).click();
await editor.press("Control+s");
await expect(page.locator(".editor-status")).toContainText("All changes saved");
if (
  !(
    await readFile(path.join(vault, "Physics/Smoke check.md"), "utf8")
  ).includes("Unsaved local change")
)
  throw new Error("Conflict lost local edits");
await writeFile(
  path.join(vault, "Physics/Smoke check.md"),
  content + "\nClean external refresh\n",
);
await expect(editor).toContainText("Clean external refresh", {
  timeout: 10000,
});
await page
  .locator(".subject-filters button")
  .filter({ hasText: "Physics" })
  .click();
await expect(page.locator(".graph-caption")).toContainText("4 notes");
await page
  .locator(".subject-filters button")
  .filter({ hasText: "Physics" })
  .click();
await page.getByLabel("Search notes", { exact: true }).fill("magnetic");
await expect(page.locator(".note-list .note-item")).toHaveCount(2);
await page.getByRole("button", { name: "Clear search" }).click();
await page.locator(".revision-entry button").click();
await expect(
  page.getByRole("dialog", { name: "Flashcard revision" }),
).toBeVisible();
await page.getByRole("button", { name: "Reveal answer" }).click();
await page.getByRole("button", { name: /Good 3/ }).click();
await expect(page.locator(".review-meta")).toContainText("1 reviewed");
const history = JSON.parse(
  await readFile(path.join(vault, "flashcards.json"), "utf8"),
);
if (history.schema_version !== 1 || Object.keys(history.cards).length !== 1)
  throw new Error("Review not persisted");
const first = Object.values(history.cards)[0];
if (first.due <= Date.now() / 1000) throw new Error("Good card still due");
await page.reload();
await expect(page.locator(".note-list .note-item")).toHaveCount(7);
await page.locator(".revision-entry button").click();
await expect(page.locator(".review-meta")).toContainText("6 new");
await page.getByRole("button", { name: "Close review", exact: true }).click();
await page
  .locator(".note-item")
  .filter({ hasText: "Electromagnetic induction" })
  .click();
await expect(page.locator(".preview .katex-display")).toBeVisible();
await page.screenshot({ path: ".local/desktop-smoke.png" });
if (errors.length) throw new Error(errors.join("\n"));
console.log(
  JSON.stringify(
    {
      result: "passed",
      vault,
      checks: [
        "actual Rust IPC",
        "note creation",
        "byte-exact save",
        "inline and display math",
        "graph update",
        "autocomplete",
        "unsaved navigation guard",
        "external conflict",
        "clean external refresh",
        "subject filter",
        "search",
        "review persistence",
        "reload restore",
      ],
      history,
    },
    null,
    2,
  ),
);
await browser.close();
