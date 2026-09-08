/**
 * hittest.test.ts
 *
 * Fills, strokes, boxes and z order.
 */
import { describe, expect, it } from "vitest";
import type { GraphObject } from "../engine/graph/node.ts";
import type { CameraState } from "../engine/document.ts";
import { hitTest, STROKE_HIT_TOLERANCE_SCREEN_PIXELS } from "./hittest.ts";
import { documentExtent } from "./extent.ts";

const CAMERA_IDENTITY: CameraState = { x: 0, y: 0, zoom: 1 };

function squareObject(id: string, name: string, type: "circle" | "polygon" | "rect"): GraphObject {
  return {
    id,
    name,
    type,
    slots: {
      vertices: {
        kind: "derived",
        value: [
          { x: 0, y: 0 },
          { x: 20, y: 0 },
          { x: 20, y: 20 },
          { x: 0, y: 20 },
        ],
      },
    },
  };
}

describe("hitTest — circle/polygon/rect: stroke distance-to-segment via vertices", () => {
  it("hits a point within tolerance of an edge", () => {
    const square = squareObject("obj_1", "rect_1", "rect");
    expect(hitTest({ x: 5, y: -4 }, [square], CAMERA_IDENTITY)).toBe(square);
  });

  it("does not hit a point beyond tolerance of every edge", () => {
    const square = squareObject("obj_1", "rect_1", "rect");
    expect(hitTest({ x: 5, y: -6 }, [square], CAMERA_IDENTITY)).toBeUndefined();
  });

  it("does not hit a point deep INSIDE the shape — there is no fill yet (file header)", () => {
    const square = squareObject("obj_1", "rect_1", "rect");
    expect(hitTest({ x: 10, y: 10 }, [square], CAMERA_IDENTITY)).toBeUndefined();
  });

  it("applies the same test to circle/polygon/rect alike, since all three read `vertices` (§5.5)", () => {
    for (const type of ["circle", "polygon", "rect"] as const) {
      const square = squareObject("obj_1", `${type}_1`, type);
      expect(hitTest({ x: 5, y: -4 }, [square], CAMERA_IDENTITY)).toBe(square);
    }
  });

  it("converts the pixel tolerance into world units via camera.zoom (§5.9: 'pixel tolerance')", () => {
    const square = squareObject("obj_1", "rect_1", "rect");
    expect(hitTest({ x: 5, y: -4 }, [square], CAMERA_IDENTITY)).toBe(square);
    const zoomedCamera: CameraState = { x: 0, y: 0, zoom: 2 };
    expect(hitTest({ x: 10, y: -8 }, [square], zoomedCamera)).toBeUndefined();
  });

  it("does not hit when vertices holds an ErrorValue (never throws)", () => {
    const square: GraphObject = { id: "obj_1", name: "rect_1", type: "rect", slots: { vertices: { kind: "derived", value: { error: "#TYPE", message: "broken" } } } };
    expect(() => hitTest({ x: 5, y: 0 }, [square], CAMERA_IDENTITY)).not.toThrow();
    expect(hitTest({ x: 5, y: 0 }, [square], CAMERA_IDENTITY)).toBeUndefined();
  });

  it("does not hit when vertices is missing entirely (never throws)", () => {
    const square: GraphObject = { id: "obj_1", name: "rect_1", type: "rect", slots: {} };
    expect(() => hitTest({ x: 5, y: 0 }, [square], CAMERA_IDENTITY)).not.toThrow();
    expect(hitTest({ x: 5, y: 0 }, [square], CAMERA_IDENTITY)).toBeUndefined();
  });
});

