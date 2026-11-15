// Captures the actual packaged Tauri app and its Web Audio output. Requires a
// focused Synapse window launched with --remote-debugging-port=9222.
import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222"),
  context = browser.contexts()[0],
  page = context.pages()[0];
const invoke = (command, args = {}) =>
  page.evaluate(
    ({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args),
    { command, args },
  );
if (process.argv.includes("--setup")) {
  const root = path.join(
    tmpdir(),
    "synapse-desktop-qa",
    `capture-${Date.now()}`,
    "Synapse release verification",
  );
  const groups = {
    Physics: [
      "Conservation of momentum",
      "Impulse",
      "Newton’s laws",
      "Work and energy",
      "Circular motion",
      "Gravitation",
      "Electric fields",
      "Magnetic flux",
    ],
    Methods: [
      "Derivatives",
      "Rates of change",
      "Integration",
      "Functions",
      "Exponentials",
      "Probability",
    ],
    Specialist: [
      "Complex numbers",
      "Vectors",
      "Differential equations",
      "Proof by induction",
      "Polar form",
      "Trigonometric identities",
    ],
    "English Language": [
      "Language and identity",
      "Register",
      "Vowels and consonants",
      "Discourse",
      "Syntax",
      "Semantics",
    ],
    "Systems thinking": [
      "Feedback loops",
      "Networks",
      "Emergence",
      "Boundaries",
      "Stocks and flows",
      "Resilience",
    ],
  };
  for (const [folder, names] of Object.entries(groups)) {
    await mkdir(path.join(root, folder), { recursive: true });
    for (let i = 0; i < names.length; i++) {
      const title = names[i],
        next = names[(i + 1) % names.length],
        other = names[(i + 3) % names.length];
      let body = `# ${title}\n\nThese synthetic notes exercise Synapse’s reading, linking and revision workflows.\n\n## Connections\n\n[[${folder}/${next}|${next}]] and [[${folder}/${other}|${other}]] provide related paths through this subject.\n`;
      if (title === "Conservation of momentum")
        body =
          "# Conservation of momentum\n\nIn an isolated system, total momentum remains constant. Internal forces transfer momentum between objects without changing the total.\n\n## Before and after a collision\n\n$$m_1u_1+m_2u_2=m_1v_1+m_2v_2$$\n\nEach velocity includes its direction. Choose a positive direction before substituting values.\n\n[[Physics/Impulse|Impulse]] connects a change in momentum to force and time. [[Physics/Newton’s laws|Newton’s laws]] describe the underlying dynamics.\n\nQ: What is conserved in an isolated system?\nA: Total momentum.\n";
      if (title === "Impulse")
        body =
          "# Impulse\n\nImpulse is the change in momentum produced by a force acting over time.\n\n$$J=\\Delta p=F\\Delta t$$\n\nA longer contact time reduces the average force for the same change in momentum.\n\n[[Physics/Conservation of momentum|Conservation of momentum]] connects the changes across a whole system.\n\nImpulse :: Change in momentum\n";
      if (title === "Vowels and consonants")
        body =
          "# Vowels and consonants\n\nPhonetic transcription separates written forms from speech sounds.\n\nə ʃ ʒ θ ð ŋ ɹ ɪ æ ɑː ɔː ʊ ʌ\n\nCompare [[English Language/Register|Register]] and [[English Language/Language and identity|Language and identity]].\n";
      if (folder === "Methods" && i === 0)
        body +=
          "\n$$\\frac{d}{dx}x^n=nx^{n-1}$$\n\n[[Physics/Impulse|Impulse]] uses change over time.\n\nDerivative :: Instantaneous rate of change\n";
      if (folder === "Specialist" && i === 0)
        body +=
          "\n$$e^{i\\theta}=\\cos\\theta+i\\sin\\theta$$\n\n[[Methods/Functions|Functions]]\n";
      if (folder === "Systems thinking" && i === 0)
        body +=
          "\n[[English Language/Discourse|Discourse]] connects ideas in context.\n";
      await writeFile(path.join(root, folder, `${title}.md`), body);
    }
  }
  let s = await invoke("open_vault", { path: root });
  s = await invoke("organize", {
    vaultRoot: s.root,
    action: {
      kind: "rename",
      id: s.organization.neurons[0].id,
      name: "Study workspace",
    },
  });
  const custom = s.organization.subjects.find(
    (s) => s.name === "Systems thinking",
  );
  await invoke("organize", {
    vaultRoot: s.root,
    action: { kind: "select", location: { neuron_id: null, subject_id: null } },
  });
  await writeFile(
    ".local/capture-vault.json",
    JSON.stringify({ root, canonicalRoot: s.root, custom }, null, 2),
  );
  await page.reload();
  await expect(page.locator(".graph-heading")).toContainText("32 notes");
  await browser.close();
  process.exit(0);
}
if (!page.url().startsWith("http://tauri.localhost"))
  throw Error("Record the packaged release");
await context.setOffline(false);
await page.emulateMedia({ reducedMotion: "no-preference" });
const qa = JSON.parse(await readFile(".local/capture-vault.json", "utf8"));
await invoke("open_vault", { path: qa.root });
await invoke("organize", {
  vaultRoot: qa.canonicalRoot,
  action: { kind: "select", location: { neuron_id: null, subject_id: null } },
});
await page.reload();
await page.setViewportSize({ width: 1600, height: 1000 });
await expect(page.locator(".sidebar")).toBeVisible();
await page.waitForTimeout(1800);
// Tap only this app's final audio output, never the microphone or desktop audio.
await page.evaluate(() => {
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (...args) {
    const result = Reflect.apply(connect, this, args);
    if (
      args[0] === this.context.destination &&
      this.context instanceof AudioContext
    ) {
      const destination = this.context.createMediaStreamDestination();
      Reflect.apply(connect, this, [destination]);
      window.captureAudio = { destination, context: this.context };
    }
    return result;
  };
});
await page.getByRole("button", { name: "Fit graph", exact: true }).click();
await page.waitForTimeout(1000);
await page.mouse.move(1550, 970);
await page.screenshot({ path: ".local/Synapse-0.3.0-overview.png" });
const audioReady = await page.evaluate(
  () =>
    !!window.captureAudio && window.captureAudio.context.state === "running",
);
if (!audioReady)
  throw Error("Focus the native Synapse window before recording");
const folder = path.resolve(".local/capture-frames");
await mkdir(folder, { recursive: true });
const cdp = await context.newCDPSession(page),
  frames = [],
  writes = [];
cdp.on("Page.screencastFrame", (event) => {
  const file = path.join(
    folder,
    `${String(frames.length).padStart(5, "0")}.jpg`,
  );
  frames.push({ file, time: event.metadata.timestamp });
  writes.push(writeFile(file, Buffer.from(event.data, "base64")));
  void cdp.send("Page.screencastFrameAck", { sessionId: event.sessionId });
});
await cdp.send("Page.startScreencast", {
  format: "jpeg",
  quality: 85,
  maxWidth: 1600,
  maxHeight: 1000,
  everyNthFrame: 3,
});
const start = await page.evaluate(() => {
  const stream = window.captureAudio.destination.stream,
    recorder = new MediaRecorder(stream, {
      mimeType: "audio/webm;codecs=opus",
    }),
    chunks = [];
  recorder.ondataavailable = (e) => chunks.push(e.data);
  window.captureRecording = { recorder, chunks };
  recorder.start();
  return (performance.timeOrigin + performance.now()) / 1000;
});
await page.waitForTimeout(600);
await page
  .locator(".note-row")
  .filter({ hasText: "Conservation of momentum" })
  .click();
await page.waitForTimeout(1500);
await page.mouse.move(1550, 970);
await page.screenshot({ path: ".local/Synapse-0.3.0-reading.png" });
await page
  .locator(".preview .wiki-link")
  .filter({ hasText: "Impulse" })
  .click();
await page.waitForTimeout(1500);
await page.getByRole("button", { name: "Close note", exact: true }).click();
await page.waitForTimeout(700);
await page
  .locator(".subject-row .row-name")
  .filter({ hasText: /^Physics$/ })
  .click();
await page.waitForTimeout(1800);
await page
  .locator(".note-row")
  .filter({ hasText: "Conservation of momentum" })
  .click();
await page.waitForTimeout(1200);
await page.getByRole("button", { name: "Close note", exact: true }).click();
await page.waitForTimeout(600);
await page.locator(".review-entry").click();
await page.waitForTimeout(600);
await page.getByRole("button", { name: /Reveal answer/ }).click();
await page.waitForTimeout(700);
await page.getByRole("button", { name: /Good 3/ }).click();
await page.waitForTimeout(800);
await page.getByRole("button", { name: /Reveal answer/ }).click();
await page.waitForTimeout(650);
await page.getByRole("button", { name: /Good 3/ }).click();
await expect(page.getByText("Reviews complete", { exact: true })).toBeVisible();
await page.waitForTimeout(1000);
await page
  .getByRole("button", { name: "Close review", exact: true })
  .first()
  .click();
await page.getByRole("button", { name: "All Neurons", exact: true }).click();
await page.waitForTimeout(1600);
const end = await page.evaluate(async () => {
  const r = window.captureRecording;
  const stop = new Promise((resolve) => (r.recorder.onstop = resolve));
  r.recorder.stop();
  await stop;
  const data = await new Blob(r.chunks).arrayBuffer();
  return {
    time: (performance.timeOrigin + performance.now()) / 1000,
    bytes: Array.from(new Uint8Array(data)),
  };
});
await cdp.send("Page.stopScreencast");
await Promise.all(writes);
await writeFile(".local/Synapse-0.3.0-audio.webm", Buffer.from(end.bytes));
const selected = frames.filter((f) => f.time >= start && f.time < end.time);
if (!selected.length) throw Error("No video frames");
const preceding = frames.filter((f) => f.time < start).at(-1) ?? selected[0];
const timeline = [
  { ...preceding, time: start },
  ...selected,
  { ...selected.at(-1), time: end.time },
];
let concat = "ffconcat version 1.0\n";
for (let i = 0; i < timeline.length - 1; i++) {
  concat += `file '${timeline[i].file.replaceAll("\\", "/")}'\nduration ${Math.max(0.001, timeline[i + 1].time - timeline[i].time)}\n`;
}
concat += `file '${timeline.at(-1).file.replaceAll("\\", "/")}'\n`;
await writeFile(".local/capture.ffconcat", concat);
await page.getByRole("button", { name: "Preferences", exact: true }).click();
await page.screenshot({ path: ".local/Synapse-0.3.0-preferences.png" });
await page
  .getByRole("button", { name: "Close preferences", exact: true })
  .click();
await page
  .locator(".note-row")
  .filter({ hasText: "Vowels and consonants" })
  .click();
await page.waitForTimeout(900);
await page.screenshot({ path: ".local/Synapse-0.3.0-phonetics.png" });
await cdp.send("DOM.enable");
await cdp.send("CSS.enable");
const doc = await cdp.send("DOM.getDocument"),
  node = await cdp.send("DOM.querySelector", {
    nodeId: doc.root.nodeId,
    selector: ".preview .markdown p:nth-of-type(2)",
  }),
  fonts = await cdp.send("CSS.getPlatformFontsForNode", {
    nodeId: node.nodeId,
  });
await writeFile(
  ".local/capture-report.json",
  JSON.stringify(
    {
      url: page.url(),
      frames: selected.length,
      duration: end.time - start,
      audioBytes: end.bytes.length,
      fonts,
      syntheticVault: qa.root,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    frames: selected.length,
    duration: end.time - start,
    audioBytes: end.bytes.length,
    fonts,
  }),
);
await browser.close();
