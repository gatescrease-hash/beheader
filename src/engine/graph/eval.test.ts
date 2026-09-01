/**
 * eval.test.ts — Tests for naive full topological evaluation (§5.1 step 7).
 *
 * Colocated with eval.ts per D-001. These tests build `GraphObject[]`/`Edge[]`
 * fixtures by hand — exactly what `mutation.ts` step 3 derives — rather than
 * going through real formula ASTs or schema declarations end-to-end, so they
 * exercise the topological pass itself and nothing upstream of it.
 */
import { describe, expect, it } from "vitest";
import type { Address } from "../address.ts";
import { NULL_EVAL_CONTEXT, type EvalContext } from "../eval-context.ts";
import type { GraphObject, Slot, Value } from "./node.ts";
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

describe("evaluate — L-13: a stale edge whose dependentSlot has no corresponding slot on the object", () => {
  it("skips it rather than throwing, for the exact shape D-018 makes mutation.ts's validateIntegrity reject before this file ever sees it", () => {
    // add_1 with no out.result slot at all — precisely what a §5.11 load
    // produces before D-018's fix (0018-REVIEW-phase0), and precisely what
    // mutation.ts's validateIntegrity now rejects before evaluate() is ever
    // reached (see mutation.test.ts's D-018 tests). Pinned here directly,
    // calling evaluate() straight past that gate with hand-built edges (this
    // file does not import mutation.ts), so this defensive branch (0014-
    // REVIEW-phase0 constraint 8, "pin L-13 once step 4 exists") stays
    // covered even though the real §5.1 pipeline no longer reaches it.
    const missingDerivedSlot: GraphObject = {
      id: "obj_3",
      name: "add_1",
      type: "add",
      slots: {
        "in.a": { kind: "formula", ast: { type: "reference", address: addr("obj_1", "value") }, value: null },
        "in.b": { kind: "formula", ast: { type: "reference", address: addr("obj_1", "value") }, value: null },
        // out.result entirely absent.
      },
    };
    const objects = [valueObject("obj_1", "value_1", 3), missingDerivedSlot];
    // Both of add_1's dependency edges into out.result, exactly as
    // mutation.ts's deriveEdges would still emit them (schema-driven,
    // independent of whether the object actually carries the slot).
    const edges: Edge[] = [
      edge(addr("obj_1", "value"), addr("obj_3", "in", "a")),
      edge(addr("obj_1", "value"), addr("obj_3", "in", "b")),
      edge(addr("obj_3", "in", "a"), addr("obj_3", "out", "result")),
      edge(addr("obj_3", "in", "b"), addr("obj_3", "out", "result")),
    ];

    expect(() => evaluate(objects, edges)).not.toThrow();
    const result = evaluate(objects, edges);
    // Rule 6 upheld even here: no slot was manufactured — add_1 still has
    // exactly its original two slots.
    expect(Object.keys(objectById(result, "obj_3").slots).sort()).toEqual(["in.a", "in.b"]);
  });
});

