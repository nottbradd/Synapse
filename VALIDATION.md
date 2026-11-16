# Synapse validation

Private owner activation and billing records for the historical 0.5.1 build were removed before public release. Its notification-derived recording is not redistributed. See the current release validation for the replacement original audio and verified public installer.

## 0.5.0 owner-funded AI — 16 November 2026

Implemented a separate Synapse Worker/D1 gateway, protected Wrangler owner CLI and explicit desktop provider selection. Calendar's supplied AI architecture was read only; no Calendar files, database, secret or deployment were changed. The checked-in Synapse database ID is still a placeholder, and the installed desktop has no live gateway origin. No live Cloudflare deployment, owner service credential, OpenAI inference, provider billing or credit application is claimed.

Completed local checks:

- TypeScript typecheck, ESLint and 56 frontend tests passed.
- Rust formatting and Clippy with warnings denied passed. Final Rust suite: **46 passed**, one explicit live-provider test ignored.
- **22 gateway tests** passed against actual local D1 with mocked OpenAI responses. Coverage includes cross-device allowances, concurrent last-allowance and shared-budget admission, one active request per person, rolling rate limits, duplicate IDs, interrupted requests, retained reservations, missing/partial usage, atomic overrun pause, revocation/disablement, single-use/expired invitations, capacity, expiry during upload, server-clock resets, forbidden overrides, missing credentials, storage/guard failures and fresh paused defaults.
- `scripts/hosted-ui.mjs` passed seven browser interaction checks using real React and the real local Worker/D1, with **desktop IPC and OpenAI mocked**. Consent gates activation; provider changes require explicit apply; generation yields an editable unsaved quiz; saving is explicit; a saved quiz opens without gateway access; hosted failure makes zero personal-key calls; detailed allowance and device revocation work. Evidence: ignored `.local/hosted-ui/report.json` and labelled screenshots. This browser harness is not native desktop inference evidence.
- Production Vite/Rust/NSIS build passed. Worker production bundling passed `wrangler deploy --dry-run`; this did not deploy it.
- Production dependency audit and complete backend dependency audit reported zero vulnerabilities.
- The release binary contains no test endpoint override strings, mock-service credential literal or owner secret binding. Test routes require debug mode plus the explicit test feature and are excluded from release.

The **0.5.0 installer completed with exit code 0**. Windows file/product version reads 0.5.0. The actual installed app was opened at `http://tauri.localhost/` through native Windows automation. It restored the existing synthetic vault and preserved **Personal API key**, **Full** animations, enabled sound and **69%** volume. Previewing Synapse AI showed its consent notice and honest service-not-configured state, with activation and switching disabled before consent; the stored provider remained personal. No personal key was read into the UI, replaced or tested, and no live hosted generation was attempted.

Installer: `src-tauri/target/release/bundle/nsis/Synapse_0.5.0_x64-setup.exe`. SHA-256: `7B16ED68CD6C19220706DF71B25CAED2CC31157601329DAFC3D16199BBAE81C6`. The installer remains unsigned. Owner deployment/activation and provider verification are intentionally pending the separate credential, endpoint, funding ceilings and expiry configuration documented in [backend/ai/README.md](backend/ai/README.md).

## 0.4.1 motion correction — 16 November 2026

Windows reported `SPI_GETCLIENTAREAANIMATION=false`. After explicitly clearing Playwright's default media emulation, the installed WebView also reported `prefers-reduced-motion: reduce`. Following Windows therefore correctly skipped spatial animation, but the app provided no independent Full choice. Earlier normal-motion emulation masked this configuration.

The installed-app regression also found that Graph's layout effect could retain a null drawer element on the first selection after launch/reload. The camera animated but the new drawer appeared immediately. Resolving the live drawer ref on the animation frame fixes that lifecycle case.

Local validation passed:

- TypeScript, ESLint and 54 frontend tests.
- Rust formatting, Clippy with warnings denied, and 40 Rust tests; the explicit live API test remained ignored.
- Production frontend/Rust build and NSIS packaging; installer completed with exit code 0.
- Seven installed-app cases using `scripts/motion-desktop.mjs`: native Follow Windows, native Full, Full after reload, explicit Reduced, both live system-preference changes, and Full overriding a reduced-motion request.
- Native Full produced 63 distinct intermediate drawer positions and 48 zoom steps; the first opening after reload produced 61 positions and 47 zoom steps. Reduced cases had no intermediate drawer positions and only their start/end zoom values.
- Full persisted across reload. Existing Sound and Volume values were preserved, the original vault was restored, and the user's requested Full choice remained selected.

