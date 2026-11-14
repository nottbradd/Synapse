// The native dialog response alone is supplied by this harness. Every app command,
// validation, archive, watcher and filesystem operation uses the actual Rust backend.
// Native picker rendering is inspected separately with Windows computer use.
import { chromium, expect } from "@playwright/test";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
const qa = JSON.parse(await readFile(".local/update-qa.json", "utf8"));
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const context = browser.contexts()[0],
  page = context.pages()[0];
await page.waitForFunction(() => !!window.__TAURI_INTERNALS__?.invoke);
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
await page.route("**/@tauri-apps_plugin-dialog.js*", (route) =>
  route.fulfill({
    contentType: "application/javascript",
    body: "export async function open(){return window.qaOpenPath;} export async function save(){return window.qaSavePath;}",
  }),
);
await invoke("open_vault", { path: qa.root });
await page.reload();
await expect(page.locator(".hierarchy")).toBeVisible();
const exported = path.resolve(
  ".local",
  `ui-export-${Date.now()}.synapse-subject`,
);
await page.evaluate((output) => {
  window.qaSavePath = output;
}, exported);
await page.locator(`[data-menu-id="${qa.custom.id}"]`).click();
await page.getByRole("menuitem", { name: "Export subject" }).click();
await expect(page.getByLabel("Include review history")).not.toBeChecked();
await page.screenshot({ path: path.resolve(".local/update-export.png") });
await page
  .getByRole("button", { name: "Choose destination", exact: true })
  .click();
await expect(page.getByRole("dialog")).toHaveCount(0);
if ((await stat(exported)).size === 0) throw Error("Export is empty");
const freshPreview = await invoke("inspect_subject", {
  vaultRoot: qa.canonicalRoot,
  path: exported,
});
if (freshPreview.has_history) throw Error("Export included history by default");
await invoke("discard_subject_import");
const withHistory = path.resolve(
  ".local",
  `history-export-${Date.now()}.synapse-subject`,
);
await invoke("export_subject", {
  vaultRoot: qa.canonicalRoot,
  subjectId: qa.custom.id,
  path: withHistory,
  includeHistory: true,
});
await page.evaluate((file) => {
  window.qaOpenPath = file;
}, withHistory);
await page.getByRole("button", { name: "Import subject", exact: true }).click();
await page.getByRole("button", { name: "Choose package", exact: true }).click();
await expect(
  page.getByRole("dialog").getByLabel("Name", { exact: true }),
).toHaveValue("Physics");
await page.getByLabel("Destination Neuron").selectOption(qa.university.id);
await expect(page.locator(".notice")).toContainText("Physics (2)");
await expect(
  page.getByLabel("Import included review history"),
).not.toBeChecked();
await page.screenshot({
  path: path.resolve(".local/update-import-preview.png"),
});
await page
  .getByRole("dialog")
  .getByRole("button", { name: "Import subject", exact: true })
  .click();
await expect(page.getByRole("dialog")).toHaveCount(0);
let snapshot = await invoke("refresh_vault", { vaultRoot: qa.canonicalRoot });
const copy = snapshot.organization.subjects.find(
  (s) => s.name === "Physics (2)" && s.neuron_id === qa.university.id,
);
if (!copy || copy.id === qa.custom.id)
  throw Error("Copy identity not independent");
if (
  snapshot.cards
    .filter((c) => c.subject_id === copy.id)
    .some((c) => snapshot.history.cards[c.id])
)
  throw Error("Imported private review history by default");
const source = path.resolve(
  ".local",
  `transfer-source-${Date.now()}`,
  "Physics",
);
await mkdir(path.join(source, "sub"), { recursive: true });
await writeFile(
  path.join(source, "a.md"),
  "# Motion\n\n[[sub/b#Section|The law]] [[missing#Other|External]]\n\n![Figure](plot.svg)\n\nQ: See [[sub/b#Section|law]]\nA: Answer",
);
await writeFile(
  path.join(source, "sub/b.md"),
  "# Section\n\nTerm :: Definition",
);
await writeFile(
  path.join(source, "plot.svg"),
  '<svg xmlns="http://www.w3.org/2000/svg"/>',
);
await writeFile(path.join(source, "secret.env"), "SHOULD_NOT_COPY");
await page.evaluate((file) => {
  window.qaOpenPath = file;
}, source);
await page.getByRole("button", { name: "Import subject", exact: true }).click();
await page.getByRole("button", { name: "Choose folder", exact: true }).click();
await expect(page.locator(".import-summary")).toContainText(
  "2 notes · 1 attachment",
);
await page.getByLabel("Destination Neuron").selectOption("new");
await page
  .getByLabel("New Neuron name", { exact: true })
  .fill("Imported course");
await page.getByText("1 external reference", { exact: true }).click();
await page.screenshot({
  path: path.resolve(".local/update-folder-preview.png"),
});
await page
  .getByRole("dialog")
  .getByRole("button", { name: "Import subject", exact: true })
  .click();
await expect(page.getByRole("dialog")).toHaveCount(0);
snapshot = await invoke("refresh_vault", { vaultRoot: qa.canonicalRoot });
const folderSubject = snapshot.organization.subjects.find(
  (s) => s.id === snapshot.organization.location.subject_id,
);
const importedNote = snapshot.notes.find(
  (n) => n.subject_id === folderSubject.id && n.id.endsWith("/a.md"),
);
const text = await readFile(path.join(qa.root, importedNote.id), "utf8");
if (!text.includes(`${folderSubject.root}/sub/b#Section|The law`))
  throw Error("Internal WikiLink was not remapped");
if (
  !snapshot.links.some(
    (l) =>
      l.source === importedNote.id &&
      l.external &&
      l.raw === "missing#Other|External",
  )
)
  throw Error("External WikiLink lost");
const before = snapshot.organization.subjects.length;
await page.getByRole("button", { name: "Import subject", exact: true }).click();
await page.getByRole("button", { name: "Choose folder", exact: true }).click();
await expect(page.locator(".import-summary")).toBeVisible();
await page.getByRole("button", { name: "Cancel", exact: true }).click();
snapshot = await invoke("refresh_vault", { vaultRoot: qa.canonicalRoot });
if (snapshot.organization.subjects.length !== before)
  throw Error("Cancel changed registry");
const invalid = path.resolve(".local", `invalid-${Date.now()}.synapse-subject`);
await writeFile(invalid, "not a zip");
await page.evaluate((file) => {
  window.qaOpenPath = file;
}, invalid);
await page.getByRole("button", { name: "Import subject", exact: true }).click();
await page.getByRole("button", { name: "Choose package", exact: true }).click();
await expect(page.locator(".form-error")).toBeVisible();
await page.screenshot({ path: path.resolve(".local/update-import-error.png") });
await page.keyboard.press("Escape");
await expect(page.getByRole("dialog")).toHaveCount(0);
await writeFile(
  ".local/transfer-qa.json",
  JSON.stringify(
    {
      root: qa.root,
      exported,
      copy,
      folderSubject,
      checks:
        "export default, native-response boundary, preview, conflict name, independent identity, folder import, destination creation, attachments, link remap, external refs, cancellation, malformed package",
      errors,
    },
    null,
    2,
  ),
);
if (errors.length) throw Error(errors.join("\n"));
console.log("Transfer UI passed; only native dialog responses substituted");
await browser.close();
