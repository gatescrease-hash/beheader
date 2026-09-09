/**
 * extent.test.ts
 *
 * The world space box of one object, and of the whole document. Every
 * clickable type must have an arm here. hitTest and the resize handles both
 * read objectExtent. Neither one measures a type of its own.
 */
import { describe, expect, it } from "vitest";
import type { GraphObject } from "../engine/index.ts";
import { documentExtent, objectExtent } from "./extent.ts";

describe("objectExtent — polyline reads the same derived vertices slot the closed shapes read", () => {
  it("gives the bounding box of its vertices", () => {
    const polyline: GraphObject = {
      id: "obj_1",
      name: "polyline_1",
      type: "polyline",
      slots: {
        vertices: {
          kind: "derived",
          value: [
            { x: 10, y: -5 },
            { x: 40, y: 20 },
            { x: 0, y: 3 },
          ],
        },
      },
    };
    expect(objectExtent(polyline)).toEqual({ minX: 0, minY: -5, maxX: 40, maxY: 20 });
  });

  it("grows the box to hold a curved edge, which leaves the chord between its two vertices", () => {
    const bowed: GraphObject = {
      id: "obj_1",
      name: "polyline_1",
      type: "polyline",
      vertexCount: 2,
      slots: {
        "vertex.0.bulge": { kind: "literal", value: 1 },
        vertices: {
          kind: "derived",
          value: [
            { x: 0, y: 0 },
            { x: 200, y: 0 },
          ],
        },
      },
    };
    const extent = objectExtent(bowed);
    expect(extent?.minX).toBeCloseTo(0);
    expect(extent?.maxX).toBeCloseTo(200);
    expect(extent?.minY).toBeCloseTo(-100);
    expect(extent?.maxY).toBeCloseTo(0);
  });

  it("gives undefined for a polyline with no vertices slot at all, matching every other empty vertex shape", () => {
    const polyline: GraphObject = { id: "obj_1", name: "polyline_1", type: "polyline", slots: {} };
    expect(objectExtent(polyline)).toBeUndefined();
  });
});

describe("documentExtent — the box that holds every object, fit's target", () => {
  it("grows to include a polyline alongside a table, taking the widest bound of either", () => {
    const table: GraphObject = {
      id: "obj_1",
      name: "table_1",
      type: "table",
      slots: { "origin.x": { kind: "literal", value: 0 }, "origin.y": { kind: "literal", value: 0 }, rows: { kind: "literal", value: 1 }, cols: { kind: "literal", value: 1 } },
    };
    const polyline: GraphObject = {
      id: "obj_2",
      name: "polyline_1",
      type: "polyline",
      slots: { vertices: { kind: "derived", value: [{ x: -50, y: -50 }, { x: 500, y: 500 }] } },
    };
    const extent = documentExtent([table, polyline]);
    expect(extent).toEqual({ minX: -50, minY: -50, maxX: 500, maxY: 500 });
  });

  it("returns undefined for a document holding only types with no extent arm", () => {
    const value: GraphObject = { id: "obj_1", name: "value_1", type: "value", slots: { value: { kind: "literal", value: 1 } } };
    expect(documentExtent([value])).toBeUndefined();
  });
});
