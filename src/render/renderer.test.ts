/**
 * renderer.test.ts
 *
 * The three passes, drawn against a canvas stub that records each call.
 * It asserts the call order, not pixels.
 */

import { describe, expect, it } from "vitest";
import {
  type CameraState,
  getObjectSchema,
  type GraphObject,
  mutate,
  resolveDerivedSlots,
  type Slot,
} from "../engine/index.ts";
import { renderDocument } from "./renderer.ts";
import type { ImageBitmaps } from "./images.ts";
import { objectExtent } from "./extent.ts";
import { SCRIPT_BOX_WIDTH, SCRIPT_HEADER_HEIGHT, SCRIPT_PORT_ROW_HEIGHT } from "./slots.ts";

type RecordedCall =
  | { readonly op: "clearRect"; readonly x: number; readonly y: number; readonly w: number; readonly h: number }
  | { readonly op: "setTransform"; readonly a: number; readonly b: number; readonly c: number; readonly d: number; readonly e: number; readonly f: number }
  | { readonly op: "beginPath" }
  | { readonly op: "moveTo"; readonly x: number; readonly y: number }
  | { readonly op: "lineTo"; readonly x: number; readonly y: number }
  | { readonly op: "closePath" }
  | { readonly op: "stroke" }
  | { readonly op: "fill" }
  | { readonly op: "arc"; readonly x: number; readonly y: number; readonly radius: number; readonly startAngle: number; readonly endAngle: number }
  | { readonly op: "bezierCurveTo"; readonly c1x: number; readonly c1y: number; readonly c2x: number; readonly c2y: number; readonly x: number; readonly y: number }
  | { readonly op: "strokeRect"; readonly x: number; readonly y: number; readonly w: number; readonly h: number }
  | { readonly op: "fillRect"; readonly x: number; readonly y: number; readonly w: number; readonly h: number }
  | { readonly op: "fillText"; readonly text: string; readonly x: number; readonly y: number; readonly align: string }
  | { readonly op: "drawImage"; readonly image: unknown; readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly alpha: number };

const FAKE_CHAR_WIDTH = 7;

/** What the context held at the moment it painted. It records colour, which `calls` does not. */
interface RecordedPaint {
  readonly op: "fill" | "stroke";
  readonly color: string;
  readonly lineWidth: number;
}

function createFakeContext(): {
  readonly ctx: CanvasRenderingContext2D;
  readonly calls: readonly RecordedCall[];
  readonly fonts: readonly string[];
  readonly paints: readonly RecordedPaint[];
  readonly strokeColors: readonly string[];
} {
  const calls: RecordedCall[] = [];
  const fonts: string[] = [];
  const paints: RecordedPaint[] = [];
  const strokeColors: string[] = [];
  let strokeStyle = "";
  const ctx = {
    fillStyle: "",
    get strokeStyle() {
      return strokeStyle;
    },
    set strokeStyle(value: string) {
      strokeStyle = value;
      strokeColors.push(value);
    },
    lineWidth: 1,
    textAlign: "left",
    textBaseline: "alphabetic",
    set font(value: string) {
      fonts.push(value);
    },
    get font() {
      return fonts[fonts.length - 1] ?? "";
    },
    setTransform(a: number, b: number, c: number, d: number, e: number, f: number) {
      calls.push({ op: "setTransform", a, b, c, d, e, f });
    },
    clearRect(x: number, y: number, w: number, h: number) {
      calls.push({ op: "clearRect", x, y, w, h });
    },
    beginPath() {
      calls.push({ op: "beginPath" });
    },
    moveTo(x: number, y: number) {
      calls.push({ op: "moveTo", x, y });
    },
    lineTo(x: number, y: number) {
      calls.push({ op: "lineTo", x, y });
    },
    closePath() {
      calls.push({ op: "closePath" });
    },
    stroke() {
      calls.push({ op: "stroke" });
      paints.push({ op: "stroke", color: ctx.strokeStyle as string, lineWidth: ctx.lineWidth });
    },
    fill() {
      calls.push({ op: "fill" });
      paints.push({ op: "fill", color: ctx.fillStyle as string, lineWidth: ctx.lineWidth });
    },
    arc(x: number, y: number, radius: number, startAngle: number, endAngle: number) {
      calls.push({ op: "arc", x, y, radius, startAngle, endAngle });
    },
    bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number) {
      calls.push({ op: "bezierCurveTo", c1x, c1y, c2x, c2y, x, y });
    },
    strokeRect(x: number, y: number, w: number, h: number) {
      calls.push({ op: "strokeRect", x, y, w, h });
    },
    fillRect(x: number, y: number, w: number, h: number) {
      calls.push({ op: "fillRect", x, y, w, h });
    },
    fillText(text: string, x: number, y: number) {
      calls.push({ op: "fillText", text, x, y, align: ctx.textAlign });
    },
    globalAlpha: 1,
    drawImage(image: unknown, x: number, y: number, w: number, h: number) {
      calls.push({ op: "drawImage", image, x, y, w, h, alpha: ctx.globalAlpha });
    },
    measureText(text: string) {
      return { width: text.length * FAKE_CHAR_WIDTH };
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls, fonts, paints, strokeColors };
}

const CAMERA_IDENTITY: CameraState = { x: 0, y: 0, zoom: 1 };

function derivedPlaceholder(): Slot {
  return { kind: "derived", value: null };
}

describe("renderDocument — clear and camera transform", () => {
  it("clears the whole viewport at identity transform before applying the camera transform", () => {
    const { ctx, calls } = createFakeContext();
    renderDocument(ctx, 800, 600, [], CAMERA_IDENTITY);
    expect(calls[0]).toEqual({ op: "setTransform", a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
    expect(calls[1]).toEqual({ op: "clearRect", x: 0, y: 0, w: 800, h: 600 });
  });

  it("applies the camera transform via the SAME formula render/camera.ts's worldToScreen uses", () => {
    const { ctx, calls } = createFakeContext();
    const camera: CameraState = { x: 10, y: 20, zoom: 2 };
    renderDocument(ctx, 800, 600, [], camera);
    expect(calls[2]).toEqual({ op: "setTransform", a: 2, b: 0, c: 0, d: 2, e: -20, f: -40 });
  });

  it("passes RAW WORLD coordinates to every draw call under a non-identity camera — the canvas transform does the conversion, never a second per-vertex worldToScreen", () => {
    const { ctx, calls } = createFakeContext();
    const camera: CameraState = { x: 10, y: 20, zoom: 2 };
    const circle: GraphObject = {
      id: "obj_1",
      name: "circle_1",
      type: "circle",
      slots: {
        "origin.x": { kind: "literal", value: 3 },
        "origin.y": { kind: "literal", value: 4 },
        radius: { kind: "literal", value: 10 },
      },
    };
    renderDocument(ctx, 800, 600, [circle], camera);
    expect(calls.filter((call) => call.op === "arc")).toEqual([{ op: "arc", x: 3, y: 4, radius: 10, startAngle: 0, endAngle: Math.PI * 2 }]);
  });

  it("draws objects in array order (z-order, disclosed as document order — see file header)", () => {
    const { ctx, calls } = createFakeContext();
    const circleA: GraphObject = {
      id: "obj_1",
      name: "circle_a",
      type: "circle",
      slots: { "origin.x": { kind: "literal", value: 0 }, "origin.y": { kind: "literal", value: 0 }, radius: { kind: "literal", value: 1 } },
    };
    const circleB: GraphObject = {
      id: "obj_2",
      name: "circle_b",
      type: "circle",
      slots: { "origin.x": { kind: "literal", value: 5 }, "origin.y": { kind: "literal", value: 5 }, radius: { kind: "literal", value: 2 } },
    };
    renderDocument(ctx, 800, 600, [circleA, circleB], CAMERA_IDENTITY);
    const arcCalls = calls.filter((call): call is Extract<RecordedCall, { op: "arc" }> => call.op === "arc");
    expect(arcCalls.map((call) => call.radius)).toEqual([1, 2]);
  });
});

describe("renderDocument — circle: true arc, never the polygonal approximation", () => {
  it("draws ctx.arc from origin.x/origin.y/radius directly, with no vertices slot present at all", () => {
    const { ctx, calls } = createFakeContext();
    const circle: GraphObject = {
      id: "obj_1",
      name: "circle_1",
      type: "circle",
      slots: {
        "origin.x": { kind: "literal", value: 3 },
        "origin.y": { kind: "literal", value: 4 },
        radius: { kind: "literal", value: 10 },
      },
    };
    renderDocument(ctx, 800, 600, [circle], CAMERA_IDENTITY);
    const arcCalls = calls.filter((call) => call.op === "arc");
    const lineToCalls = calls.filter((call) => call.op === "lineTo");
    expect(arcCalls).toEqual([{ op: "arc", x: 3, y: 4, radius: 10, startAngle: 0, endAngle: Math.PI * 2 }]);
    expect(lineToCalls).toEqual([]);
  });

  it("draws nothing for a circle with a missing radius slot (never throws)", () => {
    const { ctx, calls } = createFakeContext();
    const circle: GraphObject = {
      id: "obj_1",
      name: "circle_1",
      type: "circle",
      slots: { "origin.x": { kind: "literal", value: 0 }, "origin.y": { kind: "literal", value: 0 } },
    };
    expect(() => renderDocument(ctx, 800, 600, [circle], CAMERA_IDENTITY)).not.toThrow();
    expect(calls.some((call) => call.op === "arc")).toBe(false);
  });

  it("draws nothing for a negative radius", () => {
    const { ctx, calls } = createFakeContext();
    const circle: GraphObject = {
      id: "obj_1",
      name: "circle_1",
      type: "circle",
      slots: { "origin.x": { kind: "literal", value: 0 }, "origin.y": { kind: "literal", value: 0 }, radius: { kind: "literal", value: -1 } },
    };
    renderDocument(ctx, 800, 600, [circle], CAMERA_IDENTITY);
    expect(calls.some((call) => call.op === "arc")).toBe(false);
  });
});

describe("renderDocument — polygon/rect: the closed path vertices describes", () => {
  it("strokes moveTo(first) -> lineTo(rest) -> closePath -> stroke, in order", () => {
    const { ctx, calls } = createFakeContext();
    const rect: GraphObject = {
      id: "obj_1",
      name: "rect_1",
      type: "rect",
      slots: {
        vertices: {
          kind: "derived",
          value: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 5 },
            { x: 0, y: 5 },
          ],
        },
      },
    };
    renderDocument(ctx, 800, 600, [rect], CAMERA_IDENTITY);
    const shapeCalls = calls.filter((call) => call.op !== "setTransform" && call.op !== "clearRect" && call.op !== "fillText");
    expect(shapeCalls).toEqual([
      { op: "beginPath" },
      { op: "moveTo", x: 0, y: 0 },
      { op: "lineTo", x: 10, y: 0 },
      { op: "lineTo", x: 10, y: 5 },
      { op: "lineTo", x: 0, y: 5 },
      { op: "closePath" },
      { op: "stroke" },
    ]);
  });

  it("draws nothing when vertices holds an ErrorValue", () => {
    const { ctx, calls } = createFakeContext();
    const polygon: GraphObject = {
      id: "obj_1",
      name: "polygon_1",
      type: "polygon",
      slots: { vertices: { kind: "derived", value: { error: "#TYPE", message: "broken" } } },
    };
    renderDocument(ctx, 800, 600, [polygon], CAMERA_IDENTITY);
    expect(calls.some((call) => call.op === "beginPath")).toBe(false);
  });

  it("draws nothing when vertices is empty", () => {
    const { ctx, calls } = createFakeContext();
    const polygon: GraphObject = { id: "obj_1", name: "polygon_1", type: "polygon", slots: { vertices: { kind: "derived", value: [] } } };
    renderDocument(ctx, 800, 600, [polygon], CAMERA_IDENTITY);
    expect(calls.some((call) => call.op === "beginPath")).toBe(false);
  });
});

