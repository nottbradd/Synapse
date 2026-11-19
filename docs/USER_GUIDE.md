# Synapse

A local-first Windows workspace for Markdown notes, linked knowledge, flashcard revision, quizzes and reminders. Optional owner-funded Synapse AI or a personal OpenAI key creates editable study drafts. Built with Tauri v2, Rust, React, TypeScript, Vite, Tailwind, CodeMirror 6, and a Canvas force graph.

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

The matte charcoal sidebar shows **Neurons → subjects → folders and notes**. Select All Neurons, one Neuron, or one subject to scope the graph and revision queue. Neurons and subject instances have persistent UUIDs; two subjects named Physics can have independent notes and progress. Create custom subjects or use VCE presets. Row menus provide rename, assignment to another Neuron, and export. Renaming and assignment change metadata and deliberately keep note paths stable; physical folder relocation is not implemented.

Click a graph node or sidebar note to open the resizable editor. Switch between Edit, Split, and Read; split becomes vertical in narrow editors. Save explicitly with **Ctrl+S**. Note navigation, location/vault switching, and window closing protect unsaved edits. Search dims nonmatching nodes. Drag nodes to pin them, pan, zoom, fit, or reset the camera. Canvas labels use measured screen-space bounds, prioritize interaction and search, avoid nodes/other labels/floating controls, and truncate long titles. Camera and positions survive ordinary index updates during the session; they are not persisted across restarts. The near-black graph uses angular illuminated junctions, fine curved relationships and sparse labels. Panels use 24–32 px spacing where the viewport permits, with restrained smoked glass on floating controls and reduced-motion support.

Markdown notes remain ordinary files. Quizzes, attempts, reminder definitions and generated-card provenance live separately in versioned `.synapse/study.json`. Rust indexes Markdown in the background. `.git`, `node_modules`, `target`, `dist`, `build`, `.synapse`, `.obsidian`, and `.trash` are ignored. Notes are identified by normalized vault-relative paths, including their `.md` extension, rather than titles. Existing notes are never reorganized automatically.

On first open, legacy notes are adopted into a default Neuron without moving or rewriting them. Recognized YAML frontmatter takes precedence over top-level preset folders; other top-level folders become custom subjects, and root/unassigned notes remain in General. Saved migration membership is stable. Managed subject roots take precedence over frontmatter classification, so duplicate preset subjects cannot steal one another's notes. Preset aliases are case insensitive; spaces and underscores normalize to hyphens. See [migration and package details](../MIGRATION.md).

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

## Typography, motion and sound

Version 0.4.0 uses locally bundled Manrope headings and Geist navigation, labels and reading text. Extended Latin assets and system fallbacks cover phonetic characters; KaTeX keeps its specialised fonts. Font licenses are embedded under `licenses/`. Read mode suppresses a matching leading Markdown H1 without changing the note.

Subject clusters use persistent IDs and saved colours. Leaf, connected and hub junctions reflect actual connectivity, with compact emission and a pale selected frame. Empty subjects reserve no graph space. Overview labels prioritise important hubs and interaction; selected neighbourhoods reveal more context. Fit includes every note; Reset bounds large-cluster outliers while retaining small subjects. Ordinary body edits retain graph objects and framing; explicit drags pin nodes for the session.

One critically damped controller moves the drawer, camera and logarithmic zoom together. It measures the uncovered canvas, selects zoom from the neighbourhood, retains velocity when interrupted, and restores saved scope, selected note, drawer and framing through Back. Closing a note keeps its current network. Narrow currents follow actual curved relationships on selection, WikiLink navigation, saved connections and review completion. Travel time depends on projected length; sound arrivals share the same event plan. The idle graph stops rendering. Reduced motion snaps spatial changes and suppresses travelling effects.

Preferences contains persistent Animations, Sound and Volume. Animations defaults to **Follow Windows**: disabling Windows animation effects makes camera and panel changes immediate. Choose **Full** for smooth Synapse motion independently of Windows, or **Reduced** for immediate movement and no connection currents. The setting applies consistently to the camera, panels, titles and CSS transitions, and takes effect immediately.

**Startup animation** plays once on the first eligible foreground presentation after a launch. On a populated desktop, fourteen named agents orbit the Synapse mark, then build the visible controls and graph. They drag copies, type labels and draw connections. Each agent fades when its work is done, and the node outlines pulse once. The full sequence takes about 4.46 seconds. Sparse workspaces finish sooner. You can click, type or scroll at any point to take control immediately.

