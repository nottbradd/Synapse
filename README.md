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

The collapsible sidebar provides search, note creation, and revision. Click a graph node or sidebar note to open the resizable editor. Switch between Edit, Split, and Read. Save explicitly with **Ctrl+S**. Note navigation, vault switching, and window closing protect unsaved edits. Subject buttons filter the graph; search dims nonmatching nodes. Drag nodes to pin their position during the current vault session, pan, zoom, fit, or reset the camera. Camera and positions survive opening notes and ordinary index updates; they are not persisted across restarts.

Only Markdown files are study data. Rust recursively indexes them in the background. `.git`, `node_modules`, `target`, `dist`, `build`, `.synapse`, `.obsidian`, and `.trash` are ignored. Notes are identified by normalized vault-relative paths, including their `.md` extension, rather than titles. Existing notes are never reorganized automatically.

Subjects are inferred from recognized YAML frontmatter first, then the top-level folder, then General. Aliases are case insensitive; spaces and underscores normalize to hyphens.

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

Card IDs are SHA-256 hashes of whitespace-normalized question and answer text separated by a NUL byte. Formatting and answer changes reset the schedule; whitespace changes and moving notes preserve it. Identical cards across notes share one schedule and are shown once, with the lexicographically first source path. Deleted cards disappear from revision, but their history remains in metadata so restoring a card restores its schedule. There is no automatic history pruning.

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

`flashcards.json` lives at the vault root and stores schema version 1, card ID, last review, due timestamp, interval in days, ease, reviews, and lapses. Missing metadata starts a new history. Malformed or unsupported metadata blocks reviews without rewriting the file; repair it, or explicitly rename it outside Synapse to start fresh. The selected vault path is saved in `%APPDATA%\com.synapse.study\last-vault.json`. Tauri/WebView2 may also maintain runtime data in the application data directory. No accounts, analytics, backend service, or CDN is used. KaTeX fonts and all study assets ship with the app.

Writes use a synced temporary file in the destination directory followed by atomic persistence, with no-clobber semantics for new notes. Revision hashes detect external changes before replacement. The UI offers disk-versus-editor conflict resolution, and a failed save leaves the editor intact. As with other optimistic file editors, an unrelated writer can still race the final filesystem replacement; this is not a cross-application locking protocol. Use a backup for valuable notes. Symlink escapes, junction escapes, traversal, alternate data streams, and reserved Windows names are rejected. Watcher events are coalesced, and unchanged snapshots (including the app's own saves) are suppressed. Old watchers stop on vault changes.

## Source layout

```text
src/
  App.tsx                 Workspace layout and dialogs
  components/             Sidebar, editor panel, graph, Markdown, revision
  hooks/                  Vault lifecycle, edit protection, modal focus
  types.ts, wiki.ts        Typed IPC contracts and preview navigation
  styles.css              Minimal zinc palette and interaction states
src-tauri/src/
  commands.rs             Async IPC and active-vault state
  vault.rs, watcher.rs     Containment, atomic writes, scanning, change events
  notes.rs, subjects.rs    Markdown/YAML and metadata
  links.rs                Deterministic resolution and graph edges
  flashcards.rs           Parsing, identities, metadata, scheduler
  errors.rs, tests.rs      Typed errors and regression coverage
fixtures/demo-vault/       Synthetic study notes only
.github/workflows/         Windows checks and desktop packaging
```

See `VALIDATION.md` for the checks actually run, measured dataset, and outstanding limitations.

The desktop integration scripts attach to a real WebView2 process and create disposable vaults under ignored `.local/`. To reproduce them, launch the production executable with a local debugging endpoint:

```powershell
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9222'
Start-Process .\src-tauri\target\release\synapse.exe
node scripts/desktop-smoke.mjs
node scripts/desktop-extended.mjs
```

The extended test waits through an actual 60-second retry and opens 500 synthetic notes. To verify restart and offline persistence, run the smoke script again, close and restart the executable, then run `node scripts/desktop-offline.mjs`. Offline verification uses Chromium network emulation, including a production-page reload. Close the test instance and remove `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` before a normal launch. The CI workflow runs unit/static checks and builds the desktop installer; these interactive desktop scripts are run locally.
