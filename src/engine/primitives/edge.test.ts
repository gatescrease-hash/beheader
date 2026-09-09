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
  bezierOfEdge,
  buildPathEdges,
  bulgeForTangentArc,
  distanceToEdge,
  edgeEndDirection,
  edgeDoubledAreaOverChord,
  edgeLength,
  HALF_CIRCLE_BULGE,
  pathArea,
  pathBounds,
  pathCentroid,
  pathContains,
  pathLength,
  splitEdgeAt,
  type PathBounds,
  type PathEdge,
} from "./edge.ts";

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

describe("splitEdgeAt — a cut where the operator points, never an even subdivision", () => {
  const halfCircle: PathEdge = { start: LEFT, end: RIGHT, bulge: HALF_CIRCLE_BULGE };

  it("puts the new point on the arc, not on the chord under it", () => {
    const split = splitEdgeAt(halfCircle, { x: 1, y: -5 });
    expect(split.point.x).toBeCloseTo(1);
    expect(split.point.y).toBeCloseTo(-1);
    expect(split.fraction).toBeCloseTo(0.5);
  });

  it("gives two quarter arcs that together hold the shape of the half circle they replace", () => {
    const split = splitEdgeAt(halfCircle, { x: 1, y: -5 });
    const halves = buildPathEdges([LEFT, split.point, RIGHT], [split.firstBulge, split.secondBulge], false);
    expect(pathLength(halves)).toBeCloseTo(pathLength([halfCircle]));
    expectBoundsCloseTo(pathBounds(halves), pathBounds([halfCircle]));
  });

  it("follows the point the caller gives, so an off centre cut makes two unequal arcs", () => {
    const split = splitEdgeAt(halfCircle, { x: 0.2, y: -1 });
    expect(split.fraction).toBeGreaterThan(0);
    expect(split.fraction).toBeLessThan(0.5);
    expect(split.firstBulge).toBeLessThan(split.secondBulge);
    const halves = buildPathEdges([LEFT, split.point, RIGHT], [split.firstBulge, split.secondBulge], false);
    expect(pathLength(halves)).toBeCloseTo(pathLength([halfCircle]));
  });

  it("keeps a straight edge straight, and drops the point onto the segment", () => {
    const split = splitEdgeAt({ start: LEFT, end: RIGHT, bulge: 0 }, { x: 0.5, y: 9 });
    expect(split.point).toEqual({ x: 0.5, y: 0 });
    expect(split.firstBulge).toBe(0);
    expect(split.secondBulge).toBe(0);
  });

  it("reports a fraction at an end when the point sits past the end of the edge", () => {
    expect(splitEdgeAt({ start: LEFT, end: RIGHT, bulge: 0 }, { x: -9, y: 0 }).fraction).toBe(0);
    expect(splitEdgeAt({ start: LEFT, end: RIGHT, bulge: 0 }, { x: 9, y: 0 }).fraction).toBe(1);
  });
});

/**
 * One cubic with hand computed answers. Its control points are (0,1) and
 * (1,1) over the chord from (0,0) to (1,0). The integral of x y' minus y x'
 * gives an area of 0.6 over the chord, and a centroid of (0.5, 9/28). The high
 * point of the curve is 0.75, well under the height of either handle.
 */
const ARCH_START = { x: 0, y: 0 };
const ARCH_END = { x: 1, y: 0 };
const ARCH_HANDLES_OUT = [{ x: 0, y: 1 }, { x: 0, y: 0 }];
const ARCH_HANDLES_IN = [{ x: 0, y: 0 }, { x: 0, y: 1 }];

function archEdges(closed: boolean): readonly PathEdge[] {
  return buildPathEdges([ARCH_START, ARCH_END], [0, 0], closed, ARCH_HANDLES_IN, ARCH_HANDLES_OUT);
}

function archEdge(): PathEdge {
  const edge = archEdges(false)[0];
  if (edge === undefined) {
    throw new Error("test setup: expected one edge");
  }
  return edge;
}

