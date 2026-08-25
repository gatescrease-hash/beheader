/**
 * hittest.test.ts — Tests for `hittest.ts` (§5.9).
 *
 * Pure geometry over `GraphObject`/`CameraState` — no Canvas2D fake needed
 * (contrast `renderer.test.ts`), since this file never touches a canvas.
 */
import { describe, expect, it } from "vitest";
import type { GraphObject } from "../engine/graph/node.ts";
import type { CameraState } from "../engine/document.ts";
import { hitTest, STROKE_HIT_TOLERANCE_SCREEN_PIXELS } from "./hittest.ts";

const CAMERA_IDENTITY: CameraState = { x: 0, y: 0, zoom: 1 };

/**
 * A closed 20x20 square, `vertices`-shaped — the interface every one of
 * `circle`/`polygon`/`rect` presents (§5.5: "Consumers always read
 * `vertices`"). Sized well past twice the stroke tolerance (5 world units at
 * zoom 1) so its CENTER is unambiguously beyond every edge's tolerance band —
 * a 10x10 square's center sits exactly 5 units from every edge, which is the
 * tolerance itself and would make the "deep inside" test a boundary case
 * instead of the "there is no fill" case it is meant to pin.
 */
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
    // World (5, -4): 4 world units above the top edge (0,0)-(20,0); tolerance
    // at zoom 1 is STROKE_HIT_TOLERANCE_SCREEN_PIXELS (5) world units.
    expect(hitTest({ x: 5, y: -4 }, [square], CAMERA_IDENTITY)).toBe(square);
  });

  it("does not hit a point beyond tolerance of every edge", () => {
    const square = squareObject("obj_1", "rect_1", "rect");
    expect(hitTest({ x: 5, y: -6 }, [square], CAMERA_IDENTITY)).toBeUndefined();
  });

  it("does not hit a point deep INSIDE the shape — there is no fill yet (file header)", () => {
    const square = squareObject("obj_1", "rect_1", "rect");
    // The square's center: 10 world units from every edge, well past the
    // 5-unit tolerance.
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
    // World (5, -4) is 4 world units from the top edge and DOES hit at zoom 1
    // (tolerance 5 world units — see the first test in this block).
    expect(hitTest({ x: 5, y: -4 }, [square], CAMERA_IDENTITY)).toBe(square);
    // The SAME world point (5, -4), reached at zoom 2 (screenToWorld: world =
    // screen / zoom, so the screen point doubles), no longer hits: the world
    // tolerance halves to 2.5, and 4 > 2.5.
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
    // 2 rows x 3 cols at the default cell size: box is (0,0) to (240, 48).
    expect(hitTest({ x: 120, y: 24 }, [table], CAMERA_IDENTITY)).toBe(table);
  });

  it("does not hit a point outside the bounding box", () => {
    const table = tableObject("obj_1", "table_1");
    expect(hitTest({ x: 500, y: 500 }, [table], CAMERA_IDENTITY)).toBeUndefined();
  });

  it("honors origin.x/origin.y when present", () => {
    const table = tableObject("obj_1", "table_1", 100, 200);
    expect(hitTest({ x: 120, y: 24 }, [table], CAMERA_IDENTITY)).toBeUndefined(); // the un-shifted box no longer applies
    expect(hitTest({ x: 150, y: 210 }, [table], CAMERA_IDENTITY)).toBe(table);
  });

  it("does not hit a 0-row table anywhere on its degenerate box, because nothing is drawn (D-066)", () => {
    const table: GraphObject = { id: "obj_1", name: "table_1", type: "table", slots: { rows: { kind: "literal", value: 0 }, cols: { kind: "literal", value: 3 } } };
    // The box collapses to the line y = 0, x in [0, 240]. The containment test
    // is inclusive, so every point ON that line would hit without the guard.
    expect(hitTest({ x: 120, y: 0 }, [table], CAMERA_IDENTITY)).toBeUndefined();
    expect(hitTest({ x: 0, y: 0 }, [table], CAMERA_IDENTITY)).toBeUndefined();
  });

  it("does not hit a table with no rows/cols slots at its origin corner, the point its zero-area box contains (D-066)", () => {
    // A table carrying no dimension slots at all — a shape a creation command
    // never produces, but a load or a raw `setSlot` can: `getTableDimensions`
    // fails safe to 0/0 (D-046) and `drawTable` draws nothing, so no click may
    // land on it.
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

describe("hitTest — object types with no schema/visual definition yet never hit (mirrors renderer.ts)", () => {
  it("never hits a polyline/text/script/image/value/add object, regardless of point", () => {
    for (const type of ["polyline", "text", "script", "image", "value", "add"] as const) {
      const object: GraphObject = { id: "obj_1", name: `${type}_1`, type, slots: {} };
      expect(hitTest({ x: 0, y: 0 }, [object], CAMERA_IDENTITY)).toBeUndefined();
    }
  });
});

// Sanity: the exported tolerance constant is what the zoom-conversion test above assumes.
describe("hitTest — tolerance constant", () => {
  it("is a positive number of screen pixels", () => {
    expect(STROKE_HIT_TOLERANCE_SCREEN_PIXELS).toBeGreaterThan(0);
  });
});
