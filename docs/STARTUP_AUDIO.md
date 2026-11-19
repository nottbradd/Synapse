# Startup, foreground return and sound — 0.9.0

Startup and foreground return are silent, disposable presentation layers. Neither unlocks audio, edits a note, invokes AI, moves a graph node or takes native focus. The sound synthesis and gain staging from 0.7.0 are unchanged. `useWorkspace.initialReady` separates actual restoration from construction: the 250 ms preparation budget begins after the workspace is ready, and a slow restore retains the existing restoration screen.

## Integration and timing

The v3 opening uses the approved mark with open circular terminals. On a populated desktop, fourteen named crosshairs orbit on ellipses of different sizes, phases and signed speeds. The mark draws above them. Each agent leaves its orbit when its first job is ready. The planner uses each measured target and a seeded schedule to calculate travel, writing pauses and independent finishing times. Each crosshair shrinks at its last working position for 160 ms, with the name badge fading in the first third of that time.

The populated timeline starts with 900 ms of orbit. Construction ends at 4060 ms and the presentation ends at 4460 ms. Smaller layouts scale the crew and sparse layouts finish earlier. One 300 ms outline pulse follows construction in the existing subject colours. The JavaScript and CSS watchdogs release at 4900 ms. The separate pre-paint preparation budget is 250 ms. Hidden tray launch suspends preparation until foreground presentation. DOM focus and the native `synapse-window-shown` notification wake preparation. Rust checks native visibility and focus before granting the one-use launch claim. Late preparation reveals the interactive workspace.

Pointer, keyboard, touch, wheel, scroll and composition input synchronously remove startup concealment before the application handler, without cancelling or replaying the input. Modal/editor precedence, unmount, backgrounding, resize, DPR, late fonts, actual layout changes and errors use one idempotent cleanup path. Only owned attributes are restored. Overlays are `aria-hidden`, have no focus targets and use `pointer-events: none`. Temporary observers, RAF, timers, sprites and task collections are released; no animation loop runs at idle.

`src-tauri/src/startup.rs` creates a UUID and atomic one-use claim for the native process. Hidden/minimised/unfocused windows cannot consume a claim. Guarded session storage and a singleton provide additional protection, including unavailable storage and Strict Mode. Reloading, remounting or navigating cannot replay a consumed launch. Full overrides the OS reduction preference; Reduced bypasses both effects; Follow Windows uses the OS setting. Startup animation and Return animation are independent, default enabled when absent, and do not rewrite existing saved preferences on load.

## Real graph presentation

`GraphScene.presentation()` supplies settled projection, clipping, real node sprites, placed labels and connection curves. It examines up to 96 candidate nodes and 256 links, selecting up to six nodes and four edges for construction. The first node is boxed and its copies drag from that master. A writing agent types each selected visible graph label at its measured left edge using the live font, baseline and opacity. Connections begin at the source anchor, follow the pen to the destination and settle onto the live cubic curve. The closing outline follows each eligible visible diamond or junction within the candidate limit. The live graph takes over at the measured coordinates.

## Foreground return

`return.ts` has an independent lifecycle. After at least 500 ms away, it confirms foreground for 50 ms and respects a 1500 ms cooldown. `interaction/nativeFocus.ts` uses Tauri focus events as primary and rechecks native focus on DOM focus/blur/visibility transitions and native show notifications to cover missing WebView2 events. Stale asynchronous reads and duplicate notifications are discarded. Browser fixtures use a separate fallback.

The approximately 280 ms overlay traces a few chrome edges, sends up to three signals along actual graph connections and briefly emphasizes receiving cores. CSS and JavaScript cleanup deadlines are 400 ms. All workspace content stays visible; there are no cursors, typing, duplication or camera changes. Retained editor focus is allowed; actual typing, scrolling, pointer input or IME composition takes precedence.

`dialogs.ts` wraps native open/save calls with `withNativeDialog`. A depth counter suppresses the entire operation through success, cancellation or error, plus a bounded 1200 ms tail for late focus restoration. Blocking app modals and the permission-bearing reminder test are also suppressed. No permanent suppression or idle polling is used.

## Marker inventory

Snapshot selection examines at most 64 markers and chooses at most 20 UI targets. It rejects hidden, offscreen, clipped scrolling rows, zero-size, sensitive and actively edited regions and overlapping opacity targets. The sidebar surface affects its background only, so separately assembled children are never double-hidden.

| Location        | Markers                                                                                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sidebar         | Surface, separate brand icon and text, collapse control, vault heading, search, new note, individual navigation rows, actions and footer; compact rail uses fewer targets |
| Graph           | Bounded actual node/edge sample from GraphScene; visible scope heading and count (`text`), empty message and controls (`box`)                                               |
| Welcome         | Mark, Synapse heading (`text`), Open vault and Preferences buttons                                                                                                        |
| Existing drawer | Header and toolbar chrome only; editor/note bodies are never reconstructed                                                                                                |

UI lettering uses the visible text range, measured glyph advances and complete Unicode graphemes. Explicit label markers identify eligible navigation captions. Empty search fields supply their placeholders. Typed previews use the decorative canvas and leave accessible text and editor contents intact. Clipped and overflowing UI captions use their live element at handover.

## Production gain policy

The signal path is event level × material level × register gain × quiet-cue policy, followed by a tone envelope/filter or the short contact envelope/filter, then common stereo pan → compressor → soft limiter → master × saved user volume.

