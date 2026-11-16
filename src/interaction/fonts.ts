export const LABEL_FONT = "400 14px Geist";
export const CAPTION_FONT = "500 14px Manrope";
export class TextMeasurements {
  private cache = new Map<string, number>();
  revision = 0;
  ready = false;
  invalidate() {
    this.cache.clear();
    this.revision++;
  }
  width(
    ctx: Pick<CanvasRenderingContext2D, "measureText">,
    font: string,
    text: string,
  ) {
    const key = `${font}:${text}`;
    let value = this.cache.get(key);
    if (value === undefined) {
      value = ctx.measureText(text).width;
      this.cache.set(key, value);
    }
    return value;
  }
}
export function watchFonts(
  measurements: TextMeasurements,
  onChange: () => void,
) {
  let alive = true;
  const refresh = () => {
    if (alive) {
      measurements.ready = true;
      measurements.invalidate();
      onChange();
    }
  };
  void Promise.all([
    document.fonts.load(LABEL_FONT, "Synapse əʃʒθðŋɹɪ"),
    document.fonts.load(CAPTION_FONT),
  ])
    .then(refresh)
    .catch(refresh);
  document.fonts.addEventListener("loadingdone", refresh);
  return () => {
    alive = false;
    document.fonts.removeEventListener("loadingdone", refresh);
  };
}
