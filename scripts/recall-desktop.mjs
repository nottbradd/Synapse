// Real desktop parser, reveal and scheduler integration; disposable fixture only.
import { chromium, expect } from "@playwright/test";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const page = browser.contexts()[0].pages()[0];
const fixture = JSON.parse(
  await readFile(".local/refinement-fixture.json", "utf8"),
);
const root = path.join(tmpdir(), "synapse-desktop-qa", `recall-${Date.now()}`);
await cp(fixture.root, root, {
  recursive: true,
  filter: (p) => path.basename(p) !== "flashcards.json",
});
const source = path.join(root, "Physics/Conservation of momentum.md");
const original = await readFile(source, "utf8");
const rich = original.replace(
  "A: Total momentum.",
  "A: **Total momentum** is $p=mv$. See [[Physics/Impulse|Impulse]].",
);
await writeFile(source, rich);
const historyFile = path.join(root, "flashcards.json");
const historyBytes = () =>
  readFile(historyFile, "utf8").catch((e) => {
    if (e.code === "ENOENT") return null;
    throw e;
  });
const invoke = (command, args = {}) =>
  page.evaluate(
    ({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args),
    { command, args },
  );
let snapshot = await invoke("open_vault", { path: root });
await invoke("organize", {
  vaultRoot: snapshot.root,
  action: { kind: "select", location: { neuron_id: null, subject_id: null } },
});
await page.reload();
await page.setViewportSize({ width: 1600, height: 1000 });
await expect(page.locator(".sidebar")).toBeVisible();
const note = (title) =>
  page.locator(".note-row").filter({ hasText: title }).first();
await note("Conservation of momentum").click();
const recall = page.locator(".preview .recall-block");
await expect(recall).toHaveCount(1);
await expect(recall.locator(".recall-toggle")).toHaveAttribute(
  "aria-expanded",
  "false",
);
await expect(recall.locator(".recall-answer")).toBeHidden();
await recall.locator("button").focus();
await page.keyboard.press("Space");
await expect(recall.locator(".recall-toggle")).toHaveAttribute(
  "aria-expanded",
  "true",
);
await expect(recall.locator(".recall-answer strong")).toHaveText(
  "Total momentum",
);
await expect(recall.locator(".katex")).toHaveCount(1);
await expect(recall.locator(".wiki-link")).toHaveText("Impulse");
expect(
  await recall
    .locator(".recall-toggle")
    .evaluate((e) => getComputedStyle(e).outlineStyle),
).toBe("solid");
const controls = await recall
  .locator(".recall-toggle")
  .getAttribute("aria-controls");
expect(await recall.locator(".recall-answer").getAttribute("id")).toBe(
  controls,
);
// An unrelated parent render must not reset an answer the user just revealed.
await page.getByRole("button", { name: "Refresh vault", exact: true }).click();
await page.waitForTimeout(300);
await expect(recall.locator(".recall-toggle")).toHaveAttribute(
  "aria-expanded",
  "true",
);
await recall.locator(".wiki-link").click();
await expect(page.locator(".note-title h2")).toHaveAttribute(
  "title",
  "Impulse",
);
await expect(recall.locator(".recall-question")).toHaveText("Impulse");
await expect(recall.locator(".recall-toggle")).toHaveAttribute(
  "aria-expanded",
  "false",
);
await recall.locator("button").focus();
await page.keyboard.press("Enter");
await expect(recall.locator(".recall-answer")).toHaveText("Change in momentum");
await note("Conservation of momentum").click();
await expect(recall.locator(".recall-toggle")).toHaveAttribute(
  "aria-expanded",
  "false",
);
await recall.locator("button").click();
await writeFile(
  source,
  rich.replace("**Total momentum**", "**The total momentum**"),
);
await expect(recall.locator(".recall-toggle")).toHaveAttribute(
  "aria-expanded",
  "false",
);
await recall.locator("button").click();
await expect(recall.locator("strong")).toHaveText("The total momentum");
expect(await historyBytes()).toBeNull();
await page.getByRole("button", { name: "Close note", exact: true }).click();
snapshot = await invoke("refresh_vault", { vaultRoot: snapshot.root });
const card = snapshot.cards.find((c) =>
  c.source.endsWith("Conservation of momentum.md"),
);
const term = snapshot.cards.find((c) => c.source.endsWith("Impulse.md"));
const preview = await invoke("preview_ratings", {
  vaultRoot: snapshot.root,
  id: card.id,
});
expect(preview.options.map((o) => o.interval_seconds)).toEqual([
  60, 43200, 86400, 345600,
]);
expect(
  preview.options.every(
    (o) => o.due - preview.reference_time === o.interval_seconds,
  ),
).toBe(true);
expect(await historyBytes()).toBeNull();
const physics = snapshot.organization.subjects.find(
  (s) => s.id === card.subject_id,
);
await page
  .locator(".subject-row .row-name")
  .filter({ hasText: new RegExp(`^${physics.name}$`) })
  .click();
await page.locator(".review-entry").click();
await expect(page.locator(".ratings")).toHaveCount(0);
await page.keyboard.press("3");
expect(await historyBytes()).toBeNull();
await page.getByRole("button", { name: /Reveal answer/ }).click();
await expect(page.locator(".ratings small")).toHaveText([
  "1 min",
  "12 hr",
  "1 day",
  "4 days",
]);
await expect(page.locator(".review-content .recall-block")).toHaveCount(0);
await expect(page.locator(".review-content .answer .katex")).toHaveCount(1);
// External history changes refresh the same card's previews without remounting Review.
const mature = {
  card_id: card.id,
  last_review: 0,
  due: 0,
  interval: 10,
  ease: 2.5,
  reviews: 8,
  lapses: 1,
};
const history = {
  schema_version: 2,
  cards: { [card.id]: mature },
  legacy_cards: {},
};
await writeFile(historyFile, JSON.stringify(history, null, 2));
await expect(page.locator(".ratings small")).toHaveText([
  "1 min",
  "12 days",
  "25 days",
  "34.5 days",
]);
const saved = await historyBytes();
await invoke("preview_ratings", { vaultRoot: snapshot.root, id: card.id });
expect(await historyBytes()).toBe(saved);
await page.keyboard.press("3");
await expect(page.getByRole("button", { name: /Reveal answer/ })).toBeVisible();
const committed = JSON.parse(await historyBytes());
expect(committed.cards[card.id].reviews).toBe(9);
expect(
  committed.cards[card.id].due - committed.cards[card.id].last_review,
).toBe(25 * 86400);
await page.getByRole("button", { name: /Reveal answer/ }).click();
await expect(page.locator(".ratings small")).toHaveText([
  "1 min",
  "12 hr",
  "1 day",
  "4 days",
]);
// Repeated keyboard submission must still commit this card only once.
await page.keyboard.type("33");
await expect(page.getByText("Reviews complete", { exact: true })).toBeVisible();
expect(JSON.parse(await historyBytes()).cards[term.id].reviews).toBe(1);
expect(await readFile(source, "utf8")).toBe(
  rich.replace("**Total momentum**", "**The total momentum**"),
);
await mkdir(".local", { recursive: true });
await writeFile(
  ".local/recall-report.json",
  JSON.stringify(
    {
      url: page.url(),
      root,
      recallKeyboard: true,
      resetOnNoteAndCard: true,
      retainedOnRefresh: true,
      markdownWikiMath: true,
      previewReadOnly: true,
      matureRefresh: true,
      commitMatchesPreview: true,
      revealBeforeRate: true,
      repeatedRatingCommitsOnce: true,
    },
    null,
    2,
  ),
);
await invoke("open_vault", { path: fixture.root });
await page.reload();
console.log("Recall and scheduler desktop checks passed", root);
await browser.close();
