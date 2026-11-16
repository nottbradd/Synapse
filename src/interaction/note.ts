import wave from "./assets/note-clean.wav?inline";

// The approved 48 kHz, stereo PCM16 Clean sample is bundled unchanged. Decode
// synchronously on the first gesture so the first action needs no network or
// async decoder, and no second AudioContext. This is deliberately a fixed-asset
// reader, not an importer for user-provided WAV files.
export function noteBuffer(context: BaseAudioContext) {
  const bytes = Uint8Array.from(atob(wave.slice(wave.indexOf(",") + 1)), (c) =>
    c.charCodeAt(0),
  );
  const view = new DataView(bytes.buffer);
  if (
    view.getUint32(0, false) !== 0x52494646 ||
    view.getUint32(8, false) !== 0x57415645 ||
    view.getUint32(12, false) !== 0x666d7420 ||
    view.getUint32(16, true) !== 16 ||
    view.getUint16(20, true) !== 1 ||
    view.getUint16(22, true) !== 2 ||
    view.getUint32(24, true) !== 48000 ||
    view.getUint16(34, true) !== 16 ||
    view.getUint32(36, false) !== 0x64617461 ||
    view.getUint32(40, true) !== bytes.length - 44
  )
    throw Error("Invalid bundled note sample");
  const frames = (bytes.length - 44) / 4;
  const buffer = context.createBuffer(2, frames, 48000);
  for (let channel = 0; channel < 2; channel++) {
    const samples = buffer.getChannelData(channel);
    for (let i = 0; i < frames; i++)
      samples[i] = view.getInt16(44 + i * 4 + channel * 2, true) / 32768;
  }
  return buffer;
}