describe("renderDocument — table: fixed-size grid, alignment", () => {
  function tableObject(slots: Readonly<Record<string, Slot>>): GraphObject {
    return { id: "obj_1", name: "table_1", type: "table", slots: { rows: { kind: "literal", value: 1 }, cols: { kind: "literal", value: 3 }, ...slots } };
  }

  it("draws rows * cols cell borders", () => {
    const { ctx, calls } = createFakeContext();
    const table: GraphObject = { id: "obj_1", name: "table_1", type: "table", slots: { rows: { kind: "literal", value: 2 }, cols: { kind: "literal", value: 3 } } };
    renderDocument(ctx, 800, 600, [table], CAMERA_IDENTITY);
    expect(calls.filter((call) => call.op === "strokeRect")).toHaveLength(6);
  });

  it("right-aligns a number, left-aligns a string, formats a boolean and an error, and leaves null/unset blank", () => {
    const { ctx, calls } = createFakeContext();
    const table = tableObject({
      "cells.A1": { kind: "literal", value: 42 },
      "cells.B1": { kind: "literal", value: "hello" },
      "cells.C1": { kind: "literal", value: true },
    });
    renderDocument(ctx, 800, 600, [table], CAMERA_IDENTITY);
    const textCalls = calls.filter((call): call is Extract<RecordedCall, { op: "fillText" }> => call.op === "fillText");
    expect(textCalls).toEqual([
      { op: "fillText", text: "42", x: 76, y: 12, align: "right" },
      { op: "fillText", text: "hello", x: 84, y: 12, align: "left" },
      { op: "fillText", text: "TRUE", x: 164, y: 12, align: "left" },
      { op: "fillText", text: "table_1", x: 120, y: -22, align: "center" },
      { op: "fillText", text: "A", x: 40, y: -4, align: "center" },
      { op: "fillText", text: "B", x: 120, y: -4, align: "center" },
      { op: "fillText", text: "C", x: 200, y: -4, align: "center" },
      { op: "fillText", text: "1", x: -4, y: 12, align: "right" },
    ]);
  });

  it("displays an ErrorValue cell as its bare error code, left-aligned", () => {
    const { ctx, calls } = createFakeContext();
    const table = tableObject({ "cells.A1": { kind: "derived", value: { error: "#REF", message: "gone" } } });
    renderDocument(ctx, 800, 600, [table], CAMERA_IDENTITY);
    const textCalls = calls.filter((call) => call.op === "fillText");
    expect(textCalls).toEqual([
      { op: "fillText", text: "#REF", x: 4, y: 12, align: "left" },
      { op: "fillText", text: "table_1", x: 120, y: -22, align: "center" },
      { op: "fillText", text: "!", x: 150.5, y: -22, align: "left" },
      { op: "fillText", text: "A", x: 40, y: -4, align: "center" },
      { op: "fillText", text: "B", x: 120, y: -4, align: "center" },
      { op: "fillText", text: "C", x: 200, y: -4, align: "center" },
      { op: "fillText", text: "1", x: -4, y: 12, align: "right" },
    ]);
  });

  it("draws no CELL text for a null-valued or entirely unset cell — only the name label and the A1 headers", () => {
    const { ctx, calls } = createFakeContext();
    const table = tableObject({ "cells.A1": { kind: "literal", value: null } });
    renderDocument(ctx, 800, 600, [table], CAMERA_IDENTITY);
    const textCalls = calls.filter((call) => call.op === "fillText");
    expect(textCalls).toEqual([
      { op: "fillText", text: "table_1", x: 120, y: -22, align: "center" },
      { op: "fillText", text: "A", x: 40, y: -4, align: "center" },
      { op: "fillText", text: "B", x: 120, y: -4, align: "center" },
      { op: "fillText", text: "C", x: 200, y: -4, align: "center" },
      { op: "fillText", text: "1", x: -4, y: 12, align: "right" },
    ]);
  });

  it("falls back to origin (0,0) when the table has no origin.x/origin.y slots", () => {
    const { ctx, calls } = createFakeContext();
    const table = tableObject({ "cells.A1": { kind: "literal", value: 1 } });
    renderDocument(ctx, 800, 600, [table], CAMERA_IDENTITY);
    const firstBorder = calls.find((call) => call.op === "strokeRect");
    expect(firstBorder).toEqual({ op: "strokeRect", x: 0, y: 0, w: 80, h: 24 });
  });

  it("honors origin.x/origin.y when present", () => {
    const { ctx, calls } = createFakeContext();
    const table = tableObject({ "origin.x": { kind: "literal", value: 100 }, "origin.y": { kind: "literal", value: 200 }, "cells.A1": { kind: "literal", value: 1 } });
    renderDocument(ctx, 800, 600, [table], CAMERA_IDENTITY);
    const firstBorder = calls.find((call) => call.op === "strokeRect");
    expect(firstBorder).toEqual({ op: "strokeRect", x: 100, y: 200, w: 80, h: 24 });
  });
});

describe("renderDocument — object types with no schema/visual definition yet", () => {
  it("draws nothing for a value/add fixture object (Phase 0 only, never on the command line)", () => {
    const { ctx, calls } = createFakeContext();
    const value: GraphObject = { id: "obj_1", name: "value_1", type: "value", slots: { value: { kind: "literal", value: 1 } } };
    renderDocument(ctx, 800, 600, [value], CAMERA_IDENTITY);
    const drawCalls = calls.filter((call) => call.op !== "setTransform" && call.op !== "clearRect");
    expect(drawCalls).toEqual([]);
  });

  it("draws nothing for a slotless image fixture object (no extent, since it has no width or height)", () => {
    const { ctx, calls } = createFakeContext();
    renderDocument(ctx, 800, 600, [{ id: "obj_1", name: "image_1", type: "image", slots: {} }], CAMERA_IDENTITY);
    const drawCalls = calls.filter((call) => call.op !== "setTransform" && call.op !== "clearRect");
    expect(drawCalls).toEqual([]);
  });

  it("draws nothing for a slotless polyline fixture object either — no vertexCount means no vertices to trace", () => {
    const { ctx, calls } = createFakeContext();
    renderDocument(ctx, 800, 600, [{ id: "obj_1", name: "polyline_1", type: "polyline", slots: {} }], CAMERA_IDENTITY);
    const drawCalls = calls.filter((call) => call.op !== "setTransform" && call.op !== "clearRect");
    expect(drawCalls).toEqual([]);
  });
});

describe("renderDocument — the style slots a formula can drive", () => {
  function styledRect(style: Record<string, Slot>): GraphObject {
    return {
      id: "obj_1",
      name: "rect_1",
      type: "rect",
      slots: {
        vertices: {
          kind: "derived",
          value: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 5 },
            { x: 0, y: 5 },
          ],
        },
        ...style,
      },
    };
  }

  it("strokes in the colour and the width the slots hold", () => {
    const { ctx, paints } = createFakeContext();
    renderDocument(ctx, 800, 600, [styledRect({
      "style.strokeColor": { kind: "literal", value: "#ff0000" },
      "style.strokeWidth": { kind: "literal", value: 4 },
    })], CAMERA_IDENTITY);
    expect(paints).toEqual([{ op: "stroke", color: "#ff0000", lineWidth: 4 }]);
  });

  it("falls back to the default outline when a slot holds nothing, a wrong type or an error", () => {
    const { ctx, paints } = createFakeContext();
    renderDocument(ctx, 800, 600, [styledRect({
      "style.strokeColor": { kind: "derived", value: { error: "#TYPE", message: "bad" } },
      "style.strokeWidth": { kind: "literal", value: -3 },
    })], CAMERA_IDENTITY);
    expect(paints).toEqual([{ op: "stroke", color: "#1a1a1a", lineWidth: 1 }]);
  });

  it("writes the default colour just before the slot colour, so an unreadable one never inherits the last shape", () => {
    const { ctx, strokeColors } = createFakeContext();
    renderDocument(ctx, 800, 600, [styledRect({ "style.strokeColor": { kind: "literal", value: "rebeccapurple" } })], CAMERA_IDENTITY);
    expect(strokeColors.slice(0, 2)).toEqual(["#1a1a1a", "rebeccapurple"]);
  });

  it("fills before it strokes, so the outline sits on top of its own fill", () => {
    const { ctx, paints } = createFakeContext();
    renderDocument(ctx, 800, 600, [styledRect({ "style.fillColor": { kind: "literal", value: "#00ff00" } })], CAMERA_IDENTITY);
    expect(paints.map((paint) => paint.op)).toEqual(["fill", "stroke"]);
    expect(paints[0]?.color).toBe("#00ff00");
  });

  it("fills nothing while fillColor holds null, which is what a new shape carries", () => {
    const { ctx, paints } = createFakeContext();
    renderDocument(ctx, 800, 600, [styledRect({ "style.fillColor": { kind: "literal", value: null } })], CAMERA_IDENTITY);
    expect(paints.map((paint) => paint.op)).toEqual(["stroke"]);
  });

  it("fills a closed polyline and never an open one, because an open path bounds no region", () => {
    const vertices = {
      kind: "derived" as const,
      value: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 5 },
      ],
    };
    const fill = { kind: "literal" as const, value: "#00ff00" };
    const open = createFakeContext();
    renderDocument(open.ctx, 800, 600, [{ id: "obj_1", name: "polyline_1", type: "polyline", slots: { vertices, "style.fillColor": fill } }], CAMERA_IDENTITY);
    expect(open.paints.map((paint) => paint.op)).toEqual(["stroke"]);

    const closed = createFakeContext();
    renderDocument(
      closed.ctx,
      800,
      600,
      [{ id: "obj_1", name: "polyline_1", type: "polyline", slots: { vertices, "style.fillColor": fill, closed: { kind: "literal", value: true } } }],
      CAMERA_IDENTITY,
    );
    expect(closed.paints.map((paint) => paint.op)).toEqual(["fill", "stroke"]);
  });

  it("styles a circle the same way, which draws through ctx.arc and not through a point list", () => {
    const { ctx, paints } = createFakeContext();
    const circle: GraphObject = {
      id: "obj_1",
      name: "circle_1",
      type: "circle",
      slots: {
        "origin.x": { kind: "literal", value: 0 },
        "origin.y": { kind: "literal", value: 0 },
        radius: { kind: "literal", value: 5 },
        "style.strokeColor": { kind: "literal", value: "#0000ff" },
        "style.fillColor": { kind: "literal", value: "#ccccff" },
      },
    };
    renderDocument(ctx, 800, 600, [circle], CAMERA_IDENTITY);
    expect(paints).toEqual([
      { op: "fill", color: "#ccccff", lineWidth: 1 },
      { op: "stroke", color: "#0000ff", lineWidth: 1 },
    ]);
  });
});