describe("hitTest — table: bounding box", () => {
  function tableObject(id: string, name: string, originX?: number, originY?: number): GraphObject {
    const slots: GraphObject["slots"] = { rows: { kind: "literal", value: 2 }, cols: { kind: "literal", value: 3 } };
    return {
      id,
      name,
      type: "table",
      slots: originX === undefined ? slots : { ...slots, "origin.x": { kind: "literal", value: originX }, "origin.y": { kind: "literal", value: originY ?? 0 } },
    };
  }

  it("hits any point inside the grid's bounding box, falling back to origin (0,0)", () => {
    const table = tableObject("obj_1", "table_1");
    expect(hitTest({ x: 120, y: 24 }, [table], CAMERA_IDENTITY)).toBe(table);
  });

  it("does not hit a point outside the bounding box", () => {
    const table = tableObject("obj_1", "table_1");
    expect(hitTest({ x: 500, y: 500 }, [table], CAMERA_IDENTITY)).toBeUndefined();
  });

  it("honors origin.x/origin.y when present", () => {
    const table = tableObject("obj_1", "table_1", 100, 200);
    expect(hitTest({ x: 120, y: 24 }, [table], CAMERA_IDENTITY)).toBeUndefined();
    expect(hitTest({ x: 150, y: 210 }, [table], CAMERA_IDENTITY)).toBe(table);
  });

  it("does not hit a 0-row table anywhere on its degenerate box, because nothing is drawn (D-066)", () => {
    const table: GraphObject = { id: "obj_1", name: "table_1", type: "table", slots: { rows: { kind: "literal", value: 0 }, cols: { kind: "literal", value: 3 } } };
    expect(hitTest({ x: 120, y: 0 }, [table], CAMERA_IDENTITY)).toBeUndefined();
    expect(hitTest({ x: 0, y: 0 }, [table], CAMERA_IDENTITY)).toBeUndefined();
  });

  it("does not hit a table with no rows/cols slots at its origin corner, the point its zero-area box contains (D-066)", () => {
    const table: GraphObject = { id: "obj_1", name: "table_1", type: "table", slots: {} };
    expect(hitTest({ x: 0, y: 0 }, [table], CAMERA_IDENTITY)).toBeUndefined();
  });
});

describe("hitTest — topmost object wins (§5.9, array order = z-order per renderer.ts)", () => {
  it("returns the LAST object of two overlapping tables", () => {
    const bottom = { id: "obj_1", name: "table_a", type: "table" as const, slots: { rows: { kind: "literal" as const, value: 5 }, cols: { kind: "literal" as const, value: 5 } } };
    const top = { id: "obj_2", name: "table_b", type: "table" as const, slots: { rows: { kind: "literal" as const, value: 5 }, cols: { kind: "literal" as const, value: 5 } } };
    expect(hitTest({ x: 10, y: 10 }, [bottom, top], CAMERA_IDENTITY)).toBe(top);
  });

  it("returns undefined when nothing is under the point", () => {
    const table = { id: "obj_1", name: "table_1", type: "table" as const, slots: {} };
    expect(hitTest({ x: 9999, y: 9999 }, [table], CAMERA_IDENTITY)).toBeUndefined();
  });

  it("returns undefined for an empty object list", () => {
    expect(hitTest({ x: 0, y: 0 }, [], CAMERA_IDENTITY)).toBeUndefined();
  });
});

describe("hitTest — object types with no visual definition yet never hit (mirrors renderer.ts)", () => {
  it("never hits a polyline/value/add object, regardless of point", () => {
    for (const type of ["polyline", "value", "add"] as const) {
      const object: GraphObject = { id: "obj_1", name: `${type}_1`, type, slots: {} };
      expect(hitTest({ x: 0, y: 0 }, [object], CAMERA_IDENTITY)).toBeUndefined();
    }
  });

  it("never hits a slotless image either — it has no width or height, so it draws no frame (D-066)", () => {
    const object: GraphObject = { id: "obj_1", name: "image_1", type: "image", slots: {} };
    expect(hitTest({ x: 0, y: 0 }, [object], CAMERA_IDENTITY)).toBeUndefined();
  });
});

describe("hitTest — image bounding box (§5.9, D-142) — the same extent renderer.ts frames", () => {
  function imageObject(originX: number, originY: number, overrides: GraphObject["slots"] = {}): GraphObject {
    return {
      id: "obj_1",
      name: "image_1",
      type: "image",
      slots: {
        "origin.x": { kind: "literal", value: originX },
        "origin.y": { kind: "literal", value: originY },
        width: { kind: "literal", value: 100 },
        height: { kind: "literal", value: 60 },
        opacity: { kind: "literal", value: 1 },
        source: { kind: "literal", value: "" },
        ...overrides,
      },
    };
  }

  it("hits a point inside the box, inclusive of its corners", () => {
    const image = imageObject(10, 20);
    expect(hitTest({ x: 50, y: 40 }, [image], CAMERA_IDENTITY)).toBe(image);
    expect(hitTest({ x: 10, y: 20 }, [image], CAMERA_IDENTITY)).toBe(image);
    expect(hitTest({ x: 110, y: 80 }, [image], CAMERA_IDENTITY)).toBe(image);
  });

  it("does not hit a point outside the box", () => {
    const image = imageObject(10, 20);
    expect(hitTest({ x: 111, y: 40 }, [image], CAMERA_IDENTITY)).toBeUndefined();
    expect(hitTest({ x: 50, y: 19 }, [image], CAMERA_IDENTITY)).toBeUndefined();
  });

  it("hits an image with NO picture chosen, because its frame is drawn from the moment it is created (D-142 — the invisible-object state is what was refused)", () => {
    const empty = imageObject(0, 0, { source: { kind: "literal", value: "" } });
    expect(hitTest({ x: 50, y: 30 }, [empty], CAMERA_IDENTITY)).toBe(empty);
  });

  it("does not hit an image with a non-positive or non-finite box, which draws nothing (D-066)", () => {
    for (const width of [0, -10, Number.POSITIVE_INFINITY, Number.NaN]) {
      const degenerate = imageObject(0, 0, { width: { kind: "literal", value: width } });
      expect(hitTest({ x: 0, y: 0 }, [degenerate], CAMERA_IDENTITY)).toBeUndefined();
    }
  });
});

