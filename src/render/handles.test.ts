/**
 * handles.test.ts — Tests for `render/handles.ts`, the eight resize grabbers
 * the human asked for on 2026-09-02 ("text boxes need to be able to be expanded
 * and shrunken with grabbers in the corners, like in word/powerpoint").
 *
 * The two properties worth defending: a grabber is the same comfortable size at
 * every zoom (it is chrome, not geometry), and a resize can never invert a box.
 */
import { describe, expect, it } from "vitest";
import type { CameraState } from "../engine/document.ts";
import type { GraphObject } from "../engine/graph/node.ts";
import type { WorldExtent } from "./extent.ts";
import {
  handleEdges,
  handlePoint,
  hasResizeHandles,
  MIN_TEXT_BOX_SIZE,
  RESIZE_HANDLES,
  resizeBox,
  resizeCursor,
  resizeHandleAt,
} from "./handles.ts";

const CAMERA_IDENTITY: CameraState = { x: 0, y: 0, zoom: 1 };
const BOX: WorldExtent = { minX: 100, minY: 200, maxX: 300, maxY: 260 };

function objectOfType(type: GraphObject["type"]): GraphObject {
  return { id: "obj_1", name: "thing_1", type, slots: {} };
}

describe("hasResizeHandles — which objects get grabbers", () => {
  it("a `text` object does", () => {
    expect(hasResizeHandles(objectOfType("text"))).toBe(true);
  });

  it("a parametric shape and a table do NOT — their size is `radius`/`sides`/`rows`/`cols`, a different question this file does not answer", () => {
    expect(hasResizeHandles(objectOfType("circle"))).toBe(false);
    expect(hasResizeHandles(objectOfType("polygon"))).toBe(false);
    expect(hasResizeHandles(objectOfType("rect"))).toBe(false);
    expect(hasResizeHandles(objectOfType("table"))).toBe(false);
  });
});

describe("handlePoint — where each grabber sits on the box", () => {
  it("puts the four corners on the box's corners", () => {
    expect(handlePoint(BOX, "nw")).toEqual({ x: 100, y: 200 });
    expect(handlePoint(BOX, "ne")).toEqual({ x: 300, y: 200 });
    expect(handlePoint(BOX, "se")).toEqual({ x: 300, y: 260 });
    expect(handlePoint(BOX, "sw")).toEqual({ x: 100, y: 260 });
  });

  it("puts the four edge grabbers at the edge midpoints", () => {
    expect(handlePoint(BOX, "n")).toEqual({ x: 200, y: 200 });
    expect(handlePoint(BOX, "e")).toEqual({ x: 300, y: 230 });
    expect(handlePoint(BOX, "s")).toEqual({ x: 200, y: 260 });
    expect(handlePoint(BOX, "w")).toEqual({ x: 100, y: 230 });
  });

  it("declares all eight", () => {
    expect(RESIZE_HANDLES).toHaveLength(8);
    expect(new Set(RESIZE_HANDLES).size).toBe(8);
  });
});

describe("handleEdges — which edges a grabber moves", () => {
  it("a corner moves two adjacent edges", () => {
    expect(handleEdges("nw")).toEqual({ left: true, right: false, top: true, bottom: false });
    expect(handleEdges("se")).toEqual({ left: false, right: true, top: false, bottom: true });
  });

  it("an edge grabber moves exactly one", () => {
    expect(handleEdges("e")).toEqual({ left: false, right: true, top: false, bottom: false });
    expect(handleEdges("n")).toEqual({ left: false, right: false, top: true, bottom: false });
  });
});

