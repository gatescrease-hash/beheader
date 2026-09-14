/**
 * geometry.test.ts
 *
 * These tests cover vertex math for the presets, and the derived centroid,
 * area, length and bounds.
 */
import { describe, expect, it } from "vitest";
import type { Address } from "../address.ts";
import { mutate, type Operation } from "../mutation.ts";
import type { GraphObject, Point, Slot, Value } from "../graph/node.ts";
import { getObjectSchema, resolveDerivedSlots } from "./schema.ts";
import {
  BOUNDS_MAX_X_PATH,
  BOUNDS_MAX_Y_PATH,
  BOUNDS_MIN_X_PATH,
  BOUNDS_MIN_Y_PATH,
  circleDerivedSlots,
  computeArea,
  computeBounds,
  computeCentroid,
  computeOpenPathLength,
  computePerimeterLength,
  computePolygonVertices,
  computePolygonVerticesSlot,
  computePolylineVerticesSlot,
  computeRectVertices,
  computeRectVerticesSlot,
  computeVertexMean,
  enumeratePolylineCoordinateSlotPaths,
  enumeratePolylineVertexSlotPaths,
  explodeObjectToPolyline,
  EXPLODABLE_TYPES,
  MIN_POLYGON_SIDES,
  MIN_POLYLINE_VERTICES,
  pathDerivedSlots,
  readClosedFlag,
  vertexBulgePath,
  vertexXPath,
  vertexYPath,
  verticesDerivedSlots,
} from "./geometry.ts";

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
    expect(rotated[0]?.x).toBeCloseTo(unrotated[1]?.x ?? Number.NaN);
    expect(rotated[0]?.y).toBeCloseTo(unrotated[1]?.y ?? Number.NaN);
  });

  it("is total for sides <= 0 — an empty vertex list, not a throw (the caller never actually reaches this: MIN_POLYGON_SIDES is enforced one layer up)", () => {
    expect(computePolygonVertices(0, 1, { x: 0, y: 0 }, 0)).toEqual([]);
  });
});

/**
 * A shape with no size stands in for the degenerate cases the old zero radius
 * circle covered.
 */