describe("evaluate — a formula slot whose AST is not a ReferenceNode (Q-005's widening; wired for real THIS cycle, D-036)", () => {
  it("evaluates a LiteralNode formula for real — no #PARSE placeholder any more", () => {
    const literalFormula: GraphObject = {
      id: "obj_1",
      name: "value_1",
      type: "value",
      slots: { value: { kind: "formula", ast: { type: "literal", value: 42 }, value: null } },
    };

    expect(() => evaluate([literalFormula], [])).not.toThrow();
    const result = evaluate([literalFormula], []);
    expect(result[0]?.slots.value).toEqual({ kind: "formula", ast: { type: "literal", value: 42 }, value: 42 });
  });

  it("evaluates a binaryOp formula that references another slot, correctly ordered by the edge deriveEdges would have produced", () => {
    const objects: GraphObject[] = [
      valueObject("obj_1", "value_1", 10),
      {
        id: "obj_2",
        name: "value_2",
        type: "value",
        slots: {
          value: {
            kind: "formula",
            ast: { type: "binaryOp", operator: "+", left: { type: "reference", address: addr("obj_1", "value") }, right: { type: "literal", value: 5 } },
            value: null,
          },
        },
      },
    ];
    const edges: Edge[] = [edge(addr("obj_1", "value"), addr("obj_2", "value"))];

    const result = evaluate(objects, edges);
    expect(objectById(result, "obj_2").slots.value).toMatchObject({ value: 15 });
  });

  it("evaluates a functionCall formula (SUM over plain scalar references)", () => {
    const objects: GraphObject[] = [
      valueObject("obj_1", "value_1", 1),
      valueObject("obj_2", "value_2", 2),
      {
        id: "obj_3",
        name: "value_3",
        type: "value",
        slots: {
          value: {
            kind: "formula",
            ast: {
              type: "functionCall",
              name: "SUM",
              args: [
                { type: "reference", address: addr("obj_1", "value") },
                { type: "reference", address: addr("obj_2", "value") },
              ],
            },
            value: null,
          },
        },
      },
    ];
    const edges: Edge[] = [edge(addr("obj_1", "value"), addr("obj_3", "value")), edge(addr("obj_2", "value"), addr("obj_3", "value"))];

    const result = evaluate(objects, edges);
    expect(objectById(result, "obj_3").slots.value).toMatchObject({ value: 3 });
  });

  it("an ErrorNode (D-028) evaluates to its #REF ErrorValue, still never throwing", () => {
    const errorFormula: GraphObject = {
      id: "obj_1",
      name: "value_1",
      type: "value",
      slots: { value: { kind: "formula", ast: { type: "error", error: "#REF" }, value: null } },
    };
    const result = evaluate([errorFormula], []);
    expect(result[0]?.slots.value).toMatchObject({ value: { error: "#REF" } });
  });
});

describe("evaluate — a range inside an aggregate call, expanded through the readRange wiring THIS cycle built (D-036/D-044)", () => {
  /** A table object with `rows`/`cols` literal slots and a literal value at every one of the given cells. */
  function tableObject(id: string, name: string, rows: number, cols: number, cellValues: Record<string, number>): GraphObject {
    const slots: Record<string, Slot> = {
      rows: { kind: "literal", value: rows },
      cols: { kind: "literal", value: cols },
    };
    for (const [ref, value] of Object.entries(cellValues)) {
      slots[`cells.${ref}`] = { kind: "literal", value };
    }
    return { id, name, type: "table", slots };
  }

  it("SUM(A1:B2) over a 2x2 table sums exactly those four cells", () => {
    const table = tableObject("obj_1", "table_x", 2, 2, { A1: 1, B1: 2, A2: 3, B2: 4 });
    const sumFormula: GraphObject = {
      id: "obj_2",
      name: "value_1",
      type: "value",
      slots: {
        value: {
          kind: "formula",
          ast: { type: "functionCall", name: "SUM", args: [{ type: "range", start: addr("obj_1", "cells", "A1"), end: addr("obj_1", "cells", "B2") }] },
          value: null,
        },
      },
    };
    // The edges deriveEdges would derive: every cell in the range feeds the formula slot.
    const edges: Edge[] = [
      edge(addr("obj_1", "cells", "A1"), addr("obj_2", "value")),
      edge(addr("obj_1", "cells", "B1"), addr("obj_2", "value")),
      edge(addr("obj_1", "cells", "A2"), addr("obj_2", "value")),
      edge(addr("obj_1", "cells", "B2"), addr("obj_2", "value")),
    ];

    const result = evaluate([table, sumFormula], edges);
    expect(objectById(result, "obj_2").slots.value).toMatchObject({ value: 10 });
  });

  it("D-044: a range extending past the table's current extent sums only the cells that exist", () => {
    const table = tableObject("obj_1", "table_x", 1, 1, { A1: 7 });
    const sumFormula: GraphObject = {
      id: "obj_2",
      name: "value_1",
      type: "value",
      slots: {
        value: {
          kind: "formula",
          ast: { type: "functionCall", name: "SUM", args: [{ type: "range", start: addr("obj_1", "cells", "A1"), end: addr("obj_1", "cells", "Z99") }] },
          value: null,
        },
      },
    };
    const edges: Edge[] = [edge(addr("obj_1", "cells", "A1"), addr("obj_2", "value"))];

    const result = evaluate([table, sumFormula], edges);
    expect(objectById(result, "obj_2").slots.value).toMatchObject({ value: 7 });
  });

  it("a range naming a table that does not exist in this pass evaluates to #REF rather than throwing", () => {
    const sumFormula: GraphObject = {
      id: "obj_2",
      name: "value_1",
      type: "value",
      slots: {
        value: {
          kind: "formula",
          ast: { type: "functionCall", name: "SUM", args: [{ type: "range", start: addr("obj_missing", "cells", "A1"), end: addr("obj_missing", "cells", "B2") }] },
          value: null,
        },
      },
    };
    expect(() => evaluate([sumFormula], [])).not.toThrow();
    const result = evaluate([sumFormula], []);
    expect(result[0]?.slots.value).toMatchObject({ value: { error: "#REF" } });
  });
});

