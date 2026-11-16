import type { SemanticRole } from "./exploration";

// Original additive synthesis, written for Synapse. No recorded sample,
// notification waveform, extracted spectrum or external audio is used.
export interface SoundContext {
  role?: SemanticRole;
  level?: number;
  node?: string;
}
const banks = {
  subnetwork: [261.6256, 293.6648, 329.6276, 391.9954],
  topic: [523.2511, 587.3295, 659.2551, 783.9909],
  concept: [1046.5023, 1174.6591, 1318.5102],
} as const;
export function identityHash(id: string) {
  let h = 2166136261;
  for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}
export function nodeVoice(context: SoundContext, repetition = 0) {
  const role =
    context.role ??
    ((context.level ?? 1) >= 2
      ? "concept"
      : (context.level ?? 1) <= 0
        ? "subnetwork"
        : "topic");
  const bank = banks[role],
    hash = identityHash(context.node ?? "synapse");
  const variation = (identityHash(`${context.node}:${repetition}`) % 101) / 100;
  const register = role === "subnetwork" ? 0 : role === "topic" ? 1 : 2;
  return {
    role,
    frequency: bank[hash % bank.length],
    detune: (variation - 0.5) * 3,
    attack: 0.0025 + variation * 0.0015,
    duration: [0.3, 0.235, 0.17][register],
    decay: [0.06, 0.044, 0.032][register],
    gain: [0.19, 0.15, 0.105][register] * (0.96 + variation * 0.04),
    partials: [
      [1, 1],
      [2, [0.045, 0.065, 0.028][register]],
      [3, 0.025],
      [4, 0.012],
    ],
  };
}
