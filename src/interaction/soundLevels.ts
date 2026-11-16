// Event intent levels, before material/register gain and the output bus.
// Shared with the reference renders so tests cannot silently use louder fixtures.
export const ARRIVAL_LEVEL = 0.35;
export function actionLevel(kind: string) {
  return kind === "forgot" || kind === "error"
    ? 0.52
    : kind === "import" || kind === "draft"
      ? 0.55
      : kind === "remembered"
        ? 0.65
        : 0.8;
}