The native cases run before any synthetic media changes, with no renderer replacement or API mocks. Synthetic study content stays in a temporary vault. Evidence is in ignored `.local/motion-0.4.1/report.json`, per-case frame samples, `follow-windows.png` and `full-motion.png`.

The updated installer is `src-tauri/target/release/bundle/nsis/Synapse_0.4.1_x64-setup.exe`, SHA-256 `6AC6E3E73442905EA54B7CF55F05EE872237FE15032EA12A2724810256849A49`. It is unsigned. The installed executable is `%LOCALAPPDATA%/Synapse/synapse.exe`.

## 0.4.0 feature validation

Executed on Windows x64 on 15–16 November 2026 (Australia/Sydney). All study content used for verification was synthetic and kept in temporary vaults. Personal study notes and credentials were not used. Previous release evidence remains in Git history.

## Automated checks

| Check                                       | Result                                                             |
| ------------------------------------------- | ------------------------------------------------------------------ |
| TypeScript typecheck and ESLint             | Passed                                                             |
| Frontend tests                              | 46 passed across 5 files                                           |
| Rust tests, locked dependencies             | 40 passed; 1 explicit live test normally ignored                   |
| Rust formatting and Clippy, warnings denied | Passed                                                             |
| npm audit, all dependencies                 | 0 vulnerabilities                                                  |
| Production Vite, Rust and NSIS build        | Passed                                                             |
| Windows Credential Manager                  | Separate temporary credential entry roundtrip/removal passed       |
| Explicit bounded live API check             | Executed; reported pending because no configured credential exists |

New Rust coverage checks strict output shape, required nullable fields, types, item counts, source membership, option indexes, refusal/incomplete output, malformed JSON, response-size limits, HTTP quota errors, cancellation, timeout and redaction. Requests use deterministic local HTTP responses. Source preview tests verify selected bodies only and visible whole-note exclusions. Draft origins and receipts cover stale scope, cancellation and duplicate publication.

Persistence tests cover deterministic offline multiple-choice scoring and short-answer self-assessment; canonical flashcards; protected source notes; external-change conflicts; interrupted-save recovery; stable source mappings; unchanged review-history bytes; corrupt metadata preservation; study-bearing package roundtrips; external references; fresh imported identities; paused imported reminders; and opt-in quiz-attempt transfer. Timezone tests cover Sydney DST gaps/folds, future-date validation, local daily/weekly recurrence, missed occurrence skipping, clock rollback and durable duplicate suppression.

Existing tests retain containment/junction protection, hostile archives, journal recovery, subject identity and legacy schedule migration, canonical recall recognition, read-only scheduler previews, graph framing/retargeting/reduced motion, label placement, bounded audio reservations and cancellation.

## Real desktop checks

The development and installed production executables were exercised through their actual WebView2 renderer and Rust IPC. The installed URL was `http://tauri.localhost/`; no browser-only mock frontend was used. The installed executable differs from the standalone release executable only in Tauri's three-byte bundle marker (`UNK` versus `NSS`). Windows reports product version 0.4.0.

- `scripts/study-desktop.mjs`: real source selection, local mock HTTP generation, quiz editing/save, offline quiz taking and deterministic scoring, short-answer self-assessment, flashcard editing/removal/canonical saving, unchanged review history, reminder interpretation/preview/save, actionable rate-limit error, cancellation and stale-scope rejection. No JavaScript errors.
- `scripts/interaction-desktop.mjs`: exact selected-node centring (zero x/y error), reverse/retarget stability, body-only save without camera/position changes, idle renderer pause, runtime reduced motion, node-relative label side changes with a pinned camera, six-voice admission, complete cleanup, silence after cancellation/mute, and persisted sound preferences. Default rendered peak 0.01314; dense case 0.03960; no remaining voices/reservations.
- `scripts/recall-desktop.mjs`: actual parser/scheduler, keyboard recall reveal, Markdown/WikiLink/KaTeX answers, note/revision reset rules, unchanged history for previews and actual rating persistence.
- `scripts/transfer-desktop.mjs`: actual Rust import/export/archive/filesystem operations passed, with only native chooser responses substituted. The pre-existing native file-dialog implementation is unchanged.
- Packaged release regression: offline reload/edit/review, dirty window-close guard, missing WikiLink creation, stable Canvas after ordinary edits, modal focus restoration, empty state, and DPR 1.5/2 backing-store checks passed with no overflow or JavaScript errors. Repeated-run fixture note/card names were made unique to avoid existing synthetic content.
- Installed reminder test: manual preview/save; close-to-tray kept the process running; the due occurrence was claimed once; Windows `ToastNotificationManager.History` contains the real Synapse toast titled “Revise conservation of momentum”. Snooze, edit, cancellation and stable reminder identity passed.
- Full Quit exited the process. Launching with background enabled stayed hidden; a second normal launch reopened the same instance. Three controlled overdue reminders recovered once in the catch-up view, and native toast history remained at one entry. Dismissal worked. Startup registration was enabled, read back and restored to off. Background mode was restored to off.

