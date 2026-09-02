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
import type { GraphObject, Slot } from "../engine/graph/node.ts";
import { editorPlacement, editorTargetAt, editorTextStyle } from "./editor.ts";
import { TABLE_CELL_HEIGHT, TABLE_CELL_WIDTH } from "./slots.ts";

const CAMERA_IDENTITY: CameraState = { x: 0, y: 0, zoom: 1 };

/**
 * The `style.*` slots and the `width` slot a fixture may override. Every one is
 * OMITTED by default, so the base fixture exercises `editorTextStyle`'s
 * missing-slot fallbacks — the shape a hand-built object has.
 */
interface TextFixtureOptions {
  /** The `width` SLOT, which decides wrapping (§5.6). Defaults to the fixture's box width (a number, so it wraps); pass `"auto"` for the no-wrap case `DEFAULT_TEXT_WIDTH` actually creates. */
  readonly widthSlot?: number | "auto";
  readonly fontSize?: number;
  readonly lineHeight?: number;
  readonly font?: string;
  readonly align?: string;
}

/** A `text` object with a drawn extent — `resolvedContent` set and `measuredHeight`/`measuredWidth` present so the box is (originX,originY)-(originX+w, originY+h). */
function textObject(originX: number, originY: number, width: number, height: number, options: TextFixtureOptions = {}): GraphObject {
  const slots: Record<string, Slot> = {
    "origin.x": { kind: "literal", value: originX },
    "origin.y": { kind: "literal", value: originY },
    width: { kind: "literal", value: options.widthSlot ?? width },
    resolvedContent: { kind: "derived", value: "hello" },
    measuredHeight: { kind: "derived", value: height },
    measuredWidth: { kind: "derived", value: width },
  };
  if (options.fontSize !== undefined) {
    slots["style.fontSize"] = { kind: "literal", value: options.fontSize };
  }
  if (options.lineHeight !== undefined) {
    slots["style.lineHeight"] = { kind: "literal", value: options.lineHeight };
  }
  if (options.font !== undefined) {
    slots["style.font"] = { kind: "literal", value: options.font };
  }
  if (options.align !== undefined) {
    slots["style.align"] = { kind: "literal", value: options.align };
  }
  return { id: "obj_text", name: "text_1", type: "text", slots };
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
    const text = textObject(10, 20, 100, 40);
    const placement = editorPlacement({ kind: "text", objectId: "obj_text" }, text, CAMERA_IDENTITY, 1);
    expect(placement).toEqual({ left: 10, top: 20, width: 100, height: 40 });
  });

  it("covers one table cell's world rectangle", () => {
    const table = tableObject(0, 0, 4, 4);
    const placement = editorPlacement({ kind: "cell", objectId: "obj_table", cell: "B3" }, table, CAMERA_IDENTITY, 1);
    expect(placement).toEqual({
      left: TABLE_CELL_WIDTH,
      top: TABLE_CELL_HEIGHT * 2,
      width: TABLE_CELL_WIDTH,
      height: TABLE_CELL_HEIGHT,
    });
  });

  it("applies the camera transform: pan and zoom move and scale the overlay", () => {
    const text = textObject(10, 20, 100, 40);
    const camera: CameraState = { x: 5, y: 5, zoom: 2 };
    const placement = editorPlacement({ kind: "text", objectId: "obj_text" }, text, camera, 1);
    // world (10,20) -> screen ((10-5)*2, (20-5)*2) = (10, 30); size 100x40 -> 200x80
    expect(placement).toEqual({ left: 10, top: 30, width: 200, height: 80 });
  });

  it("divides screen coordinates by the backing/CSS ratio (D-086 clause 3)", () => {
    const text = textObject(0, 0, 100, 40);
    const camera: CameraState = { x: 0, y: 0, zoom: 2 };
    const placement = editorPlacement({ kind: "text", objectId: "obj_text" }, text, camera, 2);
    // world box 100x40 -> backing 200x80 -> CSS (÷2) 100x40, at origin
    expect(placement).toEqual({ left: 0, top: 0, width: 100, height: 40 });
  });

  it("falls back to a positive box at `origin` for an empty `text` object — the editor draws its own, extent.ts is not loosened (D-125 clause 6)", () => {
    const empty = emptyTextObject(30, 40);
    const placement = editorPlacement({ kind: "text", objectId: "obj_empty" }, empty, CAMERA_IDENTITY, 1);
    expect(placement.left).toBe(30);
    expect(placement.top).toBe(40);
    expect(placement.width).toBeGreaterThan(0);
    expect(placement.height).toBeGreaterThan(0);
  });

  it("falls back to ratio 1 for a non-finite or non-positive ratio", () => {
    const text = textObject(0, 0, 100, 40);
    expect(editorPlacement({ kind: "text", objectId: "obj_text" }, text, CAMERA_IDENTITY, 0)).toEqual({ left: 0, top: 0, width: 100, height: 40 });
    expect(editorPlacement({ kind: "text", objectId: "obj_text" }, text, CAMERA_IDENTITY, Number.NaN)).toEqual({ left: 0, top: 0, width: 100, height: 40 });
  });
});

