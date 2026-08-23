/**
 * schema.test.ts — Tests for the derived-slot declaration mechanism (§5.1).
 *
 * Colocated with schema.ts per D-001. Phase 0 does not yet have graph/eval.ts,
 * so these tests exercise the schema mechanism directly — calling a declared
 * `compute` function by hand with a fake `read`, rather than through a real
 * topological evaluation pass, which does not exist yet.
 */
import { describe, expect, it } from "vitest";
import type { Address } from "../address.ts";
import type { GraphObject, Value } from "../graph/node.ts";
import {
  derivedSlotDependencyAddresses,
  findDerivedSlotSchema,
  getObjectSchema,
  type DerivedSlotDependencies,
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

  // nonDerivedSlotPaths added this cycle (mutation.ts's deriveEdges) — the
  // full set of paths a type's literal/formula slots occupy, PATHS only (see
  // schema.ts's header: not a default-kind declaration).
  it("declares 'value's one non-derived slot path", () => {
    expect(getObjectSchema("value")?.nonDerivedSlotPaths).toEqual([["value"]]);
  });

  it("declares 'add's two non-derived slot paths (in.a, in.b) — NOT out.result, which is derived", () => {
    const paths = getObjectSchema("add")?.nonDerivedSlotPaths;
    expect(paths).toEqual([
      ["in", "a"],
      ["in", "b"],
    ]);
  });

  // D-008's lesson: test the unspecified cases, not just the brief's examples.
  // Every non-fixture ObjectType has no schema yet (file header) — this must be
  // an honest `undefined`, not a placeholder that would silently pass a future
  // validation check.
  it("returns undefined for an ObjectType with no schema entry yet", () => {
    expect(getObjectSchema("circle")).toBeUndefined();
    expect(getObjectSchema("polygon")).toBeUndefined();
    expect(getObjectSchema("table")).toBeUndefined();
    expect(getObjectSchema("script")).toBeUndefined();
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
    expect(findDerivedSlotSchema("circle", ["centroid", "x"])).toBeUndefined();
  });

  it("returns undefined for 'value', which has no derived slots", () => {
    expect(findDerivedSlotSchema("value", ["value"])).toBeUndefined();
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
});

describe("add's out.result compute function", () => {
  // graph/eval.ts does not exist yet — these tests call `compute` directly with
  // a fake `read`, standing in for "this slot's dependencies already evaluated
  // earlier in the same topological pass" (§5.1).
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
