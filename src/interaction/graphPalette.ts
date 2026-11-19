// Canvas paint uses sRGB values directly, including when rendering startup sprites.
export const graphInk = {
  link: "#29252A",
  focus: "#713138",
  text: "#26232A",
  label: "#454047",
  halo: "rgb(252 250 248 / 87%)",
  frost: "#FCFAF8",
  mark: "#615C63",
} as const;

export function linkOpacity(count: number, zoom: number, focused: boolean) {
  const density = Math.min(0.32, 0.09 * Math.log10(1 + count / 6));
  const magnification = Math.min(1.28, Math.max(0.72, Math.sqrt(zoom)));
  return (
    Math.min(0.75, (0.66 - density) * magnification) * (focused ? 0.61 : 1)
  );
}

export function incident<T>(focus: T | undefined, source: T, target: T) {
  return focus !== undefined && (source === focus || target === focus);
}
