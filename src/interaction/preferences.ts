import { useSyncExternalStore } from "react";
export interface Preferences {
  schema_version: 1;
  sound: boolean;
  volume: number;
}
export const DEFAULT_PREFERENCES: Preferences = {
  schema_version: 1,
  sound: true,
  volume: 0.35,
};
export const PREFERENCE_KEY = "synapse.preferences.v1";
export function decodePreferences(raw: string | null): Preferences {
  try {
    const p = JSON.parse(raw ?? "null");
    if (
      p?.schema_version === 1 &&
      typeof p.sound === "boolean" &&
      typeof p.volume === "number" &&
      Number.isFinite(p.volume) &&
      p.volume >= 0 &&
      p.volume <= 1
    )
      return { schema_version: 1, sound: p.sound, volume: p.volume };
  } catch {
    /* Preserve malformed storage until an explicit preference change. */
  }
  return { ...DEFAULT_PREFERENCES };
}
export class PreferenceStore {
  private value: Preferences;
  private listeners = new Set<() => void>();
  error = "";
  constructor(
    private storage: Pick<Storage, "getItem" | "setItem"> | undefined,
  ) {
    let raw = null;
    try {
      raw = storage?.getItem(PREFERENCE_KEY) ?? null;
    } catch {
      /* unavailable storage uses session defaults */
    }
    this.value = decodePreferences(raw);
  }
  get = () => this.value;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  update(change: Partial<Pick<Preferences, "sound" | "volume">>) {
    this.value = {
      ...this.value,
      ...change,
      volume: Math.max(0, Math.min(1, change.volume ?? this.value.volume)),
    };
    this.error = "";
    try {
      this.storage?.setItem(PREFERENCE_KEY, JSON.stringify(this.value));
    } catch {
      this.error =
        "Preferences could not be saved. This setting will last for this session.";
    }
    this.listeners.forEach((fn) => fn());
  }
}
const storage = () => {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
};
export const preferences = new PreferenceStore(storage());
export const usePreferences = () =>
  useSyncExternalStore(preferences.subscribe, preferences.get);
