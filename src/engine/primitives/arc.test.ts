/**
 * arc.test.ts
 *
 * The math of one curved edge. The full circle built from two vertices is the
 * test that matters most. It has a known area, length, centroid and box, and
 * every one of them is wrong if a curve degrades into its chord.
 */
import { describe, expect, it } from "vitest";
import {
  arcOfEdge,
  buildPathEdges,
  distanceToEdge,
  edgeLength,
  HALF_CIRCLE_BULGE,
  pathArea,
  pathBounds,
  pathCentroid,
  pathLength,
  type PathBounds,
  type PathEdge,
} from "./arc.ts";

const LEFT = { x: 0, y: 0 };
const RIGHT = { x: 2, y: 0 };

function expectBoundsCloseTo(actual: PathBounds, expected: PathBounds): void {
  expect(actual.minX).toBeCloseTo(expected.minX);
  expect(actual.minY).toBeCloseTo(expected.minY);
  expect(actual.maxX).toBeCloseTo(expected.maxX);
  expect(actual.maxY).toBeCloseTo(expected.maxY);
}

/** Two vertices and two half circles. It is a true circle of radius 1 about (1,0). */
function unitCircleEdges(): readonly PathEdge[] {
  return buildPathEdges([LEFT, RIGHT], [HALF_CIRCLE_BULGE, HALF_CIRCLE_BULGE], true);
}

describe("arcOfEdge — the circle under one curved edge", () => {
  it("gives no circle for a straight edge, a zero length edge, or a bulge that is not finite", () => {
    expect(arcOfEdge({ start: LEFT, end: RIGHT, bulge: 0 })).toBeUndefined();
    expect(arcOfEdge({ start: LEFT, end: LEFT, bulge: 1 })).toBeUndefined();
    expect(arcOfEdge({ start: LEFT, end: RIGHT, bulge: Number.NaN })).toBeUndefined();
  });

  it("turns a bulge of 1 into a half circle on the chord", () => {
    const arc = arcOfEdge({ start: LEFT, end: RIGHT, bulge: HALF_CIRCLE_BULGE });
    expect(arc?.center.x).toBeCloseTo(1);
    expect(arc?.center.y).toBeCloseTo(0);
    expect(arc?.radius).toBeCloseTo(1);
    expect(arc?.sweep).toBeCloseTo(Math.PI);
  });

  it("puts the same half circle on the other side of the chord when the bulge is negative", () => {
    const below = arcOfEdge({ start: LEFT, end: RIGHT, bulge: HALF_CIRCLE_BULGE });
    const above = arcOfEdge({ start: LEFT, end: RIGHT, bulge: -HALF_CIRCLE_BULGE });
    expect(above?.center.x).toBeCloseTo(1);
    expect(above?.radius).toBeCloseTo(1);
    expect(above?.sweep).toBeCloseTo(-Math.PI);
    expect(below?.sweep).toBeCloseTo(Math.PI);
  });

  it("gives a minor arc and a major arc different radii on the same chord", () => {
    const minor = arcOfEdge({ start: LEFT, end: RIGHT, bulge: Math.tan(Math.PI / 8) });
    const major = arcOfEdge({ start: LEFT, end: RIGHT, bulge: Math.tan((3 * Math.PI) / 8) });
    expect(minor?.radius).toBeCloseTo(Math.SQRT2);
    expect(major?.radius).toBeCloseTo(Math.SQRT2);
    expect(minor?.sweep).toBeCloseTo(Math.PI / 2);
    expect(major?.sweep).toBeCloseTo((3 * Math.PI) / 2);
    // The same radius, opposite sides. A major arc keeps its centre across the chord.
    expect(Math.sign(minor?.center.y ?? 0)).toBe(-Math.sign(major?.center.y ?? 0));
  });
});

describe("edgeLength — exact, never a sum of chords", () => {
  it("measures a straight edge as its chord", () => {
    expect(edgeLength({ start: LEFT, end: RIGHT, bulge: 0 })).toBeCloseTo(2);
  });

  it("measures a half circle as pi times the radius, which is longer than the chord", () => {
    expect(edgeLength({ start: LEFT, end: RIGHT, bulge: HALF_CIRCLE_BULGE })).toBeCloseTo(Math.PI);
  });
});

