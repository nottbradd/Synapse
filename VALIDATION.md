# Synapse validation

## 0.8.0 — 17 November 2026

Swarm Rebuild and the separate foreground-return effect are implemented, built and installed locally. **Native recording acceptance remains incomplete.** The supplied 0.8.0 GIF/MP4 previews are browser fixtures using the production controllers and GraphScene; they are not a new native process or a genuine Alt-Tab recording. No GitHub release was published.

| Check                                            | Result                                                                     |
| ------------------------------------------------ | -------------------------------------------------------------------------- |
| TypeScript typecheck and ESLint                  | Passed                                                                     |
| Frontend tests                                   | 77 passed, including native-focus reconciliation and stale-query cleanup   |
| Rust tests                                       | 47 passed; one explicit live-provider test ignored                         |
| Rustfmt and Clippy, all targets, warnings denied | Passed                                                                     |
| Browser lifecycle checks                         | 56 passed on the final source                                              |
| Production build                                 | Passed; unsigned x64 NSIS package built with the existing public AI origin |
| Installed executable and notices                 | Match the extracted installer payload byte-for-byte                        |
| Genuine native startup and Alt-Tab recordings    | Not completed; see the native limitation below                             |

The final browser suite measured **3504.8 ms** for the populated startup and **281.6 ms** for the standard return. Startup used nine agents, 18 UI targets, five actual nodes and four actual edges. The 300-node subnetwork fixture bounded its construction sample to six nodes and four edges. Checks cover dependency ordering, different entrances/durations/exits, matching graph handover positions, no completed-UI-then-hide flash, and no graph-sized selection box. A frozen-controller check confirms that the old short CSS deadline does not reveal content at 1300 ms and that independent fallbacks reveal it by 3900 ms.

The suite also covers welcome/empty views, collapsed navigation, open drawers, 900×600 and 1920×1080 windows, emulated 100%/150%/200% DPR, Full/Reduced/Follow Windows, both animation toggles, slow restoration/fonts, late eligibility, storage failure, exceptions, Strict Mode, unmount, layout/font/DPR changes, first input and tray-style delayed presentation. Return checks verify one effect per qualifying simulated focus cycle, bounce/chatter/cooldown filtering, success/error dialog suppression with late focus restoration, no startup overlap, zero new AudioContexts, complete timer/RAF/overlay cleanup, and preserved graph state, unsaved textarea content, selection and scroll. Actual native CodeMirror and file-picker return checks remain outstanding.

During the installed test, native `is_focused` and DOM focus were both true while no Tauri window-focus event had reached the controller; the hidden startup gate remained pending. The final source adds event-driven native focus rechecks on DOM transitions and lets DOM focus wake preparation while retaining the Rust claim as authority. It also discards a stale hidden-window reply arriving after foreground. Both regressions now pass in browser/unit tests. **The corrected focus path has not yet been reverified in an installed foreground session.** Windows Computer Use stopped because it could not determine the other browser window's URL confidently enough to enforce its policy, so desktop input ended. The incomplete native frames are not presented as a successful recording.

The browser review clips were separately recorded at normal speed: startup **3502.3 ms**, return **283.8 ms**. The MP4s preserve original compositor timestamps within **0.5 ms**, contain no audio streams and include a short final hold. GIFs are 25 fps review copies and loop for review only. Construction, intermediate and final frames were visually inspected. These recordings are `.local/release-0.8.0/Synapse-0.8.0-browser-{startup,return}.{mp4,gif}`; reproduce them with `node scripts/record-swarm-preview.mjs`. The return preview uses a simulated focus lifecycle, not Alt-Tab.

All runtime data came from a disposable synthetic vault. The original `device.json` and `last-vault.json` were restored byte-for-byte and checked again after installation. The exact existing preference record was never written during runtime testing (Full motion, sound enabled, 69% volume); reading missing animation toggles does not migrate storage. Personal AI selection, consent and funding were preserved. No provider calls or new audio tuning occurred. The testing process and debugging port are closed; Synapse was also closed before the runtime checks began.

Installer: `src-tauri/target/release/bundle/nsis/Synapse_0.8.0_x64-setup.exe`.
SHA-256: `6748b3130827b95acb5e33128704fa46e6cdc4b2deaf5eafcdd1feede8e14dcc`.
Installed executable SHA-256: `9bee2a490173990dc4f3aa41f207a00d62165ab33d3987858aab50725240d6c2`.
GPL v3, copyright and third-party notices match the installer resources.

Machine-readable evidence is local and ignored by Git: `.local/swarm-0.8.0/browser-report.json` (56 cases), `.local/release-0.8.0/package-verification.json`, `restored-owner-state.json`, both `browser-*/report.json` files and `preview-media-validation.json`. A resource-contended intermediate browser run correctly skipped preparation at its deadline; normal-motion fixtures now explicitly preload their fonts, while separate slow-font/deadline cases retain the failure-path checks. Windows 10, physical monitor/DPI changes and the final native foreground captures remain unverified. The installer remains unsigned. Historical 0.7.0 audio and native results below are not claimed as new 0.8.0 verification.