describe("hitTest — text bounding box (§5.9, entry 0138) — the same extent renderer.ts draws into", () => {
  function textObject(resolved: string | undefined, originX: number, originY: number, overrides: GraphObject["slots"] = {}): GraphObject {
    return {
      id: "obj_1",
      name: "text_1",
      type: "text",
      slots: {
        "origin.x": { kind: "literal", value: originX },
        "origin.y": { kind: "literal", value: originY },
        width: { kind: "literal", value: "auto" },
        "style.lineHeight": { kind: "literal", value: 20 },
        resolvedContent: { kind: "derived", value: resolved ?? null },
        ...overrides,
      },
    };
  }

  it("hits a point inside a fixed-width, measured-height box", () => {
    const text = textObject("hello", 10, 20, {
      width: { kind: "literal", value: 120 },
      measuredHeight: { kind: "derived", value: 30 },
    });
    expect(hitTest({ x: 40, y: 35 }, [text], CAMERA_IDENTITY)).toBe(text);
    expect(hitTest({ x: 10, y: 20 }, [text], CAMERA_IDENTITY)).toBe(text);
  });

  it("does not hit a point outside the box", () => {
    const text = textObject("hello", 10, 20, { width: { kind: "literal", value: 120 }, measuredHeight: { kind: "derived", value: 30 } });
    expect(hitTest({ x: 200, y: 35 }, [text], CAMERA_IDENTITY)).toBeUndefined();
    expect(hitTest({ x: 40, y: 100 }, [text], CAMERA_IDENTITY)).toBeUndefined();
  });

  it("falls back to a fixed box only when NOTHING measured the object — no measurer wired, so measuredWidth/Height are absent (D-123 clause 3)", () => {
    const text = textObject("label", 0, 0);
    expect(hitTest({ x: 100, y: 10 }, [text], CAMERA_IDENTITY)).toBe(text);
    expect(hitTest({ x: 300, y: 10 }, [text], CAMERA_IDENTITY)).toBeUndefined();
  });

  it("D-123: an auto-width text object's click box is its MEASURED width, not the fallback — a short label no longer swallows its neighbours' clicks", () => {
    const text = textObject("label", 0, 0, {
      measuredWidth: { kind: "derived", value: 30 },
      measuredHeight: { kind: "derived", value: 20 },
    });
    expect(hitTest({ x: 20, y: 10 }, [text], CAMERA_IDENTITY)).toBe(text);
    expect(hitTest({ x: 100, y: 10 }, [text], CAMERA_IDENTITY)).toBeUndefined();
  });

  it("D-123: a measured width WIDER than the old fallback is clickable to its far edge — a long label is no longer unclickable past 240", () => {
    const text = textObject("a very long label indeed", 0, 0, {
      measuredWidth: { kind: "derived", value: 400 },
      measuredHeight: { kind: "derived", value: 20 },
    });
    expect(hitTest({ x: 380, y: 10 }, [text], CAMERA_IDENTITY)).toBe(text);
    expect(hitTest({ x: 420, y: 10 }, [text], CAMERA_IDENTITY)).toBeUndefined();
  });

  it("a set width holds when the text fits inside it — the box does not shrink to the ink (autoresize governs the HEIGHT only)", () => {
    const text = textObject("label", 0, 0, {
      width: { kind: "literal", value: 300 },
      measuredWidth: { kind: "derived", value: 60 },
      measuredHeight: { kind: "derived", value: 20 },
    });
    expect(hitTest({ x: 280, y: 10 }, [text], CAMERA_IDENTITY)).toBe(text);
    expect(hitTest({ x: 320, y: 10 }, [text], CAMERA_IDENTITY)).toBeUndefined();
  });

  it("a set width GROWS to the measurement when the text cannot be wrapped into it — a text box never crops (the human, 2026-09-02)", () => {
    const text = textObject("label", 0, 0, {
      width: { kind: "literal", value: 60 },
      measuredWidth: { kind: "derived", value: 400 },
      measuredHeight: { kind: "derived", value: 20 },
    });
    expect(hitTest({ x: 100, y: 10 }, [text], CAMERA_IDENTITY)).toBe(text);
    expect(hitTest({ x: 420, y: 10 }, [text], CAMERA_IDENTITY)).toBeUndefined();
  });

  it("D-123: a #MEASURE measuredWidth (no measurer, D-118) is not a number, so the fallback still applies", () => {
    const text = textObject("label", 0, 0, {
      measuredWidth: { kind: "derived", value: { error: "#MEASURE", message: "no measurer" } },
    });
    expect(hitTest({ x: 100, y: 10 }, [text], CAMERA_IDENTITY)).toBe(text);
  });

  it("never hits a text object with no resolved content — nothing is drawn to click (D-066)", () => {
    expect(hitTest({ x: 0, y: 0 }, [textObject(undefined, 0, 0)], CAMERA_IDENTITY)).toBeUndefined();
    expect(hitTest({ x: 0, y: 0 }, [textObject("", 0, 0)], CAMERA_IDENTITY)).toBeUndefined();
    expect(hitTest({ x: 0, y: 0 }, [{ id: "obj_1", name: "text_1", type: "text", slots: {} }], CAMERA_IDENTITY)).toBeUndefined();
  });

  it("is topmost-wins against an overlapping shape, like every other type", () => {
    const square = squareObject("obj_1", "rect_1", "rect");
    const text = { ...textObject("x", 0, 0, { width: { kind: "literal" as const, value: 40 }, measuredHeight: { kind: "derived" as const, value: 40 } }), id: "obj_2", name: "text_1" };
    expect(hitTest({ x: 10, y: 10 }, [square, text], CAMERA_IDENTITY)).toBe(text);
  });
});

