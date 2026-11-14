// Actual desktop integration checks. Launch Synapse with CDP on port 9222.
import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const context = browser.contexts()[0],
  page = context.pages()[0];
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const root = path.resolve(
  process.env.SYNAPSE_QA_BASE ?? ".local",
  `neurons-qa-${Date.now()}`,
);
await mkdir(root, { recursive: true });
async function write(file, text) {
  const dest = path.join(root, file);
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, text);
}
await write(
  "Physics/Conservation of momentum.md",
  "---\ntitle: Conservation of momentum\n---\n# Conservation of momentum\n\nFor an isolated system, total momentum is conserved.\n\n$$m_1u_1+m_2u_2=m_1v_1+m_2v_2$$\n\n[[Physics/Impulse#Definition|Impulse]] connects force and time.\n\nQ: What is conserved in an isolated system?\nA: Total momentum.\n",
);
await write(
  "Physics/Impulse.md",
  "# Impulse\n\n## Definition\n\n$$J=\\Delta p=F\\Delta t$$\n\n[[Physics/Conservation of momentum|Momentum]]\n\nImpulse :: Change in momentum",
);
await write(
  "Methods/Derivatives.md",
  "# Derivatives\n\n$$\\frac{d}{dx}x^n=nx^{n-1}$$\n\nDerivative :: Instantaneous rate of change",
);
await write(
  "Specialist/Complex numbers.md",
  "# Complex numbers\n\n$$e^{i\\theta}=\\cos\\theta+i\\sin\\theta$$\n\n[[Methods/Derivatives]]",
);
await write(
  "English Language/Language and identity.md",
  "# Language and identity\n\nLanguage choices express social identity.\n\nRegister :: Language suited to a context",
);
await write("Ideas.md", "# Ideas\n\n[[Physics/Impulse]]");
const invoke = (command, args = {}) =>
  page.evaluate(
    ({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args),
    { command, args },
  );
let s = await invoke("open_vault", { path: root });
await page.reload();
await expect(page.locator(".note-row")).toHaveCount(6);
await page.getByRole("button", { name: "New Neuron", exact: true }).click();
await page
  .getByRole("dialog")
  .getByLabel("Name", { exact: true })
  .fill("University");
await page
  .getByRole("dialog")
  .getByRole("button", { name: "Save", exact: true })
  .click();
await expect(page.getByRole("dialog")).toHaveCount(0);
await page.getByRole("button", { name: "New subject", exact: true }).click();
await page
  .getByRole("dialog")
  .getByLabel("Name", { exact: true })
  .fill("Physics");
await page.getByLabel("Preset", { exact: true }).selectOption("physics");
await page
  .getByRole("dialog")
  .getByRole("button", { name: "Save", exact: true })
  .click();
await expect(page.getByRole("dialog")).toHaveCount(0);
s = await invoke("refresh_vault", { vaultRoot: s.root });
const university = s.organization.neurons.find((n) => n.name === "University"),
  custom = s.organization.subjects.find(
    (n) => n.neuron_id === university.id && n.name === "Physics",
  );
await invoke("organize", {
  vaultRoot: s.root,
  action: {
    kind: "rename",
    id: s.organization.neurons[0].id,
    name: "VCE Revision",
  },
});
s = await invoke("organize", {
  vaultRoot: s.root,
  action: { kind: "new_neuron", name: "Research and independent study" },
});
const research = s.organization.location.neuron_id;
s = await invoke("organize", {
  vaultRoot: s.root,
  action: {
    kind: "new_subject",
    neuron_id: research,
    name: "Networks, emergence and complex adaptive systems",
    preset: "general",
    color: "#75a9c4",
  },
});
const dense = s.organization.subjects.find(
  (n) => n.id === s.organization.location.subject_id,
);
for (let i = 0; i < 90; i++)
  await write(
    `${dense.root}/Concept ${i}.md`,
    `---\ntitle: ${i % 13 === 0 ? "A long note title about emergent behavior and the structure of complex systems " + i : "Concept " + i}\n---\n# Concept ${i}\n\n[[${dense.root}/Concept ${(i + 1) % 90}]] [[${dense.root}/Concept ${(i + 11) % 90}]] [[${dense.root}/Concept ${(i + 29) % 90}]]\n\nConcept ${i} :: Definition ${i}`,
  );
await write(
  `${custom.root}/Independent progress.md`,
  "Q: What is conserved in an isolated system?\nA: Total momentum.",
);
await invoke("organize", {
  vaultRoot: s.root,
  action: { kind: "select", location: { neuron_id: null, subject_id: null } },
});
await page.reload();
await expect(page.locator(".graph-heading")).toContainText("97 notes");
await page.getByRole("button", { name: "Fit graph", exact: true }).click();
await page.waitForTimeout(2000);
await page.screenshot({ path: path.resolve(".local/update-large.png") });
await page
  .locator(".note-row")
  .filter({ hasText: "Conservation of momentum" })
  .click();
await expect(page.locator(".preview .katex")).toHaveCount(1);
await page.screenshot({ path: path.resolve(".local/update-editor.png") });
await page.getByRole("button", { name: "Split", exact: true }).click();
const editor = page.getByRole("textbox", { name: "Markdown editor" });
await expect(editor).toBeVisible();
await editor.press("Control+End");
await editor.press("Enter");
await editor.pressSequentially("Unsaved QA edit");
await page.getByRole("button", { name: "University", exact: true }).click();
await expect(page.getByRole("alertdialog")).toBeVisible();
await page.getByRole("button", { name: "Cancel", exact: true }).click();
await expect(editor).toContainText("Unsaved QA edit");
await write(
  "Physics/Conservation of momentum.md",
  "# External version\n\nChanged on disk",
);
await expect(page.locator(".conflict")).toBeVisible();
await page.screenshot({ path: path.resolve(".local/update-conflict.png") });
await page.getByRole("button", { name: "Keep my edits" }).click();
await editor.press("Control+s");
await expect(page.locator(".editor-status")).toContainText("All changes saved");
await page.getByRole("button", { name: "Close note", exact: true }).click();
await page.getByRole("button", { name: "University", exact: true }).click();
await expect(page.locator(".graph-heading")).toContainText("1 note");
await page.locator(".review-entry").click();
await expect(
  page.getByRole("dialog", { name: "Flashcard revision" }),
).toBeVisible();
await expect(page.locator(".review-meta")).toContainText("1 new");
await page.getByRole("button", { name: /Reveal answer/ }).click();
await page.getByRole("button", { name: /Good 3/ }).click();
await expect(page.getByText("Reviews complete", { exact: true })).toBeVisible();
await page
  .getByRole("button", { name: "Close review", exact: true })
  .first()
  .click();
s = await invoke("refresh_vault", { vaultRoot: s.root });
const duplicates = s.cards.filter(
  (c) => c.question === "What is conserved in an isolated system?",
);
if (
  duplicates.length !== 2 ||
  duplicates.filter((c) => s.history.cards[c.id]).length !== 1
)
  throw Error("Review scope leaked");
await page.getByRole("button", { name: "Import subject", exact: true }).click();
await page.screenshot({ path: path.resolve(".local/update-import.png") });
await page.keyboard.press("Escape");
await expect(page.getByRole("dialog")).toHaveCount(0);
await page.getByRole("button", { name: "All Neurons", exact: true }).click();
await page.getByRole("button", { name: "Fit graph", exact: true }).click();
await page.waitForTimeout(500);
await page.setViewportSize({ width: 900, height: 600 });
await page.getByRole("button", { name: "Fit graph", exact: true }).click();
await page.waitForTimeout(300);
await page.screenshot({ path: path.resolve(".local/update-small.png") });
await page.locator(".note-row").filter({ hasText: "Impulse" }).first().click();
await page.screenshot({ path: path.resolve(".local/update-small-editor.png") });
await page.getByRole("button", { name: "Close note", exact: true }).click();
await page.setViewportSize({ width: 1600, height: 1000 });
await page.getByRole("button", { name: "Fit graph", exact: true }).click();
await page.waitForTimeout(400);
await page.screenshot({ path: path.resolve(".local/update-dense.png") });
await writeFile(
  path.resolve(".local/update-qa.json"),
  JSON.stringify(
    {
      root,
      canonicalRoot: s.root,
      university,
      custom,
      dense,
      research,
      errors,
    },
    null,
    2,
  ),
);
if (errors.length) throw Error(errors.join("\n"));
console.log(
  JSON.stringify({
    root,
    notes: 97,
    checks:
      "creation, scoping, math, unsaved guard, disk conflict, save, review isolation, dialogs, resize",
    errors,
  }),
);
await browser.close();
