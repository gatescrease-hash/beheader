/**
 * plot-layout.test.ts
 *
 * These tests cover where a plot draws: samples map from the plot's units onto
 * its box, the vertical range fits the samples unless ymin and ymax hold
 * numbers, a gap in the samples breaks the curve, and the axes draw only where
 * zero lies in range.
 */
import { describe, expect, it } from "vitest";
import type { GraphObject, Point, Value } from "../engine/index.ts";
import { plotLabel, plotLayout } from "./plot-layout.ts";

function plot(samples: readonly Point[], ranges: { xmin?: number; xmax?: number; ymin?: Value; ymax?: Value } = {}): GraphObject {
  const literal = (value: Value) => ({ kind: "literal" as const, value });
  return {
    id: "p",
    name: "plot_1",
    type: "plot",
    slots: {
      "origin.x": literal(100),
      "origin.y": literal(50),
      width: literal(200),
      height: literal(100),
      variable: literal("x"),
      xmin: literal(ranges.xmin ?? 0),
      xmax: literal(ranges.xmax ?? 2),
      ymin: literal(ranges.ymin ?? null),
      ymax: literal(ranges.ymax ?? null),
      samples: { kind: "derived", value: samples },
    },
  };
}

describe("plotLayout", () => {
  it("maps each sample onto the box, the low end of the vertical range at the bottom", () => {
    // Two neighbouring samples, one step of 2/200 apart, so they make one run.
    const layout = plotLayout(plot([{ x: 0, y: 0 }, { x: 0.01, y: 10 }], { ymin: 0, ymax: 10 }))!;
    expect(layout.runs).toEqual([[{ x: 100, y: 150 }, { x: 101, y: 50 }]]);
  });

  it("fits the vertical range to the samples with a twentieth of the span above and below", () => {
    const layout = plotLayout(plot([{ x: 0, y: 0 }, { x: 2, y: 20 }]))!;
    expect(layout.ymin).toBe(-1);
    expect(layout.ymax).toBe(21);
  });

  it("takes a span of one around a curve with one height everywhere", () => {
    const layout = plotLayout(plot([{ x: 0, y: 5 }, { x: 2, y: 5 }]))!;
    expect(layout.ymax - layout.ymin).toBeCloseTo(1.1);
  });

  it("breaks the curve where samples are missing", () => {
    const step = 2 / 200;
    const layout = plotLayout(plot([{ x: 0, y: 1 }, { x: step, y: 1 }, { x: 10 * step, y: 1 }]))!;
    expect(layout.runs.map((run) => run.length)).toEqual([2, 1]);
  });

  it("draws an axis only where zero lies in range", () => {
    const inside = plotLayout(plot([{ x: 0, y: -1 }, { x: 2, y: 1 }], { xmin: -1, xmax: 1 }))!;
    expect(inside.axisX).toBe(200);
    expect(inside.axisY).toBeDefined();
    const outside = plotLayout(plot([{ x: 0, y: 5 }, { x: 2, y: 6 }], { xmin: 1, xmax: 2 }))!;
    expect(outside.axisX).toBeUndefined();
    expect(outside.axisY).toBeUndefined();
  });

  it("gives no layout for a range that runs backwards", () => {
    expect(plotLayout(plot([], { xmin: 3, xmax: 1 }))).toBeUndefined();
  });

  it("writes a label short enough to read at a glance", () => {
    expect(plotLabel(3.14159)).toBe("3.14");
    expect(plotLabel(-10)).toBe("-10");
  });
});
