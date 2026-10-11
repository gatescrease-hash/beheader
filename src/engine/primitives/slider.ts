/**
 * slider.ts
 *
 * The slot paths of a slider, its defaults, and the rule that turns a place
 * along its track into the value the knob writes.
 *
 * A slider holds one number in `value`, which other objects read. The knob
 * maps a fraction of the track to a number between `min` and `max`, rounded to
 * the nearest multiple of `step` counted from `min`, and held to the ends. The
 * rounding works from `min` rather than from zero, so a slider from 0.5 to 2.5
 * in steps of 1 stops at 0.5, 1.5 and 2.5. A step of 0 or less stops anywhere.
 *
 * The value a slider holds can sit outside its range, because a typed value or
 * a formula writes it too, and the range only governs the knob. So the drawing
 * pins the knob to the nearer end rather than the engine refusing the value.
 *
 * Engine-layer code: pure logic with no DOM, window or canvas access, so the
 * tests run headless and the file can move to Rust later.
 */
export const SLIDER_WIDTH_PATH: readonly string[] = ["width"];
export const SLIDER_MIN_PATH: readonly string[] = ["min"];
export const SLIDER_MAX_PATH: readonly string[] = ["max"];
export const SLIDER_STEP_PATH: readonly string[] = ["step"];
export const SLIDER_VALUE_PATH: readonly string[] = ["value"];

/** The height of a slider's box, in world units, which holds the value and the track below it. */
export const SLIDER_HEIGHT = 32;

export const DEFAULT_SLIDER_WIDTH = 200;
export const DEFAULT_SLIDER_MIN = 0;
export const DEFAULT_SLIDER_MAX = 10;
export const DEFAULT_SLIDER_STEP = 1;
export const DEFAULT_SLIDER_VALUE = 5;

/** The most decimals a stepped value keeps, past which a decimal step adds nothing an operator could see. */
const MAX_STEP_DECIMALS = 12;

/** The decimals in the shortest text of a number. */
function decimalsOf(value: number): number {
  const text = String(value);
  if (text.includes("e")) return MAX_STEP_DECIMALS;
  const point = text.indexOf(".");
  return point < 0 ? 0 : text.length - point - 1;
}

/**
 * The value the knob writes at a fraction of the track, from 0 at the left end
 * to 1 at the right. A range whose `max` is not above its `min` writes `min`.
 * The result keeps the decimals of `min` and `step`, so a step of 0.1 writes
 * 0.3 rather than 0.30000000000000004.
 */
export function sliderValueAt(fraction: number, min: number, max: number, step: number): number {
  if (!(max > min)) {
    return min;
  }
  const held = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));
  const raw = min + held * (max - min);
  if (!(step > 0)) {
    return raw;
  }
  const stops = Math.round((raw - min) / step);
  const stepped = Math.min(max, Math.max(min, min + stops * step));
  return Number(stepped.toFixed(Math.min(MAX_STEP_DECIMALS, Math.max(decimalsOf(min), decimalsOf(step)))));
}

/**
 * Where the knob of a value sits along the track, from 0 to 1, pinned to the
 * nearer end for a value outside the range. A range whose `max` is not above
 * its `min` puts the knob at the left end.
 */
export function sliderFraction(value: number, min: number, max: number): number {
  if (!(max > min) || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}
