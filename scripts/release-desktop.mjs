// Installed release regression, with real Rust IPC and no provider requests.
// All writes are confined to a copied synthetic vault; settings are preserved.
import { chromium, expect } from "@playwright/test";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { recordDesktop } from "./record-desktop.mjs";

const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const context = browser.contexts()[0],
  page = context.pages()[0];
const invoke = (command, args = {}) =>
  page.evaluate(
    ({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args),
    { command, args },
  );
const output = path.resolve(".local/release-0.5.1");
await mkdir(output, { recursive: true });
const original = await invoke("restore_vault");
const beforeSettings = await invoke("device_settings");
const beforePreferences = await page.evaluate(() =>
  localStorage.getItem("synapse.preferences.v1"),
);
const fixture = JSON.parse(
  await readFile(".local/refinement-fixture.json", "utf8"),
);
const root = path.join(
  tmpdir(),
  "synapse-desktop-qa",
  `release-051-${Date.now()}`,
);
await cp(fixture.root, root, { recursive: true });
const report = {
  version: await invoke("plugin:app|version"),
  url: page.url(),
  root,
  beforeSettings,
  preferences: JSON.parse(beforePreferences),
  checks: [],
  errors: [],
};
page.on("pageerror", (error) => report.errors.push(error.message));
await writeFile(
  path.join(output, "restore.json"),
  JSON.stringify({ original, beforePreferences, beforeSettings }, null, 2),
);
let recording;
try {
  assert.equal(report.version, "0.5.1");
  assert.equal(report.url, "http://tauri.localhost/");
  assert.equal(beforeSettings.test_api, false);
  assert.equal(beforeSettings.hosted_configured, true);
  assert.equal(beforeSettings.provider, "personal");
  assert.deepEqual(report.preferences, {
    schema_version: 1,
    sound: true,
    volume: 0.69,
    motion: "full",
  });
  const snapshot = await invoke("open_vault", { path: root });
  await invoke("organize", {
    vaultRoot: snapshot.root,
    action: { kind: "select", location: { neuron_id: null, subject_id: null } },
  });
  await page.reload();
  await page.emulateMedia({ reducedMotion: null });
  await expect(page.locator(".sidebar")).toBeVisible();
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.waitForTimeout(1200);

  recording = await recordDesktop({
    page,
    context,
    name: "Synapse-0.5.1-sound",
    fixture: root,
  });
  const select = (title) =>
    page.locator(".note-row").filter({ hasText: title }).click();
  await page.evaluate(() => {
    window.releaseMotion = [];
    const start = performance.now();
    function sample(at) {
      const el = document.querySelector(".editor-shell");
      if (el)
        window.releaseMotion.push({
          x: new DOMMatrix(getComputedStyle(el).transform).m41,
          width: el.clientWidth,
        });
      if (at - start < 1100) requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
  });
  await recording.mark("select with quiet neighbour arrivals");
  await select("Conservation of momentum");
  await page.waitForTimeout(1250);
  report.intermediateDrawerPositions = await page.evaluate(
    () =>
      new Set(
        window.releaseMotion
          .filter((f) => f.x > 2 && f.x < f.width - 2)
          .map((f) => Math.round(f.x)),
      ).size,
  );
  assert.ok(report.intermediateDrawerPositions >= 5);
  await page.screenshot({ path: path.join(output, "installed-note.png") });
  await recording.mark("close note");
  await page.getByRole("button", { name: "Close note", exact: true }).click();
  await page.waitForTimeout(1100);
  await recording.mark("select another note");
  await select(/^Impulse$/);
  await page.waitForTimeout(1200);
  await recording.mark("retarget to connected note");
  await select("Conservation of momentum");
  await page.waitForTimeout(1400);
  await page.getByRole("button", { name: "Close note", exact: true }).click();
  await page.waitForTimeout(1100);
  await page.getByRole("button", { name: "Preferences", exact: true }).click();
  await recording.mark("saved 69 percent sound preview");
  await page
    .getByRole("button", { name: "Preview sound", exact: true })
    .click();
  await page.waitForTimeout(1400);
  await page.screenshot({
    path: path.join(output, "preserved-preferences.png"),
  });
  await recording.finish();
  recording = null;
  report.checks.push(
    "actual installed sound recorded at 69%; native focus and running AudioContext verified",
    "Full animation has intermediate drawer positions",
  );
  await page.getByLabel("AI provider", { exact: true }).selectOption("synapse");
  await expect(
    page.getByRole("button", { name: "Activate Synapse AI", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Use Synapse AI", exact: true }),
  ).toBeDisabled();
  await expect(page.locator("#hosted-data-notice")).toBeVisible();
  await page.screenshot({ path: path.join(output, "hosted-consent.png") });
  await page
    .getByRole("button", { name: "Close preferences", exact: true })
    .click();
  assert.equal((await invoke("device_settings")).provider, "personal");
  report.checks.push(
    "compiled public origin, consent gate, and explicit provider selection verified without enrollment",
  );

  await context.setOffline(true);
  await select("Conservation of momentum");
  const beforeStudy = await invoke("study_list", { vaultRoot: snapshot.root });
  const historyPath = path.join(root, ".synapse", "flashcards.json");
  const historyBefore = await readFile(historyPath, "utf8").catch(() => null);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await page
    .getByRole("button", { name: "Start manually", exact: true })
    .click();
  const quizTitle = "Offline momentum check · 0.5.1";
  await page.getByLabel("Quiz title", { exact: true }).fill(quizTitle);
  await page
    .getByLabel("Question 1", { exact: true })
    .fill("Which quantity is conserved in an isolated collision?");
  for (const [i, value] of [
    "Momentum",
    "Speed of each body",
    "Kinetic energy in every collision",
    "Acceleration",
  ].entries())
    await page
      .getByLabel(`Question 1 option ${i + 1}`, { exact: true })
      .fill(value);
  await page
    .getByLabel("Answer", { exact: true })
    .fill("Total momentum is conserved.");
  await page
    .getByLabel("Explanation", { exact: true })
    .fill("The isolated system has no net external impulse.");
  assert.equal(
    (await invoke("study_list", { vaultRoot: snapshot.root })).data.quizzes
      .length,
    beforeStudy.data.quizzes.length,
  );
  await page.screenshot({
    path: path.join(output, "manual-unsaved-draft.png"),
  });
  await page.getByRole("button", { name: "Save quiz", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: quizTitle, exact: true }),
  ).toBeVisible();
  assert.equal(
    (await invoke("study_list", { vaultRoot: snapshot.root })).data.quizzes
      .length,
    beforeStudy.data.quizzes.length + 1,
  );
  await page.reload();
  await expect(page.locator(".sidebar")).toBeVisible();
  await page
    .getByRole("button", { name: "Study library", exact: true })
    .click();
  await page
    .locator(".saved-study-row")
    .filter({ hasText: quizTitle })
    .getByRole("button", { name: "Take quiz", exact: true })
    .click();
  await page.getByRole("radio", { name: "Momentum", exact: true }).check();
  await page.getByRole("button", { name: "Finish quiz", exact: true }).click();
  await expect(page.locator(".quiz-score")).toHaveText("1 / 1");
  await page.screenshot({ path: path.join(output, "offline-quiz-result.png") });
  assert.equal(
    await readFile(historyPath, "utf8").catch(() => null),
    historyBefore,
  );
  report.checks.push(
    "manual draft editable and unsaved until explicit save",
    "saved quiz reloads and scores offline; flashcard history unchanged",
  );
  await page
    .getByRole("button", { name: "Close study drawer", exact: true })
    .click();

  await select("Conservation of momentum");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await page.getByRole("tab", { name: "Reminder", exact: true }).click();
  await page
    .getByRole("button", { name: "Start a manual reminder", exact: true })
    .click();
  const reminderTitle = "Synapse 0.5.1 offline reminder check";
  await page.getByLabel("Reminder title", { exact: true }).fill(reminderTitle);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(Date.now() + 14000);
  const part = (key) => parts.find((p) => p.type === key).value;
  await page
    .getByLabel("Reminder date and time", { exact: true })
    .fill(
      `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}:${part("second")}`,
    );
  await expect(
    page.getByRole("button", { name: "Save reminder", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Save reminder", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (
          await invoke("study_list", { vaultRoot: snapshot.root })
        ).data.reminders.find((r) => r.draft.title === reminderTitle)
          ?.last_delivered,
      { timeout: 24000 },
    )
    .toBeTruthy();
  const delivered = (
    await invoke("study_list", { vaultRoot: snapshot.root })
  ).data.reminders.find((r) => r.draft.title === reminderTitle);
  report.reminder = {
    id: delivered.id,
    last_delivered: delivered.last_delivered,
    pending_due: delivered.pending_due,
  };
  await page.screenshot({ path: path.join(output, "offline-reminder.png") });
  report.checks.push(
    "local reminder timer durably claimed due occurrence while renderer offline (banner visibility not asserted)",
  );
  await page
    .getByRole("button", { name: "Close study drawer", exact: true })
    .click();
  const closeNote = page.getByRole("button", {
    name: "Close note",
    exact: true,
  });
  if (await closeNote.isVisible()) await closeNote.click();
  await page.getByRole("button", { name: /^Review \d+$/ }).click();
  await expect(
    page.getByRole("button", { name: /Reveal answer/i }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Reveal answer/i }).click();
  await page.screenshot({ path: path.join(output, "offline-flashcard.png") });
  report.checks.push("offline note navigation and flashcard answer reveal");
  assert.deepEqual(await invoke("device_settings"), beforeSettings);
  assert.equal(
    await page.evaluate(() => localStorage.getItem("synapse.preferences.v1")),
    beforePreferences,
  );
  assert.deepEqual(report.errors, []);
  report.success = true;
} finally {
  if (recording) await recording.finish().catch(() => {});
  await context.setOffline(false);
  await page.emulateMedia({ reducedMotion: null });
  if (original) {
    await invoke("open_vault", { path: original.root });
    await invoke("organize", {
      vaultRoot: original.root,
      action: { kind: "select", location: original.organization.location },
    });
    await page.reload();
  }
  report.settingsPreserved =
    JSON.stringify(await invoke("device_settings")) ===
    JSON.stringify(beforeSettings);
  report.preferencesPreserved =
    (await page.evaluate(() =>
      localStorage.getItem("synapse.preferences.v1"),
    )) === beforePreferences;
  await writeFile(
    path.join(output, "report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
  await browser.close();
}