describe("resizeHandleAt — a press in SCREEN space, so a grabber never shrinks with the camera", () => {
  it("finds the grabber under a press on a corner", () => {
    expect(resizeHandleAt({ x: 300, y: 260 }, BOX, CAMERA_IDENTITY)).toBe("se");
  });

  it("finds it a few pixels off-centre — the press tolerance", () => {
    expect(resizeHandleAt({ x: 297, y: 262 }, BOX, CAMERA_IDENTITY)).toBe("se");
  });

  it("returns undefined well inside the box, so a press on the text still selects and drags", () => {
    expect(resizeHandleAt({ x: 200, y: 230 }, BOX, CAMERA_IDENTITY)).toBeUndefined();
  });

  it("returns undefined far outside the box", () => {
    expect(resizeHandleAt({ x: 900, y: 900 }, BOX, CAMERA_IDENTITY)).toBeUndefined();
  });

  it("stays the same SCREEN size at high zoom — the tolerance is pixels, not world units", () => {
    const zoomed: CameraState = { x: 0, y: 0, zoom: 10 };
    // The `se` corner projects to (3000, 2600). A press 4 screen px away still
    // hits it; the same 4 WORLD units away (40 screen px) does not.
    expect(resizeHandleAt({ x: 3004, y: 2600 }, BOX, zoomed)).toBe("se");
    expect(resizeHandleAt({ x: 3040, y: 2600 }, BOX, zoomed)).toBeUndefined();
  });

  it("prefers a CORNER where a corner and an edge grabber overlap — the more specific gesture", () => {
    // A box only as tall as the grabbers themselves: `e`'s midpoint and both
    // right corners land within tolerance of each other.
    const tiny: WorldExtent = { minX: 0, minY: 0, maxX: 40, maxY: 4 };
    expect(resizeHandleAt({ x: 40, y: 0 }, tiny, CAMERA_IDENTITY)).toBe("ne");
  });
});

describe("resizeBox — the box a drag asks for", () => {
  it("moves only the edges its grabber owns", () => {
    expect(resizeBox(BOX, "e", 50, 99)).toEqual({ minX: 100, minY: 200, maxX: 350, maxY: 260 });
    expect(resizeBox(BOX, "n", 99, -30)).toEqual({ minX: 100, minY: 170, maxX: 300, maxY: 260 });
  });

  it("moves two edges for a corner, and a left/top drag moves the box's anchor as well as its size", () => {
    expect(resizeBox(BOX, "nw", -20, -10)).toEqual({ minX: 80, minY: 190, maxX: 300, maxY: 260 });
  });

  it("clamps rather than inverting when an edge is dragged past its opposite — the OPPOSITE edge never moves", () => {
    const squashed = resizeBox(BOX, "w", 1000, 0);
    expect(squashed.maxX).toBe(300);
    expect(squashed.maxX - squashed.minX).toBe(MIN_TEXT_BOX_SIZE);
  });

  it("clamps a bottom drag upward the same way", () => {
    const squashed = resizeBox(BOX, "s", 0, -1000);
    expect(squashed.minY).toBe(200);
    expect(squashed.maxY - squashed.minY).toBe(MIN_TEXT_BOX_SIZE);
  });

  it("leaves an untouched axis EXACTLY alone, so a NaN delta on one axis cannot disturb the other", () => {
    expect(resizeBox(BOX, "e", 10, Number.NaN)).toEqual({ minX: 100, minY: 200, maxX: 310, maxY: 260 });
  });
});

describe("resizeCursor — a grabber says which way it stretches before the press", () => {
  it("gives each pair its own diagonal or axis cursor", () => {
    expect(resizeCursor("nw")).toBe("nwse-resize");
    expect(resizeCursor("se")).toBe("nwse-resize");
    expect(resizeCursor("ne")).toBe("nesw-resize");
    expect(resizeCursor("sw")).toBe("nesw-resize");
    expect(resizeCursor("n")).toBe("ns-resize");
    expect(resizeCursor("s")).toBe("ns-resize");
    expect(resizeCursor("e")).toBe("ew-resize");
    expect(resizeCursor("w")).toBe("ew-resize");
  });

  it("names a real cursor for every declared handle, so none is left as the default arrow", () => {
    for (const handle of RESIZE_HANDLES) {
      expect(resizeCursor(handle)).toMatch(/-resize$/);
    }
  });
});