describe("renderDocument — a polyline draws an open path, unlike the closed vertex shapes", () => {
  it("moves to the first vertex, lines to each of the rest, and never closes back to the first", () => {
    const { ctx, calls } = createFakeContext();
    const polyline: GraphObject = {
      id: "obj_1",
      name: "polyline_1",
      type: "polyline",
      slots: {
        vertices: {
          kind: "derived",
          value: [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 100, y: 100 },
          ],
        },
      },
    };
    renderDocument(ctx, 800, 600, [polyline], CAMERA_IDENTITY);
    const shapeCalls = calls.filter((call) => call.op !== "setTransform" && call.op !== "clearRect" && call.op !== "fillText");
    expect(shapeCalls).toEqual([
      { op: "beginPath" },
      { op: "moveTo", x: 0, y: 0 },
      { op: "lineTo", x: 100, y: 0 },
      { op: "lineTo", x: 100, y: 100 },
      { op: "stroke" },
    ]);
  });

  it("walks the edge home to the first vertex once closed is true, and then closes the path", () => {
    const { ctx, calls } = createFakeContext();
    const polyline: GraphObject = {
      id: "obj_1",
      name: "polyline_1",
      type: "polyline",
      slots: {
        closed: { kind: "literal", value: true },
        vertices: {
          kind: "derived",
          value: [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 100, y: 100 },
          ],
        },
      },
    };
    renderDocument(ctx, 800, 600, [polyline], CAMERA_IDENTITY);
    const shapeCalls = calls.filter((call) => call.op !== "setTransform" && call.op !== "clearRect" && call.op !== "fillText");
    expect(shapeCalls).toEqual([
      { op: "beginPath" },
      { op: "moveTo", x: 0, y: 0 },
      { op: "lineTo", x: 100, y: 0 },
      { op: "lineTo", x: 100, y: 100 },
      { op: "lineTo", x: 0, y: 0 },
      { op: "closePath" },
      { op: "stroke" },
    ]);
  });

  it("draws a handled edge as one cubic, and never as a run of short lines", () => {
    const { ctx, calls } = createFakeContext();
    const polyline: GraphObject = {
      id: "obj_1",
      name: "polyline_1",
      type: "polyline",
      vertexCount: 2,
      slots: {
        "vertex.0.handle.out.y": { kind: "literal", value: 1 },
        "vertex.1.handle.in.y": { kind: "literal", value: 1 },
        vertices: {
          kind: "derived",
          value: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
          ],
        },
      },
    };
    renderDocument(ctx, 800, 600, [polyline], CAMERA_IDENTITY);
    const shapeCalls = calls.filter((call) => call.op !== "setTransform" && call.op !== "clearRect" && call.op !== "fillText");
    expect(shapeCalls).toEqual([
      { op: "beginPath" },
      { op: "moveTo", x: 0, y: 0 },
      { op: "bezierCurveTo", c1x: 0, c1y: 1, c2x: 1, c2y: 1, x: 1, y: 0 },
      { op: "stroke" },
    ]);
  });

  it("draws a curved edge as a true arc, the same call a circle uses, and never as a run of short lines", () => {
    const { ctx, calls } = createFakeContext();
    const polyline: GraphObject = {
      id: "obj_1",
      name: "polyline_1",
      type: "polyline",
      vertexCount: 2,
      slots: {
        "vertex.0.bulge": { kind: "literal", value: 1 },
        vertices: {
          kind: "derived",
          value: [
            { x: 0, y: 0 },
            { x: 2, y: 0 },
          ],
        },
      },
    };
    renderDocument(ctx, 800, 600, [polyline], CAMERA_IDENTITY);
    const shapeCalls = calls.filter((call) => call.op !== "setTransform" && call.op !== "clearRect" && call.op !== "fillText");
    expect(shapeCalls.map((call) => call.op)).toEqual(["beginPath", "moveTo", "arc", "stroke"]);
    const drawn = shapeCalls[2];
    if (drawn === undefined || drawn.op !== "arc") {
      throw new Error("test setup: expected the second call to be an arc");
    }
    expect(drawn.x).toBeCloseTo(1);
    expect(drawn.y).toBeCloseTo(0);
    expect(drawn.radius).toBeCloseTo(1);
    // The two angles are one turn apart in either sign, so read them as points.
    const at = (angle: number) => ({ x: drawn.x + Math.cos(angle) * drawn.radius, y: drawn.y + Math.sin(angle) * drawn.radius });
    expect(at(drawn.startAngle).x).toBeCloseTo(0);
    expect(at(drawn.startAngle).y).toBeCloseTo(0);
    expect(at(drawn.endAngle).x).toBeCloseTo(2);
    expect(at(drawn.endAngle).y).toBeCloseTo(0);
    expect(at((drawn.startAngle + drawn.endAngle) / 2).y).toBeCloseTo(-1);
  });
});

function textObject(resolved: string, originX: number, originY: number, overrides: Record<string, Slot> = {}): GraphObject {
  return {
    id: "obj_1",
    name: "text_1",
    type: "text",
    slots: {
      content: { kind: "literal", value: resolved },
      "origin.x": { kind: "literal", value: originX },
      "origin.y": { kind: "literal", value: originY },
      width: { kind: "literal", value: "auto" },
      "style.font": { kind: "literal", value: "sans-serif" },
      "style.fontSize": { kind: "literal", value: 16 },
      "style.lineHeight": { kind: "literal", value: 20 },
      resolvedContent: { kind: "derived", value: resolved },
      measuredHeight: { kind: "derived", value: 20 },
      ...overrides,
    },
  };
}

function bodyText(calls: readonly RecordedCall[]): readonly Extract<RecordedCall, { op: "fillText" }>[] {
  return calls.filter(
    (call): call is Extract<RecordedCall, { op: "fillText" }> =>
      call.op === "fillText" && call.text !== "text_1" && call.text !== "!" && !call.text.includes("•"),
  );
}

