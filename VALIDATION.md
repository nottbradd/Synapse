# Synapse 0.3.1 validation

Executed on Windows x64 on 15 November 2026 (Australia/Sydney), using synthetic temporary vaults. Personal study files were not used. Previous validation records remain in Git history. This refinement extends presentation and preview APIs without changing stored identities, history schemas or scheduling rules.

## Automated checks

| Check                                           | Result            |
| ----------------------------------------------- | ----------------- |
| TypeScript typecheck and ESLint                 | Passed            |
| Frontend unit tests                             | 46 passed         |
| Rust unit tests                                 | 21 passed         |
| Rust formatting and Clippy with warnings denied | Passed            |
| npm audit                                       | 0 vulnerabilities |
| Production Vite/Rust/NSIS build                 | Passed            |

New coverage checks canonical recall recognition and UTF-16 source ranges, CRLF/BOM/emoji input, original content hashes, duplicate occurrences, Markdown containers and adjacent prose, nonrecursive answer rendering, and exact agreement between all four previews and committed scheduling results at a fixed time for new and mature cards. Preview tests verify unchanged history bytes, no creation of missing history, no legacy migration and no replacement of malformed history. Graph tests cover bounded CSS-pixel radii, occupied-subject composition, outlier fitting and stable positions across scope changes. Existing motion, label, audio, WikiLink, containment, transfer, recovery and identity tests remain.

The production bundle retains a Vite size advisory: approximately 1.51 MB JavaScript before compression, 491 KB compressed. Fonts and their OFL licenses remain embedded locally. The executable and installer are unsigned.

## Real desktop checks

The Tauri development executable and packaged 0.3.1 executable were exercised through their actual WebViews and Rust IPC. The packaged URL was `http://tauri.localhost/`. Integration fixtures include 97 notes, multiple Neurons, duplicate Physics subjects with independent progress, a custom subject and a 90-note dense cluster. The final production build also supplied the eight after screenshots and the recording.

- Creation, Neuron/subject scoping, Read/Split/Edit, safe save, dirty-navigation and window-close guards passed. External-change conflict detection and explicit Keep my edits recovery passed.
- Read-mode recall passed Space/Enter interaction, expanded state and keyboard focus, initial answer hiding, Markdown/WikiLink/KaTeX answers, reset on note/card changes and retention on an ordinary refresh. Neither reveal nor preview changed source/history bytes or created history. Review retained its separate reveal.
- Review previews displayed actual new-card intervals (1 min, 12 hr, 1 day, 4 days), refreshed after a mature-history update and matched a subsequent 25-day Good commit. Rating before reveal was blocked; repeated rapid rating input committed once.
- KaTeX, WikiLinks, explicit missing-note creation, offline reload, reading, editing, saving and reviews passed in the packaged executable.
- Subject review isolation, hierarchy edits, responsive layouts and transfer regression checks passed. Transfer tests used the real Rust package/folder/attachment/conflict/history/validation paths; only native chooser responses were substituted in that automated pass. Rust tests retain archive, path and interrupted-publication checks.
- Modal Escape/focus restoration, empty states, reduced motion and the actual opaque fallback material passed. Successful desktop regression runs recorded no JavaScript exceptions or console errors.

Both production Canvas layers were byte-identical after an ordinary body-only filesystem update once settled. Development instrumentation separately verified unchanged node coordinates and camera frames. Scope-only changes retained settled coordinates and restored the overview exactly; explicit dragging still updates node positions.

Native folder selection was exercised in the actual Windows dialog and restored genuine native focus before recording. The Open/Save/import/export native dialog checks from the preceding 0.3.0 pass remain documented in Git history; this pass does not represent the automated chooser substitutions as fresh native-dialog coverage. No security setting or ACL was changed.

## Motion and audio

The selected node matched the measured uncovered centre with 0 px horizontal and vertical error at the tested 1600 px layout. Rapid reversal settled without later drift. Runtime reduced motion snapped to the destination. A settled one-second interval recorded zero Canvas draw calls. The light and geometry layers share the same transform, DPR and animation clock.

Two complementary label checks passed. With placement constraints controlled, the actual development scene changed targets 0 → pi → 0 while its camera stayed fixed. Separately, a real pointer drag moved a selected node from (692, 502) to (1000, 340), producing a visible right-to-left transition with an unchanged camera and no placement override. The packaged recording uses a longer drag into the clear upper area at (1000, 180), showing the final label on the left. Unit tests also inspect intermediate upper-arc clearance, hysteresis, cooldown and node-relative offsets.

