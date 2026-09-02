/**
 * schema.test.ts — Tests for the derived-slot declaration mechanism (§5.1).
 *
 * Colocated with schema.ts per D-001. These tests exercise the schema mechanism
 * DIRECTLY — calling a declared `compute` function by hand with a fake `read` —
 * so a compute function's own contract is pinned in isolation from evaluation
 * order. `graph/eval.test.ts` and `mutation.test.ts` own the other claim, that
 * the same functions run inside the real topological pass.
 */
import { describe, expect, it } from "vitest";
import type { Address } from "../address.ts";
import type { GraphObject, Value } from "../graph/node.ts";
import {
  derivedSlotDependencyAddresses,
  findDerivedSlotSchema,
  getObjectSchema,
  resolveNonDerivedSlotPaths,
  type DerivedSlotDependencies,
  type NonDerivedSlotPathGroup,
} from "./schema.ts";

describe("getObjectSchema", () => {
  it("returns a real entry for 'value', with no derived slots (§6: one literal numeric slot)", () => {
    const schema = getObjectSchema("value");
    expect(schema).toBeDefined();
    expect(schema?.derivedSlots).toEqual([]);
  });

  it("returns a real entry for 'add', with exactly one derived slot: out.result", () => {
    const schema = getObjectSchema("add");
    expect(schema).toBeDefined();
    expect(schema?.derivedSlots).toHaveLength(1);
    expect(schema?.derivedSlots[0]?.path).toEqual(["out", "result"]);
  });

  // nonDerivedSlotPaths (mutation.ts's deriveEdges) is the full set of PATH
  // GROUPS a type's literal/formula slots occupy — widened this cycle from a
  // bare path array to `NonDerivedSlotPathGroup[]` (static | dynamic) so a
  // table's cells family can be expressed (D-017). `value`/`add` still
  // declare a single `static` group each, resolved via
  // `resolveNonDerivedSlotPaths` in the describe block below.
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

  // D-008's lesson: test the unspecified cases, not just the brief's examples.
  // A not-yet-built ObjectType must be an honest `undefined`, not a placeholder
  // that would silently pass a future validation check. `table`/`circle`/
  // `polygon`/`rect`/`text` have real entries (their own describe blocks below);
  // `polyline`/`script`/`image` are the remaining unregistered types. Narrowed
  // at entry 0059, `text` added at 0127 — PROCESS_BRIEF §6.1 trigger 5.
  it("returns undefined for an ObjectType with no schema entry yet", () => {
    expect(getObjectSchema("polyline")).toBeUndefined();
    expect(getObjectSchema("script")).toBeUndefined();
    expect(getObjectSchema("image")).toBeUndefined();
  });

  it("returns a real entry for 'table' (D-017's dynamic-slot-family mechanism), with no derived slots", () => {
    const schema = getObjectSchema("table");
    expect(schema).toBeDefined();
    expect(schema?.derivedSlots).toEqual([]);
  });

  // primitives/geometry.ts's own file owns the compute-function behaviour;
  // this only confirms the registry wiring — nine derived slots each
  // (`vertices` plus the eight `verticesDerivedSlots` shares across every
  // closed preset), and the right non-derived parameter paths per §5.5.
  it.each([
    ["circle", [["origin", "x"], ["origin", "y"], ["radius"]]],
    ["polygon", [["sides"], ["radius"], ["origin", "x"], ["origin", "y"], ["rotation"]]],
    ["rect", [["origin", "x"], ["origin", "y"], ["width"], ["height"]]],
  ] as const)("returns a real entry for '%s', with vertices + the eight shared derived slots, and its own %s parameter paths", (type, paths) => {
    const schema = getObjectSchema(type);
    expect(schema).toBeDefined();
    expect(schema?.derivedSlots).toHaveLength(9);
    expect(schema?.derivedSlots.map((slot) => slot.path)).toEqual(
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

  // primitives/text.ts owns the resolver/compute behaviour (its own test file);
  // this only confirms the §5.6 registry wiring — resolvedContent at entry 0127,
  // measuredHeight added at 0129.
  it("returns a real entry for 'text' (§5.6), with eleven static non-derived paths (origin.x/y at front per D-121) and two derived slots (resolvedContent, measuredHeight)", () => {
    const schema = getObjectSchema("text");
    expect(schema).toBeDefined();
    expect(resolveNonDerivedSlotPaths({ id: "obj_1", name: "text_1", type: "text", slots: {} }, schema?.nonDerivedSlotPaths ?? [])).toEqual([
      // D-121 (Q-022): a text object's position is two ordinary literal slots,
      // the same ORIGIN_X_PATH/ORIGIN_Y_PATH spelling every positioned object uses.
      ["origin", "x"],
      ["origin", "y"],
      ["content"],
      ["width"],
      ["height"],
      ["overflow"],
      ["style", "font"],
      ["style", "fontSize"],
      ["style", "lineHeight"],
      ["style", "color"],
      ["style", "align"],
    ]);
    expect(schema?.derivedSlots.map((slot) => slot.path)).toEqual([["resolvedContent"], ["measuredHeight"]]);
    // resolvedContent's deps are `dynamic` (parsed content); measuredHeight's are
    // `static` (§5.6: resolvedContent + width + the size-relevant style fields).
    expect(schema?.derivedSlots[0]?.dependencies.kind).toBe("dynamic");
    expect(schema?.derivedSlots[1]?.dependencies).toEqual({
      kind: "static",
      paths: [["resolvedContent"], ["width"], ["style", "font"], ["style", "fontSize"], ["style", "lineHeight"]],
    });
  });
});

describe("findDerivedSlotSchema", () => {
  it("finds 'add's out.result by path, matching structurally rather than by array reference (D-010)", () => {
    const freshlyBuiltPath = ["out", "result"]; // deliberately not the schema's own array instance
    const entry = findDerivedSlotSchema("add", freshlyBuiltPath);
    expect(entry).toBeDefined();
    expect(entry?.path).toEqual(["out", "result"]);
  });

  it("returns undefined for a path on 'add' that is NOT a derived slot (in.a is formula, not derived)", () => {
    expect(findDerivedSlotSchema("add", ["in", "a"])).toBeUndefined();
  });

  it("returns undefined for a type with no schema at all", () => {
    // "polyline" is the example type with no schema entry at all;
    // circle/polygon/rect all have real ones (the describe block below).
    // Switched from "circle" at entry 0059.
    expect(findDerivedSlotSchema("polyline", ["centroid", "x"])).toBeUndefined();
  });

  it("returns undefined for 'value', which has no derived slots", () => {
    expect(findDerivedSlotSchema("value", ["value"])).toBeUndefined();
  });
});

/** A bare table GraphObject with only its two dimension slots (rows/cols) — no origin, no cells. Both absences are legal: an absent non-derived slot at a declared path is tolerated (mutation.ts's findSchemaSlotKindMismatches). */
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

describe("resolveNonDerivedSlotPaths — the dynamic-slot-family mechanism (D-017/0041-REVIEW-phase2 §9)", () => {
  it("resolves a single static group to exactly its fixed paths, ignoring the object entirely ('value')", () => {
    const groups = getObjectSchema("value")?.nonDerivedSlotPaths;
    if (groups === undefined) {
      throw new Error("test setup: expected value's schema to exist");
    }
    // The object shape is irrelevant to a static group — pass a table object
    // to prove resolution does not secretly depend on matching object.type.
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
    // Both dimensions read as 0 (readTableDimension's own fail-safe) — no cell paths, only the four fixed ones.
    expect(resolveNonDerivedSlotPaths(malformed, groups)).toEqual([["origin", "x"], ["origin", "y"], ["rows"], ["cols"]]);
  });

  it("does not throw for the 200,004 paths a rows=1000 cols=200 table declares — both counts inside D-070's range (D-077)", () => {
    const groups = getObjectSchema("table")?.nonDerivedSlotPaths;
    if (groups === undefined) {
      throw new Error("test setup: expected table's schema to exist");
    }
    // A dynamic family's size is DOCUMENT STATE, so this function's "never throws"
    // claim holds only while it appends one path at a time: `push(...enumerate())`
    // passes the whole family as arguments and dies of RangeError somewhere above
    // 90,000 paths (0078-REVIEW measured it), which one typed `table` line reaches.
    const wide = tableObject("obj_1", "table_x", 1000, 200);
    expect(() => resolveNonDerivedSlotPaths(wide, groups)).not.toThrow();
    expect(resolveNonDerivedSlotPaths(wide, groups)).toHaveLength(200_004);
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

  it("pairs each static dependency path with the object's own id (§5.1: 'within the same object')", () => {
    const outResult = getObjectSchema("add")?.derivedSlots[0];
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
  // These tests call `compute` directly with a fake `read` standing in for "this
  // slot's dependencies already evaluated earlier in the same topological pass"
  // (§5.1), so a wrong answer here is the compute function's rather than
  // `graph/eval.ts`'s ordering.
  const computeAdd = getObjectSchema("add")?.derivedSlots[0]?.compute;
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

  it("propagates an ErrorValue from in.a unchanged, rather than manufacturing a new error (§5.1: errors propagate)", () => {
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
    const result = computeAdd(addObject, readFrom({ "in.a": 10 })); // in.b missing entirely
    expect(result).toMatchObject({ error: "#REF" });
  });

  // Pinned at 0008-REVIEW in answer to entry 0007's Q2. `null` is a member of
  // Value, and `typeof null === "object"`, so it reaches the #TYPE branch rather
  // than the error or #REF branches. That is the correct fail-closed answer for
  // an arithmetic node and is asserted here so it is pinned behaviour rather
  // than an accident of branch order. Deliberately NOT the spreadsheet
  // "blank counts as 0" convention — `add` is a Phase 0 fixture (§6), not a
  // product primitive, so it has no user-facing blank-cell semantics to match.
  it("returns #TYPE for a null input, rather than coercing it to zero", () => {
    const result = computeAdd(addObject, readFrom({ "in.a": null, "in.b": 5 }));
    expect(result).toMatchObject({ error: "#TYPE" });
  });

  it("never throws for any of the above inputs", () => {
    expect(() => computeAdd(addObject, readFrom({}))).not.toThrow();
    expect(() => computeAdd(addObject, readFrom({ "in.a": null, "in.b": null }))).not.toThrow();
  });

  // D-025 (Q-006, cycle 0023): non-finite numbers are not legal document
  // state. Two finite numeric inputs whose SUM overflows must fail closed the
  // same way a wrong-shaped input already does — #TYPE, never a committed
  // Infinity/NaN — rather than silently returning a non-finite `Value`.
  it("returns #TYPE, never a raw Infinity, when two finite inputs sum to a non-finite result (D-025)", () => {
    const result = computeAdd(addObject, readFrom({ "in.a": Number.MAX_VALUE, "in.b": Number.MAX_VALUE }));
    expect(result).toMatchObject({ error: "#TYPE" });
    expect(result).not.toBe(Number.POSITIVE_INFINITY);
  });

  it("does NOT reject a large but still-finite sum", () => {
    const result = computeAdd(addObject, readFrom({ "in.a": Number.MAX_VALUE, "in.b": 1 }));
    expect(result).toBe(Number.MAX_VALUE + 1); // still finite — Number.MAX_VALUE dwarfs +1 but doesn't overflow
    expect(Number.isFinite(result as number)).toBe(true);
  });
});
