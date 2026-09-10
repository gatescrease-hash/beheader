/**
 * grips.test.ts
 *
 * The grabbers on a selected path. A grip names a part, and a part is what the
 * panel expands and what a drag writes.
 */
import { describe, expect, it } from "vitest";
import { type CameraState, type GraphObject, HALF_CIRCLE_BULGE, type Slot } from "../engine/index.ts";
import {
  bulgeForGrabbedMidpoint,
  edgeEnds,
  gripAt,
  GRIP_TOLERANCE_SCREEN,
  hasPathGrips,
  pathGrips,
  sameGrip,
} from "./grips.ts";

const CAMERA_IDENTITY: CameraState = { x: 0, y: 0, zoom: 1 };

interface TestPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * A path whose derived vertices slot agrees with its per vertex slots, the way
 * an evaluated object always does. pathEdgesOfObject reads the derived one.
 */
function pathObject(points: readonly TestPoint[], closed = false, overrides: Record<string, Slot> = {}): GraphObject {
  const slots: Record<string, Slot> = {
    closed: { kind: "literal", value: closed },
    vertices: { kind: "derived", value: points.map((point) => ({ ...point })) },
  };
  points.forEach((point, index) => {
    slots[`vertex.${index}.x`] = { kind: "literal", value: point.x };
    slots[`vertex.${index}.y`] = { kind: "literal", value: point.y };
    slots[`vertex.${index}.bulge`] = { kind: "literal", value: 0 };
  });
  return { id: "obj_1", name: "polyline_1", type: "polyline", vertexCount: points.length, slots: { ...slots, ...overrides } };
}

const TRIANGLE: readonly TestPoint[] = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
];

/** A path over three corners: (0,0), (100,0) and (100,100). */
function polylineObject(closed = false, overrides: Record<string, Slot> = {}): GraphObject {
  return pathObject(TRIANGLE, closed, overrides);
}

const BOUND_X: Slot = { kind: "formula", ast: { type: "reference", address: { objectId: "obj_2", path: ["value"] } }, value: 0 };

describe("which objects grow grips", () => {
  it("gives them to a polyline", () => {
    expect(hasPathGrips(polylineObject())).toBe(true);
  });

  it("gives none to a shape that moves by its origin", () => {
    const circle: GraphObject = { id: "obj_1", name: "circle_1", type: "circle", slots: { "origin.x": { kind: "literal", value: 0 } } };
    expect(hasPathGrips(circle)).toBe(false);
    expect(pathGrips(circle)).toEqual([]);
  });

  it("gives none to a path with no vertices at all", () => {
    expect(hasPathGrips({ id: "obj_1", name: "polyline_1", type: "polyline", vertexCount: 0, slots: {} })).toBe(false);
  });
});

describe("where the grips sit", () => {
  it("puts one on every vertex", () => {
    const vertices = pathGrips(polylineObject()).filter((placed) => placed.grip.kind === "vertex");
    expect(vertices.map((placed) => placed.point)).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ]);
  });

  it("puts one at the middle of every edge an open path has, which is one fewer than its vertices", () => {
    const edges = pathGrips(polylineObject()).filter((placed) => placed.grip.kind === "edge");
    expect(edges.map((placed) => placed.point)).toEqual([
      { x: 50, y: 0 },
      { x: 100, y: 50 },
    ]);
  });

  it("adds the grip of the edge that closes the path once it closes", () => {
    const edges = pathGrips(polylineObject(true)).filter((placed) => placed.grip.kind === "edge");
    expect(edges).toHaveLength(3);
    expect(edges[2]?.point).toEqual({ x: 50, y: 50 });
  });

  it("follows a curved edge, so the grip of an arc leaves the chord", () => {
    const bowed = polylineObject(false, { "vertex.0.bulge": { kind: "literal", value: HALF_CIRCLE_BULGE } });
    const first = pathGrips(bowed).find((placed) => placed.grip.kind === "edge");
    expect(first?.point.x).toBeCloseTo(50);
    expect(first?.point.y).toBeCloseTo(-50);
  });

  it("reports a vertex free while both its slots are literal", () => {
    expect(pathGrips(polylineObject())[0]?.free).toBe(true);
  });

  it("reports a vertex bound when a formula drives either half of it", () => {
    const bound = polylineObject(false, { "vertex.0.x": BOUND_X });
    expect(pathGrips(bound)[0]?.free).toBe(false);
    expect(pathGrips(bound)[1]?.free).toBe(true);
  });

  it("reports an edge bound when a formula drives its bulge", () => {
    const bound = polylineObject(false, { "vertex.1.bulge": BOUND_X });
    const edges = pathGrips(bound).filter((placed) => placed.grip.kind === "edge");
    expect(edges.map((placed) => placed.free)).toEqual([true, false]);
  });
});

