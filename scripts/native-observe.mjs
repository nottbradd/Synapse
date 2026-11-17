// Read-only native inspection and explicitly armed passive event collection.
import { chromium } from "@playwright/test";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { startProbe, stopProbe } from "./native-probe.mjs";
const command = process.argv[2] ?? "state",
  name = process.argv[3] ?? command;
const source = JSON.parse(await readFile("package.json", "utf8"));
const base = path.resolve(
  process.env.SYNAPSE_NATIVE_EVIDENCE ??
    `.local/native-acceptance-${source.version}`,
);
await mkdir(base, { recursive: true });
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222", {
  noDefaults: true,
});
const page = browser.contexts()[0].pages()[0];
const state = async () => {
  const result = await page.evaluate(async () => {
    const editor = document.querySelector(".cm-content")?.cmTile?.root?.view;
    const graph = document.querySelector(".force-graph-container canvas");
    const selection = window.getSelection();
    return {
      version: await window.__TAURI_INTERNALS__.invoke("plugin:app|version"),
      nativeFocus: await window.__TAURI_INTERNALS__.invoke(
        "plugin:window|is_focused",
        { label: "main" },
      ),
      visible: await window.__TAURI_INTERNALS__.invoke(
        "plugin:window|is_visible",
        { label: "main" },
      ),
      focused: document.hasFocus(),
      hidden: document.hidden,
      width: innerWidth,
      height: innerHeight,
      dpr: devicePixelRatio,
      heading: document.querySelector(".graph-heading h1")?.textContent,
      zoom: document.querySelector(".graph-controls")?.textContent,
      drawer: (() => {
        const e = document.querySelector(".editor-shell");
        if (!e) return null;
        const r = e.getBoundingClientRect();
        return {
          x: r.x,
          y: r.y,
          width: r.width,
          height: r.height,
          inert: e.inert,
          transform: getComputedStyle(e).transform,
        };
      })(),
      editor: editor
        ? {
            text: editor.state.doc.toString(),
            selection: editor.state.selection.toJSON(),
            scrollTop: editor.scrollDOM.scrollTop,
            scrollLeft: editor.scrollDOM.scrollLeft,
            focused: editor.hasFocus,
          }
        : null,
      mode: document.querySelector(".editor-toolbar [aria-pressed=true]")
        ?.textContent,
      selectionText: selection?.toString(),
      preferences: localStorage.getItem("synapse.preferences.v1"),
      effectiveMotion: document
        .querySelector("main.app")
        ?.getAttribute("data-motion"),
      gate:
        document
          .querySelector("[data-swarm-gate]")
          ?.getAttribute("data-swarm-gate") ?? null,
      hiddenCount: document.querySelectorAll(
        '[data-swarm-hidden="true"],[data-swarm-surface-hidden="true"]',
      ).length,
      overlays: document.querySelectorAll(".swarm-overlay").length,
      marks: performance
        .getEntriesByType("mark")
        .filter((e) => e.name.startsWith("synapse."))
        .map((e) => ({ name: e.name, at: e.startTime, detail: e.detail })),
      measures: performance
        .getEntriesByType("measure")
        .filter((e) => e.name.startsWith("synapse."))
        .map((e) => e.toJSON()),
      canvas: graph?.toDataURL(),
    };
  });
  const { canvas, ...rest } = result;
  return {
    ...rest,
    canvasHash: canvas
      ? createHash("sha256").update(canvas).digest("hex")
      : null,
  };
};
if (command === "start") {
  await startProbe(page);
  await writeFile(
    path.join(base, `${name}-before.json`),
    JSON.stringify(await state(), null, 2),
  );
  console.log(`Passive observation armed: ${name}`);
} else if (command === "stop") {
  const probe = await stopProbe(page),
    after = await state();
  await writeFile(
    path.join(base, `${name}-after.json`),
    JSON.stringify(after, null, 2),
  );
  await writeFile(
    path.join(base, `${name}-trace.json`),
    JSON.stringify(probe, null, 2),
  );
  const before = JSON.parse(
    await readFile(path.join(base, `${name}-before.json`), "utf8"),
  );
  console.log(
    JSON.stringify(
      {
        name,
        version: after.version,
        addedMeasures: after.measures.slice(before.measures.length),
        native: probe.native,
        events: probe.events.map((e) => ({
          kind: e.kind,
          key: e.key,
          at: e.at,
          focused: e.focused,
        })),
        gate: after.gate,
        hidden: after.hiddenCount,
        overlays: after.overlays,
        canvasUnchanged: after.canvasHash === before.canvasHash,
        editorPreserved:
          JSON.stringify(after.editor) === JSON.stringify(before.editor),
        heading: after.heading,
      },
      null,
      2,
    ),
  );
} else if (command === "record") {
  await mkdir(path.join(base, name), { recursive: true });
  const before = await state();
  await startProbe(page);
  const cdp = await browser.contexts()[0].newCDPSession(page),
    frames = [],
    writes = [];
  cdp.on("Page.screencastFrame", (e) => {
    void cdp.send("Page.screencastFrameAck", { sessionId: e.sessionId });
    const file = path.join(
      base,
      name,
      `${String(frames.length).padStart(5, "0")}.jpg`,
    );
    frames.push({ file, time: e.metadata.timestamp });
    writes.push(writeFile(file, Buffer.from(e.data, "base64")));
  });
  await cdp.send("Page.startScreencast", {
    format: "jpeg",
    quality: 95,
    maxWidth: 1920,
    maxHeight: 1200,
    everyNthFrame: 1,
  });
  console.log(`Native return recording armed: ${name}`);
  const count = before.measures.filter(
    (e) => e.name === "synapse.return",
  ).length;
  await page.waitForFunction(
    (count) => performance.getEntriesByName("synapse.return").length > count,
    count,
    { timeout: 600000 },
  );
  await page.waitForTimeout(900);
  await cdp.send("Page.stopScreencast");
  await Promise.all(writes);
  const probe = await stopProbe(page),
    after = await state();
  await writeFile(
    path.join(base, name, "report.json"),
    JSON.stringify(
      {
        native: true,
        version: after.version,
        before,
        after,
        captureFrames: frames,
        ...probe,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify(
      {
        name,
        duration: after.measures.at(-1)?.duration,
        finish: after.marks.at(-1)?.name,
        native: probe.native,
        frames: frames.length,
        canvasUnchanged: before.canvasHash === after.canvasHash,
        editorPreserved:
          JSON.stringify(before.editor) === JSON.stringify(after.editor),
      },
      null,
      2,
    ),
  );
} else {
  const result = await state();
  await writeFile(
    path.join(base, `${name}.json`),
    JSON.stringify(result, null, 2),
  );
  console.log(
    JSON.stringify(
      {
        ...result,
        editor: result.editor
          ? {
              ...result.editor,
              text: `${result.editor.text.length} characters`,
            }
          : null,
      },
      null,
      2,
    ),
  );
}
await browser.close();
