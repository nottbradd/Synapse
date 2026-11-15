# Synapse 0.4.0 validation

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
