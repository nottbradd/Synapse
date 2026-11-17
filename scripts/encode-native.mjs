// Preserve CDP's source timestamps; the only repeated frame is the final hold.
import { readFile, writeFile, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import path from "node:path";
const source = JSON.parse(await readFile("package.json", "utf8"));
const root = path.resolve(
  process.argv[2] ??
    process.env.SYNAPSE_NATIVE_EVIDENCE ??
    `.local/native-acceptance-${source.version}`,
);
const ffmpeg = process.env.FFMPEG;
assert.ok(ffmpeg, "Set FFMPEG to the existing executable");
function run(args) {
  const r = spawnSync(ffmpeg, ["-hide_banner", ...args], {
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  assert.equal(r.status, 0, r.stderr);
  return r.stderr;
}
const reports = [];
for (const name of ["cold-final", "tray-final", "return-final"]) {
  const dir = path.join(root, name);
  const r = JSON.parse(await readFile(path.join(dir, "report.json"), "utf8"));
  const effect = name === "return-final" ? "return" : "startup";
  const measure = r.measures
    .filter((e) => e.name === `synapse.${effect}`)
    .at(-1);
  const epoch = (r.timeOrigin + measure.startTime) / 1000;
  const start = epoch - 0.08,
    end = epoch + measure.duration / 1000 + 0.75;
  const ordered = r.captureFrames
    .toSorted((a, b) => a.time - b.time)
    .filter((f, i, a) => !i || f.time !== a[i - 1].time);
  assert.ok(
    ordered[0].time < epoch,
    `${name}: capture missed first animation frame`,
  );
  const prior = ordered.filter((f) => f.time <= start).at(-1);
  const timeline = [
    ...(prior ? [{ ...prior, time: start }] : []),
    ...ordered.filter((f) => f.time > start && f.time < end),
  ];
  const concat = ["ffconcat version 1.0"];
  timeline.forEach((f, i) =>
    concat.push(
      `file '${f.file.replaceAll("\\", "/")}'`,
      "option framerate 1000",
      `duration ${Math.max(0.001, (timeline[i + 1]?.time ?? end) - f.time).toFixed(6)}`,
    ),
  );
  concat.push(
    `file '${timeline.at(-1).file.replaceAll("\\", "/")}'`,
    "option framerate 1000",
  );
  const concatPath = path.join(dir, "clip.ffconcat");
  await writeFile(concatPath, concat.join("\n") + "\n");
  const label =
    name === "cold-final"
      ? "native-cold-startup"
      : name === "tray-final"
        ? "native-tray-first-foreground"
        : "native-alt-tab-return";
  const stem = path.join(root, `Synapse-${r.version}-${label}`);
  run([
    "-loglevel",
    "error",
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    concatPath,
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "18",
    "-pix_fmt",
    "yuv420p",
    "-bf",
    "0",
    "-fps_mode",
    "vfr",
    "-enc_time_base",
    "1:1000",
    "-x264-params",
    "fps=120/1:force-cfr=0",
    "-level:v",
    "5.2",
    "-video_track_timescale",
    "1000000",
    "-movflags",
    "+faststart",
    `${stem}.mp4`,
  ]);
  run([
    "-loglevel",
    "error",
    "-y",
    "-i",
    `${stem}.mp4`,
    "-filter_complex",
    "fps=25,scale=1000:-2:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle",
    "-loop",
    "0",
    `${stem}.gif`,
  ]);
  const decoded = run([
    "-i",
    `${stem}.mp4`,
    "-vf",
    "showinfo",
    "-an",
    "-f",
    "null",
    "NUL",
  ]);
  await writeFile(path.join(dir, "decode.log"), decoded);
  const actual = [
    ...decoded.matchAll(/\bn:\s*\d+\s+pts:.*?pts_time:([-\d.]+)/g),
  ].map((m) => Number(m[1]));
  let time = 0;
  const expected = [];
  for (const line of concat) {
    if (line.startsWith("file ")) expected.push(time);
    if (line.startsWith("duration ")) time += Number(line.slice(9));
  }
  assert.equal(actual.length, expected.length);
  const maxTimingErrorMs = Math.max(
    ...actual.map((t, i) => Math.abs(t - expected[i]) * 1000),
  );
  assert.ok(maxTimingErrorMs <= 1.05);
  assert.equal([...decoded.matchAll(/Stream #0:\d.*?Audio:/g)].length, 0);
  run(["-loglevel", "error", "-i", `${stem}.gif`, "-f", "null", "NUL"]);
  const times =
    effect === "startup" ? [0.15, 1.1, 2.4, 3.7] : [0.14, 0.24, 0.7];
  for (const [i, t] of times.entries())
    run([
      "-loglevel",
      "error",
      "-y",
      "-ss",
      String(t),
      "-i",
      `${stem}.mp4`,
      "-frames:v",
      "1",
      path.join(dir, `review-${i}.png`),
    ]);
  reports.push({
    name,
    version: r.version,
    native: true,
    normalSpeed: true,
    firstCapturedRelativeToStartMs: (ordered[0].time - epoch) * 1000,
    animationMs: measure.duration,
    frames: actual.length,
    maxTimingErrorMs,
    metadataDuration: /Duration: (\d+:\d+:\d+\.\d+)/.exec(decoded)?.[1],
    mp4Bytes: (await stat(`${stem}.mp4`)).size,
    gifBytes: (await stat(`${stem}.gif`)).size,
    silent: true,
    gifFps: 25,
    stem,
  });
}
await writeFile(
  path.join(root, "preview-media-validation.json"),
  JSON.stringify(reports, null, 2),
);
console.log(JSON.stringify(reports, null, 2));
