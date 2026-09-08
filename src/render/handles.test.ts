/**
 * handles.test.ts
 *
 * Grabber placement and the absolute resize math.
 */
import { describe, expect, it } from "vitest";
import type { CameraState } from "../engine/document.ts";
import type { GraphObject } from "../engine/graph/node.ts";
import type { WorldExtent } from "./extent.ts";
import {
  constrainBoxToRatio,
  handleEdges,
  handlePoint,
  hasResizeHandles,
  MIN_RESIZE_BOX_SIZE,
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

describe("constrainBoxToRatio — a resize that keeps the object's proportions", () => {
  const START: WorldExtent = { minX: 0, minY: 0, maxX: 200, maxY: 100 };

  it("derives the height from a SIDE grabber's width, so dragging one edge scales the whole box", () => {
    const requested = resizeBox(START, "e", 100, 0);
    expect(constrainBoxToRatio(START, requested, "e")).toEqual({ minX: 0, minY: 0, maxX: 300, maxY: 150 });
  });

  it("lets a SIDE grabber SHRINK — the axis it moves is the only one carrying information, which is why the larger scale is not taken here", () => {
    const requested = resizeBox(START, "e", -100, 0);
    expect(constrainBoxToRatio(START, requested, "e")).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 50 });
  });

  it("derives the width from a TOP/BOTTOM grabber's height", () => {
    const requested = resizeBox(START, "s", 0, 100);
    expect(constrainBoxToRatio(START, requested, "s")).toEqual({ minX: 0, minY: 0, maxX: 400, maxY: 200 });
  });

  it("takes the LARGER scale on a CORNER, so a diagonal drag responds to whichever axis moved more", () => {
    expect(constrainBoxToRatio(START, resizeBox(START, "se", 100, 0), "se")).toEqual({ minX: 0, minY: 0, maxX: 300, maxY: 150 });
    expect(constrainBoxToRatio(START, resizeBox(START, "se", 0, 100), "se")).toEqual({ minX: 0, minY: 0, maxX: 400, maxY: 200 });
  });

  it("anchors the edges the grabber did NOT move, so the box never slides out from under the pointer", () => {
    const constrained = constrainBoxToRatio(START, resizeBox(START, "nw", -100, 0), "nw");
    expect(constrained.maxX).toBe(200);
    expect(constrained.maxY).toBe(100);
    expect(constrained).toEqual({ minX: -100, minY: -50, maxX: 200, maxY: 100 });
  });

  it("never leaves a box below the minimum, on either axis", () => {
    const squashed = constrainBoxToRatio(START, resizeBox(START, "e", -1000, 0), "e");
    expect(squashed.maxX - squashed.minX).toBeGreaterThanOrEqual(MIN_RESIZE_BOX_SIZE);
    expect(squashed.maxY - squashed.minY).toBeGreaterThanOrEqual(MIN_RESIZE_BOX_SIZE);
  });

  it("returns the requested box untouched when the start box has no ratio to keep", () => {
    const flat: WorldExtent = { minX: 0, minY: 0, maxX: 200, maxY: 0 };
    const requested = resizeBox(flat, "e", 50, 0);
    expect(constrainBoxToRatio(flat, requested, "e")).toEqual(requested);
  });
});

describe("hasResizeHandles — which objects get grabbers", () => {
  it("a `text` object does", () => {
    expect(hasResizeHandles(objectOfType("text"))).toBe(true);
  });

  it("an `image` object does too — its size is two ordinary literal slots, exactly like a text box's", () => {
    expect(hasResizeHandles(objectOfType("image"))).toBe(true);
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
    expect(resizeHandleAt({ x: 3004, y: 2600 }, BOX, zoomed)).toBe("se");
    expect(resizeHandleAt({ x: 3040, y: 2600 }, BOX, zoomed)).toBeUndefined();
  });

  it("prefers a CORNER where a corner and an edge grabber overlap — the more specific gesture", () => {
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
    expect(squashed.maxX - squashed.minX).toBe(MIN_RESIZE_BOX_SIZE);
  });

  it("clamps a bottom drag upward the same way", () => {
    const squashed = resizeBox(BOX, "s", 0, -1000);
    expect(squashed.minY).toBe(200);
    expect(squashed.maxY - squashed.minY).toBe(MIN_RESIZE_BOX_SIZE);
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
