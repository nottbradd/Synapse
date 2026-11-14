# Synapse

A compact, offline Windows workspace for Markdown notes, linked knowledge, and flashcard revision. Built with Tauri v2, Rust, React, TypeScript, Vite, Tailwind, CodeMirror 6, and a Canvas force graph.

Open a folder to start. Synapse never populates a personal vault with sample content. A clearly marked synthetic vault is available in `fixtures/demo-vault`; copy it to a temporary folder before experimenting.

## Develop and build

Windows prerequisites:

- Node.js 24 LTS or newer, with npm.
- Stable Rust using the `x86_64-pc-windows-msvc` toolchain.
- Visual Studio 2022 Build Tools with **Desktop development with C++**, including the Windows SDK.
- Microsoft Edge WebView2 Runtime (normally present on Windows 10/11).

See the official [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/). Tailwind uses its [Vite plugin](https://tailwindcss.com/docs/installation/using-vite).

```powershell
npm ci
npm run tauri dev

# Production desktop app and NSIS installer
npm run tauri build
```

The standalone executable is `src-tauri/target/release/synapse.exe`. The installer is written under `src-tauri/target/release/bundle/nsis/`. It is unsigned; signing is a separate distribution step. `npm run dev` serves only the frontend and cannot access a vault without Tauri.

```powershell
npm run typecheck
npm run lint
npm test
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test --manifest-path src-tauri/Cargo.toml -- --nocapture
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

The Windows CI workflow runs these checks and builds an installer. Dependencies are locked in `package-lock.json` and `src-tauri/Cargo.lock`.

## Workspace

The glass sidebar shows **Neurons → subjects → folders and notes**. Select All Neurons, one Neuron, or one subject to scope the graph and revision queue. Neurons and subject instances have persistent UUIDs; two subjects named Physics can have independent notes and progress. Create custom subjects or use VCE presets. Row menus provide rename, assignment to another Neuron, and export. Renaming and assignment change metadata and deliberately keep note paths stable; physical folder relocation is not implemented.

Click a graph node or sidebar note to open the resizable editor. Switch between Edit, Split, and Read; split becomes vertical in narrow editors. Save explicitly with **Ctrl+S**. Note navigation, location/vault switching, and window closing protect unsaved edits. Search dims nonmatching nodes. Drag nodes to pin them, pan, zoom, fit, or reset the camera. Canvas labels use measured screen-space bounds, prioritize interaction and search, avoid nodes/other labels/floating controls, and truncate long titles. Camera and positions survive ordinary index updates during the session; they are not persisted across restarts. The charcoal interface uses a few frosted surfaces, opaque reading areas, reduced-motion handling, and an opaque fallback when backdrop blur is unavailable.

Only Markdown files are study data. Rust recursively indexes them in the background. `.git`, `node_modules`, `target`, `dist`, `build`, `.synapse`, `.obsidian`, and `.trash` are ignored. Notes are identified by normalized vault-relative paths, including their `.md` extension, rather than titles. Existing notes are never reorganized automatically.

On first open, legacy notes are adopted into a default Neuron without moving or rewriting them. Recognized YAML frontmatter takes precedence over top-level preset folders; other top-level folders become custom subjects, and root/unassigned notes remain in General. Saved migration membership is stable. Managed subject roots take precedence over frontmatter classification, so duplicate preset subjects cannot steal one another's notes. Preset aliases are case insensitive; spaces and underscores normalize to hyphens. See [migration and package details](MIGRATION.md).

| Subject                | Aliases                                   | Graph color |
| ---------------------- | ----------------------------------------- | ----------- |
| Specialist Mathematics | specialist, specialist-mathematics, spesh | `#a855f7`   |
| Mathematical Methods   | methods, mathematical-methods             | `#3b82f6`   |
| Physics                | physics                                   | `#10b981`   |
| English Language       | english-language, englang                 | `#f59e0b`   |
| General / Unassigned   | general, unassigned                       | `#64748b`   |

```markdown
---
title: Electromagnetic induction
subject: physics
---

Inline mathematics: $\Phi_B=BA\cos\theta$.

$$
\mathcal E=-N\frac{d\Phi_B}{dt}
$$
```

Frontmatter is parsed as YAML, never with regex. Ordinary saves preserve the exact editor buffer, including frontmatter. Invalid frontmatter produces a warning while keeping the note accessible for repair.

## WikiLinks

Supported forms: `[[Note]]`, `[[Folder/Note]]`, `[[Note|Display label]]`, and `[[Note#Heading]]`. Headings are accepted for target resolution; navigation opens the note rather than scrolling to a heading. `[[#Heading]]` refers to the current note. Matching is case insensitive. Explicit paths with a folder resolve against the vault root. Short names match filenames or frontmatter titles only when unambiguous, including duplicates at the vault root. Code blocks, inline code, HTML blocks, and YAML are excluded from extraction. Graph edges are unique undirected note pairs; self-links do not increase node size.

Unresolved links open an explicit create action. Ambiguous links present candidate paths. Typing `[[` in the editor opens a searchable completion menu. Arrow keys navigate, Enter selects, and Escape dismisses. Completion inserts a vault-relative filename path, avoiding ambiguity for notes in folders. Explicit root links such as `[[./Note]]` identify a root note even when its filename is duplicated in another folder. Autocomplete inserts this form for root notes.

## Flashcards

```markdown
Q: What is Lenz's law?
A: The induced current opposes the change in magnetic flux that produces it.
This is another line of the same answer.

Term :: Definition
```

- A question starts with `Q: ` and the immediately following line starts with `A: ` (leading whitespace is allowed). The answer continues until a blank line, a new `Q: `, an ATX heading, or end of note.
- A single-line card uses exactly one **space-colon-colon-space** delimiter. Both sides must be nonempty. Table, heading, and HTML lines do not become single-line cards. Math regions do not provide delimiters.
- YAML, fenced/indented code, inline code, and HTML are excluded. Use code formatting when writing examples of flashcard syntax.
- Both sides render safe Markdown and bundled KaTeX. Raw HTML and remote images are not executed or fetched. External URLs are shown as text with a tooltip; opening external sites and rendering local attachments are outside this version's scope.

Card IDs combine a persistent **subject-instance UUID** and the SHA-256 hash of whitespace-normalized question/answer text separated by a NUL byte. Identical cards share a schedule only within the same subject. Renaming or assigning the subject preserves progress. Formatting and answer changes normally create a new card; whitespace changes do not. Packages carry canonical identity mappings so remapping internal links does not reset an included schedule. Deleted cards disappear from revision, but history is retained; there is no automatic pruning. Legacy global history is copied to each relevant migrated subject/card, preserving every scheduling field.

## Scheduling and local storage

Revision shows due and new cards by subject. Reveal with Space, then rate with **1 Again**, **2 Hard**, **3 Good**, or **4 Easy**. Shortcuts ignore text inputs. Again cards are due in 60 seconds and can reappear in the same open session. Future cards stay out of the queue. Progress is persisted after each rating.

The deterministic SM-2-inspired scheduler starts at ease 2.5:

| Rating | Next interval                                     | Ease change                        |
| ------ | ------------------------------------------------- | ---------------------------------- |
| Again  | 60 seconds                                        | −0.20, minimum 1.3; lapse count +1 |
| Hard   | max(0.5 days, previous × 1.2)                     | −0.15, minimum 1.3                 |
| Good   | 1 day when previous <1, otherwise previous × ease | none                               |
| Easy   | max(4 days, previous × new ease × 1.3)            | +0.15, maximum 3.5                 |

Intervals are capped at 3650 days. Due dates use UTC Unix seconds and the computer clock. Each rating increments the review count. This is a small transparent scheduler, not a claim of equivalence with Anki or FSRS.

`flashcards.json` lives at the vault root and now uses schema version 2. It stores scoped schedules and retains original global records in `legacy_cards`. The v1 file is backed up byte-for-byte to `.synapse/flashcards-v1-backup.json` before conversion. `.synapse/organization.json` uses schema version 1 and stores stable Neuron/subject records, legacy memberships, imported link/card mappings, and the last selected location. Missing history starts fresh. Malformed, unknown-field, or unsupported metadata is preserved and reported, never silently replaced. The selected vault path is saved in `%APPDATA%\com.synapse.study\last-vault.json`. Tauri/WebView2 also maintains runtime data in the app data directory. No accounts, analytics, backend service, or CDN is used. KaTeX fonts ship with the app.

## Subject transfer

**Import subject** accepts an ordinary Markdown folder or a `.synapse-subject` ZIP package. Choose a destination Neuron (or create one in the flow), review the note/attachment counts and unresolved external references, and confirm the import name. A conflicting name defaults to a separate numbered copy. Every import gets a new subject UUID; existing files and subjects are not overwritten or merged. Packages can include review history only by explicit export opt-in, and importing that history requires a second explicit opt-in. Both default to off.

Use a subject's menu to **Export subject**. Only its Markdown notes and referenced supported local media/PDF files are included. Internal WikiLink targets are mapped to the new root while preserving heading fragments and aliases. External WikiLinks retain their text and are marked unresolved in the copy, even if the destination has a similarly named note. Local attachments are preserved, but rendering them remains outside this version's scope. Native dialogs choose sources/destinations; all content operations run in Rust.

Imports validate paths, case collisions, file types, hashes, schema, sizes and identity maps before publication. Limits are 10,000 content files, 32 MiB per file and 256 MiB total. Symlinks, junctions, traversal, absolute/drive paths, alternate streams, duplicate/conflicting entries and unsupported manifests are rejected. Publication stages a complete directory and uses a durable journal; recovery completes before the next snapshot. Cancellation applies before publication, and the final publication phase is non-cancellable. Detailed format, recovery and supported-reference boundaries are in [MIGRATION.md](MIGRATION.md).

Writes use a synced temporary file in the destination directory followed by atomic persistence, with no-clobber semantics for new notes. Revision hashes detect external changes before replacement. The UI offers disk-versus-editor conflict resolution, and a failed save leaves the editor intact. As with other optimistic file editors, an unrelated writer can still race the final filesystem replacement; this is not a cross-application locking protocol. Use a backup for valuable notes. Symlink escapes, junction escapes, traversal, alternate data streams, and reserved Windows names are rejected. Watcher events are coalesced, and unchanged snapshots (including the app's own saves) are suppressed. Old watchers stop on vault changes.

## Source layout

```text
src/
  App.tsx                 Workspace layout and dialogs
  components/             Sidebar, editor panel, graph, Markdown, revision
  hooks/                  Vault lifecycle, edit protection, modal focus
  types.ts, wiki.ts        Typed IPC contracts and preview navigation
  styles.css              Charcoal/glass tokens and responsive interaction states
  graphLabels.ts          Measured, collision-aware screen-space labels
src-tauri/src/
  commands.rs             Async IPC and active-vault state
  vault.rs, watcher.rs     Containment, atomic writes, scanning, change events
  notes.rs, subjects.rs    Markdown/YAML and metadata
  links.rs                Deterministic resolution and graph edges
  flashcards.rs           Parsing, identities, metadata, scheduler
  organization.rs         Stable IDs, legacy adoption, location and subject ownership
  packages.rs             Portable archives, references and staged import plans
  transactions.rs         Journaled publication and interrupted-import recovery
  errors.rs, tests.rs      Typed errors and regression coverage
fixtures/demo-vault/       Synthetic study notes only
.github/workflows/         Windows checks and desktop packaging
```

See [VALIDATION.md](VALIDATION.md) for the checks actually run and outstanding limitations.

The desktop integration scripts attach to a real WebView2 process and create disposable vaults. Screenshots and reports stay under ignored `.local/`; `SYNAPSE_QA_BASE` optionally places vault fixtures elsewhere. Use a temporary directory when the checkout inherits restrictive Windows folder permissions. To reproduce the packaged checks, launch the production executable with a local debugging endpoint:

```powershell
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9222'
$env:SYNAPSE_QA_BASE=Join-Path $env:TEMP 'synapse-desktop-qa'
Start-Process .\src-tauri\target\release\synapse.exe
node scripts/update-desktop.mjs
node scripts/release-verify.mjs
```

Run the two commands in order: the first creates a fresh fixture, and the second extends that fixture. The update harness covers hierarchy creation, location scoping, editing/conflicts, independent review queues and responsive screenshots. The release harness checks offline operation, missing-note creation, stable graph rendering, focus restoration, empty states and emulated display densities. `transfer-desktop.mjs` runs against the development desktop: it substitutes the native picker module's responses only, and exercises the real Rust export/import/validation/persistence commands. Native picker rendering is inspected separately. The older `desktop-smoke`, `desktop-extended` and `desktop-offline` scripts document the v0.1 baseline and use selectors from that interface. Close test instances and remove `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` before a normal launch. The CI workflow runs unit/static checks and builds the installer; desktop integration runs locally.
