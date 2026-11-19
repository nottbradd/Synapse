import { readFile, writeFile } from "node:fs/promises";
const root = ".local/sound-0.7.0";
async function join(name, paths) {
  const waves = await Promise.all(
    paths.map((p) => readFile(`${root}/${p}.wav`)),
  );
  const data = Buffer.concat(waves.map((b) => b.subarray(44)));
  const header = Buffer.from(waves[0].subarray(0, 44));
  header.writeUInt32LE(data.length + 36, 4);
  header.writeUInt32LE(data.length, 40);
  await writeFile(`${root}/${name}.wav`, Buffer.concat([header, data]));
}
const roles = ["subnetwork", "topic", "concept"];
await join(
  "static-then-glide",
  roles.flatMap((role) => [
    `after/${role}-select`,
    `after/${role}-glide-matched`,
  ]),
);
await join(
  "before-then-after",
  roles.flatMap((role) => [
    `before/${role}-select`,
    `after/${role}-select`,
    `before/${role}-arrival`,
    `after/${role}-arrival`,
  ]),
);
console.log(
  "Wrote matched static/glide pairs and same-volume before/after cues.",
);
