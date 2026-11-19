import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { DeviceSettings } from "../study";
import { message } from "../types";
import { X } from "lucide-react";
import {
  preferences,
  usePreferences,
  type MotionPreference,
} from "../interaction/preferences";
import { feedback } from "../interaction/events";
import { useSystemReducedMotion } from "../hooks/useReducedMotion";
import AiProviderSettings from "./AiProviderSettings";
import type { SemanticRole } from "../interaction/exploration";
import { withNativeDialog } from "../startup/suppression";
export default function Preferences({ onClose }: { onClose: () => void }) {
  const p = usePreferences();
  const systemReduced = useSystemReducedMotion();
  const [settings, setSettings] = useState<DeviceSettings>();
  const [startup, setStartup] = useState(false);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [previewRole, setPreviewRole] = useState<SemanticRole>("topic");
  useEffect(() => {
    let active = true;
    void invoke<boolean>("startup_state")
      .then((value) => {
        if (active) setStartup(value);
      })
      .catch((e) => {
        if (active) setError(message(e));
      });
    invoke<DeviceSettings>("device_settings")
      .then((s) => {
        if (active) setSettings(s);
      })
      .catch((e) => {
        if (active) setError(message(e));
      });
    return () => {
      active = false;
    };
  }, []);
  async function run(action: () => Promise<void>, success: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      window.dispatchEvent(new Event("synapse-settings-changed"));
      setNotice(success);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
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
        <div className="settings-scroll">
          <section className="settings-group">
            <h3>Motion</h3>
            <label>
              Animations
              <select
                aria-label="Animations"
                aria-describedby="motion-description"
                value={p.motion}
                onChange={(e) =>
                  preferences.update({
                    motion: e.target.value as MotionPreference,
                  })
                }
              >
                <option value="system">Follow Windows</option>
                <option value="full">Full</option>
                <option value="reduced">Reduced</option>
              </select>
            </label>
            <p id="motion-description">
              {p.motion === "system"
                ? systemReduced
                  ? "Windows animations are off. Notes and panels move immediately. Choose Full for smooth movement in Synapse."
                  : "Windows animations are on. Synapse uses smooth movement."
                : p.motion === "full"
                  ? "Smooth camera, panel and title movement, with connection currents. Applies only to Synapse."
                  : "Immediate camera and panel changes, with no moving connection currents."}
            </p>
            <label className="check-option">
              <input
                type="checkbox"
                checked={p.startupAnimation}
                onChange={(e) =>
                  preferences.update({ startupAnimation: e.target.checked })
                }
              />
              Startup animation
            </label>
            <p>
              A brief, silent cursor rebuild when Synapse first opens. Skipped
              with Reduced animations.
            </p>
            <label className="check-option">
              <input
                type="checkbox"
                checked={p.returnAnimation}
                onChange={(e) =>
                  preferences.update({ returnAnimation: e.target.checked })
                }
              />
              Return animation
            </label>
            <p>
              A silent accent when you return to Synapse. Your workspace stays
              visible.
            </p>
          </section>
          <section className="settings-group">
            <h3>Sound</h3>
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
            <label>
              Preview register
              <select
                aria-label="Preview sound register"
                value={previewRole}
                onChange={(e) => setPreviewRole(e.target.value as SemanticRole)}
              >
                <option value="subnetwork">Subnetwork · warm</option>
                <option value="topic">Topic · clear</option>
                <option value="concept">Concept · light</option>
              </select>
            </label>
            <button
              disabled={!p.sound}
              onClick={() =>
                feedback.action({
                  kind: "select",
                  node: "preferences-preview",
                  role: previewRole,
                })
              }
            >
              Preview sound
            </button>
            {preferences.error && (
              <p className="form-error">{preferences.error}</p>
            )}
          </section>
          {settings && (
            <>
              <section className="settings-group">
                <h3>Study creation</h3>
                <AiProviderSettings
                  settings={settings}
                  onSettings={setSettings}
                  run={run}
                  busy={busy}
                />
                {settings.provider === "personal" && (
                  <>
                    <p>
                      Optional OpenAI API access. API usage has separate billing
                      from ChatGPT; a subscription does not automatically cover
                      these requests.
                    </p>
                    <label>
                      API key{" "}
                      <span className="muted">
                        {settings.key_present
                          ? "Stored in Windows Credential Manager"
                          : "No key stored"}
                      </span>
                      <input
                        type="password"
                        autoComplete="off"
                        spellCheck={false}
                        aria-label="OpenAI API key"
                        value={key}
                        maxLength={512}
                        placeholder={
                          settings.key_present
                            ? "Enter a replacement key"
                            : "Enter your API key"
                        }
                        onChange={(e) => setKey(e.target.value)}
                      />
                    </label>
                    <div className="button-row">
                      <button
                        disabled={busy || !key.trim()}
                        onClick={() => {
                          const entered = key.trim();
                          setKey("");
                          void run(
                            async () =>
                              setSettings(
                                await invoke<DeviceSettings>("set_api_key", {
                                  key: entered,
                                }),
                              ),
                            "Key stored securely",
                          );
                        }}
                      >
                        {settings.key_present ? "Replace key" : "Store key"}
                      </button>
                      {settings.key_present && (
                        <button
                          disabled={busy}
                          onClick={() =>
                            void run(
                              async () =>
                                setSettings(
                                  await invoke<DeviceSettings>(
                                    "remove_api_key",
                                  ),
                                ),
                              "Key removed",
                            )
                          }
                        >
                          Remove key
                        </button>
                      )}
                    </div>
                    <div className="form-pair">
                      <label>
                        Model
                        <select
                          aria-label="OpenAI model"
                          value={settings.model}
                          onChange={(e) =>
                            setSettings({ ...settings, model: e.target.value })
                          }
                        >
                          {settings.models.map((m) => (
                            <option key={m} value={m}>
                              {m === "gpt-5.4-mini"
                                ? "GPT-5.4 mini"
                                : "GPT-5.4"}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Maximum output tokens
                        <input
                          aria-label="Maximum output tokens"
                          type="number"
                          min={512}
                          max={16384}
                          step={512}
                          value={settings.max_output_tokens}
                          onChange={(e) =>
                            setSettings({
                              ...settings,
                              max_output_tokens: Number(e.target.value),
                            })
                          }
                        />
                      </label>
                    </div>
                    <button
                      disabled={busy || !settings.key_present}
                      onClick={() =>
                        void run(
                          async () =>
                            setSettings(
                              await invoke<DeviceSettings>(
                                "test_api_connection",
                              ),
                            ),
                          "Connection verified with a small structured response",
                        )
                      }
                    >
                      Test saved connection
                    </button>
                    <p className="muted">
                      The explicit test sends no notes and permits at most 128
                      output tokens. Apply model changes before testing. No
                      automatic retries or model substitutions.
                    </p>
                    <p className="usage-info">
                      This device: {settings.usage.requests.toLocaleString()}{" "}
                      responses · {settings.usage.input_tokens.toLocaleString()}{" "}
                      input tokens ·{" "}
                      {settings.usage.output_tokens.toLocaleString()} output
                      tokens
                    </p>
                    <p className="muted">
                      These local counters cover responses received here, not
                      your billing balance. Cancelled or interrupted requests
                      may still incur usage.
                    </p>
                  </>
                )}
              </section>
              <section className="settings-group">
                <h3>Reminders</h3>
                <label>
                  Timezone
                  <input
                    aria-label="Default timezone"
                    value={settings.timezone}
                    onChange={(e) =>
                      setSettings({ ...settings, timezone: e.target.value })
                    }
                  />
                </label>
                <label className="check-option">
                  <input
                    type="checkbox"
                    checked={settings.background}
                    onChange={(e) =>
                      setSettings({ ...settings, background: e.target.checked })
                    }
                  />
                  Keep reminders running when the window closes
                </label>
                <p>
                  Closing hides Synapse in the tray when enabled. Choose Quit
                  Synapse in the tray to stop it. Reminders do not run after
                  full exit; missed reminders appear when you reopen.
                </p>
                <label className="check-option">
                  <input
                    type="checkbox"
                    checked={startup}
                    disabled={busy || settings.test_api}
                    onChange={(e) => {
                      const enabled = e.target.checked;
                      void run(
                        async () =>
                          setStartup(
                            await invoke<boolean>("set_startup", { enabled }),
                          ),
                        enabled ? "Startup enabled" : "Startup disabled",
                      );
                    }}
                  />
                  Start Synapse when I sign in to Windows
                </label>
                <p className="muted">
                  Optional startup is off by default. With background mode
                  enabled, startup opens in the tray.
                </p>
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await withNativeDialog(() =>
                        invoke("test_reminder_notification"),
                      );
                    }, "Notification sent to Windows")
                  }
                >
                  Test notification
                </button>
              </section>
              <button
                className="primary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    setSettings(
                      await invoke<DeviceSettings>("save_device_settings", {
                        settings: {
                          model: settings.model,
                          max_output_tokens: settings.max_output_tokens,
                          timezone: settings.timezone,
                          background: settings.background,
                        },
                      }),
                    );
                  }, "Settings saved")
                }
              >
                Apply settings
              </button>
              {settings.error && (
                <p className="form-error" role="alert">
                  {settings.error}
                </p>
              )}
            </>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {notice && <p role="status">{notice}</p>}
        </div>
      </section>
    </div>
  );
}