describe("bezierOfEdge — two control points make an edge a cubic", () => {
  it("finds no cubic on an edge that carries no control points", () => {
    expect(bezierOfEdge({ start: LEFT, end: RIGHT, bulge: 0 })).toBeUndefined();
    expect(bezierOfEdge({ start: LEFT, end: RIGHT, bulge: HALF_CIRCLE_BULGE })).toBeUndefined();
  });

  it("reads the two ends and the two controls, in order", () => {
    expect(bezierOfEdge(archEdge())).toEqual({
      p0: { x: 0, y: 0 },
      p1: { x: 0, y: 1 },
      p2: { x: 1, y: 1 },
      p3: { x: 1, y: 0 },
    });
  });

  it("lets control points win over a bulge, so one edge is never both a cubic and an arc", () => {
    const both = buildPathEdges([ARCH_START, ARCH_END], [HALF_CIRCLE_BULGE, 0], false, ARCH_HANDLES_IN, ARCH_HANDLES_OUT);
    expect(bezierOfEdge(both[0] as PathEdge)).toBeDefined();
    expect(arcOfEdge(both[0] as PathEdge)).toBeUndefined();
  });

  it("reads two zero handles as no cubic at all, which leaves the edge to its bulge", () => {
    const zeroed = buildPathEdges([LEFT, RIGHT], [HALF_CIRCLE_BULGE], false, [{ x: 0, y: 0 }, { x: 0, y: 0 }], [{ x: 0, y: 0 }, { x: 0, y: 0 }]);
    expect(bezierOfEdge(zeroed[0] as PathEdge)).toBeUndefined();
    expect(arcOfEdge(zeroed[0] as PathEdge)).toBeDefined();
  });
});

describe("a cubic measured against answers worked out by hand", () => {
  it("gives the area between the curve and its chord, which no control point sits on", () => {
    expect(pathArea(archEdges(true))).toBeCloseTo(0.6, 10);
  });

  it("puts the centroid at the exact fraction the integral gives, not at the mean of four points", () => {
    const centroid = pathCentroid(archEdges(true));
    expect(centroid.x).toBeCloseTo(0.5, 10);
    expect(centroid.y).toBeCloseTo(9 / 28, 10);
  });

  it("boxes the curve at its true high point of 0.75, not at the height of its handles", () => {
    expectBoundsCloseTo(pathBounds(archEdges(false)), { minX: 0, minY: 0, maxX: 1, maxY: 0.75 });
  });

  it("measures a length between the chord and the control polygon, the two bounds any curve sits inside", () => {
    const length = edgeLength(archEdge());
    expect(length).toBeGreaterThan(1);
    expect(length).toBeLessThan(3);
  });
});

describe("a cubic whose controls sit on its own chord is a straight edge in every answer", () => {
  const flat = buildPathEdges([LEFT, RIGHT], [0], false, [{ x: 0, y: 0 }, { x: -2 / 3, y: 0 }], [{ x: 2 / 3, y: 0 }, { x: 0, y: 0 }]);
  const flatEdge = flat[0] as PathEdge;

  it("is a cubic, and not by accident a straight edge", () => {
    expect(bezierOfEdge(flatEdge)).toBeDefined();
  });

  it("measures its chord for a length", () => {
    expect(edgeLength(flatEdge)).toBeCloseTo(2, 9);
  });

  it("adds no area over its chord", () => {
    expect(edgeDoubledAreaOverChord(flatEdge)).toBeCloseTo(0, 9);
  });

  it("boxes to its two ends", () => {
    expectBoundsCloseTo(pathBounds(flat), { minX: 0, minY: 0, maxX: 2, maxY: 0 });
  });
});

describe("splitEdgeAt on a cubic — De Casteljau, so the shape does not move", () => {
  const split = splitEdgeAt(archEdge(), { x: 0.5, y: 5 });

  function halvesOfArch(): readonly PathEdge[] {
    return buildPathEdges(
      [ARCH_START, split.point, ARCH_END],
      [0, 0, 0],
      false,
      [{ x: 0, y: 0 }, split.newInHandle, split.endInHandle],
      [split.startOutHandle, split.newOutHandle, { x: 0, y: 0 }],
    );
  }

  it("lands on the curve, at the high point nearest the point given", () => {
    expect(split.fraction).toBeCloseTo(0.5);
    expect(split.point.x).toBeCloseTo(0.5);
    expect(split.point.y).toBeCloseTo(0.75);
  });

  it("makes two cubics, and gives the new vertex a handle on each side", () => {
    const halves = halvesOfArch();
    expect(halves).toHaveLength(2);
    expect(bezierOfEdge(halves[0] as PathEdge)).toBeDefined();
    expect(bezierOfEdge(halves[1] as PathEdge)).toBeDefined();
    expect(split.newInHandle).not.toEqual({ x: 0, y: 0 });
    expect(split.newOutHandle).not.toEqual({ x: 0, y: 0 });
  });

  it("holds the length, the box and the area of the one curve it replaced", () => {
    const halves = halvesOfArch();
    expect(pathLength(halves)).toBeCloseTo(edgeLength(archEdge()), 9);
    expectBoundsCloseTo(pathBounds(halves), pathBounds(archEdges(false)));
    const before = edgeDoubledAreaOverChord(archEdge()) + (ARCH_START.x * ARCH_END.y - ARCH_END.x * ARCH_START.y);
    let after = 0;
    for (const edge of halves) {
      after += edgeDoubledAreaOverChord(edge) + (edge.start.x * edge.end.y - edge.end.x * edge.start.y);
    }
    expect(after).toBeCloseTo(before, 9);
  });

  it("leaves both bulges at 0, because a cubic carries its shape in its handles", () => {
    expect(split.firstBulge).toBe(0);
    expect(split.secondBulge).toBe(0);
  });
});

