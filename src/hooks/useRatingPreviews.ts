import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { message, type RatingPreviews, type Snapshot } from "../types";

export function formatInterval(seconds: number) {
  const [value, unit] =
    seconds < 60
      ? [seconds, "sec"]
      : seconds < 3600
        ? [seconds / 60, "min"]
        : seconds < 86400
          ? [seconds / 3600, "hr"]
          : [seconds / 86400, "day"];
  const number = Number(value.toFixed(1));
  return `${number} ${unit}${unit === "day" && number !== 1 ? "s" : ""}`;
}
export function useRatingPreviews(snapshot: Snapshot, id?: string) {
  const history = JSON.stringify(
      id ? (snapshot.history.cards[id] ?? null) : null,
    ),
    root = snapshot.root,
    key = JSON.stringify([root, id, history]);
  const [attempt, setAttempt] = useState(0),
    [result, setResult] = useState<{
      key: string;
      data?: RatingPreviews;
      error?: string;
    }>();
  useEffect(() => {
    if (!id) return;
    let active = true;
    invoke<RatingPreviews>("preview_ratings", { vaultRoot: root, id }).then(
      (data) => {
        if (active) setResult({ key, data });
      },
      (error) => {
        if (active) setResult({ key, error: message(error) });
      },
    );
    return () => {
      active = false;
    };
  }, [id, root, key, attempt]);
  return {
    data: result?.key === key ? result.data : undefined,
    error: result?.key === key ? result.error : undefined,
    retry: () => setAttempt((n) => n + 1),
  };
}
