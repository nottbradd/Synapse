// Render the production voice graph in real Chromium Web Audio. No audio mocks.
// These numerical renders are separate from the installed-app audition.
import { chromium } from "@playwright/test";
import { createServer } from "vite";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const out = ".local/sound-0.6.0";
await mkdir(out, { recursive: true });
const server = await createServer({
  server: { host: "127.0.0.1", port: 1430 },
});
await server.listen();
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage();
  await page.route("**/audio-check", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Synapse production audio validation</title>",
    }),
  );
  await page.goto("http://127.0.0.1:1430/audio-check");
  const report = await page.evaluate(async () => {
    const { NoteSynth } = await import("/src/interaction/audio.ts");
    const { nodeVoice } = await import("/src/interaction/note.ts");
    const peakOf = (samples) =>
      samples.reduce((peak, x) => Math.max(peak, Math.abs(x)), 0);
    const cases = [];
    for (const volume of [0.69, 1]) {
      for (const role of ["subnetwork", "topic", "concept"]) {
        for (const name of [
          "single",
          "neighbours",
          "dense",
          "cancelled",
          "muted",
          "zero",
          "stale",
          "disposed",
          "gated",
        ]) {
          const context = new OfflineAudioContext(2, 38400, 48000);
          const synth = new NoteSynth(context, name === "zero" ? 0 : volume);
          const contact = {
            id: "v0",
            at: 0.02,
            kind: "select",
            level: 0.8,
            subject: "s0",
            role,
          };
          let accepted = 0;
          const count = ["dense", "neighbours"].includes(name)
            ? 30
            : name === "gated"
              ? 2
              : 1;
          if (name === "disposed") synth.dispose();
          for (let i = 0; i < count; i++) {
            if (
              synth.play({
                ...contact,
                id: `v${i}`,
                at:
                  name === "stale"
                    ? -1
                    : name === "gated"
                      ? 0.02 + i * 0.01
                      : 0.02,
                subject: name === "gated" ? "same" : `s${i}`,
                kind: name === "neighbours" ? "arrival" : "select",
                level: name === "neighbours" ? 0.22 : 1,
              })
            )
              accepted++;
          }
          if (name === "cancelled") synth.cancel();
          if (name === "muted") synth.mute(true, volume);
          const maximumVoices = synth.activeVoices;
          const buffer = await context.startRendering();
          const channels = [buffer.getChannelData(0), buffer.getChannelData(1)];
          const peak = Math.max(...channels.map(peakOf));
          const rms = Math.sqrt(
            channels[0].reduce((sum, x) => sum + x * x, 0) / buffer.length,
          );
          const result = {
            name,
            role,
            volume,
            peak,
            rms,
            accepted,
            maximumVoices,
            remaining: synth.activeVoices,
            reservations: synth.budget.voices.size,
            finite: channels.every((a) => a.every(Number.isFinite)),
            tail: Math.max(...channels.map((a) => peakOf(a.slice(-4800)))),
          };
          synth.dispose();
          cases.push(result);
        }
      }
    }
    return {
      palette: ["subnetwork", "topic", "concept"].map((role) =>
        nodeVoice({ role }),
      ),
      cases,
    };
  });
  for (const c of report.cases) {
    assert.ok(
      c.finite && c.peak < 0.241 && c.maximumVoices <= 6,
      JSON.stringify(c),
    );
    assert.equal(c.remaining, 0);
    assert.equal(c.reservations, 0);
    assert.ok(c.tail < 1e-8);
    if (["cancelled", "muted", "zero", "stale", "disposed"].includes(c.name))
      assert.equal(c.peak, 0);
    if (["dense", "neighbours"].includes(c.name)) assert.equal(c.accepted, 6);
    if (c.name === "gated") assert.equal(c.accepted, 1);
    if (c.name === "single") assert.ok(c.peak > 0.01);
  }
  for (const volume of [0.69, 1]) {
    for (const role of ["subnetwork", "topic", "concept"]) {
      const single = report.cases.find(
        (c) => c.name === "single" && c.volume === volume && c.role === role,
      );
      const neighbours = report.cases.find(
        (c) =>
          c.name === "neighbours" && c.volume === volume && c.role === role,
      );
      assert.ok(neighbours.peak < single.peak * 0.4);
    }
  }
  await writeFile(
    `${out}/mix-report.json`,
    JSON.stringify({ success: true, ...report }, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  await server.close();
}