describe("the grip under a point", () => {
  it("finds the vertex it sits on", () => {
    expect(gripAt(polylineObject(), { x: 100, y: 0 }, CAMERA_IDENTITY)).toEqual({ kind: "vertex", index: 1 });
  });

  it("finds the edge grip at the middle of a segment", () => {
    expect(gripAt(polylineObject(), { x: 50, y: 0 }, CAMERA_IDENTITY)).toEqual({ kind: "edge", index: 0 });
  });

  it("finds nothing on the stroke away from any grip", () => {
    expect(gripAt(polylineObject(), { x: 20, y: 0 }, CAMERA_IDENTITY)).toBeUndefined();
  });

  it("answers within the tolerance and not beyond it", () => {
    const inside = GRIP_TOLERANCE_SCREEN - 1;
    expect(gripAt(polylineObject(), { x: inside, y: 0 }, CAMERA_IDENTITY)).toEqual({ kind: "vertex", index: 0 });
    expect(gripAt(polylineObject(), { x: GRIP_TOLERANCE_SCREEN + 1, y: 0 }, CAMERA_IDENTITY)).toBeUndefined();
  });

  it("measures in screen pixels, so a zoom out does not make a grip harder to hit", () => {
    const far: CameraState = { x: 0, y: 0, zoom: 0.1 };
    expect(gripAt(polylineObject(), { x: 10, y: 0 }, far)).toEqual({ kind: "vertex", index: 1 });
  });

  it("gives the vertex to a press that two grips both answer, because that is the part an operator reaches for", () => {
    // A one unit edge puts its middle grip half a unit from both vertices.
    const tiny = pathObject([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 100, y: 100 },
    ]);
    expect(gripAt(tiny, { x: 0, y: 0 }, CAMERA_IDENTITY)).toEqual({ kind: "vertex", index: 0 });
  });
});

describe("the bulge a bend writes", () => {
  it("gives the ends of an edge by index", () => {
    expect(edgeEnds(polylineObject(), 1)).toEqual({ start: { x: 100, y: 0 }, end: { x: 100, y: 100 } });
  });

  it("wraps the closing edge back to the first vertex", () => {
    expect(edgeEnds(polylineObject(true), 2)).toEqual({ start: { x: 100, y: 100 }, end: { x: 0, y: 0 } });
  });

  it("gives nothing for an edge an open path does not have", () => {
    expect(edgeEnds(polylineObject(), 2)).toBeUndefined();
    expect(bulgeForGrabbedMidpoint(polylineObject(), 2, { x: 0, y: 0 })).toBeUndefined();
  });

  it("turns a point half the chord across into a half circle", () => {
    expect(bulgeForGrabbedMidpoint(polylineObject(), 0, { x: 50, y: -50 })).toBeCloseTo(HALF_CIRCLE_BULGE);
  });

  it("turns a point back on the chord into a straight edge", () => {
    expect(bulgeForGrabbedMidpoint(polylineObject(), 0, { x: 50, y: 0 })).toBe(0);
  });
});

describe("sameGrip", () => {
  it("matches a grip to itself and to an equal one", () => {
    expect(sameGrip({ kind: "vertex", index: 2 }, { kind: "vertex", index: 2 })).toBe(true);
  });

  it("tells a vertex from the edge that carries the same index", () => {
    expect(sameGrip({ kind: "vertex", index: 2 }, { kind: "edge", index: 2 })).toBe(false);
  });
});
