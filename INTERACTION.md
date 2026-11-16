# Synapse interaction architecture

The refinement extends the Rust parser with read-only presentation metadata and exposes read-only scheduling previews. Existing note identities and flashcard schedules retain their semantics; versioned study metadata and package schema 2 add quizzes and reminders. Production interactions originate from successful app operations; there is no demo timeline, scripted pointer, synthetic note injection or prototype global state.

## Layout and Canvas

`GraphTopology` retains node objects and explicit drag pins by note identity. Its graph-data key contains only displayed identities, subject membership and actual edges. Updating a revision or title changes node metadata without replacing the graph-data object. Subject anchors are keyed by subject UUID, never display name. The simulation uses weak subject attraction alongside actual links, charge and local collision forces. Engine stop records settling only.

Changing scope over already settled nodes updates visibility without warm-up or force ticks. This preserves positions while the camera focuses the subject, avoiding post-transition drift. Actual new nodes or edges re-enable layout; an explicit node drag also re-enables the force engine without automatically pinning other nodes.

`LayoutMotion` represents a world anchor at the centre of the measured uncovered rectangle, log zoom and drawer width. Each layout intent sets one destination and one timestamp. The exact critically damped solution uses omega 16.5 rad/s (about 402 ms to 99% of a step), keeping position and velocity when retargeted. All graph-library camera calls have zero duration; there is no second transition. Before opening a drawer, the controller retains the overview frame. Scope changes retain frames per location. User panning adopts the library's current camera as the new frame.

`GraphScene` owns the animation clock, Canvas state and DOM transforms outside React state. The drawer's live ref is resolved on each animation frame: its sibling DOM node mounts after Graph's layout effect on the first selection, so retaining the earlier null would skip that first opening animation. ResizeObserver updates are deferred to the next animation frame. Active interactions resume the graph renderer; once physics, labels, rings and packets settle it pauses. A pointer movement wakes hit testing without generating audio. Reduced-motion changes snap the same controller destination and label offsets, retain static relationships, and skip packets and blooms.

Node body/core/rim and edge widths use CSS pixels, converted to world units by the current zoom. Hub size remains bounded. A bounded texture cache supplies compact node halos; broad subject light fields are removed. The separate light Canvas uses the same frame and DPR as geometry. Additive blending is confined to illumination and restored before foreground rendering. The geometry Canvas is clipped outside the uncovered area, while tight emission can continue behind glass. Global density attenuation bounds accumulated halos in large graphs; no full-frame blur or additional animation loop is used.

Navigation, reading, floating controls, menus and dialogs have separate tint/blur tokens. Background alpha leaves text and icons fully opaque. The `@supports` rule enables backdrop diffusion and saturation; otherwise surfaces use the solid material. The `opaque-materials` root class exercises that same fallback in desktop checks.

## Recall and interval previews

Rust's canonical extraction pass supplies every recognised occurrence and its UTF-16 range in the frontmatter-stripped Markdown body. Review still deduplicates by the original content hash. The remark transformer replaces only those source ranges and reparses surrounding fragments with the existing Markdown processor. A stable React section renderer retains reveal state on ordinary refreshes; note identity and card content determine resets. Rendering the answer omits presentation metadata, so Review and nested answer Markdown never create recursive recall blocks.

`preview_ratings` validates the active vault and indexed card, then reads validated history without scanning, migrating or writing the vault. Four calls to the existing scheduler share one captured timestamp. Commit uses the same history loader and scheduler through `rate_at`, retaining the due check and optimistic atomic write. The React hook discards stale asynchronous responses and refreshes only when the vault, card, relevant history or retry changes. TypeScript formats durations but contains no scheduling rules. Rating remains disabled until the answer and interval preview are available.

## Labels and signals

`TextMeasurements` waits for Geist and Manrope to load, includes the font string in cache keys and invalidates on font loading completion. Labels use constant 400-weight Geist at 14 CSS pixels. Canvas backing-store density is converted once per drawing pass.

