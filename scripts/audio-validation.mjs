// Real Chromium OfflineAudioContext, production event levels and complete bus.
// --baseline records the previous mix without applying the new audibility floors.
// Synthetic reference renders; the native app audition is recorded separately.
import { chromium } from "@playwright/test";
import { createServer } from "vite";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const baseline = process.argv.includes("--baseline");
const out = `.local/sound-0.7.0/${baseline ? "before" : "after"}`;
await mkdir(out, { recursive: true });
const server = await createServer({
  server: { host: "127.0.0.1", port: 1430, strictPort: true },
});
await server.listen();
const browser = await chromium.launch({ channel: "msedge", headless: true });
function wav(channels, rate = 48000) {
  const n = channels[0].length,
    b = Buffer.alloc(44 + n * channels.length * 2);
  b.write("RIFF");
  b.writeUInt32LE(b.length - 8, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(channels.length, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * channels.length * 2, 28);
  b.writeUInt16LE(channels.length * 2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(b.length - 44, 40);
  for (let i = 0; i < n; i++)
    for (let c = 0; c < channels.length; c++)
      b.writeInt16LE(
        Math.round(Math.max(-1, Math.min(1, channels[c][i])) * 32767),
        44 + (i * channels.length + c) * 2,
      );
  return b;
}
try {
  const page = await browser.newPage();
  await page.route("**/audio-check", (r) =>
    r.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Production audio validation</title>",
    }),
  );
  await page.goto("http://127.0.0.1:1430/audio-check");
  const report = await page.evaluate(async () => {
    const { NoteSynth } = await import("/src/interaction/audio.ts");
    const { nodeVoice } = await import("/src/interaction/note.ts");
    const { actionLevel, ARRIVAL_LEVEL } =
      await import("/src/interaction/soundLevels.ts");
    const roles = ["subnetwork", "topic", "concept"];
    const peakOf = (a) => a.reduce((p, x) => Math.max(p, Math.abs(x)), 0);
    const db = (x) => (x > 0 ? 20 * Math.log10(x) : null);
    // FFT of the entire decaying cue, zero padded. Report percent energy.
    function spectrum(samples) {
      const n = 32768,
        re = new Float64Array(n),
        im = new Float64Array(n);
      re.set(samples.slice(0, n));
      for (let i = 1, j = 0; i < n; i++) {
        let bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) [re[i], re[j]] = [re[j], re[i]];
      }
      for (let len = 2; len <= n; len <<= 1) {
        const angle = (-2 * Math.PI) / len,
          wr = Math.cos(angle),
          wi = Math.sin(angle);
        for (let i = 0; i < n; i += len) {
          let ar = 1,
            ai = 0;
          for (let j = 0; j < len / 2; j++) {
            const k = i + j,
              l = k + len / 2,
              tr = re[l] * ar - im[l] * ai,
              ti = re[l] * ai + im[l] * ar;
            re[l] = re[k] - tr;
            im[l] = im[k] - ti;
            re[k] += tr;
            im[k] += ti;
            [ar, ai] = [ar * wr - ai * wi, ar * wi + ai * wr];
          }
        }
      }
      const bands = [0, 0, 0, 0];
      for (let i = 1; i < n / 2; i++) {
        const hz = (i * 48000) / n,
          band = hz < 500 ? 0 : hz < 2000 ? 1 : hz < 6000 ? 2 : 3;
        bands[band] += re[i] ** 2 + im[i] ** 2;
      }
      const sum = bands.reduce((a, b) => a + b, 0);
      return bands.map((x) => (sum ? x / sum : 0));
    }
    function metrics(channels, spectral) {
      const a = channels[0],
        peak = Math.max(...channels.map(peakOf));
      let first = a.findIndex((x) => Math.abs(x) > 1e-6),
        last = a.length - 1;
      while (last >= 0 && Math.abs(a[last]) <= 1e-6) last--;
      first = Math.max(0, first);
      let energy = 0;
      for (let i = first; i <= last; i++) energy += a[i] ** 2;
      const activeRms =
        last >= first ? Math.sqrt(energy / (last - first + 1)) : 0;
      const blocks = Array.from(
        { length: Math.floor(a.length / 240) },
        (_, i) => peakOf(a.slice(i * 240, (i + 1) * 240)),
      );
      const maximum = Math.max(...blocks),
        peakBlock = blocks.indexOf(maximum);
      const decayBlock = blocks.findIndex(
        (x, i) => i > peakBlock && x <= maximum / 10,
      );
      return {
        peak,
        peakDbfs: db(peak),
        activeRms,
        activeRmsDbfs: db(activeRms),
        activeMs: Math.max(0, last - first + 1) / 48,
        decay20DbMs:
          maximum && decayBlock >= 0 ? (decayBlock - peakBlock) * 5 : null,
        spectralEnergy: spectral ? spectrum(a) : undefined,
        bodyPeakAfterContact: peakOf(a.slice(48 * 40, 48 * 75)),
        finite: channels.every((a) => a.every(Number.isFinite)),
        tail: Math.max(...channels.map((a) => peakOf(a.slice(-4800)))),
      };
    }
    const cases = [],
      clips = {};
    for (const volume of [0.35, 0.7, 0.69, 1, 0])
      for (const role of roles) {
        for (const name of [
          "select",
          "arrival",
          "neighbours",
          "dense",
          "cancelled",
          "mid-cancel",
          "muted",
          "stale",
          "disposed",
          "gated",
        ]) {
          const context = new OfflineAudioContext(2, 38400, 48000);
          const connected = new Set();
          let noiseBuffers = 0;
          const createBuffer = context.createBuffer.bind(context);
          context.createBuffer = (...args) => {
            noiseBuffers++;
            return createBuffer(...args);
          };
          for (const method of [
            "createGain",
            "createBiquadFilter",
            "createStereoPanner",
            "createOscillator",
            "createBufferSource",
            "createDynamicsCompressor",
            "createWaveShaper",
          ]) {
            const create = context[method].bind(context);
            context[method] = (...args) => {
              const node = create(...args),
                connect = node.connect.bind(node),
                disconnect = node.disconnect.bind(node);
              node.connect = (...destinations) => {
                connected.add(node);
                return connect(...destinations);
              };
              node.disconnect = (...destinations) => {
                connected.delete(node);
                return disconnect(...destinations);
              };
              return node;
            };
          }
          const synth = new NoteSynth(context, volume);
          const arrival = name === "arrival" || name === "neighbours";
          if (name === "disposed") synth.dispose();
          let accepted = 0;
          const count =
            name === "dense"
              ? 30
              : name === "neighbours"
                ? 3
                : name === "gated"
                  ? 2
                  : 1;
          for (let i = 0; i < count; i++)
            if (
              synth.play({
                id: `v${i}`,
                at:
                  name === "stale"
                    ? -1
                    : name === "gated"
                      ? 0.02 + i * 0.01
                      : 0.02,
                kind: arrival ? "arrival" : "select",
                level: arrival ? ARRIVAL_LEVEL : actionLevel("select"),
                node:
                  name === "gated"
                    ? "preferences-preview"
                    : i
                      ? `neighbour-${i}`
                      : "preferences-preview",
                role,
                pan: 0,
              })
            )
              accepted++;
          if (name === "cancelled") synth.cancel();
          if (name === "muted") synth.mute(true, volume);
          const maximumVoices = synth.activeVoices;
          let afterCancel;
          if (name === "mid-cancel")
            context.suspend(0.06).then(() => {
              synth.cancel();
              afterCancel = synth.activeVoices;
              void context.resume();
            });
          const buffer = await context.startRendering(),
            channels = [buffer.getChannelData(0), buffer.getChannelData(1)];
          const result = {
            name,
            role,
            volume,
            ...metrics(channels, name === "select" || name === "arrival"),
            accepted,
            maximumVoices,
            afterCancel,
            remaining: synth.activeVoices,
            reservations: synth.budget.voices.size,
            connectedAfterVoices: connected.size,
            noiseBuffers,
          };
          cases.push(result);
          if (volume === 0.7 && (name === "select" || name === "arrival"))
            clips[`${role}-${name}`] = channels.map((a) => Array.from(a));
          synth.dispose();
          result.connectedAfterDispose = connected.size;
        }
      }
    // Audition only. Production oscillators remain at a static pitch.
    const matched = [];
    for (const role of roles) {
      const context = new OfflineAudioContext(2, 38400, 48000),
        create = context.createOscillator.bind(context);
      context.createOscillator = () => {
        const osc = create(),
          start = osc.start.bind(osc);
        osc.start = (at) => {
          const pitch = osc.detune.value;
          osc.detune.setValueAtTime(pitch - 25, at);
          osc.detune.linearRampToValueAtTime(pitch, at + 0.012);
          start(at);
        };
        return osc;
      };
      const synth = new NoteSynth(context, 0.7);
      synth.play({
        id: "candidate",
        at: 0.02,
        kind: "select",
        level: actionLevel("select"),
        role,
        node: "preferences-preview",
      });
      const buffer = await context.startRendering(),
        a = [buffer.getChannelData(0), buffer.getChannelData(1)];
      const before = metrics(a, true),
        reference = cases.find(
          (c) => c.volume === 0.7 && c.role === role && c.name === "select",
        );
      const gain = reference.activeRms / before.activeRms;
      const adjusted = a.map((c) => c.map((x) => x * gain));
      clips[`${role}-glide-matched`] = adjusted.map((a) => Array.from(a));
      matched.push({
        role,
        gain,
        static: reference.activeRmsDbfs,
        candidate: metrics(adjusted, true),
      });
      synth.dispose();
    }
    return {
      fixture: {
        node: "preferences-preview",
        select: actionLevel("select"),
        arrival: ARRIVAL_LEVEL,
        pan: 0,
        sampleRate: 48000,
        spectralBandsHz: ["0–500", "500–2000", "2000–6000", "6000–24000"],
      },
      palette: roles.map((role) =>
        nodeVoice({ role, node: "preferences-preview" }),
      ),
      cases,
      matched,
      clips,
    };
  });
  const { clips, ...measurements } = report;
  await writeFile(
    `${out}/mix-report.json`,
    JSON.stringify(measurements, null, 2),
  );
  for (const [name, channels] of Object.entries(clips))
    await writeFile(`${out}/${name}.wav`, wav(channels));
  for (const c of report.cases) {
    assert.ok(
      c.finite && c.peak <= 0.241 && c.maximumVoices <= 6,
      JSON.stringify(c),
    );
    assert.equal(c.remaining, 0);
    assert.equal(c.reservations, 0);
    assert.equal(
      c.connectedAfterDispose,
      0,
      "Every tone/contact/output node disconnects",
    );
    assert.ok(
      c.connectedAfterVoices <= 3,
      "Only the three output bus nodes remain after a cue",
    );
    if (!baseline && c.accepted)
      assert.equal(c.noiseBuffers, 1, "One cached contact buffer per context");
    assert.ok(c.tail < 1e-8);
    if (
      ["cancelled", "muted", "stale", "disposed"].includes(c.name) ||
      !c.volume
    )
      assert.equal(c.peak, 0);
    if (c.name === "dense") assert.equal(c.accepted, 6);
    if (c.name === "neighbours") assert.equal(c.accepted, 3);
    if (c.name === "gated") assert.equal(c.accepted, 1);
    if (c.name === "mid-cancel") assert.equal(c.afterCancel, 0);
    if (!baseline && c.volume === 0.7) {
      if (c.name === "select")
        assert.ok(c.peak >= 0.1, `Select floor −20 dBFS: ${JSON.stringify(c)}`);
      if (c.name === "arrival")
        assert.ok(
          c.peak >= 0.01,
          `Arrival floor −40 dBFS: ${JSON.stringify(c)}`,
        );
    }
    if (!baseline && c.volume && c.name === "select")
      assert.ok(
        c.bodyPeakAfterContact > c.peak * 0.05,
        "Contact ending must leave the tone alive",
      );
  }
  if (!baseline)
    for (const volume of [0.7, 0.69, 1])
      for (const role of ["subnetwork", "topic", "concept"]) {
        const cue = (name) =>
          report.cases.find(
            (c) => c.name === name && c.role === role && c.volume === volume,
          );
        assert.ok(
          cue("arrival").peak < cue("select").peak * 0.7,
          `Individual arrival must remain subordinate: ${role}`,
        );
        assert.ok(
          cue("neighbours").peak < cue("select").peak * 1.2,
          `Three arrivals must not dominate selection: ${role}`,
        );
      }
  console.log(
    JSON.stringify(
      {
        success: true,
        baseline,
        cases: report.cases.length,
        out,
        reference: report.cases
          .filter(
            (c) => c.volume === 0.7 && ["select", "arrival"].includes(c.name),
          )
          .map(
            ({
              name,
              role,
              peakDbfs,
              activeRmsDbfs,
              decay20DbMs,
              spectralEnergy,
            }) => ({
              name,
              role,
              peakDbfs,
              activeRmsDbfs,
              decay20DbMs,
              spectralEnergy,
            }),
          ),
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
  await server.close();
}