describe("evaluate — the injected EvalContext (§5.1)", () => {
  // No current schema compute reads context.measurer, so the full "a derived
  // slot measures text through the injected context" assertion lands with the
  // cycle that builds `measuredHeight` (§5.6). This block pins that the
  // parameter is accepted, forwarded, and defaulted, and that a pass over
  // context-ignoring slots never touches the measurer.
  const objects = [
    valueObject("obj_1", "value_1", 10),
    valueObject("obj_2", "value_2", 5),
    addObject("obj_3", "add_1", addr("obj_1", "value"), addr("obj_2", "value")),
  ];
  const edges = addObjectEdges("obj_3", addr("obj_1", "value"), addr("obj_2", "value"));

  it("defaults to NULL_EVAL_CONTEXT when omitted — behaviour identical to passing it explicitly", () => {
    const implicit = evaluate(objects, edges);
    const explicit = evaluate(objects, edges, NULL_EVAL_CONTEXT);
    expect(objectById(implicit, "obj_3").slots["out.result"]).toEqual(objectById(explicit, "obj_3").slots["out.result"]);
  });

  it("forwards a caller-supplied context untouched, and never touches its measurer for context-ignoring slots", () => {
    let measureCalls = 0;
    const spyContext: EvalContext = {
      measurer: {
        measure: (text) => {
          measureCalls += 1;
          return { width: text.length, height: 1 };
        },
      },
    };

    const result = evaluate(objects, edges, spyContext);

    // The pass still produces the right answer (context is inert for `add`)...
    expect(objectById(result, "obj_3").slots["out.result"]).toEqual({ kind: "derived", value: 15 });
    // ...and nothing in this pass measured anything, because no slot here needs to.
    expect(measureCalls).toBe(0);
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

/**
 * The same `add` fixture as `addObject`, with its slot record declared
 * BACKWARDS (`out.result`, then `in.b`, then `in.a`). Object key order is
 * insertion order in JS, and `evaluate` builds its slot universe by iterating
 * `Object.keys(object.slots)` — so this is the fixture that can tell
 * "ordered by the edges" apart from "ordered by however the input happened to
 * be written." Added by reviewer at 0012-REVIEW-phase0.
 */
function addObjectDeclaredBackwards(id: string, name: string, aRef: Address, bRef: Address): GraphObject {
  const slots: Record<string, Slot> = {
    "out.result": { kind: "derived", value: null },
    "in.b": { kind: "formula", ast: { type: "reference", address: bRef }, value: null },
    "in.a": { kind: "formula", ast: { type: "reference", address: aRef }, value: null },
  };
  return { id, name, type: "add", slots };
}

describe("evaluate — the evaluation ORDER comes from the edges, not from the input's own order", () => {
  it("propagates correctly with every object AND every slot declared in reverse dependency order (§6: 'in correct topological order')", () => {
    // The same two-object chain as the derived-slot test above, written
    // backwards in both dimensions: the most-dependent object first, and
    // `out.result` declared before the `in.*` slots it reads. The input
    // order is therefore not itself a valid evaluation order — its very first
    // slot, `add_2.out.result`, reads two slots that come later — so each
    // value asserted below is produced by the topological sort or not at all.
    // That is what makes this test, and not the ones above, the one that
    // fails if the sort is removed.
    const objects = [
      addObjectDeclaredBackwards("obj_5", "add_2", addr("obj_3", "out", "result"), addr("obj_4", "value")),
      valueObject("obj_4", "value_3", 1),
      addObjectDeclaredBackwards("obj_3", "add_1", addr("obj_1", "value"), addr("obj_2", "value")),
      valueObject("obj_2", "value_2", 4),
      valueObject("obj_1", "value_1", 3),
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

describe("evaluate — a derived slot's compute evaluating an embedded formula AST (D-114, §5.6's text.resolvedContent)", () => {
  // Hand-built the way `deriveEdges` would build them, per this file's
  // convention (header) — a real `text` object with a literal `content` slot
  // and the `resolvedContent` derived placeholder, plus the edges the resolver
  // (`primitives/text.ts`) would derive.

  function textTable(id: string, name: string, rows: number, cols: number, cellValues: Record<string, Value>): GraphObject {
    const slots: Record<string, Slot> = { rows: { kind: "literal", value: rows }, cols: { kind: "literal", value: cols } };
    for (const [ref, value] of Object.entries(cellValues)) {
      slots[`cells.${ref}`] = { kind: "literal", value };
    }
    return { id, name, type: "table", slots };
  }

  function textObject(id: string, name: string, content: string): GraphObject {
    return { id, name, type: "text", slots: { content: { kind: "literal", value: content }, resolvedContent: { kind: "derived", value: null } } };
  }

  /** The `content` self-edge every `resolvedContent` gets, plus one per address given. */
  function textEdges(textId: string, ...sources: Address[]): Edge[] {
    return [edge(addr(textId, "content"), addr(textId, "resolvedContent")), ...sources.map((s) => edge(s, addr(textId, "resolvedContent")))];
  }

  function resolvedContentOf(objects: readonly GraphObject[], edges: readonly Edge[], textId: string): Value {
    return objectById(evaluate(objects, edges), textId).slots.resolvedContent?.value ?? null;
  }

  it("resolves a plain embedded formula through the same evaluator a cell formula uses (Rule 4)", () => {
    const text = textObject("obj_x", "text_1", "two plus three is {= 2 + 3 }");
    expect(resolvedContentOf([text], textEdges("obj_x"), "obj_x")).toBe("two plus three is 5");
  });

  it("reads a referenced slot's value from THIS pass — the topological order places the reference first", () => {
    const table = textTable("obj_t", "table_1", 4, 4, { A1: 42 });
    const text = textObject("obj_x", "text_1", "cell says {= table_1.A1 }");
    expect(resolvedContentOf([table, text], textEdges("obj_x", addr("obj_t", "cells", "A1")), "obj_x")).toBe("cell says 42");
  });

  it("D-114 clause 3: an EMPTY in-extent cell reads as 0 — coercion BEFORE the D-013 membership check", () => {
    // A2 is inside the 4x4 extent but has no slot, so the resolver gave it NO
    // edge (D-110 clause 4) — deliberately absent from resolvedContent's
    // declared dependencies. If `evaluateDerivedSlot`'s `read` checked
    // membership first it would return #REF and this would resolve to
    // "sum: !#REF"; the D-110 coercion running first is what makes it "sum: 5",
    // matching what the same reference reads in a cell formula (D-114).
    const table = textTable("obj_t", "table_1", 4, 4, { A1: 5 });
    const text = textObject("obj_x", "text_1", "sum: {= table_1.A1 + table_1.A2 }");
    expect(resolvedContentOf([table, text], textEdges("obj_x", addr("obj_t", "cells", "A1")), "obj_x")).toBe("sum: 5");
  });

  it("D-110 clause 2: a cell that HAS a slot holding `null`, in-extent, also reads as 0", () => {
    const table = textTable("obj_t", "table_1", 4, 4, { A1: null });
    const text = textObject("obj_x", "text_1", "value {= table_1.A1 + 1 }");
    expect(resolvedContentOf([table, text], textEdges("obj_x", addr("obj_t", "cells", "A1")), "obj_x")).toBe("value 1");
  });

  it("D-013 still bites: an address the block tree names but the edge set does NOT declare resolves to #REF", () => {
    const other = { id: "obj_v", name: "value_1", type: "value", slots: { value: { kind: "literal", value: 99 } } } satisfies GraphObject;
    const text = textObject("obj_x", "text_1", "reads {= value_1.value }");
    // Edges WITHOUT value_1.value -> resolvedContent: the compute must not be
    // able to read it out of band (D-013), even though it is a real value in
    // this pass. `value_1.value` is not an in-extent table cell, so the D-110
    // coercion does not apply and the membership check is decisive.
    expect(resolvedContentOf([other, text], textEdges("obj_x"), "obj_x")).toBe("reads !#REF");
    expect(resolvedContentOf([other, text], textEdges("obj_x", addr("obj_v", "value")), "obj_x")).toBe("reads 99");
  });

  it("evaluates an embedded aggregate over a range, through the shared buildRangeReader (D-114 clause 1)", () => {
    const table = textTable("obj_t", "table_1", 4, 4, { A1: 1, A2: 2, A3: 3, A4: 4 });
    const text = textObject("obj_x", "text_1", "total {= SUM(table_1.A1:table_1.A4) }");
    const cells = (["A1", "A2", "A3", "A4"] as const).map((ref) => addr("obj_t", "cells", ref));
    expect(resolvedContentOf([table, text], textEdges("obj_x", ...cells), "obj_x")).toBe("total 10");
  });

  it("a broken embedded span is marked in place, the rest of resolvedContent still resolves (D-116)", () => {
    const text = textObject("obj_x", "text_1", "ok {= 1 + } and {= 6 * 7 }");
    expect(resolvedContentOf([text], textEdges("obj_x"), "obj_x")).toBe("ok !{= 1 + } and 42");
  });

  it("re-renders when a value referenced only inside the currently NON-taken branch changes (Phase 5 gate property)", () => {
    // A1 > 0 -> true branch ("ok"); A1 <= 0 -> false branch, which reads A2.
    // Both branches' cells are subscribed (extractTextDependencies is total),
    // so flipping A1 negative surfaces A2's value in the SAME pass.
    const text = textObject("obj_x", "text_1", "{? table_1.A1 > 0 }ok{:}fallback is {= table_1.A2 }{?}");
    const edges = textEdges("obj_x", addr("obj_t", "cells", "A1"), addr("obj_t", "cells", "A2"));
    expect(resolvedContentOf([textTable("obj_t", "table_1", 4, 4, { A1: 5, A2: 20 }), text], edges, "obj_x")).toBe("ok");
    expect(resolvedContentOf([textTable("obj_t", "table_1", 4, 4, { A1: -1, A2: 20 }), text], edges, "obj_x")).toBe("fallback is 20");
  });
});

describe("evaluate — §5.6's measuredHeight derived slot (D-118, Q-021 — entry 0129)", () => {
  /**
   * A well-formed `text` object: the five slots a derived slot reads, plus both
   * D-018 derived placeholders. `width` and `style.*` are literals here; §5.6
   * allows any of them to be a formula, and the edges below are what would
   * order `measuredHeight` after such a formula.
   */
  function textObject(id: string, name: string, content: string, width: Value = "auto", fontSizeSlot?: Slot): GraphObject {
    return {
      id,
      name,
      type: "text",
      slots: {
        content: { kind: "literal", value: content },
        width: { kind: "literal", value: width },
        "style.font": { kind: "literal", value: "sans" },
        "style.fontSize": fontSizeSlot ?? { kind: "literal", value: 12 },
        "style.lineHeight": { kind: "literal", value: 16 },
        resolvedContent: { kind: "derived", value: null },
        measuredHeight: { kind: "derived", value: null },
      },
    };
  }

  /** resolvedContent's content self-edge + measuredHeight's five static-dependency edges. */
  function textEdges(textId: string): Edge[] {
    return [
      edge(addr(textId, "content"), addr(textId, "resolvedContent")),
      edge(addr(textId, "resolvedContent"), addr(textId, "measuredHeight")),
      edge(addr(textId, "width"), addr(textId, "measuredHeight")),
      edge(addr(textId, "style", "font"), addr(textId, "measuredHeight")),
      edge(addr(textId, "style", "fontSize"), addr(textId, "measuredHeight")),
      edge(addr(textId, "style", "lineHeight"), addr(textId, "measuredHeight")),
    ];
  }

  /** A fake measurer: height is 10 with no wrap boundary, 20 with one — so a test can prove BOTH that context was threaded and that the `width` slot reached `measure` as `maxWidth` (Q-021). */
  function fakeMeasurer(): EvalContext {
    return {
      measurer: {
        measure: (_text, _style, maxWidth) => ({ width: 0, height: maxWidth === undefined ? 10 : 20 }),
      },
    };
  }

  function measuredHeightOf(object: GraphObject, context?: EvalContext): Value {
    return objectById(evaluate([object], textEdges(object.id), context), object.id).slots.measuredHeight?.value ?? null;
  }

  it("D-118: evaluated with NULL_EVAL_CONTEXT, a real text object's measuredHeight is #MEASURE — never height 0", () => {
    // This is also 0124's end-to-end proof that `context` is threaded at all:
    // mutation-checked by making `evaluateDerivedSlot` pass NULL_EVAL_CONTEXT
    // instead of `context` -> the "threads a real measurer" test below goes red.
    const height = measuredHeightOf(textObject("obj_x", "text_1", "some text here"), NULL_EVAL_CONTEXT);
    expect(height).toEqual({ error: "#MEASURE", message: expect.stringContaining("text_1") });
  });

  it("D-118: the same is true with NO context passed (evaluate's own default is NULL_EVAL_CONTEXT)", () => {
    expect(measuredHeightOf(textObject("obj_x", "text_1", "x"))).toMatchObject({ error: "#MEASURE" });
  });

  it("threads a real (fake) measurer through the topological pass and returns its height (Rule 1)", () => {
    expect(measuredHeightOf(textObject("obj_x", "text_1", "hello"), fakeMeasurer())).toBe(10);
  });

  it("PROVISIONAL(Q-021): a numeric `width` slot reaches the measurer as maxWidth; \"auto\" does not", () => {
    expect(measuredHeightOf(textObject("obj_x", "text_1", "hello", 120), fakeMeasurer())).toBe(20); // maxWidth defined
    expect(measuredHeightOf(textObject("obj_x", "text_1", "hello", "auto"), fakeMeasurer())).toBe(10); // maxWidth undefined
  });

  it("measures resolvedContent AFTER the embedded formula resolves — measuredHeight sits downstream of resolvedContent", () => {
    // The fake makes height a function of maxWidth, not text, so assert the
    // ORDER via resolvedContent instead: it must be the resolved string, not
    // the raw content, by the time anything downstream could read it.
    const object = textObject("obj_x", "text_1", "n is {= 2 + 2 }");
    const result = objectById(evaluate([object], textEdges("obj_x"), fakeMeasurer()), "obj_x");
    expect(result.slots.resolvedContent?.value).toBe("n is 4");
    expect(result.slots.measuredHeight?.value).toBe(10);
  });

  it("propagates an ErrorValue from a formula-driven style slot (§5.1: errors propagate)", () => {
    // style.fontSize is a binding to a slot that does not resolve -> #REF.
    const object = textObject("obj_x", "text_1", "x", "auto", {
      kind: "formula",
      ast: { type: "reference", address: addr("gone", "v") },
      value: null,
    });
    // Even with a real measurer, a broken input short-circuits measuredHeight to that error.
    expect(measuredHeightOf(object, fakeMeasurer())).toMatchObject({ error: "#REF" });
  });
});
