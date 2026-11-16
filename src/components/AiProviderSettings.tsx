import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { DeviceSettings } from "../study";
import { useHostedAllowance } from "../hooks/useHostedAllowance";
import { allowanceText, hostedMessage, resetTime } from "../hosted";

export default function AiProviderSettings({
  settings,
  onSettings,
  run,
  busy,
}: {
  settings: DeviceSettings;
  onSettings: (settings: DeviceSettings) => void;
  run: (action: () => Promise<void>, success: string) => Promise<void>;
  busy: boolean;
}) {
  const [choice, setChoice] = useState(settings.provider);
  const [consent, setConsent] = useState(settings.hosted_consent);
  const [invitation, setInvitation] = useState("");
  const { status, error, refresh } = useHostedAllowance(settings);
  return (
    <>
      <label>
        AI provider
        <select
          aria-label="AI provider"
          value={choice}
          disabled={busy}
          onChange={(e) =>
            setChoice(e.target.value as DeviceSettings["provider"])
          }
        >
          <option value="synapse">Synapse AI · owner-funded</option>
          <option value="personal">Personal API key</option>
        </select>
      </label>
      <p className="muted">
        Active provider:{" "}
        {settings.provider === "synapse" ? "Synapse AI" : "Personal API key"}.
        Providers change only when you apply your choice. Allowance limits never
        switch billing to a personal key.
      </p>
      {choice === "synapse" && (
        <>
          <p>
            Synapse AI uses an allowance funded by the app owner, shared across
            your devices. Invitations are required during the initial rollout.
          </p>
          <p id="hosted-data-notice">
            Selected note text and your request pass through the Synapse service
            to OpenAI to create a draft. Reminder requests send selected titles
            and references only. Synapse keeps usage records, without note
            bodies or generated answers. You review and explicitly save every
            draft.
          </p>
          {!settings.hosted_consent && (
            <label className="check-option">
              <input
                type="checkbox"
                aria-describedby="hosted-data-notice"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              I understand and enable this data transfer
            </label>
          )}
          {!settings.hosted_configured && (
            <p className="form-notice">
              The hosted service is not configured in this build. Local study
              features remain available.
            </p>
          )}
          {!settings.hosted_connected && (
            <>
              <label>
                Invitation
                <input
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  aria-label="Synapse AI invitation"
                  value={invitation}
                  maxLength={64}
                  onChange={(e) => setInvitation(e.target.value.trim())}
                  placeholder="Private invitation from the owner"
                />
              </label>
              <button
                className="primary"
                disabled={
                  busy ||
                  !consent ||
                  invitation.length !== 64 ||
                  !settings.hosted_configured
                }
                onClick={() => {
                  const entered = invitation;
                  setInvitation("");
                  void run(
                    async () =>
                      onSettings(
                        await invoke<DeviceSettings>("enroll_synapse_ai", {
                          invitation: entered,
                          consent,
                        }),
                      ),
                    "Synapse AI activated on this device",
                  );
                }}
              >
                Activate Synapse AI
              </button>
              <p className="muted">
                For another device or a reinstall, ask for an invitation to your
                existing account. Usage is retained on the service.
              </p>
            </>
          )}
        </>
      )}
      {choice !== settings.provider && (
        <button
          disabled={busy || (choice === "synapse" && !consent)}
          onClick={() =>
            void run(
              async () =>
                onSettings(
                  await invoke<DeviceSettings>("select_ai_provider", {
                    provider: choice,
                    consent,
                  }),
                ),
              "AI provider changed",
            )
          }
        >
          Use {choice === "synapse" ? "Synapse AI" : "personal API key"}
        </button>
      )}
      {settings.provider === "synapse" && settings.hosted_connected && (
        <>
          {status && (
            <>
              <p className="usage-info" role="status">
                {allowanceText(status, settings.timezone)}
              </p>
              {status.reason && (
                <p className="form-notice">{hostedMessage(status.reason)}</p>
              )}
              {status.retry_at && (
                <p className="muted">
                  Try after {resetTime(status.retry_at, settings.timezone)}
                </p>
              )}
              <details className="hosted-details">
                <summary>Hosted usage details</summary>
                <p>
                  {status.requests.toLocaleString()} generations across your
                  devices · {status.input_tokens.toLocaleString()} input tokens
                  · {status.output_tokens.toLocaleString()} output tokens
                </p>
                <p>
                  Estimated usage and reservations: US$
                  {(status.estimated_nusd / 1e9).toFixed(4)}. This includes US$
                  {(status.reserved_nusd / 1e9).toFixed(4)} awaiting usage
                  confirmation.
                </p>
                <p className="muted">
                  These are service estimates, not posted OpenAI charges. Shared
                  spending limits can stop a request before your daily allowance
                  is used. The owner reconciles provider records.
                </p>
                <p className="muted">
                  Account {status.member}
                  <br />
                  Device {status.device}
                  <br />
                  Model {status.model}
                </p>
              </details>
            </>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="button-row">
            <button disabled={busy} onClick={refresh}>
              Refresh allowance
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void run(
                  async () =>
                    onSettings(
                      await invoke<DeviceSettings>("forget_synapse_ai", {
                        localOnly: false,
                      }),
                    ),
                  "This device was revoked and its credential removed",
                )
              }
            >
              Revoke this device
            </button>
          </div>
        </>
      )}
      {choice === "synapse" && (
        <details className="hosted-details">
          <summary>Remove local access</summary>
          <p>
            This deletes this PC’s credential only. It does not reset your
            allowance or revoke a lost credential on the server. Ask the owner
            to revoke that device if needed.
          </p>
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                onSettings(
                  await invoke<DeviceSettings>("forget_synapse_ai", {
                    localOnly: true,
                  }),
                );
                setConsent(false);
              }, "Local hosted credential removed; server usage retained")
            }
          >
            Forget hosted access on this PC
          </button>
        </details>
      )}
    </>
  );
}
