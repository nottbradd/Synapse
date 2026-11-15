import { useEffect } from "react";
import { X } from "lucide-react";
import { preferences, usePreferences } from "../interaction/preferences";
import { feedback } from "../interaction/events";
export default function Preferences({ onClose }: { onClose: () => void }) {
  const p = usePreferences();
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);
  return (
    <div className="overlay">
      <section
        className="dialog glass preferences"
        role="dialog"
        aria-modal="true"
        aria-label="Preferences"
      >
        <header>
          <h2>Preferences</h2>
          <button aria-label="Close preferences" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <label className="check-option">
          <input
            type="checkbox"
            checked={p.sound}
            onChange={(e) => {
              preferences.update({ sound: e.target.checked });
              void feedback.unlock();
            }}
          />
          Sound
        </label>
        <label>
          Volume <span>{Math.round(p.volume * 100)}%</span>
          <input
            aria-label="Sound volume"
            type="range"
            min="0"
            max="100"
            step="1"
            value={Math.round(p.volume * 100)}
            disabled={!p.sound}
            onChange={(e) =>
              preferences.update({ volume: Number(e.target.value) / 100 })
            }
          />
        </label>
        <button
          disabled={!p.sound}
          onClick={() =>
            feedback.action({ kind: "select", node: "preferences-preview" })
          }
        >
          Preview sound
        </button>
        {preferences.error && <p className="form-error">{preferences.error}</p>}
      </section>
    </div>
  );
}
