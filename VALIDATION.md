# Synapse validation

## 0.10.0 — All Notes, 19 November 2026

### Installed Windows desktop

Windows 11 Pro x64, WebView2 157, 1440 × 900 at 100%. The production NSIS QA installation used a separate product name, application identifier and disposable profile. The Rust indexer read the supplied Network Lab vault directly from disk. It resolved **4,096 Markdown notes and 10,688 unique links**, with all notes assigned to the single **Network Lab** subject. The layout found **27 communities**. Mechanics had **56 direct neighbours**.

From the sidebar click to the first usable map took **826 ms** on the final QA build. Worker creation to receipt of the settled coordinates took **750 ms**. The installed app opened Mechanics at 255%, followed its Momentum WikiLink inside All Notes, drilled into the existing 56-concept linked view and returned to the same Mechanics drawer. Closing the drawer kept the zoom. Fit returned to 100%. Returning from the linked view reused the first worker result.

The native six-note fixture contained four subject colours and an isolated note. Cancelling navigation kept an unsaved edit. Saving plain text kept seven links. Saving a new WikiLink raised the count to eight. The empty vault displayed zero notes and a new-note action. These vault-switch checks used the native open command and restored the vault on reload. The browser checks below exercised the sidebar’s folder-choice flow.

The screenshots show the installed app. Its loaded JavaScript, CSS and worker filenames matched all three content-hashed assets from the standard production build. [Full Network Lab map](docs/images/all-notes.png) · [Mechanics in the note drawer](docs/images/all-notes-mechanics.png)

### Browser interaction and performance

Headless Edge ran the React workspace, dedicated layout worker and Canvas renderer with fixture IPC. At 1600 × 960 the overview showed ten measured hub labels. Zooming revealed 26. Pointer-anchored zoom preserved the world point to numerical precision. Hover, pointer leave, panning and zooming produced no sound actions. Clicking Mechanics issued one camera target and produced 57 intermediate drawer frames in the recorded run. Back restored the exact camera and editor state. Closing the drawer preserved world framing.

A text-only save retained the same position buffer and camera. Adding a resolved pair started a new worker. Switching vaults while another layout was in flight left the new empty vault visible. Back to an existing linked-note view also restored its zoomed camera, 480 px split drawer, selection and 57-node scope. The minimum-width 900 px window kept the picker and all navigation controls inside the space beside the drawer.

The mixed fixture assigned real note paths to four study subjects across two Neurons and included an unassigned isolated note. Its **4,097 notes and 10,688 links** included **244 cross-subject pairs**. A strongly linked community crossed subject boundaries. The selected Physics review queue kept its single card through All Notes navigation. Returning to All Neurons exposed both due cards. Reduced motion settled focus immediately. [Multi-subject browser capture](docs/images/all-notes-subjects.png)

In one 100-draw pan and wheel run, Canvas drawing took **2.0 ms median and 3.5 ms p95** on the browser main thread. The initial browser worker took **777 ms** including module loading. The note picker returned the Mechanics result in **24 ms**. The settled canvas drew **zero frames during 1.5 seconds**. These timings measure this machine and dataset. A simulated foreground return used three real map edges and completed in 281 ms. Physical Windows Alt-Tab timing was last measured for 0.9.0.

The TypeScript suite passed all 82 tests. Rust passed 48 tests with one opt-in provider test skipped. Typechecking, ESLint, Clippy with warnings denied and all 58 browser startup and foreground-return cases passed.

The standard unsigned NSIS installer `Synapse_0.10.0_x64-setup.exe` passed its archive integrity check. The payload reports version 0.10.0 and x64 machine type. The installer is 5,995,449 bytes and its SHA-256 is `c3eea0927ecc80750e677531dbb195481cc9f86f022d40e747a478592fffca7c`.

For repeatable installed checks, open a fresh QA instance on an extracted copy of the supplied Network Lab and enable its loopback WebView2 debugging port. The following command verifies the open vault, exercises navigation and writes captures to the specified directory.

```powershell
node scripts/all-notes-desktop.mjs http://127.0.0.1:9237 "<extracted Network Lab folder>" ".local/network-lab-captures"
```

## 0.9.0 — 18 November 2026

Installed Synapse 0.9.0 played the v3 startup in **4461.7 ms** on a populated desktop. The recorded Windows Alt-Tab return lasted **281.5 ms**. Application source is `fb5d3b7a49f11e83f8ff3ed62108a69d0eca9379` on the local branch `codex/startup-v3`, based on the 0.8.1 native show/focus repair. The only subsequent change is this validation record. The release and its recordings stayed local.

### Reference and installed presentation