`AnimatedLabels` stores node-relative offsets, angle, alpha and leader state. Destination-layout planning prioritises selected, hovered, searched and hub notes. A side change traverses an upper ellipse using `1 - exp(-dt / 0.09)`. Established placements use 12 px overlap, 30 px clearance to restore and 300 ms between changes. A newly prioritised label can choose a clear side for a shallower overlap, including one previously hidden at lower priority. Current-frame collision checks omit labels during an unsafe part of their path. Captions, notes, higher-priority labels and the uncovered bounds are obstacles. Leader lines appear after a 14 px departure from normal placement. Hidden labels update their radius targets too, so they cannot keep the renderer awake after zoom settles.

`SignalPacket` contains source, target, operation ID, start, duration, arrival and visual/audio properties. Planning uses actual scoped edges projected at the camera destination, at 560 CSS px/s. The plan is immutable while panning. Up to 12 packets and six quiet arrival reservations are admitted. Removed or invisible endpoints cancel their queued audio, as do replacement actions, scope changes and vault changes. Follow-link relay contact derives from the same packet duration. Arrival bloom lasts 120 ms. Selection rings use 150 ms in and 200 ms out; titles crossfade for 180 ms with 3 px movement.

## Tactile audio and lifecycle

`Feedback` accepts typed successful action events. It lazily creates one AudioContext following a trusted pointer or keyboard gesture. It maps performance-clock timestamps to the audio clock, drops feedback more than 80 ms stale and never uses an audio timer queue. Native focus and document focus are independent gates: document focus cannot override a native blur. Startup restores no audio context or backlog.

`TactileSynth` uses short noise bursts with broad 235/465/780 Hz body filters, a brief contact transient, a secondary contact and quiet nonharmonic 1567/2471 Hz metal. Close/error/forgot are darker; close is shorter. Subject UUIDs make small register changes within one sound family. A compressor feeds a soft limiter and conservative master gain. The default volume is 35%. No oscillator bass kick, ambient loop, network asset or sample download is required.

`VoiceBudget` reserves real intervals, caps overlapping contacts at six and applies a 60 ms identical-cue gate. Direct actions can evict quiet arrival detail. Future scheduling does not discard currently audible reservations. Finished, cancelled and muted voices stop and disconnect all sources; disposal releases listeners and closes the context. The actual rendering tests use OfflineAudioContext, while the capture harness records the final live AudioNode output to a MediaStreamDestination without accessing microphone or desktop audio.

Preferences use the versioned `synapse.preferences.v1` key in WebView local storage, separate from notes, subject archives and review history. Invalid stored values fall back for the session and are not rewritten until an explicit preference change. The optional `motion` field resolves `system`, `full` or `reduced` against the live system media query. Existing settings default to `system` without changing sound or volume. The resolved value drives every motion hook and the app's CSS motion attribute; an OS media rule cannot silently override an explicit Full choice.

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

## Curved currents and opening-note instrument

Canonical endpoint ordering gives a curve identical in either traversal direction. Projected curve length controls current duration (560 CSS px/s, bounded 80–1100 ms), with 18 ms stagger, a short 18 px tail, at most 12 visible packets and six audible arrivals. Selection, WikiLink following, successfully saved connections and review completion use actual snapshot edges only. Pending saved-connection events wait for their node to enter topology. Reduced motion suppresses packets and arrival cues while retaining selection state.

The shared event plan schedules receiving accents and sound against one clock. In 0.5.1, `note.ts` loads the exact approved Clean PCM16 stereo sample from an inlined asset when the one lazy AudioContext is created. It retains the sample's original level without normalizing. Each action plays one source with a fixed, subtly subject-dependent playback rate, a low-pass filter and a smooth short tail; there is no pitch envelope or decorative second note. Neighbour arrivals use much lower levels. Compression and the existing bounded master curve limit overlaps.

Six voice reservations, identical-event throttling, stale-event rejection and complete source cleanup bound every interaction. Native focus loss cancels queued audio and never replays it on refocus. `scripts/audio-validation.mjs` renders the actual production graph with OfflineAudioContext at 69% and maximum volume, checking overlap, clipping bounds, cancellation, silence and cleanup. `scripts/release-desktop.mjs` records the installed app's actual AudioContext output and compositor frames after verifying native focus; the microphone and reference audition are not used as a soundtrack.
