// Follow-up to the single approved live trial: only denied generation requests.
// The duplicate must already exist in the remote ledger before resuming.
import { chromium, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { spawnSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import assert from "node:assert/strict";

if (!process.argv.includes("--verify-existing-trial"))
  throw Error(
    "Use --verify-existing-trial after inspecting the successful trial record.",
  );
const output = path.resolve(".local/hosted-live-0.5.1");
const reportPath = path.join(output, "trial.json");
const report = JSON.parse(await readFile(reportPath, "utf8"));
assert.equal(report.stage, "inference-and-offline-passed");
function owner(command, args = []) {
  const run = spawnSync(
    process.execPath,
    ["backend/ai/owner.mjs", command, "--target", "remote", ...args],
    { encoding: "utf8", windowsHide: true },
  );
  if (run.status !== 0)
    throw Error(`Owner ${command} failed; diagnostics withheld.`);
  return JSON.parse(run.stdout);
}
const baseline = owner("ledger").filter((c) => c.member === report.member);
assert.equal(baseline.length, 1);
assert.equal(baseline[0].request_id, report.call.request_id);
assert.equal(baseline[0].state, "measured");
assert.equal(baseline[0].active, 0);
let browser,
  page,
  privateEntry = false;
const invoke = (command, args = {}) =>
  page.evaluate(
    ({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args),
    { command, args },
  );
const outcome = (command, args = {}) =>
  page.evaluate(
    async ({ command, args }) => {
      try {
        return {
          allowed: true,
          value: await window.__TAURI_INTERNALS__.invoke(command, args),
        };
      } catch (error) {
        return { allowed: false, error };
      }
    },
    { command, args },
  );
async function attach() {
  for (let i = 0; i < 25; i++) {
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
      page = browser.contexts()[0].pages()[0];
      await page.waitForFunction(() => !!window.__TAURI_INTERNALS__?.invoke);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  throw Error("Installed app did not expose its test debugger.");
}
async function denied(request, fragment) {
  // Catch inside the renderer so Playwright does not turn Tauri's structured
  // rejection into a generic Error and discard its code/message fields.
  const result = await outcome("generate_study", { request });
  assert.equal(
    result.allowed,
    false,
    "Expected a denied request; inspect the ledger immediately.",
  );
  assert.equal(result.error.code, "hosted");
  assert.ok(result.error.message.includes(fragment), result.error.message);
  return result.error.message;
}
const executable = path.join(
  process.env.LOCALAPPDATA,
  "Synapse",
  "synapse.exe",
);
const unchangedLedger = () =>
  assert.deepEqual(
    owner("ledger").filter((c) => c.member === report.member),
    baseline,
  );
try {
  await attach();
  delete report.verificationError;
  if (!(await invoke("device_settings")).hosted_connected) {
    // Recovery never creates another person or repeats the paid call.
    privateEntry = true;
    const ticket = owner("invite", [
      "--member",
      report.member,
      "--minutes",
      "5",
    ]);
    try {
      await invoke("enroll_synapse_ai", {
        invitation: ticket.invitation,
        consent: true,
      });
    } finally {
      ticket.invitation = "";
    }
    privateEntry = false;
    report.previousTrialDevices = [
      ...(report.previousTrialDevices ?? []),
      report.device,
    ];
    report.device = (await invoke("synapse_ai_status")).device;
    await writeFile(reportPath, JSON.stringify(report, null, 2));
    await invoke("open_vault", { path: report.canonicalRoot });
    await page.reload();
  }
  // A real app restart clears Rust's local submitted-ID set. The next rejection
  // therefore has to come from the production gateway, not the desktop guard.
  await invoke("close_synapse_window", { quit: true }).catch(() => {});
  await browser.close();
  const app = spawn(executable, [], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9222",
    },
  });
  app.unref();
  await attach();
  assert.equal(await invoke("plugin:app|version"), "0.5.1");
  assert.equal((await invoke("device_settings")).provider, "synapse");
  assert.equal((await invoke("restore_vault")).root, report.canonicalRoot);
  const source = await invoke("study_context", {
    vaultRoot: report.canonicalRoot,
    sourceIds: [report.sourceId],
    kind: "quiz",
  });
  const request = {
    context_token: source.token,
    request_id: report.call.request_id,
    kind: "quiz",
    prompt: report.prompt,
    count: 3,
  };
  owner("resume", [
    "--funding-reviewed",
    "--pricing-reviewed",
    "--credential-reviewed",
  ]);
  assert.equal((await invoke("synapse_ai_status")).reason, null);
  report.duplicateRejection = await denied(request, "not sent to OpenAI again");
  unchangedLedger();
  assert.equal((await invoke("synapse_ai_status")).remaining, 9);
  report.checks.push(
    "same request ID after a real desktop restart rejected by live gateway; ledger, tokens and allowance unchanged",
  );

  owner("pause");
  assert.equal((await invoke("synapse_ai_status")).reason, "service_paused");
  report.pauseRejection = await denied(
    { ...request, request_id: randomUUID() },
    "paused",
  );
  unchangedLedger();
  await page.getByRole("button", { name: "Preferences", exact: true }).click();
  await expect(
    page.getByText("Synapse AI is paused by the owner.", { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: path.join(output, "live-service-paused.png") });
  report.checks.push(
    "live paused generation rejected before admission; stored Personal usage counter remains unchanged",
  );
  owner("revoke-device", ["--device", report.device]);
  report.revocationRejection = await denied(
    { ...request, request_id: randomUUID() },
    "revoked",
  );
  const revokedStatus = await outcome("synapse_ai_status");
  assert.equal(revokedStatus.allowed, false);
  assert.equal(revokedStatus.error.code, "hosted");
  assert.ok(revokedStatus.error.message.includes("revoked"));
  unchangedLedger();
  report.revokedDevice = owner("devices", ["--member", report.member]).find(
    (d) => d.id === report.device,
  );
  assert.equal(report.revokedDevice.revoked, 1);
  report.checks.push(
    "trial device revoked; authenticated status and new generation rejected; no additional upstream ledger entry",
  );
  assert.deepEqual(
    (await invoke("device_settings")).usage,
    report.beforeSettings.usage,
  );
  report.stage = "live-controls-passed";
} catch (error) {
  report.verificationError = privateEntry
    ? "Private recovery enrollment failed; diagnostics withheld."
    : String(error?.message ?? error);
  process.exitCode = 1;
} finally {
  try {
    report.finalPause = owner("pause");
  } catch {
    report.pauseError = "Pause could not be confirmed";
    process.exitCode = 1;
  }
  if (page) {
    // Only this trial created hosted access; initial absence was asserted.
    try {
      const devices = owner("devices", ["--member", report.member]);
      if (devices.some((d) => d.id === report.device && !d.revoked))
        owner("revoke-device", ["--device", report.device]);
      await invoke("select_ai_provider", {
        provider: report.beforeSettings.provider,
        consent: report.beforeSettings.hosted_consent,
      });
      await invoke("forget_synapse_ai", { localOnly: true });
      if (report.original) {
        await invoke("open_vault", { path: report.original.root });
        await invoke("organize", {
          vaultRoot: report.original.root,
          action: { kind: "select", location: report.original.location },
        });
        await page.reload();
      }
      assert.deepEqual(await invoke("device_settings"), report.beforeSettings);
      assert.equal(
        await page.evaluate(() =>
          localStorage.getItem("synapse.preferences.v1"),
        ),
        report.beforePreferences,
      );
      report.settingsRestored = true;
      await page
        .getByRole("button", { name: "Preferences", exact: true })
        .click();
      await page.screenshot({
        path: path.join(output, "original-settings-restored.png"),
      });
      await page
        .getByRole("button", { name: "Close preferences", exact: true })
        .click();
      await invoke("close_synapse_window", { quit: true }).catch(() => {});
      await browser.close();
      browser = null;
      const cleanEnv = { ...process.env };
      delete cleanEnv.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS;
      const normal = spawn(executable, [], {
        env: cleanEnv,
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
      normal.unref();
      report.normalAppPid = normal.pid;
    } catch (error) {
      report.restoreError = String(error?.message ?? error);
      process.exitCode = 1;
    }
  }
  report.finalUsage = owner("usage");
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  if (browser) await browser.close();
  console.log(
    JSON.stringify({
      stage: report.stage,
      checks: report.checks,
      settingsRestored: report.settingsRestored,
      duplicate: report.duplicateRejection,
      pause: report.pauseRejection,
      revoked: report.revocationRejection,
      usage: report.finalUsage,
      error: report.verificationError,
      restoreError: report.restoreError,
    }),
  );
}
