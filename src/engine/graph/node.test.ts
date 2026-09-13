/**
 * node.test.ts
 *
 * This suite covers the data model: value guards, the three slot kinds, and
 * slot keys.
 */

import { describe, expect, it } from "vitest";
import { formatAddress, parseAddress, type Address } from "../address.ts";
import type { ReferenceNode } from "../formula/ast.ts";
import {
  TABLE_TYPE,
  getSlot,
  hasIllegalNumber,
  isErrorValue,
  isIllegalNumber,
  isLegalPortName,
  resolveSlot,
  slotKey,
  type DerivedSlot,
  type ErrorValue,
  type FormulaSlot,
  type GraphObject,
  type GraphObjectPorts,
  type LiteralSlot,
  type ObjectType,
  type Point,
  type Value,
} from "./node.ts";

describe("slotKey", () => {
  it("joins a path with '.', matching the format formatAddress prints", () => {
    expect(slotKey(["origin", "x"])).toBe("origin.x");
    expect(slotKey(["cells", "A1"])).toBe("cells.A1");
    expect(slotKey(["vertex", "0", "x"])).toBe("vertex.0.x");
  });

  it("is the identity join for a single-segment path", () => {
    expect(slotKey(["radius"])).toBe("radius");
  });
});

describe("getSlot / resolveSlot", () => {
  const literalSlot: LiteralSlot = { kind: "literal", value: 42 };
  const object: GraphObject = {
    id: "obj_1",
    name: "value_1",
    type: "value",
    slots: { value: literalSlot },
  };

  it("finds a slot by its stored path", () => {
    expect(getSlot(object, ["value"])).toBe(literalSlot);
  });

  it("returns undefined for a path with no slot, without throwing", () => {
    expect(getSlot(object, ["nonexistent"])).toBeUndefined();
  });

  it("resolveSlot finds a slot across a document's object list via an Address", () => {
    const address: Address = { objectId: "obj_1", path: ["value"] };
    expect(resolveSlot(address, [object])).toBe(literalSlot);
  });

  it("resolveSlot returns undefined for a stale objectId, without throwing", () => {
    const address: Address = { objectId: "obj_999", path: ["value"] };
    expect(resolveSlot(address, [object])).toBeUndefined();
  });
});

describe("the three slot kinds", () => {
  it("a literal slot holds a user-writable stored value", () => {
    const slot: LiteralSlot = { kind: "literal", value: 42 };
    expect(slot.kind).toBe("literal");
    expect(slot.value).toBe(42);
  });

  it("a formula slot's AST can be a bare reference — the degenerate binding case", () => {
    const bindingAst: ReferenceNode = {
      type: "reference",
      address: { objectId: "obj_2", path: ["value"] },
    };
    const slot: FormulaSlot = { kind: "formula", ast: bindingAst, value: 7 };
    expect(slot.ast.type).toBe("reference");
    expect(slot.value).toBe(7);
  });

  it("a derived slot has no user-settable content, only a cached computed value", () => {
    const slot: DerivedSlot = { kind: "derived", value: 9 };
    expect(slot.kind).toBe("derived");
    expect(Object.keys(slot).sort()).toEqual(["kind", "value"]);
  });

  it("An ErrorValue is legitimate slot state, not a reason to reject it", () => {
    const errorValue: ErrorValue = { error: "#DIV0", message: "division by zero" };
    const slot: LiteralSlot = { kind: "literal", value: errorValue };
    expect(slot.value).toEqual({ error: "#DIV0", message: "division by zero" });
  });
});

describe("isErrorValue", () => {
  it("is true for an ErrorValue", () => {
    const errorValue: Value = { error: "#REF", message: "no such slot" };
    expect(isErrorValue(errorValue)).toBe(true);
  });

  it("is false for null, which is object-typed but not an error", () => {
    expect(isErrorValue(null)).toBe(false);
  });

  it("is false for a Point, which is object-shaped but carries no error property", () => {
    const point: Point = { x: 1, y: 2 };
    expect(isErrorValue(point)).toBe(false);
  });

  it("is false for a Point[], the other object-shaped member of Value", () => {
    const points: readonly Point[] = [{ x: 1, y: 2 }];
    expect(isErrorValue(points)).toBe(false);
  });

  it("is false for every scalar member of Value", () => {
    expect(isErrorValue(42)).toBe(false);
    expect(isErrorValue("a string")).toBe(false);
    expect(isErrorValue(true)).toBe(false);
  });
});

