# Synapse interaction architecture

The refinement extends the Rust parser with read-only presentation metadata and exposes read-only scheduling previews. Existing note identities and flashcard schedules retain their semantics; versioned study metadata and package schema 2 add quizzes and reminders. Production interactions originate from successful app operations; there is no demo timeline, scripted pointer, synthetic note injection or prototype global state.

## Nested graph and coordinated motion

The production Canvas graph now uses an explicit presentation-only Exploration model. Overview junctions are keyed by actual subject UUIDs; their cross-subject edges aggregate actual note relationships. Subject views contain actual members. Topic views contain one canonical note and its one-hop undirected WikiLink neighbours, including cross-subject links. A note remains owned by its subject, never by another note. Duplicate subject names include their Neuron name in the overview.

GraphTopology retains canonical SceneNode objects and uses stable concentric layouts; placement does not assert new relationships. NetworkMotion interpolates x/y, opacity and connection extension on the same clock as LayoutMotion. Retargeting keeps spring velocities. Exact critically damped motion (omega 16.5) reaches about 99% in 400 ms; log zoom, the measured uncovered rectangle and drawer width share one destination. No delayed force-settle recenter runs in these views.

The bounded 64-entry history captures scope, selected note, current camera frame, layout, editor width/mode and study drawer state before successful navigation. Back restores that frame and layout; removed identities are pruned and invalid scopes recover to a surviving prior scope. Closing a note changes drawer occlusion without leaving the network. Sidebar organization and review queues remain separate. Note loads use a serial guard, so superseded asynchronous results cannot replace the latest choice. Dirty-note guards run before changing scope. Wheel movement changes the camera only, with no depth thresholds or audio triggers.

The renderer's cached picking surface is throttled by its upstream library. Click callbacks resolve against current projected node positions, including background/link callbacks, preserving its drag suppression without waiting for stale colour picking. Search and the accessible Browse menu retain access to hidden labels and dense networks. Selected/hovered labels take precedence; small sparse networks expose more labels, and collision placement hides unsafe ones.

GraphScene owns the frame clock, Canvas state and DOM transforms outside React state. It resolves the drawer's live ref each frame. Idle rendering stops once camera, layout, labels, rings and signals settle. Reduced mode snaps the same logical destinations and omits moving packets. Node cores, rims, edge widths and labels stay in CSS pixels; compact halos and bounded light density preserve the matte 2D presentation.

## Recall and interval previews

Rust's canonical extraction pass supplies every recognised occurrence and its UTF-16 range in the frontmatter-stripped Markdown body. Review still deduplicates by the original content hash. The remark transformer replaces only those source ranges and reparses surrounding fragments with the existing Markdown processor. A stable React section renderer retains reveal state on ordinary refreshes; note identity and card content determine resets. Rendering the answer omits presentation metadata, so Review and nested answer Markdown never create recursive recall blocks.

`preview_ratings` validates the active vault and indexed card, then reads validated history without scanning, migrating or writing the vault. Four calls to the existing scheduler share one captured timestamp. Commit uses the same history loader and scheduler through `rate_at`, retaining the due check and optimistic atomic write. The React hook discards stale asynchronous responses and refreshes only when the vault, card, relevant history or retry changes. TypeScript formats durations but contains no scheduling rules. Rating remains disabled until the answer and interval preview are available.

## Labels and signals

`TextMeasurements` waits for Geist and Manrope to load, includes the font string in cache keys and invalidates on font loading completion. Labels use constant 400-weight Geist at 14 CSS pixels. Canvas backing-store density is converted once per drawing pass.

`AnimatedLabels` stores node-relative offsets, angle, alpha and leader state. Destination-layout planning prioritises selected, hovered, searched and hub notes. A side change traverses an upper ellipse using `1 - exp(-dt / 0.09)`. Established placements use 12 px overlap, 30 px clearance to restore and 300 ms between changes. A newly prioritised label can choose a clear side for a shallower overlap, including one previously hidden at lower priority. Current-frame collision checks omit labels during an unsafe part of their path. Captions, notes, higher-priority labels and the uncovered bounds are obstacles. Leader lines appear after a 14 px departure from normal placement. Hidden labels update their radius targets too, so they cannot keep the renderer awake after zoom settles.