The supplied v3 HTML was replayed at 1× before implementation. Its construction ended at 4.0561 s and its sequence at 4.4561 s. The updated populated layout uses 0.900 s of opening orbit, ends construction at 4.060 s, and targets 4.460 s overall. The independent startup cleanup deadline is 4.900 s. The native show claim, 250 ms preparation budget and 400 ms return safety deadline were retained.

The cold capture began **444.7 ms before** the startup mark. Both the cold and tray captures showed fourteen named crosshairs, 16 measured UI targets, six live graph nodes with six explicitly typed labels, and three existing connections. The schedule contained six kinds of work across the real sidebar and graph. Each graph label kept its node’s agent while the caret followed the letter advances. Individual retirement lasted 160 ms. In the cold capture the first agent was gone at 1.71 s and the last at 4.22 s. The coordinated outline pulse lasted 300 ms in the nodes’ subject colours. End-of-effect inspections found zero overlays, concealed elements, preparation gates or new audio contexts.

The approved HTML and the installed cold-start MP4 were then played together at 1×. Seven paired frames covered the orbit, peel, selection handles, dimensions, typewriter carets, dragged copies, connection guides, departures and closing pulse. The live graph and sidebar determine where each job happens. The 1× side-by-side review is `Synapse-0.9.0-v3-comparison.mp4`.

### Installed lifecycle results

| Case | Observed result |
| --- | --- |
| Fresh visible process, populated vault | 4461.7 ms, 68.8 ms preparation. The recording includes the first presentation. |
| Hidden tray process, first foreground | Zero effects while hidden. The first foreground startup took 4465.5 ms, with 31.2 ms preparation. |
| Fresh process, welcome screen | 1821.0 ms with two agents, three UI targets and no graph jobs. |
| Reload after the first presentation | The native process reported `already-presented` and added zero effects. |
| Recorded Alt-Tab to a blank Notepad tab and back | One 281.5 ms return. All 47 active samples kept the workspace visible with zero agents. The graph Canvas hash stayed identical. The probe observed zero audio contexts and zero oscillator or buffer-source starts. |
| Real editor with an unsaved change | A 286.2 ms return preserved the complete CodeMirror document, caret/selection, 742 px scroll, editor focus, Edit mode, drawer geometry, scope, zoom and underlying Canvas hash. The next real keystroke replaced the selected 16 characters once, after the effect. |
| Native folder picker | Escape cancelled the picker and produced zero return effects. The following genuine Alt-Tab produced one 283.9 ms return. |

Before the startup edits, a fresh baseline recorded a 283.6 ms browser return and the prior 283.9 ms installed 0.8.1 return was retained. The old and new renderers produced identical pixels at all nine sampled times from 0 through 279 ms in a controlled comparison. Native focus traces used real window switches. The WebView diagnostics observed events and compositor frames with focus emulation disabled.

**Four native timing checks remain incomplete.** The desktop traces did not capture a first input during startup or during the return, a deliberate absence shorter than 500 ms, or a second qualifying foreground cycle within the 1500 ms cooldown. All four cases passed in the browser lifecycle suite.

### Checks and package

| Check | Result |
| --- | --- |
| Frontend, TypeScript and ESLint | 78 tests passed. Typechecking and lint passed. |
| Rust | 47 tests passed. The explicitly opt-in live-provider test remained ignored. |
| Browser lifecycle suite | All 58 passed, including Full, Reduced, Follow Windows, independent switches, input, dialog suppression, cooldown, large vaults, hidden show/focus, cleanup and CSS recovery. |
| Production build | Tauri built the unsigned Windows x64 NSIS installer with the existing hosted AI origin. |
| Extracted installer payload | The installed executable and three license/notice files matched the installer byte-for-byte. |
| Original owner state | The selected-vault and device files were restored byte-for-byte. Raw preference storage matched, including motion, sound and volume. Testing used a disposable vault and the original closed application state was restored. |

The installer is `src-tauri/target/release/bundle/nsis/Synapse_0.9.0_x64-setup.exe` (5,981,544 bytes). Its SHA-256 is `45c2ae03b31f0e7621b8d12fbdd8c44dd71f2041f3afe69f4a318b80f024a49c`. The installed executable’s SHA-256 is `f4d963ca0e5a3bcf9af5b5adf58a6bd39acb3f5ffa3137eee57c4c1b3487a64f`.

The private evidence directory is `.local/native-acceptance-0.9.0/`. The three native recording stems are `Synapse-0.9.0-native-cold-startup`, `Synapse-0.9.0-native-tray-first-foreground` and `Synapse-0.9.0-native-alt-tab-return`, each available as MP4 and GIF. The MP4s retain source timing within 0.51 ms and include short end holds. Their playback lengths are 5.29 s, 5.30 s and 1.11 s respectively. The 25 fps GIFs and all MP4s decoded successfully. The media use explicit video range to preserve the near-black workspace in Windows playback. The browser fixture report is separate at `.local/swarm-0.9.0/browser-report.json`.

