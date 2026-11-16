// Installed 0.6.0: real Rust, WebView compositor frames and app-generated audio.
// The disposable vault is synthetic. No provider, enrollment or production hook.
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
const out = path.resolve(".local/release-0.6.0");
await mkdir(out, { recursive: true });
const original = await invoke("restore_vault");
const originalSettings = await invoke("device_settings");
const originalPreferences = await page.evaluate(() =>
  localStorage.getItem("synapse.preferences.v1"),
);
const fixture = JSON.parse(
  await readFile(".local/refinement-fixture.json", "utf8"),
);
const root = path.join(
  tmpdir(),
  "synapse-desktop-qa",
  `release-060-${Date.now()}`,
  "Synapse demo",
);
await cp(fixture.root, root, { recursive: true });
const notes = {
  Momentum: [
    "Momentum combines mass and velocity: $p = mv$. For an isolated system, total momentum remains constant.",
    ["Impulse", "Force", "Velocity", "Mass"],
  ],
  Impulse: [
    "Impulse is the change in momentum. A force acting over a time interval gives $J = F\\Delta t = \\Delta p$.",
    ["Momentum", "Force"],
  ],
  Force: [
    "A net force changes momentum. For constant mass, Newton’s second law gives $F = ma$.",
    ["Momentum", "Impulse", "Velocity"],
  ],
  Velocity: [
    "Velocity describes speed and direction. Its direction determines the direction of momentum.",
    ["Momentum", "Force", "Mass"],
  ],
  Mass: [
    "Mass measures inertia. At the same velocity, a greater mass has a greater momentum.",
    ["Velocity", "Momentum"],
  ],
};
for (const [title, [body, links]] of Object.entries(notes))
  await writeFile(
    path.join(root, "Physics", title + ".md"),
    `---\ntitle: ${title}\nsubject: physics\n---\n# ${title}\n\n${body}\n\n## Connections\n\n${links.map((n) => `- [[Physics/${n}|${n}]]`).join("\n")}\n`,
  );
const report = {
  version: await invoke("plugin:app|version"),
  url: page.url(),
  checks: [],
  errors: [],
};
page.on("pageerror", (error) => report.errors.push(error.message));
await writeFile(
  path.join(out, "restore.json"),
  JSON.stringify({ original, originalSettings, originalPreferences }, null, 2),
);
let recording;
try {
  assert.equal(report.version, "0.6.0");
  assert.equal(report.url, "http://tauri.localhost/");
  assert.equal(originalSettings.provider, "personal");
  assert.equal(originalSettings.test_api, false);
  assert.equal(originalSettings.hosted_configured, true);
  assert.deepEqual(JSON.parse(originalPreferences), {
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
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.emulateMedia({ reducedMotion: null });
  await expect(page.locator(".sidebar")).toBeVisible();
  await page.getByLabel("Search notes", { exact: true }).fill("Momentum");
  await page
    .locator(".note-row")
    .filter({ hasText: /^Momentum$/ })
    .click();
  await page.getByRole("button", { name: "Read", exact: true }).click();
  await page.getByLabel("Search notes", { exact: true }).fill("");
  await page
    .getByRole("button", { name: "Return to overview", exact: true })
    .click();
  await page.waitForTimeout(1300);
  // Reload destroys the warm-up AudioContext before recordDesktop attaches its output tap.
  await page.reload();
  await expect(page.locator(".sidebar")).toBeVisible();
  await page.waitForTimeout(1300);
  recording = await recordDesktop({
    page,
    context,
    name: "Synapse-0.6.0-exploration",
    fixture: "Temporary synthetic Synapse demo vault",
  });
  const pause = () => page.waitForTimeout(1500);
  const browse = async (title, cue) => {
    await page.getByLabel("Browse current network", { exact: true }).click();
    await page.waitForTimeout(350);
    await recording.mark(cue);
    await page
      .locator(".network-browser")
      .getByRole("button", { name: title, exact: true })
      .click();
    await expect(page.locator(".graph-heading h1")).toHaveAttribute(
      "title",
      title,
    );
    await page.mouse.move(300, 990);
    await pause();
  };
  const back = async (name) => {
    await recording.mark(name);
    await page
      .getByRole("button", { name: "Back to previous network", exact: true })
      .click();
    await page.mouse.move(300, 990);
    await pause();
  };
  const canvasImage = () =>
    page
      .locator(".force-graph-container canvas")
      .first()
      .evaluate((c) => c.toDataURL());
  await page.screenshot({ path: path.join(out, "overview.png") });
  const overview = await canvasImage();
  await pause();
  await browse("Physics", "Subnetwork · warm lower register");
  await page.screenshot({ path: path.join(out, "subnetwork.png") });
  const subnetwork = await canvasImage();
  await browse("Momentum", "Topic · middle register and linked network reveal");
  await page.screenshot({ path: path.join(out, "topic.png") });
  const topic = await canvasImage();
  for (const title of ["Impulse", "Force", "Velocity", "Mass"]) {
    await browse(title, `Concept · ${title} · high register`);
    await back(`Back to Momentum from ${title}`);
    assert.equal(
      await canvasImage(),
      topic,
      "Installed Back returns to identical settled canvas pixels",
    );
    await expect(page.locator(".editor-panel .note-title h2")).toHaveAttribute(
      "title",
      "Momentum",
    );
  }
  await back("Back to Physics · exact framing");
  assert.equal(await canvasImage(), subnetwork);
  await back("Back to overview · exact framing");
  assert.equal(await canvasImage(), overview);
  await expect(
    page.getByRole("button", { name: "Back to previous network", exact: true }),
  ).toHaveCount(0);
  await recording.finish();
  recording = null;
  report.checks.push(
    "installed source version and hosted origin",
    "native focus and actual app audio at 69%",
    "overview, subnetwork, topic and four linked concepts",
    "pixel-identical settled Back frames, drawer selection and overview",
    "real compositor timestamps without frame interpolation",
  );

  await page.getByRole("button", { name: "Preferences", exact: true }).click();
  await expect(page.getByLabel("Animations", { exact: true })).toHaveValue(
    "full",
  );
  await page.getByLabel("AI provider", { exact: true }).selectOption("synapse");
  await expect(
    page.getByRole("button", { name: "Activate Synapse AI", exact: true }),
  ).toBeDisabled();
  await expect(page.locator("#hosted-data-notice")).toBeVisible();
  await page
    .getByRole("button", { name: "Close preferences", exact: true })
    .click();
  assert.equal((await invoke("device_settings")).provider, "personal");
  report.checks.push(
    "hosted invitation/consent UI remains gated without enrollment or inference",
  );
  assert.deepEqual(report.errors, []);
} finally {
  if (recording) await recording.finish().catch(() => {});
  if (original) await invoke("open_vault", { path: original.root });
  await page.evaluate(
    (value) =>
      value === null
        ? localStorage.removeItem("synapse.preferences.v1")
        : localStorage.setItem("synapse.preferences.v1", value),
    originalPreferences,
  );
  await page.reload();
  report.restoredSettings = await invoke("device_settings");
  assert.deepEqual(report.restoredSettings, originalSettings);
  report.restoredPreferences = await page.evaluate(() =>
    localStorage.getItem("synapse.preferences.v1"),
  );
  assert.equal(report.restoredPreferences, originalPreferences);
  await writeFile(
    path.join(out, "report.json"),
    JSON.stringify(report, null, 2),
  );
  await browser.close();
}
console.log(JSON.stringify({ success: true, ...report }, null, 2));