describe("renderDocument — text", () => {
  it("draws each hard line of resolvedContent from origin, stepping down by lineHeight", () => {
    const { ctx, calls } = createFakeContext();
    renderDocument(ctx, 800, 600, [textObject("first\nsecond", 10, 20)], CAMERA_IDENTITY);
    expect(bodyText(calls)).toEqual([
      { op: "fillText", text: "first", x: 10, y: 20, align: "left" },
      { op: "fillText", text: "second", x: 10, y: 40, align: "left" },
    ]);
  });

  it("word-wraps at a numeric width slot, using the same layOutText the measurer uses", () => {
    const { ctx, calls } = createFakeContext();
    renderDocument(ctx, 800, 600, [textObject("aaa bbb ccc", 0, 0, { width: { kind: "literal", value: 30 } })], CAMERA_IDENTITY);
    expect(bodyText(calls).map((call) => ({ text: call.text, y: call.y }))).toEqual([
      { text: "aaa", y: 0 },
      { text: "bbb", y: 20 },
      { text: "ccc", y: 40 },
    ]);
  });

  it("breaks a long unbroken run of text between characters instead of drawing it out past the box edge", () => {
    const { ctx, calls } = createFakeContext();
    renderDocument(ctx, 800, 600, [textObject("abcdefghij", 0, 0, { width: { kind: "literal", value: 28 } })], CAMERA_IDENTITY);
    expect(bodyText(calls).map((call) => ({ text: call.text, y: call.y }))).toEqual([
      { text: "abcd", y: 0 },
      { text: "efgh", y: 20 },
      { text: "ij", y: 40 },
    ]);
  });

  it("draws a run of spaces as the operator typed it — collapsing it made the text change the moment the editor closed", () => {
    const { ctx, calls } = createFakeContext();
    renderDocument(ctx, 800, 600, [textObject("a  b", 0, 0)], CAMERA_IDENTITY);
    expect(bodyText(calls).map((call) => call.text)).toEqual(["a  b"]);
  });

  it("does not wrap when width is \"auto\" — one line however long", () => {
    const { ctx, calls } = createFakeContext();
    renderDocument(ctx, 800, 600, [textObject("a very long single line that would wrap at any real width", 0, 0)], CAMERA_IDENTITY);
    expect(bodyText(calls)).toHaveLength(1);
  });

  it("centres and right-aligns each LINE inside the box by its own width — every run is placed absolutely, so ctx.textAlign is always left", () => {
    const centred = createFakeContext();
    renderDocument(centred.ctx, 800, 600, [textObject("ab", 10, 0, { width: { kind: "literal", value: 100 }, "style.align": { kind: "literal", value: "center" } })], CAMERA_IDENTITY);
    expect(bodyText(centred.calls)[0]).toEqual({ op: "fillText", text: "ab", x: 53, y: 0, align: "left" });

    const right = createFakeContext();
    renderDocument(right.ctx, 800, 600, [textObject("ab", 10, 0, { width: { kind: "literal", value: 100 }, "style.align": { kind: "literal", value: "right" } })], CAMERA_IDENTITY);
    expect(bodyText(right.calls)[0]).toEqual({ op: "fillText", text: "ab", x: 96, y: 0, align: "left" });
  });

  it("an unknown align value reads as left (the default)", () => {
    const { ctx, calls } = createFakeContext();
    renderDocument(ctx, 800, 600, [textObject("ab", 5, 0, { "style.align": { kind: "literal", value: "justify" } })], CAMERA_IDENTITY);
    expect(bodyText(calls)[0]).toEqual({ op: "fillText", text: "ab", x: 5, y: 0, align: "left" });
  });

  it("draws markdown-lite with its markers REMOVED, one run per font", () => {
    const { ctx, calls } = createFakeContext();
    renderDocument(ctx, 800, 600, [textObject("**bold** and `code`", 0, 0)], CAMERA_IDENTITY);
    expect(bodyText(calls).map((call) => call.text)).toEqual(["bold", " and ", "code"]);
  });

  it("sets each run's own font before drawing it, and positions it after the runs before it", () => {
    const { ctx, calls, fonts } = createFakeContext();
    renderDocument(ctx, 800, 600, [textObject("ab**cd**", 0, 0)], CAMERA_IDENTITY);
    expect(bodyText(calls)).toEqual([
      { op: "fillText", text: "ab", x: 0, y: 0, align: "left" },
      { op: "fillText", text: "cd", x: 14, y: 0, align: "left" },
    ]);
    expect(fonts).toContain("bold 16px sans-serif");
  });

  it("draws a heading bigger and bold, and starts the line after it below the heading's OWN height", () => {
    const { ctx, calls, fonts } = createFakeContext();
    renderDocument(ctx, 800, 600, [textObject("# Title\nafter", 0, 0)], CAMERA_IDENTITY);
    expect(bodyText(calls)).toEqual([
      { op: "fillText", text: "Title", x: 0, y: 0, align: "left" },
      { op: "fillText", text: "after", x: 0, y: 40, align: "left" },
    ]);
    expect(fonts).toContain("bold 32px sans-serif");
  });

  it("draws a list item with a bullet where its `- ` was", () => {
    const { ctx, calls } = createFakeContext();
    renderDocument(ctx, 800, 600, [textObject("- milk", 0, 0)], CAMERA_IDENTITY);
    expect(calls.filter((call) => call.op === "fillText" && call.text === "• milk")).toHaveLength(1);
  });

  it("HANGS a wrapped list item's continuation under its text, indented by the bullet's width", () => {
    const { ctx, calls } = createFakeContext();
    renderDocument(ctx, 800, 600, [textObject("- aaa bbb", 0, 0, { width: { kind: "literal", value: 42 } })], CAMERA_IDENTITY);
    const drawn = calls.filter((call): call is Extract<RecordedCall, { op: "fillText" }> => call.op === "fillText" && call.text !== "text_1");
    expect(drawn).toEqual([
      { op: "fillText", text: "• aaa", x: 0, y: 0, align: "left" },
      { op: "fillText", text: "bbb", x: 14, y: 20, align: "left" },
    ]);
  });

  it("draws an UNMATCHED marker as itself, so a half-typed `**` is visible rather than silently restyling the rest", () => {
    const { ctx, calls } = createFakeContext();
    renderDocument(ctx, 800, 600, [textObject("2 * 3 and **bold", 0, 0)], CAMERA_IDENTITY);
    expect(bodyText(calls).map((call) => call.text)).toEqual(["2 * 3 and **bold"]);
  });

  it("sets ctx.font from style.fontSize and style.font before drawing the text", () => {
    const { ctx, fonts } = createFakeContext();
    renderDocument(ctx, 800, 600, [textObject("x", 0, 0, { "style.fontSize": { kind: "literal", value: 24 }, "style.font": { kind: "literal", value: "Inter, sans-serif" } })], CAMERA_IDENTITY);
    expect(fonts).toContain("24px Inter, sans-serif");
  });

  it("draws nothing for an unset, non-string, or empty resolvedContent", () => {
    for (const value of [null, 42, "", { error: "#TYPE", message: "x" }] as const) {
      const { ctx, calls } = createFakeContext();
      const object = textObject("x", 0, 0);
      const slots: Record<string, Slot> = { ...object.slots, resolvedContent: { kind: "derived", value } };
      renderDocument(ctx, 800, 600, [{ ...object, slots }], CAMERA_IDENTITY);
      expect(bodyText(calls)).toEqual([]);
    }
  });

  it("falls back to a default size rather than blanking the text when style.fontSize is unusable", () => {
    const { ctx, calls, fonts } = createFakeContext();
    const object = textObject("x", 0, 0);
    const slots: Record<string, Slot> = { ...object.slots, "style.fontSize": { kind: "derived", value: { error: "#TYPE", message: "bad" } } };
    renderDocument(ctx, 800, 600, [{ ...object, slots }], CAMERA_IDENTITY);
    expect(bodyText(calls)).toHaveLength(1);
    expect(fonts).toContain("16px sans-serif");
  });

  it("strokes the text's extent box as its selection highlight (same box hittest.ts clicks against)", () => {
    const { ctx, calls } = createFakeContext();
    renderDocument(ctx, 800, 600, [textObject("hi", 10, 20, { width: { kind: "literal", value: 120 } })], CAMERA_IDENTITY, ["obj_1"]);
    expect(calls).toContainEqual({ op: "strokeRect", x: 10, y: 20, w: 120, h: 20 });
  });

  it("draws a real text object's evaluated resolvedContent through the mutate pipeline, not a hand-fed fixture", () => {
    const schema = getObjectSchema("text");
    if (schema === undefined) {
      throw new Error("test setup: expected a schema for text");
    }
    const placeholders: Record<string, Slot> = {};
    for (const slot of resolveDerivedSlots({ id: "obj_1", name: "text_1", type: "text", slots: {} }, schema.derivedSlots)) {
      placeholders[slot.path.join(".")] = derivedPlaceholder();
    }
    const text: GraphObject = {
      id: "obj_1",
      name: "text_1",
      type: "text",
      slots: {
        "origin.x": { kind: "literal", value: 5 },
        "origin.y": { kind: "literal", value: 8 },
        content: { kind: "literal", value: "hello world" },
        width: { kind: "literal", value: "auto" },
        height: { kind: "literal", value: "auto" },
        overflow: { kind: "literal", value: "visible" },
        "style.font": { kind: "literal", value: "sans-serif" },
        "style.fontSize": { kind: "literal", value: 16 },
        "style.lineHeight": { kind: "literal", value: 20 },
        "style.color": { kind: "literal", value: "black" },
        "style.align": { kind: "literal", value: "left" },
        ...placeholders,
      },
    };
    const created = mutate([], [{ kind: "createObject", object: text }], []);
    if (!created.ok) {
      throw new Error(`test setup: expected creation to succeed, got: ${created.message}`);
    }
    const { ctx, calls } = createFakeContext();
    renderDocument(ctx, 800, 600, created.objects, CAMERA_IDENTITY);
    expect(bodyText(calls)).toEqual([{ op: "fillText", text: "hello world", x: 5, y: 8, align: "left" }]);
  });
});

describe("renderDocument — driven through the real mutate() pipeline", () => {
  it("draws a real, evaluated pentagon's actual vertices, not a hand-fed fixture", () => {
    const schema = getObjectSchema("polygon");
    if (schema === undefined) {
      throw new Error("test setup: expected a schema for polygon");
    }
    const placeholders: Record<string, Slot> = {};
    for (const slot of resolveDerivedSlots({ id: "obj_1", name: "polygon_1", type: "polygon", slots: {} }, schema.derivedSlots)) {
      placeholders[slot.path.join(".")] = derivedPlaceholder();
    }
    const polygon: GraphObject = {
      id: "obj_1",
      name: "polygon_1",
      type: "polygon",
      slots: {
        sides: { kind: "literal", value: 5 },
        radius: { kind: "literal", value: 50 },
        "origin.x": { kind: "literal", value: 0 },
        "origin.y": { kind: "literal", value: 0 },
        rotation: { kind: "literal", value: 0 },
        ...placeholders,
      },
    };
    const created = mutate([], [{ kind: "createObject", object: polygon }], []);
    if (!created.ok) {
      throw new Error(`test setup: expected creation to succeed, got: ${created.message}`);
    }

    const { ctx, calls } = createFakeContext();
    renderDocument(ctx, 800, 600, created.objects, CAMERA_IDENTITY);
    const moveToCalls = calls.filter((call) => call.op === "moveTo");
    const lineToCalls = calls.filter((call) => call.op === "lineTo");
    expect(moveToCalls).toHaveLength(1);
    expect(lineToCalls).toHaveLength(4);
  });
});

function circleObject(id: string, name: string, slots: Readonly<Record<string, Slot>> = {}): GraphObject {
  return {
    id,
    name,
    type: "circle",
    slots: {
      "origin.x": { kind: "literal", value: 0 },
      "origin.y": { kind: "literal", value: 0 },
      radius: { kind: "literal", value: 5 },
      ...slots,
    },
  };
}

const CIRCLE_CHROME_BASELINE = -11;

describe("renderDocument — name label", () => {
  it("draws every object's name in the SCREEN-space pass, centred above the TOP of its extent, converted through the SAME worldToScreen the camera transform uses", () => {
    const { ctx, calls } = createFakeContext();
    const circle = circleObject("obj_1", "circle_7");
    renderDocument(ctx, 800, 600, [circle], { x: 0, y: 0, zoom: 2 });
    const textCalls = calls.filter((call) => call.op === "fillText");
    expect(textCalls).toEqual([{ op: "fillText", text: "circle_7", x: 0, y: -16, align: "center" }]);
  });

  it("anchors a CIRCLE above its top edge, not at its centre — origin means different things per type, so the extent is what chrome hangs from", () => {
    const { ctx, calls } = createFakeContext();
    const circle = circleObject("obj_1", "circle_1");
    renderDocument(ctx, 800, 600, [circle], CAMERA_IDENTITY);
    const label = calls.find((call) => call.op === "fillText");
    expect(label).toEqual({ op: "fillText", text: "circle_1", x: 0, y: CIRCLE_CHROME_BASELINE, align: "center" });
  });

  it("anchors a TABLE above its top edge too — the same rule that moved the circle's label leaves a corner-origin type where it already looked right", () => {
    const { ctx, calls } = createFakeContext();
    const table: GraphObject = {
      id: "obj_1",
      name: "table_1",
      type: "table",
      slots: { rows: { kind: "literal", value: 2 }, cols: { kind: "literal", value: 2 }, "origin.x": { kind: "literal", value: 100 }, "origin.y": { kind: "literal", value: 200 } },
    };
    renderDocument(ctx, 800, 600, [table], CAMERA_IDENTITY);
    const label = calls.find((call) => call.op === "fillText");
    expect(label).toEqual({ op: "fillText", text: "table_1", x: 180, y: 178, align: "center" });
  });

  it("draws no label for a type with no schema/extent yet", () => {
    const { ctx, calls } = createFakeContext();
    const value: GraphObject = { id: "obj_1", name: "value_1", type: "value", slots: { value: { kind: "literal", value: 1 } } };
    renderDocument(ctx, 800, 600, [value], CAMERA_IDENTITY);
    expect(calls.some((call) => call.op === "fillText")).toBe(false);
  });

  it("draws no label for a polygon with no vertices slot — furniture appears exactly when a drawn extent does", () => {
    const { ctx, calls } = createFakeContext();
    const polygon: GraphObject = { id: "obj_1", name: "polygon_1", type: "polygon", slots: { sides: { kind: "literal", value: 5 } } };
    renderDocument(ctx, 800, 600, [polygon], CAMERA_IDENTITY);
    expect(calls.some((call) => call.op === "fillText")).toBe(false);
  });

  it("DOES label a circle that carries only an origin and a radius, because its extent is exact without a point list", () => {
    const { ctx, calls } = createFakeContext();
    const circle: GraphObject = { id: "obj_1", name: "circle_1", type: "circle", slots: { "origin.x": { kind: "literal", value: 0 }, "origin.y": { kind: "literal", value: 0 }, radius: { kind: "literal", value: 5 } } };
    renderDocument(ctx, 800, 600, [circle], CAMERA_IDENTITY);
    expect(calls.some((call) => call.op === "arc")).toBe(true);
    expect(calls.some((call) => call.op === "fillText" && call.text === "circle_1")).toBe(true);
  });

  it("labels EVERY object, in document order, not only a selected one", () => {
    const { ctx, calls } = createFakeContext();
    const circleA = circleObject("obj_1", "circle_a");
    const circleB = circleObject("obj_2", "circle_b");
    renderDocument(ctx, 800, 600, [circleA, circleB], CAMERA_IDENTITY);
    const labels = calls.filter((call) => call.op === "fillText").map((call) => (call.op === "fillText" ? call.text : ""));
    expect(labels).toEqual(["circle_a", "circle_b"]);
  });
});

