/**
 * editor.test.ts — Tests for `editor.ts` (**D-125**'s geometry half).
 *
 * Pure coordinate math over `GraphObject`/`CameraState` — no Canvas2D fake, no
 * DOM. The DOM half (element lifecycle, focus, commit wiring) lives in `start`
 * and is untested by construction (D-001); the commit `Command` builders live
 * in `main.ts`'s pure half and are tested in `main.test.ts`.
 */
import { describe, expect, it } from "vitest";
import type { CameraState } from "../engine/document.ts";
import type { GraphObject } from "../engine/graph/node.ts";
import { editorPlacement, editorTargetAt } from "./editor.ts";
import { TABLE_CELL_HEIGHT, TABLE_CELL_WIDTH } from "./slots.ts";

const CAMERA_IDENTITY: CameraState = { x: 0, y: 0, zoom: 1 };

/** A `text` object with a drawn extent — `resolvedContent` set, `width` fixed and `measuredHeight` present so the box is (originX,originY)-(originX+w, originY+h). `styleFontSize` is the `style.fontSize` slot D-129's overlay scales its font from; omit it to test the unusable-slot fallback. */
function textObject(
  originX: number,
  originY: number,
  width: number,
  height: number,
  styleFontSize?: number,
): GraphObject {
  return {
    id: "obj_text",
    name: "text_1",
    type: "text",
    slots: {
      "origin.x": { kind: "literal", value: originX },
      "origin.y": { kind: "literal", value: originY },
      width: { kind: "literal", value: width },
      resolvedContent: { kind: "derived", value: "hello" },
      measuredHeight: { kind: "derived", value: height },
      measuredWidth: { kind: "derived", value: width },
      ...(styleFontSize === undefined ? {} : { "style.fontSize": { kind: "literal" as const, value: styleFontSize } }),
    },
  };
}

/** An empty `text` object: `resolvedContent` unset, so `extent.ts` gives it NO extent (D-066). */
function emptyTextObject(originX: number, originY: number): GraphObject {
  return {
    id: "obj_empty",
    name: "text_2",
    type: "text",
    slots: {
      "origin.x": { kind: "literal", value: originX },
      "origin.y": { kind: "literal", value: originY },
      width: { kind: "literal", value: "auto" },
      resolvedContent: { kind: "derived", value: null },
    },
  };
}

function tableObject(originX: number, originY: number, rows: number, cols: number): GraphObject {
  return {
    id: "obj_table",
    name: "table_1",
    type: "table",
    slots: {
      "origin.x": { kind: "literal", value: originX },
      "origin.y": { kind: "literal", value: originY },
      rows: { kind: "literal", value: rows },
      cols: { kind: "literal", value: cols },
    },
  };
}

function circleObject(): GraphObject {
  return {
    id: "obj_circle",
    name: "circle_1",
    type: "circle",
    slots: {
      vertices: {
        kind: "derived",
        value: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
          { x: 0, y: 10 },
        ],
      },
    },
  };
}

describe("editorTargetAt — which receiver a double-click names (D-125 clause 4)", () => {
  it("names a `text` object as a whole when the point is inside its drawn box", () => {
    const text = textObject(10, 20, 100, 40); // box (10,20)-(110,60)
    expect(editorTargetAt({ x: 50, y: 40 }, [text], CAMERA_IDENTITY)).toEqual({ kind: "text", objectId: "obj_text" });
  });

  it("names the specific cell the point falls in, A1-form, for a table", () => {
    const table = tableObject(0, 0, 4, 4);
    // Column 2, row 3 -> B3. Point sits mid-cell.
    const point = { x: TABLE_CELL_WIDTH * 1.5, y: TABLE_CELL_HEIGHT * 2.5 };
    expect(editorTargetAt(point, [table], CAMERA_IDENTITY)).toEqual({ kind: "cell", objectId: "obj_table", cell: "B3" });
  });

  it("names A1 for a click in the top-left cell", () => {
    const table = tableObject(0, 0, 2, 2);
    expect(editorTargetAt({ x: 1, y: 1 }, [table], CAMERA_IDENTITY)).toEqual({ kind: "cell", objectId: "obj_table", cell: "A1" });
  });

  it("returns undefined for a click on a shape", () => {
    expect(editorTargetAt({ x: 0, y: 0 }, [circleObject()], CAMERA_IDENTITY)).toBeUndefined();
  });

  it("returns undefined for a click on empty canvas", () => {
    const text = textObject(10, 20, 100, 40);
    expect(editorTargetAt({ x: 500, y: 500 }, [text], CAMERA_IDENTITY)).toBeUndefined();
  });

  it("returns undefined for an empty `text` object — it has no hittable extent (D-125 clause 6's case, reached only via D-124)", () => {
    expect(editorTargetAt({ x: 5, y: 5 }, [emptyTextObject(0, 0)], CAMERA_IDENTITY)).toBeUndefined();
  });

  it("names the topmost object under the point, like a plain click", () => {
    const text = textObject(0, 0, 200, 60);
    const table = tableObject(0, 0, 2, 2); // later in the array -> drawn on top
    expect(editorTargetAt({ x: 10, y: 10 }, [text, table], CAMERA_IDENTITY)).toMatchObject({ kind: "cell" });
  });
});