describe("hitTest — tolerance constant", () => {
  it("is a positive number of screen pixels", () => {
    expect(STROKE_HIT_TOLERANCE_SCREEN_PIXELS).toBeGreaterThan(0);
  });
});

describe("documentExtent — the box `fit` fits to (§5.10, performed in main.ts)", () => {
  function tableFixture(id: string, originX: number, originY: number): GraphObject {
    return {
      id,
      name: id,
      type: "table",
      slots: {
        rows: { kind: "literal", value: 2 },
        cols: { kind: "literal", value: 3 },
        "origin.x": { kind: "literal", value: originX },
        "origin.y": { kind: "literal", value: originY },
      },
    };
  }

  it("is undefined for a document with no objects at all", () => {
    expect(documentExtent([])).toBeUndefined();
  });

  it("is undefined when every object draws nothing, which no document read could have refused", () => {
    const unrendered: GraphObject = { id: "obj_1", name: "text_1", type: "text", slots: {} };
    expect(documentExtent([unrendered])).toBeUndefined();
  });

  it("bounds a shape by its vertices — §5.5's own instruction that `vertices` is what bounds a circle", () => {
    expect(documentExtent([squareObject("obj_1", "polygon_1", "polygon")])).toEqual({ minX: 0, minY: 0, maxX: 20, maxY: 20 });
  });

  it("bounds a table by the box it is drawn in, at the same cell size hitTestTable uses", () => {
    expect(documentExtent([tableFixture("obj_1", 100, 200)])).toEqual({ minX: 100, minY: 200, maxX: 340, maxY: 248 });
  });

  it("bounds a text object by its origin + fixed width + measuredHeight (entry 0138)", () => {
    const text: GraphObject = {
      id: "obj_1",
      name: "text_1",
      type: "text",
      slots: {
        "origin.x": { kind: "literal", value: 10 },
        "origin.y": { kind: "literal", value: 20 },
        width: { kind: "literal", value: 100 },
        measuredHeight: { kind: "derived", value: 40 },
        resolvedContent: { kind: "derived", value: "hi" },
      },
    };
    expect(documentExtent([text])).toEqual({ minX: 10, minY: 20, maxX: 110, maxY: 60 });
  });

  it("bounds an auto-width text object by measuredWidth + measuredHeight, so `fit` frames the text and not a fixed guess (D-123)", () => {
    const text: GraphObject = {
      id: "obj_1",
      name: "text_1",
      type: "text",
      slots: {
        "origin.x": { kind: "literal", value: 10 },
        "origin.y": { kind: "literal", value: 20 },
        width: { kind: "literal", value: "auto" },
        measuredWidth: { kind: "derived", value: 75 },
        measuredHeight: { kind: "derived", value: 40 },
        resolvedContent: { kind: "derived", value: "hi" },
      },
    };
    expect(documentExtent([text])).toEqual({ minX: 10, minY: 20, maxX: 85, maxY: 60 });
  });

  it("is undefined for a text object with no resolved content — matches the slotless-text case above", () => {
    const empty: GraphObject = { id: "obj_1", name: "text_1", type: "text", slots: { "origin.x": { kind: "literal", value: 5 }, width: { kind: "literal", value: 100 } } };
    expect(documentExtent([empty])).toBeUndefined();
  });

  it("bounds an image by its origin + width + height, whether or not a picture has been chosen (D-142)", () => {
    const image: GraphObject = {
      id: "obj_1",
      name: "image_1",
      type: "image",
      slots: {
        "origin.x": { kind: "literal", value: 10 },
        "origin.y": { kind: "literal", value: 20 },
        width: { kind: "literal", value: 100 },
        height: { kind: "literal", value: 60 },
        source: { kind: "literal", value: "" },
      },
    };
    expect(documentExtent([image])).toEqual({ minX: 10, minY: 20, maxX: 110, maxY: 80 });
  });

  it("is undefined for an image with a missing, non-positive or non-finite width/height — a box nothing is drawn in (D-066)", () => {
    const base = { id: "obj_1", name: "image_1", type: "image" } as const;
    const noSize: GraphObject = { ...base, slots: { "origin.x": { kind: "literal", value: 1 } } };
    const zero: GraphObject = { ...base, slots: { width: { kind: "literal", value: 0 }, height: { kind: "literal", value: 60 } } };
    const infinite: GraphObject = { ...base, slots: { width: { kind: "literal", value: Number.POSITIVE_INFINITY }, height: { kind: "literal", value: 60 } } };
    expect(documentExtent([noSize])).toBeUndefined();
    expect(documentExtent([zero])).toBeUndefined();
    expect(documentExtent([infinite])).toBeUndefined();
  });

  it("unions every object that draws something and skips every object that does not", () => {
    const unrendered: GraphObject = { id: "obj_3", name: "script_1", type: "script", slots: {} };
    const extent = documentExtent([squareObject("obj_1", "polygon_1", "polygon"), unrendered, tableFixture("obj_2", 100, 200)]);
    expect(extent).toEqual({ minX: 0, minY: 0, maxX: 340, maxY: 248 });
  });

  it("skips a table with a degenerate extent, exactly as the hit test does (D-066)", () => {
    const degenerate: GraphObject = { id: "obj_1", name: "table_1", type: "table", slots: { rows: { kind: "literal", value: 0 }, cols: { kind: "literal", value: 3 } } };
    expect(documentExtent([degenerate, squareObject("obj_2", "polygon_1", "polygon")])).toEqual({ minX: 0, minY: 0, maxX: 20, maxY: 20 });
  });

  it("is undefined for a shape whose vertices slot is missing, wrong-typed, or an ErrorValue — never throws", () => {
    const noVertices: GraphObject = { id: "obj_1", name: "polygon_1", type: "polygon", slots: {} };
    const wrongType: GraphObject = { id: "obj_2", name: "polygon_2", type: "polygon", slots: { vertices: { kind: "derived", value: 7 } } };
    const errored: GraphObject = { id: "obj_3", name: "polygon_3", type: "polygon", slots: { vertices: { kind: "derived", value: { error: "#TYPE", message: "no" } } } };
    expect(documentExtent([noVertices, wrongType, errored])).toBeUndefined();
  });

  it("gives a single point a real, degenerate extent rather than undefined — the caller decides what to do with it (D-066)", () => {
    const point: GraphObject = {
      id: "obj_1",
      name: "circle_1",
      type: "circle",
      slots: { vertices: { kind: "derived", value: [{ x: 5, y: 5 }, { x: 5, y: 5 }] } },
    };
    expect(documentExtent([point])).toEqual({ minX: 5, minY: 5, maxX: 5, maxY: 5 });
  });
});