describe("renderDocument — selection highlight", () => {
  it("re-strokes the selected circle's own path, in addition to the ordinary draw", () => {
    const { ctx, calls } = createFakeContext();
    const circle = circleObject("obj_1", "circle_1");
    renderDocument(ctx, 800, 600, [circle], CAMERA_IDENTITY, ["obj_1"]);
    expect(calls.filter((call) => call.op === "arc")).toHaveLength(2);
    expect(calls.filter((call) => call.op === "stroke")).toHaveLength(2);
  });

  it("draws no highlight when nothing is selected", () => {
    const { ctx, calls } = createFakeContext();
    const circle = circleObject("obj_1", "circle_1");
    renderDocument(ctx, 800, 600, [circle], CAMERA_IDENTITY, undefined);
    expect(calls.filter((call) => call.op === "arc")).toHaveLength(1);
  });

  it("draws no highlight for a selectedObjectIds entry naming no object in the document (a stale selection)", () => {
    const { ctx, calls } = createFakeContext();
    const circle = circleObject("obj_1", "circle_1");
    renderDocument(ctx, 800, 600, [circle], CAMERA_IDENTITY, ["obj_missing"]);
    expect(calls.filter((call) => call.op === "arc")).toHaveLength(1);
  });

  it("highlights EVERY selected object, not only one", () => {
    const { ctx, calls } = createFakeContext();
    const circleA = circleObject("obj_1", "circle_a");
    const circleB = circleObject("obj_2", "circle_b");
    renderDocument(ctx, 800, 600, [circleA, circleB], CAMERA_IDENTITY, ["obj_1", "obj_2"]);
    expect(calls.filter((call) => call.op === "arc")).toHaveLength(4);
    expect(calls.filter((call) => call.op === "stroke")).toHaveLength(4);
  });

  it("highlights a table as its whole grid extent, not per-cell — one extra strokeRect beyond the cell borders", () => {
    const { ctx, calls } = createFakeContext();
    const table: GraphObject = { id: "obj_1", name: "table_1", type: "table", slots: { rows: { kind: "literal", value: 2 }, cols: { kind: "literal", value: 2 } } };
    renderDocument(ctx, 800, 600, [table], CAMERA_IDENTITY, ["obj_1"]);
    const rects = calls.filter((call) => call.op === "strokeRect");
    expect(rects).toHaveLength(5);
    expect(rects[4]).toEqual({ op: "strokeRect", x: 0, y: 0, w: 160, h: 48 });
  });

  it("is drawn AFTER every object, so a later object in z-order cannot occlude an earlier one's highlight", () => {
    const { ctx, calls } = createFakeContext();
    const circleA = circleObject("obj_1", "circle_a");
    const circleB = circleObject("obj_2", "circle_b");
    renderDocument(ctx, 800, 600, [circleA, circleB], CAMERA_IDENTITY, ["obj_1"]);
    const arcCalls = calls.filter((call) => call.op === "arc");
    expect(arcCalls).toHaveLength(3);
  });

  it("highlights nothing, without throwing, for a selected object of a type with no visual definition yet", () => {
    const { ctx, calls } = createFakeContext();
    const value: GraphObject = { id: "obj_1", name: "value_1", type: "value", slots: { value: { kind: "literal", value: 1 } } };
    expect(() => renderDocument(ctx, 800, 600, [value], CAMERA_IDENTITY, ["obj_1"])).not.toThrow();
    expect(calls.some((call) => call.op === "stroke")).toBe(false);
  });
});

describe("renderDocument — error badge", () => {
  it("badges an object holding an ErrorValue in ANY slot, not only the ones this file draws from", () => {
    const { ctx, calls } = createFakeContext();
    const circle = circleObject("obj_1", "circle_1", { area: { kind: "derived", value: { error: "#TYPE", message: "bad" } } });
    renderDocument(ctx, 800, 600, [circle], CAMERA_IDENTITY);
    expect(calls.some((call) => call.op === "fillText" && call.text === "!")).toBe(true);
  });

  it("places the badge clear of the name by MEASURING it, on the same baseline, so a long name pushes it out instead of colliding", () => {
    const { ctx, calls } = createFakeContext();
    const circle = circleObject("obj_1", "a_very_long_object_name", { area: { kind: "derived", value: { error: "#TYPE", message: "bad" } } });
    renderDocument(ctx, 800, 600, [circle], CAMERA_IDENTITY);
    const badge = calls.find((call) => call.op === "fillText" && call.text === "!");
    expect(badge).toEqual({ op: "fillText", text: "!", x: 86.5, y: CIRCLE_CHROME_BASELINE, align: "left" });
  });

  it("draws the badge ABOVE the shape, never inside it — same baseline as the name", () => {
    const { ctx, calls } = createFakeContext();
    const circle = circleObject("obj_1", "circle_1", { area: { kind: "derived", value: { error: "#TYPE", message: "bad" } } });
    renderDocument(ctx, 800, 600, [circle], CAMERA_IDENTITY);
    const textCalls = calls.filter((call): call is Extract<RecordedCall, { op: "fillText" }> => call.op === "fillText");
    expect(textCalls.every((call) => call.y === CIRCLE_CHROME_BASELINE)).toBe(true);
  });

  it("draws no badge for an object with no ErrorValue anywhere", () => {
    const { ctx, calls } = createFakeContext();
    const circle = circleObject("obj_1", "circle_1");
    renderDocument(ctx, 800, 600, [circle], CAMERA_IDENTITY);
    expect(calls.some((call) => call.op === "fillText" && call.text === "!")).toBe(false);
  });
});

describe("renderDocument — formula-driven indicator", () => {
  function boundToCellSlot(): Slot {
    return { kind: "formula", ast: { type: "reference", address: { objectId: "obj_2", path: ["cells", "A1"] } }, value: 0 };
  }

  function tickCall(calls: readonly RecordedCall[]): RecordedCall | undefined {
    return calls.find((call) => call.op === "fillText" && call.text.includes("•"));
  }

  it("marks origin.x when its slot kind is formula, and leaves a literal origin.y unmarked", () => {
    const { ctx, calls } = createFakeContext();
    const circle = circleObject("obj_1", "circle_1", { "origin.x": boundToCellSlot() });
    renderDocument(ctx, 800, 600, [circle], CAMERA_IDENTITY);
    expect(tickCall(calls)).toEqual({ op: "fillText", text: "•x", x: -34, y: CIRCLE_CHROME_BASELINE, align: "right" });
  });

  it("marks both axes in ONE right-aligned draw when both origin.x and origin.y are formula slots", () => {
    const { ctx, calls } = createFakeContext();
    const circle = circleObject("obj_1", "circle_1", { "origin.x": boundToCellSlot(), "origin.y": boundToCellSlot() });
    renderDocument(ctx, 800, 600, [circle], CAMERA_IDENTITY);
    expect(tickCall(calls)).toEqual({ op: "fillText", text: "•x •y", x: -34, y: CIRCLE_CHROME_BASELINE, align: "right" });
  });

  it("marks only origin.y when it alone is driven", () => {
    const { ctx, calls } = createFakeContext();
    const circle = circleObject("obj_1", "circle_1", { "origin.y": boundToCellSlot() });
    renderDocument(ctx, 800, 600, [circle], CAMERA_IDENTITY);
    expect(tickCall(calls)).toEqual({ op: "fillText", text: "•y", x: -34, y: CIRCLE_CHROME_BASELINE, align: "right" });
  });

  it("marks neither axis when both origin.x and origin.y are literal", () => {
    const { ctx, calls } = createFakeContext();
    const circle = circleObject("obj_1", "circle_1");
    renderDocument(ctx, 800, 600, [circle], CAMERA_IDENTITY);
    expect(tickCall(calls)).toBeUndefined();
  });

  it("marks neither axis for a DERIVED slot — never reachable in practice (origin is never declared derived), but the check reads the kind, not the presence, of a slot", () => {
    const { ctx, calls } = createFakeContext();
    const circle = circleObject("obj_1", "circle_1", { "origin.x": { kind: "derived", value: 0 } });
    renderDocument(ctx, 800, 600, [circle], CAMERA_IDENTITY);
    expect(tickCall(calls)).toBeUndefined();
  });

  it("draws the ticks ABOVE the shape, on the name's baseline — never inside it", () => {
    const { ctx, calls } = createFakeContext();
    const circle = circleObject("obj_1", "circle_1", { "origin.x": boundToCellSlot() });
    renderDocument(ctx, 800, 600, [circle], CAMERA_IDENTITY);
    const textCalls = calls.filter((call): call is Extract<RecordedCall, { op: "fillText" }> => call.op === "fillText");
    expect(textCalls.every((call) => call.y === CIRCLE_CHROME_BASELINE)).toBe(true);
  });
});