`SignalPacket` contains source, target, operation ID, start, duration, arrival and visual/audio properties. Planning uses actual scoped edges projected at the camera destination, at 560 CSS px/s. The plan is immutable while panning. Up to 12 packets and six quiet arrival reservations are admitted. Removed or invisible endpoints cancel their queued audio, as do replacement actions, scope changes and vault changes. Follow-link relay contact derives from the same packet duration. Arrival bloom lasts 120 ms. Selection rings use 150 ms in and 200 ms out; titles crossfade for 180 ms with 3 px movement.

## Audio lifecycle and preferences

Version 0.7 adds the independent, silent cursor startup controller and calibrates the complete sound output path. See [startup integration, marker inventory, gain staging and measurements](docs/STARTUP_AUDIO.md). The process-lifetime Rust claim prevents frontend reloads from replaying the intro; readiness, effective motion and first-interaction cleanup are separate from graph navigation.

Feedback accepts successful typed interactions with semantic role, bounded focus level and canonical identity. It lazily creates one AudioContext after a trusted gesture. Performance timestamps map to the audio clock; events over 80 ms stale are dropped. Native focus and document focus independently gate audio. Typing, hover and startup never sound.

NoteSynth creates original additive sine voices; note.ts centralizes the consonant pitch family and identity mapping. Subnetworks use C4/D4/E4/G4 with a 300 ms warm body; topics use C5/D5/E5/G5 with a 235 ms body; concepts use C6/D6/E6 with a 170 ms lighter body. Repetition varies detune within ±1.5 cents, attack 2.5–4 ms and level by at most 4%, without changing the fundamental pitch choice. Higher registers have lower gain. A cached, original band-passed noise contact ends after its 3.5 ms envelope without ending the tone. Back/close use short quiet envelopes; only three subordinate neighbour arrivals are scheduled from shared signal timestamps.

VoiceBudget reserves real intervals, caps overlap at six and applies a 60 ms identical-contact gate. Direct actions may evict low-priority arrivals. Every oscillator, gain, filter and panner disconnects after completion or cancellation. Native blur cancels queued audio, with no replay on refocus. A compressor feeds a soft limiter and conservative master. OfflineAudioContext renders the real production graph for clipping/polyphony/cancellation tests; actual application captures tap the live output without a microphone.

Preferences use the versioned synapse.preferences.v1 WebView local-storage key, separate from vault and review data. Invalid values fall back without being rewritten until an explicit change. Motion resolves system/full/reduced against the current Windows preference; explicit Full cannot be overridden by an OS CSS media rule. Existing user settings survive this release.

## Reproducing desktop checks