**Return animation** controls a separate, silent, roughly 280 ms accent when you Alt-Tab back after being away. The current workspace stays visible as a few chrome edges and graph connections briefly light up. It preserves your open note, unsaved text, caret, selection, scroll and graph view. Native file dialogs and brief focus bounces do not trigger it. Both checkboxes default to enabled when absent; Reduced skips both effects, Follow Windows respects the OS preference, and Full explicitly enables normal motion. New profiles start at 70% sound volume; existing saved settings and volume are preserved.

One lazy Web Audio instrument uses original additive synthesis. Subnetwork entries use C4–G4, topics C5–G5, and linked concepts C6–E6, with stable node-derived pitches and bounded attack, detune and level variation. Higher voices are shorter and quieter; deeper exploration stays in that highest register. Back/close and neighbour arrivals are restrained. Six-voice limits, compression/limiting, repeated-event suppression and native-focus cancellation remain in place. Typing, hover, startup and indexing stay silent. No recorded notification or external sound file is bundled.

See [interaction architecture](../INTERACTION.md) and [executed validation](../VALIDATION.md) for timing, lifecycle and test boundaries.

## Study creation and optional OpenAI

**Preferences → Study creation → AI provider** offers **Synapse AI** (owner-funded) and **Personal API key**. New installations lead with Synapse AI; existing installations retain their personal-key provider, credentials and settings. Provider changes require an explicit action. Exhausting hosted allowance or shared funding never falls back to a personal key.

For Synapse AI, read the data notice and activate a private invitation. Selected content passes through the Synapse gateway to OpenAI. A person's devices share 10 generations per UTC day by default, 3 submissions per minute and one active generation. Hosted quizzes allow up to 10 questions; flashcards allow up to 20 cards. The compact allowance shows the server reset in your configured timezone; details and service status live in Preferences. Shared budget, personal allowance and paused/unavailable service states are distinguished. Saved study, editing, graph navigation, flashcards and reminder delivery remain local when the gateway is unavailable.

The 0.6.0 release build points to `https://synapse-ai.nottbradd.workers.dev`. Its dedicated Worker, D1 database and restricted service-account secret are deployed and active for private invitations after a successful installed-app owner trial. Effective spending limits are US$5/day, US$60/month and US$60 cumulative. The owner approved an earlier funding cutoff of **25 November 2026 at 00:00 UTC (11 am Sydney)**; this is a conservative service limit, not a claimed exact provider grant expiry, and it does not renew automatically. See [owner setup, enrollment and deployment state](../backend/ai/README.md). A build without `SYNAPSE_AI_URL` reports that the service is not configured. The owner's key never belongs in the repository, desktop or portable packages.

**Create** opens one drawer with Quiz, Flashcards and Reminder tabs. Work manually or explicitly generate a draft. Select the current note, notes from the current scope, or a subject; inspect the exact outgoing source text before generation. Limits are 20 source notes, 16,000 UTF-8 bytes per note, 60,000 total source bytes and 20 generated items. Excluded notes are listed; attachments and unrelated subjects are never uploaded automatically. Reminder interpretation sends the selected target references and request, not note bodies.

Preferences accepts an API key transiently, clears the input after submission, and stores it in Windows Credential Manager. Rust performs network requests; the stored key is never returned to React or written to vaults, exports, ordinary settings or logs. Adding, replacing, removing and testing the key are explicit actions. API usage is billed separately from ChatGPT subscriptions.