describe("renderDocument — the selected object's name label is suppressed", () => {
  function boundToCellSlot(): Slot {
    return { kind: "formula", ast: { type: "reference", address: { objectId: "obj_9", path: ["cells", "A1"] } }, value: 0 };
  }

  it("does not draw the selected object's own name — its name is in the properties panel's header instead", () => {
    const { ctx, calls } = createFakeContext();
    const circle = circleObject("obj_1", "circle_1");
    renderDocument(ctx, 800, 600, [circle], CAMERA_IDENTITY, ["obj_1"]);
    expect(calls.some((call) => call.op === "fillText" && call.text === "circle_1")).toBe(false);
  });

  it("still draws the selected object's error badge and formula ticks — they mark the shape, and the panel says the same in words", () => {
    const { ctx, calls } = createFakeContext();
    const circle = circleObject("obj_1", "circle_1", {
      "origin.x": boundToCellSlot(),
      area: { kind: "derived", value: { error: "#TYPE", message: "bad" } },
    });
    renderDocument(ctx, 800, 600, [circle], CAMERA_IDENTITY, ["obj_1"]);
    const texts = calls.filter((call): call is Extract<RecordedCall, { op: "fillText" }> => call.op === "fillText").map((call) => call.text);
    expect(texts).not.toContain("circle_1");
    expect(texts).toContain("!");
    expect(texts).toContain("•x");
  });

  it("still labels a NON-selected object while another one is selected", () => {
    const { ctx, calls } = createFakeContext();
    const selected = circleObject("obj_1", "circle_a");
    const other = circleObject("obj_2", "circle_b");
    renderDocument(ctx, 800, 600, [selected, other], CAMERA_IDENTITY, ["obj_1"]);
    const texts = calls.filter((call): call is Extract<RecordedCall, { op: "fillText" }> => call.op === "fillText").map((call) => call.text);
    expect(texts).toEqual(["circle_b"]);
  });

  it("suppresses BOTH names when both objects are selected", () => {
    const { ctx, calls } = createFakeContext();
    const circleA = circleObject("obj_1", "circle_a");
    const circleB = circleObject("obj_2", "circle_b");
    renderDocument(ctx, 800, 600, [circleA, circleB], CAMERA_IDENTITY, ["obj_1", "obj_2"]);
    const texts = calls.filter((call): call is Extract<RecordedCall, { op: "fillText" }> => call.op === "fillText").map((call) => call.text);
    expect(texts).not.toContain("circle_a");
    expect(texts).not.toContain("circle_b");
  });

  it("suppresses no label when the selection is a stale id", () => {
    const { ctx, calls } = createFakeContext();
    const circle = circleObject("obj_1", "circle_1");
    renderDocument(ctx, 800, 600, [circle], CAMERA_IDENTITY, ["obj_missing"]);
    expect(calls.some((call) => call.op === "fillText" && call.text === "circle_1")).toBe(true);
  });
});

describe("renderDocument — panelledObjectIds is a SEPARATE list from selectedObjectIds", () => {
  it("defaults panelledObjectIds to selectedObjectIds when the 7th argument is omitted, so every older call site is unchanged", () => {
    const { ctx, calls } = createFakeContext();
    const circle = circleObject("obj_1", "circle_1");
    renderDocument(ctx, 800, 600, [circle], CAMERA_IDENTITY, ["obj_1"]);
    expect(calls.some((call) => call.op === "fillText" && call.text === "circle_1")).toBe(false);
  });

  it("suppresses a name for an id in panelledObjectIds even when selectedObjectIds is empty", () => {
    const { ctx, calls } = createFakeContext();
    const circle = circleObject("obj_1", "circle_1");
    renderDocument(ctx, 800, 600, [circle], CAMERA_IDENTITY, [], ["obj_1"]);
    expect(calls.some((call) => call.op === "fillText" && call.text === "circle_1")).toBe(false);
  });

  it("does NOT suppress a selected object's name once its panel is dismissed (panelledObjectIds excludes it) — the name comes back", () => {
    const { ctx, calls } = createFakeContext();
    const circle = circleObject("obj_1", "circle_1");
    renderDocument(ctx, 800, 600, [circle], CAMERA_IDENTITY, ["obj_1"], []);
    expect(calls.some((call) => call.op === "fillText" && call.text === "circle_1")).toBe(true);
  });

  it("still highlights a selected object whose panel was dismissed — dismissal is about screen space, not the selection", () => {
    const { ctx, calls } = createFakeContext();
    const circle = circleObject("obj_1", "circle_1");
    renderDocument(ctx, 800, 600, [circle], CAMERA_IDENTITY, ["obj_1"], []);
    expect(calls.filter((call) => call.op === "arc")).toHaveLength(2);
  });
});

describe("renderDocument — resize grabbers and the object being edited (2026-09-02)", () => {
  function sizedText(): GraphObject {
    return {
      id: "obj_text",
      name: "text_1",
      type: "text",
      slots: {
        "origin.x": { kind: "literal", value: 0 },
        "origin.y": { kind: "literal", value: 0 },
        width: { kind: "literal", value: "auto" },
        "style.fontSize": { kind: "literal", value: 16 },
        "style.lineHeight": { kind: "literal", value: 20 },
        "style.font": { kind: "literal", value: "sans-serif" },
        resolvedContent: { kind: "derived", value: "hi" },
        measuredWidth: { kind: "derived", value: 200 },
        measuredHeight: { kind: "derived", value: 40 },
      },
    };
  }

  it("draws eight grabbers on a selected text box", () => {
    const { ctx, calls } = createFakeContext();
    renderDocument(ctx, 800, 600, [sizedText()], CAMERA_IDENTITY, ["obj_text"]);
    expect(calls.filter((call) => call.op === "fillRect")).toHaveLength(8);
  });

  it("draws none on an UNSELECTED text box — a grabber is part of the selection", () => {
    const { ctx, calls } = createFakeContext();
    renderDocument(ctx, 800, 600, [sizedText()], CAMERA_IDENTITY, []);
    expect(calls.filter((call) => call.op === "fillRect")).toHaveLength(0);
  });

  it("centres them on the box's corners and edge midpoints, in SCREEN space", () => {
    const { ctx, calls } = createFakeContext();
    renderDocument(ctx, 800, 600, [sizedText()], CAMERA_IDENTITY, ["obj_text"]);
    const centres = calls
      .filter((call): call is Extract<RecordedCall, { op: "fillRect" }> => call.op === "fillRect")
      .map((call) => ({ x: call.x + call.w / 2, y: call.y + call.h / 2 }));
    expect(centres).toContainEqual({ x: 0, y: 0 });
    expect(centres).toContainEqual({ x: 200, y: 40 });
    expect(centres).toContainEqual({ x: 100, y: 0 });
    expect(centres).toContainEqual({ x: 0, y: 20 });
  });

  it("keeps them one SCREEN size at high zoom — they are chrome, drawn after the transform reset", () => {
    const { ctx, calls } = createFakeContext();
    renderDocument(ctx, 800, 600, [sizedText()], { x: 0, y: 0, zoom: 10 }, ["obj_text"]);
    const squares = calls.filter((call): call is Extract<RecordedCall, { op: "fillRect" }> => call.op === "fillRect");
    expect(new Set(squares.map((call) => call.w))).toEqual(new Set([squares[0]?.w]));
    expect(squares.some((call) => call.x + call.w / 2 === 2000 && call.y + call.h / 2 === 400)).toBe(true);
  });

  it("draws none on a selected text box with no drawn extent — there is no box to hang them on", () => {
    const { ctx, calls } = createFakeContext();
    const empty: GraphObject = { ...sizedText(), slots: { ...sizedText().slots, resolvedContent: { kind: "derived", value: null } } };
    renderDocument(ctx, 800, 600, [empty], CAMERA_IDENTITY, ["obj_text"]);
    expect(calls.filter((call) => call.op === "fillRect")).toHaveLength(0);
  });

  it("draws none on a selected CIRCLE — only a text box is resized by its box (handles.ts's `hasResizeHandles`)", () => {
    const { ctx, calls } = createFakeContext();
    const circle: GraphObject = {
      id: "obj_c",
      name: "circle_1",
      type: "circle",
      slots: {
        "origin.x": { kind: "literal", value: 0 },
        "origin.y": { kind: "literal", value: 0 },
        radius: { kind: "literal", value: 10 },
      },
    };
    renderDocument(ctx, 800, 600, [circle], CAMERA_IDENTITY, ["obj_c"]);
    expect(calls.filter((call) => call.op === "fillRect")).toHaveLength(0);
  });

  function drawnStrings(calls: readonly RecordedCall[]): readonly string[] {
    return calls.filter((call): call is Extract<RecordedCall, { op: "fillText" }> => call.op === "fillText").map((call) => call.text);
  }

  it("does not draw the CONTENT of the object being edited — the overlay IS its text while the editor is open", () => {
    const { ctx, calls } = createFakeContext();
    renderDocument(ctx, 800, 600, [sizedText()], CAMERA_IDENTITY, [], [], { kind: "text", objectId: "obj_text" });
    expect(drawnStrings(calls)).not.toContain("hi");
    expect(drawnStrings(calls)).toContain("text_1");
  });

  it("still draws every OTHER object's content while one is being edited", () => {
    const { ctx, calls } = createFakeContext();
    const other: GraphObject = { ...sizedText(), id: "obj_other", name: "text_2" };
    renderDocument(ctx, 800, 600, [sizedText(), other], CAMERA_IDENTITY, [], [], { kind: "text", objectId: "obj_text" });
    expect(drawnStrings(calls).filter((text) => text === "hi")).toHaveLength(1);
  });

  it("draws neither its selection outline nor its grabbers while it is being edited — both would sit at the committed size the growing overlay has left behind", () => {
    const { ctx, calls } = createFakeContext();
    renderDocument(ctx, 800, 600, [sizedText()], CAMERA_IDENTITY, ["obj_text"], ["obj_text"], { kind: "text", objectId: "obj_text" });
    expect(calls.filter((call) => call.op === "fillRect")).toHaveLength(0);
    expect(calls.filter((call) => call.op === "strokeRect")).toHaveLength(0);
  });

  describe("a table cell being edited (2026-09-02)", () => {
    function filledTable(): GraphObject {
      return {
        id: "obj_t",
        name: "table_1",
        type: "table",
        slots: {
          rows: { kind: "literal", value: 1 },
          cols: { kind: "literal", value: 3 },
          "cells.A1": { kind: "literal", value: "alpha" },
          "cells.B1": { kind: "literal", value: "beta" },
          "cells.C1": { kind: "literal", value: "gamma" },
        },
      };
    }

    it("does not draw the edited cell's value — the overlay is holding it", () => {
      const { ctx, calls } = createFakeContext();
      renderDocument(ctx, 800, 600, [filledTable()], CAMERA_IDENTITY, [], [], { kind: "cell", objectId: "obj_t", cell: "B1" });
      expect(drawnStrings(calls)).not.toContain("beta");
    });

    it("still draws every OTHER cell in the same table", () => {
      const { ctx, calls } = createFakeContext();
      renderDocument(ctx, 800, 600, [filledTable()], CAMERA_IDENTITY, [], [], { kind: "cell", objectId: "obj_t", cell: "B1" });
      expect(drawnStrings(calls)).toContain("alpha");
      expect(drawnStrings(calls)).toContain("gamma");
    });

    it("still draws the whole GRID, including the edited cell's own border — unlike a text box, the overlay does not replace the rectangle", () => {
      const { ctx, calls } = createFakeContext();
      renderDocument(ctx, 800, 600, [filledTable()], CAMERA_IDENTITY, [], [], { kind: "cell", objectId: "obj_t", cell: "B1" });
      expect(calls.filter((call) => call.op === "strokeRect")).toHaveLength(3);
    });

    it("suppresses the cell only on the table the editor is actually open on", () => {
      const { ctx, calls } = createFakeContext();
      const other: GraphObject = { ...filledTable(), id: "obj_u", name: "table_2" };
      renderDocument(ctx, 800, 600, [filledTable(), other], CAMERA_IDENTITY, [], [], { kind: "cell", objectId: "obj_t", cell: "B1" });
      expect(drawnStrings(calls).filter((text) => text === "beta")).toHaveLength(1);
    });

    it("keeps the table's selection highlight while a cell is edited — the table has not moved or grown, which is why a TEXT box loses its outline and this does not", () => {
      const { ctx, calls } = createFakeContext();
      renderDocument(ctx, 800, 600, [filledTable()], CAMERA_IDENTITY, ["obj_t"], ["obj_t"], { kind: "cell", objectId: "obj_t", cell: "B1" });
      expect(calls.filter((call) => call.op === "strokeRect")).toHaveLength(4);
    });
  });
});

