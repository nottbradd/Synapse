import { TactileSynth, AUDIO, type Cue } from "./audio";
import { preferences } from "./preferences";
import type { SignalPacket } from "./signals";
export type ActionIntent =
  | {
      kind: "select" | "follow";
      node: string;
      source?: string;
      subject?: string;
    }
  | {
      kind:
        | "close"
        | "focus"
        | "leave"
        | "remembered"
        | "forgot"
        | "complete"
        | "error";
      subject?: string;
    }
  | { kind: "import"; nodes: string[]; subject: string };
export interface InteractionEvent {
  id: string;
  at: number;
  intent: ActionIntent;
}
type FeedbackEvent =
  { kind: "action"; event: InteractionEvent } | { kind: "cancel" };
export class Feedback {
  private serial = 0;
  private listeners = new Set<(event: FeedbackEvent) => void>();
  private context: AudioContext | null = null;
  private synth: TactileSynth | null = null;
  private focused = true;
  private nativeFocused = true;
  private documentFocused = true;
  private attached = 0;
  private release: (() => void) | null = null;
  subscribe = (fn: (event: FeedbackEvent) => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  private send(event: FeedbackEvent) {
    this.listeners.forEach((fn) => fn(event));
  }
  async unlock() {
    if (!preferences.get().sound || !this.focused) return;
    try {
      if (!this.context) {
        this.context = new AudioContext({ latencyHint: "interactive" });
        this.synth = new TactileSynth(this.context, preferences.get().volume);
      }
      if (this.context.state === "suspended") await this.context.resume();
    } catch {
      /* Audio failure never prevents a study action. */
    }
  }
  private contact(
    id: string,
    kind: Cue,
    at: number,
    subject?: string,
    level = 0.8,
    brightness = 1,
    pan = 0,
  ) {
    if (
      !this.focused ||
      !preferences.get().sound ||
      !this.context ||
      this.context.state !== "running"
    )
      return;
    const lag = (performance.now() - at) / 1000;
    if (lag > AUDIO.stale) return;
    this.synth?.play({
      id,
      kind,
      at: this.context.currentTime - lag,
      subject,
      level,
      brightness,
      pan,
    });
  }
  action(intent: ActionIntent) {
    const event = {
      id: `action-${++this.serial}`,
      at: performance.now(),
      intent,
    };
    if (
      ["select", "follow", "focus", "leave", "close", "import"].includes(
        intent.kind,
      )
    )
      this.cancel();
    this.send({ kind: "action", event });
    if (!this.focused) return event;
    const kind = intent.kind,
      subject = intent.subject;
    this.contact(
      event.id,
      kind,
      event.at,
      subject,
      kind === "import" ? 0.45 : kind === "remembered" ? 0.5 : 0.8,
    );
    const offsets =
      kind === "remembered"
        ? [0.09]
        : kind === "focus" || kind === "leave"
          ? [0.07, 0.145]
          : kind === "import"
            ? [0.071, 0.164, 0.24]
            : kind === "complete"
              ? [0.08, 0.17, 0.285]
              : [];
    offsets.forEach((s, i) =>
      this.contact(
        `${event.id}-${i}`,
        kind,
        event.at + s * 1000,
        subject,
        kind === "complete" ? 0.32 : kind === "import" ? 0.3 : 0.38,
        kind === "leave" ? 1 - i * 0.06 : 1 + i * 0.035,
      ),
    );
    return event;
  }
  arrivals(packets: SignalPacket[], relay = false) {
    for (const p of packets.slice(0, 6)) {
      if (relay)
        this.contact(
          `${p.id}-relay`,
          "arrival",
          p.start + p.duration * 0.5,
          p.subject,
          0.07,
          1.12,
          p.pan * 0.5,
        );
      this.contact(p.id, "arrival", p.arrival, p.subject, p.level, 1, p.pan);
    }
  }
  cancel(ids?: string[]) {
    this.synth?.cancel(ids?.flatMap((id) => [id, `${id}-relay`]));
    if (!ids) this.send({ kind: "cancel" });
  }
  setFocus(focused: boolean) {
    this.documentFocused = focused;
    this.applyFocus();
  }
  setNativeFocus(focused: boolean) {
    this.nativeFocused = focused;
    this.applyFocus();
  }
  private applyFocus() {
    this.focused = this.nativeFocused && this.documentFocused;
    if (!this.focused) {
      this.cancel();
      this.synth?.mute(true, preferences.get().volume);
    } else this.synth?.mute(!preferences.get().sound, preferences.get().volume);
  }
  attach() {
    if (this.attached++ === 0) {
      const gesture = (e: Event) => {
        if (e.isTrusted) void this.unlock();
      };
      const blur = () => this.setFocus(false),
        focus = () => this.setFocus(!document.hidden),
        visibility = () =>
          this.setFocus(!document.hidden && document.hasFocus());
      window.addEventListener("pointerdown", gesture, { capture: true });
      window.addEventListener("keydown", gesture, { capture: true });
      window.addEventListener("blur", blur);
      window.addEventListener("focus", focus);
      document.addEventListener("visibilitychange", visibility);
      const unsub = preferences.subscribe(() => {
        const p = preferences.get();
        this.synth?.mute(!p.sound || !this.focused, p.volume);
        if (!p.sound) this.cancel();
      });
      this.release = () => {
        window.removeEventListener("pointerdown", gesture, true);
        window.removeEventListener("keydown", gesture, true);
        window.removeEventListener("blur", blur);
        window.removeEventListener("focus", focus);
        document.removeEventListener("visibilitychange", visibility);
        unsub();
        this.cancel();
        this.synth?.dispose();
        this.synth = null;
        void this.context?.close();
        this.context = null;
      };
    }
    return () => {
      if (--this.attached === 0) {
        this.release?.();
        this.release = null;
      }
    };
  }
}
export const feedback = new Feedback();
