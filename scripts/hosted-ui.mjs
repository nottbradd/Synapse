// Browser UI verification: real React + local Worker/D1, mocked desktop IPC and OpenAI.
// This deliberately makes no native-desktop or Credential Manager validation claim.
import { chromium, expect } from "@playwright/test";
import { randomUUID, randomBytes } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
const out = path.resolve(".local/hosted-ui");
await mkdir(out, { recursive: true });
const fixture = JSON.parse(
  await readFile(
    process.argv[2] || ".local/hosted-qa/state/fixture.json",
    "utf8",
  ),
);
assert.equal(fixture.mocked, true);
const renewal = spawnSync(
  process.execPath,
  [
    "backend/ai/owner.mjs",
    "invite",
    "--target",
    "local",
    "--member",
    fixture.first.member,
    "--persist-to",
    path.dirname(
      path.resolve(process.argv[2] || ".local/hosted-qa/state/fixture.json"),
    ),
  ],
  { encoding: "utf8", windowsHide: true },
);
assert.equal(renewal.status, 0, renewal.stderr);
fixture.first = JSON.parse(renewal.stdout);
const gateway = "http://127.0.0.1:18797";
const who = { device: randomUUID(), token: randomBytes(32).toString("hex") };
let offline = false,
  personalCalls = 0;