describe("isIllegalNumber", () => {
  it("is true for NaN, +Infinity, -Infinity, and -0", () => {
    expect(isIllegalNumber(NaN)).toBe(true);
    expect(isIllegalNumber(Number.POSITIVE_INFINITY)).toBe(true);
    expect(isIllegalNumber(Number.NEGATIVE_INFINITY)).toBe(true);
    expect(isIllegalNumber(-0)).toBe(true);
  });

  it("is false for a finite, non-negative-zero number, including plain 0 and a negative number", () => {
    expect(isIllegalNumber(0)).toBe(false);
    expect(isIllegalNumber(-42)).toBe(false);
    expect(isIllegalNumber(Number.MAX_VALUE)).toBe(false);
  });
});

describe("hasIllegalNumber", () => {
  it("is true for a bare NaN, +Infinity, -Infinity, or -0", () => {
    expect(hasIllegalNumber(NaN)).toBe(true);
    expect(hasIllegalNumber(Number.POSITIVE_INFINITY)).toBe(true);
    expect(hasIllegalNumber(Number.NEGATIVE_INFINITY)).toBe(true);
    expect(hasIllegalNumber(-0)).toBe(true);
  });

  it("is false for a finite, non-negative-zero number, including 0 and a negative number", () => {
    expect(hasIllegalNumber(0)).toBe(false);
    expect(hasIllegalNumber(-42)).toBe(false);
    expect(hasIllegalNumber(Number.MAX_VALUE)).toBe(false);
  });

  it("is true for a Point whose x OR y is non-finite or -0, false when both are legal", () => {
    expect(hasIllegalNumber({ x: NaN, y: 0 })).toBe(true);
    expect(hasIllegalNumber({ x: 0, y: Number.POSITIVE_INFINITY })).toBe(true);
    expect(hasIllegalNumber({ x: -0, y: 0 })).toBe(true);
    expect(hasIllegalNumber({ x: 1, y: 2 })).toBe(false);
  });

  it("is true for a Point[] with ANY illegal point, false when every point is legal", () => {
    const points: readonly Point[] = [
      { x: 1, y: 2 },
      { x: 3, y: Number.NEGATIVE_INFINITY },
    ];
    expect(hasIllegalNumber(points)).toBe(true);
    expect(hasIllegalNumber([{ x: 1, y: -0 }])).toBe(true);
    expect(hasIllegalNumber([{ x: 1, y: 2 }])).toBe(false);
    expect(hasIllegalNumber([])).toBe(false);
  });

  it("is false for every non-number member of Value: string, boolean, null, ErrorValue", () => {
    expect(hasIllegalNumber("a string")).toBe(false);
    expect(hasIllegalNumber(true)).toBe(false);
    expect(hasIllegalNumber(null)).toBe(false);
    expect(hasIllegalNumber({ error: "#TYPE", message: "boom" })).toBe(false);
  });
});

describe("ObjectType / TABLE_TYPE", () => {
  it("TABLE_TYPE is the literal 'table', usable anywhere ObjectType is", () => {
    expect(TABLE_TYPE).toBe("table");
    const type: ObjectType = TABLE_TYPE;
    expect(type).toBe("table");
  });
});

