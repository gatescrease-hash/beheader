/**
 * eval.test.ts — Tests for naive full topological evaluation (§5.1 step 7).
 *
 * Colocated with eval.ts per D-001. `mutation.ts` does not exist yet, so these
 * tests build `GraphObject[]`/`Edge[]` fixtures by hand — exactly what
 * mutation.ts step 3 would eventually derive — rather than deriving them from
 * real formula ASTs or schema declarations end-to-end.
 */
import { describe, expect, it } from "vitest";
import type { Address } from "../address.ts";
import type { GraphObject, Slot } from "./node.ts";
import { addressKey, type Edge } from "./edge.ts";
import { evaluate } from "./eval.ts";

/** A short-hand for building an Address in every test below (matches graph/cycles.test.ts's convention). */
function addr(objectId: string, ...path: readonly string[]): Address {
  return { objectId, path };
}

/** A short-hand for building an Edge from two addr() calls. */
function edge(source: Address, dependent: Address): Edge {
  return { sourceSlot: source, dependentSlot: dependent };
}

/** PROJECT_BRIEF §6's 'value' fixture: one literal numeric slot. */
function valueObject(id: string, name: string, value: number): GraphObject {
  return { id, name, type: "value", slots: { value: { kind: "literal", value } } };
}

/**
 * PROJECT_BRIEF §6's 'add' fixture: two formula (binding) input slots, one
 * derived output slot. `aRef`/`bRef` are the addresses `in.a`/`in.b` bind to —
 * the caller is responsible for also supplying the matching edges.
 */
function addObject(id: string, name: string, aRef: Address, bRef: Address): GraphObject {
  const slots: Record<string, Slot> = {
    "in.a": { kind: "formula", ast: { type: "reference", address: aRef }, value: null },
    "in.b": { kind: "formula", ast: { type: "reference", address: bRef }, value: null },
    "out.result": { kind: "derived", value: null },
  };
  return { id, name, type: "add", slots };
}

/** The four edges a fully-wired `addObject` needs: both bindings, and both static dependencies of out.result. */
function addObjectEdges(addId: string, aRef: Address, bRef: Address): Edge[] {
  return [
    edge(aRef, addr(addId, "in", "a")),
    edge(bRef, addr(addId, "in", "b")),
    edge(addr(addId, "in", "a"), addr(addId, "out", "result")),
    edge(addr(addId, "in", "b"), addr(addId, "out", "result")),
  ];
}

function objectById(objects: readonly GraphObject[], id: string): GraphObject {
  const found = objects.find((object) => object.id === id);
  if (found === undefined) {
    throw new Error(`test setup: expected object "${id}" in result`);
  }
  return found;
}

describe("evaluate — PROJECT_BRIEF §6's value/add fixture", () => {
  it("propagates a literal through two formula bindings into a derived slot", () => {
    const objects = [
      valueObject("obj_1", "value_1", 10),
      valueObject("obj_2", "value_2", 5),
      addObject("obj_3", "add_1", addr("obj_1", "value"), addr("obj_2", "value")),
    ];
    const edges = addObjectEdges("obj_3", addr("obj_1", "value"), addr("obj_2", "value"));

    const result = evaluate(objects, edges);
    const add1 = objectById(result, "obj_3");

    expect(add1.slots["in.a"]).toMatchObject({ kind: "formula", value: 10 });
    expect(add1.slots["in.b"]).toMatchObject({ kind: "formula", value: 5 });
    expect(add1.slots["out.result"]).toEqual({ kind: "derived", value: 15 });
  });

  it("re-propagates from scratch when a literal changes — no state retained between calls (Rule 5)", () => {
    const edges = addObjectEdges("obj_3", addr("obj_1", "value"), addr("obj_2", "value"));
    const before = evaluate(
      [valueObject("obj_1", "value_1", 10), valueObject("obj_2", "value_2", 5), addObject("obj_3", "add_1", addr("obj_1", "value"), addr("obj_2", "value"))],
      edges,
    );
    expect(objectById(before, "obj_3").slots["out.result"]).toEqual({ kind: "derived", value: 15 });

    // Same edges, only value_1's literal changed — a fresh call, not an
    // incremental update, must reflect it (Rule 5: full re-evaluation).
    const after = evaluate(
      [valueObject("obj_1", "value_1", 20), valueObject("obj_2", "value_2", 5), addObject("obj_3", "add_1", addr("obj_1", "value"), addr("obj_2", "value"))],
      edges,
    );
    expect(objectById(after, "obj_3").slots["out.result"]).toEqual({ kind: "derived", value: 25 });
  });
});

describe("evaluate — derived slots are evaluated INSIDE the same pass, not a separate post-pass", () => {
  it("propagates literal -> formula -> derived -> formula -> derived across two objects in one call", () => {
    // add_1.out.result (derived) feeds add_2.in.a (formula, on a DIFFERENT
    // object). This can only produce the right answer if add_1.out.result is
    // evaluated before add_2.in.a is read — i.e. derived slots participate in
    // THIS topological pass rather than needing a second one (§5.1, PROCESS_BRIEF §9).
    const objects = [
      valueObject("obj_1", "value_1", 3),
      valueObject("obj_2", "value_2", 4),
      addObject("obj_3", "add_1", addr("obj_1", "value"), addr("obj_2", "value")),
      valueObject("obj_4", "value_3", 1),
      addObject("obj_5", "add_2", addr("obj_3", "out", "result"), addr("obj_4", "value")),
    ];
    const edges = [
      ...addObjectEdges("obj_3", addr("obj_1", "value"), addr("obj_2", "value")),
      ...addObjectEdges("obj_5", addr("obj_3", "out", "result"), addr("obj_4", "value")),
    ];

    const result = evaluate(objects, edges);

    expect(objectById(result, "obj_3").slots["out.result"]).toEqual({ kind: "derived", value: 7 });
    expect(objectById(result, "obj_5").slots["in.a"]).toMatchObject({ kind: "formula", value: 7 });
    expect(objectById(result, "obj_5").slots["out.result"]).toEqual({ kind: "derived", value: 8 });
  });
});

