/**
 * slider-layout.ts
 *
 * Where the parts of a slider sit in world units: its box, its track, and its
 * knob. The painter, the hit test and the knob drag all read this one layout,
 * so the knob a press grabs is the knob the canvas draws.
 *
 * The box runs from the origin across the slider's width and down a fixed
 * height. The track runs along the lower part of the box, inset by the radius
 * of the knob at each end, so the knob stays inside the box at either end of
 * its travel. The value prints above the right end of the track.
 *
 * Render-layer code: it reads slot values and touches no DOM.
 */
import {
  DEFAULT_SLIDER_WIDTH,
  type GraphObject,
  ORIGIN_X_PATH,
  ORIGIN_Y_PATH,
  SLIDER_MAX_PATH,
  SLIDER_HEIGHT,
  SLIDER_MIN_PATH,
  SLIDER_STEP_PATH,
  SLIDER_VALUE_PATH,
  SLIDER_WIDTH_PATH,
  sliderFraction,
  sliderValueAt,
  type Value,
} from "../engine/index.ts";
import type { WorldExtent } from "./extent.ts";
import { readNumber } from "./slots.ts";

/** The radius of the knob, in world units. */
export const SLIDER_KNOB_RADIUS = 7;

/** How far below the top of the box the track runs, in world units. */
export const SLIDER_TRACK_OFFSET = 22;

/** The narrowest track a slider draws, so a slider of no width still has a knob to grab. */
const MIN_TRACK_LENGTH = 1;

export interface SliderLayout {
  readonly box: WorldExtent;
  readonly trackStart: number;
  readonly trackEnd: number;
  readonly trackY: number;
  readonly knobX: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  /** What `value` holds now, which can be a number outside the range or no number at all. */
  readonly value: Value | undefined;
  /** True when a formula drives `value`, so the knob holds still. */
  readonly held: boolean;
}

/** The layout of a slider, or undefined for a slider with no number in its origin. */
export function sliderLayout(object: GraphObject): SliderLayout | undefined {
  const x = readNumber(object, ORIGIN_X_PATH);
  const y = readNumber(object, ORIGIN_Y_PATH);
  if (x === undefined || y === undefined) {
    return undefined;
  }
  const width = readNumber(object, SLIDER_WIDTH_PATH);
  const boxWidth = width !== undefined && width > 0 ? width : DEFAULT_SLIDER_WIDTH;
  const trackStart = x + SLIDER_KNOB_RADIUS;
  const trackEnd = Math.max(trackStart + MIN_TRACK_LENGTH, x + boxWidth - SLIDER_KNOB_RADIUS);
  const min = readNumber(object, SLIDER_MIN_PATH) ?? 0;
  const max = readNumber(object, SLIDER_MAX_PATH) ?? 0;
  const step = readNumber(object, SLIDER_STEP_PATH) ?? 0;
  const slot = object.slots[SLIDER_VALUE_PATH.join(".")];
  const value = slot?.value;
  const fraction = typeof value === "number" ? sliderFraction(value, min, max) : 0;
  return {
    box: { minX: x, minY: y, maxX: x + boxWidth, maxY: y + SLIDER_HEIGHT },
    trackStart,
    trackEnd,
    trackY: y + SLIDER_TRACK_OFFSET,
    knobX: trackStart + fraction * (trackEnd - trackStart),
    min,
    max,
    step,
    value,
    held: slot !== undefined && slot.kind !== "literal",
  };
}

/**
 * True when a world point lies on the track, within the knob's radius and a
 * tolerance of it, from end to end. A press there grabs the knob.
 */
export function onSliderTrack(layout: SliderLayout, point: { readonly x: number; readonly y: number }, tolerance: number): boolean {
  const reach = SLIDER_KNOB_RADIUS + tolerance;
  return Math.abs(point.y - layout.trackY) <= reach && point.x >= layout.trackStart - reach && point.x <= layout.trackEnd + reach;
}

/** The value the knob writes with the pointer at a world x. */
export function sliderValueUnder(layout: SliderLayout, x: number): number {
  return sliderValueAt((x - layout.trackStart) / (layout.trackEnd - layout.trackStart), layout.min, layout.max, layout.step);
}