describe("Phase 0 fixture shapes: 'value' and 'add' objects", () => {
  it("builds a 'value' object: one literal numeric slot", () => {
    const valueObject: GraphObject = {
      id: "obj_1",
      name: "value_1",
      type: "value",
      slots: {
        value: { kind: "literal", value: 10 },
      },
    };
    expect(getSlot(valueObject, ["value"])).toEqual({ kind: "literal", value: 10 });
  });

  it("builds an 'add' object: two formula (binding) input slots, one derived output slot", () => {
    const addObject: GraphObject = {
      id: "obj_2",
      name: "add_1",
      type: "add",
      slots: {
        "in.a": {
          kind: "formula",
          ast: { type: "reference", address: { objectId: "obj_1", path: ["value"] } },
          value: 10,
        },
        "in.b": {
          kind: "formula",
          ast: { type: "reference", address: { objectId: "obj_3", path: ["value"] } },
          value: 5,
        },
        "out.result": { kind: "derived", value: 15 },
      },
    };
    expect(getSlot(addObject, ["in", "a"])).toMatchObject({ kind: "formula" });
    expect(getSlot(addObject, ["out", "result"])).toEqual({ kind: "derived", value: 15 });
  });
});

describe("GraphObject satisfies address.ts's AddressableObject", () => {
  it("parseAddress and formatAddress operate directly on a GraphObject[]", () => {
    const table: GraphObject = {
      id: "obj_3",
      name: "table_x",
      type: TABLE_TYPE,
      slots: { "cells.A1": { kind: "literal", value: 42 } },
    };
    const parsed = parseAddress("table_x.A1", [table]);
    expect(parsed).toEqual({ objectId: "obj_3", path: ["cells", "A1"] });
    expect(formatAddress(parsed as Address, [table])).toBe("table_x.A1");
    expect(getSlot(table, (parsed as Address).path)).toEqual({ kind: "literal", value: 42 });
  });
});

describe("object type is mutable across mutations, not fixed per object", () => {
  it("two GraphObject snapshots may share id and name while differing only in type", () => {
    const beforeExplode: GraphObject = {
      id: "obj_4",
      name: "polygon_1",
      type: "polygon",
      slots: {
        sides: { kind: "literal", value: 5 },
        radius: { kind: "literal", value: 50 },
        vertices: { kind: "derived", value: [] },
      },
    };
    const afterExplode: GraphObject = {
      id: "obj_4",
      name: "polygon_1",
      type: "polyline",
      slots: {
        "vertex.0.x": { kind: "literal", value: 0 },
        "vertex.0.y": { kind: "literal", value: 0 },
        vertices: { kind: "derived", value: [] },
      },
    };
    expect(beforeExplode.id).toBe(afterExplode.id);
    expect(beforeExplode.name).toBe(afterExplode.name);
    expect(beforeExplode.type).not.toBe(afterExplode.type);
  });
});

describe("isLegalPortName", () => {
  it("accepts an ordinary, non-empty, dot-free name", () => {
    expect(isLegalPortName("factor")).toBe(true);
    expect(isLegalPortName("speed_2")).toBe(true);
  });

  it("rejects an empty name", () => {
    expect(isLegalPortName("")).toBe(false);
  });

  it("rejects a name containing '.' — it would forge a slot key no schema path may contain", () => {
    expect(isLegalPortName("a.b")).toBe(false);
    expect(isLegalPortName(".")).toBe(false);
  });

  it("rejects a port name that the path segment pattern in address.ts also rejects", () => {
    expect(isLegalPortName("my-port")).toBe(false);
    expect(isLegalPortName("my port")).toBe(false);
    expect(isLegalPortName("café")).toBe(false);
  });
});

describe("GraphObject.ports", () => {
  it("is optional — every type but 'script' simply has no ports field", () => {
    const rect: GraphObject = { id: "obj_1", name: "rect_1", type: "rect", slots: {} };
    expect(rect.ports).toBeUndefined();
  });

  it("holds two ORDERED, plain string arrays when present", () => {
    const ports: GraphObjectPorts = { in: ["factor", "speed"], out: ["result"] };
    const script: GraphObject = { id: "obj_1", name: "script_1", type: "script", slots: {}, ports };
    expect(script.ports?.in).toEqual(["factor", "speed"]);
    expect(script.ports?.out).toEqual(["result"]);
  });
});
