/**
 * extent.test.ts
 *
 * These tests cover the world space box of one object, and of the whole
 * document. Every clickable type has an arm here. hitTest and the resize
 * handles both read objectExtent. Neither one measures a type of its own.
 */
import { describe, expect, it } from "vitest";
import { createEmptyDocument, type Document, type EvalContext, type GraphObject } from "../engine/index.ts";
import { executeCommand, isCommandFailure } from "../command/commands.ts";
import { isCommandParseFailure, parseCommand } from "../command/parser.ts";
import { documentExtent, groupBoundary, objectExtent } from "./extent.ts";

describe("objectExtent — the box the canvas draws is the box a formula reads", () => {
  it("equals the derived box slot for every type that carries one", () => {
    const context: EvalContext = { measurer: { measure: (text: string) => ({ width: text.length * 8, height: 20 }) } };
    let document: Document = createEmptyDocument();
    for (const line of ["circle x=100 y=50 r=20", "rect x=10 y=20 w=30 h=40", "polygon sides=5 x=0 y=0 r=10", "polyline 0,0 40,0 40,30", "table x=0 y=100 rows=2 cols=3",
      'text x=0 y=300 "a note"', "image x=200 y=0", "script x=300 y=0", "slider x=0 y=400", "frame x=0 y=500 w=200 h=100", "docvar speed 12 x=400 y=400"]) {
      const parsed = parseCommand(line);
      if (isCommandParseFailure(parsed)) throw new Error(parsed.message);
      const outcome = executeCommand(parsed.command, document, context);
      if (isCommandFailure(outcome)) throw new Error(outcome.message);
      document = outcome.document;
    }
    const boxed = document.objects.filter((object) => object.slots.box !== undefined);
    expect(boxed).toHaveLength(11);
    for (const object of boxed) {
      const box = object.slots.box?.value as readonly { x: number; y: number }[];
      const extent = objectExtent(object)!;
      expect([extent.minX, extent.minY, extent.maxX, extent.maxY], object.name).toEqual([box[0]!.x, box[0]!.y, box[1]!.x, box[1]!.y].map((value) => expect.closeTo(value, 9)));
    }
  });
});

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