function degenerate(point: Point): readonly Point[] {
  return [point, point, point];
}

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
    expect(computeArea(degenerate({ x: 5, y: 5 }))).toBe(0);
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
    expect(Math.abs(centroid.x - vertexMean.x)).toBeGreaterThan(1);
    expect(Math.abs(centroid.y - vertexMean.y)).toBeGreaterThan(0.5);
  });

  it("falls back to the arithmetic mean when the doubled area is exactly 0 (a degenerate, zero-size shape)", () => {
    const centroid = computeCentroid(degenerate({ x: 7, y: -2 }));
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

describe("circleDerivedSlots — exact, and with no vertices slot at all", () => {
  const slots = circleDerivedSlots("circle");
  const compute = (path: string) => {
    const entry = slots.find((slot) => slot.path.join(".") === path);
    if (entry === undefined) {
      throw new Error(`test setup: expected a derived slot at ${path}`);
    }
    return entry.compute;
  };
  const circle = readFrom({ "origin.x": 1, "origin.y": 2, radius: 3 });

  it("declares no vertices slot, because a circle needs no point list", () => {
    expect(slots.map((slot) => slot.path.join("."))).toEqual([
      "centroid.x",
      "centroid.y",
      "area",
      "length",
      "bounds.minX",
      "bounds.minY",
      "bounds.maxX",
      "bounds.maxY",
    ]);
  });

  it("gives the true area and circumference, not the slightly small pair a 32 sided polygon gives", () => {
    expect(compute("area")(OBJECT, circle)).toBeCloseTo(Math.PI * 9);
    expect(compute("length")(OBJECT, circle)).toBeCloseTo(2 * Math.PI * 3);
  });

  it("puts the centroid at the origin and the box one radius out on each side", () => {
    expect(compute("centroid.x")(OBJECT, circle)).toBe(1);
    expect(compute("centroid.y")(OBJECT, circle)).toBe(2);
    expect(compute("bounds.minX")(OBJECT, circle)).toBe(-2);
    expect(compute("bounds.maxY")(OBJECT, circle)).toBe(5);
  });

  it("is #REF when a parameter slot does not resolve at all", () => {
    expect(compute("area")(OBJECT, readFrom({ "origin.x": 1, "origin.y": 2 }))).toEqual({
      error: "#REF",
      message: expect.stringContaining("radius"),
    });
  });

  it("propagates an upstream ErrorValue unchanged", () => {
    const upstream = { error: "#DIV0" as const, message: "upstream boom" };
    expect(compute("area")(OBJECT, readFrom({ "origin.x": 1, "origin.y": 2, radius: upstream }))).toBe(upstream);
  });

  it("is #TYPE for a wrong-shaped parameter", () => {
    expect(compute("area")(OBJECT, readFrom({ "origin.x": 1, "origin.y": 2, radius: "not a number" }))).toEqual({
      error: "#TYPE",
      message: expect.stringContaining("radius"),
    });
  });

  it("is #TYPE for a negative radius, on every slot", () => {
    const negative = readFrom({ "origin.x": 0, "origin.y": 0, radius: -1 });
    for (const slot of slots) {
      expect(slot.compute(OBJECT, negative)).toEqual({ error: "#TYPE", message: expect.stringContaining("negative") });
    }
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
  it("a polygon centred at the origin has no -0 vertex, even though cos and sin of some angles cross through 0", () => {
    const result = computePolygonVerticesSlot(
      { ...OBJECT, type: "polygon" },
      readFrom({ sides: 32, radius: 0, "origin.x": 0, "origin.y": 0, rotation: 0 }),
    );
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

  it("declares exactly eight slots, each statically depending on vertices alone", () => {
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

  it("normalises a computed -0 centroid.x to +0 — a REAL -0, not a hypothetical one", () => {
    const clockwiseSquare: readonly Point[] = [
      { x: -1, y: -1 },
      { x: -1, y: 1 },
      { x: 1, y: 1 },
      { x: 1, y: -1 },
    ];
    expect(computeCentroid(clockwiseSquare).x).toBe(-0);
    const centroidX = byPath(["centroid", "x"]).compute(OBJECT, readFrom({ vertices: clockwiseSquare }));
    expect(centroidX).toBe(0);
    expect(Object.is(centroidX, -0)).toBe(false);
  });
});

function derivedPlaceholders(type: "circle" | "polygon" | "rect" | "polyline"): Record<string, { readonly kind: "derived"; readonly value: null }> {
  const schema = getObjectSchema(type);
  if (schema === undefined) {
    throw new Error(`test setup: expected a schema for ${type}`);
  }
  const placeholders: Record<string, { readonly kind: "derived"; readonly value: null }> = {};
  const stub: GraphObject = { id: "stub", name: "stub", type, slots: {} };
  for (const slot of resolveDerivedSlots(stub, schema.derivedSlots)) {
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
    const expectedArea = Math.PI * 2 ** 2;
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
    const expectedResizedArea = Math.PI * 4 ** 2;
    expect(resized.objects[0]?.slots.area?.value).toBeCloseTo(expectedResizedArea);
    expect(resized.objects[0]?.slots.area?.value).toBeCloseTo(expectedArea * 4);
  });

  it("a real polygon's centroid.x formula-bound to a table cell updates live when the cell changes — no false cycle", () => {
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

describe("every preset winds counterclockwise (positive doubled signed area)", () => {
  function doubledSignedArea(vertices: readonly Point[]): number {
    let sum = 0;
    for (let i = 0; i < vertices.length; i += 1) {
      const a = vertices[i];
      const b = vertices[(i + 1) % vertices.length];
      if (a === undefined || b === undefined) {
        continue;
      }
      sum += a.x * b.y - b.x * a.y;
    }
    return sum;
  }

  it("winds a polygon counterclockwise at every rotation, since rotation must not flip the order", () => {
    for (const rotation of [0, 1, -1, 2.5, Math.PI]) {
      for (const sides of [3, 5, 12]) {
        expect(doubledSignedArea(computePolygonVertices(sides, 10, { x: -4, y: 7 }, rotation))).toBeGreaterThan(0);
      }
    }
  });

  it("winds a circle counterclockwise, inheriting the polygon order it delegates to", () => {
    expect(doubledSignedArea(computePolygonVertices(32, 10, { x: 3, y: -3 }, 0))).toBeGreaterThan(0);
  });

  it("winds a rect counterclockwise, so its fillRect corner order agrees with the other two presets", () => {
    expect(doubledSignedArea(computeRectVertices({ x: 10, y: 20 }, 5, 3))).toBeGreaterThan(0);
  });

  it("gives a degenerate shape an EXACTLY zero doubled area, which is neither winding", () => {
    expect(doubledSignedArea(computeRectVertices({ x: 0, y: 0 }, 0, 3))).toBe(0);
    expect(doubledSignedArea(degenerate({ x: 5, y: 5 }))).toBe(0);
  });
});

describe("enumeratePolylineVertexSlotPaths — the count comes from vertexCount, a field and not a slot", () => {
  it("lists all seven parts of each vertex, in order", () => {
    const object: GraphObject = { id: "obj_1", name: "polyline_1", type: "polyline", slots: {}, vertexCount: 2 };
    expect(enumeratePolylineVertexSlotPaths(object)).toEqual([
      ["vertex", "0", "x"],
      ["vertex", "0", "y"],
      ["vertex", "0", "bulge"],
      ["vertex", "0", "handle", "in", "x"],
      ["vertex", "0", "handle", "in", "y"],
      ["vertex", "0", "handle", "out", "x"],
      ["vertex", "0", "handle", "out", "y"],
      ["vertex", "1", "x"],
      ["vertex", "1", "y"],
      ["vertex", "1", "bulge"],
      ["vertex", "1", "handle", "in", "x"],
      ["vertex", "1", "handle", "in", "y"],
      ["vertex", "1", "handle", "out", "x"],
      ["vertex", "1", "handle", "out", "y"],
    ]);
  });

  it("leaves the bulge out of the coordinate list the vertices slot depends on", () => {
    const object: GraphObject = { id: "obj_1", name: "polyline_1", type: "polyline", slots: {}, vertexCount: 2 };
    expect(enumeratePolylineCoordinateSlotPaths(object)).toEqual([
      ["vertex", "0", "x"],
      ["vertex", "0", "y"],
      ["vertex", "1", "x"],
      ["vertex", "1", "y"],
    ]);
  });

  it("lists nothing for a polyline with no vertexCount field at all", () => {
    const object: GraphObject = { id: "obj_1", name: "polyline_1", type: "polyline", slots: {} };
    expect(enumeratePolylineVertexSlotPaths(object)).toEqual([]);
  });
});

describe("computePolylineVerticesSlot — gathers the per vertex slots into one Point[]", () => {
  const object: GraphObject = { id: "obj_1", name: "polyline_1", type: "polyline", slots: {}, vertexCount: 2 };

  it("reads vertex.0 then vertex.1, in index order, not in whatever order the slots were written", () => {
    const vertices = computePolylineVerticesSlot(object, readFrom({ "vertex.0.x": 0, "vertex.0.y": 0, "vertex.1.x": 10, "vertex.1.y": 20 }));
    expect(vertices).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 20 },
    ]);
  });

  it(`refuses fewer than ${MIN_POLYLINE_VERTICES} vertices with #TYPE, before it reads a single one`, () => {
    const tooFew: GraphObject = { id: "obj_1", name: "polyline_1", type: "polyline", slots: {}, vertexCount: 1 };
    expect(computePolylineVerticesSlot(tooFew, readFrom({ "vertex.0.x": 0, "vertex.0.y": 0 }))).toEqual({
      error: "#TYPE",
      message: `polyline.vertices: a polyline needs at least ${MIN_POLYLINE_VERTICES} vertices`,
    });
  });

  it("gives #REF when a vertex component has not resolved yet", () => {
    expect(computePolylineVerticesSlot(object, readFrom({ "vertex.0.x": 0, "vertex.0.y": 0 }))).toEqual({
      error: "#REF",
      message: "polyline.vertices: vertex 1 did not resolve to a value",
    });
  });

  it("gives #TYPE when a vertex component is not a number", () => {
    expect(computePolylineVerticesSlot(object, readFrom({ "vertex.0.x": 0, "vertex.0.y": 0, "vertex.1.x": "east", "vertex.1.y": 0 }))).toEqual({
      error: "#TYPE",
      message: "polyline.vertices: vertex 1 must be a pair of numbers",
    });
  });
});

describe("computeOpenPathLength — an open path, unlike computePerimeterLength, never closes the last gap", () => {
  it("sums each segment once, and does not add the segment back to the first vertex", () => {
    const path: readonly Point[] = [
      { x: 0, y: 0 },
      { x: 3, y: 4 },
      { x: 3, y: 0 },
    ];
    expect(computeOpenPathLength(path)).toBeCloseTo(5 + 4);
    expect(computePerimeterLength(path)).toBeCloseTo(5 + 4 + 3);
  });

  it("gives zero for a single point, where there is no segment to sum", () => {
    expect(computeOpenPathLength([{ x: 5, y: 5 }])).toBe(0);
  });
});

describe("computeVertexMean — the plain average an open path's centroid uses", () => {
  it("averages three collinear points, where the area weighted centroid computeCentroid uses is undefined", () => {
    const collinear: readonly Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
    ];
    expect(computeVertexMean(collinear)).toEqual({ x: 10, y: 0 });
  });
});

describe("pathDerivedSlots — one slot set, and the closed slot picks the math", () => {
  it("declares the same paths a closed preset declares, area included", () => {
    const paths = pathDerivedSlots("polyline").map((slot) => slot.path.join("."));
    expect(paths).toEqual(["centroid.x", "centroid.y", "area", "length", "bounds.minX", "bounds.minY", "bounds.maxX", "bounds.maxY"]);
    expect(paths).toEqual(verticesDerivedSlots("polygon").map((slot) => slot.path.join(".")));
  });

  it("every slot depends on closed as well as on vertices, once the object has a closed slot", () => {
    const open: GraphObject = { id: "obj_1", name: "path_1", type: "polyline", slots: {} };
    const closed: GraphObject = { ...open, slots: { closed: { kind: "literal", value: true } } };
    for (const slot of pathDerivedSlots("polyline")) {
      if (slot.dependencies.kind !== "dynamic") {
        throw new Error("test setup: expected a dynamic dependency list");
      }
      expect(slot.dependencies.resolve(open, []).map((address) => address.path.join("."))).toEqual(["vertices"]);
      expect(slot.dependencies.resolve(closed, []).map((address) => address.path.join("."))).toEqual(["vertices", "closed"]);
    }
  });

  it("reads an absent closed slot as an open path", () => {
    const object: GraphObject = { id: "obj_1", name: "path_1", type: "polyline", slots: {} };
    expect(readClosedFlag(object, () => undefined, "polyline")).toBe(false);
  });

  it("refuses a closed slot that is not a boolean", () => {
    const object: GraphObject = {
      id: "obj_1",
      name: "path_1",
      type: "polyline",
      slots: { closed: { kind: "literal", value: "yes" } },
    };
    expect(readClosedFlag(object, () => "yes", "polyline")).toEqual({
      error: "#TYPE",
      message: "polyline: closed must be true or false",
    });
  });
});

describe("polyline wired through the real mutate() pipeline", () => {
  it("a real polyline's derived slots evaluate correctly on creation, and re-evaluate when a vertex moves", () => {
    const polyline: GraphObject = {
      id: "obj_1",
      name: "polyline_1",
      type: "polyline",
      vertexCount: 3,
      slots: {
        [vertexXPath(0).join(".")]: { kind: "literal", value: 0 },
        [vertexYPath(0).join(".")]: { kind: "literal", value: 0 },
        [vertexXPath(1).join(".")]: { kind: "literal", value: 3 },
        [vertexYPath(1).join(".")]: { kind: "literal", value: 4 },
        [vertexXPath(2).join(".")]: { kind: "literal", value: 3 },
        [vertexYPath(2).join(".")]: { kind: "literal", value: 0 },
        ...derivedPlaceholders("polyline"),
      },
    };
    const created = mutate([], [{ kind: "createObject", object: polyline }], []);
    if (!created.ok) {
      throw new Error(`test setup: expected creation to succeed, got: ${created.message}`);
    }
    const object = created.objects.find((candidate) => candidate.id === "obj_1");
    if (object === undefined) {
      throw new Error("test setup: expected the polyline to survive creation");
    }
    expect(object.slots["vertices"]?.value).toEqual([
      { x: 0, y: 0 },
      { x: 3, y: 4 },
      { x: 3, y: 0 },
    ]);
    expect(object.slots["length"]?.value).toBeCloseTo(9);
    expect(object.slots["centroid.x"]?.value).toBeCloseTo(2);
    expect(object.slots["bounds.maxY"]?.value).toBe(4);
    expect(object.slots["area"]?.value).toEqual({
      error: "#TYPE",
      message: "polyline.area: an open path has no area. Set closed to true first",
    });

    const updated = mutate(
      created.objects,
      [{ kind: "setSlot", address: { objectId: "obj_1", path: ["vertex", "2", "x"] }, slot: { kind: "literal", value: 30 } }],
      created.journal,
    );
    if (!updated.ok) {
      throw new Error(`test setup: expected the vertex edit to succeed, got: ${updated.message}`);
    }
    const after = updated.objects.find((candidate) => candidate.id === "obj_1");
    expect(after?.slots["bounds.maxX"]?.value).toBe(30);
  });

  function triangle(closed?: boolean): GraphObject {
    const slots: Record<string, Slot> = {
      [vertexXPath(0).join(".")]: { kind: "literal", value: 0 },
      [vertexYPath(0).join(".")]: { kind: "literal", value: 0 },
      [vertexXPath(1).join(".")]: { kind: "literal", value: 3 },
      [vertexYPath(1).join(".")]: { kind: "literal", value: 4 },
      [vertexXPath(2).join(".")]: { kind: "literal", value: 3 },
      [vertexYPath(2).join(".")]: { kind: "literal", value: 0 },
      ...derivedPlaceholders("polyline"),
    };
    if (closed !== undefined) {
      slots["closed"] = { kind: "literal", value: closed };
    }
    return { id: "obj_1", name: "polyline_1", type: "polyline", vertexCount: 3, slots };
  }

  function committed(objects: readonly GraphObject[], operations: readonly Operation[]): readonly GraphObject[] {
    const result = mutate(objects, operations, []);
    if (!result.ok) {
      throw new Error(`test setup: expected the mutation to succeed, got: ${result.message}`);
    }
    return result.objects;
  }

  it("a write to closed changes every derived value, and never the slot set — Rule 4 holds", () => {
    const open = committed([], [{ kind: "createObject", object: triangle(false) }]);
    const before = open.find((candidate) => candidate.id === "obj_1");
    expect(before?.slots["length"]?.value).toBeCloseTo(9);
    expect(before?.slots["area"]?.value).toEqual({
      error: "#TYPE",
      message: "polyline.area: an open path has no area. Set closed to true first",
    });

    const closed = committed(open, [
      { kind: "setSlot", address: { objectId: "obj_1", path: ["closed"] }, slot: { kind: "literal", value: true } },
    ]);
    const after = closed.find((candidate) => candidate.id === "obj_1");
    expect(after?.slots["length"]?.value).toBeCloseTo(12);
    expect(after?.slots["area"]?.value).toBeCloseTo(6);
    expect(after?.slots["centroid.x"]?.value).toBeCloseTo(2);
    expect(Object.keys(after?.slots ?? {}).sort()).toEqual(Object.keys(before?.slots ?? {}).sort());
  });

  it("lets a formula drive closed, because the slot set never moves when the value does", () => {
    const flag: GraphObject = { id: "obj_2", name: "value_1", type: "value", slots: { value: { kind: "literal", value: true } } };
    const path = triangle(false);
    const objects = committed([], [
      { kind: "createObject", object: flag },
      { kind: "createObject", object: path },
      {
        kind: "setSlot",
        address: { objectId: "obj_1", path: ["closed"] },
        slot: { kind: "formula", ast: { type: "reference", address: { objectId: "obj_2", path: ["value"] } }, value: null },
      },
    ]);
    expect(objects.find((candidate) => candidate.id === "obj_1")?.slots["area"]?.value).toBeCloseTo(6);

    const reopened = committed(objects, [
      { kind: "setSlot", address: { objectId: "obj_2", path: ["value"] }, slot: { kind: "literal", value: false } },
    ]);
    expect(reopened.find((candidate) => candidate.id === "obj_1")?.slots["length"]?.value).toBeCloseTo(9);
  });

  function pathObject(
    points: readonly { readonly x: number; readonly y: number }[],
    bulges: readonly number[],
    closed: boolean,
  ): GraphObject {
    const slots: Record<string, Slot> = {
      closed: { kind: "literal", value: closed },
      ...derivedPlaceholders("polyline"),
    };
    points.forEach((point, index) => {
      slots[vertexXPath(index).join(".")] = { kind: "literal", value: point.x };
      slots[vertexYPath(index).join(".")] = { kind: "literal", value: point.y };
      const bulge = bulges[index];
      if (bulge !== undefined) {
        slots[vertexBulgePath(index).join(".")] = { kind: "literal", value: bulge };
      }
    });
    return { id: "obj_1", name: "polyline_1", type: "polyline", vertexCount: points.length, slots };
  }

  const CHORD = [
    { x: 0, y: 0 },
    { x: 2, y: 0 },
  ];

  it("turns one edge into a true arc, so length and bounds leave the chord behind", () => {
    const objects = committed([], [{ kind: "createObject", object: pathObject(CHORD, [1, 0], false) }]);
    const object = objects.find((candidate) => candidate.id === "obj_1");
    expect(object?.slots["length"]?.value).toBeCloseTo(Math.PI);
    expect(object?.slots["bounds.minY"]?.value).toBeCloseTo(-1);
    expect(object?.slots["bounds.maxY"]?.value).toBeCloseTo(0);
  });

  it("keeps vertices to the two points an operator placed, however curved the edge is", () => {
    const objects = committed([], [{ kind: "createObject", object: pathObject(CHORD, [1, 0], false) }]);
    expect(objects.find((candidate) => candidate.id === "obj_1")?.slots["vertices"]?.value).toEqual(CHORD);
  });

  it("makes a true circle out of two vertices and two half circles, area, centroid and box alike", () => {
    const objects = committed([], [{ kind: "createObject", object: pathObject(CHORD, [1, 1], true) }]);
    const object = objects.find((candidate) => candidate.id === "obj_1");
    expect(object?.slots["area"]?.value).toBeCloseTo(Math.PI);
    expect(object?.slots["length"]?.value).toBeCloseTo(2 * Math.PI);
    expect(object?.slots["centroid.x"]?.value).toBeCloseTo(1);
    expect(object?.slots["centroid.y"]?.value).toBeCloseTo(0);
    expect(object?.slots["bounds.minY"]?.value).toBeCloseTo(-1);
    expect(object?.slots["bounds.maxY"]?.value).toBeCloseTo(1);
  });

  it("re-evaluates every derived slot when a bulge changes, so the edge into it is live", () => {
    const straight = committed([], [{ kind: "createObject", object: pathObject(CHORD, [0, 0], false) }]);
    expect(straight.find((candidate) => candidate.id === "obj_1")?.slots["length"]?.value).toBeCloseTo(2);

    const curved = committed(straight, [
      { kind: "setSlot", address: { objectId: "obj_1", path: ["vertex", "0", "bulge"] }, slot: { kind: "literal", value: 1 } },
    ]);
    expect(curved.find((candidate) => candidate.id === "obj_1")?.slots["length"]?.value).toBeCloseTo(Math.PI);
  });

  it("refuses a bulge that is not a number, naming the vertex", () => {
    const objects = committed([], [{ kind: "createObject", object: pathObject(CHORD, [0, 0], false) }]);
    const wrong = committed(objects, [
      { kind: "setSlot", address: { objectId: "obj_1", path: ["vertex", "0", "bulge"] }, slot: { kind: "literal", value: "bendy" } },
    ]);
    expect(wrong.find((candidate) => candidate.id === "obj_1")?.slots["length"]?.value).toEqual({
      error: "#TYPE",
      message: "polyline.length: the bulge of vertex 0 must be a number",
    });
  });

  it("measures a polyline with no bulge slot at all as a chain of straight edges", () => {
    const objects = committed([], [{ kind: "createObject", object: pathObject(CHORD, [], false) }]);
    expect(objects.find((candidate) => candidate.id === "obj_1")?.slots["length"]?.value).toBeCloseTo(2);
  });

  it("evaluates a polyline that carries no closed slot at all as open — a document saved before closed existed still works", () => {
    const objects = committed([], [{ kind: "createObject", object: triangle() }]);
    const object = objects.find((candidate) => candidate.id === "obj_1");
    expect(object?.slots["closed"]).toBeUndefined();
    expect(object?.slots["length"]?.value).toBeCloseTo(9);

    const closed = committed(objects, [
      { kind: "setSlot", address: { objectId: "obj_1", path: ["closed"] }, slot: { kind: "literal", value: true } },
    ]);
    expect(closed.find((candidate) => candidate.id === "obj_1")?.slots["area"]?.value).toBeCloseTo(6);
  });

  it("refuses a formula that names a vertex slot outside the current vertexCount, the same undeclared slot rule every type follows", () => {
    const polyline: GraphObject = {
      id: "obj_1",
      name: "polyline_1",
      type: "polyline",
      vertexCount: 2,
      slots: {
        [vertexXPath(0).join(".")]: { kind: "literal", value: 0 },
        [vertexYPath(0).join(".")]: { kind: "literal", value: 0 },
        [vertexXPath(1).join(".")]: { kind: "literal", value: 1 },
        [vertexYPath(1).join(".")]: {
          kind: "formula",
          ast: { type: "reference", address: { objectId: "obj_1", path: ["vertex", "5", "x"] } },
          value: null,
        },
        ...derivedPlaceholders("polyline"),
      },
    };
    const result = mutate([], [{ kind: "createObject", object: polyline }], []);
    expect(result.ok).toBe(false);
  });
});

describe("EXPLODABLE_TYPES — a preset with a parameter driven vertices slot", () => {
  it("names exactly circle, polygon and rect, not polyline itself", () => {
    expect([...EXPLODABLE_TYPES].sort()).toEqual(["circle", "polygon", "rect"]);
  });
});

describe("explodeObjectToPolyline — snapshots the current vertices, drops the parameter slots", () => {
  const rect: GraphObject = {
    id: "obj_1",
    name: "rect_1",
    type: "rect",
    slots: {
      "origin.x": { kind: "literal", value: 0 },
      "origin.y": { kind: "literal", value: 0 },
      width: { kind: "literal", value: 10 },
      height: { kind: "literal", value: 5 },
      vertices: {
        kind: "derived",
        value: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 5 },
          { x: 0, y: 5 },
        ],
      },
      "centroid.x": { kind: "derived", value: 5 },
      "centroid.y": { kind: "derived", value: 2.5 },
      area: { kind: "derived", value: 50 },
      length: { kind: "derived", value: 30 },
      "bounds.minX": { kind: "derived", value: 0 },
      "bounds.minY": { kind: "derived", value: 0 },
      "bounds.maxX": { kind: "derived", value: 10 },
      "bounds.maxY": { kind: "derived", value: 5 },
    },
  };

  it("keeps the same id and name, and changes only the type", () => {
    const result = explodeObjectToPolyline(rect, "rect_1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.object.id).toBe("obj_1");
    expect(result.object.name).toBe("rect_1");
    expect(result.object.type).toBe("polyline");
  });

  it("gives one literal vertex.N.x/vertex.N.y pair per vertex, in order, and sets vertexCount to match", () => {
    const result = explodeObjectToPolyline(rect, "rect_1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.object.vertexCount).toBe(4);
    expect(result.object.slots["vertex.0.x"]).toEqual({ kind: "literal", value: 0 });
    expect(result.object.slots["vertex.1.x"]).toEqual({ kind: "literal", value: 10 });
    expect(result.object.slots["vertex.2.y"]).toEqual({ kind: "literal", value: 5 });
    expect(result.object.slots["vertex.3.x"]).toEqual({ kind: "literal", value: 0 });
  });

  it("drops origin, width and height, keeping none of them as a slot at all", () => {
    const result = explodeObjectToPolyline(rect, "rect_1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.object.slots["origin.x"]).toBeUndefined();
    expect(result.object.slots["origin.y"]).toBeUndefined();
    expect(result.object.slots["width"]).toBeUndefined();
    expect(result.object.slots["height"]).toBeUndefined();
  });

  it("gives every vertex a straight edge to start with, so an exploded preset keeps its shape", () => {
    const result = explodeObjectToPolyline(rect, "rect_1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.object.slots["vertex.0.bulge"]).toEqual({ kind: "literal", value: 0 });
    expect(result.object.slots["vertex.3.bulge"]).toEqual({ kind: "literal", value: 0 });
  });

  it("carries the style slots across, because a polyline declares them at the same paths", () => {
    const painted: GraphObject = {
      ...rect,
      slots: {
        ...rect.slots,
        "style.strokeColor": { kind: "literal", value: "#ff0000" },
        "style.strokeWidth": { kind: "literal", value: 4 },
        "style.fillColor": { kind: "literal", value: "#00ff00" },
      },
    };
    const result = explodeObjectToPolyline(painted, "rect_1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.object.slots["style.strokeColor"]).toEqual({ kind: "literal", value: "#ff0000" });
    expect(result.object.slots["style.strokeWidth"]).toEqual({ kind: "literal", value: 4 });
    expect(result.object.slots["style.fillColor"]).toEqual({ kind: "literal", value: "#00ff00" });
  });

  it("closes the new path, because every preset it accepts is a closed shape", () => {
    const result = explodeObjectToPolyline(rect, "rect_1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.object.slots["closed"]).toEqual({ kind: "literal", value: true });
    expect(result.object.slots["area"]).toEqual({ kind: "derived", value: null });
  });

  it("leaves vertices, centroid, length and bounds declared as derived placeholders at the same paths", () => {
    const result = explodeObjectToPolyline(rect, "rect_1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const path of ["vertices", "centroid.x", "centroid.y", "length", "bounds.minX", "bounds.minY", "bounds.maxX", "bounds.maxY"]) {
      expect(result.object.slots[path]).toEqual({ kind: "derived", value: null });
    }
  });

  it("refuses when vertices holds an error, since there is nothing to snapshot", () => {
    const broken: GraphObject = { ...rect, slots: { ...rect.slots, vertices: { kind: "derived", value: { error: "#TYPE", message: "bad" } } } };
    const result = explodeObjectToPolyline(broken, "rect_1");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("nothing to snapshot");
  });

  it("refuses when vertices has not resolved at all", () => {
    const stub: GraphObject = { id: "obj_1", name: "rect_1", type: "rect", slots: {} };
    const result = explodeObjectToPolyline(stub, "rect_1");
    expect(result.ok).toBe(false);
  });
});