describe("a full circle from two vertices — the shape decision 2 rests on", () => {
  it("reports the area of a circle, not the zero area of the flat chord path", () => {
    expect(pathArea(unitCircleEdges())).toBeCloseTo(Math.PI);
  });

  it("reports the circumference of a circle", () => {
    expect(pathLength(unitCircleEdges())).toBeCloseTo(2 * Math.PI);
  });

  it("puts the centroid at the centre of the circle, not at the mean of the two vertices", () => {
    const centroid = pathCentroid(unitCircleEdges());
    expect(centroid.x).toBeCloseTo(1);
    expect(centroid.y).toBeCloseTo(0);
  });

  it("boxes the circle, not the chord — the box a vertex only reading would get wrong", () => {
    expectBoundsCloseTo(pathBounds(unitCircleEdges()), { minX: 0, minY: -1, maxX: 2, maxY: 1 });
  });

  it("needs exactly two vertices to do it, and invents no third point", () => {
    const edges = unitCircleEdges();
    expect(edges).toHaveLength(2);
    expect(edges.map((edge) => edge.start)).toEqual([LEFT, RIGHT]);
  });
});

describe("pathBounds — a box that follows the arc past its endpoints", () => {
  it("reaches the bottom of a half circle that dips below both of its ends", () => {
    const edges = buildPathEdges([LEFT, RIGHT], [HALF_CIRCLE_BULGE], false);
    expectBoundsCloseTo(pathBounds(edges), { minX: 0, minY: -1, maxX: 2, maxY: 0 });
  });

  it("stops at the endpoints when the arc reaches no quarter point of its circle", () => {
    const shallow = buildPathEdges([LEFT, RIGHT], [Math.tan(Math.PI / 16)], false);
    const bounds = pathBounds(shallow);
    expect(bounds.minX).toBeCloseTo(0);
    expect(bounds.maxX).toBeCloseTo(2);
    expect(bounds.maxY).toBeCloseTo(0);
    expect(bounds.minY).toBeGreaterThan(-1);
    expect(bounds.minY).toBeLessThan(0);
  });
});

describe("distanceToEdge — a click measures to the arc, not to the chord", () => {
  const halfCircle: PathEdge = { start: LEFT, end: RIGHT, bulge: HALF_CIRCLE_BULGE };

  it("gives zero at the far point of the arc, which is one whole radius off the chord", () => {
    expect(distanceToEdge({ x: 1, y: -1 }, halfCircle)).toBeCloseTo(0);
  });

  it("gives the radius at the centre of the circle", () => {
    expect(distanceToEdge({ x: 1, y: 0 }, halfCircle)).toBeCloseTo(1);
  });

  it("falls back to the nearer endpoint for a point the sweep never faces", () => {
    expect(distanceToEdge({ x: 1, y: 5 }, halfCircle)).toBeCloseTo(Math.hypot(1, 5));
  });

  it("measures a straight edge the ordinary way", () => {
    expect(distanceToEdge({ x: 1, y: 3 }, { start: LEFT, end: RIGHT, bulge: 0 })).toBeCloseTo(3);
  });
});

describe("buildPathEdges — one edge for each vertex when closed, one fewer when open", () => {
  const square = [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 4, y: 3 },
  ];

  it("leaves the edge home to vertex 0 out of an open path", () => {
    expect(buildPathEdges(square, [0, 0, 0], false)).toHaveLength(2);
  });

  it("adds it back when the path closes", () => {
    const edges = buildPathEdges(square, [0, 0, 0], true);
    expect(edges).toHaveLength(3);
    expect(edges[2]).toEqual({ start: square[2], end: square[0], bulge: 0 });
  });

  it("holds the bulge of the last vertex unused while the path is open, and uses it once it closes", () => {
    const open = buildPathEdges(square, [0, 0, HALF_CIRCLE_BULGE], false);
    const closed = buildPathEdges(square, [0, 0, HALF_CIRCLE_BULGE], true);
    expect(pathLength(open)).toBeCloseTo(7);
    expect(pathLength(closed)).toBeCloseTo(7 + (Math.PI * 5) / 2);
  });

  it("reads a missing bulge as a straight edge", () => {
    expect(buildPathEdges(square, [], true).every((edge) => edge.bulge === 0)).toBe(true);
  });
});
