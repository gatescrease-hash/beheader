/**
 * schema.test.ts
 *
 * These tests cover the type registry, where static and dynamic slot groups
 * resolve per object, and every declared path stays reachable.
 */
import { describe, expect, it } from "vitest";
import type { Address } from "../address.ts";
import type { GraphObject, Value } from "../graph/node.ts";
import {
  derivedSlotDependencyAddresses,
  findDerivedSlotSchema,
  getObjectSchema,
  resolveDerivedSlots,
  resolveNonDerivedSlotPaths,
  type DerivedSlotDependencies,
  type NonDerivedSlotPathGroup,
} from "./schema.ts";

function stubObject(type: GraphObject["type"]): GraphObject {
  return { id: "stub", name: "stub", type, slots: {} };
}

/** Every shape declares these three, after its own parameters. */
const STYLE_PATHS = [["style", "strokeColor"], ["style", "strokeWidth"], ["style", "fillColor"]] as const;

describe("getObjectSchema", () => {
  it("returns a real entry for 'value', with no derived slots, which has one literal numeric slot", () => {
    const schema = getObjectSchema("value");
    expect(schema).toBeDefined();
    expect(resolveDerivedSlots(stubObject("value"), schema?.derivedSlots ?? [])).toEqual([]);
  });

  it("returns a real entry for 'add', with exactly one derived slot: out.result", () => {
    const schema = getObjectSchema("add");
    expect(schema).toBeDefined();
    const derivedSlots = resolveDerivedSlots(stubObject("add"), schema?.derivedSlots ?? []);
    expect(derivedSlots).toHaveLength(1);
    expect(derivedSlots[0]?.path).toEqual(["out", "result"]);
  });

  it("declares 'value's one non-derived slot path, as a single static group", () => {
    expect(getObjectSchema("value")?.nonDerivedSlotPaths).toEqual([{ kind: "static", paths: [["value"]] }]);
  });

  it("declares 'add's two non-derived slot paths (in.a, in.b) as a single static group — NOT out.result, which is derived", () => {
    const groups = getObjectSchema("add")?.nonDerivedSlotPaths;
    expect(groups).toEqual([
      {
        kind: "static",
        paths: [
          ["in", "a"],
          ["in", "b"],
        ],
      },
    ]);
  });

  it("returns undefined for an ObjectType with no schema entry yet", () => {
    expect(getObjectSchema("unbuilt" as GraphObject["type"])).toBeUndefined();
  });

  it("returns a real entry for 'table', the first dynamic slot family, with no derived slots", () => {
    const schema = getObjectSchema("table");
    expect(schema).toBeDefined();
    expect(resolveDerivedSlots(stubObject("table"), schema?.derivedSlots ?? [])).toEqual([]);
  });

  it.each([
    ["polygon", [["sides"], ["radius"], ["origin", "x"], ["origin", "y"], ["rotation"], ...STYLE_PATHS]],
    ["rect", [["origin", "x"], ["origin", "y"], ["width"], ["height"], ...STYLE_PATHS]],
  ] as const)("returns a real entry for '%s', with vertices + the eight shared derived slots, and its own %s parameter paths", (type, paths) => {
    const schema = getObjectSchema(type);
    expect(schema).toBeDefined();
    const derivedSlots = resolveDerivedSlots(stubObject(type), schema?.derivedSlots ?? []);
    expect(derivedSlots).toHaveLength(9);
    expect(derivedSlots.map((slot) => slot.path)).toEqual(
      expect.arrayContaining([
        ["vertices"],
        ["centroid", "x"],
        ["centroid", "y"],
        ["area"],
        ["length"],
        ["bounds", "minX"],
        ["bounds", "minY"],
        ["bounds", "maxX"],
        ["bounds", "maxY"],
      ]),
    );
    expect(resolveNonDerivedSlotPaths({ id: "obj_1", name: "x", type, slots: {} }, schema?.nonDerivedSlotPaths ?? [])).toEqual(paths);
  });

  it("returns a real entry for 'circle' with the same eight measurements and NO vertices slot, because an arc needs no point list", () => {
    const schema = getObjectSchema("circle");
    expect(schema).toBeDefined();
    const derivedSlots = resolveDerivedSlots(stubObject("circle"), schema?.derivedSlots ?? []);
    expect(derivedSlots.map((slot) => slot.path.join("."))).toEqual([
      "centroid.x",
      "centroid.y",
      "area",
      "length",
      "bounds.minX",
      "bounds.minY",
      "bounds.maxX",
      "bounds.maxY",
    ]);
    expect(resolveNonDerivedSlotPaths({ id: "obj_1", name: "x", type: "circle", slots: {} }, schema?.nonDerivedSlotPaths ?? [])).toEqual([
      ["origin", "x"],
      ["origin", "y"],
      ["radius"],
      ...STYLE_PATHS,
    ]);
  });

  it("returns a real entry for 'text', with eleven static non-derived paths (origin.x and origin.y at the front, and `autoresize` where `overflow` used to be) and three derived slots (resolvedContent, measuredHeight, measuredWidth)", () => {
    const schema = getObjectSchema("text");
    expect(schema).toBeDefined();
    expect(resolveNonDerivedSlotPaths({ id: "obj_1", name: "text_1", type: "text", slots: {} }, schema?.nonDerivedSlotPaths ?? [])).toEqual([
      ["origin", "x"],
      ["origin", "y"],
      ["content"],
      ["width"],
      ["height"],
      ["autoresize"],
      ["style", "font"],
      ["style", "fontSize"],
      ["style", "lineHeight"],
      ["style", "color"],
      ["style", "align"],
    ]);
    const textDerivedSlots = resolveDerivedSlots(stubObject("text"), schema?.derivedSlots ?? []);
    expect(textDerivedSlots.map((slot) => slot.path)).toEqual([["resolvedContent"], ["measuredHeight"], ["measuredWidth"]]);
    expect(textDerivedSlots[0]?.dependencies.kind).toBe("dynamic");
    expect(textDerivedSlots[1]?.dependencies).toEqual({
      kind: "static",
      paths: [["resolvedContent"], ["width"], ["style", "font"], ["style", "fontSize"], ["style", "lineHeight"]],
    });
    expect(textDerivedSlots[2]?.dependencies).toEqual(textDerivedSlots[1]?.dependencies);
  });

  it("returns a real entry for 'image', with eight static non-derived paths and NO derived slots", () => {
    const schema = getObjectSchema("image");
    expect(schema).toBeDefined();
    expect(resolveNonDerivedSlotPaths({ id: "obj_1", name: "image_1", type: "image", slots: {} }, schema?.nonDerivedSlotPaths ?? [])).toEqual([
      ["origin", "x"],
      ["origin", "y"],
      ["width"],
      ["height"],
      ["opacity"],
      ["source"],
      ["preserveAspect"],
      ["pictureAspect"],
    ]);
    expect(resolveDerivedSlots(stubObject("image"), schema?.derivedSlots ?? [])).toEqual([]);
    expect(schema?.nonDerivedSlotPaths.every((group) => group.kind === "static")).toBe(true);
  });

  it("returns a real entry for 'script', with two static + two dynamic non-derived groups and one dynamic derived group", () => {
    const schema = getObjectSchema("script");
    expect(schema).toBeDefined();
    const portless: GraphObject = { id: "obj_1", name: "script_1", type: "script", slots: {} };
    expect(resolveNonDerivedSlotPaths(portless, schema?.nonDerivedSlotPaths ?? [])).toEqual([
      ["origin", "x"],
      ["origin", "y"],
      ["language"],
      ["source"],
    ]);
    expect(resolveDerivedSlots(portless, schema?.derivedSlots ?? [])).toEqual([]);

    const wired: GraphObject = { id: "obj_1", name: "script_1", type: "script", slots: {}, ports: { in: ["factor"], out: ["result"] } };
    expect(resolveNonDerivedSlotPaths(wired, schema?.nonDerivedSlotPaths ?? [])).toEqual([
      ["origin", "x"],
      ["origin", "y"],
      ["language"],
      ["source"],
      ["in", "factor"],
      ["placeholder", "result"],
    ]);
    const derivedSlots = resolveDerivedSlots(wired, schema?.derivedSlots ?? []);
    expect(derivedSlots.map((slot) => slot.path)).toEqual([["out", "result"]]);
    expect(derivedSlots[0]?.dependencies.kind).toBe("dynamic");

    expect(schema?.slotOptions).toEqual([{ path: ["language"], values: ["python"] }]);
  });
});