describe("evaluate — Rule 6: the slot SET never changes", () => {
  it("returns objects whose slot keys exactly match the input's, for every object", () => {
    const objects = [
      valueObject("obj_1", "value_1", 10),
      valueObject("obj_2", "value_2", 5),
      addObject("obj_3", "add_1", addr("obj_1", "value"), addr("obj_2", "value")),
    ];
    const edges = addObjectEdges("obj_3", addr("obj_1", "value"), addr("obj_2", "value"));

    const result = evaluate(objects, edges);

    for (const before of objects) {
      const after = objectById(result, before.id);
      expect(Object.keys(after.slots).sort()).toEqual(Object.keys(before.slots).sort());
    }
  });
});

describe("evaluate — literal slots", () => {
  it("passes an isolated literal (no edges at all) through unchanged, by reference", () => {
    const object = valueObject("obj_1", "value_1", 42);
    const result = evaluate([object], []);
    expect(result[0]?.slots.value).toBe(object.slots.value); // same reference — literals never recompute.
  });
});

describe("evaluate — dangling formula reference", () => {
  it("evaluates to #REF rather than throwing, when the referenced address never resolves in this pass", () => {
    const objects = [
      valueObject("obj_2", "value_2", 5),
      addObject("obj_3", "add_1", addr("obj_999", "value"), addr("obj_2", "value")),
    ];
    // No edge feeds obj_999.value -> add_1.in.a: it does not exist anywhere in
    // `objects`, so it is never evaluated in this pass.
    const edges: Edge[] = [
      edge(addr("obj_2", "value"), addr("obj_3", "in", "b")),
      edge(addr("obj_3", "in", "a"), addr("obj_3", "out", "result")),
      edge(addr("obj_3", "in", "b"), addr("obj_3", "out", "result")),
    ];

    expect(() => evaluate(objects, edges)).not.toThrow();
    const result = evaluate(objects, edges);
    const add1 = objectById(result, "obj_3");
    expect(add1.slots["in.a"]).toMatchObject({ kind: "formula", value: { error: "#REF" } });
    // §5.1: errors propagate — out.result reads the #REF in.a produced.
    expect(add1.slots["out.result"]).toMatchObject({ kind: "derived", value: { error: "#REF" } });
  });
});

describe("evaluate — D-013: a derived slot's compute function may read ONLY its declared dependencies", () => {
  it("gets #REF, not the real value, for an address the given edges do not declare as a dependency of that slot", () => {
    // add_1 is fully wired (both in.a/in.b resolve to real numbers), but the
    // edge set deliberately OMITS in.b -> out.result — simulating an
    // under-declared dependency set. add's own compute function
    // unconditionally reads in.b regardless; D-013 must intercept that read.
    const objects = [
      valueObject("obj_1", "value_1", 10),
      valueObject("obj_2", "value_2", 5),
      addObject("obj_3", "add_1", addr("obj_1", "value"), addr("obj_2", "value")),
    ];
    const edges: Edge[] = [
      edge(addr("obj_1", "value"), addr("obj_3", "in", "a")),
      edge(addr("obj_2", "value"), addr("obj_3", "in", "b")),
      edge(addr("obj_3", "in", "a"), addr("obj_3", "out", "result")), // in.b -> out.result deliberately missing
    ];

    const result = evaluate(objects, edges);
    const add1 = objectById(result, "obj_3");

    // in.b itself still resolves fine — the violation is scoped to out.result's read of it.
    expect(add1.slots["in.b"]).toMatchObject({ kind: "formula", value: 5 });
    expect(add1.slots["out.result"]).toMatchObject({ kind: "derived", value: { error: "#REF" } });
  });
});

describe("evaluate — a derived-kind slot with no matching schema entry", () => {
  it("evaluates to #REF rather than throwing or indexing into undefined", () => {
    // 'value' objects have an empty derivedSlots list (schema.ts) — this
    // constructs a malformed fixture (a slot marked 'derived' that no schema
    // entry declares) to check the defensive fallback, not a realistic
    // mutation.ts-produced document.
    const malformed: GraphObject = {
      id: "obj_1",
      name: "value_1",
      type: "value",
      slots: { value: { kind: "derived", value: null } },
    };

    expect(() => evaluate([malformed], [])).not.toThrow();
    const result = evaluate([malformed], []);
    expect(result[0]?.slots.value).toMatchObject({ kind: "derived", value: { error: "#REF" } });
  });
});

describe("evaluate — addressKey consistency", () => {
  it("keys its internal bookkeeping the same way addressKey does, for every slot on every object", () => {
    // Not testing a public contract directly — this documents WHY eval.ts never
    // needs to decompose a GraphObject.slots key back into a path array: the
    // key already matches addressKey's own format bit-for-bit.
    const object = valueObject("obj_7", "value_7", 1);
    const key = Object.keys(object.slots)[0];
    expect(key).toBeDefined();
    expect(`${object.id}::${key}`).toBe(addressKey(addr("obj_7", "value")));
  });
});