## 0.7.0 — 16 November 2026

The installed production build adds the silent cursor-swarm startup and calibrates the original static chimes. All new desktop checks used temporary synthetic vaults. There were no live OpenAI requests, hosted-policy edits, repository visibility changes or new dependencies. The original vault selection, Personal AI selection, consent state, device settings and exact saved preference record (Full animations and 69% volume) were restored. The installed app was restarted normally without a debugging port.

| Check                                                    | Result                                                |
| -------------------------------------------------------- | ----------------------------------------------------- |
| TypeScript typecheck and ESLint                          | Passed                                                |
| Frontend tests                                           | 75 passed                                             |
| Rust tests                                               | 47 passed; one explicit live-provider test ignored    |
| Rust formatting and Clippy, all targets, warnings denied | Passed                                                |
| Hosted gateway                                           | 22 local D1 tests passed with a mocked provider       |
| Startup lifecycle in Chromium                            | 27 cases passed                                       |
| Production audio graph                                   | 150 OfflineAudioContext cases passed                  |
| Production build and NSIS installation                   | Passed; installed payload hash verified               |
| Installed startup, nested navigation, settings and sound | Passed; real WebView footage and live output captured |

Startup coverage includes Full, Reduced, Follow Windows, the independent checkbox, slow restoration and fonts, pointer/keyboard/touch/wheel/focus interruption, resize, DPR, late fonts/layout, modal/editor precedence, unmount, real React Strict Mode, background/hidden launch, native focus without a DOM focus event, once-per-launch, unavailable storage, induced failure and the CSS safety reveal. First-interaction handlers observed zero hidden regions and zero overlays without event prevention or replay. The fallback test deliberately stopped JavaScript cleanup and verified compositor visibility; a blocked renderer cannot execute a JavaScript deadline.

The fresh installed launch with a restored vault selected 12 actual UI targets and completed in **1054.9 ms** from its accepted first foreground frame. The genuine no-vault welcome selected three eligible targets and completed in **1054.8 ms**. Both created zero AudioContexts, removed all hidden attributes/overlays and declined a replay after frontend reload. Actual native focus was established by the owner's Alt+Tab. The clips preserve original compositor timing, with a short hold of the final unchanged frame; no motion frames are interpolated. The GIF is a smaller 25 fps review copy. The measured times include preparation and remain below the 1200 ms deadline.

The full audio matrix covers subnetwork/topic/concept at 35%, 69%, 70%, 100% and zero volume, including selection, individual arrival, three neighbours, dense overlap, cancellation before and during playback, mute, stale events, disposal and gating. The reference floors at 70% remain −20 dBFS peak for selection and −40 dBFS for individual arrivals. Individual arrivals stay below 70% of corresponding selection peaks and three simultaneous neighbours below 120%. The highest sample peak across all cases was **0.235457**, below the 0.241 bound. Samples were finite, silent cases were zero, tails cleared, reservations/voices ended, every instrumented node connection was released on disposal and one contact-noise buffer was cached per context. The contact's completion did not truncate the tonal body.

[Startup integration, marker inventory and before/after audio measurements](docs/STARTUP_AUDIO.md) document the production path, active-window RMS, decay and spectrum. The static/glide comparison is matched by active-window RMS, within 0.000001 dB for the reference files. The owner rated the static cues **“Clear and comfortable.”** Static pitch remains the production default; the 12 ms / 25-cent glide exists only in the audition renderer. Speaker frequency response was not measured.

Installed regression checks covered overview → subnetwork → topic → linked concepts and Back, saved volume, startup checkbox persistence, explicit Full overriding emulated OS reduction, Follow Windows respecting it, and reload without startup replay. Every settled Back canvas at the established 1600×1000 test viewport matched exactly. An additional native 1440×900 comparison differed at 36 of 1,296,000 pixels by at most one 8-bit channel step; this is a recorded rendering tolerance, not an exact-image pass at that viewport. No renderer errors occurred.

The 12.82-second sound video uses the real app's output at 69% volume and 660 delivered compositor frames plus a final held-frame timestamp. All eight primary cues are present in the source and muxed audio. Their threshold onsets are 24–86 ms after the harness's pre-click markers; those markers precede Playwright's click dispatch, so this is not an input-latency measurement. Encoding preserves frame timestamps within 0.819 ms; source and muxed cue onsets match at the 5 ms analysis resolution. Actual capture cadence during the transitions was approximately 82–96 fps on this host, not a hardware-independent guarantee.

The unsigned NSIS installer SHA-256 is `caaacb2d5b60e077265c384ec45372762b2da18b4cc0e1f669a4b13ed6f80f8d`. Its installed executable SHA-256 is `0e8c7f33bbcc177a58254a374794860a77963a88a5439c3a3bd6754868d3f548`, matching the extracted installer payload. GPL v3, copyright and complete third-party notices are installed. This update is built and installed locally; it does not publish a new GitHub release.

