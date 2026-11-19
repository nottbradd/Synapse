export function layer(name: string, deadline: number) {
  const element = document.createElement("div");
  element.className = `swarm-overlay ${name}`;
  element.setAttribute("aria-hidden", "true");
  element.style.animationDuration = `${deadline}ms`;
  const canvas = document.createElement("canvas");
  const ratio = Math.min(
    devicePixelRatio || 1,
    2,
    Math.sqrt(8_000_000 / (innerWidth * innerHeight)),
  );
  canvas.width = Math.ceil(innerWidth * ratio);
  canvas.height = Math.ceil(innerHeight * ratio);
  canvas.style.width = `${innerWidth}px`;
  canvas.style.height = `${innerHeight}px`;
  element.append(canvas);
  const ctx = canvas.getContext("2d")!;
  ctx.scale(ratio, ratio);
  return {
    element,
    ctx,
    clear: () => ctx.clearRect(0, 0, innerWidth, innerHeight),
  };
}