describe("renderDocument — a table's A1 row/column headers (2026-09-02)", () => {
  function grid(rows: number, cols: number): GraphObject {
    return {
      id: "obj_1",
      name: "table_1",
      type: "table",
      slots: { rows: { kind: "literal", value: rows }, cols: { kind: "literal", value: cols } },
    };
  }

  function drawn(calls: readonly RecordedCall[]): readonly Extract<RecordedCall, { op: "fillText" }>[] {
    return calls.filter((call): call is Extract<RecordedCall, { op: "fillText" }> => call.op === "fillText");
  }

  it("letters the columns A, B, C… centred over each one, above the grid's top edge", () => {
    const { ctx, calls } = createFakeContext();
    renderDocument(ctx, 800, 600, [grid(1, 3)], CAMERA_IDENTITY);
    const headers = drawn(calls).filter((call) => call.align === "center" && call.text !== "table_1");
    expect(headers).toEqual([
      { op: "fillText", text: "A", x: 40, y: -4, align: "center" },
      { op: "fillText", text: "B", x: 120, y: -4, align: "center" },
      { op: "fillText", text: "C", x: 200, y: -4, align: "center" },
    ]);
  });

  it("numbers the rows 1, 2, 3… beside each one, right-aligned outside the left edge", () => {
    const { ctx, calls } = createFakeContext();
    renderDocument(ctx, 800, 600, [grid(3, 1)], CAMERA_IDENTITY);
    const headers = drawn(calls).filter((call) => call.align === "right");
    expect(headers).toEqual([
      { op: "fillText", text: "1", x: -4, y: 12, align: "right" },
      { op: "fillText", text: "2", x: -4, y: 36, align: "right" },
      { op: "fillText", text: "3", x: -4, y: 60, align: "right" },
    ]);
  });

  it("uses address.ts's own bijective base-26 letters, so column 27 is AA and not Z+1 or A1", () => {
    const { ctx, calls } = createFakeContext();
    renderDocument(ctx, 800, 600, [grid(1, 27)], CAMERA_IDENTITY);
    const texts = drawn(calls).map((call) => call.text);
    expect(texts).toContain("Z");
    expect(texts).toContain("AA");
    expect(texts).not.toContain("A1");
  });

  it("follows the table's origin rather than assuming (0,0)", () => {
    const { ctx, calls } = createFakeContext();
    const moved: GraphObject = { ...grid(1, 1), slots: { ...grid(1, 1).slots, "origin.x": { kind: "literal", value: 100 }, "origin.y": { kind: "literal", value: 200 } } };
    renderDocument(ctx, 800, 600, [moved], CAMERA_IDENTITY);
    expect(drawn(calls)).toContainEqual({ op: "fillText", text: "A", x: 140, y: 196, align: "center" });
    expect(drawn(calls)).toContainEqual({ op: "fillText", text: "1", x: 96, y: 212, align: "right" });
  });

  it("tracks pan and zoom, staying over the columns it names", () => {
    const { ctx, calls } = createFakeContext();
    renderDocument(ctx, 800, 600, [grid(1, 2)], { x: 10, y: 20, zoom: 2 });
    const centres = drawn(calls).filter((call) => call.text === "A" || call.text === "B").map((call) => call.x);
    expect(centres).toEqual([60, 220]);
  });

  it("is NOT suppressed when the object is panelled, unlike the name label", () => {
    const { ctx, calls } = createFakeContext();
    renderDocument(ctx, 800, 600, [grid(1, 2)], CAMERA_IDENTITY, ["obj_1"], ["obj_1"]);
    const texts = drawn(calls).map((call) => call.text);
    expect(texts).not.toContain("table_1");
    expect(texts).toEqual(expect.arrayContaining(["A", "B", "1"]));
  });

  it("draws headers for a table nobody has selected — they are the sheet's furniture, not a selection affordance", () => {
    const { ctx, calls } = createFakeContext();
    renderDocument(ctx, 800, 600, [grid(1, 1)], CAMERA_IDENTITY);
    expect(drawn(calls).map((call) => call.text)).toContain("A");
  });

  it("skips them per axis once the cells shrink past legibility, rather than drawing an overlapping smear", () => {
    const { ctx, calls } = createFakeContext();
    renderDocument(ctx, 800, 600, [grid(2, 2)], { x: 0, y: 0, zoom: 0.1 });
    const texts = drawn(calls).map((call) => call.text);
    expect(texts).not.toContain("A");
    expect(texts).not.toContain("1");
  });

  it("keeps the COLUMN letters while dropping the row numbers when only the rows have shrunk past the floor", () => {
    const { ctx, calls } = createFakeContext();
    renderDocument(ctx, 800, 600, [grid(2, 2)], { x: 0, y: 0, zoom: 0.25 });
    const texts = drawn(calls).map((call) => call.text);
    expect(texts).toContain("A");
    expect(texts).not.toContain("1");
  });

  it("draws none for a non-table object", () => {
    const { ctx, calls } = createFakeContext();
    const circle: GraphObject = {
      id: "obj_c",
      name: "circle_1",
      type: "circle",
      slots: {
        "origin.x": { kind: "literal", value: 0 },
        "origin.y": { kind: "literal", value: 0 },
        radius: { kind: "literal", value: 10 },
      },
    };
    renderDocument(ctx, 800, 600, [circle], CAMERA_IDENTITY);
    expect(drawn(calls).map((call) => call.text)).toEqual(["circle_1"]);
  });

  it("still draws them while one of the table's own cells is being edited", () => {
    const { ctx, calls } = createFakeContext();
    renderDocument(ctx, 800, 600, [grid(1, 2)], CAMERA_IDENTITY, [], [], { kind: "cell", objectId: "obj_1", cell: "A1" });
    expect(drawn(calls).map((call) => call.text)).toEqual(expect.arrayContaining(["A", "B", "1"]));
  });
});

function imageObject(overrides: Record<string, Slot> = {}): GraphObject {
  return {
    id: "obj_1",
    name: "image_1",
    type: "image",
    slots: {
      "origin.x": { kind: "literal", value: 10 },
      "origin.y": { kind: "literal", value: 20 },
      width: { kind: "literal", value: 100 },
      height: { kind: "literal", value: 100 },
      opacity: { kind: "literal", value: 1 },
      source: { kind: "literal", value: "" },
      preserveAspect: { kind: "literal", value: true },
      ...overrides,
    },
  };
}

const A_DATA_URL: Slot = { kind: "literal", value: "data:image/png;base64,AAAA" };

function readyBitmaps(naturalWidth: number, naturalHeight: number): ImageBitmaps {
  const image = { decoded: true } as unknown as CanvasImageSource;
  return { bitmapFor: () => ({ image, naturalWidth, naturalHeight }) };
}

function pictures(calls: readonly RecordedCall[]): readonly Extract<RecordedCall, { op: "drawImage" }>[] {
  return calls.filter((call): call is Extract<RecordedCall, { op: "drawImage" }> => call.op === "drawImage");
}

function strokeRects(calls: readonly RecordedCall[]): readonly Extract<RecordedCall, { op: "strokeRect" }>[] {
  return calls.filter((call): call is Extract<RecordedCall, { op: "strokeRect" }> => call.op === "strokeRect");
}

