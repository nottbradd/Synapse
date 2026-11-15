# Synapse interaction architecture

The frontend refinement does not change the Rust storage, migration, transfer or scheduling semantics. Production interactions originate from successful app operations; there is no demo timeline, scripted pointer, synthetic note injection or prototype global state.

## Layout and Canvas

`GraphTopology` retains node objects and explicit drag pins by note identity. Its graph-data key contains only displayed identities, subject membership and actual edges. Updating a revision or title changes node metadata without replacing the graph-data object. Subject anchors are keyed by subject UUID, never display name. The simulation uses weak subject attraction alongside actual links, charge and local collision forces. Engine stop records settling only.

`LayoutMotion` represents a world anchor at the centre of the measured uncovered rectangle, log zoom and drawer width. Each layout intent sets one destination and one timestamp. The exact critically damped solution uses omega 20 rad/s, keeping position and velocity when retargeted. All graph-library camera calls have zero duration; there is no second transition. Before opening a drawer, the controller retains the overview frame. Scope changes retain frames per location. User panning adopts the library's current camera as the new frame.

`GraphScene` owns the animation clock, Canvas state and DOM transforms outside React state. ResizeObserver updates are deferred to the next animation frame. Active interactions resume the graph renderer; once physics, labels, rings and packets settle it pauses. A pointer movement wakes hit testing without generating audio. Reduced-motion changes snap the same controller destination and label offsets, retain static relationships, and skip packets and blooms.

## Labels and signals

`TextMeasurements` waits for Geist and Manrope to load, includes the font string in cache keys and invalidates on font loading completion. Labels use constant 400-weight Geist at 14 CSS pixels. Canvas backing-store density is converted once per drawing pass.

`AnimatedLabels` stores node-relative offsets, angle, alpha and leader state. Destination-layout planning prioritises selected, hovered, searched and hub notes. A side change traverses an upper ellipse using `1 - exp(-dt / 0.09)`. Established placements use 12 px overlap, 30 px clearance to restore and 300 ms between changes. A newly prioritised label can choose a clear side for a shallower overlap, including one previously hidden at lower priority. Current-frame collision checks omit labels during an unsafe part of their path. Captions, notes, higher-priority labels and the uncovered bounds are obstacles. Leader lines appear after a 14 px departure from normal placement. Hidden labels update their radius targets too, so they cannot keep the renderer awake after zoom settles.

`SignalPacket` contains source, target, operation ID, start, duration, arrival and visual/audio properties. Planning uses actual scoped edges projected at the camera destination, at 180 CSS px/s. The plan is immutable while panning. Up to 12 packets and six quiet arrival reservations are admitted. Removed or invisible endpoints cancel their queued audio, as do replacement actions, scope changes and vault changes. Follow-link relay contact derives from the same packet duration. Arrival bloom lasts 120 ms. Selection rings use 150 ms in and 200 ms out; titles crossfade for 180 ms with 3 px movement.

## Tactile audio and lifecycle

`Feedback` accepts typed successful action events. It lazily creates one AudioContext following a trusted pointer or keyboard gesture. It maps performance-clock timestamps to the audio clock, drops feedback more than 80 ms stale and never uses an audio timer queue. Native focus and document focus are independent gates: document focus cannot override a native blur. Startup restores no audio context or backlog.

`TactileSynth` uses short noise bursts with broad 250/440/790 Hz body filters, a brief contact transient, a secondary contact and quiet nonharmonic 1477/2213 Hz metal. Close/error/forgot are darker; close is shorter. Subject UUIDs make small register changes within one sound family. A compressor feeds a soft limiter and conservative master gain. The default volume is 35%. No oscillator bass kick, ambient loop, network asset or sample download is required.

`VoiceBudget` reserves real intervals, caps overlapping contacts at six and applies a 60 ms identical-cue gate. Direct actions can evict quiet arrival detail. Future scheduling does not discard currently audible reservations. Finished, cancelled and muted voices stop and disconnect all sources; disposal releases listeners and closes the context. The actual rendering tests use OfflineAudioContext, while the capture harness records the final live AudioNode output to a MediaStreamDestination without accessing microphone or desktop audio.

Preferences use the versioned `synapse.preferences.v1` key in WebView local storage, separate from notes, subject archives and review history. Invalid stored values fall back for the session and are not rewritten until an explicit preference change.

## Reproducing desktop checks

Launch the built executable with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` in a disposable testing session. This flag is never set by the app or installer. The development app also needs Vite on port 1420. Use `SYNAPSE_QA_BASE` under the Windows temporary directory for fixtures.

- `scripts/update-desktop.mjs`: creation, duplicate subjects, dense/custom subjects, edit guards, disk conflicts, math and scoped reviews.
- `scripts/transfer-desktop.mjs`: real Rust transfer flow with only native chooser responses substituted; use the development app after the update harness.
- `scripts/interaction-desktop.mjs`: development-only instrumentation of the real scene; camera centring, reversal, idle pause, body edits, runtime reduced motion, forced pinned-camera flips, actual audio rendering/cleanup and preference reload.
- `scripts/release-verify.mjs`: packaged app, offline reload/edit/review, missing WikiLinks, window close guard, exact stable Canvas comparison, density emulation and fallback/empty states.
- `scripts/capture-desktop.mjs --setup`: creates a separately identified synthetic capture vault in the temporary directory. Run without `--setup` against a focused packaged app to capture actual user actions, screenshots and the live sound stream. It writes timestamped frames, an FFmpeg concat input and WebM audio under ignored `.local/` for MP4 muxing.

The capture harness is a testing tool, not part of the application bundle. It never uses the approved prototype video as evidence of production behavior. Subjective listening and actual multi-monitor Windows DPI transitions require a human/hardware pass; density emulation is recorded separately in the validation report.