Launch the built executable with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` in a disposable testing session. This flag is never set by the app or installer. The development app also needs Vite on port 1420. Use `SYNAPSE_QA_BASE` under the Windows temporary directory for fixtures.

- `scripts/update-desktop.mjs`: creation, duplicate subjects, dense/custom subjects, edit guards, disk conflicts, math and scoped reviews.
- `scripts/transfer-desktop.mjs`: real Rust transfer flow with only native chooser responses substituted; use the development app after the update harness.
- `scripts/interaction-desktop.mjs`: development-only instrumentation of the real scene; camera centring, reversal, idle pause, body edits, runtime reduced motion, forced pinned-camera flips, actual audio rendering/cleanup and preference reload.
- `scripts/release-verify.mjs`: packaged app, offline reload/edit/review, missing WikiLinks, window close guard, exact stable Canvas comparison, density emulation and fallback/empty states.
- `scripts/refinement-desktop.mjs before|after`: eight comparable views using persisted fixture identities and matched viewport settings.
- `scripts/recall-desktop.mjs`: real parser and scheduler integration, keyboard reveal, Markdown/WikiLink/KaTeX answers, reset/preservation behaviour, read-only history, history refresh and repeated rating protection in a disposable vault.
- `scripts/motion-desktop.mjs`: installed-app motion preferences using the real Windows media query first, then explicit runtime system-change cases. Measures intermediate drawer positions, CSS overrides and reload persistence in a disposable vault.
- `scripts/label-drag-desktop.mjs`: real pointer drag causing a right-to-left label transition with an unchanged camera; development instrumentation reads state without changing placement constraints.
- `scripts/capture-refinement.mjs --prepare`, then without the flag: 0.3.1 packaged footage using every delivered compositor frame, original frame timestamps, transition cadence reporting, recall reveal, real label drag, review grading and the app's live audio. Native focus must be established first. FFmpeg muxing retains variable frame timing and does not interpolate motion.
- `scripts/capture-desktop.mjs --setup`: creates a separately identified synthetic capture vault in the temporary directory. Run without `--setup` against a focused packaged app to capture actual user actions, screenshots and the live sound stream. It writes timestamped frames, an FFmpeg concat input and WebM audio under ignored `.local/` for MP4 muxing.

The capture harness is a testing tool, not part of the application bundle. It never uses the approved prototype video as evidence of production behavior. Subjective listening and actual multi-monitor Windows DPI transitions require a human/hardware pass; density emulation is recorded separately in the validation report.

The refinement capture also compares consecutive source-image hashes, so its report distinguishes delivered frames from changed frames. After capture, set `$ffmpegPath` to an available FFmpeg executable and mux without synthesising frames:

```powershell
& $ffmpegPath -y -f concat -safe 0 -i .local/refinement-capture.ffconcat -i .local/Synapse-0.3.1-audio.webm -map 0:v:0 -map 1:a:0 -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -fps_mode vfr -enc_time_base 1:1000 -x264-params fps=120/1:force-cfr=0 -level:v 5.2 -video_track_timescale 1000000 -c:a aac -b:a 160k -movflags +faststart -shortest .local/Synapse-0.3.1-demo.mp4
```

The encoder rate hint does not establish captured cadence. Use the source timestamp report, and verify decoded frame count/timing and audio separately. The source timestamps remain the timing authority; compare the encoded file before claiming a cadence or timing bound.

## Study creation and device boundaries

`StudyPanel` owns a scope-bound editable draft. The context command freezes selected note identities, bodies and revisions and returns the exact source preview. Requests are keyed by unique UUID, vault and scope. Rust cancellation tokens remain registered through validation and draft publication; navigation, cancellation and changed source revisions reject stale responses. Completed saves release draft origins, and receipts make retried publication idempotent. No generated draft changes topology until the canonical save and refreshed snapshot succeed.

`ai.rs` has a fixed HTTPS Responses endpoint, no redirects, bounded response reads, strict schema validation before Serde/domain validation, and no tools. `device.rs` owns Windows Credential Manager access and device-local settings. A key is only transiently entered through the UI and is never retrievable by frontend IPC. Network output and error handling do not log source bodies or credentials. The CSP is unchanged.

Quiz marking, card publication and scheduling are local Rust operations. The scheduler's delivery claim is persisted before showing a native notification, bounding duplicates across restart and clock changes. The timer checks registered local vaults without needing the active UI scope. Catch-up state remains visible if a toast cannot be shown. Startup and close-to-tray are explicit user preferences, with full Quit stopping delivery.

## Current release verification

scripts/depth-desktop.mjs inspects the real development WebView with temporary synthetic files, real Rust commands and development-only instrumentation. It tests direct Canvas navigation, exact Back framing/layout, dirty edits, interrupted note loads, Reduced mode, deleted focus, small windows, 90 additional backlinks, duplicate subject UUIDs and idle rendering. No provider requests or production test globals are used. scripts/audio-validation.mjs renders all three real synthesized registers at 35%, 69%, 70%, 100% and zero volume, including mute, arrival balance and source/node cleanup. scripts/startup-validation.mjs covers the shared startup controller's lifecycle; scripts/record-startup.mjs records fresh installed launches, and scripts/swarm-release.mjs verifies the packaged settings, nested navigation and live sound. Installed-app capture and release results are documented in VALIDATION.md.