## 0.8.1 — 17 November 2026

Installed Synapse **0.8.1** fixes the native show/readiness failure and has actual cold-launch, tray-launch and operating-system Alt-Tab recordings. **Native acceptance remains incomplete:** input during either effect, a deliberately sub-500 ms focus bounce and rapid qualified cycles inside the 1500 ms cooldown have browser coverage but have not passed precisely timed native tests. Ordinary native returns, native dialogs and actual CodeMirror preservation passed. This is a local verification and repair pass; nothing was published.

Final application source: **`54156ce8fe0914710d64ddc35fac77ac25a50a6d`**, on `codex/native-swarm-acceptance`. The starting source was `a8b95ec070ada730fa8817d1232b4bfe24ac4f51` / 0.8.0. The subsequent validation-document commit does not change the installed application. Package versions were updated consistently without dependency changes.

| Check | Result |
| --- | --- |
| TypeScript typecheck and ESLint | Passed; ESLint also rerun after the final capture-helper edits |
| Frontend tests | 78 passed |
| Rust tests | 47 passed; one explicit live-provider test ignored |
| Rustfmt and Clippy, all targets, warnings denied | Passed |
| Browser lifecycle checks | 58 passed, including native show without either focus event and show without actual focus |
| Production build | Passed; unsigned x64 NSIS package, existing public AI origin preserved |
| Installed executable and three notice files | Match extracted final installer payload byte-for-byte |
| Native cold/tray/welcome, ordinary returns, dialogs and CodeMirror | Passed on that exact installed 0.8.1 executable |
| Precisely timed native interruption/bounce/cooldown cases | Incomplete; details below |

### Native failure and repair

The hidden WebView could already report DOM focus. Showing the window then produced neither a DOM focus event nor the expected Tauri focus event, leaving the preparation gate pending even after actual native focus/visibility became true. The prior DOM-event reconciliation alone could not recover that ordering. Failure evidence was retained before the repair.

The native show path now emits `synapse-window-shown`. That notification wakes the bounded preparation gate and requests an authoritative native focus reconciliation; it does not fabricate focus or consume the launch claim. Rust continues to require actual visibility and focus before granting its one-use process claim. Unit and browser regressions cover both focused and unfocused show notifications. The final installed tray and cold launches passed without controller calls or synthetic focus events.

An additional recording-harness issue was corrected: native CDP connections now use `noDefaults: true`, preventing Playwright's default focus emulation from contaminating native focus observations. Native UI input and Alt-Tab used the approved Windows Computer Use interface with a verified blank Notepad tab. CDP supplied passive instrumentation and compositor capture; OS-motion/DPI emulation and exact preference restoration are separately identified below.

### Installed behaviour

| Native case | Measured result |
| --- | --- |
| New normal visible process, populated vault | Startup **3502.1 ms**; nine agents, 16 UI targets, six actual nodes, three edges; preparation 74.7 ms |
| New hidden tray process, then first foreground | No startup while hidden; first eligible presentation **3504.9 ms**, same populated sample; preparation 36.7 ms |
| New process with no selected vault | Welcome startup **1479.8 ms**, two agents and three eligible targets |
| Frontend reload in an already presented process | `already-presented`; no full startup replay |
| Recorded genuine Alt-Tab return | Exactly one effect, **283.9 ms** |
| Alt-Tab with a focused, unsaved CodeMirror note | Exactly one effect, **285.2 ms** |
| Alt-Tab after native dialog checks | Exactly one effect, **283.9 ms**, proving suppression released |
| Empty graph, collapsed sidebar, startup disabled and return enabled | Exactly one return, **286.2 ms**; viewport/DPR emulated as identified below |

Successful populated startups completed below the 3800 ms deadline, with no remaining preparation gate, concealed content, overlays or startup RAF/timer. No initial startup/return overlap or new AudioContext was observed. Intermediate and final decoded frames showed construction matching the real UI/graph and a clean handover, without a completed-interface-then-hide flash. The cold recording was armed **151.8 ms before** the startup mark. The welcome capture began about 7 ms after its mark, so it supplies native state/timing evidence rather than a complete first-frame welcome recording.

The real editor test inserted a distinctive unsaved edit, selected the range between positions 69 and 103 and scrolled to **1183 px**. After actual Alt-Tab, the complete unsaved document, selection, scroll, focus, Edit mode, graph scope, zoom, drawer geometry and graph Canvas hash were unchanged. Forty-eight active return-frame samples showed zero cursors, zero concealed targets and no gate. A subsequent real `Q` input replaced the selection exactly once. That character check occurred after the effect; it does not substitute for input during the 280 ms effect. Only the disposable note was later saved.

