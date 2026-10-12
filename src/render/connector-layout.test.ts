/**
 * connector-layout.test.ts
 *
 * These tests cover where a connector draws: its line stops at the base of
 * each arrowhead, a head grows with the stroke, and the extent, the hit test
 * and a crossing box all read the same line.
 */
import { describe, expect, it } from "vitest";
import type { GraphObject, Point } from "../engine/index.ts";
import { arrowheadLength, connectorExtent, connectorLayout, distanceToConnector } from "./connector-layout.ts";
import { hitTest } from "./hittest.ts";
import { marqueeUnits } from "./marquee.ts";

function connector(start: Point, end: Point, arrow: string, strokeWidth = 2): GraphObject {
  return {
    id: "c",
    name: "connector_1",
    type: "connector",
    slots: {
      from: { kind: "literal", value: start },
      to: { kind: "literal", value: end },
      arrow: { kind: "literal", value: arrow },
      "style.strokeColor": { kind: "literal", value: "#1a1a1a" },
      "style.strokeWidth": { kind: "literal", value: strokeWidth },
      vertices: { kind: "derived", value: [start, end] },
    },
  };
}

describe("connectorLayout — the line, and a head at each end the arrow slot names", () => {
  it("stops the line at the base of the head at the end, and draws one head there", () => {
    const layout = connectorLayout(connector({ x: 0, y: 0 }, { x: 100, y: 0 }, "end"))!;
    const length = arrowheadLength(2);
    expect(layout.lineStart).toEqual({ x: 0, y: 0 });
    expect(layout.lineEnd).toEqual({ x: 100 - length, y: 0 });
    expect(layout.heads).toHaveLength(1);
    expect(layout.heads[0]![0]).toEqual({ x: 100, y: 0 });
  });

  it("draws a head at each end for both, at the start alone for start, and none for none", () => {
    expect(connectorLayout(connector({ x: 0, y: 0 }, { x: 100, y: 0 }, "both"))!.heads).toHaveLength(2);
    expect(connectorLayout(connector({ x: 0, y: 0 }, { x: 100, y: 0 }, "start"))!.heads[0]![0]).toEqual({ x: 0, y: 0 });
    const plain = connectorLayout(connector({ x: 0, y: 0 }, { x: 100, y: 0 }, "none"))!;
    expect(plain.heads).toEqual([]);
    expect(plain.lineEnd).toEqual({ x: 100, y: 0 });
  });

  it("gives a heavier line a larger head", () => {
    expect(arrowheadLength(4)).toBeGreaterThan(arrowheadLength(1));
  });

  it("shrinks two heads on a short line so they share it rather than cross", () => {
    const layout = connectorLayout(connector({ x: 0, y: 0 }, { x: 10, y: 0 }, "both"))!;
    expect(layout.lineStart.x).toBeLessThanOrEqual(layout.lineEnd.x);
  });

  it("gives no layout for a connector with no line", () => {
    expect(connectorLayout({ ...connector({ x: 0, y: 0 }, { x: 1, y: 0 }, "end"), slots: { vertices: { kind: "derived", value: null } } })).toBeUndefined();
  });

  it("boxes the line and its heads, and measures the distance to the line from tip to tip", () => {
    const layout = connectorLayout(connector({ x: 0, y: 0 }, { x: 100, y: 0 }, "end"))!;
    const extent = connectorExtent(layout);
    expect(extent.minX).toBe(0);
    expect(extent.maxX).toBe(100);
    expect(extent.maxY).toBeGreaterThan(0);
    expect(distanceToConnector(layout, { x: 50, y: 7 })).toBe(7);
    expect(distanceToConnector(layout, { x: 130, y: 0 })).toBe(30);
  });
});

describe("a connector on the canvas", () => {
  const camera = { x: 0, y: 0, zoom: 1 };
  const line = connector({ x: 0, y: 50 }, { x: 200, y: 50 }, "end");

  it("hits along its line and nowhere off it", () => {
    expect(hitTest({ x: 100, y: 52 }, [line], camera)?.id).toBe("c");
    expect(hitTest({ x: 100, y: 80 }, [line], camera)).toBeUndefined();
  });

  it("is taken by a crossing box the line runs through, and by a window only when it lies wholly inside", () => {
    expect(marqueeUnits([line], { minX: 90, minY: 40, maxX: 110, maxY: 60 }, "crossing")).toEqual(["c"]);
    expect(marqueeUnits([line], { minX: 90, minY: 60, maxX: 110, maxY: 80 }, "crossing")).toEqual([]);
    expect(marqueeUnits([line], { minX: 90, minY: 40, maxX: 110, maxY: 60 }, "window")).toEqual([]);
    expect(marqueeUnits([line], { minX: -10, minY: 30, maxX: 210, maxY: 70 }, "window")).toEqual(["c"]);
  });
});
