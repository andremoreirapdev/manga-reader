export function clamp(value: number, min: number, max: number) {
  "worklet";

  return Math.max(min, Math.min(max, value));
}

export function panLimit(image: number, viewport: number, scale: number) {
  "worklet";

  return Math.max(0, (image * scale - viewport) / 2);
}

export function swipePage(dx: number, dy: number, scale: number, multiple: boolean) {
  "worklet";

  if (multiple || scale > 1 || Math.abs(dx) < 55 || Math.abs(dx) < Math.abs(dy) * 1.5) {
    return 0;
  }

  return dx > 0 ? 1 : -1;
}

export function focalOffset(focal: number, offset: number, ratio: number) {
  "worklet";

  return focal - (focal - offset) * ratio;
}
