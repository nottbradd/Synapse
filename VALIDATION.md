# Synapse 0.3 validation

Executed on Windows x64 on 15 November 2026 (Australia/Sydney), using synthetic temporary vaults. Personal study files were not used. The 0.2 validation record remains in Git history. The Rust data model and scheduler are unchanged.

## Automated checks

| Check | Result |
| --- | --- |
| TypeScript typecheck and ESLint | Passed |
| Frontend unit tests | 36 passed |
| Rust unit tests | 18 passed |
| Rust formatting and Clippy with warnings denied | Passed |
| npm audit | 0 vulnerabilities |
| Production Vite/Rust/NSIS build | Passed |

New tests cover exact critically damped integration, rest/settling, continuous reversal, shared drawer/camera progress, log zoom, no secondary drift, measured usable-centre projection, reduced motion, outlier-inclusive fitting, forced label flips in both directions, upper-arc clearance, hysteresis, relative anchoring, constant label width, ring timing, font measurement invalidation, signal durations/arrival/cancellation, hub bounds, polyphony, priority and repeated-cue gates, future reservations, native-focus dominance, audio lifecycle and preference persistence. Hidden-label radius settling has a regression test. Existing WikiLink, archive, recovery, containment, Unicode, subject-identity and scheduler checks remain.

The build retains a Vite bundle-size advisory: approximately 1.50 MB JavaScript before compression, 488 KB compressed. Fonts and their OFL licenses are embedded locally. The application and installer are unsigned.

## Real desktop checks

The updated Tauri development executable and final packaged executable were exercised through their actual WebViews and Rust IPC. The production URL was `http://tauri.localhost/`. Tests used temporary vaults with 97 notes, multiple Neurons, duplicate Physics subjects with independent progress, custom subject colours and a 90-note dense cluster.

- Creation, Neuron/subject scoping, Read/Split/Edit, safe save, dirty-navigation and window-close guards passed.
- External-change conflict detection and explicit Keep my edits recovery passed. A matching Markdown H1 is hidden only in Read presentation; note bytes remain intact.
- KaTeX, WikiLinks and explicit missing-note creation passed. Offline reload, reading, editing, saving and reviews passed in the packaged executable.
- Subject review isolation passed. Actual Again/Good interactions emitted forgot/remembered events and no completion while awaiting a retry. An empty session emitted no completion event.
- Imports/exports passed through the real Rust implementation: package/folder inputs, attachments, name conflicts, history opt-ins, malformed input and cancellation. Only the native chooser response was substituted in this automated transfer pass. Rust tests additionally cover archive limits, escapes, malformed metadata and publication recovery.
- Full-process restart retained Sound off and 27% volume. Defaults were restored to Sound on and 35% after the check. Vault and selected scope restoration also passed.
- Modal Escape and focus restoration, empty states, reduced-motion handling and the opaque glass fallback passed.
- No JavaScript exceptions or console errors were recorded by the successful desktop regression runs.

The production graph's Canvas image was byte-identical after an ordinary body-only filesystem update. The check waits for the spring to settle, then compares Canvas pixels directly; an element screenshot also captures HTML title transitions above the Canvas and is not an isolated graph comparison. Development instrumentation separately verified identical node coordinates and camera frames after a watcher update.

## Motion and audio

The actual scene's selected-node projection matched the measured uncovered centre with 0 px horizontal and vertical error in the tested 1600 px layout. Rapid close/open reversal settled without a later frame change. Runtime reduced motion reached the same destination immediately. Once settled, an instrumented one-second idle interval recorded zero Canvas draw calls.

The production label state was exercised in the actual Canvas with the camera pinned and the placement rectangle constrained, then restored. Target angles changed 0 → pi → 0, with the camera frame unchanged. Unit tests additionally inspect upper-arc clearance at intermediate frames and node-relative offsets during camera movement.

OfflineAudioContext rendered the actual synth at 48 kHz. The default-volume contact peaked at 0.028413 (about -30.9 dBFS); a six-voice mix at maximum volume peaked at 0.093039 (about -20.6 dBFS). Thirty simultaneous requests admitted six voices. Muted and cancelled renders were exactly silent. Every completed/cancelled render left zero active sources and reservations. These measurements do not substitute for subjective timbre assessment.

Native minimize testing cancelled queued contacts and muted the synth. A later DOM focus event left native focus false and audio muted, with zero reservations. Unit tests cover returning focus without replaying a backlog, stale arrivals and context disposal. Audio timing uses the same frozen packet arrival plan, with no setTimeout-based audio queue.

## Visual evidence and boundaries

The actual native Windows app was inspected at the current 100% display setting. WebView viewport tests covered 900×600, 1440×900 and 1600×1000 layouts. Density emulation at 1000×700 and DPR 1.5/2 allocated 1500/2000-pixel Canvas backing stores with no horizontal page overflow. This is WebView density emulation, not an actual Windows DPI switch or multi-monitor transition test.

Actual application screenshots and reports are retained under ignored `.local/`. The separate 32-note capture vault is clearly named `Synapse release verification` and contains synthetic notes. The capture harness records the packaged app and taps only its own final Web Audio output, without microphone or desktop audio access. Capture completion and delivery links are reported separately; a production recording is not claimed merely because the earlier prototype exists.

Native folder chooser rendering and Escape cancellation were verified. A complete native selection/save cycle remains unverified: the Windows automation helper reported unavailable child indexes and placed focus in the wrong native control. No security setting or ACL was changed. The user-dismissed firewall prompt from the previous session was not automated.

Subjective listening is unverified because the available execution environment does not support audio input. The synth was inspected, rendered, level-checked and supplied for playback; no claim of a human listening comparison is made. Multi-hour use, every keyboard path and actual multi-monitor DPI transitions remain outside this focused pass.

## Artifacts

- Executable: `src-tauri/target/release/synapse.exe` — 13,764,096 bytes
- Installer: `src-tauri/target/release/bundle/nsis/Synapse_0.3.0_x64-setup.exe` — 4,363,113 bytes
- Executable SHA-256: `ba0ad3c9061d722d96276cfedb993891fa05a11f732220ad878b1bb67732d339`
- Installer SHA-256: `0e67d1579c0a0aba3901b53563e65c829771fdbc7c5adb74944c3019b617fb73`

GitHub remains private. Hosted CI status must be checked against the delivered commit; local results do not imply a hosted run has finished.