Real native folder-picker cancellation, successful selection of the disposable vault and export/save cancellation all accepted normal input and added zero return effects. Suppression also held through observed delayed focus restoration. The later genuine Alt-Tab return passed, with 47 active samples showing no cursors or hidden content. Injected dialog errors remain covered by the browser suite.

Reduced motion skipped both native startup and native Alt-Tab returns. The startup and return toggles independently disabled their effects; return still ran when startup alone was disabled. Follow Windows respected reduced/no-preference media emulation, and explicit Full overrode emulated reduction. Actual Windows motion settings were not changed. Native layouts included 1440×900, a resized 1000×900 view with the real editor drawer, and a maximized 1920×1009 empty graph with collapsed navigation, all at DPR 1. A separate **emulated** 1000×700 / DPR 1.5 view also passed its return check. Physical monitor/DPI switching is not claimed.

### Recordings and evidence

All final captures use the installed 0.8.1 executable and synthetic content. MP4 encoding preserves original compositor timestamps within **0.5 ms**, with no interpolation or added soundtrack, and includes a short final hold. The MP4 durations are 4.33 s for cold startup, 4.34 s for tray startup and 1.12 s for return. GIFs are normal-speed 25 fps review copies and loop only for review. Both formats decoded successfully; intermediate construction/effect frames and final handovers were visually inspected.

The session began on 0.8.0, so its private evidence directory retains that name: **`.local/native-acceptance-0.8.0/`**. Final report version fields and these media names identify the tested binary correctly:

- `Synapse-0.8.1-native-cold-startup.{mp4,gif}` — actual new visible process, capture before animation start.
- `Synapse-0.8.1-native-tray-first-foreground.{mp4,gif}` — actual new hidden process, then native show.
- `Synapse-0.8.1-native-alt-tab-return.{mp4,gif}` — actual operating-system window switch and native focus transition.

Underlying timestamps, frames, native events and marks are in `cold-final/report.json`, `tray-final/report.json` and `return-final/report.json`. The original return recorder reached its rAF sample cap before the final cycle; its compositor frames, focus events and performance marks still cover the recorded effect. Independent editor/post-dialog traces provide the active-frame cursor/visibility checks above. The helper now keeps a bounded recent history to avoid losing late evidence.

`acceptance-report.json` verifies 19 case groups and explicitly records `acceptanceComplete: false`. Supporting files include `preview-media-validation.json`, `package-verification.json`, `editor-return-*`, `folder-cancel-close-*`, `folder-success-*`, `export-cancel-*`, `post-dialog-return-*`, preference/layout reports and restoration reports. The final 58-case browser report is `.local/swarm-0.8.1/browser-report.json`; the earlier version-hardcoded helper also wrote this run over `.local/swarm-0.8.0/browser-report.json`, so that old path no longer contains the historical 56-case run. All local captures and private backups remain ignored by Git. Reproduction instructions are in [STARTUP_AUDIO.md](docs/STARTUP_AUDIO.md).

### Restoration and remaining limits

The app has no supported isolated test profile. Before testing, the owner's device file, selected-vault record and exact preference string were backed up privately. Synapse was originally closed, with no owner editor session to preserve. Tests selected a disposable synthetic vault and did not invoke a provider or modify hosted funding/Calendar configuration.

The original device and selected-vault files were restored **byte-for-byte**. The exact original localStorage preference string was restored and verified: schema v1, **Full motion, sound enabled, volume 0.69**, without adding the previously absent animation-toggle fields. Provider selection and consent were preserved. The test process and debugging port 9222 are closed; temporary emulation/capture sessions are closed. Only the disposable Notepad tab was removed, its restored original tabs remained unmodified, and Notepad was closed again. Restoration is recorded at `2026-11-17T08:39:12.340Z`.

The remaining native cases are input during startup, input during return, an intentional away/back cycle shorter than 500 ms, and repeated qualified cycles within the 1500 ms cooldown. The native automation observation/action round trips could not reliably land those gestures inside their timing windows. An attempted real Tab interruption arrived after startup completed and is explicitly **not** counted as a pass. These cases retain automated browser coverage but require a future suitably timed native run before full native acceptance can be declared. No Computer Use policy stop occurred in this pass. Windows 10 and physical DPI changes are also unverified; the tested host is Windows 11 Pro 10.0.26300.

Installer: `src-tauri/target/release/bundle/nsis/Synapse_0.8.1_x64-setup.exe` (5,979,260 bytes, unsigned).
SHA-256: `97b2cd6dffe2798ab78cea8e854fd5adff398c8702dc4b5cb41fc24f19c1afbc`.
Installed executable SHA-256: `4011d88563058c97eb5a9d3ceabeed224ba5080cf219cb3cd490506a48f5a9b5`.
The installed GPL v3 licence, copyright notice and third-party notices match the final installer payload.

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