The implementation uses the official [Responses API](https://developers.openai.com/api/docs/quickstart) and [strict structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs). Supported choices are [GPT-5.4 mini](https://developers.openai.com/api/docs/models/gpt-5.4-mini) (default) and [GPT-5.4](https://developers.openai.com/api/docs/models/gpt-5.4). There is no automatic model substitution or retry. The configurable output limit is 512–16,384 tokens; the explicit connection test sends no notes and allows 128 output tokens. Local returned-token counters are informational, not a billing balance; interrupted requests can still incur usage.

Rust validates the strict response shape, IDs, counts, lengths, answer indexes, source membership and current source revisions before publication. Notes and generated text are untrusted content, with no model tools or command execution. Refusals, incomplete output, invalid responses, credentials, model access, quota, rate limits, network errors and timeouts produce actionable errors. Navigating to a different scope or vault cancels/discards pending output. Generated drafts remain unsaved until explicitly saved and must be checked for accuracy; they are not official examination material.

- **Quizzes:** edit questions, choices, correct answers, explanations and source references; save, take and view results offline. Multiple choice is marked deterministically in Rust. Short answers show guidance and require self-assessment. Attempts have stable IDs and never affect spaced-repetition history.
- **Flashcards:** edit, remove and select cards, then choose a destination subject and a new or existing non-source note. Saves use canonical `Q:`/`A:` Markdown, revision checks, source WikiLinks and an idempotent recovery marker. The original source notes are protected. Previewing and saving do not create review history.
- **Reminders:** edit the resolved title, local date/time, IANA timezone, note/subject target and optional daily/weekly repeat. Australia/Sydney is the initial timezone. Ambiguous times require an explicit choice; nonexistent DST times and past initial dates must be corrected before save. No network request is needed at delivery.

## Reminder lifecycle

Reminder definitions and pending catch-up state live in the vault; device configuration registers which local vaults this installation should check. While the process is running, a two-second local timer checks current UTC time, including after sleep/resume or wall-clock changes. A durable delivery claim precedes a Windows toast to prevent duplicates. A crash between claiming and showing can therefore leave a catch-up entry without a toast. Daily/weekly repetitions retain their local wall time; a DST gap advances to the first valid minute, and a fold uses the selected occurrence (earlier by default for recurrence).

The Study library supports edit, cancel, dismiss and ten-minute snooze. Missed occurrences are collected in a concise catch-up list rather than replayed as a burst of toasts. Imported reminders are paused until edited and saved with a future time. Native notifications require the installed Windows application; see [Tauri's Windows notification requirements](https://v2.tauri.app/plugin/notification/).

**Keep reminders running when the window closes** hides the window in the tray. **Quit Synapse** fully exits, so reminders cannot run until the next launch. Optional **Start Synapse when I sign in to Windows** is off by default; when enabled with background mode, launch stays in the tray. These settings are device-specific and visible in Preferences. No OS scheduling service delivers after full exit. An unavailable/moved vault must be reopened at its current location.

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

In Read mode, recognised cards become recall blocks with initially hidden answers. Reveal with the button, Space or Enter; answers retain Markdown, WikiLinks and KaTeX. Changing notes or card content resets the reveal, while an ordinary vault refresh preserves it. Recognition and source ranges come from the same Rust parser used for Review. Reading and revealing do not change Markdown, card identity or review history. Split mode continues to preview the editable source directly, and Review controls its own reveal.

## Scheduling and local storage

Revision shows due and new cards by subject. Reveal with Space, then rate with **1 Again**, **2 Hard**, **3 Good**, or **4 Easy**. Shortcuts ignore text inputs. Again cards are due in 60 seconds and can reappear in the same open session. Future cards stay out of the queue. Progress is persisted after each rating.

The four rating buttons display actual next intervals from a read-only Rust scheduler preview, computed from one history record and reference time. Previews refresh with the card or its history and never create records or increment counts. Only a successful rating persists a schedule; there is no TypeScript copy of the scheduling rules.

The deterministic SM-2-inspired scheduler starts at ease 2.5:

| Rating | Next interval                                     | Ease change                        |
| ------ | ------------------------------------------------- | ---------------------------------- |
| Again  | 60 seconds                                        | −0.20, minimum 1.3; lapse count +1 |
| Hard   | max(0.5 days, previous × 1.2)                     | −0.15, minimum 1.3                 |
| Good   | 1 day when previous <1, otherwise previous × ease | none                               |
| Easy   | max(4 days, previous × new ease × 1.3)            | +0.15, maximum 3.5                 |

Intervals are capped at 3650 days. Due dates use UTC Unix seconds and the computer clock. Each rating increments the review count. This is a small transparent scheduler, not a claim of equivalence with Anki or FSRS.

`flashcards.json` lives at the vault root and now uses schema version 2. It stores scoped schedules and retains original global records in `legacy_cards`. The v1 file is backed up byte-for-byte to `.synapse/flashcards-v1-backup.json` before conversion. `.synapse/organization.json` uses schema version 1 and stores stable Neuron/subject records, legacy memberships, imported link/card mappings, and the last selected location. Missing history starts fresh. Malformed, unknown-field, or unsupported metadata is preserved and reported, never silently replaced. The selected vault path is saved in `%APPDATA%\com.synapse.study\last-vault.json`. Tauri/WebView2 also maintains runtime data in the app data directory. Core vault and study features run locally without an account. Optional hosted AI uses an invitation-only Cloudflare gateway and OpenAI; personal-key AI connects directly to OpenAI. Fonts ship with the app.

## Subject transfer

**Import subject** accepts an ordinary Markdown folder or a `.synapse-subject` ZIP package. Choose a destination Neuron (or create one in the flow), review the note/attachment counts and unresolved external references, and confirm the import name. A conflicting name defaults to a separate numbered copy. Every import gets a new subject UUID; existing files and subjects are not overwritten or merged. Packages can include review history only by explicit export opt-in, and importing that history requires a second explicit opt-in. Both default to off.

Use a subject's menu to **Export subject**. Only its Markdown notes and referenced supported local media/PDF files are included. Internal WikiLink targets are mapped to the new root while preserving heading fragments and aliases. External WikiLinks retain their text and are marked unresolved in the copy, even if the destination has a similarly named note. Local attachments are preserved, but rendering them remains outside this version's scope. Native dialogs choose sources/destinations; all content operations run in Rust.

Imports validate paths, case collisions, file types, hashes, schema, sizes and identity maps before publication. Limits are 10,000 content files, 32 MiB per file and 256 MiB total. Symlinks, junctions, traversal, absolute/drive paths, alternate streams, duplicate/conflicting entries and unsupported manifests are rejected. Publication stages a complete directory and uses a durable journal; recovery completes before the next snapshot. Cancellation applies before publication, and the final publication phase is non-cancellable. Detailed format, recovery and supported-reference boundaries are in [MIGRATION.md](../MIGRATION.md).

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
  ai.rs, device.rs         Bounded Responses requests and OS-protected credentials
  study.rs                Versioned local quizzes, attempts and reminders
  study_commands.rs       Draft publication, local marking and canonical card saves
  reminders.rs            Durable local scheduling and native notifications
  study_transfer.rs       Portable study content and identity remapping
  errors.rs, tests.rs      Typed errors and regression coverage
fixtures/demo-vault/       Synthetic study notes only
.github/workflows/         Windows checks and desktop packaging
```

See [VALIDATION.md](../VALIDATION.md) for the checks actually run and outstanding limitations.

The desktop integration scripts attach to a real WebView2 process and create disposable vaults. Screenshots and reports stay under ignored `.local/`; `SYNAPSE_QA_BASE` optionally places vault fixtures elsewhere. Use a temporary directory when the checkout inherits restrictive Windows folder permissions. To reproduce the packaged checks, launch the production executable with a local debugging endpoint:

```powershell
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9222'
$env:SYNAPSE_QA_BASE=Join-Path $env:TEMP 'synapse-desktop-qa'
Start-Process .\src-tauri\target\release\synapse.exe
node scripts/update-desktop.mjs
node scripts/release-verify.mjs
```

Run the two commands in order: the first creates a fresh fixture, and the second extends that fixture. The update harness covers hierarchy creation, location scoping, editing/conflicts, independent review queues and responsive screenshots. The release harness checks offline operation, missing-note creation, stable graph rendering, focus restoration, empty states and emulated display densities. `transfer-desktop.mjs` runs against the development desktop: it substitutes the native picker module's responses only, and exercises the real Rust export/import/validation/persistence commands. Native picker rendering is inspected separately. The older `desktop-smoke`, `desktop-extended` and `desktop-offline` scripts document the v0.1 baseline and use selectors from that interface. Close test instances and remove `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` before a normal launch. The CI workflow runs unit/static checks and builds the installer; desktop integration runs locally.

### Deterministic API verification

`node scripts/mock-study-api.mjs` serves synthetic Responses-shaped results on loopback port 4318. Development builds require **both** debug assertions and the `test-api` Cargo feature to use `SYNAPSE_TEST_API_URL=http://127.0.0.1:4318/v1/responses`. Set `SYNAPSE_TEST_DEVICE_DIR` to a temporary directory. This path uses a separate credential service and a dummy transport key, and displays a local-mock label. Release builds compile out the override. `node scripts/study-desktop.mjs` exercises real UI, Rust transport, validation and persistence. `--record` additionally captures original compositor frames and live app audio; keep the native window focused. Reports and media remain under ignored `.local/`.

`cargo test --manifest-path src-tauri/Cargo.toml configured_api_integration_check -- --ignored --nocapture` explicitly runs a bounded live check only if the normal credential entry exists. A missing credential reports live verification as pending. Automated mock success is not evidence of a successful live API request.