Local evidence is excluded from Git: `.local/startup-0.7.0/browser-report.json`, `.local/sound-0.7.0/{before,after}/mix-report.json`, the matched comparison WAVs, `.local/release-0.7.0/{startup-cold,startup-welcome}/report.json`, installed regression/restoration reports, media validation and the actual MP4/GIF/WAV files. The tested host is Windows 11 Pro 10.0.26300. Windows 10 and physical multi-monitor DPI switching remain untested; DPR and OS motion changes were exercised through controlled browser emulation. The installer remains unsigned.

## 0.6.0 — previous release

Validation uses temporary synthetic vaults. No new live provider generation is performed for this release. The existing hosted service and Calendar remain unchanged.

| Check                                                       | Result                                                                               |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| TypeScript typecheck                                        | Passed                                                                               |
| Frontend tests                                              | 72 passed                                                                            |
| Rust tests                                                  | 46 passed; one explicit live-provider test ignored                                   |
| Rust formatting and Clippy, all targets, warnings denied    | Passed                                                                               |
| Hosted gateway                                              | 22 local D1 tests passed with a mocked OpenAI provider                               |
| Production audio                                            | 54 OfflineAudioContext cases passed across three registers at 69% and maximum volume |
| Development desktop                                         | Real Rust/WebView checks passed; details below                                       |
| Production build, NSIS installation and installed recording | Passed; history cleanup and clean public release subsequently completed              |

Desktop coverage includes overview/subnetwork/topic entry via the real Canvas, canonical linked notes, unchanged review scope, exact Back camera/layout/selection/drawer width/editor mode, close preserving scope, dirty-note cancel/discard, rapid retargeting, Reduced mode without packets, empty/deleted notes, 900×600 uncovered positioning, idle suspension, 90 real new backlinks and duplicate Physics subjects under distinct Neurons. No renderer errors occurred in the completed run.

Audio coverage uses the real production synthesis graph, not mocks. Cases cover every register at both volume settings: single, dense overlap, neighbours, cancelled, muted, zero volume, stale, disposed and repeated-event gating. At most six voices are admitted; all cases release reservations and nodes. Silent cases render zero, tails clear, values remain finite and peaks stay below the 0.241 bound. Subjective listening is a separate review; the prototype is never used as a soundtrack.

Gateway tests retain invitation-only enrollment, token authentication, duplicate requests, expiry, quotas, concurrent admission, revocation, all spending caps and conservative holds. The current live policy remains 5 people, 10 generations/person/UTC day, 3/minute, one active generation/person, US$5/day, US$60/month, US$60 cumulative and the owner-approved 25 November 2026 00:00 UTC cutoff. No automatic renewal or personal-key fallback is introduced.

Publication review covered the original five remote branches, 13 historical commits, all 13 Actions jobs, and the complete current source. Gitleaks 8.30.1 reported no credential findings. Supplementary 64-hex review found documented hashes/cache keys in source/logs and a uniform Rust formatting-padding constant in binaries. All 13 artifact ZIP checksums matched GitHub metadata; their 104 extracted payload files contained no owner state or credential patterns. With owner approval, the notification-derived WAV and private owner document introductions were removed from the two affected historical commits; the two obsolete installer runs and all 14 old CI caches were deleted. GitHub retained old objects by SHA, so the owner approved keeping the original repository private and publishing a fresh repository at the same canonical URL. The clean repository contains only sanitized reachable history. Old commit and file access is checked before public visibility. A complete private backup remains excluded from Git. CI and anonymous release verification complete the publication checks.

The installed 0.6.0 executable exactly matched the payload extracted from the tested NSIS installer. GPL v3, copyright and complete third-party notice files were present in the installation directory. The installed recording covers overview entry, a subnetwork, a topic, four linked concepts and Back; all settled Back canvas images matched the originals pixel for pixel. The 23.208-second MP4 contains 1,050 frames with original compositor timing preserved within 0.989 ms, no interpolation, and actual app audio at 69%. Measured transition capture cadence was approximately 91–100 fps on this host, not a hardware-independent performance guarantee. All 12 principal audio cues align with their recorded actions within 50 ms. Native focus and a running AudioContext were verified. No provider request was made. Original settings were restored and the installed app was restarted without its debugging port.

The unsigned installer SHA-256 is `8e0737985f772d25a308e2e9a3649077ae21598721c5aba3359fcc441682a104`. Its installed executable SHA-256 is `0de29f10c7f5d1ead5fa0ea736f6773c70f45af10fa5c4255c5ef714e8732e34`. The standalone pre-bundle executable has a different hash because Tauri patches NSIS bundle-type information into the installer payload.

Local evidence is excluded from publication under .local/: depth-0.6.0/report.json and screenshots, sound-0.6.0/mix-report.json, gateway-0.6.0.log, rust-0.6.0.log, clippy-0.6.0.log and publication audit reports. Public screenshots and footage use only synthetic content. Windows 11 Pro 10.0.26300 is the tested host; Windows 10 and physical multi-monitor DPI switching have not received separate hardware validation. The installer is unsigned.
