// Installed 0.7.0 regression and live audio capture. Uses the disposable vault
// prepared by the native startup checks; no AI/enrollment/funding operations.
import { chromium, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { recordDesktop } from "./record-desktop.mjs";
const out = ".local/release-0.7.0";
const restore = JSON.parse(await readFile(`${out}/restore.json`, "utf8"));
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const context = browser.contexts()[0],
  page = context.pages()[0];
const invoke = (command, args = {}) =>
  page.evaluate(
    ({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args),
    { command, args },
  );
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
assert.equal(await invoke("plugin:app|version"), "0.7.0");
assert.equal((await invoke("device_settings")).provider, "personal");
assert.equal((await invoke("device_settings")).hosted_consent, false);
assert.equal(
  await page.evaluate(() => localStorage.getItem("synapse.preferences.v1")),
  restore.originalPreferences,
);
const notes = {
  Momentum: ["Impulse", "Force", "Velocity", "Mass"],
  Impulse: ["Momentum", "Force"],
  Force: ["Momentum", "Impulse"],
  Velocity: ["Momentum", "Mass"],
  Mass: ["Momentum", "Velocity"],
};
for (const [title, links] of Object.entries(notes))
  await writeFile(
    path.join(restore.fixture, "Physics", `${title}.md`),
    `---\ntitle: ${title}\nsubject: physics\n---\n# ${title}\n\nSynthetic study example for the Synapse sound audition.\n\n${links.map((n) => `- [[Physics/${n}|${n}]]`).join("\n")}\n`,
  );
const snapshot = await invoke("open_vault", { path: restore.fixture });
await invoke("organize", {
  vaultRoot: snapshot.root,
  action: { kind: "select", location: { neuron_id: null, subject_id: null } },
});
await page.setViewportSize({ width: 1600, height: 1000 });
await page.reload();
await expect(page.locator(".sidebar")).toBeVisible();
await page.waitForTimeout(1300);
const recording = await recordDesktop({
  page,
  context,
  name: "Synapse-0.7.0-sound",
  fixture: "Temporary synthetic Synapse demo vault; saved 69% volume",
});
const pause = () => page.waitForTimeout(1300);
let captureIndex = 0;
const canvas = async () => {
  const data = await page
    .locator(".force-graph-container canvas")
    .first()
    .evaluate((c) => c.toDataURL());
  await writeFile(
    `${out}/back-${captureIndex++}.png`,
    Buffer.from(data.split(",")[1], "base64"),
  );
  return createHash("sha256").update(data).digest("hex");
};
const browse = async (title, label) => {
  await page.getByLabel("Browse current network", { exact: true }).click();
  await recording.mark(label);
  await page
    .locator(".network-browser")
    .getByRole("button", { name: title, exact: true })
    .click();
  await expect(page.locator(".graph-heading h1")).toHaveAttribute(
    "title",
    title,
  );
  await page.mouse.move(50, 50);
  await pause();
};
const back = async (label) => {
  await recording.mark(label);
  await page.getByLabel("Back to previous network", { exact: true }).click();
  await page.mouse.move(50, 50);
  await pause();
};
try {
  await page.mouse.move(50, 50);
  await pause();
  const overview = await canvas();
  await browse("Physics", "Subnetwork: warm lower register");
  const subnetwork = await canvas();
  await browse(
    "Momentum",
    "Topic: middle register and real neighbour arrivals",
  );
  const topic = await canvas();
  await browse("Impulse", "Concept: highest, shortest register");
  await back("Back to topic");
  assert.equal(await canvas(), topic, "Back to Momentum");
  await browse("Force", "Another linked concept");
  await back("Back to topic again");
  assert.equal(await canvas(), topic, "Repeated Back to Momentum");
  await back("Back to subnetwork");
  assert.equal(await canvas(), subnetwork, "Back to Physics");
  await back("Back to overview");
  assert.equal(await canvas(), overview, "Back to overview");
} finally {
  await recording.finish();
}
await page.getByLabel("Preferences", { exact: true }).click();
await expect(page.getByLabel("Animations", { exact: true })).toHaveValue(
  "full",
);
await expect(page.getByLabel("Sound volume", { exact: true })).toHaveValue(
  "69",
);
await expect(
  page.getByLabel("Startup animation", { exact: true }),
).toBeChecked();
await page.getByLabel("Startup animation", { exact: true }).uncheck();
assert.equal(
  await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("synapse.preferences.v1"))
        .startupAnimation,
  ),
  false,
);
await page.getByLabel("Startup animation", { exact: true }).check();
await page.emulateMedia({ reducedMotion: "reduce" });
await expect(page.locator("main.app")).toHaveAttribute("data-motion", "full");
await page.getByLabel("Animations", { exact: true }).selectOption("system");
await expect(page.locator("main.app")).toHaveAttribute(
  "data-motion",
  "reduced",
);
await page.getByLabel("Animations", { exact: true }).selectOption("full");
await page.emulateMedia({ reducedMotion: null });
await page.getByLabel("Close preferences", { exact: true }).click();
await page.evaluate(
  (value) => localStorage.setItem("synapse.preferences.v1", value),
  restore.originalPreferences,
);
await page.reload();
await page.waitForTimeout(1300);
assert.equal(await page.locator(".swarm-overlay").count(), 0);
assert.deepEqual(errors, []);
const report = {
  success: true,
  installedVersion: "0.7.0",
  nativeFocus: await invoke("plugin:window|is_focused", { label: "main" }),
  savedPreferences: await page.evaluate(() =>
    localStorage.getItem("synapse.preferences.v1"),
  ),
  settings: await invoke("device_settings"),
  checks: [
    "Real app audio at saved 69%",
    "Overview, subnetwork, topic, linked concepts",
    "Exact settled Canvas on Back",
    "Startup checkbox persistence",
    "Full overrides OS reduced motion",
    "Follow Windows respects OS reduction",
    "Reload never replays startup",
    "Personal AI selection and hosted consent unchanged",
  ],
  errors,
};
await writeFile(`${out}/audition-report.json`, JSON.stringify(report, null, 2));
await browser.close();
console.log(JSON.stringify(report, null, 2));
