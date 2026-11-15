// Portable evidence gallery; original desktop screenshots are embedded unchanged.
import { readFile, writeFile } from "node:fs/promises";
const views = [
  ["overview", "Multi-subject overview"],
  ["drawer", "Note drawer and recall"],
  ["subject", "Focused subject"],
  ["review", "Review and actual intervals"],
  ["dense", "Dense vault — 90 notes"],
  ["small", "Small window — 900 × 600"],
  ["reduced-motion", "Reduced motion"],
  ["opaque-fallback", "Opaque material fallback"],
];
let sections = "";
for (const [file, title] of views) {
  let images = "";
  for (const phase of ["before", "after"]) {
    const bytes = await readFile(`.local/refinement-${phase}/${file}.png`);
    images += `<figure><figcaption>${phase === "before" ? "Before · 0.3.0" : "After · 0.3.1"}</figcaption><a href="data:image/png;base64,${bytes.toString("base64")}" download="${phase}-${file}.png"><img loading="lazy" src="data:image/png;base64,${bytes.toString("base64")}" alt="${phase}: ${title}"></a></figure>`;
  }
  sections += `<section id="${file}"><h2>${title}</h2><div class="pair">${images}</div></section>`;
}
await writeFile(
  ".local/Synapse-0.3.1-comparison.html",
  `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synapse 0.3.1 — Desktop comparison</title><style>html{color-scheme:dark;scroll-behavior:smooth}body{margin:0;background:#0b1118;color:#e9eff3;font:16px/1.55 system-ui,sans-serif}header,main{max-width:1800px;margin:auto;padding:32px}h1{font-size:30px;margin:0 0 12px}h2{font-size:22px;margin:0 0 16px}p{max-width:900px;color:#b3c0ca}nav{display:flex;gap:18px;flex-wrap:wrap;margin-top:24px}a{color:#b5d9ee}section{margin-bottom:56px;scroll-margin-top:24px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:18px}figure{margin:0;min-width:0}figcaption{margin-bottom:10px;color:#b3c0ca}img{display:block;width:100%;height:auto;border:1px solid #38434d}footer{padding:32px;color:#b3c0ca}@media(max-width:900px){.pair{grid-template-columns:1fr}header,main{padding:18px}}</style><header><h1>Synapse 0.3.1</h1><p>Actual Tauri desktop screenshots, captured on 15 November 2026. Each pair uses the same synthetic vault identities and viewport: 1600 × 1000, except the small-window comparison at 900 × 600. The overview has 32 notes across five occupied subjects. The dense view has 90 notes. Screenshots are embedded without image editing; click one to save the original.</p><nav>${views.map(([id, title]) => `<a href="#${id}">${title}</a>`).join("")}</nav></header><main>${sections}</main><footer>The current Synapse mark, real fixture counts, Manrope/Geist typography and mathematical content are retained. Reduced motion and opaque fallback are explicit test modes. These are application screenshots, not the approved mockup.</footer></html>`,
);
console.log("Created .local/Synapse-0.3.1-comparison.html");
