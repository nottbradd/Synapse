import type { HostedStatus } from "./study";

export function resetTime(timestamp: number, timezone: string) {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: timezone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(timestamp * 1000);
}
export function hostedMessage(reason: string | null) {
  switch (reason) {
    case "daily_allowance":
      return "Your daily allowance is used. It renews at the reset time below.";
    case "shared_budget":
      return "The shared service budget is exhausted. The owner must review funding.";
    case "service_paused":
      return "Synapse AI is paused by the owner.";
    case "service_expired":
      return "The service period has ended. The owner must explicitly extend it.";
    case "generation_active":
      return "A generation is active or awaiting confirmation on your account.";
    case "rate_limit":
      return "The per-minute allowance is used. Wait before generating again.";
    case null:
      return "";
    default:
      return "Synapse AI is unavailable. Your saved study material is available offline.";
  }
}
export function allowanceText(status: HostedStatus, timezone: string) {
  return `${status.remaining} / ${status.daily_limit} left today · resets ${resetTime(status.reset_at, timezone)}`;
}
