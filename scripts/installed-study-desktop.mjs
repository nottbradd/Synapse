// Real installed-app manual scheduling and local library verification. Synthetic vault only.
import { chromium, expect } from "@playwright/test";
import { cp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { recordDesktop } from "./record-desktop.mjs";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const context = browser.contexts()[0],
  page = context.pages()[0];
if (!page.url().startsWith("http://tauri.localhost"))
  throw Error("Use the installed release");
const invoke = (command, args = {}) =>
  page.evaluate(
    ({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args),
    { command, args },
  );
const fixture = JSON.parse(
  await readFile(".local/refinement-fixture.json", "utf8"),
);
const root = path.join(
  tmpdir(),
  "synapse-desktop-qa",
  `installed-${Date.now()}`,
);
await cp(fixture.root, root, { recursive: true });
const snapshot = await invoke("open_vault", { path: root });
await invoke("organize", {
  vaultRoot: snapshot.root,
  action: { kind: "select", location: { neuron_id: null, subject_id: null } },
});
await page.reload();
await expect(page.locator(".sidebar")).toBeVisible();
await page.setViewportSize({ width: 1600, height: 1000 });
const settings = await invoke("device_settings");
assert.equal(settings.test_api, false);
const originalSettings = {
  model: settings.model,
  max_output_tokens: settings.max_output_tokens,
  timezone: settings.timezone,
  background: settings.background,
};
const originalStartup = await invoke("startup_state");
await invoke("set_startup", { enabled: true });
assert.equal(await invoke("startup_state"), true);
await invoke("set_startup", { enabled: originalStartup });
await invoke("save_device_settings", {
  settings: { ...originalSettings, background: true },
});
const report = {
  root,
  canonicalRoot: snapshot.root,
  originalSettings,
  originalStartup,
  url: page.url(),
  testApi: false,
  checks: ["installed startup registration enabled, verified and restored"],
};
await writeFile(".local/cyber-installed.json", JSON.stringify(report, null, 2));
const recording = await recordDesktop({
  page,
  context,
  name: "Synapse-0.4.0-installed",
  fixture: root,
});
await recording.mark("click-to-focus");
await page
  .locator(".note-row")
  .filter({ hasText: "Conservation of momentum" })
  .click();
await page.waitForTimeout(1100);
await recording.mark("retarget", 0.9);
await page
  .locator(".note-row")
  .filter({ hasText: /^Impulse$/ })
  .click();
await page.waitForTimeout(100);
await page
  .locator(".note-row")
  .filter({ hasText: "Conservation of momentum" })
  .click();
await page.waitForTimeout(1200);
await recording.mark("overview restoration");
await page.getByRole("button", { name: "Close note", exact: true }).click();
await page.waitForTimeout(1000);
await page
  .locator(".note-row")
  .filter({ hasText: "Conservation of momentum" })
  .click();
await page.getByRole("button", { name: "Create", exact: true }).click();
await page.getByRole("tab", { name: "Reminder", exact: true }).click();
await page
  .getByRole("button", { name: "Start a manual reminder", exact: true })
  .click();
await page.getByLabel("Reminder title").fill("Revise conservation of momentum");
const at = Date.now() + 45000;
const parts = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Australia/Sydney",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
}).formatToParts(at);
const part = (key) => parts.find((p) => p.type === key).value;
const local = `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}:${part("second")}`;
await page.getByLabel("Reminder date and time").fill(local);
await expect(
  page.getByRole("button", { name: "Save reminder", exact: true }),
).toBeEnabled();
await page.waitForTimeout(1200);
await page.getByRole("button", { name: "Save reminder", exact: true }).click();
await expect(
  page.getByRole("heading", {
    name: "Revise conservation of momentum",
    exact: true,
  }),
).toBeVisible();
const study = await invoke("study_list", { vaultRoot: snapshot.root });
report.reminderId = study.data.reminders[0].id;
report.due = study.data.reminders[0].next_due;
report.checks.push("manual reminder preview and save in installed build");
await writeFile(".local/cyber-installed.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify({ saved: true, due: report.due, root }));
await page.waitForTimeout(1500);
await page
  .getByRole("button", { name: "Close study drawer", exact: true })
  .click();
await page.getByRole("button", { name: "Close note", exact: true }).click();
await page.waitForTimeout(1200);
await recording.finish();
await browser.close();
