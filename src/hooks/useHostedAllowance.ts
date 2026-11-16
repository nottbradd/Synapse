import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { DeviceSettings, HostedStatus } from "../study";
import { message } from "../types";

export function useHostedAllowance(settings?: DeviceSettings) {
  const enabled =
    settings?.provider === "synapse" &&
    settings.hosted_connected &&
    settings.hosted_consent;
  const [status, setStatus] = useState<HostedStatus>();
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((r) => r + 1), []);
  useEffect(() => {
    if (!enabled) {
      setStatus(undefined);
      setError("");
      return;
    }
    let active = true;
    let sequence = 0;
    const update = () => {
      const current = ++sequence;
      void invoke<HostedStatus>("synapse_ai_status")
        .then((value) => {
          if (active && current === sequence) {
            setStatus(value);
            setError("");
          }
        })
        .catch((e) => {
          if (active && current === sequence) {
            setStatus(undefined);
            setError(message(e));
          }
        });
    };
    update();
    const timer = window.setInterval(update, 30_000);
    window.addEventListener("synapse-ai-usage-changed", update);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("synapse-ai-usage-changed", update);
    };
  }, [enabled, revision]);
  return { status, error, refresh };
}