- Primary selection event: 0.8; selection material: 1.
- Arrival event: 0.35; arrival material: 0.8. The former extra 0.6 quiet attenuation is removed for arrivals. Dismissal/error cues retain their softer policy. Only three neighbours are scheduled; follow relays retain their 0.07 event level. Existing 60 ms identity gates, 80 ms stale rejection, six-voice budget and cancellation remain.
- Register gains: 0.39 / 0.38 / 0.36, with existing bounded 4% variation. Body durations remain 300 / 235 / 170 ms. Arrival bodies are capped at 100 ms. Static identity-derived pitches and ±1.5-cent repetition variation remain.
- Low-register partials: fundamental 1, second 0.3, third 0.15, fourth 0.012. Upper registers keep their restrained original partials.
- Original deterministic noise: one cached 8 ms buffer per context, band-pass centre 3200 Hz, Q 0.8, relative contact gain 0.12, 0.4 ms attack and zero by 3.5 ms. It shares voice level, panning and every output control. Only the tonal source ends the complete voice; ending the contact cannot disconnect the body.
- Compressor: −16 dB threshold, 4 dB knee, 3:1 ratio, 1 ms attack, 45 ms release. Tanh ceiling 0.32, master 0.75. The maximum-volume output bound remains 0.241 sample amplitude. Zero/mute immediately sets the output to zero and cancels active sources.
- New profiles default to 70%. Existing valid settings, including 69%, low values and zero, are read unchanged and are not rewritten on load. The schema remains v1; missing startup/return toggles mean enabled.

## 0.7.0 measurements and audition (unchanged synthesis)

The reference node is `preferences-preview`, using actual shared production event levels, centre pan, 48 kHz stereo OfflineAudioContext and the complete output bus. Both columns use 70% so the comparison does not conflate the new-profile default with synthesis changes.

| Cue                               | Before peak / active RMS, dBFS | After peak / active RMS, dBFS | After 20 dB decay |
| --------------------------------- | ------------------------------ | ----------------------------- | ----------------- |
| Subnetwork select                 | −20.36 / −30.15                | −17.98 / −28.02               | 170 ms            |
| Topic select                      | −22.13 / −32.39                | −19.07 / −28.91               | 125 ms            |
| Concept select                    | −25.00 / −35.55                | −19.47 / −29.49               | 95 ms             |
| Concept arrival (production role) | −53.03 / −61.77                | −26.18 / −34.78               | 90 ms             |

Active RMS uses the contiguous non-silent window above 1e−6, measured in one of the identical centre-pan channels. Decay uses 5 ms peak blocks. FFT bands are 0–500 / 500–2000 / 2000–6000 / 6000–24000 Hz. The subnetwork's 500–2000 Hz energy rises from 0.405% to 8.47%, while 91.52% remains below 500 Hz. The report includes all bands for every reference cue. These digital measurements are not a laptop-speaker frequency-response measurement.

Accepted fixed-reference floors are −20 dBFS peak for selection and −40 dBFS for individual arrivals at 70%; low user volume is deliberately exempt. Individual arrivals must stay below 70% of the corresponding selection peak, and a worst-case three-neighbour overlap below 120%. Floors were preserved when initial tuning failed. The owner listened to the matched comparison on 16 November 2026 and rated the static cues **“Clear and comfortable.”**

The audition-only 25-cent rise reaches normal pitch in 12 ms. It is injected by the test renderer and matched to each static cue's active RMS; there is no production glide setting or second musical note. `scripts/audio-audition.mjs` assembles static-then-glide pairs in subnetwork/topic/concept order, plus same-volume before/after selection/arrival examples.

## Reproduce

Run `node scripts/startup-validation.mjs` for browser lifecycle tests using the production GraphScene and both controllers, including real React Strict Mode, a 300-node scope and missing-native-focus/show regressions. A single case can be selected as the first argument and writes a separate report. Reports use the current package version. `npm test` includes native-focus reconciliation/race tests and saved-preference migration. Audio validation scripts remain available for sound changes; the historical measurements above are from the 0.7.0 audition.

For passive installed capture, first close Synapse and prepare a disposable selected vault with the original state backed up. Set `SYNAPSE_NATIVE_EVIDENCE` to a new private evidence directory; otherwise the helpers use `.local/native-acceptance-<version>`. Run `node scripts/native-startup.mjs visible cold-final` for a new normal launch or `node scripts/native-startup.mjs tray tray-final` for a hidden launch. The latter requires background operation to be enabled and a genuine native show action after capture is armed. Windows must actually grant foreground focus. The helper observes native state, startup marks, cleanup and compositor timestamps; a completed helper is not itself an acceptance assertion. Inspect the report and first captured timestamp before claiming complete footage.

With the diagnostic session still available, `node scripts/native-observe.mjs record return-final` arms compositor capture for an actual operating-system Alt-Tab cycle. The `start <case>` and `stop <case>` commands collect passive before/after state and native event traces for dialogs, preferences and CodeMirror. They record actual editor text, selection and scroll, so use synthetic content only. The probe keeps a bounded recent frame history and stops any previous probe before starting another. All native CDP connections use `noDefaults: true`: Playwright's default focus emulation would make native focus observations invalid. CDP does not supply the input or call the animation controllers in these helpers.

Set `FFMPEG` to the existing FFmpeg executable and run `node scripts/encode-native.mjs` to encode the three named captures. The encoder requires a captured frame before the measured animation starts, preserves source timestamps in MP4, checks encoded timing and silence, and produces 25 fps GIF review copies plus decoded inspection frames. The older `record-startup.mjs` and `record-return.mjs` helpers remain available, but the passive helpers above record native evidence.

Back up device files, the selected vault and exact preference storage before native testing, and restore them afterward. The temporary debugging port is never enabled by the app or installer. Capture frames and machine-readable reports remain under ignored `.local/`. See `VALIDATION.md` for actual completed checks and any native capture limitations; the existence of a recording script is not evidence that a recording succeeded.