The sound implementation was retained. OfflineAudioContext rendered the actual synth at 48 kHz: default contact peak 0.028413 (about -30.9 dBFS), maximum-volume six-voice mix 0.093039 (about -20.6 dBFS). Thirty simultaneous requests admitted six voices. Muted/cancelled renders were silent, with zero remaining sources and reservations. Preference reload, native-focus gating, cancellation and disposal remain covered. These measurements do not establish perceived timbre.

## Visual comparison

The approved luminous graph mockup, later typography screenshot, motion reference and previous application recording were inspected. Actual screenshots were compared directly during iteration of node optics, edge contrast, cluster spacing, fitting, material tint and scene-derived light. The final overview has distinct bright cores and coloured connections; cluster light continues behind glass while interactive geometry is clipped away from obstructed areas. Reading text remains opaque and crisp.

The before and after passes use the same synthetic fixture identities and viewport. The overview contains 32 notes across five occupied subjects. The separate dense view contains 90 notes. Eight pairs are retained under `.local/refinement-before/` and `.local/refinement-after/`:

- `overview.png`: small multi-subject overview.
- `drawer.png`: same graph with note drawer and recall.
- `subject.png`: focused subject.
- `review.png`: review dialog and scheduler intervals.
- `dense.png`: dense cluster.
- `small.png`: 900 × 600 window.
- `reduced-motion.png`: reduced spatial motion.
- `opaque-fallback.png`: solid fallback material.

All other views use 1600 × 1000. `.local/Synapse-0.3.1-comparison.html` embeds the 16 original screenshots without image editing; all images were loaded and checked in Edge. The native Windows display remained at 100%. WebView density emulation at 1000 × 700 and DPR 1.5/2 allocated 1500/2000-pixel backing widths for both Canvas layers, without horizontal overflow. This is not an actual Windows DPI switch or multi-monitor test.

## Actual application recording

`.local/Synapse-0.3.1-demo.mp4` is 17.78 seconds of the final packaged executable, 1600 × 1000 H.264/AAC. It includes overview, drawer opening/closing, keyboard recall reveal, a real label-side-change drag, subject focus/return and successful review grading. The app was natively focused. Audio was recorded from its final live Web Audio output without microphone/desktop capture or a replacement soundtrack. Decoded audio peak was -24.8 dBFS (mean -57.4 dBFS including silence), with no clipping.

The capture uses every delivered compositor frame (`everyNthFrame: 1`), not every third frame. Its source timestamps and image hashes were checked; 841 source frames contained 827 consecutive distinct images and 14 identical consecutive images. Source timestamps were strictly increasing. The MP4 decodes to all 841 source frames, with maximum timestamp difference 0.88 ms from the original capture after millisecond quantisation. Edge decoded and sought the file successfully. No interpolated motion frames were generated.

| Recorded action                    | Source frames/s | Distinct frames/s | Median gap | 95th-percentile gap |
| ---------------------------------- | --------------: | ----------------: | ---------: | ------------------: |
| Drawer opening                     |           85.74 |             85.74 |   12.12 ms |            24.19 ms |
| Real pointer drag and label change |           74.24 |             73.68 |   12.14 ms |            24.26 ms |
| Drawer closing                     |           94.53 |             94.53 |   12.11 ms |            18.21 ms |
| Subject focus                      |           99.65 |             99.65 |   12.09 ms |            12.18 ms |
| Subject return                     |           97.34 |             97.34 |   12.08 ms |            12.26 ms |

These are measured variable capture rates during the listed action windows, not a claim of perfectly locked 60 fps. Some intervals exceed 16.7 ms. Static recall reveal delivered one frame and completion delivered four; sparse static updates and idle pauses are expected. Whole-video average or container metadata does not measure transition fluidity. Raw timestamps, action windows and cadence are retained in `.local/refinement-frame-timestamps.json` and `.local/refinement-capture-report.json`.

Subjective listening remains unverified: the available execution environment cannot perform a listening comparison. The actual audio was captured, decoded and level-checked for user playback, with the approved synth unchanged. Multi-hour usage, every keyboard path and actual multi-monitor DPI transitions remain outside this focused pass.

## Build artifacts

- Executable: `src-tauri/target/release/synapse.exe` — 13,817,344 bytes.
- Installer: `src-tauri/target/release/bundle/nsis/Synapse_0.3.1_x64-setup.exe` — 4,376,754 bytes.
- Executable SHA-256: `1eaae67392b0d078e37259e4fc117ca8ddbaab914c13c60832814d86631d9e68`.
- Installer SHA-256: `6ca63a5df5c2736d498cc5139be1c83a8ad4f26f634f9e5b28264e441ac6b0a8`.

Artifacts and synthetic evidence remain local and ignored by Git. GitHub remains private. Hosted CI status is checked against the delivered commit separately from local validation.
