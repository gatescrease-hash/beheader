/**
 * plot-layout.ts
 *
 * Where a plot draws in world units: its box, the ranges of its two axes, the
 * runs of its curve and the lines of its axes. The painter and the picture
 * export read this one layout through the drawing context.
 *
 * The vertical range comes from `ymin` and `ymax` where each holds a number,
 * and from the samples where it does not, with a twentieth of the span added
 * above and below, so the curve never runs along the edge of the box. The
 * samples next to a pole are left out of the fit, which fittedRange explains. A curve
 * with one height everywhere takes a span of one around that height, because a
 * span of nothing would divide by zero.
 *
 * The curve breaks where samples are missing, which is where the export gave
 * no finite number, so a pole draws as two runs rather than as a line through
 * the gap.
 *
 * Render-layer code: it reads slot values and touches no DOM.
 */
import {
  getSlot,
  type GraphObject,
  objectBox,
  PLOT_SAMPLE_COUNT,
  PLOT_SAMPLES_PATH,
  PLOT_VARIABLE_PATH,
  PLOT_XMAX_PATH,
  PLOT_XMIN_PATH,
  PLOT_YMAX_PATH,
  PLOT_YMIN_PATH,
  type Point,
} from "../engine/index.ts";
import type { WorldExtent } from "./extent.ts";
import { readNumber } from "./slots.ts";

export interface PlotLayout {
  readonly box: WorldExtent;
  /** The name of the input along the horizontal axis. */
  readonly variable: string;
  readonly xmin: number;
  readonly xmax: number;
  readonly ymin: number;
  readonly ymax: number;
  /** The runs of the curve, each a list of world points, broken at each gap in the samples. */
  readonly runs: readonly (readonly Point[])[];
  /** The world height of the horizontal axis, where zero lies inside the vertical range. */
  readonly axisY: number | undefined;
  /** The world position of the vertical axis, where zero lies inside the horizontal range. */
  readonly axisX: number | undefined;
}

/** The layout of a plot, or undefined for a plot with no box or no range. */
export function plotLayout(object: GraphObject): PlotLayout | undefined {
  const box = objectBox(object, (path) => getSlot(object, path)?.value);
  const xmin = readNumber(object, PLOT_XMIN_PATH);
  const xmax = readNumber(object, PLOT_XMAX_PATH);
  if (box === undefined || xmin === undefined || xmax === undefined || !(xmax > xmin)) {
    return undefined;
  }
  const value = getSlot(object, PLOT_SAMPLES_PATH)?.value;
  const samples = Array.isArray(value) ? (value as readonly Point[]) : [];
  const [low, high] = fittedRange(samples.map((sample) => sample.y));
  const span = high > low ? high - low : 1;
  const pad = span / 20;
  const autoLow = high > low ? low - pad : (low + high) / 2 - span / 2 - pad;
  const autoHigh = high > low ? high + pad : (low + high) / 2 + span / 2 + pad;
  const fixedLow = readNumber(object, PLOT_YMIN_PATH);
  const fixedHigh = readNumber(object, PLOT_YMAX_PATH);
  // A fixed end holds, and the other end keeps clear of it by the fitted span.
  let ymin = fixedLow ?? (fixedHigh !== undefined && !(autoLow < fixedHigh) ? fixedHigh - (autoHigh - autoLow) : autoLow);
  let ymax = fixedHigh ?? (fixedLow !== undefined && !(autoHigh > fixedLow) ? fixedLow + (autoHigh - autoLow) : autoHigh);
  if (!(ymax > ymin)) {
    ymin = (ymin + ymax) / 2 - 1;
    ymax = ymin + 2;
  }
  const toWorld = (point: Point): Point => ({
    x: box.minX + ((point.x - xmin) / (xmax - xmin)) * (box.maxX - box.minX),
    y: box.maxY - ((point.y - ymin) / (ymax - ymin)) * (box.maxY - box.minY),
  });
  // Two samples further apart than one and a half steps had a gap between them.
  const step = (xmax - xmin) / (PLOT_SAMPLE_COUNT - 1);
  const runs: Point[][] = [];
  let previous: Point | undefined;
  for (const sample of samples) {
    // A pole between two samples puts them past opposite ends of the range,
    // and the curve breaks there as it does at a pole a sample lands on.
    const across = previous !== undefined && ((previous.y > ymax && sample.y < ymin) || (previous.y < ymin && sample.y > ymax));
    if (previous === undefined || sample.x - previous.x > step * 1.5 || across) {
      runs.push([]);
    }
    runs[runs.length - 1]!.push(toWorld(sample));
    previous = sample;
  }
  const variable = getSlot(object, PLOT_VARIABLE_PATH)?.value;
  return {
    box,
    variable: typeof variable === "string" ? variable : "",
    xmin,
    xmax,
    ymin,
    ymax,
    runs,
    axisY: ymin <= 0 && ymax >= 0 ? toWorld({ x: xmin, y: 0 }).y : undefined,
    axisX: xmin <= 0 && xmax >= 0 ? toWorld({ x: 0, y: ymin }).x : undefined,
  };
}

/**
 * The fitted vertical range of a set of heights: from the lowest to the
 * highest, except that a tail far past the bulk of the heights is left out,
 * because the heights next to a pole run toward infinity and a range that held
 * them would flatten the rest of the curve onto one line. A tail is far when it
 * runs more than twice the span of the middle nine tenths past it.
 */
export function fittedRange(heights: readonly number[]): readonly [number, number] {
  if (heights.length === 0) {
    return [-1, 1];
  }
  const sorted = [...heights].sort((a, b) => a - b);
  const lowBulk = sorted[Math.floor(0.05 * (sorted.length - 1))]!;
  const highBulk = sorted[Math.ceil(0.95 * (sorted.length - 1))]!;
  const bulk = highBulk - lowBulk;
  const lowest = sorted[0]!;
  const highest = sorted[sorted.length - 1]!;
  return [lowBulk - lowest <= 2 * bulk ? lowest : lowBulk, highest - highBulk <= 2 * bulk ? highest : highBulk];
}

/** A number for an axis label, short enough to read at a glance. */
export function plotLabel(value: number): string {
  return String(Number(value.toPrecision(3)));
}
