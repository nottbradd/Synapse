// Generate redistribution notices from the exact installed/locked dependencies.
// Run cargo metadata --locked --filter-platform x86_64-pc-windows-msvc first.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
const metadata = JSON.parse(
  fs.readFileSync(
    process.argv[2] ?? ".local/publication/cargo-windows.json",
    "utf8",
  ),
);
const graph = new Map(metadata.resolve.nodes.map((n) => [n.id, n]));
const reachable = new Set();
function walk(id) {
  if (reachable.has(id)) return;
  reachable.add(id);
  for (const dep of graph.get(id)?.deps ?? []) walk(dep.pkg);
}
walk(metadata.resolve.root);
const records = [],
  missing = [];
const supplements = JSON.parse(
  fs.readFileSync("public/licenses/dependencies/index.json", "utf8"),
);
const supplemental = (id) =>
  (supplements[id] ?? []).map((v) =>
    fs.readFileSync(path.join("public/licenses/dependencies", v.file), "utf8"),
  );
function notices(directory) {
  const result = [];
  function visit(dir, depth) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (
        entry.isFile() &&
        /^(licen[cs]e|copying|copyright|notice|unlicense)([.-]|$)/i.test(
          entry.name,
        )
      ) {
        const text = fs.readFileSync(file, "utf8");
        if (!text.includes("\0")) result.push(text.trim());
      } else if (
        entry.isDirectory() &&
        depth < 2 &&
        /^(licen[cs]es|legal|vendor)$/i.test(entry.name)
      )
        visit(file, depth + 1);
    }
  }
  visit(directory, 0);
  return result;
}
for (const [relative, pkg] of Object.entries(
  JSON.parse(fs.readFileSync("package-lock.json", "utf8")).packages,
)) {
  if (!relative || pkg.dev) continue;
  const data = JSON.parse(
    fs.readFileSync(path.join(relative, "package.json"), "utf8"),
  );
  const texts = [
    ...notices(relative),
    ...supplemental(`npm:${data.name}@${data.version}`),
  ];
  if (!texts.length) missing.push(`npm:${data.name}@${data.version}`);
  records.push({
    name: `npm:${data.name}@${data.version}`,
    license: pkg.license ?? data.license,
    source: `https://www.npmjs.com/package/${data.name}/v/${data.version}`,
    texts,
  });
}
for (const pkg of metadata.packages.filter(
  (p) => reachable.has(p.id) && p.name !== "synapse",
)) {
  const texts = [
    ...notices(path.dirname(pkg.manifest_path)),
    ...supplemental(`cargo:${pkg.name}@${pkg.version}`),
  ];
  if (!texts.length) missing.push(`cargo:${pkg.name}@${pkg.version}`);
  records.push({
    name: `cargo:${pkg.name}@${pkg.version}`,
    license: pkg.license,
    source: `https://crates.io/crates/${pkg.name}/${pkg.version}`,
    texts,
  });
}
records.push({
  name: "Geist",
  license: "OFL-1.1",
  source: "https://github.com/vercel/geist-font",
  texts: [fs.readFileSync("public/licenses/geist-OFL.txt", "utf8")],
});
records.push({
  name: "Manrope",
  license: "OFL-1.1",
  source: "https://github.com/sharanda/manrope",
  texts: [fs.readFileSync("public/licenses/manrope-OFL.txt", "utf8")],
});
records.push({
  name: "NSIS installer components",
  license: "See complete vendor COPYING below",
  source: "https://nsis.sourceforge.io/License",
  texts: [
    fs.readFileSync(
      path.join(process.env.LOCALAPPDATA, "tauri", "NSIS", "COPYING"),
      "utf8",
    ),
  ],
});
const blocks = new Map();
for (const record of records)
  record.notices = record.texts.map((text) => {
    const hash = createHash("sha256").update(text).digest("hex").slice(0, 16);
    blocks.set(hash, text);
    return hash;
  });
let output =
  "Synapse 0.6.0 — third-party notices\n\nSynapse itself is GPL-3.0-only. Dependencies retain the licenses below.\nThis inventory includes the Windows dependency closure and production npm packages; some build-time components are not part of the installed executable. No dependency source has been modified.\n\n";
for (const record of records.sort((a, b) => a.name.localeCompare(b.name)))
  output += `${record.name}\nLicense expression: ${record.license}\nSource: ${record.source}\nNotice blocks: ${record.notices.join(", ")}\n\n`;
for (const [id, text] of blocks)
  output += `\n========== NOTICE ${id} ==========\n${text}\n`;
fs.writeFileSync("THIRD_PARTY_NOTICES.txt", output);
fs.mkdirSync(".local/publication", { recursive: true });
fs.writeFileSync(
  ".local/publication/license-inventory.json",
  JSON.stringify(
    {
      components: records.map((r) => ({
        name: r.name,
        license: r.license,
        source: r.source,
        notices: r.notices,
      })),
      missing,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify(
    {
      components: records.length,
      noticeBlocks: blocks.size,
      bytes: Buffer.byteLength(output),
      missing,
    },
    null,
    2,
  ),
);
if (missing.length) process.exitCode = 1;
