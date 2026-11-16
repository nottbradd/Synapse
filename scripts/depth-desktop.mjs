// Development inspection of the real Tauri/Rust app using a disposable synthetic vault.
// No providers are called; instrumentation exists only in this harness.
import { chromium, expect } from "@playwright/test";
import { cp, mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222"),
  page = browser.contexts()[0].pages()[0];
assert.ok(page.url().includes(":1420"), "Development-only instrumentation");
const invoke = (command, args = {}) =>
  page.evaluate(
    ({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args),
    { command, args },
  );
const out = path.resolve(".local/depth-0.6.0");
await mkdir(out, { recursive: true });
const original = await invoke("restore_vault"),
  originalPreferences = await page.evaluate(() =>
    localStorage.getItem("synapse.preferences.v1"),
  );
const fixture = JSON.parse(
  await readFile(".local/refinement-fixture.json", "utf8"),
);
const root = path.join(tmpdir(), "synapse-desktop-qa", `depth-${Date.now()}`);
await cp(fixture.root, root, { recursive: true });
for (const [title, links] of Object.entries({
  Momentum: ["Impulse", "Force", "Velocity", "Mass"],
  Impulse: ["Momentum", "Force"],
  Force: ["Momentum", "Impulse", "Velocity"],
  Velocity: ["Momentum", "Force", "Mass"],
  Mass: ["Velocity", "Momentum"],
  Unlinked: [],
})) {
  await writeFile(
    path.join(root, "Physics", title + ".md"),
    `---\ntitle: ${title}\nsubject: physics\n---\n# ${title}\n\nSynthetic revision example.\n\n${links.map((n) => `[[Physics/${n}]]`).join(" · ")}\n`,
  );
}
const report = { errors: [], checks: [] };
page.on("pageerror", (e) => report.errors.push(e.message));
await writeFile(
  path.join(out, "restore.json"),
  JSON.stringify({ original, originalPreferences }, null, 2),
);
try {
  let s = await invoke("open_vault", { path: root });
  s = await invoke("organize", {
    vaultRoot: s.root,
    action: { kind: "select", location: { neuron_id: null, subject_id: null } },
  });
  const canonicalRoot = s.root;
  await writeFile(
    path.join(out, "fixture.json"),
    JSON.stringify({ root, canonicalRoot }, null, 2),
  );
  await page.reload();
  await page.setViewportSize({ width: 1600, height: 1000 });
  await expect(page.locator(".sidebar")).toBeVisible();
  await page.evaluate(async () => {
    const live = (p) =>
      performance
        .getEntriesByType("resource")
        .find((r) => new URL(r.name).pathname === p)?.name ?? p;
    const { GraphScene } = await import(live("/src/interaction/graphScene.ts"));
    const { preferences } = await import(
      live("/src/interaction/preferences.ts")
    );
    const { feedback } = await import(live("/src/interaction/events.ts"));
    window.depthQA = { preferences, feedback, events: [], draws: 0 };
    preferences.update({ sound: true, volume: 0.69, motion: "full" });
    const configure = GraphScene.prototype.configure,
      draw = GraphScene.prototype.draw;
    GraphScene.prototype.configure = function (...args) {
      window.depthQA.scene = this;
      return configure.apply(this, args);
    };
    GraphScene.prototype.draw = function (...args) {
      window.depthQA.draws++;
      return draw.apply(this, args);
    };
    feedback.subscribe((e) => {
      if (e.kind === "action") window.depthQA.events.push(e.event);
    });
  });
  await page.getByLabel("Search notes", { exact: true }).fill("x");
  await page.getByLabel("Search notes", { exact: true }).fill("");
  const settle = async () => {
    await page.waitForTimeout(100);
    await page.waitForFunction(
      () =>
        window.depthQA.scene &&
        !window.depthQA.scene.motion.active &&
        !window.depthQA.scene.topology.reveal.active &&
        !window.depthQA.scene.labels.active,
      {},
      { timeout: 8000 },
    );
  };
  const state = () =>
    page.evaluate(() => {
      const s = window.depthQA.scene;
      return {
        scope: s.exploration.scope,
        frame: s.motion.frame,
        nodes: s.topology.visibleNodes.map((n) => ({
          id: n.id,
          x: n.x,
          y: n.y,
          role: n.role,
        })),
        selected: s.selected,
        history: s.exploration.history.length,
      };
    });
  const click = async (title) => {
    const p = await page.evaluate((title) => {
      const s = window.depthQA.scene,
        n = s.topology.visibleNodes.find((n) => n.title === title);
      if (!n) throw Error("Missing node " + title);
      return {
        ...s.api.graph2ScreenCoords(n.x, n.y),
        id: n.id,
        role: n.role,
        subject: n.subject_id,
      };
    }, title);
    await page.mouse.move(p.x, p.y);
    await page.waitForTimeout(80);
    await page.mouse.click(p.x, p.y);
    report.lastClick = {
      ...p,
      hover: await page.evaluate(() => window.depthQA.scene.hover),
    };
    await page.waitForFunction(
      (p) => {
        const scope = window.depthQA.scene.exploration.scope;
        return p.role === "subnetwork"
          ? scope.kind === "subnetwork" && scope.subject === p.subject
          : scope.kind === "topic" && scope.note === p.id;
      },
      p,
      { timeout: 4000 },
    );
  };
  await settle();
  const overview = await state();
  await page.screenshot({ path: path.join(out, "overview.png") });
  await click("Physics");
  await settle();
  const subnet = await state();
  assert.equal(subnet.scope.kind, "subnetwork");
  assert.deepEqual(
    (await invoke("restore_vault")).organization.location,
    s.organization.location,
  );
  await page.screenshot({ path: path.join(out, "subnetwork.png") });
  await click("Momentum");
  await settle();
  await page.getByRole("button", { name: "Split", exact: true }).click();
  await page.getByRole("separator").focus();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await settle();
  const panelWidth = await page
    .locator(".editor-shell")
    .evaluate((el) => el.getBoundingClientRect().width);
  const topic = await state();
  assert.equal(topic.scope.note, "Physics/Momentum.md");
  assert.equal(topic.nodes.length, 5);
  assert.equal(
    await page.locator(".editor-panel .note-title").innerText(),
    "Momentum",
  );
  await page.screenshot({ path: path.join(out, "topic.png") });
  const centre = await page.evaluate(() => {
    const s = window.depthQA.scene,
      n = s.topology.positions.get(s.selected),
      p = s.api.graph2ScreenCoords(n.x, n.y);
    return {
      p,
      left: s.view.left,
      right: s.view.width - s.motion.frame.drawer,
    };
  });
  assert.ok(centre.p.x > centre.left + 24 && centre.p.x < centre.right - 24);
  await click("Force");
  await settle();
  assert.equal((await state()).scope.note, "Physics/Force.md");
  await page.getByRole("button", { name: "Read", exact: true }).click();
  await page.getByRole("separator").focus();
  await page.keyboard.press("ArrowRight");
  await page
    .getByRole("button", { name: "Back to previous network", exact: true })
    .click();
  await settle();
  const restored = await state();
  assert.deepEqual(restored.frame, topic.frame);
  assert.deepEqual(restored.nodes, topic.nodes);
  assert.equal(restored.selected, topic.selected);
  assert.equal(
    await page
      .locator(".editor-shell")
      .evaluate((el) => el.getBoundingClientRect().width),
    panelWidth,
  );
  await expect(
    page.getByRole("button", { name: "Split", exact: true }),
  ).toHaveClass(/active/);
  await page.getByRole("button", { name: "Close note", exact: true }).click();
  await settle();
  assert.equal((await state()).scope.note, "Physics/Momentum.md");
  await page
    .getByRole("button", { name: "Back to previous network", exact: true })
    .click();
  await settle();
  assert.deepEqual((await state()).frame, subnet.frame);
  assert.deepEqual((await state()).nodes, subnet.nodes);
  await page
    .getByRole("button", { name: "Back to previous network", exact: true })
    .click();
  await settle();
  assert.deepEqual((await state()).frame, overview.frame);
  assert.deepEqual((await state()).nodes, overview.nodes);
  report.checks.push(
    "canonical one-hop expansion, real canvas entry, unchanged review scope, exact Back camera/layout/drawer width/editor mode, close preserves scope",
  );
  await click("Physics");
  await settle();
  await click("Momentum");
  await settle();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const editor = page.locator(".cm-content");
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\nUnsaved synthetic edit");
  await page
    .getByRole("button", { name: "Back to previous network", exact: true })
    .click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  assert.equal((await state()).scope.note, "Physics/Momentum.md");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(editor).toContainText("Unsaved synthetic edit");
  await page
    .getByRole("button", { name: "Back to previous network", exact: true })
    .click();
  await page.getByRole("button", { name: /Discard/ }).click();
  await settle();
  assert.equal((await state()).scope.kind, "subnetwork");
  report.checks.push(
    "dirty navigation cancel preserves edits; explicit discard permits Back",
  );
  await page
    .locator(".note-row")
    .filter({ hasText: /^Momentum$/ })
    .click();
  await page.waitForTimeout(65);
  await page
    .locator(".note-row")
    .filter({ hasText: /^Force$/ })
    .click();
  await page.waitForTimeout(65);
  await page
    .locator(".note-row")
    .filter({ hasText: /^Velocity$/ })
    .click();
  await settle();
  assert.equal((await state()).scope.note, "Physics/Velocity.md");
  report.checks.push("rapid real note selections settle on latest intent");
  await page.evaluate(() =>
    window.depthQA.preferences.update({ motion: "reduced" }),
  );
  await page
    .locator(".note-row")
    .filter({ hasText: /^Unlinked$/ })
    .click();
  await settle();
  await expect(page.locator(".network-empty")).toBeVisible();
  assert.equal(
    await page.evaluate(() => window.depthQA.scene.signals.packets.length),
    0,
  );
  await unlink(path.join(root, "Physics", "Unlinked.md"));
  await page
    .getByRole("button", { name: "Refresh vault", exact: true })
    .click();
  await settle();
  assert.notEqual((await state()).scope.note, "Physics/Unlinked.md");
  report.checks.push(
    "Reduced navigation and silent stationary relationships; honest empty state; deleted focus recovers",
  );
  await page.evaluate(() =>
    window.depthQA.preferences.update({ motion: "full" }),
  );
  await page.setViewportSize({ width: 900, height: 600 });
  await page
    .locator(".note-row")
    .filter({ hasText: /^Momentum$/ })
    .click();
  await settle();
  const small = await page.evaluate(() => {
    const s = window.depthQA.scene,
      n = s.topology.positions.get(s.selected),
      p = s.api.graph2ScreenCoords(n.x, n.y);
    return {
      x: p.x,
      left: s.view.left,
      right: s.view.width - s.motion.frame.drawer,
    };
  });
  assert.ok(small.x > small.left && small.x < small.right);
  await page.screenshot({ path: path.join(out, "small.png") });
  report.checks.push("small window focal node remains uncovered");
  await page.setViewportSize({ width: 1600, height: 1000 });
  await settle();
  await page.mouse.move(1590, 990);
  await page.waitForTimeout(1500);
  const before = await page.evaluate(() => window.depthQA.draws);
  await page.waitForTimeout(700);
  assert.equal(await page.evaluate(() => window.depthQA.draws), before);
  report.checks.push("idle rendering suspends");
  // Real duplicate subject records and a dense neighbourhood, with actual file links.
  let organized = await invoke("organize", {
    vaultRoot: canonicalRoot,
    action: { kind: "new_neuron", name: "Second revision" },
  });
  const otherNeuron = organized.organization.neurons.find(
    (n) => n.name === "Second revision",
  );
  organized = await invoke("organize", {
    vaultRoot: canonicalRoot,
    action: {
      kind: "new_subject",
      name: "Physics",
      neuron_id: otherNeuron.id,
      preset: "physics",
      color: "#32d4ad",
    },
  });
  for (let i = 0; i < 90; i++)
    await writeFile(
      path.join(root, "Physics", `Dense concept ${i}.md`),
      `---\nsubject: physics\n---\n# Dense concept ${i}\n\n[[Physics/Momentum]]\n`,
    );
  await invoke("organize", {
    vaultRoot: canonicalRoot,
    action: { kind: "select", location: { neuron_id: null, subject_id: null } },
  });
  await page
    .getByRole("button", { name: "Refresh vault", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Refresh vault", exact: true }),
  ).toBeEnabled();
  await page
    .locator(".note-row")
    .filter({ hasText: /^Momentum$/ })
    .click();
  await page.waitForFunction(
    () => window.depthQA.scene.topology.visibleNodes.length >= 95,
  );
  await settle();
  assert.equal(
    new Set((await state()).nodes.map((n) => n.id)).size,
    (await state()).nodes.length,
  );
  await page.screenshot({ path: path.join(out, "dense.png") });
  await page
    .getByRole("button", { name: "Return to overview", exact: true })
    .click();
  await settle();
  const duplicateTitles = await page.evaluate(() =>
    window.depthQA.scene.topology.visibleNodes
      .filter((n) => n.title.startsWith("Physics"))
      .map((n) => ({ title: n.title, id: n.id })),
  );
  assert.equal(duplicateTitles.length, 2);
  assert.notEqual(duplicateTitles[0].id, duplicateTitles[1].id);
  assert.notEqual(duplicateTitles[0].title, duplicateTitles[1].title);
  await page.screenshot({ path: path.join(out, "duplicate-subjects.png") });
  report.checks.push(
    "90 new real backlinks reveal without duplicated IDs; duplicate Physics subjects retain independent junctions",
  );
  report.events = await page.evaluate(() =>
    window.depthQA.events.map((e) => ({
      kind: e.intent.kind,
      role: e.intent.role,
      level: e.intent.level,
      node: e.intent.node,
    })),
  );
  assert.ok(report.events.some((e) => e.role === "subnetwork"));
  assert.ok(report.events.some((e) => e.role === "topic"));
  assert.ok(report.events.some((e) => e.role === "concept"));
  assert.deepEqual(report.errors, []);
  report.success = true;
} catch (error) {
  report.failure = String(error);
  report.state = await page.evaluate(() => ({
    scope: window.depthQA?.scene?.exploration.scope,
    frame: window.depthQA?.scene?.motion.frame,
  }));
  await page.screenshot({ path: path.join(out, "failure.png") });
  throw error;
} finally {
  await writeFile(
    path.join(out, "report.json"),
    JSON.stringify(report, null, 2),
  );
  if (original) await invoke("open_vault", { path: original.root });
  await page.evaluate(
    (value) =>
      value === null
        ? localStorage.removeItem("synapse.preferences.v1")
        : localStorage.setItem("synapse.preferences.v1", value),
    originalPreferences,
  );
  await page.reload();
  await browser.close();
}
console.log(
  JSON.stringify(
    { success: report.success, checks: report.checks, errors: report.errors },
    null,
    2,
  ),
);