describe("findDerivedSlotSchema", () => {
  it("finds 'add's out.result by path, matching structurally rather than by array reference", () => {
    const freshlyBuiltPath = ["out", "result"];
    const entry = findDerivedSlotSchema(stubObject("add"), freshlyBuiltPath);
    expect(entry).toBeDefined();
    expect(entry?.path).toEqual(["out", "result"]);
  });

  it("returns undefined for a path on 'add' that is NOT a derived slot (in.a is formula, not derived)", () => {
    expect(findDerivedSlotSchema(stubObject("add"), ["in", "a"])).toBeUndefined();
  });

  it("returns undefined for a type with no schema at all", () => {
    expect(findDerivedSlotSchema(stubObject("unbuilt" as GraphObject["type"]), ["centroid", "x"])).toBeUndefined();
  });

  it("returns undefined for 'value', which has no derived slots", () => {
    expect(findDerivedSlotSchema(stubObject("value"), ["value"])).toBeUndefined();
  });
});

function tableObject(id: string, name: string, rows: Value, cols: Value): GraphObject {
  return {
    id,
    name,
    type: "table",
    slots: {
      rows: { kind: "literal", value: rows },
      cols: { kind: "literal", value: cols },
    },
  };
}

describe("resolveNonDerivedSlotPaths — the dynamic-slot-family mechanism", () => {
  it("resolves a single static group to exactly its fixed paths, ignoring the object entirely ('value')", () => {
    const groups = getObjectSchema("value")?.nonDerivedSlotPaths;
    if (groups === undefined) {
      throw new Error("test setup: expected value's schema to exist");
    }
    expect(resolveNonDerivedSlotPaths(tableObject("obj_1", "table_x", 0, 0), groups)).toEqual([["value"]]);
  });

  it("resolves 'add's single static group with two paths, in declared order", () => {
    const groups = getObjectSchema("add")?.nonDerivedSlotPaths;
    if (groups === undefined) {
      throw new Error("test setup: expected add's schema to exist");
    }
    expect(resolveNonDerivedSlotPaths(tableObject("obj_1", "table_x", 0, 0), groups)).toEqual([
      ["in", "a"],
      ["in", "b"],
    ]);
  });

  it("concatenates a static group's fixed paths with a dynamic group's own enumerate(object) result, in declared order", () => {
    const groups: readonly NonDerivedSlotPathGroup[] = [
      { kind: "static", paths: [["fixed", "one"]] },
      { kind: "dynamic", enumerate: (object) => [["dyn", object.id]] },
    ];
    expect(resolveNonDerivedSlotPaths(tableObject("obj_7", "table_x", 0, 0), groups)).toEqual([
      ["fixed", "one"],
      ["dyn", "obj_7"],
    ]);
  });

  it("table's real schema resolves to origin/rows/cols plus every cell path for a 2x3 table, row-major", () => {
    const groups = getObjectSchema("table")?.nonDerivedSlotPaths;
    if (groups === undefined) {
      throw new Error("test setup: expected table's schema to exist");
    }
    const object = tableObject("obj_1", "table_x", 2, 3);
    expect(resolveNonDerivedSlotPaths(object, groups)).toEqual([
      ["origin", "x"],
      ["origin", "y"],
      ["rows"],
      ["cols"],
      ["cells", "A1"],
      ["cells", "B1"],
      ["cells", "C1"],
      ["cells", "A2"],
      ["cells", "B2"],
      ["cells", "C2"],
    ]);
  });

  it("table's cell family is empty when rows/cols are missing entirely — no cell paths, but the four fixed paths still resolve (they are the static group)", () => {
    const object: GraphObject = { id: "obj_1", name: "table_x", type: "table", slots: {} };
    const groups = getObjectSchema("table")?.nonDerivedSlotPaths;
    if (groups === undefined) {
      throw new Error("test setup: expected table's schema to exist");
    }
    expect(resolveNonDerivedSlotPaths(object, groups)).toEqual([["origin", "x"], ["origin", "y"], ["rows"], ["cols"]]);
  });

  it("never throws for a malformed dimension (a string, a negative number, a non-integer)", () => {
    const groups = getObjectSchema("table")?.nonDerivedSlotPaths;
    if (groups === undefined) {
      throw new Error("test setup: expected table's schema to exist");
    }
    const malformed = tableObject("obj_1", "table_x", "not a number", -3);
    expect(() => resolveNonDerivedSlotPaths(malformed, groups)).not.toThrow();
    expect(resolveNonDerivedSlotPaths(malformed, groups)).toEqual([["origin", "x"], ["origin", "y"], ["rows"], ["cols"]]);
  });

  it("does not throw for the 200,004 paths a rows=1000 cols=200 table declares — both counts inside the allowed range", () => {
    const groups = getObjectSchema("table")?.nonDerivedSlotPaths;
    if (groups === undefined) {
      throw new Error("test setup: expected table's schema to exist");
    }
    const wide = tableObject("obj_1", "table_x", 1000, 200);
    expect(() => resolveNonDerivedSlotPaths(wide, groups)).not.toThrow();
    expect(resolveNonDerivedSlotPaths(wide, groups)).toHaveLength(200_004);
  });
});

