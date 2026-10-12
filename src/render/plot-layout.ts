/**
 * plot-layout.ts
 *
 * Where a plot draws in world units: its box, the ranges of its two axes, the
 * runs of its curve and the lines of its axes. The painter and the picture
 * export read this one layout through the drawing context.
 *
 * The vertical range comes from `ymin` and `ymax` where each holds a number,
 * and from the samples where it does not, with a twentieth of the span added
 * above and below, so the curve never runs along the edge of the box. A curve
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
  const heights = samples.map((sample) => sample.y);
  const low = heights.length === 0 ? -1 : Math.min(...heights);
  const high = heights.length === 0 ? 1 : Math.max(...heights);
  const centre = (low + high) / 2;
  const span = high > low ? high - low : 1;
  const pad = span / 20;
  const fixedLow = readNumber(object, PLOT_YMIN_PATH);
  const fixedHigh = readNumber(object, PLOT_YMAX_PATH);
  let ymin = fixedLow ?? (high > low ? low - pad : centre - span / 2 - pad);
  let ymax = fixedHigh ?? (high > low ? high + pad : centre + span / 2 + pad);
  if (!(ymax > ymin)) {
    ymin = centre - 1;
    ymax = centre + 1;
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
    if (previous === undefined || sample.x - previous.x > step * 1.5) {
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

/** A number for an axis label, short enough to read at a glance. */
export function plotLabel(value: number): string {
  return String(Number(value.toPrecision(3)));
}