describe("renderDocument — image", () => {
  it("strokes the object's width x height box from origin even with no picture chosen, so a created image is visible and selectable rather than invisible", () => {
    const { ctx, calls } = createFakeContext();
    renderDocument(ctx, 800, 600, [imageObject()], CAMERA_IDENTITY);
    expect(strokeRects(calls)).toContainEqual({ op: "strokeRect", x: 10, y: 20, w: 100, h: 100 });
    expect(pictures(calls)).toEqual([]);
  });

  it("draws no picture while a decode is still in flight, which is what the cache reports as undefined", () => {
    const { ctx, calls } = createFakeContext();
    const pending: ImageBitmaps = { bitmapFor: () => undefined };
    renderDocument(ctx, 800, 600, [imageObject({ source: A_DATA_URL })], CAMERA_IDENTITY, [], [], undefined, pending);
    expect(pictures(calls)).toEqual([]);
    expect(strokeRects(calls)).toContainEqual({ op: "strokeRect", x: 10, y: 20, w: 100, h: 100 });
  });

  it("draws no picture when no ImageBitmaps was supplied at all, and still draws the frame", () => {
    const { ctx, calls } = createFakeContext();
    renderDocument(ctx, 800, 600, [imageObject({ source: A_DATA_URL })], CAMERA_IDENTITY);
    expect(pictures(calls)).toEqual([]);
    expect(strokeRects(calls)).toContainEqual({ op: "strokeRect", x: 10, y: 20, w: 100, h: 100 });
  });

  it("fills the box exactly when the picture's proportions already match it", () => {
    const { ctx, calls } = createFakeContext();
    renderDocument(ctx, 800, 600, [imageObject({ source: A_DATA_URL })], CAMERA_IDENTITY, [], [], undefined, readyBitmaps(50, 50));
    expect(pictures(calls)).toHaveLength(1);
    expect(pictures(calls)[0]).toMatchObject({ x: 10, y: 20, w: 100, h: 100 });
  });

  it("preserves a WIDE picture's aspect ratio inside its box and centres it vertically", () => {
    const { ctx, calls } = createFakeContext();
    renderDocument(ctx, 800, 600, [imageObject({ source: A_DATA_URL })], CAMERA_IDENTITY, [], [], undefined, readyBitmaps(200, 100));
    expect(pictures(calls)[0]).toMatchObject({ x: 10, y: 45, w: 100, h: 50 });
  });

  it("preserves a TALL picture's aspect ratio inside its box and centres it horizontally", () => {
    const { ctx, calls } = createFakeContext();
    renderDocument(ctx, 800, 600, [imageObject({ source: A_DATA_URL })], CAMERA_IDENTITY, [], [], undefined, readyBitmaps(100, 400));
    expect(pictures(calls)[0]).toMatchObject({ x: 47.5, y: 20, w: 25, h: 100 });
  });

  it("keeps the ratio at a box the operator has since made disagree with the picture, while `preserveAspect` is on", () => {
    const { ctx, calls } = createFakeContext();
    const wideBox = imageObject({ source: A_DATA_URL, width: { kind: "literal", value: 400 } });
    renderDocument(ctx, 800, 600, [wideBox], CAMERA_IDENTITY, [], [], undefined, readyBitmaps(100, 100));
    expect(pictures(calls)[0]).toMatchObject({ x: 160, y: 20, w: 100, h: 100 });
  });

  it("STRETCHES the picture to fill the box once `preserveAspect` is turned off", () => {
    const { ctx, calls } = createFakeContext();
    const stretched = imageObject({
      source: A_DATA_URL,
      width: { kind: "literal", value: 400 },
      preserveAspect: { kind: "literal", value: false },
    });
    renderDocument(ctx, 800, 600, [stretched], CAMERA_IDENTITY, [], [], undefined, readyBitmaps(100, 100));
    expect(pictures(calls)[0]).toMatchObject({ x: 10, y: 20, w: 400, h: 100 });
  });

  it("preserves the ratio when the slot is MISSING, which is what lets a document saved before it existed keep the default", () => {
    const { ctx, calls } = createFakeContext();
    const old = imageObject({ source: A_DATA_URL, width: { kind: "literal", value: 400 } });
    delete (old.slots as Record<string, Slot | undefined>)["preserveAspect"];
    renderDocument(ctx, 800, 600, [old], CAMERA_IDENTITY, [], [], undefined, readyBitmaps(100, 100));
    expect(pictures(calls)[0]).toMatchObject({ x: 160, w: 100, h: 100 });
  });

  it("paints the picture at the opacity slot's value and restores the context's alpha afterwards", () => {
    const { ctx, calls } = createFakeContext();
    const faded = imageObject({ source: A_DATA_URL, opacity: { kind: "literal", value: 0.25 } });
    renderDocument(ctx, 800, 600, [faded], CAMERA_IDENTITY, [], [], undefined, readyBitmaps(100, 100));
    expect(pictures(calls)[0]?.alpha).toBe(0.25);
    expect(ctx.globalAlpha).toBe(1);
  });

  it("CLAMPS an out-of-range opacity when it paints rather than refusing the value, because an out of range value is still legal document state", () => {
    for (const [stored, painted] of [[4, 1], [-2, 0]] as const) {
      const { ctx, calls } = createFakeContext();
      const image = imageObject({ source: A_DATA_URL, opacity: { kind: "literal", value: stored } });
      renderDocument(ctx, 800, 600, [image], CAMERA_IDENTITY, [], [], undefined, readyBitmaps(100, 100));
      expect(pictures(calls)[0]?.alpha).toBe(painted);
    }
  });

  it("paints at full opacity for an unusable opacity slot, so a broken slot never makes a picture vanish", () => {
    const { ctx, calls } = createFakeContext();
    const broken = imageObject({ source: A_DATA_URL, opacity: { kind: "literal", value: { error: "#TYPE", message: "no" } } });
    renderDocument(ctx, 800, 600, [broken], CAMERA_IDENTITY, [], [], undefined, readyBitmaps(100, 100));
    expect(pictures(calls)[0]?.alpha).toBe(1);
  });

  it("draws nothing at all — no frame, no picture — for a non-positive box, matching the extent that refuses to bound one", () => {
    const { ctx, calls } = createFakeContext();
    const flat = imageObject({ source: A_DATA_URL, width: { kind: "literal", value: 0 } });
    renderDocument(ctx, 800, 600, [flat], CAMERA_IDENTITY, [], [], undefined, readyBitmaps(100, 100));
    expect(pictures(calls)).toEqual([]);
    expect(strokeRects(calls)).toEqual([]);
  });

  it("highlights a selected image as its own drawn box, the same box hittest.ts clicks against", () => {
    const { ctx, calls } = createFakeContext();
    renderDocument(ctx, 800, 600, [imageObject()], CAMERA_IDENTITY, ["obj_1"]);
    expect(strokeRects(calls).filter((call) => call.x === 10 && call.y === 20 && call.w === 100 && call.h === 100)).toHaveLength(2);
  });

  it("labels an image with its name, because it now has an extent to hang chrome from", () => {
    const { ctx, calls } = createFakeContext();
    renderDocument(ctx, 800, 600, [imageObject()], CAMERA_IDENTITY);
    expect(calls.filter((call): call is Extract<RecordedCall, { op: "fillText" }> => call.op === "fillText").map((call) => call.text)).toContain("image_1");
  });
});

describe("drawScript — the labelled box with ports", () => {
  function scriptObject(ports?: { in: string[]; out: string[] }): GraphObject {
    return {
      id: "obj_1",
      name: "script_1",
      type: "script",
      slots: {
        "origin.x": { kind: "literal", value: 0 },
        "origin.y": { kind: "literal", value: 0 },
        language: { kind: "literal", value: "python" },
        source: { kind: "literal", value: "" },
      },
      ...(ports === undefined ? {} : { ports }),
    };
  }

  function textsDrawn(object: GraphObject): readonly string[] {
    const { ctx, calls } = createFakeContext();
    renderDocument(ctx, 800, 600, [object], CAMERA_IDENTITY);
    return calls.filter((call): call is Extract<RecordedCall, { op: "fillText" }> => call.op === "fillText").map((call) => call.text);
  }

  it("draws a box for a PORTLESS node, so `script x=0 y=0` lands as something the operator can see", () => {
    const { ctx, calls } = createFakeContext();
    renderDocument(ctx, 800, 600, [scriptObject()], CAMERA_IDENTITY);
    expect(calls.some((call) => call.op === "strokeRect")).toBe(true);
    expect(calls.some((call) => call.op === "fillRect")).toBe(true);
  });

  it("labels the box with its language, read from the slot rather than a re-spelled constant", () => {
    expect(textsDrawn(scriptObject())).toContain("python");
  });

  it("draws every port's NAME, inputs and outputs alike", () => {
    const texts = textsDrawn(scriptObject({ in: ["factor", "speed"], out: ["result"] }));
    expect(texts).toContain("factor");
    expect(texts).toContain("speed");
    expect(texts).toContain("result");
  });

  it("keeps ports in DECLARATION order, because the port list is ordered state, not a set", () => {
    const texts = textsDrawn(scriptObject({ in: ["zebra", "alpha"], out: [] }));
    expect(texts.indexOf("zebra")).toBeLessThan(texts.indexOf("alpha"));
  });

  it("puts inputs on the LEFT edge and outputs on the right edge, which is the one claim the shape of the box cannot fake", () => {
    const { ctx, calls } = createFakeContext();
    renderDocument(ctx, 800, 600, [scriptObject({ in: ["factor"], out: ["result"] })], CAMERA_IDENTITY);
    const stubs = calls.filter((call): call is Extract<RecordedCall, { op: "fillRect" }> => call.op === "fillRect" && call.w < SCRIPT_BOX_WIDTH);
    expect(stubs).toHaveLength(2);
    const xs = stubs.map((call) => call.x).sort((left, right) => left - right);
    expect(xs[0]).toBeLessThan(SCRIPT_BOX_WIDTH / 2);
    expect(xs[1]).toBeGreaterThan(SCRIPT_BOX_WIDTH / 2);
  });

  it("draws an input's label against the LEFT edge and an output's against the RIGHT — the position, not just the alignment", () => {
    const { ctx, calls } = createFakeContext();
    renderDocument(ctx, 800, 600, [scriptObject({ in: ["factor"], out: ["result"] })], CAMERA_IDENTITY);
    const texts = calls.filter((call): call is Extract<RecordedCall, { op: "fillText" }> => call.op === "fillText");
    const input = texts.find((call) => call.text === "factor");
    const output = texts.find((call) => call.text === "result");
    expect(input?.x).toBeLessThan(SCRIPT_BOX_WIDTH / 2);
    expect(output?.x).toBeGreaterThan(SCRIPT_BOX_WIDTH / 2);
    expect(input?.align).toBe("left");
    expect(output?.align).toBe("right");
  });

  it("grows one row per port ROW, taking the LONGER family rather than their sum, because the two sit side by side", () => {
    const height = (ports: { in: string[]; out: string[] }): number => {
      const extent = objectExtent(scriptObject(ports));
      return (extent?.maxY ?? 0) - (extent?.minY ?? 0);
    };
    expect(height({ in: ["a"], out: ["b"] })).toBe(SCRIPT_HEADER_HEIGHT + SCRIPT_PORT_ROW_HEIGHT);
    expect(height({ in: ["a", "b", "c"], out: ["d"] })).toBe(SCRIPT_HEADER_HEIGHT + 3 * SCRIPT_PORT_ROW_HEIGHT);
    expect(height({ in: [], out: [] })).toBe(SCRIPT_HEADER_HEIGHT + SCRIPT_PORT_ROW_HEIGHT);
  });

  it("draws the box `extent.ts` reports and not a second reading of it, so the drawn box and the click box cannot disagree", () => {
    const object = scriptObject({ in: ["factor"], out: ["result"] });
    const extent = objectExtent(object);
    const { ctx, calls } = createFakeContext();
    renderDocument(ctx, 800, 600, [object], CAMERA_IDENTITY);
    const outline = calls.find((call): call is Extract<RecordedCall, { op: "strokeRect" }> => call.op === "strokeRect");
    expect(outline).toEqual({
      op: "strokeRect",
      x: extent?.minX,
      y: extent?.minY,
      w: (extent?.maxX ?? 0) - (extent?.minX ?? 0),
      h: (extent?.maxY ?? 0) - (extent?.minY ?? 0),
    });
  });
});
