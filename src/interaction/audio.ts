import { noteBuffer } from "./note";

export const AUDIO = {
  voices: 6,
  gate: 0.06,
  stale: 0.08,
  ceiling: 0.32,
  master: 0.75,
} as const;
export type Cue =
  | "select"
  | "close"
  | "focus"
  | "leave"
  | "follow"
  | "remembered"
  | "forgot"
  | "import"
  | "draft"
  | "connect"
  | "complete"
  | "error"
  | "arrival";
export interface Contact {
  id: string;
  at: number;
  kind: Cue;
  subject?: string;
  level?: number;
  pan?: number;
  brightness?: number;
  priority?: number;
}
interface Reservation {
  id: string;
  at: number;
  end: number;
  key: string;
  priority: number;
}
export class VoiceBudget {
  voices = new Map<string, Reservation>();
  private gates = new Map<string, number[]>();
  reserve(v: Reservation) {
    if (
      (this.gates.get(v.key) ?? []).some((t) => Math.abs(v.at - t) < AUDIO.gate)
    )
      return { accepted: false, evicted: [] as string[] };
    const evicted: string[] = [];
    const overlapping = () =>
      [...this.voices.values()].filter((o) => o.at < v.end && o.end > v.at);
    for (;;) {
      const list = overlapping(),
        points = [v.at, ...list.map((o) => Math.max(o.at, v.at))];
      if (
        points.every(
          (t) =>
            list.filter((o) => o.at <= t && o.end > t).length < AUDIO.voices,
        )
      )
        break;
      const victim = list
        .filter((o) => o.priority < v.priority)
        .sort((a, b) => a.priority - b.priority)[0];
      if (!victim) return { accepted: false, evicted };
      this.voices.delete(victim.id);
      evicted.push(victim.id);
    }
    this.voices.set(v.id, v);
    this.gates.set(v.key, [...(this.gates.get(v.key) ?? []), v.at]);
    return { accepted: true, evicted };
  }
  prune(now: number) {
    for (const [id, v] of this.voices) if (v.end <= now) this.voices.delete(id);
    for (const [k, times] of this.gates) {
      const remaining = times.filter((t) => t >= now - AUDIO.gate);
      if (remaining.length) this.gates.set(k, remaining);
      else this.gates.delete(k);
    }
  }
  remove(id: string) {
    this.voices.delete(id);
  }
  clear() {
    this.voices.clear();
    this.gates.clear();
  }
}
export function subjectRegister(id = "") {
  let h = 0;
  for (const c of id) h = (Math.imul(h, 31) + c.charCodeAt(0)) | 0;
  return 0.996 + (((h >>> 0) % 100) / 100) * 0.008;
}
type Voice = { source: AudioBufferSourceNode; nodes: AudioNode[] };
const material: Record<
  Cue,
  { duration: number; level: number; cutoff: number }