describe("editorTextStyle — the overlay lays text out the way the canvas draws it (D-129, entry 0147)", () => {
  const TEXT_TARGET = { kind: "text", objectId: "obj_text" } as const;
  const CELL_TARGET = { kind: "cell", objectId: "obj_table", cell: "B3" } as const;

  it("takes the size, family and line height from the object's own `style.*` slots", () => {
    const text = textObject(0, 0, 100, 40, { fontSize: 18, lineHeight: 24, font: "Inter, sans-serif" });
    expect(editorTextStyle(TEXT_TARGET, text, CAMERA_IDENTITY, 1)).toMatchObject({
      fontSize: 18,
      lineHeight: 24,
      fontFamily: "Inter, sans-serif",
    });
  });

  it("scales both lengths by camera zoom, so the glyphs track the box (D-129 clause 1)", () => {
    const text = textObject(0, 0, 100, 40, { fontSize: 16, lineHeight: 20 });
    const style = editorTextStyle(TEXT_TARGET, text, { x: 0, y: 0, zoom: 2 }, 1);
    expect(style.fontSize).toBe(32);
    expect(style.lineHeight).toBe(40);
  });

  it("divides both lengths by the backing/CSS ratio, like the box (D-086 clause 3)", () => {
    const text = textObject(0, 0, 100, 40, { fontSize: 16, lineHeight: 20 });
    const style = editorTextStyle(TEXT_TARGET, text, { x: 0, y: 0, zoom: 2 }, 2);
    expect(style.fontSize).toBe(16);
    expect(style.lineHeight).toBe(20);
  });

  it("falls back to renderer.ts's own DEFAULT_TEXT_* values when the style slots are missing, so a broken-style object's overlay matches its drawn text", () => {
    const bare = textObject(0, 0, 100, 40);
    expect(editorTextStyle(TEXT_TARGET, bare, CAMERA_IDENTITY, 1)).toMatchObject({
      fontSize: 16,
      lineHeight: 20,
      fontFamily: "sans-serif",
    });
  });

  it("treats an empty `style.font` as absent rather than as a typeface, matching resolveTextStyle", () => {
    const text = textObject(0, 0, 100, 40, { font: "" });
    expect(editorTextStyle(TEXT_TARGET, text, CAMERA_IDENTITY, 1).fontFamily).toBe("sans-serif");
  });

  it("treats a BLANK `style.font` as absent too — `cssFont` falls the canvas back to sans-serif for it, so the overlay must fall back identically or it inherits the page's monospace (0148-REVIEW)", () => {
    const text = textObject(0, 0, 100, 40, { font: "   " });
    expect(editorTextStyle(TEXT_TARGET, text, CAMERA_IDENTITY, 1).fontFamily).toBe("sans-serif");
  });

  it("does NOT wrap an auto-width `text` object — §5.6's 'auto width means no wrapping', which is what the canvas draws", () => {
    const text = textObject(0, 0, 100, 40, { widthSlot: "auto" });
    expect(editorTextStyle(TEXT_TARGET, text, CAMERA_IDENTITY, 1).wraps).toBe(false);
  });

  it("wraps a `text` object whose `width` slot holds a positive number — drawText's own wrap condition", () => {
    const text = textObject(0, 0, 100, 40, { widthSlot: 100 });
    expect(editorTextStyle(TEXT_TARGET, text, CAMERA_IDENTITY, 1).wraps).toBe(true);
  });

  it("does not wrap for a zero or negative `width` slot, which drawText also treats as no-wrap", () => {
    expect(editorTextStyle(TEXT_TARGET, textObject(0, 0, 100, 40, { widthSlot: 0 }), CAMERA_IDENTITY, 1).wraps).toBe(false);
    expect(editorTextStyle(TEXT_TARGET, textObject(0, 0, 100, 40, { widthSlot: -5 }), CAMERA_IDENTITY, 1).wraps).toBe(false);
  });

  it("passes `center`/`right` through and clamps anything else to `left`, the same three-way choice resolveTextStyle makes", () => {
    expect(editorTextStyle(TEXT_TARGET, textObject(0, 0, 100, 40, { align: "center" }), CAMERA_IDENTITY, 1).textAlign).toBe("center");
    expect(editorTextStyle(TEXT_TARGET, textObject(0, 0, 100, 40, { align: "right" }), CAMERA_IDENTITY, 1).textAlign).toBe("right");
    expect(editorTextStyle(TEXT_TARGET, textObject(0, 0, 100, 40, { align: "justify" }), CAMERA_IDENTITY, 1).textAlign).toBe("left");
    expect(editorTextStyle(TEXT_TARGET, textObject(0, 0, 100, 40), CAMERA_IDENTITY, 1).textAlign).toBe("left");
  });

  it("uses drawTable's single cell font for a cell, a line box the full cell height, and never wraps", () => {
    const table = tableObject(0, 0, 4, 4);
    expect(editorTextStyle(CELL_TARGET, table, CAMERA_IDENTITY, 1)).toEqual({
      fontSize: 14, // renderer.ts's TABLE_CELL_FONT
      fontFamily: "sans-serif",
      lineHeight: TABLE_CELL_HEIGHT, // textBaseline "middle" at the cell's centre
      textAlign: "left",
      wraps: false,
    });
  });

  it("scales a cell's font with zoom too", () => {
    const table = tableObject(0, 0, 4, 4);
    const style = editorTextStyle(CELL_TARGET, table, { x: 0, y: 0, zoom: 3 }, 1);
    expect(style.fontSize).toBe(42);
    expect(style.lineHeight).toBe(TABLE_CELL_HEIGHT * 3);
  });

  it("falls back to ratio 1 for a non-finite or non-positive ratio, exactly as the box does", () => {
    const text = textObject(0, 0, 100, 40, { fontSize: 16 });
    expect(editorTextStyle(TEXT_TARGET, text, CAMERA_IDENTITY, 0).fontSize).toBe(16);
    expect(editorTextStyle(TEXT_TARGET, text, CAMERA_IDENTITY, Number.NaN).fontSize).toBe(16);
  });

  it("gives an empty `text` object a positive, usable type style — D-124 hands the editor exactly this", () => {
    const style = editorTextStyle({ kind: "text", objectId: "obj_empty" }, emptyTextObject(0, 0), CAMERA_IDENTITY, 1);
    expect(style.fontSize).toBeGreaterThan(0);
    expect(style.lineHeight).toBeGreaterThan(0);
    expect(style.wraps).toBe(false); // its `width` slot is "auto"
  });
});