describe("distanceToEdge on a cubic — measured to the curve, not to its control polygon", () => {
  it("gives zero at the high point of the curve", () => {
    expect(distanceToEdge({ x: 0.5, y: 0.75 }, archEdge())).toBeCloseTo(0, 6);
  });

  it("gives the gap to the high point for a point directly above it", () => {
    expect(distanceToEdge({ x: 0.5, y: 5 }, archEdge())).toBeCloseTo(5 - 0.75, 6);
  });

  it("never reaches the control points, which the curve itself does not pass through", () => {
    expect(distanceToEdge({ x: 0, y: 1 }, archEdge())).toBeGreaterThan(0.1);
  });
});

describe("pathContains — the nonzero winding rule, over true curves", () => {
  const square = [
    { x: 0, y: 0 },
    { x: 2, y: 0 },
    { x: 2, y: 2 },
    { x: 0, y: 2 },
  ];

  it("holds a point inside a square and lets go of one outside", () => {
    const edges = buildPathEdges(square, [], true);
    expect(pathContains({ x: 1, y: 1 }, edges)).toBe(true);
    expect(pathContains({ x: 3, y: 1 }, edges)).toBe(false);
    expect(pathContains({ x: -1, y: 1 }, edges)).toBe(false);
    expect(pathContains({ x: 1, y: 3 }, edges)).toBe(false);
  });

  it("gives the same answer whichever way the shape winds", () => {
    const backwards = buildPathEdges(square.slice().reverse(), [], true);
    expect(pathContains({ x: 1, y: 1 }, backwards)).toBe(true);
    expect(pathContains({ x: 3, y: 1 }, backwards)).toBe(false);
  });

  it("counts a vertex the ray runs straight through exactly once", () => {
    const diamond = buildPathEdges([{ x: 1, y: 0 }, { x: 2, y: 1 }, { x: 1, y: 2 }, { x: 0, y: 1 }], [], true);
    expect(pathContains({ x: 1, y: 1 }, diamond)).toBe(true);
    expect(pathContains({ x: 3, y: 1 }, diamond)).toBe(false);
  });

  it("winds an open list as though a straight edge closed it, the same way ctx.fill does", () => {
    // Three sides of the square. The caller decides whether an open path fills
    // at all, so this function answers only for the edges it gets.
    expect(pathContains({ x: 1, y: 1 }, buildPathEdges(square, [], false))).toBe(true);
  });

  it("holds the whole disc of a two vertex circle, which no chord polygon covers", () => {
    const circle = unitCircleEdges();
    expect(pathContains({ x: 1, y: 0 }, circle)).toBe(true);
    expect(pathContains({ x: 1, y: 0.9 }, circle)).toBe(true);
    expect(pathContains({ x: 1, y: -0.9 }, circle)).toBe(true);
    expect(pathContains({ x: 1, y: 1.1 }, circle)).toBe(false);
    expect(pathContains({ x: 2.5, y: 0 }, circle)).toBe(false);
  });

  it("follows a cubic, so the space under an arch counts and the space over it does not", () => {
    const arch = archEdges(true);
    expect(pathContains({ x: 0.5, y: 0.4 }, arch)).toBe(true);
    expect(pathContains({ x: 0.5, y: 0.74 }, arch)).toBe(true);
    expect(pathContains({ x: 0.5, y: 0.9 }, arch)).toBe(false);
    expect(pathContains({ x: 0.5, y: -0.1 }, arch)).toBe(false);
    // The handles reach y of 1, and the curve never does.
    expect(pathContains({ x: 0.05, y: 0.9 }, arch)).toBe(false);
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
/** The angle of a direction, so a test can compare two directions of any length. */
function bearing(vector: { readonly x: number; readonly y: number }): number {
  return Math.atan2(vector.y, vector.x);
}

const QUARTER_TURN_BULGE = Math.tan(Math.PI / 8);

describe("edgeEndDirection, the way a path leaves an edge", () => {
  it("leaves a straight edge along its chord", () => {
    expect(edgeEndDirection({ start: { x: 0, y: 0 }, end: { x: 3, y: 4 }, bulge: 0 })).toEqual({ x: 3, y: 4 });
  });

  it("turns by half the sweep on an arc, so a half circle leaves square to its chord", () => {
    const direction = edgeEndDirection({ start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, bulge: HALF_CIRCLE_BULGE });
    expect(bearing(direction)).toBeCloseTo(Math.PI / 2);
  });

  it("turns the other way for the other sign of bulge", () => {
    const direction = edgeEndDirection({ start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, bulge: -HALF_CIRCLE_BULGE });
    expect(bearing(direction)).toBeCloseTo(-Math.PI / 2);
  });

  it("leaves a cubic along its last control leg, and not along its chord", () => {
    const edge: PathEdge = {
      start: { x: 0, y: 0 },
      end: { x: 10, y: 0 },
      bulge: 0,
      controls: [
        { x: 0, y: 10 },
        { x: 10, y: 10 },
      ],
    };
    expect(bearing(edgeEndDirection(edge))).toBeCloseTo(-Math.PI / 2);
  });

  it("falls back to the chord when the last control sits on the end point", () => {
    const edge: PathEdge = {
      start: { x: 0, y: 0 },
      end: { x: 10, y: 0 },
      bulge: 0,
      controls: [
        { x: 2, y: 6 },
        { x: 10, y: 0 },
      ],
    };
    expect(bearing(edgeEndDirection(edge))).toBeCloseTo(bearing({ x: 8, y: -6 }));
  });
});

describe("bulgeForTangentArc, the arc that continues a path smoothly", () => {
  it("gives a quarter circle for a chord at 45 degrees to the direction", () => {
    expect(bulgeForTangentArc({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 1, y: 0 })).toBeCloseTo(QUARTER_TURN_BULGE);
  });

  it("puts the centre square to the direction, which is what tangency means", () => {
    const start = { x: 10, y: 0 };
    const end = { x: 20, y: 10 };
    const direction = { x: 1, y: 0 };
    const arc = arcOfEdge({ start, end, bulge: bulgeForTangentArc(start, end, direction) });
    const radius = { x: (arc?.center.x ?? 0) - start.x, y: (arc?.center.y ?? 0) - start.y };
    expect(radius.x * direction.x + radius.y * direction.y).toBeCloseTo(0);
  });

  it("gives a straight edge for a chord that lies along the direction", () => {
    expect(bulgeForTangentArc({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 1, y: 0 })).toBeCloseTo(0);
  });

  it("gives a straight edge for a chord that points back along the direction, because that arc never arrives", () => {
    expect(bulgeForTangentArc({ x: 0, y: 0 }, { x: -10, y: 0 }, { x: 1, y: 0 })).toBe(0);
  });

  it("gives a straight edge when the two points are the same", () => {
    expect(bulgeForTangentArc({ x: 5, y: 5 }, { x: 5, y: 5 }, { x: 1, y: 0 })).toBe(0);
  });

  it("gives a half circle for a chord square to the direction", () => {
    expect(bulgeForTangentArc({ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 1, y: 0 })).toBeCloseTo(HALF_CIRCLE_BULGE);
  });

  it("carries the sign of the turn, so a chord to the right bends the other way", () => {
    expect(bulgeForTangentArc({ x: 0, y: 0 }, { x: 10, y: -10 }, { x: 1, y: 0 })).toBeCloseTo(-QUARTER_TURN_BULGE);
  });

  it("joins two arcs smoothly, so the second leaves where the first arrives", () => {
    const first: PathEdge = { start: { x: 0, y: 0 }, end: { x: 10, y: 10 }, bulge: QUARTER_TURN_BULGE };
    const direction = edgeEndDirection(first);
    const second: PathEdge = { start: first.end, end: { x: 10, y: 30 }, bulge: bulgeForTangentArc(first.end, { x: 10, y: 30 }, direction) };
    const arc = arcOfEdge(second);
    const radius = { x: (arc?.center.x ?? 0) - second.start.x, y: (arc?.center.y ?? 0) - second.start.y };
    expect(radius.x * direction.x + radius.y * direction.y).toBeCloseTo(0);
  });
});
