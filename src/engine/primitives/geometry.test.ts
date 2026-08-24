/**
 * geometry.test.ts — Tests for the geometry primitive's pure math, its three
 * presets' `vertices` compute functions, and the eight shared derived slots
 * (§5.5). Colocated with geometry.ts per D-001.
 */
import { describe, expect, it } from "vitest";
import type { Address } from "../address.ts";
import { mutate } from "../mutation.ts";
import type { GraphObject, Point, Value } from "../graph/node.ts";
import { getObjectSchema } from "./schema.ts";
import {
  BOUNDS_MAX_X_PATH,
  BOUNDS_MAX_Y_PATH,
  BOUNDS_MIN_X_PATH,
  BOUNDS_MIN_Y_PATH,
  CIRCLE_VERTEX_COUNT,
  computeArea,
  computeBounds,
  computeCentroid,
  computeCircleVertices,
  computeCircleVerticesSlot,
  computePerimeterLength,
  computePolygonVertices,
  computePolygonVerticesSlot,
  computeRectVertices,
  computeRectVerticesSlot,
  MIN_POLYGON_SIDES,
  verticesDerivedSlots,
} from "./geometry.ts";

/** Matches `schema.test.ts`'s own `readFrom` pattern — a fake `read` standing in for "already evaluated earlier in the same topological pass" (§5.1), keyed by dotted path since every test object here has id `"obj_1"`. */
function readFrom(values: Record<string, Value>) {
  return (address: Address): Value | undefined => values[address.path.join(".")];
}

const OBJECT: GraphObject = { id: "obj_1", name: "shape_1", type: "circle", slots: {} };

describe("computePolygonVertices", () => {
  it("places a square's 4 vertices at radius, 90 degrees apart, starting on the +x axis at rotation 0", () => {
    const vertices = computePolygonVertices(4, 1, { x: 0, y: 0 }, 0);
    expect(vertices).toHaveLength(4);
    expect(vertices[0]?.x).toBeCloseTo(1);
    expect(vertices[0]?.y).toBeCloseTo(0);
    expect(vertices[1]?.x).toBeCloseTo(0);
    expect(vertices[1]?.y).toBeCloseTo(1);
    expect(vertices[2]?.x).toBeCloseTo(-1);
    expect(vertices[2]?.y).toBeCloseTo(0);
    expect(vertices[3]?.x).toBeCloseTo(0);
    expect(vertices[3]?.y).toBeCloseTo(-1);
  });

  it("is centred at origin, not at (0,0) unconditionally", () => {
    const vertices = computePolygonVertices(4, 1, { x: 10, y: -5 }, 0);
    expect(vertices[0]?.x).toBeCloseTo(11);
    expect(vertices[0]?.y).toBeCloseTo(-5);
  });

  it("rotation shifts every vertex's starting angle by the same amount", () => {
    const unrotated = computePolygonVertices(4, 1, { x: 0, y: 0 }, 0);
    const rotated = computePolygonVertices(4, 1, { x: 0, y: 0 }, Math.PI / 2);
    // Rotating a square by 90 degrees maps vertex 0 onto where vertex 1 was.
    expect(rotated[0]?.x).toBeCloseTo(unrotated[1]?.x ?? Number.NaN);
    expect(rotated[0]?.y).toBeCloseTo(unrotated[1]?.y ?? Number.NaN);
  });

  it("is total for sides <= 0 — an empty vertex list, not a throw (the caller never actually reaches this: MIN_POLYGON_SIDES is enforced one layer up)", () => {
    expect(computePolygonVertices(0, 1, { x: 0, y: 0 }, 0)).toEqual([]);
  });
});

describe("computeCircleVertices", () => {
  it("produces exactly CIRCLE_VERTEX_COUNT points, each at distance radius from origin", () => {
    const origin: Point = { x: 3, y: 4 };
    const vertices = computeCircleVertices(5, origin);
    expect(vertices).toHaveLength(CIRCLE_VERTEX_COUNT);
    for (const vertex of vertices) {
      expect(Math.hypot(vertex.x - origin.x, vertex.y - origin.y)).toBeCloseTo(5);
    }
  });
});

describe("computeRectVertices", () => {
  it("returns the four corners in fillRect(x,y,w,h)'s own order/convention: origin, then +width, then +width+height, then +height", () => {
    expect(computeRectVertices({ x: 10, y: 20 }, 5, 3)).toEqual([
      { x: 10, y: 20 },
      { x: 15, y: 20 },
      { x: 15, y: 23 },
      { x: 10, y: 23 },
    ]);
  });
});

