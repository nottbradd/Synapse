# Startup and sound — 0.7.0

The startup is a silent, disposable presentation layer. It never unlocks audio, changes a note, invokes AI, moves a graph node or takes native focus. `useWorkspace.initialReady` distinguishes restoration from a genuine welcome screen; a slow restore continues normally after the intro gives up.

## Integration and timing

`src/startup/geometry.ts` batches viewport bounds and font reads, filters targets and segments Unicode graphemes. `overlay.tsx` renders six existing Lucide cursors and creates text through `textContent`. `controller.ts` owns one elapsed-time RAF, observers, cancellation and cleanup. `useStartup.ts` connects readiness, modal state and the existing effective motion preference. The optional graph marker covers the actual Canvas surface, with a construction rectangle clipped to its usable area; no DOM graph reconstruction or extra graph engine is involved.

The shared clock starts on the first eligible foreground frame. Preparation is capped at 230 ms, gathering takes 120 ms, construction finishes at 950 ms and exit at 1050 ms. A 1200 ms timer is the final deadline. Preparation, including overlay construction, is charged to that budget. CSS independently reveals affected regions within at most 1180 ms and hides the overlay by 1150 ms if the controller stops running. As with any browser timer, JavaScript cannot execute during a blocked renderer; the compositor fallback limits visual concealment independently.

Capturing pointer, keyboard, touch, wheel or meaningful focus events synchronously removes concealment without cancelling the event. Modal/editor precedence, unmount, backgrounding, resize, DPR, late fonts, actual application layout shifts and errors use the same cleanup path. Only the intro's attribute is restored; existing styles remain owned by the application. The overlay is `aria-hidden`, has no focus targets and uses `pointer-events: none`.

`src-tauri/src/startup.rs` creates a UUID and atomic one-use claim for the native process. Hidden/minimised/unfocused windows cannot consume a claim. Guarded session storage and a singleton provide additional frontend protection, including unavailable storage, HMR and Strict Mode. React 19's pre-animation mount probe can reattach without resetting the original clock or making another claim. Full animations override the OS reduction preference; Reduced and the new Startup animation checkbox skip the effect without replaying it later in the same launch.

## Marker inventory

Snapshot selection aims for 12 targets, never more than 15. It rejects hidden, offscreen, zero-size, sensitive and actively edited regions and overlapping ancestor/descendant targets.

| Location        | Markers                                                                                                                                   |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Sidebar         | Brand, collapse control, vault heading, search, new note, navigation, organization actions, footer; compact rail replaces expanded groups |
| Graph           | One Canvas surface (`graph`), overview heading (`text`), scope count and graph controls (`box`)                                           |
| Welcome         | Mark, Synapse heading (`text`), Open vault and Preferences buttons                                                                        |
| Existing drawer | Header and toolbar chrome only; editor/note bodies are never reconstructed                                                                |

Only short interface headings use the text effect. User topic titles use a box. The semantic heading stays intact beneath an inaccessible decorative copy.

## Production gain policy

The signal path is event level × material level × register gain × quiet-cue policy, followed by a tone envelope/filter or the short contact envelope/filter, then common stereo pan → compressor → soft limiter → master × saved user volume.

- Primary selection event: 0.8; selection material: 1.
- Arrival event: 0.35; arrival material: 0.8. The former extra 0.6 quiet attenuation is removed for arrivals. Dismissal/error cues retain their softer policy. Only three neighbours are scheduled; follow relays retain their 0.07 event level. Existing 60 ms identity gates, 80 ms stale rejection, six-voice budget and cancellation remain.
- Register gains: 0.39 / 0.38 / 0.36, with existing bounded 4% variation. Body durations remain 300 / 235 / 170 ms. Arrival bodies are capped at 100 ms. Static identity-derived pitches and ±1.5-cent repetition variation remain.
- Low-register partials: fundamental 1, second 0.3, third 0.15, fourth 0.012. Upper registers keep their restrained original partials.
- Original deterministic noise: one cached 8 ms buffer per context, band-pass centre 3200 Hz, Q 0.8, relative contact gain 0.12, 0.4 ms attack and zero by 3.5 ms. It shares voice level, panning and every output control. Only the tonal source ends the complete voice; ending the contact cannot disconnect the body.
- Compressor: −16 dB threshold, 4 dB knee, 3:1 ratio, 1 ms attack, 45 ms release. Tanh ceiling 0.32, master 0.75. The maximum-volume output bound remains 0.241 sample amplitude. Zero/mute immediately sets the output to zero and cancels active sources.
- New profiles default to 70%. Existing valid settings, including 69%, low values and zero, are read unchanged and are not rewritten on load. The schema remains v1; a missing `startupAnimation` means enabled.

## Measurements and audition

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

Run `node scripts/startup-validation.mjs` for browser lifecycle tests, including real React Strict Mode. `node scripts/audio-validation.mjs` renders production audio and writes metrics/WAV files; `--baseline` is for measuring the prior mix before editing, not for bypassing release checks. Then run `node scripts/audio-audition.mjs`.

Installed capture uses `scripts/record-startup.mjs` against a fresh process and a disposable vault. By default it starts the app hidden, begins compositor capture, and invokes the existing single-instance foreground path. `--visible` launches normally; `--existing` attaches to an already prepared fresh process. Windows must actually grant foreground focus before the effect can run. The completed recordings used the owner's Alt+Tab because the automation helper could not establish native foreground focus. The script records actual packaged UI, source timestamps, native version/focus, silence, cleanup and a same-process reload with no replay. A rejected foreground claim does not start the accepted timeline; footage uses the completed measurement's start time. Preparation requires a backup of device preferences and vault selection; restore them after testing. The debug port is a temporary testing environment variable and is never enabled by the installer. Native footage and machine-readable evidence remain under ignored `.local/`.