> = {
  select: { duration: 0.225, level: 1, cutoff: 12000 },
  follow: { duration: 0.215, level: 0.9, cutoff: 10000 },
  close: { duration: 0.16, level: 0.66, cutoff: 2400 },
  focus: { duration: 0.2, level: 0.85, cutoff: 10000 },
  leave: { duration: 0.17, level: 0.65, cutoff: 2800 },
  remembered: { duration: 0.225, level: 0.95, cutoff: 12000 },
  forgot: { duration: 0.16, level: 0.72, cutoff: 2200 },
  import: { duration: 0.22, level: 0.88, cutoff: 10000 },
  draft: { duration: 0.22, level: 0.88, cutoff: 10000 },
  connect: { duration: 0.19, level: 0.82, cutoff: 8000 },
  complete: { duration: 0.225, level: 1, cutoff: 12000 },
  error: { duration: 0.15, level: 0.7, cutoff: 2200 },
  arrival: { duration: 0.125, level: 0.2, cutoff: 2600 },
};
// The same production voice graph accepts OfflineAudioContext for mix tests.
export class NoteSynth {
  readonly budget = new VoiceBudget();
  readonly master: GainNode;
  private compressor: DynamicsCompressorNode;
  private limiter: WaveShaperNode;
  private sample: AudioBuffer;
  private active = new Map<string, Voice>();
  private muted = false;
  private disposed = false;
  constructor(
    readonly context: BaseAudioContext,
    volume: number,
  ) {
    this.sample = noteBuffer(context);
    this.compressor = context.createDynamicsCompressor();
    this.compressor.threshold.value = -23;
    this.compressor.knee.value = 3;
    this.compressor.ratio.value = 4;
    this.compressor.attack.value = 0.001;
    this.compressor.release.value = 0.045;
    this.limiter = context.createWaveShaper();
    const curve = new Float32Array(4097);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = AUDIO.ceiling * Math.tanh(x / AUDIO.ceiling);
    }
    this.limiter.curve = curve;
    this.limiter.oversample = "2x";
    this.master = context.createGain();
    this.master.gain.value = Math.max(0, Math.min(1, volume)) * AUDIO.master;
    this.compressor
      .connect(this.limiter)
      .connect(this.master)
      .connect(context.destination);
  }
  get activeVoices() {
    return this.active.size;
  }
  volume(value: number) {
    this.master.gain.cancelScheduledValues(this.context.currentTime);
    this.master.gain.setTargetAtTime(
      this.muted ? 0 : Math.max(0, Math.min(1, value)) * AUDIO.master,
      this.context.currentTime,
      0.006,
    );
  }
  mute(value: boolean, volume: number) {
    this.muted = value;
    if (value) this.cancel();
    this.volume(volume);
  }
  cancel(ids?: string[]) {
    for (const id of ids ?? [...this.active.keys()]) {
      const voice = this.active.get(id);
      if (voice) {
        try {
          voice.source.stop();
        } catch {
          /* already stopped */
        }
        voice.nodes.forEach((n) => n.disconnect());
        this.active.delete(id);
      }
      this.budget.remove(id);
    }
    if (!ids) this.budget.clear();
  }
  dispose() {
    this.cancel();
    this.master.disconnect();
    this.limiter.disconnect();
    this.compressor.disconnect();
    this.disposed = true;
  }
  play(e: Contact) {
    const c = this.context;
    if (this.muted || this.disposed || e.at < c.currentTime - AUDIO.stale)
      return false;
    const at = Math.max(c.currentTime, e.at),
      tone = material[e.kind],
      life = tone.duration;
    this.budget.prune(c.currentTime);
    const reservation = this.budget.reserve({
      id: e.id,
      at,
      end: at + life + 0.006,
      key: `${e.kind}:${e.subject ?? ""}`,
      priority: e.priority ?? (e.kind === "arrival" ? 1 : 10),
    });
    this.cancel(reservation.evicted);
    if (!reservation.accepted) return false;
    const source = c.createBufferSource(),
      bus = c.createGain(),
      filter = c.createBiquadFilter(),
      pan = c.createStereoPanner();
    const voice: Voice = { source, nodes: [source, bus, filter, pan] };
    this.active.set(e.id, voice);
    source.buffer = this.sample;
    // A fixed, tiny register difference; no pitch sweep or second note.
    source.playbackRate.value = subjectRegister(e.subject);
    filter.type = "lowpass";
    filter.Q.value = 0.5;
    filter.frequency.value =
      tone.cutoff * Math.max(0.9, Math.min(1.1, e.brightness ?? 1));
    pan.pan.value = Math.max(-1, Math.min(1, e.pan ?? 0));
    const level = Math.max(0, Math.min(1, e.level ?? 0.8)) * tone.level;
    bus.gain.value = 0;
    bus.gain.setValueAtTime(level, at);
    bus.gain.setValueAtTime(level, at + life - 0.045);
    bus.gain.linearRampToValueAtTime(0, at + life);
    source.connect(filter).connect(bus).connect(pan).connect(this.compressor);
    source.onended = () => {
      voice.nodes.forEach((n) => n.disconnect());
      if (this.active.get(e.id) === voice) {
        this.active.delete(e.id);
        this.budget.remove(e.id);
      }
    };
    source.start(at);
    source.stop(at + life);
    return true;
  }
}