describe("computeArea", () => {
  it("computes a rectangle's area as width * height", () => {
    expect(computeArea(computeRectVertices({ x: 0, y: 0 }, 4, 3))).toBeCloseTo(12);
  });

  it("computes a general irregular quadrilateral's area via the shoelace formula (cross-checked by hand against a two-triangle decomposition)", () => {
    const vertices: readonly Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 1 },
    ];
    expect(computeArea(vertices)).toBeCloseTo(55);
  });

  it("is 0 for a degenerate (zero-radius) shape", () => {
    expect(computeArea(computeCircleVertices(0, { x: 5, y: 5 }))).toBe(0);
  });

  it("is total for an empty vertex list — 0, not NaN or a throw", () => {
    expect(computeArea([])).toBe(0);
  });
});

describe("computeCentroid", () => {
  it("is the geometric centre for a rectangle (origin + half width/height, not the origin corner itself)", () => {
    const centroid = computeCentroid(computeRectVertices({ x: 0, y: 0 }, 4, 2));
    expect(centroid.x).toBeCloseTo(2);
    expect(centroid.y).toBeCloseTo(1);
  });

  it("is the origin for a regular polygon centred at the origin, by symmetry", () => {
    const centroid = computeCentroid(computePolygonVertices(6, 10, { x: 0, y: 0 }, 0.7));
    expect(centroid.x).toBeCloseTo(0);
    expect(centroid.y).toBeCloseTo(0);
  });

  it("is the AREA-WEIGHTED centroid, not the arithmetic mean of vertices — the two DIFFER on an irregular quadrilateral", () => {
    // Same fixture as computeArea's irregular-quadrilateral test (area 55).
    // Hand-computed area-weighted centroid: (2100/330, 1110/330).
    const vertices: readonly Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 1 },
    ];
    const centroid = computeCentroid(vertices);
    const vertexMean = { x: (0 + 10 + 10 + 0) / 4, y: (0 + 0 + 10 + 1) / 4 };
    expect(centroid.x).toBeCloseTo(2100 / 330);
    expect(centroid.y).toBeCloseTo(1110 / 330);
    // The point of this test: prove the two formulas actually disagree here,
    // not merely that the area-weighted one matches its own hand derivation.
    expect(Math.abs(centroid.x - vertexMean.x)).toBeGreaterThan(1);
    expect(Math.abs(centroid.y - vertexMean.y)).toBeGreaterThan(0.5);
  });

  it("falls back to the arithmetic mean when the doubled area is exactly 0 (a degenerate, zero-size shape)", () => {
    const centroid = computeCentroid(computeCircleVertices(0, { x: 7, y: -2 }));
    expect(centroid.x).toBeCloseTo(7);
    expect(centroid.y).toBeCloseTo(-2);
  });

  it("is {0,0} for an empty vertex list — total, never NaN or a throw", () => {
    expect(computeCentroid([])).toEqual({ x: 0, y: 0 });
  });
});

describe("computePerimeterLength", () => {
  it("is 2*(width+height) for a rectangle — the CLOSED perimeter, including the closing edge", () => {
    expect(computePerimeterLength(computeRectVertices({ x: 0, y: 0 }, 3, 4))).toBeCloseTo(14);
  });

  it("is 0 for an empty or single-point vertex list", () => {
    expect(computePerimeterLength([])).toBe(0);
    expect(computePerimeterLength([{ x: 1, y: 1 }])).toBe(0);
  });
});

describe("computeBounds", () => {
  it("finds the min/max of an asymmetric set of vertices", () => {
    expect(computeBounds([{ x: -3, y: 5 }, { x: 8, y: -1 }, { x: 2, y: 2 }])).toEqual({ minX: -3, minY: -1, maxX: 8, maxY: 5 });
  });

  it("collapses to a single point's own coordinates for one vertex", () => {
    expect(computeBounds([{ x: 4, y: 4 }])).toEqual({ minX: 4, minY: 4, maxX: 4, maxY: 4 });
  });

  it("is {0,0,0,0} for an empty vertex list — total, never a throw", () => {
    expect(computeBounds([])).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
  });
});

