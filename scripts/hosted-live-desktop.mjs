// Explicit, single owner-only live trial. Never part of CI or ordinary tests.
// Requires approved funding, an installed release with its production origin,
// owner Wrangler authentication, and a fresh report path. No owner key is read.
import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile, access } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

if (!process.argv.includes("--live-owner-trial"))
  throw Error(
    "This makes one paid hosted request. Supply --live-owner-trial only after explicit owner approval.",
  );
const output = path.resolve(".local/hosted-live-0.5.1");
const reportPath = path.join(output, "trial.json");
if (
  await access(reportPath).then(
    () => true,
    () => false,
  )
)
  throw Error(
    "A trial record already exists. Inspect it and the ledger; do not repeat the paid call.",
  );
await mkdir(output, { recursive: true });
function owner(command, args = []) {
  const run = spawnSync(
    process.execPath,
    ["backend/ai/owner.mjs", command, "--target", "remote", ...args],
    { cwd: process.cwd(), encoding: "utf8", windowsHide: true },
  );
  // In particular, never echo invite stdout or child error diagnostics.
  if (run.status !== 0)
    throw Error(`Owner ${command} failed; diagnostics withheld.`);
  return JSON.parse(run.stdout);
}
let browser,
  context,
  page,
  privateEntry = false;