describe("resolveDerivedSlots — a derived slot family that resolves per object", () => {
  const noopCompute = () => null;

  it("resolves a single static group to exactly its fixed DerivedSlotSchemas, ignoring the object entirely", () => {
    const outResult = getObjectSchema("add")?.derivedSlots;
    if (outResult === undefined) {
      throw new Error("test setup: expected add's schema to exist");
    }
    expect(resolveDerivedSlots(stubObject("value"), outResult).map((slot) => slot.path)).toEqual([["out", "result"]]);
  });

  it("concatenates a static group's fixed slots with a dynamic group's own enumerate(object) result, in declared order", () => {
    const groups = [
      { kind: "static" as const, slots: [{ path: ["fixed"], dependencies: { kind: "static" as const, paths: [] }, compute: noopCompute }] },
      { kind: "dynamic" as const, enumerate: (object: GraphObject) => [{ path: ["dyn", object.id], dependencies: { kind: "static" as const, paths: [] }, compute: noopCompute }] },
    ];
    const resolved = resolveDerivedSlots({ id: "obj_7", name: "script_1", type: "script", slots: {} }, groups);
    expect(resolved.map((slot) => slot.path)).toEqual([["fixed"], ["dyn", "obj_7"]]);
  });

  it("resolves a dynamic group against the object's OWN structural state (ports.out), not against Object.keys(object.slots)", () => {
    const groups = [
      {
        kind: "dynamic" as const,
        enumerate: (object: GraphObject) =>
          (object.ports?.out ?? []).map((name) => ({ path: ["out", name], dependencies: { kind: "static" as const, paths: [] }, compute: noopCompute })),
      },
    ];
    const script: GraphObject = { id: "obj_1", name: "script_1", type: "script", slots: { "out.result": { kind: "derived", value: null } }, ports: { in: [], out: ["result", "extra"] } };
    expect(resolveDerivedSlots(script, groups).map((slot) => slot.path)).toEqual([["out", "result"], ["out", "extra"]]);
  });

  it("returns an empty list for an empty groups array", () => {
    expect(resolveDerivedSlots(stubObject("value"), [])).toEqual([]);
  });
});