describe("computeCircleVerticesSlot", () => {
  it("computes CIRCLE_VERTEX_COUNT vertices from origin.x/origin.y/radius", () => {
    const result = computeCircleVerticesSlot(OBJECT, readFrom({ "origin.x": 1, "origin.y": 2, radius: 3 }));
    expect(Array.isArray(result)).toBe(true);
    expect((result as readonly Point[])).toHaveLength(CIRCLE_VERTEX_COUNT);
  });

  it("is #REF when a parameter slot does not resolve at all", () => {
    const result = computeCircleVerticesSlot(OBJECT, readFrom({ "origin.x": 1, "origin.y": 2 }));
    expect(result).toEqual({ error: "#REF", message: expect.stringContaining("radius") });
  });

  it("propagates an upstream ErrorValue unchanged", () => {
    const upstream = { error: "#DIV0" as const, message: "upstream boom" };
    const result = computeCircleVerticesSlot(OBJECT, readFrom({ "origin.x": 1, "origin.y": 2, radius: upstream }));
    expect(result).toBe(upstream);
  });

  it("is #TYPE for a wrong-shaped parameter", () => {
    const result = computeCircleVerticesSlot(OBJECT, readFrom({ "origin.x": 1, "origin.y": 2, radius: "not a number" }));
    expect(result).toEqual({ error: "#TYPE", message: expect.stringContaining("radius") });
  });

  it("is #TYPE for a negative radius", () => {
    const result = computeCircleVerticesSlot(OBJECT, readFrom({ "origin.x": 0, "origin.y": 0, radius: -1 }));
    expect(result).toEqual({ error: "#TYPE", message: expect.stringContaining("negative") });
  });
});

describe("computePolygonVerticesSlot", () => {
  const valid = { sides: 5, radius: 10, "origin.x": 0, "origin.y": 0, rotation: 0 };

  it("computes 'sides' vertices", () => {
    const result = computePolygonVerticesSlot(OBJECT, readFrom(valid));
    expect((result as readonly Point[])).toHaveLength(5);
  });

  it("is #TYPE for sides below MIN_POLYGON_SIDES", () => {
    const result = computePolygonVerticesSlot(OBJECT, readFrom({ ...valid, sides: MIN_POLYGON_SIDES - 1 }));
    expect(result).toEqual({ error: "#TYPE", message: expect.stringContaining("sides") });
  });

  it("is #TYPE for a non-integer sides", () => {
    const result = computePolygonVerticesSlot(OBJECT, readFrom({ ...valid, sides: 4.5 }));
    expect(result).toEqual({ error: "#TYPE", message: expect.stringContaining("sides") });
  });

  it("is #TYPE for a negative radius", () => {
    const result = computePolygonVerticesSlot(OBJECT, readFrom({ ...valid, radius: -5 }));
    expect(result).toEqual({ error: "#TYPE", message: expect.stringContaining("negative") });
  });
});

describe("computeRectVerticesSlot", () => {
  const valid = { "origin.x": 0, "origin.y": 0, width: 4, height: 2 };

  it("computes the 4 corners", () => {
    const result = computeRectVerticesSlot(OBJECT, readFrom(valid));
    expect((result as readonly Point[])).toHaveLength(4);
  });

  it("is #TYPE for a negative width or height", () => {
    expect(computeRectVerticesSlot(OBJECT, readFrom({ ...valid, width: -1 }))).toEqual({
      error: "#TYPE",
      message: expect.stringContaining("negative"),
    });
    expect(computeRectVerticesSlot(OBJECT, readFrom({ ...valid, height: -1 }))).toEqual({
      error: "#TYPE",
      message: expect.stringContaining("negative"),
    });
  });
});

describe("a preset's vertices compute function never needs to normalise -0 (geometry.ts's own proof, checked rather than assumed)", () => {
  it("a circle centred at the origin has no -0 vertex, even though cos/sin of some angles crosses through 0 and radius may be 0", () => {
    // Both origin.x/y at the exact 0 that makes the +0/-0 distinction possible,
    // AND radius 0 (so radius * trig(angle) can itself be -0 for a negative
    // trig value) — the combination finalizeVertices's own doc comment argues
    // can never survive the final addition. Checked directly, not assumed.
    const result = computeCircleVerticesSlot(OBJECT, readFrom({ "origin.x": 0, "origin.y": 0, radius: 0 }));
    for (const vertex of result as readonly Point[]) {
      expect(Object.is(vertex.x, -0)).toBe(false);
      expect(Object.is(vertex.y, -0)).toBe(false);
    }
  });
});

