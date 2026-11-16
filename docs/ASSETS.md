# Asset provenance

The 0.6.0 release uses original additive oscillator synthesis in `src/interaction/note.ts` and `audio.ts`. Its fundamental pitches, harmonic weights, envelopes and bounded identity variation were authored for Synapse. It contains no sampled notification, extracted waveform or third-party recording. The synthesis source and its output are covered by the project's GPL-3.0-only license.

The previous private 0.5.1 build included a recording derived from Codex's notification. No redistribution license for that recording has been established. It is removed from the current source and build. Historical copies and old binary artifacts must be cleared before public publication; the source-code license must not be treated as permission for that recording.

The Synapse application icon is an original geometric SVG in `src-tauri/icons/source.svg`; its raster derivatives share the project license. UI icons are Lucide (ISC). Geist and Manrope are bundled under the SIL Open Font License 1.1, with their original notices in `src/assets/fonts` and `public/licenses`. See the adjacent font README for upstream URLs. KaTeX's font and code notices are included in the dependency notice bundle.

Screenshots and release footage use temporary synthetic study notes. The navigation prototype is an illustrative reference only and is not shipped or presented as application footage.
