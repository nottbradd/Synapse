// Capture actual WebView compositor frames and live AudioContext output with original timestamps.
// No invented motion, frame interpolation, synthetic sound track or production hooks.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
export async function recordDesktop({
  page,
  context,
  name,
  fixture,
  mocked = false,
}) {
  const invoke = (command, args = {}) =>
    page.evaluate(
      ({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args),
      { command, args },
    );
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
  await page.mouse.move(1550, 970);
  await page.waitForTimeout(1000);
  const focus = await invoke("plugin:window|is_focused", { label: "main" });
  const audioReady = await page.evaluate(
    () => window.captureAudio?.context.state === "running",
  );
  if (!focus || !audioReady)
    throw Error(`Native focus/audio not ready: ${focus}/${audioReady}`);
  const folder = path.resolve(".local", `${name}-frames-${Date.now()}`);
  await mkdir(folder, { recursive: true });
  const cdp = await context.newCDPSession(page),
    frames = [],
    writes = [],
    actions = [];
  cdp.on("Page.screencastFrame", (event) => {
    void cdp.send("Page.screencastFrameAck", { sessionId: event.sessionId });
    const file = path.join(
      folder,
      `${String(frames.length).padStart(5, "0")}.jpg`,
    );
    frames.push({ file, time: event.metadata.timestamp });
    writes.push(writeFile(file, Buffer.from(event.data, "base64")));
  });
  await cdp.send("Page.startScreencast", {
    format: "jpeg",
    quality: 85,
    maxWidth: 1600,
    maxHeight: 1000,
    everyNthFrame: 1,
  });
  const start = await page.evaluate(() => {
    const recorder = new MediaRecorder(window.captureAudio.destination.stream, {
        mimeType: "audio/webm;codecs=opus",
      }),
      chunks = [];
    recorder.ondataavailable = (e) => chunks.push(e.data);
    window.captureRecording = { recorder, chunks };
    recorder.start();
    return (performance.timeOrigin + performance.now()) / 1000;
  });
  const mark = async (name, seconds = 0.65) => {
    const at = await page.evaluate(
      () => (performance.timeOrigin + performance.now()) / 1000,
    );
    const action = { name, at, seconds };
    actions.push(action);
    return action;
  };

  return {
    mark,
    finish: async () => {
      const end = await page.evaluate(async () => {
        const r = window.captureRecording,
          stop = new Promise((resolve) => (r.recorder.onstop = resolve));
        r.recorder.stop();
        await stop;
        return {
          time: (performance.timeOrigin + performance.now()) / 1000,
          bytes: Array.from(
            new Uint8Array(await new Blob(r.chunks).arrayBuffer()),
          ),
        };
      });
      await cdp.send("Page.stopScreencast");
      await Promise.all(writes);
      await writeFile(`.local/${name}-audio.webm`, Buffer.from(end.bytes));
      const selected = frames.filter(
        (f) => f.time >= start && f.time < end.time,
      );
      if (!selected.length) throw Error("No source frames");
      const preceding =
        frames.filter((f) => f.time < start).at(-1) ?? selected.shift();
      const timeline = [
        { ...preceding, time: start },
        ...selected,
        { ...selected.at(-1), time: end.time },
      ];
      let concat = "ffconcat version 1.0\n";
      for (let i = 0; i < timeline.length; i++) {
        concat += `file '${timeline[i].file.replaceAll("\\", "/")}'\noption framerate 1000\n`;
        if (i < timeline.length - 1)
          concat += `duration ${Math.max(0.001, timeline[i + 1].time - timeline[i].time)}\n`;
      }
      await writeFile(`.local/${name}.ffconcat`, concat);
      const cadence = actions.map((a) => {
        const times = frames
          .filter((f) => f.time >= a.at && f.time < a.at + a.seconds)
          .map((f) => f.time);
        const gaps = times
          .slice(1)
          .map((t, i) => (t - times[i]) * 1000)
          .sort((a, b) => a - b);
        const percentile = (p) =>
          gaps[Math.min(gaps.length - 1, Math.floor(p * gaps.length))] ?? null;
        return {
          ...a,
          at: a.at - start,
          frames: times.length,
          framesPerSecond:
            times.length > 1
              ? (times.length - 1) / (times.at(-1) - times[0])
              : 0,
          medianGapMs: percentile(0.5),
          p95GapMs: percentile(0.95),
        };
      });
      const changedFrames = [];
      let previousHash;
      for (const frame of frames) {
        const hash = createHash("sha256")
          .update(await readFile(frame.file))
          .digest("hex");
        if (hash !== previousHash) changedFrames.push(frame);
        previousHash = hash;
      }
      for (const action of cadence) {
        const times = changedFrames
          .filter(
            (f) =>
              f.time >= start + action.at &&
              f.time < start + action.at + action.seconds,
          )
          .map((f) => f.time);
        action.changedFrames = times.length;
        action.changedFramesPerSecond =
          times.length > 1 ? (times.length - 1) / (times.at(-1) - times[0]) : 0;
      }
      const report = {
        url: page.url(),
        fixture,
        mocked,
        start,
        end: end.time,
        duration: end.time - start,
        sourceFrames: frames.length,
        consecutiveUniqueFrames: changedFrames.length,
        identicalConsecutiveFrames: frames.length - changedFrames.length,
        timestampsMonotonic: frames.every(
          (frame, i) => i === 0 || frame.time > frames[i - 1].time,
        ),
        everyNthFrame: 1,
        audioBytes: end.bytes.length,
        nativeFocused: focus,
        encoding:
          "Variable frame rate from original compositor timestamps; no interpolated motion frames",
        cadence,
      };
      await writeFile(
        `.local/${name}-report.json`,
        JSON.stringify(report, null, 2),
      );
      await writeFile(
        `.local/${name}-timestamps.json`,
        JSON.stringify(frames, null, 2),
      );
      console.log(JSON.stringify({ recording: report }));
    },
  };
}