describe("editorPlacement — where the overlay floats", () => {
  it("covers a `text` object's drawn box, in CSS pixels at ratio 1 / zoom 1", () => {
    const text = textObject(10, 20, 100, 40, 18);
    const placement = editorPlacement({ kind: "text", objectId: "obj_text" }, text, CAMERA_IDENTITY, 1);
    expect(placement).toEqual({ left: 10, top: 20, width: 100, height: 40, fontSize: 18 });
  });

  it("covers one table cell's world rectangle", () => {
    const table = tableObject(0, 0, 4, 4);
    const placement = editorPlacement({ kind: "cell", objectId: "obj_table", cell: "B3" }, table, CAMERA_IDENTITY, 1);
    expect(placement).toEqual({
      left: TABLE_CELL_WIDTH,
      top: TABLE_CELL_HEIGHT * 2,
      width: TABLE_CELL_WIDTH,
      height: TABLE_CELL_HEIGHT,
      // D-129: a cell has no per-object style slot, so the overlay uses a fixed base font size.
      fontSize: 14,
    });
  });

  it("applies the camera transform: pan and zoom move and scale the overlay, font included", () => {
    const text = textObject(10, 20, 100, 40, 16);
    const camera: CameraState = { x: 5, y: 5, zoom: 2 };
    const placement = editorPlacement({ kind: "text", objectId: "obj_text" }, text, camera, 1);
    // world (10,20) -> screen ((10-5)*2, (20-5)*2) = (10, 30); size 100x40 -> 200x80; font 16 -> 32 (D-129).
    expect(placement).toEqual({ left: 10, top: 30, width: 200, height: 80, fontSize: 32 });
  });

  it("divides screen coordinates AND the font size by the backing/CSS ratio (D-086 clause 3, D-129)", () => {
    const text = textObject(0, 0, 100, 40, 16);
    const camera: CameraState = { x: 0, y: 0, zoom: 2 };
    const placement = editorPlacement({ kind: "text", objectId: "obj_text" }, text, camera, 2);
    // world box 100x40 -> backing 200x80 -> CSS (÷2) 100x40; font 16 * 2 / 2 = 16.
    expect(placement).toEqual({ left: 0, top: 0, width: 100, height: 40, fontSize: 16 });
  });

  it("falls back to a default font size when the `text` object has no usable `style.fontSize` slot (D-129)", () => {
    const text = textObject(0, 0, 100, 40); // no style.fontSize slot
    const placement = editorPlacement({ kind: "text", objectId: "obj_text" }, text, CAMERA_IDENTITY, 1);
    expect(placement.fontSize).toBe(16);
  });

  it("falls back to a positive box at `origin` for an empty `text` object — the editor draws its own, extent.ts is not loosened (D-125 clause 6)", () => {
    const empty = emptyTextObject(30, 40);
    const placement = editorPlacement({ kind: "text", objectId: "obj_empty" }, empty, CAMERA_IDENTITY, 1);
    expect(placement.left).toBe(30);
    expect(placement.top).toBe(40);
    expect(placement.width).toBeGreaterThan(0);
    expect(placement.height).toBeGreaterThan(0);
    expect(placement.fontSize).toBeGreaterThan(0);
  });

  it("falls back to ratio 1 for a non-finite or non-positive ratio", () => {
    const text = textObject(0, 0, 100, 40, 16);
    expect(editorPlacement({ kind: "text", objectId: "obj_text" }, text, CAMERA_IDENTITY, 0)).toEqual({ left: 0, top: 0, width: 100, height: 40, fontSize: 16 });
    expect(editorPlacement({ kind: "text", objectId: "obj_text" }, text, CAMERA_IDENTITY, Number.NaN)).toEqual({ left: 0, top: 0, width: 100, height: 40, fontSize: 16 });
  });
});
