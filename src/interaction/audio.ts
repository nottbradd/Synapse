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
  return 0.96 + (((h >>> 0) % 100) / 100) * 0.12;
}
type Voice = { sources: AudioBufferSourceNode[]; nodes: AudioNode[] };
// This synth also accepts OfflineAudioContext for deterministic mix/cleanup tests.
export class TactileSynth {
  readonly budget = new VoiceBudget();
  readonly master: GainNode;
  private compressor: DynamicsCompressorNode;
  private limiter: WaveShaperNode;
  private active = new Map<string, Voice>();
  private seed = 9147;
  private muted = false;
  private disposed = false;
  constructor(
    readonly context: BaseAudioContext,
    volume: number,
  ) {
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
  private random() {
    let x = this.seed;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.seed = x;
    return (x >>> 0) / 4294967296;
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
      const v = this.active.get(id);
      if (v) {
        for (const source of v.sources)
          try {
            source.stop();
          } catch {
            /* already stopped */
          }
        v.nodes.forEach((n) => n.disconnect());
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
      life = 0.15;
    this.budget.prune(c.currentTime);
    const reservation = this.budget.reserve({
      id: e.id,
      at,
      end: at + life,
      key: `${e.kind}:${e.subject ?? ""}`,
      priority: e.priority ?? (e.kind === "arrival" ? 1 : 10),
    });
    this.cancel(reservation.evicted);
    if (!reservation.accepted) return false;
    const voice: Voice = { sources: [], nodes: [] };
    this.active.set(e.id, voice);
    const bus = c.createGain(),
      pan = c.createStereoPanner();
    voice.nodes.push(bus, pan);
    pan.pan.value = e.pan ?? 0;
    const dark =
      e.kind === "forgot" || e.kind === "error" || e.kind === "close";
    bus.gain.value =
      (e.level ?? 0.8) * (dark ? 0.64 : e.kind === "arrival" ? 0.28 : 0.82);
    bus.connect(pan).connect(this.compressor);
    const shade =
      subjectRegister(e.subject) *
      (e.brightness ?? 1) *
      (dark ? 0.83 : 1) *
      (0.985 + 0.03 * this.random());
    const burst = (
      offset: number,
      duration: number,
      gain: number,
      frequency: number,
      q: number,
      highpass = 0,
    ) => {
      const buffer = c.createBuffer(
          1,
          Math.ceil(c.sampleRate * duration),
          c.sampleRate,
        ),
        samples = buffer.getChannelData(0);
      for (let i = 0; i < samples.length; i++)
        samples[i] =
          (this.random() * 2 - 1) *
          Math.min(1, i / 16) *
          Math.exp((-6 * i) / samples.length) *
          Math.min(1, (samples.length - 1 - i) / 20);
      const source = c.createBufferSource(),
        filter = c.createBiquadFilter(),
        amp = c.createGain();
      source.buffer = buffer;
      filter.type = q ? "bandpass" : "lowpass";
      filter.frequency.value = frequency * shade;
      filter.Q.value = q || 0.55;
      amp.gain.value = gain;
      voice.sources.push(source);
      voice.nodes.push(source, filter, amp);
      source.connect(filter).connect(amp);
      if (highpass) {
        const hp = c.createBiquadFilter();
        hp.type = "highpass";
        hp.frequency.value = highpass;
        voice.nodes.push(hp);
        amp.connect(hp).connect(bus);
      } else amp.connect(bus);
      source.onended = () => {
        voice.sources = voice.sources.filter((s) => s !== source);
        source.disconnect();
        if (!voice.sources.length) {
          voice.nodes.forEach((n) => n.disconnect());
          this.active.delete(e.id);
          this.budget.remove(e.id);
        }
      };
      source.start(at + offset);
      source.stop(at + offset + duration + 0.003);
    };
    // Dry relay contact, low-mid body and a short, subdued metal edge.
    // Each event is synthesized here; no audition recording is loaded.
    burst(0, 0.0028, 0.2, 3200, 0.65, 950);
    burst(0.0008, 0.034, 0.69, 235, 0.95);
    burst(0.0012, 0.027, 0.32, 465, 0.9);
    burst(0.0017, 0.019, 0.09, 780, 1);
    burst(0.0048, 0.0065, 0.065, 1700, 0.7, 650);
    burst(0.002, 0.026, 0.062, 1380, 3.2);
    burst(0.003, 0.032, 0.025, 2190, 4.5);
    if (e.kind !== "arrival") {
      const source = c.createBufferSource();
      const buffer = c.createBuffer(
        1,
        Math.ceil(c.sampleRate * 0.039),
        c.sampleRate,
      );
      const samples = buffer.getChannelData(0);
      const metals = [
        [1567, dark ? 0.0015 : 0.0032],
        [2471, dark ? 0.0007 : 0.0014],
      ];
      for (let i = 0; i < samples.length; i++) {
        const t = i / c.sampleRate;
        samples[i] = metals.reduce(
          (sum, [hz, level]) =>
            sum +
            Math.sin(2 * Math.PI * hz * shade * t) *
              level *
              Math.min(1, t / 0.0009) *
              Math.exp(-180 * t) *
              Math.max(0, Math.min(1, (0.038 - t) / 0.005)),
          0,
        );
      }
      source.buffer = buffer;
      voice.sources.push(source);
      voice.nodes.push(source);
      source.connect(bus);
      source.onended = () => {
        voice.sources = voice.sources.filter((s) => s !== source);
        source.disconnect();
        if (!voice.sources.length) {
          voice.nodes.forEach((n) => n.disconnect());
          this.active.delete(e.id);
          this.budget.remove(e.id);
        }
      };
      source.start(at);
      source.stop(at + 0.039);
    }
    return true;
  }
}