describe("derivedSlotDependencyAddresses", () => {
  const addObject: GraphObject = {
    id: "obj_2",
    name: "add_1",
    type: "add",
    slots: {
      "in.a": { kind: "literal", value: 10 },
      "in.b": { kind: "literal", value: 5 },
      "out.result": { kind: "derived", value: 15 },
    },
  };

  it("pairs each static dependency path with the object's own id, because a static dependency stays within the same object", () => {
    const outResult = resolveDerivedSlots(stubObject("add"), getObjectSchema("add")?.derivedSlots ?? [])[0];
    if (outResult === undefined) {
      throw new Error("test setup: expected add's out.result schema entry to exist");
    }
    const addresses = derivedSlotDependencyAddresses(addObject, outResult.dependencies);
    expect(addresses).toEqual([
      { objectId: "obj_2", path: ["in", "a"] },
      { objectId: "obj_2", path: ["in", "b"] },
    ] satisfies readonly Address[]);
  });

  it("calls the resolver against the object's current state for a dynamic dependency, without touching the same-object pairing path", () => {
    const dynamicDependency: DerivedSlotDependencies = {
      kind: "dynamic",
      resolve: (object) => [{ objectId: "elsewhere_obj", path: [object.type, "whatever"] }],
    };
    const addresses = derivedSlotDependencyAddresses(addObject, dynamicDependency);
    expect(addresses).toEqual([{ objectId: "elsewhere_obj", path: ["add", "whatever"] }]);
  });

  it("forwards the document object list to a dynamic resolver that needs it (0127 — `text.resolvedContent`)", () => {
    const seen: string[][] = [];
    const dynamicDependency: DerivedSlotDependencies = {
      kind: "dynamic",
      resolve: (_object, objects) => {
        seen.push(objects.map((o) => o.id));
        return [];
      },
    };
    const otherObject: GraphObject = { id: "obj_other", name: "other", type: "value", slots: {} };
    derivedSlotDependencyAddresses(addObject, dynamicDependency, [addObject, otherObject]);
    expect(seen).toEqual([["obj_2", "obj_other"]]);
  });
});