describe("verticesDerivedSlots", () => {
  const slots = verticesDerivedSlots("shape");
  const byPath = (path: readonly string[]) => {
    const key = path.join(".");
    const entry = slots.find((slot) => slot.path.join(".") === key);
    if (entry === undefined) {
      throw new Error(`test setup: expected a derived slot at ${key}`);
    }
    return entry;
  };

  it("declares exactly the eight slots §5.5 names, each statically depending on vertices alone", () => {
    expect(slots).toHaveLength(8);
    for (const slot of slots) {
      expect(slot.dependencies).toEqual({ kind: "static", paths: [["vertices"]] });
    }
  });

  const square: readonly Point[] = [
    { x: 0, y: 0 },
    { x: 2, y: 0 },
    { x: 2, y: 2 },
    { x: 0, y: 2 },
  ];

  it("computes centroid.x/centroid.y/area/length/bounds.* from the object's own vertices slot", () => {
    const read = readFrom({ vertices: square });
    expect(byPath(["centroid", "x"]).compute(OBJECT, read)).toBeCloseTo(1);
    expect(byPath(["centroid", "y"]).compute(OBJECT, read)).toBeCloseTo(1);
    expect(byPath(["area"]).compute(OBJECT, read)).toBeCloseTo(4);
    expect(byPath(["length"]).compute(OBJECT, read)).toBeCloseTo(8);
    expect(byPath(["bounds", "minX"]).compute(OBJECT, read)).toBe(0);
    expect(byPath(["bounds", "minY"]).compute(OBJECT, read)).toBe(0);
    expect(byPath(["bounds", "maxX"]).compute(OBJECT, read)).toBe(2);
    expect(byPath(["bounds", "maxY"]).compute(OBJECT, read)).toBe(2);
  });

  it("is #REF when vertices does not resolve at all", () => {
    expect(byPath(["area"]).compute(OBJECT, readFrom({}))).toEqual({ error: "#REF", message: expect.stringContaining("vertices") });
  });

  it("propagates an upstream ErrorValue on vertices unchanged", () => {
    const upstream = { error: "#TYPE" as const, message: "upstream boom" };
    expect(byPath(["area"]).compute(OBJECT, readFrom({ vertices: upstream }))).toBe(upstream);
  });

  it("is #TYPE when vertices is not a list of points", () => {
    expect(byPath(["area"]).compute(OBJECT, readFrom({ vertices: 42 }))).toEqual({
      error: "#TYPE",
      message: expect.stringContaining("vertices"),
    });
  });

  it("is #TYPE when vertices is an empty list", () => {
    expect(byPath(["area"]).compute(OBJECT, readFrom({ vertices: [] }))).toEqual({
      error: "#TYPE",
      message: expect.stringContaining("empty"),
    });
  });

  it("normalises a computed -0 centroid.x to +0 (D-033) — a REAL -0, not a hypothetical one", () => {
    // A clockwise-wound square: doubled signed area is NEGATIVE (-8), and the
    // weighted-x numerator sums to exactly 0 (hand-derivable: the two +x
    // edges' contributions exactly cancel the two -x edges'), so
    // computeCentroid's own division is 0 / (a negative number) = -0 before
    // finiteOrTypeError ever sees it. Verified by mutation-test: with
    // finiteOrTypeError's `-0` branch removed, this test is the one that
    // fails (see the geometry cycle's log entry).
    const clockwiseSquare: readonly Point[] = [
      { x: -1, y: -1 },
      { x: -1, y: 1 },
      { x: 1, y: 1 },
      { x: 1, y: -1 },
    ];
    expect(computeCentroid(clockwiseSquare).x).toBe(-0); // the RAW pure-math function is honest about the sign
    const centroidX = byPath(["centroid", "x"]).compute(OBJECT, readFrom({ vertices: clockwiseSquare }));
    expect(centroidX).toBe(0);
    expect(Object.is(centroidX, -0)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Wired through the REAL mutate() pipeline (D-016 discipline: a schema
// registered but never exercised through the real entry point is not yet
// proven to work — deriveEdges/validateIntegrity/detectCycle/evaluate all
// have their own say, not just this file's own compute functions).
// ---------------------------------------------------------------------------

/** Every derived-slot placeholder a schema-registered object must carry (D-018) — `{ kind: "derived", value: null }`, the same shape `document.ts`'s loader uses, overwritten by the first real evaluation. */
function derivedPlaceholders(type: "circle" | "polygon" | "rect"): Record<string, { readonly kind: "derived"; readonly value: null }> {
  const schema = getObjectSchema(type);
  if (schema === undefined) {
    throw new Error(`test setup: expected a schema for ${type}`);
  }
  const placeholders: Record<string, { readonly kind: "derived"; readonly value: null }> = {};
  for (const slot of schema.derivedSlots) {
    placeholders[slot.path.join(".")] = { kind: "derived", value: null };
  }
  return placeholders;
}

describe("circle/polygon/rect wired through the real mutate() pipeline", () => {
  it("a real circle's derived slots evaluate correctly on creation, and re-evaluate when radius changes", () => {
    const circle: GraphObject = {
      id: "obj_1",
      name: "circle_1",
      type: "circle",
      slots: {
        "origin.x": { kind: "literal", value: 0 },
        "origin.y": { kind: "literal", value: 0 },
        radius: { kind: "literal", value: 2 },
        ...derivedPlaceholders("circle"),
      },
    };
    const created = mutate([], [{ kind: "createObject", object: circle }], []);
    if (!created.ok) {
      throw new Error(`test setup: expected creation to succeed, got: ${created.message}`);
    }
    // A regular CIRCLE_VERTEX_COUNT-gon inscribed in radius r has area
    // (1/2) N r^2 sin(2*PI/N) — strictly LESS than the true circle's PI*r^2,
    // by design (§5.5: vertices is a polygonal APPROXIMATION). Comparing
    // against the polygon's own area formula, not the circle's, is the
    // correct check here.
    const expectedArea = 0.5 * CIRCLE_VERTEX_COUNT * 2 ** 2 * Math.sin((2 * Math.PI) / CIRCLE_VERTEX_COUNT);
    expect(created.objects[0]?.slots.area?.value).toBeCloseTo(expectedArea);
    expect(created.objects[0]?.slots["centroid.x"]?.value).toBeCloseTo(0);

    const resized = mutate(
      created.objects,
      [{ kind: "setSlot", address: { objectId: "obj_1", path: ["radius"] }, slot: { kind: "literal", value: 4 } }],
      created.journal,
    );
    if (!resized.ok) {
      throw new Error(`test setup: expected the resize to succeed, got: ${resized.message}`);
    }
    // Area grows with the SQUARE of radius: 2 -> 4 quadruples it, proving this
    // re-derived from the new radius rather than caching the old value. Same
    // polygon-area formula as above, not the true circle's PI*r^2.
    const expectedResizedArea = 0.5 * CIRCLE_VERTEX_COUNT * 4 ** 2 * Math.sin((2 * Math.PI) / CIRCLE_VERTEX_COUNT);
    expect(resized.objects[0]?.slots.area?.value).toBeCloseTo(expectedResizedArea);
    expect(resized.objects[0]?.slots.area?.value).toBeCloseTo(expectedArea * 4);
  });

  it("a real polygon's centroid.x formula-bound to a table cell updates live when the cell changes — no false cycle (Phase 4's own shape, proved one phase early)", () => {
    const table: GraphObject = {
      id: "obj_2",
      name: "table_x",
      type: "table",
      slots: { rows: { kind: "literal", value: 1 }, cols: { kind: "literal", value: 1 }, "cells.A1": { kind: "literal", value: 5 } },
    };
    const polygon: GraphObject = {
      id: "obj_1",
      name: "polygon_1",
      type: "polygon",
      slots: {
        sides: { kind: "literal", value: 6 },
        radius: {
          kind: "formula",
          ast: { type: "reference", address: { objectId: "obj_2", path: ["cells", "A1"] } },
          value: 0,
        },
        "origin.x": { kind: "literal", value: 0 },
        "origin.y": { kind: "literal", value: 0 },
        rotation: { kind: "literal", value: 0 },
        ...derivedPlaceholders("polygon"),
      },
    };
    const created = mutate([], [{ kind: "createObject", object: table }, { kind: "createObject", object: polygon }], []);
    if (!created.ok) {
      throw new Error(`test setup: expected creation to succeed, got: ${created.message}`);
    }
    const before = created.objects.find((object) => object.id === "obj_1")?.slots["bounds.maxX"]?.value;
    expect(before).toBeCloseTo(5);

    const updated = mutate(
      created.objects,
      [{ kind: "setSlot", address: { objectId: "obj_2", path: ["cells", "A1"] }, slot: { kind: "literal", value: 10 } }],
      created.journal,
    );
    if (!updated.ok) {
      throw new Error(`test setup: expected the cell edit to succeed, got: ${updated.message}`);
    }
    const after = updated.objects.find((object) => object.id === "obj_1")?.slots["bounds.maxX"]?.value;
    expect(after).toBeCloseTo(10);
  });
});
