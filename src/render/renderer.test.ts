/**
 * renderer.test.ts — Tests for `renderer.ts` (§5.9, §5.4's rendering clause).
 *
 * No jsdom (D-001/PROCESS_BRIEF §4: never add a runtime dependency): every
 * test builds a plain object satisfying exactly the `CanvasRenderingContext2D`
 * members `renderer.ts` actually calls, records them, and casts it via
 * `as unknown as CanvasRenderingContext2D` — the render-layer analogue of the
 * engine's injected-fake-`TextMeasurer` pattern (Rule 1's own test posture),
 * translated to a layer the DOM IS available to.
 */
import { describe, expect, it } from "vitest";
import { mutate } from "../engine/mutation.ts";
import type { GraphObject, Slot } from "../engine/graph/node.ts";
import { getObjectSchema } from "../engine/primitives/schema.ts";
import type { CameraState } from "../engine/document.ts";
import { renderDocument } from "./renderer.ts";

type RecordedCall =
  | { readonly op: "clearRect"; readonly x: number; readonly y: number; readonly w: number; readonly h: number }
  | { readonly op: "setTransform"; readonly a: number; readonly b: number; readonly c: number; readonly d: number; readonly e: number; readonly f: number }
  | { readonly op: "beginPath" }
  | { readonly op: "moveTo"; readonly x: number; readonly y: number }
  | { readonly op: "lineTo"; readonly x: number; readonly y: number }
  | { readonly op: "closePath" }
  | { readonly op: "stroke" }
  | { readonly op: "arc"; readonly x: number; readonly y: number; readonly radius: number; readonly startAngle: number; readonly endAngle: number }
  | { readonly op: "strokeRect"; readonly x: number; readonly y: number; readonly w: number; readonly h: number }
  | { readonly op: "fillText"; readonly text: string; readonly x: number; readonly y: number; readonly align: string };