const report = {
  startedAt: new Date().toISOString(),
  stage: "preparing",
  checks: [],
  errors: [],
};
const persist = () => writeFile(reportPath, JSON.stringify(report, null, 2));
const invoke = (command, args = {}) =>
  page.evaluate(
    ({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args),
    { command, args },
  );
try {
  browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
  context = browser.contexts()[0];
  page = context.pages()[0];
  assert.equal(page.url(), "http://tauri.localhost/");
  report.version = await invoke("plugin:app|version");
  assert.equal(report.version, "0.5.1");
  report.beforeSettings = await invoke("device_settings");
  assert.equal(report.beforeSettings.test_api, false);
  assert.equal(report.beforeSettings.provider, "personal");
  assert.equal(
    report.beforeSettings.hosted_connected,
    false,
    "Preserve any existing hosted credential; do not replace it in this trial.",
  );
  assert.equal(report.beforeSettings.hosted_consent, false);
  assert.equal(report.beforeSettings.hosted_configured, true);
  report.beforePreferences = await page.evaluate(() =>
    localStorage.getItem("synapse.preferences.v1"),
  );
  const original = await invoke("restore_vault");
  report.original = original
    ? { root: original.root, location: original.organization.location }
    : null;
  report.beforeUsage = owner("usage");
  assert.equal(report.beforeUsage.policy.paused, 1);
  assert.equal(report.beforeUsage.policy.funding, "credit");
  assert.equal(
    report.beforeUsage.policy.credit_expires,
    Date.parse("2026-11-25T00:00:00Z") / 1000,
  );
  assert.equal(report.beforeUsage.policy.lifetime_cap, 60e9);
  assert.equal(report.beforeUsage.outstanding.length, 0);
  assert.equal(
    owner("members").length,
    0,
    "Reuse the existing owner identity instead of creating another.",
  );
  report.root = path.join(
    tmpdir(),
    "synapse-desktop-qa",
    `hosted-owner-${Date.now()}`,
  );
  await mkdir(path.join(report.root, "Physics"), { recursive: true });
  await writeFile(
    path.join(report.root, "Physics", "Owner trial.md"),
    "# Conservation of momentum\n\nThis is fictional test material for Synapse's owner-only verification.\n\nTwo carts move in an isolated horizontal system. Cart A has mass 2 kg and velocity 3 m/s to the right; Cart B has mass 1 kg and is initially stationary. They stick together after colliding. Total initial momentum is 6 kg m/s to the right. With no external horizontal impulse, total momentum is conserved. Combined mass is 3 kg, so final velocity is 2 m/s to the right. Kinetic energy need not be conserved in this inelastic collision.\n\nThe impulse on an object equals its change in momentum. These quantities and numbers are synthetic test data.\n",
  );
  const snapshot = await invoke("open_vault", { path: report.root });
  report.canonicalRoot = snapshot.root;
  report.sourceId = snapshot.notes[0].id;
  assert.equal(snapshot.notes.length, 1);
  await page.reload();
  await page.emulateMedia({ reducedMotion: null });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await expect(page.locator(".sidebar")).toBeVisible();
  await page.getByRole("button", { name: "Preferences", exact: true }).click();
  await page.getByLabel("AI provider", { exact: true }).selectOption("synapse");
  await expect(
    page.getByRole("button", { name: "Activate Synapse AI", exact: true }),
  ).toBeDisabled();
  await expect(page.locator("#hosted-data-notice")).toBeVisible();
  await page.screenshot({
    path: path.join(output, "consent-before-enrollment.png"),
  });
  report.stage = "creating-private-invitation";
  await persist();
  privateEntry = true;
  const ticket = owner("invite", ["--new-person", "--minutes", "5"]);
  report.member = ticket.member;
  report.invitationExpires = ticket.expires;
  await persist();
  await page
    .getByLabel("Synapse AI invitation", { exact: true })
    .fill(ticket.invitation);
  ticket.invitation = "";
  await expect(
    page.getByRole("button", { name: "Activate Synapse AI", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("checkbox", {
      name: "I understand and enable this data transfer",
      exact: true,
    })
    .check();
  await page
    .getByRole("button", { name: "Activate Synapse AI", exact: true })
    .click();
  await expect
    .poll(async () => (await invoke("device_settings")).hosted_connected, {
      timeout: 15000,
    })
    .toBe(true);
  privateEntry = false;
  report.enrolledStatus = await invoke("synapse_ai_status");
  report.device = report.enrolledStatus.device;
  assert.equal(report.enrolledStatus.member, report.member);
  assert.equal(report.enrolledStatus.reason, "service_paused");
  assert.equal(report.enrolledStatus.remaining, 10);
  await expect(
    page.getByLabel("Synapse AI invitation", { exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: path.join(output, "enrolled-while-paused.png"),
  });
  report.checks.push(
    "consent required before real enrollment; device credential stored by Rust; initial status paused",
  );
  report.stage = "enrolled";
  await persist();

  owner("resume", [
    "--funding-reviewed",
    "--pricing-reviewed",
    "--credential-reviewed",
  ]);
  const ready = await invoke("synapse_ai_status");
  assert.equal(ready.reason, null);
  await page
    .getByRole("button", { name: "Close preferences", exact: true })
    .click();
  await page.locator(".note-row").click();
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await page
    .getByLabel("Number of study items", { exact: true })
    .selectOption("3");
  report.prompt =
    "Create three concise quiz questions about only these fictional cart notes. Include at least one multiple-choice and one short-answer question. Keep explanations brief.";
  await page.getByLabel("Study request", { exact: true }).fill(report.prompt);
  await expect(page.locator(".context-preview > summary")).toContainText(
    "1 source notes",
  );
  await expect(
    page.getByRole("button", { name: "Generate quiz", exact: true }),
  ).toBeEnabled({ timeout: 15000 });
  report.stage = "paid-call-starting";
  await persist();
  // Exactly one click can submit a fresh generation. No automatic retry path.
  await page
    .getByRole("button", { name: "Generate quiz", exact: true })
    .click();
  await expect(page.getByLabel("Quiz title", { exact: true })).toBeVisible({
    timeout: 35000,
  });
  assert.equal(await page.locator(".draft-item").count(), 3);
  assert.equal(
    (await invoke("study_list", { vaultRoot: snapshot.root })).data.quizzes
      .length,
    0,
  );
  const ledger = owner("ledger").filter(
    (call) => call.member === report.member,
  );
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].state, "measured");
  assert.equal(ledger[0].upstream_http, 200);
  assert.equal(ledger[0].active, 0);
  report.call = ledger[0];
  report.generatedTitle = await page
    .getByLabel("Quiz title", { exact: true })
    .inputValue();
  report.afterGenerationStatus = await invoke("synapse_ai_status");
  assert.equal(report.afterGenerationStatus.remaining, 9);
  assert.equal(report.afterGenerationStatus.requests, 1);
  assert.equal(report.afterGenerationStatus.reserved_nusd, 0);
  await page.screenshot({
    path: path.join(output, "real-hosted-unsaved-draft.png"),
  });
  await page
    .getByLabel("Quiz title", { exact: true })
    .fill("Owner hosted trial · Momentum");
  assert.equal(
    (await invoke("study_list", { vaultRoot: snapshot.root })).data.quizzes
      .length,
    0,
  );
  await page.screenshot({
    path: path.join(output, "edited-unsaved-draft.png"),
  });
  await page.getByRole("button", { name: "Save quiz", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Owner hosted trial · Momentum",
      exact: true,
    }),
  ).toBeVisible();
  const saved = await invoke("study_list", { vaultRoot: snapshot.root });
  assert.equal(saved.data.quizzes.length, 1);
  report.quiz = saved.data.quizzes[0];
  report.stage = "generated-and-saved";
  await persist();
  report.checks.push(
    "one real installed desktop → Worker → OpenAI generation; valid editable draft; title edit remains unsaved until explicit Save",
  );
  owner("pause");
  assert.equal((await invoke("synapse_ai_status")).reason, "service_paused");
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator(".sidebar")).toBeVisible();
  await page
    .getByRole("button", { name: "Study library", exact: true })
    .click();
  await page.getByRole("button", { name: "Take quiz", exact: true }).click();
  for (const [i, q] of report.quiz.draft.questions.entries()) {
    if (q.kind === "multiple_choice")
      await page.getByRole("radio").nth(q.correct_index).check();
    else {
      await page.getByLabel("Your answer", { exact: true }).fill(q.answer);
      await page
        .getByRole("button", { name: "Show marking guidance", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Understood", exact: true })
        .click();
    }
    await page
      .getByRole("button", {
        name:
          i === report.quiz.draft.questions.length - 1
            ? "Finish quiz"
            : "Next question",
        exact: true,
      })
      .click();
  }
  await expect(page.locator(".quiz-score")).toHaveText("3 / 3");
  await page.screenshot({
    path: path.join(output, "hosted-quiz-used-offline.png"),
  });
  report.checks.push(
    "saved hosted quiz reloaded with offline renderer and paused gateway; local marking/self-assessment persisted 3/3",
  );
  report.afterUsage = owner("usage");
  assert.equal(report.afterUsage.outstanding.length, 0);
  assert.deepEqual(
    (await invoke("device_settings")).usage,
    report.beforeSettings.usage,
  );
  assert.equal(
    await page.evaluate(() => localStorage.getItem("synapse.preferences.v1")),
    report.beforePreferences,
  );
  report.stage = "inference-and-offline-passed";
} catch (error) {
  // A private-entry error must not include Playwright arguments or invite stdout.
  report.error = privateEntry
    ? "Private enrollment failed; secret diagnostics withheld."
    : String(error?.message ?? error);
  process.exitCode = 1;
} finally {
  try {
    report.finalPause = owner("pause");
  } catch {
    report.pauseError = "Owner pause could not be confirmed.";
    process.exitCode = 1;
  }
  if (context) await context.setOffline(false).catch(() => {});
  await persist();
  if (browser) await browser.close();
  console.log(
    JSON.stringify({
      stage: report.stage,
      member: report.member,
      device: report.device,
      call: report.call,
      checks: report.checks,
      error: report.error,
      paused: report.finalPause?.paused,
    }),
  );
}
