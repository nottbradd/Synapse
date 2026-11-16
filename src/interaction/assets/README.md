# Approved opening note

`note-clean.wav` is the unchanged user-approved Clean opening-note sample supplied for the 0.5.1 update. Its original filename was `synapse-note-clean.wav`. It is bundled using Vite's inline asset import and decoded locally; the installed app never reads the original reference path.

- SHA-256: `e03ef4fc17ef8ab26d18932d39d3a27b854e56014996becfd9029f0ab2d42019`
- PCM16 stereo, 48,000 Hz, 0.245 seconds, 47,084 bytes.
- Original peak: approximately 0.100006 (−20 dBFS); no normalization or full-scale boost.
- Clean is the sole material. The optional tactile sample and the higher second note are not included.

Action variations are defined in `../audio.ts`; actual graph-arrival timing remains in `../events.ts`. The source buffer is cached per audio context and every voice has a smooth tail and explicit cleanup.
