import { chromium, expect } from "@playwright/test";
import { cp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { recordDesktop } from "./record-desktop.mjs";
const b = await chromium.connectOverCDP("http://127.0.0.1:9222"),
  c = b.contexts()[0],
  p = c.pages()[0];
p.setDefaultTimeout(12000);
p.setDefaultNavigationTimeout(15000);
const logs = [];
p.on("pageerror", (e) => logs.push(e.message));
const invoke = (command, args = {}) =>
  p.evaluate(
    ({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args),
    { command, args },
  );
const fixture = JSON.parse(
  await readFile(".local/refinement-fixture.json", "utf8"),
);
const root = path.join(
  tmpdir(),
  "synapse-desktop-qa",
  `cyber-study-${Date.now()}`,
);
await cp(fixture.root, root, { recursive: true });
let s = await invoke("open_vault", { path: root });
await invoke("organize", {
  vaultRoot: s.root,
  action: { kind: "select", location: { neuron_id: null, subject_id: null } },
});
await p.reload({ waitUntil: "domcontentloaded" });
await expect(p.locator(".sidebar")).toBeVisible();
await p.setViewportSize({ width: 1600, height: 1000 });
const report = {
  root,
  canonicalRoot: s.root,
  mocked: true,
  checks: [],
  errors: logs,
};
const out = ".local/cyber-study";
await mkdir(out, { recursive: true });
let recording;
const shot = async (name) => {
  if (recording) await p.waitForTimeout(1000);
  await p.screenshot({ path: `${out}/${name}.png`, timeout: 12000 });
};
const history = await readFile(
  path.join(root, "flashcards.json"),
  "utf8",
).catch(() => null);
const study = () => invoke("study_list", { vaultRoot: s.root });
const create = async (kind) => {
  await p.getByRole("button", { name: "Create", exact: true }).click();
  await p.getByRole("tab", { name: kind, exact: true }).click();
  await expect(p.getByLabel("Study request")).toBeVisible();
};
try {
  if (process.argv.includes("--record"))
    recording = await recordDesktop({
      page: p,
      context: c,
      name: "Synapse-0.4.0-study-mocked",
      fixture: root,
      mocked: true,
    });
  await recording?.mark("click-to-focus");
  await p
    .locator(".note-row")
    .filter({ hasText: "Conservation of momentum" })
    .click();
  if (recording) {
    await p.waitForTimeout(1000);
    await recording.mark("retarget", 0.8);
    await p
      .locator(".note-row")
      .filter({ hasText: /^Impulse$/ })
      .click();
    await p.waitForTimeout(90);
    await p
      .locator(".note-row")
      .filter({ hasText: "Conservation of momentum" })
      .click();
    await p.waitForTimeout(1100);
    await recording.mark("exact overview restoration");
    await p.getByRole("button", { name: "Close note", exact: true }).click();
    await p.waitForTimeout(1200);
    await p
      .locator(".note-row")
      .filter({ hasText: "Conservation of momentum" })
      .click();
    await p.waitForTimeout(1000);
  }
  await create("Quiz");
  await shot("create-quiz");
  await p
    .getByLabel("Study request")
    .fill("Explain momentum with three practice questions");
  await p.getByLabel("Number of study items").selectOption("3");
  await p.getByRole("button", { name: "Generate quiz", exact: true }).click();
  await expect(p.getByLabel("Quiz title")).toBeVisible();
  await p.getByLabel("Quiz title").fill("Momentum practice");
  await p
    .getByLabel("Question 1", { exact: true })
    .fill("A 2 kg object moves at 3 m/s. Calculate its momentum");
  await shot("quiz-draft");
  await p.getByRole("button", { name: "Save quiz", exact: true }).click();
  await expect(
    p.getByRole("button", { name: "Take quiz", exact: true }),
  ).toBeVisible();
  assert.equal((await study()).data.quizzes.length, 1);
  report.checks.push("mocked generation, editing and local quiz save");
  await c.setOffline(true);
  await p.getByRole("button", { name: "Take quiz", exact: true }).click();
  await p.getByRole("radio").first().check();
  await shot("quiz-taking");
  await p.getByRole("button", { name: "Next question" }).click();
  await p
    .getByLabel("Your answer")
    .fill(
      "The total momentum is conserved when the net external force is zero",
    );
  await p.getByRole("button", { name: "Show marking guidance" }).click();
  await p.getByRole("button", { name: "Understood", exact: true }).click();
  await p.getByRole("button", { name: "Next question" }).click();
  await p.getByRole("radio").first().check();
  await p.getByRole("button", { name: "Finish quiz" }).click();
  await expect(p.getByText("Multiple choice", { exact: true }).first())
    .toBeVisible()
    .catch(() => {});
  await shot("quiz-results");
  let v = await study();
  assert.equal(v.data.attempts.length, 1);
  assert.equal(v.data.attempts[0].correct, 3);
  report.checks.push(
    "offline deterministic quiz marking and short-answer self-assessment",
  );
  await c.setOffline(false);
  await create("Flashcards");
  await shot("create-flashcards");
  await p.getByLabel("Study request").fill("Create momentum recall cards");
  await p
    .getByRole("button", { name: "Generate flashcards", exact: true })
    .click();
  await expect(p.getByLabel("Card 1 question")).toBeVisible();
  await p
    .getByLabel("Card 1 answer")
    .fill("$p = mv$, where $m$ is mass and $v$ is velocity");
  await p.getByRole("button", { name: "Remove card 3" }).click();
  await shot("flashcard-draft");
  await p.getByLabel("Flashcard new note path").fill("Momentum recall.md");
  await p
    .getByRole("button", { name: "Save 2 flashcards", exact: true })
    .click();
  await expect(
    p.getByText("Flashcards saved without changing review history"),
  ).toBeVisible();
  v = await study();
  assert.equal(v.data.flashcard_batches.length, 1);
  const note = v.data.flashcard_batches[0].note_id;
  const content = await readFile(path.join(root, note), "utf8");
  assert(content.includes("Q: How is momentum calculated?\nA: $p = mv$"));
  assert.equal(
    await readFile(path.join(root, "flashcards.json"), "utf8").catch(
      () => null,
    ),
    history,
  );
  report.checks.push(
    "canonical flashcards, source mappings and unchanged review history",
  );
  await create("Reminder");
  await shot("create-reminder");
  await p
    .getByLabel("Study request")
    .fill("Remind me to revise momentum in two minutes");
  await p
    .getByRole("button", { name: "Generate reminder", exact: true })
    .click();
  await expect(p.getByLabel("Reminder title")).toBeVisible();
  await p.getByLabel("Reminder title").fill("Momentum revision check");
  await expect(
    p.getByRole("button", { name: "Save reminder", exact: true }),
  ).toBeEnabled();
  await shot("reminder-preview");
  await p.getByRole("button", { name: "Save reminder", exact: true }).click();
  await expect(
    p.getByRole("heading", { name: "Momentum revision check" }),
  ).toBeVisible();
  await shot("reminders");
  v = await study();
  assert.equal(v.data.reminders.length, 1);
  report.reminderId = v.data.reminders[0].id;
  report.checks.push(
    "mocked reminder interpretation and deterministic local save",
  );
  await create("Quiz");
  await p.getByLabel("Study request").fill("mock:429");
  await p.getByRole("button", { name: "Generate quiz", exact: true }).click();
  await expect(p.getByRole("alert")).toContainText("rate-limited");
  await shot("api-error");
  report.checks.push("actionable API rate-limit error");
  await p.getByLabel("Study request").fill("mock:slow");
  await p.getByRole("button", { name: "Generate quiz", exact: true }).click();
  await p.getByRole("button", { name: "Cancel generation" }).click();
  await p.waitForTimeout(2500);
  await expect(p.getByLabel("Quiz title")).toHaveCount(0);
  report.checks.push("cancelled mock response discarded");
  await p.getByLabel("Study request").fill("mock:slow");
  await p.getByRole("button", { name: "Generate quiz", exact: true }).click();
  await p
    .locator(".subject-row .row-name")
    .filter({ hasText: /^English Language$/ })
    .click();
  await p.waitForTimeout(2500);
  await expect(p.getByLabel("Quiz title")).toHaveCount(0);
  report.checks.push("scope navigation discards stale output");
  assert.equal(logs.length, 0);
  report.success = true;
} catch (e) {
  report.failure = e.message;
  await shot("failure").catch(() => {});
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await c.setOffline(false);
  await recording?.finish();
  await writeFile(
    ".local/cyber-study-report.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
  await b.close();
}
