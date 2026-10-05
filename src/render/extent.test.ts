/**
 * extent.test.ts
 *
 * These tests cover the world space box of one object, and of the whole
 * document. Every clickable type has an arm here. hitTest and the resize
 * handles both read objectExtent. Neither one measures a type of its own.
 */
import { describe, expect, it } from "vitest";
import type { GraphObject } from "../engine/index.ts";
import { documentExtent, groupBoundary, objectExtent } from "./extent.ts";

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

describe("groupBoundary", () => {
  const circle = (id: string, x: number, group: string): GraphObject => ({
    id, name: id, type: "circle",
    slots: { "origin.x": { kind: "literal", value: x }, "origin.y": { kind: "literal", value: 100 }, radius: { kind: "literal", value: 10 }, "view.group": { kind: "literal", value: group } },
  });
  const group = (id: string, x: number, parent?: string): GraphObject => ({
    id, name: id, type: "group",
    slots: { "origin.x": { kind: "literal", value: x }, "origin.y": { kind: "literal", value: 50 }, ...(parent === undefined ? {} : { "view.group": { kind: "literal" as const, value: parent } }) },
  });

  it("pads the union of its origin and its members, with room above them for their names", () => {
    const objects = [group("g", 80), circle("a", 100, "g"), circle("b", 200, "g")];
    expect(groupBoundary(objects[0]!, objects)).toEqual({ minX: 74, minY: 50, maxX: 226, maxY: 126 });
  });

  it("takes a nested group's boundary and tab into account, and the fixed box when empty", () => {
    const objects = [group("outer", 0), group("inner", 80, "outer"), circle("a", 100, "inner")];
    const inner = groupBoundary(objects[1]!, objects)!;
    const outer = groupBoundary(objects[0]!, objects)!;
    expect(outer.minY).toBe(Math.min(50, inner.minY - 20 - 30));
    expect(outer.maxX).toBe(inner.maxX + 16);
    expect(groupBoundary(group("lonely", 5), [])).toEqual({ minX: 5, minY: 50, maxX: 165, maxY: 130 });
  });
});