The Windows automation helper does not expose notification banners. Native delivery is verified in Windows' own notification history, but no native-banner screenshot or footage is claimed. User visual confirmation was requested separately. Real sleep/wake and multi-monitor DPI transitions were not physically performed; timer restart, clock arithmetic and DST behaviour have deterministic coverage.

## Appearance and recordings

The approved angular reference and supplied sound synthesis/audition assets were inspected before implementation. The actual app now has angular junctions, tight emission, curved relationships, fewer overview labels, separated subject silhouettes and spacious matte panels. The small-window review found and corrected an over-tight fit when opening Create: it now retains the readable graph scale instead of compressing the entire graph into the uncovered strip.

Matched 0.3.1 before screenshots are in `.local/cyber-before/`. Packaged after screenshots in `.local/cyber-after/` cover the 32-note multi-subject overview, note drawer, subject focus, review, 90-note dense vault, creation modes, API/reminder settings, small windows, reduced motion, opaque fallback, offline reading and reminder catch-up. `.local/cyber-study/` contains clearly labelled mocked quiz/card drafts, quiz taking/results, reminder preview and the rate-limit state. Renderer DPR 1.5 and 2 are separately checked with native-size Canvas backing stores; these are emulated renderer-density checks, not a claim of testing physical monitor changes.

Actual application recordings with live app audio:

- `.local/Synapse-0.4.0-study-mocked.mp4`: 30.308 s; 901 original compositor frames, 866 consecutive unique frames. Clearly labelled local-mock generation/editing, saved quiz use, card saving, reminder drafting, errors/cancellation, click-to-focus, retargeting and return. Changed transition cadence measured 79.7–92.8 fps, with median gaps about 12.1 ms and p95 up to 36.4 ms.
- `.local/Synapse-0.4.0-installed.mp4`: 9.582 s; 457 original compositor frames, 452 consecutive unique frames. Installed-app focus, interrupted retarget, exact-return interaction and manual reminder preview/save. Changed transition cadence measured 71.9–94.0 fps, median about 12.1 ms and p95 up to 24.3 ms.

Every delivered motion frame comes from the real WebView compositor. MP4 decoding preserved all source frames; maximum timestamp differences were 0.94 ms and 0.72 ms respectively. Variable frame timing is retained, with no interpolated frames. Live AudioContext output is recorded without a microphone; timestamp gaps are filled with silence during muxing, not invented cues. The study recording's captured peak was approximately -27.7 dBFS at the configured volume. A nominal 60 fps target is not presented as a constant frame rate; idle periods are intentionally still and individual frames can exceed 16.7 ms.

Subjective listening quality is not asserted. The implementation ports individual dry contacts and damped resonances from the supplied reference, and its levels/lifecycle have measured validation. Native Windows toast banners are outside the WebView capture and are not fabricated in the films.

## Delivery boundaries

The production executable is `src-tauri/target/release/synapse.exe`; the NSIS installer is `src-tauri/target/release/bundle/nsis/Synapse_0.4.0_x64-setup.exe`. The local installation is `%LOCALAPPDATA%/Synapse/synapse.exe`. Both executable and installer are unsigned. The Vite bundle warning remains: approximately 1.55 MB JavaScript before compression, 501 KB compressed. Fonts, licenses, graph and sound code are bundled; no `.codex` runtime dependency exists.

Live OpenAI generation remains pending until a key is configured. Automated and filmed generation is explicitly mocked. Reminders require Synapse to be running; full exit has no OS-backed scheduling service. A crash after a durable delivery claim but before the toast can leave a catch-up entry without a banner. File writes remain optimistic against other editors/cloud sync, rather than providing cross-process locking. Generated study material requires user review for correctness.

The GitHub repository remains private. Validation media and synthetic vaults remain local and ignored by Git; they are not uploaded as repository content.