const settings = {
  provider: "synapse",
  hosted_consent: false,
  hosted_configured: true,
  hosted_connected: false,
  test_api: false,
  model: "gpt-5.4-mini",
  models: ["gpt-5.4-mini", "gpt-5.4"],
  max_output_tokens: 4096,
  timezone: "Australia/Sydney",
  background: false,
  key_present: true,
  usage: {
    requests: 4,
    input_tokens: 100,
    output_tokens: 100,
    last_request_at: null,
  },
  error: null,
};
const saved = {
  data: { schema_version: 1, quizzes: [], attempts: [], reminders: [] },
  revision: "local-fixture",
};
const source = {
  id: "Physics/Momentum.md",
  title: "Momentum",
  subject_id: "physics",
  revision: "source-1",
  external: false,
  content:
    "Momentum is mass times velocity. Total momentum is conserved in a closed system.",
};
let currentContext;
const commands = [];
async function api(route, body = {}) {
  if (offline)
    throw Error(
      "Synapse AI is unavailable. Saved study material remains available offline.",
    );
  const response = await fetch(`${gateway}/v1/${route}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${who.device}.${who.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const value = await response.json();
  if (!response.ok) throw Error(`Synapse AI: ${value.error}`);
  return value;
}
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({
  viewport: { width: 1440, height: 960 },
  reducedMotion: "no-preference",
});
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const report = {
  mockedDesktopIpc: true,
  mockedOpenAI: true,
  realLocalWorkerAndD1: true,
  checks: [],
};
await page.exposeFunction("__qaInvoke", async (command, args = {}) => {
  commands.push(command);
  switch (command) {
    case "device_settings":
      return structuredClone(settings);
    case "startup_state":
      return false;
    case "synapse_ai_status":
      return api("status");
    case "select_ai_provider": {
      assert.ok(
        args.provider === "personal" || args.consent || settings.hosted_consent,
      );
      settings.provider = args.provider;
      if (args.provider === "synapse") settings.hosted_consent = true;
      return structuredClone(settings);
    }
    case "enroll_synapse_ai": {
      assert.equal(args.consent, true);
      await api("enroll", { invite: args.invitation });
      settings.hosted_connected = true;
      settings.hosted_consent = true;
      settings.provider = "synapse";
      return structuredClone(settings);
    }
    case "forget_synapse_ai": {
      if (!args.localOnly) await api("forget");
      settings.hosted_connected = false;
      settings.hosted_consent = false;
      return structuredClone(settings);
    }
    case "study_context":
      currentContext = {
        token: randomUUID(),
        location: { neuron_id: null, subject_id: null },
        kind: args.kind,
        sources: [
          {
            ...source,
            content: args.kind === "reminder" ? "" : source.content,
          },
        ],
        excluded: [],
        bytes: args.kind === "reminder" ? 0 : source.content.length,
        prepared_at: Math.floor(Date.now() / 1000),
      };
      return currentContext;
    case "generate_study": {
      if (settings.provider === "personal") {
        personalCalls++;
        throw Error("Personal network disabled in this UI fixture");
      }
      const r = args.request;
      const v = await api("generate", {
        request_id: r.request_id,
        kind: r.kind,
        count: r.count,
        prompt: r.prompt,
        timezone: settings.timezone,
        current_subject_id: null,
        sources: currentContext.sources.map((s) => ({
          id: s.id,
          title: s.title,
          subject_id: s.subject_id,
          content: s.content,
        })),
      });
      const draft = JSON.parse(v.output[0].content[0].text);
      if (draft.questions)
        draft.questions = draft.questions.map((q) => ({
          ...q,
          id: randomUUID(),
        }));
      return {
        request_id: r.request_id,
        draft: { kind: r.kind, data: draft },
        input_tokens: v.usage?.input_tokens ?? 0,
        output_tokens: v.usage?.output_tokens ?? 0,
        reference_time: v.reference_time,
        usage_warning: null,
      };
    }
    case "save_study_quiz":
      saved.data.quizzes.push({
        id: args.requestId,
        subject_id: args.subjectId,
        created_at: Math.floor(Date.now() / 1000),
        draft: args.draft,
        sources: [source],
      });
      return structuredClone(saved);
    case "start_study_draft":
      return randomUUID();
    case "cancel_study":
      return;
    case "study_list":
      return structuredClone(saved);
    default:
      throw Error(`Unhandled fixture command: ${command}`);
  }
});
await page.addInitScript(() => {
  window.__TAURI_INTERNALS__ = {
    invoke: (command, args) => window.__qaInvoke(command, args),
  };
  window.__vite_plugin_react_preamble_installed__ = true;
  window.$RefreshReg$ = () => {};
  window.$RefreshSig$ = () => (type) => type;
});
const html = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/src/styles.css"></head><body><div id="root"></div><script type="module">
import React from '/node_modules/.vite/deps/react.js';
import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
const {useState}=React;const {createRoot}=ReactDOM;
import Preferences from '/src/components/Preferences.tsx';
import StudyPanel from '/src/components/StudyPanel.tsx';
const snapshot={root:'synthetic-browser-fixture',notes:[{id:'Physics/Momentum.md',title:'Momentum',subject_id:'physics',neuron_id:'study',revision:'source-1'}],edges:[],warnings:[],organization:{location:{neuron_id:null,subject_id:null},neurons:[{id:'study',name:'Study'}],subjects:[{id:'physics',name:'Physics',neuron_id:'study'}]}};
function Harness(){const [preferences,setPreferences]=useState(true),[view,setView]=useState({data:{quizzes:[],attempts:[],reminders:[]},revision:'fixture'});return React.createElement('main',{className:'app','data-motion':'full'},React.createElement('p',{style:{padding:32,color:'#9baab8'}},'LOCAL TEST · React + Worker/D1 · Mock desktop IPC and OpenAI'),React.createElement('button',{onClick:()=>setPreferences(true),style:{position:'absolute',left:32,top:80}},'Open preferences'),React.createElement(StudyPanel,{snapshot,currentNote:'Physics/Momentum.md',initialView:'create',view,onRefresh:async()=>setView(await window.__qaInvoke('study_list')),onSnapshot:()=>{},onOpen:()=>{},onClose:()=>{},onSettings:()=>setPreferences(true)}),preferences&&React.createElement(Preferences,{onClose:()=>setPreferences(false)}));}
createRoot(document.getElementById('root')).render(React.createElement(Harness));
</script></body></html>`;
await page.route("**/__hosted_qa.html", (route) =>
  route.fulfill({ contentType: "text/html", body: html }),
);
try {
  await page.goto("http://127.0.0.1:1420/__hosted_qa.html");
  await expect(page.getByLabel("AI provider")).toHaveValue("synapse");
  await page.getByLabel("Synapse AI invitation").fill(fixture.first.invitation);
  await expect(
    page.getByRole("button", { name: "Activate Synapse AI", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("I understand and enable this data transfer").check();
  await page.screenshot({ path: path.join(out, "onboarding.png") });
  await page
    .getByRole("button", { name: "Activate Synapse AI", exact: true })
    .click();
  await expect(
    page.getByText("Synapse AI activated on this device"),
  ).toBeVisible();
  await expect(page.locator(".preferences .usage-info")).toContainText(
    "10 / 10 left today",
  );
  report.checks.push(
    "new-user hosted path, explicit data consent, real local invitation enrollment and allowance",
  );
  await page.getByLabel("AI provider").selectOption("personal");
  assert.equal(settings.provider, "synapse");
  await page
    .getByRole("button", { name: "Use personal API key", exact: true })
    .click();
  await expect(page.getByLabel("OpenAI model")).toBeVisible();
  assert.equal(settings.provider, "personal");
  assert.equal(settings.key_present, true);
  await page.getByLabel("AI provider").selectOption("synapse");
  assert.equal(settings.provider, "personal");
  await page
    .getByRole("button", { name: "Use Synapse AI", exact: true })
    .click();
  await expect(page.getByLabel("OpenAI model")).toHaveCount(0);
  report.checks.push(
    "provider change requires explicit apply; personal credential/preferences retained",
  );
  await page
    .getByRole("button", { name: "Close preferences", exact: true })
    .click();
  await expect(
    page.getByLabel("Number of study items").locator("option"),
  ).toHaveCount(3);
  await page.getByLabel("Number of study items").selectOption("3");
  await page
    .getByLabel("Study request")
    .fill("Create three practice questions about momentum.");
  await page
    .getByRole("button", { name: "Generate quiz", exact: true })
    .click();
  await expect(page.getByLabel("Quiz title")).toBeVisible();
  assert.equal(saved.data.quizzes.length, 0);
  await page.getByLabel("Quiz title").fill("Edited hosted quiz");
  await page.screenshot({ path: path.join(out, "editable-quiz.png") });
  await page.getByRole("button", { name: "Save quiz", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Take quiz", exact: true }),
  ).toBeVisible();
  assert.equal(saved.data.quizzes[0].draft.title, "Edited hosted quiz");
  report.checks.push(
    "hosted quiz through real Worker; editable unsaved draft; explicit local save (mock IPC)",
  );
  offline = true;
  await page.getByRole("button", { name: "Take quiz", exact: true }).click();
  await expect(page.getByRole("radio").first()).toBeVisible();
  report.checks.push("saved quiz opens without gateway access");
  await page
    .getByRole("button", { name: "Open preferences", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Refresh allowance", exact: true })
    .click();
  await expect(page.locator(".preferences").getByRole("alert")).toContainText(
    "unavailable",
  );
  assert.equal(settings.provider, "synapse");
  assert.equal(personalCalls, 0);
  await page.screenshot({ path: path.join(out, "offline-service.png") });
  report.checks.push(
    "unavailable hosted service stays on selected provider; no personal-key call",
  );
  offline = false;
  await page
    .getByRole("button", { name: "Refresh allowance", exact: true })
    .click();
  await expect(page.locator(".preferences .usage-info")).toContainText(
    "9 / 10 left today",
  );
  await page.getByText("Hosted usage details", { exact: true }).click();
  await expect(
    page.getByText(/Estimated usage and reservations/),
  ).toBeVisible();
  await page.screenshot({ path: path.join(out, "hosted-settings.png") });
  report.checks.push(
    "detailed account usage, conservative estimates and timezone reset display",
  );
  await page
    .getByRole("button", { name: "Revoke this device", exact: true })
    .click();
  await expect(
    page.getByText("This device was revoked and its credential removed"),
  ).toBeVisible();
  report.checks.push("device revocation through real Worker");
  assert.deepEqual(errors, []);
  report.success = true;
} catch (e) {
  report.failure = e.message;
  process.exitCode = 1;
  await page
    .screenshot({ path: path.join(out, "failure.png") })
    .catch(() => {});
} finally {
  await writeFile(
    path.join(out, "report.json"),
    JSON.stringify({ ...report, errors, personalCalls, commands }, null, 2),
  );
  console.log(JSON.stringify(report));
  await browser.close();
}