describe("add's out.result compute function", () => {
  const computeAdd = resolveDerivedSlots(stubObject("add"), getObjectSchema("add")?.derivedSlots ?? [])[0]?.compute;
  if (computeAdd === undefined) {
    throw new Error("test setup: expected add's out.result schema entry to exist");
  }

  const addObject: GraphObject = {
    id: "obj_2",
    name: "add_1",
    type: "add",
    slots: {
      "in.a": { kind: "literal", value: 10 },
      "in.b": { kind: "literal", value: 5 },
      "out.result": { kind: "derived", value: 0 },
    },
  };

  function readFrom(values: Record<string, Value>) {
    return (address: Address): Value | undefined => values[address.path.join(".")];
  }

  it("sums two numeric inputs", () => {
    const result = computeAdd(addObject, readFrom({ "in.a": 10, "in.b": 5 }));
    expect(result).toBe(15);
  });

  it("propagates an ErrorValue from in.a unchanged, rather than manufacturing a new error, because an error propagates", () => {
    const upstreamError = { error: "#DIV0", message: "upstream division by zero" } as const;
    const result = computeAdd(addObject, readFrom({ "in.a": upstreamError, "in.b": 5 }));
    expect(result).toEqual(upstreamError);
  });

  it("propagates an ErrorValue from in.b unchanged when in.a is fine", () => {
    const upstreamError = { error: "#PARSE", message: "upstream parse error" } as const;
    const result = computeAdd(addObject, readFrom({ "in.a": 10, "in.b": upstreamError }));
    expect(result).toEqual(upstreamError);
  });

  it("returns #TYPE, never throws, when an input is a non-error non-number value", () => {
    const result = computeAdd(addObject, readFrom({ "in.a": "not a number", "in.b": 5 }));
    expect(result).toMatchObject({ error: "#TYPE" });
  });

  it("returns #TYPE for a boolean input", () => {
    const result = computeAdd(addObject, readFrom({ "in.a": true, "in.b": 5 }));
    expect(result).toMatchObject({ error: "#TYPE" });
  });

  it("returns #REF, never throws, when a dependency did not resolve at all (read returns undefined)", () => {
    const result = computeAdd(addObject, readFrom({ "in.a": 10 }));
    expect(result).toMatchObject({ error: "#REF" });
  });

  it("returns #TYPE for a null input, rather than coercing it to zero", () => {
    const result = computeAdd(addObject, readFrom({ "in.a": null, "in.b": 5 }));
    expect(result).toMatchObject({ error: "#TYPE" });
  });

  it("never throws for any of the above inputs", () => {
    expect(() => computeAdd(addObject, readFrom({}))).not.toThrow();
    expect(() => computeAdd(addObject, readFrom({ "in.a": null, "in.b": null }))).not.toThrow();
  });

  it("returns #TYPE, never a raw Infinity, when two finite inputs sum to a non-finite result", () => {
    const result = computeAdd(addObject, readFrom({ "in.a": Number.MAX_VALUE, "in.b": Number.MAX_VALUE }));
    expect(result).toMatchObject({ error: "#TYPE" });
    expect(result).not.toBe(Number.POSITIVE_INFINITY);
  });

  it("does NOT reject a large but still-finite sum", () => {
    const result = computeAdd(addObject, readFrom({ "in.a": Number.MAX_VALUE, "in.b": 1 }));
    expect(result).toBe(Number.MAX_VALUE + 1);
    expect(Number.isFinite(result as number)).toBe(true);
  });
});