/** A minimal recording fake — only the `CanvasRenderingContext2D` members `renderer.ts` calls. See file header. */
function createFakeContext(): { readonly ctx: CanvasRenderingContext2D; readonly calls: readonly RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const ctx = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    textAlign: "left",
    textBaseline: "alphabetic",
    font: "",
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
    },
    arc(x: number, y: number, radius: number, startAngle: number, endAngle: number) {
      calls.push({ op: "arc", x, y, radius, startAngle, endAngle });
    },
    strokeRect(x: number, y: number, w: number, h: number) {
      calls.push({ op: "strokeRect", x, y, w, h });
    },
    fillText(text: string, x: number, y: number) {
      calls.push({ op: "fillText", text, x, y, align: ctx.textAlign });
    },
  };
  // The fake implements exactly the subset of CanvasRenderingContext2D this
  // file's tests exercise — a real ctx has many more members renderer.ts
  // never calls, which is why this is a deliberate cast rather than a
  // structural fit (see file header).
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
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

  it("applies the camera transform via the SAME formula render/camera.ts's worldToScreen uses (D-010)", () => {
    const { ctx, calls } = createFakeContext();
    const camera: CameraState = { x: 10, y: 20, zoom: 2 };
    renderDocument(ctx, 800, 600, [], camera);
    // screen = (world - camera) * zoom => e = -10*2 = -20, f = -20*2 = -40.
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
    // World (3,4) r=10 stays (3,4) r=10 — NOT worldToScreen'd to (-14,-32) r=20.
    // Double-transforming is exactly what the single setTransform above exists
    // to prevent, and every OTHER shape test here uses an identity camera, where
    // the two are indistinguishable (0062-REVIEW edit 2).
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
    expect(lineToCalls).toEqual([]); // Never the CIRCLE_VERTEX_COUNT-gon approximation (§5.5).
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
    const shapeCalls = calls.filter((call) => call.op !== "setTransform" && call.op !== "clearRect");
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

describe("renderDocument — table: fixed-size grid, alignment per §5.4", () => {
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
    // The trailing entry is D-092 clause 1's name label — a table with no
    // origin.x/origin.y slots anchors at drawTable's own (0,0) fallback.
    expect(textCalls).toEqual([
      { op: "fillText", text: "42", x: 76, y: 12, align: "right" },
      { op: "fillText", text: "hello", x: 84, y: 12, align: "left" },
      { op: "fillText", text: "TRUE", x: 164, y: 12, align: "left" },
      { op: "fillText", text: "table_1", x: 0, y: -6, align: "center" },
    ]);
  });

  it("displays an ErrorValue cell as its bare error code, left-aligned", () => {
    const { ctx, calls } = createFakeContext();
    const table = tableObject({ "cells.A1": { kind: "derived", value: { error: "#REF", message: "gone" } } });
    renderDocument(ctx, 800, 600, [table], CAMERA_IDENTITY);
    const textCalls = calls.filter((call) => call.op === "fillText");
    // Plus D-092's name label and D-068's error badge — objectHasError scans
    // EVERY slot (file header), and cells.A1 here is one of them.
    expect(textCalls).toEqual([
      { op: "fillText", text: "#REF", x: 4, y: 12, align: "left" },
      { op: "fillText", text: "table_1", x: 0, y: -6, align: "center" },
      { op: "fillText", text: "!", x: 14, y: -6, align: "left" },
    ]);
  });

  it("draws no CELL text for a null-valued or entirely unset cell — only the name label", () => {
    const { ctx, calls } = createFakeContext();
    const table = tableObject({ "cells.A1": { kind: "literal", value: null } }); // B1/C1 have no slot at all.
    renderDocument(ctx, 800, 600, [table], CAMERA_IDENTITY);
    const textCalls = calls.filter((call) => call.op === "fillText");
    expect(textCalls).toEqual([{ op: "fillText", text: "table_1", x: 0, y: -6, align: "center" }]);
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
});

describe("renderDocument — wired through the real mutate() pipeline (D-016 discipline)", () => {
  it("draws a real, evaluated pentagon's actual vertices, not a hand-fed fixture", () => {
    const schema = getObjectSchema("polygon");
    if (schema === undefined) {
      throw new Error("test setup: expected a schema for polygon");
    }
    const placeholders: Record<string, Slot> = {};
    for (const slot of schema.derivedSlots) {
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
    // A pentagon: 1 moveTo (the first vertex) + 4 lineTo (the remaining four) — the REAL evaluated `vertices`, not a fixture this test wrote by hand.
    expect(moveToCalls).toHaveLength(1);
    expect(lineToCalls).toHaveLength(4);
  });
});

function circleObject(id: string, name: string, slots: Readonly<Record<string, Slot>> = {}): GraphObject {
  return {
    id,
    name,
    type: "circle",
    slots: { "origin.x": { kind: "literal", value: 0 }, "origin.y": { kind: "literal", value: 0 }, radius: { kind: "literal", value: 5 }, ...slots },
  };
}

describe("renderDocument — name label (D-092 clause 1)", () => {
  it("draws every object's name in the SCREEN-space pass, centred above its anchor point converted through the SAME worldToScreen the camera transform uses", () => {
    const { ctx, calls } = createFakeContext();
    const circle = circleObject("obj_1", "circle_7", { "origin.x": { kind: "literal", value: 3 }, "origin.y": { kind: "literal", value: 4 } });
    renderDocument(ctx, 800, 600, [circle], { x: 0, y: 0, zoom: 2 });
    // World (3,4) at zoom 2 -> screen (6,8); the label sits CHROME_ANCHOR_MARGIN_SCREEN above that.
    const textCalls = calls.filter((call) => call.op === "fillText");
    expect(textCalls).toEqual([{ op: "fillText", text: "circle_7", x: 6, y: 2, align: "center" }]);
  });

  it("draws no label for a type with no schema/anchor point yet", () => {
    const { ctx, calls } = createFakeContext();
    const value: GraphObject = { id: "obj_1", name: "value_1", type: "value", slots: { value: { kind: "literal", value: 1 } } };
    renderDocument(ctx, 800, 600, [value], CAMERA_IDENTITY);
    expect(calls.some((call) => call.op === "fillText")).toBe(false);
  });

  it("labels a circle whose radius is missing (draws no body) at its origin — the label and the body have independent preconditions", () => {
    const { ctx, calls } = createFakeContext();
    const circle: GraphObject = { id: "obj_1", name: "circle_1", type: "circle", slots: { "origin.x": { kind: "literal", value: 0 }, "origin.y": { kind: "literal", value: 0 } } };
    renderDocument(ctx, 800, 600, [circle], CAMERA_IDENTITY);
    expect(calls.some((call) => call.op === "arc")).toBe(false);
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

describe("renderDocument — selection highlight (D-068)", () => {
  it("re-strokes the selected circle's own path, in addition to the ordinary draw", () => {
    const { ctx, calls } = createFakeContext();
    const circle = circleObject("obj_1", "circle_1");
    renderDocument(ctx, 800, 600, [circle], CAMERA_IDENTITY, "obj_1");
    expect(calls.filter((call) => call.op === "arc")).toHaveLength(2);
    expect(calls.filter((call) => call.op === "stroke")).toHaveLength(2);
  });

  it("draws no highlight when nothing is selected", () => {
    const { ctx, calls } = createFakeContext();
    const circle = circleObject("obj_1", "circle_1");
    renderDocument(ctx, 800, 600, [circle], CAMERA_IDENTITY, undefined);
    expect(calls.filter((call) => call.op === "arc")).toHaveLength(1);
  });

  it("draws no highlight for a selectedObjectId naming no object in the document (a stale selection)", () => {
    const { ctx, calls } = createFakeContext();
    const circle = circleObject("obj_1", "circle_1");
    renderDocument(ctx, 800, 600, [circle], CAMERA_IDENTITY, "obj_missing");
    expect(calls.filter((call) => call.op === "arc")).toHaveLength(1);
  });

  it("highlights a table as its whole grid extent, not per-cell — one extra strokeRect beyond the cell borders", () => {
    const { ctx, calls } = createFakeContext();
    const table: GraphObject = { id: "obj_1", name: "table_1", type: "table", slots: { rows: { kind: "literal", value: 2 }, cols: { kind: "literal", value: 2 } } };
    renderDocument(ctx, 800, 600, [table], CAMERA_IDENTITY, "obj_1");
    const rects = calls.filter((call) => call.op === "strokeRect");
    expect(rects).toHaveLength(5); // 4 cell borders + 1 highlight around the whole grid.
    expect(rects[4]).toEqual({ op: "strokeRect", x: 0, y: 0, w: 160, h: 48 });
  });

  it("is drawn AFTER every object, so a later object in z-order cannot occlude an earlier one's highlight", () => {
    const { ctx, calls } = createFakeContext();
    const circleA = circleObject("obj_1", "circle_a");
    const circleB = circleObject("obj_2", "circle_b");
    renderDocument(ctx, 800, 600, [circleA, circleB], CAMERA_IDENTITY, "obj_1");
    // 2 arcs for the ordinary draw (a then b), then obj_1's highlight arc LAST.
    const arcCalls = calls.filter((call) => call.op === "arc");
    expect(arcCalls).toHaveLength(3);
  });

  it("highlights nothing, without throwing, for a selected object of a type with no visual definition yet", () => {
    const { ctx, calls } = createFakeContext();
    const value: GraphObject = { id: "obj_1", name: "value_1", type: "value", slots: { value: { kind: "literal", value: 1 } } };
    expect(() => renderDocument(ctx, 800, 600, [value], CAMERA_IDENTITY, "obj_1")).not.toThrow();
    expect(calls.some((call) => call.op === "stroke")).toBe(false);
  });
});

describe("renderDocument — error badge (D-068)", () => {
  it("badges an object holding an ErrorValue in ANY slot, not only the ones this file draws from", () => {
    const { ctx, calls } = createFakeContext();
    const circle = circleObject("obj_1", "circle_1", { radius: { kind: "derived", value: { error: "#TYPE", message: "bad" } } });
    renderDocument(ctx, 800, 600, [circle], CAMERA_IDENTITY);
    expect(calls.some((call) => call.op === "fillText" && call.text === "!")).toBe(true);
  });

  it("draws no badge for an object with no ErrorValue anywhere", () => {
    const { ctx, calls } = createFakeContext();
    const circle = circleObject("obj_1", "circle_1");
    renderDocument(ctx, 800, 600, [circle], CAMERA_IDENTITY);
    expect(calls.some((call) => call.op === "fillText" && call.text === "!")).toBe(false);
  });
});

describe("renderDocument — formula-driven indicator (§5.9, D-068)", () => {
  // `value: 0` keeps the world anchor at circleObject's own (0,0) origin — only
  // the KIND differs from the literal default, which is what the indicator
  // reads (file header: `getSlot(...)?.kind === "formula"`, never the value).
  function boundToCellSlot(): Slot {
    return { kind: "formula", ast: { type: "reference", address: { objectId: "obj_2", path: ["cells", "A1"] } }, value: 0 };
  }

  it("marks origin.x when its slot kind is formula, and leaves a literal origin.y unmarked", () => {
    const { ctx, calls } = createFakeContext();
    const circle = circleObject("obj_1", "circle_1", { "origin.x": boundToCellSlot() });
    renderDocument(ctx, 800, 600, [circle], CAMERA_IDENTITY);
    const ticks = calls.filter((call) => call.op === "fillText" && (call.text === "•x" || call.text === "•y"));
    expect(ticks).toEqual([{ op: "fillText", text: "•x", x: -14, y: 6, align: "center" }]);
  });

  it("marks both axes independently when both origin.x and origin.y are formula slots", () => {
    const { ctx, calls } = createFakeContext();
    const circle = circleObject("obj_1", "circle_1", { "origin.x": boundToCellSlot(), "origin.y": boundToCellSlot() });
    renderDocument(ctx, 800, 600, [circle], CAMERA_IDENTITY);
    const ticks = calls.filter((call) => call.op === "fillText" && (call.text === "•x" || call.text === "•y"));
    expect(ticks).toEqual([
      { op: "fillText", text: "•x", x: -14, y: 6, align: "center" },
      { op: "fillText", text: "•y", x: 14, y: 6, align: "center" },
    ]);
  });

  it("marks neither axis when both origin.x and origin.y are literal", () => {
    const { ctx, calls } = createFakeContext();
    const circle = circleObject("obj_1", "circle_1");
    renderDocument(ctx, 800, 600, [circle], CAMERA_IDENTITY);
    expect(calls.some((call) => call.op === "fillText" && (call.text === "•x" || call.text === "•y"))).toBe(false);
  });

  it("marks neither axis for a DERIVED slot — never reachable in practice (origin is never declared derived), but the check reads the kind, not the presence, of a slot", () => {
    const { ctx, calls } = createFakeContext();
    const circle = circleObject("obj_1", "circle_1", { "origin.x": { kind: "derived", value: 0 } });
    renderDocument(ctx, 800, 600, [circle], CAMERA_IDENTITY);
    expect(calls.some((call) => call.op === "fillText" && call.text === "•x")).toBe(false);
  });
});
