/**
 * editor.test.ts
 *
 * Editor placement and style for a text box and a table cell.
 */
import { describe, expect, it } from "vitest";
import type { CameraState } from "../engine/document.ts";
import type { TextMeasurer, TextStyle } from "../engine/eval-context.ts";
import type { GraphObject, Slot } from "../engine/graph/node.ts";
import { editorPlacement, editorTargetAt, editorTextBoxSize, editorTextStyle } from "./editor.ts";
import { TABLE_CELL_HEIGHT, TABLE_CELL_WIDTH } from "./slots.ts";

const CAMERA_IDENTITY: CameraState = { x: 0, y: 0, zoom: 1 };

interface TextFixtureOptions {
  readonly widthSlot?: number | "auto";
  readonly fontSize?: number;
  readonly lineHeight?: number;
  readonly font?: string;
  readonly align?: string;
  readonly color?: string;
  readonly heightSlot?: number | "auto";
  readonly autoresize?: boolean;
}

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
  if (options.color !== undefined) {
    slots["style.color"] = { kind: "literal", value: options.color };
  }
  if (options.heightSlot !== undefined) {
    slots.height = { kind: "literal", value: options.heightSlot };
  }
  if (options.autoresize !== undefined) {
    slots.autoresize = { kind: "literal", value: options.autoresize };
  }
  return { id: "obj_text", name: "text_1", type: "text", slots };
}

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
    const text = textObject(10, 20, 100, 40);
    expect(editorTargetAt({ x: 50, y: 40 }, [text], CAMERA_IDENTITY)).toEqual({ kind: "text", objectId: "obj_text" });
  });

  it("names the specific cell the point falls in, A1-form, for a table", () => {
    const table = tableObject(0, 0, 4, 4);
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
    const table = tableObject(0, 0, 2, 2);
    expect(editorTargetAt({ x: 10, y: 10 }, [text, table], CAMERA_IDENTITY)).toMatchObject({ kind: "cell" });
  });
});

describe("editorPlacement — where the overlay floats, and at what scale", () => {
  it("covers a `text` object's drawn box, positioned in CSS pixels and sized in WORLD units", () => {
    const text = textObject(10, 20, 100, 40);
    const placement = editorPlacement({ kind: "text", objectId: "obj_text" }, text, CAMERA_IDENTITY, 1);
    expect(placement).toEqual({ left: 10, top: 20, width: 100, height: 40, scale: 1 });
  });

  it("covers one table cell's world rectangle", () => {
    const table = tableObject(0, 0, 4, 4);
    const placement = editorPlacement({ kind: "cell", objectId: "obj_table", cell: "B3" }, table, CAMERA_IDENTITY, 1);
    expect(placement).toEqual({
      left: TABLE_CELL_WIDTH,
      top: TABLE_CELL_HEIGHT * 2,
      width: TABLE_CELL_WIDTH,
      height: TABLE_CELL_HEIGHT,
      scale: 1,
    });
  });

  it("puts zoom in `scale`, NOT in the box: the element is laid out at world size and magnified afterwards, so the browser breaks lines where render/measure.ts does", () => {
    const text = textObject(10, 20, 100, 40);
    const camera: CameraState = { x: 5, y: 5, zoom: 2 };
    const placement = editorPlacement({ kind: "text", objectId: "obj_text" }, text, camera, 1);
    expect(placement).toEqual({ left: 10, top: 30, width: 100, height: 40, scale: 2 });
  });

  it("divides the position AND the scale by the backing/CSS ratio (D-086 clause 3)", () => {
    const text = textObject(0, 0, 100, 40);
    const camera: CameraState = { x: 0, y: 0, zoom: 2 };
    const placement = editorPlacement({ kind: "text", objectId: "obj_text" }, text, camera, 2);
    expect(placement).toEqual({ left: 0, top: 0, width: 100, height: 40, scale: 1 });
  });

  it("takes a LIVE size over the committed extent — this is what makes the box grow under the caret instead of scrolling (2026-09-02)", () => {
    const text = textObject(10, 20, 100, 40);
    const placement = editorPlacement({ kind: "text", objectId: "obj_text" }, text, CAMERA_IDENTITY, 1, {
      width: 260,
      height: 95,
    });
    expect(placement).toMatchObject({ left: 10, top: 20, width: 260, height: 95 });
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
    expect(editorPlacement({ kind: "text", objectId: "obj_text" }, text, CAMERA_IDENTITY, 0)).toEqual({ left: 0, top: 0, width: 100, height: 40, scale: 1 });
    expect(editorPlacement({ kind: "text", objectId: "obj_text" }, text, CAMERA_IDENTITY, Number.NaN)).toEqual({ left: 0, top: 0, width: 100, height: 40, scale: 1 });
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

  it("reports WORLD lengths, unscaled, at any zoom — `EditorPlacement.scale` magnifies the laid-out element instead (2026-09-02)", () => {
    const text = textObject(0, 0, 100, 40, { fontSize: 16, lineHeight: 20 });
    expect(editorTextStyle(TEXT_TARGET, text, { x: 0, y: 0, zoom: 2 }, 1)).toMatchObject({ fontSize: 16, lineHeight: 20 });
    expect(editorTextStyle(TEXT_TARGET, text, { x: 0, y: 0, zoom: 3.7 }, 2)).toMatchObject({ fontSize: 16, lineHeight: 20 });
  });

  it("takes `style.color` from the object, so clicking into a box does not change how its text looks", () => {
    const text = textObject(0, 0, 100, 40, { color: "#c0392b" });
    expect(editorTextStyle(TEXT_TARGET, text, CAMERA_IDENTITY, 1).color).toBe("#c0392b");
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
      fontSize: 14,
      fontFamily: "sans-serif",
      lineHeight: TABLE_CELL_HEIGHT,
      textAlign: "left",
      color: "#1a1a1a",
      wraps: false,
    });
  });

  it("reports a cell's font in world units too, unscaled by zoom", () => {
    const table = tableObject(0, 0, 4, 4);
    const style = editorTextStyle(CELL_TARGET, table, { x: 0, y: 0, zoom: 3 }, 1);
    expect(style.fontSize).toBe(14);
    expect(style.lineHeight).toBe(TABLE_CELL_HEIGHT);
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
    expect(style.wraps).toBe(false);
  });
});

describe("editorTextBoxSize — the overlay's box follows what is being typed", () => {
  const TEXT_TARGET = { kind: "text", objectId: "obj_text" } as const;

  const perCharacter: TextMeasurer = {
    measure: (text: string, style: TextStyle) => ({ width: text.length * 10, height: style.lineHeight }),
  };

  function fixed(width: number, height: number): TextMeasurer {
    return { measure: () => ({ width, height }) };
  }

  function styleOf(object: GraphObject) {
    return editorTextStyle(TEXT_TARGET, object, CAMERA_IDENTITY, 1);
  }

  it("grows with the typed text on an auto-width box — it does not stay at the committed size", () => {
    const text = textObject(0, 0, 100, 40, { widthSlot: "auto" });
    const short = editorTextBoxSize(text, "hi", styleOf(text), perCharacter);
    const long = editorTextBoxSize(text, "hi there, this is longer", styleOf(text), perCharacter);
    expect(long.width).toBeGreaterThan(short.width);
  });

  it("hands the measurer the WORLD font size and family off the object's own slots, so the overlay is measured the way the canvas draws", () => {
    const text = textObject(0, 0, 100, 40, { fontSize: 18, lineHeight: 24, font: "Inter, sans-serif", widthSlot: "auto" });
    const seen: TextStyle[] = [];
    const recorder: TextMeasurer = {
      measure: (_text: string, style: TextStyle) => {
        seen.push(style);
        return { width: 50, height: 24 };
      },
    };
    editorTextBoxSize(text, "hi", styleOf(text), recorder);
    expect(seen[0]).toEqual({ font: "Inter, sans-serif", fontSize: 18, lineHeight: 24 });
  });

  it("passes a numeric `width` slot as the measurer's wrap width, and passes NONE for `auto`", () => {
    const wrapped: (number | undefined)[] = [];
    const recorder: TextMeasurer = {
      measure: (_text: string, _style: TextStyle, maxWidth?: number) => {
        wrapped.push(maxWidth);
        return { width: 40, height: 20 };
      },
    };
    const fixedBox = textObject(0, 0, 100, 40, { widthSlot: 120 });
    const autoBox = textObject(0, 0, 100, 40, { widthSlot: "auto" });
    editorTextBoxSize(fixedBox, "hi", styleOf(fixedBox), recorder);
    editorTextBoxSize(autoBox, "hi", styleOf(autoBox), recorder);
    expect(wrapped).toEqual([120, undefined]);
  });

  it("leaves room for the caret on a NON-wrapping box, whose width is otherwise the exact end of the text", () => {
    const text = textObject(0, 0, 100, 40, { widthSlot: "auto" });
    expect(editorTextBoxSize(text, "hi", styleOf(text), fixed(80, 20)).width).toBeGreaterThan(80);
  });

  it("leaves NO such room on a wrapping box — its width is the operator's dragged edge and the measurer's wrap boundary, so widening it would move a line break", () => {
    const text = textObject(0, 0, 100, 40, { widthSlot: 120 });
    expect(editorTextBoxSize(text, "hi", styleOf(text), fixed(80, 20)).width).toBe(120);
  });

  it("grows past a set height rather than cropping — the same textbox.ts rule the committed box follows", () => {
    const text = textObject(0, 0, 100, 40, { widthSlot: 120, heightSlot: 30, autoresize: false });
    expect(editorTextBoxSize(text, "lots of text", styleOf(text), fixed(80, 200)).height).toBe(200);
  });

  it("keeps a set height when the typed text is shorter and autoresize is off", () => {
    const text = textObject(0, 0, 100, 40, { widthSlot: 120, heightSlot: 300, autoresize: false });
    expect(editorTextBoxSize(text, "hi", styleOf(text), fixed(80, 20)).height).toBe(300);
  });

  it("shrinks back to the typed text when autoresize is on", () => {
    const text = textObject(0, 0, 100, 40, { widthSlot: 120, heightSlot: 300, autoresize: true });
    expect(editorTextBoxSize(text, "hi", styleOf(text), fixed(80, 20)).height).toBe(20);
  });

  it("gives an EMPTY editor a positive box — D-124 hands the editor exactly this, and a zero box would be unclickable and invisible", () => {
    const empty = emptyTextObject(0, 0);
    const box = editorTextBoxSize(empty, "", editorTextStyle({ kind: "text", objectId: "obj_empty" }, empty, CAMERA_IDENTITY, 1), fixed(0, 0));
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(0);
  });
});
