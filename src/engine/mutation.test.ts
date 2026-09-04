/**
 * mutation.test.ts — Tests for `mutation.ts`'s full §5.1 loop: edge derivation
 * (step 3), integrity validation (step 4, including cycle 0019's D-018
 * schema/slot reconciliation checks), their composition with acyclicity
 * validation and evaluation (steps 5, 7) into `deriveValidateAndEvaluate`, and
 * `mutate` itself (steps 1, 2, 6, 8, wrapping the above — cycle 0017, with
 * cycle 0019 closing D-019's clone-fidelity gap and D-021's no-op gap,
 * widened to D-020's BATCH form — a `readonly Operation[]`, not one
 * `Operation` — at cycle 0020, and to `Operation`'s SECOND variant,
 * `DeleteObjectOperation`, at cycle 0022 — which closes Phase 0 acceptance
 * clause 3 and makes the batch's existence check fold-aware, since deletion
 * is the first operation kind able to shrink the object set mid-batch).
 *
 * Colocated with mutation.ts per D-001. Fixtures are built by hand, the same
 * convention `graph/eval.test.ts` and `graph/cycles.test.ts` use.
 */
import { describe, expect, it } from "vitest";
import { formatAddress, type Address } from "./address.ts";
import type { EvalContext } from "./eval-context.ts";
import type { FormulaAst } from "./formula/ast.ts";
import { detectCycle } from "./graph/cycles.ts";
import { addressKey, type Edge } from "./graph/edge.ts";
import { evaluate } from "./graph/eval.ts";
import type { GraphObject, Slot } from "./graph/node.ts";
import {
  deriveEdges,
  deriveValidateAndEvaluate,
  mutate,
  validateIntegrity,
  type MutationJournalEntry,
  type Operation,
} from "./mutation.ts";
import { enumerateTableCellSlotPaths } from "./primitives/table.ts";

/** Matches graph/eval.test.ts's / graph/cycles.test.ts's own shorthand. */
function addr(objectId: string, ...path: readonly string[]): Address {
  return { objectId, path };
}

/** PROJECT_BRIEF §6's 'value' fixture: one literal numeric slot. */
function valueObject(id: string, name: string, value: number): GraphObject {
  return { id, name, type: "value", slots: { value: { kind: "literal", value } } };
}

/**
 * PROJECT_BRIEF §6's 'add' fixture: two formula (binding) input slots, one
 * derived output slot — the real shape `deriveEdges` is meant to walk (unlike
 * `graph/eval.test.ts`'s own `addObject`, this file never hand-builds the
 * matching edges; that is the entire point of the function under test).
 */
function addObject(id: string, name: string, aRef: Address, bRef: Address): GraphObject {
  const slots: Record<string, Slot> = {
    "in.a": { kind: "formula", ast: { type: "reference", address: aRef }, value: null },
    "in.b": { kind: "formula", ast: { type: "reference", address: bRef }, value: null },
    "out.result": { kind: "derived", value: null },
  };
  return { id, name, type: "add", slots };
}

/** Order-independent identity for one Edge, for Set/array comparison below. */
function edgeIdentity(edge: Edge): string {
  return `${addressKey(edge.sourceSlot)}=>${addressKey(edge.dependentSlot)}`;
}

/** Compares two Edge[] as SETS (deriveEdges makes no ordering promise — see its header). */
function expectSameEdges(actual: readonly Edge[], expected: readonly Edge[]): void {
  expect(new Set(actual.map(edgeIdentity))).toEqual(new Set(expected.map(edgeIdentity)));
  expect(actual).toHaveLength(expected.length); // catches accidental duplicates the Set comparison would hide
}

describe("deriveEdges — PROJECT_BRIEF §6's value/add fixture", () => {
  it("derives the binding edges (in.a/in.b) and the derived-slot dependency edges (out.result), and nothing else", () => {
    const objects = [
      valueObject("obj_1", "value_1", 10),
      valueObject("obj_2", "value_2", 5),
      addObject("obj_3", "add_1", addr("obj_1", "value"), addr("obj_2", "value")),
    ];

    const edges = deriveEdges(objects);

    expectSameEdges(edges, [
      { sourceSlot: addr("obj_1", "value"), dependentSlot: addr("obj_3", "in", "a") },
      { sourceSlot: addr("obj_2", "value"), dependentSlot: addr("obj_3", "in", "b") },
      { sourceSlot: addr("obj_3", "in", "a"), dependentSlot: addr("obj_3", "out", "result") },
      { sourceSlot: addr("obj_3", "in", "b"), dependentSlot: addr("obj_3", "out", "result") },
    ]);
  });

  it("derives no edges at all for an isolated 'value' object (no formula slots, no derived slots)", () => {
    expect(deriveEdges([valueObject("obj_1", "value_1", 42)])).toEqual([]);
  });
});

describe("deriveEdges — integration with graph/eval.ts", () => {
  it("feeds evaluate() the same propagation graph/eval.test.ts's hand-built edges produce, across a two-object chain", () => {
    // The same literal -> formula -> derived -> formula -> derived chain
    // graph/eval.test.ts's derived-slot test hand-wires its edges for — here
    // deriveEdges must recover the SAME edge set purely from the objects'
    // stored ASTs and add's schema, with no hand-built Edge at all.
    const objects = [
      valueObject("obj_1", "value_1", 3),
      valueObject("obj_2", "value_2", 4),
      addObject("obj_3", "add_1", addr("obj_1", "value"), addr("obj_2", "value")),
      valueObject("obj_4", "value_3", 1),
      addObject("obj_5", "add_2", addr("obj_3", "out", "result"), addr("obj_4", "value")),
    ];

    const edges = deriveEdges(objects);
    const result = evaluate(objects, edges);

    const add1 = result.find((object) => object.id === "obj_3");
    const add2 = result.find((object) => object.id === "obj_5");
    expect(add1?.slots["out.result"]).toEqual({ kind: "derived", value: 7 });
    expect(add2?.slots["in.a"]).toMatchObject({ kind: "formula", value: 7 });
    expect(add2?.slots["out.result"]).toEqual({ kind: "derived", value: 8 });
  });
});

describe("deriveEdges — objects of a type with no schema entry yet", () => {
  it("derives no edges for them and does not throw, matching getObjectSchema's own honest 'undefined' stance", () => {
    // "polyline" is the current type with no schema entry (schema.ts's own
    // file header); circle/polygon/rect all have real ones. Switched from
    // "circle" at entry 0059.
    const noSchemaYet: GraphObject = {
      id: "obj_1",
      name: "polyline_1",
      type: "polyline",
      slots: { radius: { kind: "literal", value: 5 } },
    };

    expect(() => deriveEdges([noSchemaYet])).not.toThrow();
    expect(deriveEdges([noSchemaYet])).toEqual([]);
  });
});

describe("deriveEdges — a non-derived path currently holding a literal, not a formula", () => {
  it("derives no binding edge for that path, but still derives the derived slot's schema-declared dependency edges", () => {
    // §5.1: literal and formula are interchangeable at runtime, and a literal
    // slot has no inbound edges. in.a is literal here (unlike addObject's
    // formula default) — the binding edge for in.a must NOT appear, but
    // out.result's dependency edges are schema-driven and independent of
    // in.a/in.b's current kind, so both must still appear.
    const objects: GraphObject[] = [
      valueObject("obj_2", "value_2", 5),
      {
        id: "obj_3",
        name: "add_1",
        type: "add",
        slots: {
          "in.a": { kind: "literal", value: 10 },
          "in.b": { kind: "formula", ast: { type: "reference", address: addr("obj_2", "value") }, value: null },
          "out.result": { kind: "derived", value: null },
        },
      },
    ];

    const edges = deriveEdges(objects);

    expectSameEdges(edges, [
      { sourceSlot: addr("obj_2", "value"), dependentSlot: addr("obj_3", "in", "b") },
      { sourceSlot: addr("obj_3", "in", "a"), dependentSlot: addr("obj_3", "out", "result") },
      { sourceSlot: addr("obj_3", "in", "b"), dependentSlot: addr("obj_3", "out", "result") },
    ]);
  });
});

describe("deriveEdges — a schema-declared path missing from the object's actual slots", () => {
  it("skips it rather than throwing, for a malformed fixture missing in.b entirely", () => {
    const malformedAdd: GraphObject = {
      id: "obj_3",
      name: "add_1",
      type: "add",
      slots: {
        "in.a": { kind: "formula", ast: { type: "reference", address: addr("obj_1", "value") }, value: null },
        "out.result": { kind: "derived", value: null },
        // in.b is entirely absent — a document mutation.ts's own future
        // object-creation step should never produce, but this function must
        // not trust that.
      },
    };

    expect(() => deriveEdges([malformedAdd])).not.toThrow();
    const edges = deriveEdges([malformedAdd]);
    expectSameEdges(edges, [
      { sourceSlot: addr("obj_1", "value"), dependentSlot: addr("obj_3", "in", "a") },
      { sourceSlot: addr("obj_3", "in", "a"), dependentSlot: addr("obj_3", "out", "result") },
      { sourceSlot: addr("obj_3", "in", "b"), dependentSlot: addr("obj_3", "out", "result") },
    ]);
  });
});

describe("deriveEdges — a formula referencing an address with no corresponding object at all", () => {
  it("still derives the edge verbatim — an address's VALIDITY is step 4's job (§5.1.1), not edge derivation's", () => {
    const objects = [
      valueObject("obj_2", "value_2", 5),
      addObject("obj_3", "add_1", addr("obj_999", "value"), addr("obj_2", "value")),
    ];

    const edges = deriveEdges(objects);
    expect(edges).toContainEqual({
      sourceSlot: addr("obj_999", "value"),
      dependentSlot: addr("obj_3", "in", "a"),
    });
  });
});

/**
 * An `add` carrying an undeclared fourth slot `in.c` — schema declares only
 * in.a/in.b. Shared by the tests below (`deriveEdges`'s still-current gap, and
 * `validateIntegrity`'s D-017 rejection of it).
 */
function addWithUndeclaredSlot(inCRef: Address): GraphObject {
  return {
    id: "obj_9",
    name: "add_9",
    type: "add",
    slots: {
      "in.a": { kind: "literal", value: 1 },
      "in.b": { kind: "literal", value: 2 },
      "out.result": { kind: "derived", value: null },
      "in.c": { kind: "formula", ast: { type: "reference", address: inCRef }, value: null },
    },
  };
}

describe("deriveEdges — a formula slot the object carries but its schema does not declare (D-017)", () => {
  it("still derives NO edge for it — deriveEdges itself is unchanged by D-017 part 2, see mutation.ts's header", () => {
    const objects = [addWithUndeclaredSlot(addr("obj_1", "value")), valueObject("obj_1", "value_1", 42)];

    // in.c reads obj_1.value, so a total edge derivation would emit
    // obj_1.value -> obj_9.in.c. It does not appear — D-017 leaves deriveEdges
    // alone and puts the obligation on validateIntegrity instead (below).
    expect(deriveEdges(objects)).not.toContainEqual({
      sourceSlot: addr("obj_1", "value"),
      dependentSlot: addr("obj_9", "in", "c"),
    });
  });
});

describe("validateIntegrity — D-017 part 2: an undeclared formula/derived slot is rejected", () => {
  it("rejects an object carrying a formula slot its own schema does not declare, naming it", () => {
    const objects = [addWithUndeclaredSlot(addr("obj_1", "value")), valueObject("obj_1", "value_1", 42)];
    const edges = deriveEdges(objects);

    const result = validateIntegrity(objects, edges);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("add_9.in.c");
    }
  });

  it("was previously a KNOWN GAP (0014-REVIEW-phase0): the same cyclic document that hid a real cycle from detectCycle is now rejected before detectCycle is ever reached", () => {
    // The document genuinely cycles: in.c -> in.a -> out.result -> in.c. Only
    // the last of those three edges runs through the undeclared slot, and
    // dropping it was enough to make the whole cycle invisible to detectCycle
    // (still true below — that is WHY step 4 must run first, per D-017).
    const cyclic: GraphObject = {
      id: "obj_9",
      name: "add_9",
      type: "add",
      slots: {
        "in.a": { kind: "formula", ast: { type: "reference", address: addr("obj_9", "in", "c") }, value: null },
        "in.b": { kind: "literal", value: 2 },
        "out.result": { kind: "derived", value: null },
        "in.c": { kind: "formula", ast: { type: "reference", address: addr("obj_9", "out", "result") }, value: null },
      },
    };
    const edges = deriveEdges([cyclic]);

    // Confirms the hazard is still live at the detectCycle layer — nothing
    // about that function changed, and nothing should.
    expect(detectCycle(edges)).toEqual({ hasCycle: false });

    // But the mutation loop never reaches detectCycle with this document:
    // validateIntegrity rejects it first.
    const result = validateIntegrity([cyclic], edges);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("add_9.in.c");
    }
  });

  it("does not flag an object whose type has no schema entry at all (D-017's one permitted exception)", () => {
    // "polyline" is the current type with no schema entry (schema.ts's own
    // file header); circle/polygon/rect all have real ones. Switched from
    // "circle" at entry 0059.
    const noSchemaYet: GraphObject = {
      id: "obj_1",
      name: "polyline_1",
      type: "polyline",
      slots: { radius: { kind: "literal", value: 5 } },
    };
    expect(validateIntegrity([noSchemaYet], deriveEdges([noSchemaYet]))).toEqual({ ok: true });
  });
});

describe("deriveEdges/validateIntegrity — every FormulaAst shape is genuinely supported (D-036 constraint 3: the ReferenceNode-only narrowing and its findUnsupportedFormulaAsts shield are BOTH deleted this cycle)", () => {
  it("accepts a formula slot holding a bare LiteralNode — no edges needed, no rejection", () => {
    const objects: GraphObject[] = [
      { id: "obj_1", name: "value_1", type: "value", slots: { value: { kind: "formula", ast: { type: "literal", value: 42 }, value: null } } },
    ];

    expect(deriveEdges(objects)).toEqual([]); // a literal has no dependency to derive an edge from.
    expect(validateIntegrity(objects, deriveEdges(objects))).toEqual({ ok: true });
  });

  it("accepts and correctly wires every non-reference AST shape in turn: literal, binaryOp, unaryOp, functionCall — each formerly rejected, now genuinely supported", () => {
    const referenced = addr("obj_9", "value");
    const shapes: FormulaAst[] = [
      { type: "literal", value: 1 },
      { type: "binaryOp", operator: "+", left: { type: "reference", address: referenced }, right: { type: "literal", value: 2 } },
      { type: "unaryOp", operator: "NOT", operand: { type: "literal", value: true } },
      { type: "functionCall", name: "SUM", args: [{ type: "reference", address: referenced }] },
    ];
    for (const ast of shapes) {
      const objects: GraphObject[] = [
        valueObject("obj_9", "value_9", 5),
        { id: "obj_1", name: "value_1", type: "value", slots: { value: { kind: "formula", ast, value: null } } },
      ];
      expect(validateIntegrity(objects, deriveEdges(objects)).ok).toBe(true);
    }
  });

  it("an ErrorNode (D-028) is accepted as legitimate, already-repaired state, not rejected", () => {
    const objects: GraphObject[] = [
      { id: "obj_1", name: "value_1", type: "value", slots: { value: { kind: "formula", ast: { type: "error", error: "#REF" }, value: null } } },
    ];
    expect(validateIntegrity(objects, deriveEdges(objects))).toEqual({ ok: true });
  });

  it("still does not flag a formula slot holding a plain ReferenceNode — the ordinary binding case, unchanged", () => {
    const objects = [valueObject("obj_1", "value_1", 1), addObject("obj_2", "add_1", addr("obj_1", "value"), addr("obj_1", "value"))];
    const result = validateIntegrity(objects, deriveEdges(objects));
    expect(result.ok).toBe(true);
  });

  it("a binaryOp formula referencing a slot that does NOT resolve is still caught by the dangling-reference check — extractDependencies feeds it a real edge to check", () => {
    const objects: GraphObject[] = [
      {
        id: "obj_1",
        name: "value_1",
        type: "value",
        slots: {
          value: {
            kind: "formula",
            ast: { type: "binaryOp", operator: "+", left: { type: "reference", address: addr("obj_999", "value") }, right: { type: "literal", value: 1 } },
            value: null,
          },
        },
      },
    ];

    const result = validateIntegrity(objects, deriveEdges(objects));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("value_1.value");
    }
  });

  it("committed via the real mutate() entry point — a formula containing a range is storable, per D-036 constraint 4", () => {
    const table = tableObject("obj_1", "table_x", 1, 1, { "cells.A1": { kind: "literal", value: 42 } });
    const sumCell = tableObject("obj_2", "table_y", 1, 1, {
      "cells.A1": {
        kind: "formula",
        ast: { type: "functionCall", name: "SUM", args: [{ type: "range", start: addr("obj_1", "cells", "A1"), end: addr("obj_1", "cells", "A1") }] },
        value: null,
      },
    });

    const result = mutate([], [{ kind: "createObject", object: table }, { kind: "createObject", object: sumCell }], []);

    expect(result.ok).toBe(true);
    if (result.ok) {
      const committed = result.objects.find((object) => object.id === "obj_2");
      expect(committed?.slots["cells.A1"]).toMatchObject({ value: 42 });
    }
  });

  it("never throws for any FormulaAst shape", () => {
    const objects: GraphObject[] = [
      { id: "obj_1", name: "value_1", type: "value", slots: { value: { kind: "formula", ast: { type: "functionCall", name: "SUM", args: [] }, value: null } } },
    ];
    expect(() => validateIntegrity(objects, deriveEdges(objects))).not.toThrow();
  });
});

describe("validateIntegrity — D-031: an illegal number LITERAL inside a stored formula AST is rejected, the same way an illegal slot VALUE already is", () => {
  it("rejects a formula slot whose AST holds a non-finite LiteralNode, naming the slot", () => {
    const objects: GraphObject[] = [
      { id: "obj_1", name: "value_1", type: "value", slots: { value: { kind: "formula", ast: { type: "literal", value: Infinity }, value: null } } },
    ];

    const result = validateIntegrity(objects, deriveEdges(objects));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("value_1.value");
      expect(result.message).toContain("Infinity");
    }
  });

  it("rejects a -0 LiteralNode buried inside a binaryOp/functionCall tree, not just at the AST root", () => {
    const objects: GraphObject[] = [
      {
        id: "obj_1",
        name: "value_1",
        type: "value",
        slots: {
          value: {
            kind: "formula",
            ast: { type: "functionCall", name: "ABS", args: [{ type: "binaryOp", operator: "+", left: { type: "literal", value: -0 }, right: { type: "literal", value: 1 } }] },
            value: null,
          },
        },
      },
    ];

    const result = validateIntegrity(objects, deriveEdges(objects));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("-0");
    }
  });

  it("does NOT reject a perfectly ordinary finite literal — this is a targeted check, not a blanket ban on LiteralNodes", () => {
    const objects: GraphObject[] = [
      { id: "obj_1", name: "value_1", type: "value", slots: { value: { kind: "formula", ast: { type: "literal", value: 3.5 }, value: null } } },
    ];
    expect(validateIntegrity(objects, deriveEdges(objects))).toEqual({ ok: true });
  });

  it("reachable through the real mutate() entry point, leaving prior state unchanged", () => {
    const initial = [valueObject("obj_1", "value_1", 1)];
    const snapshotBefore = JSON.parse(JSON.stringify(initial)) as unknown;
    const operation: Operation = {
      kind: "setSlot",
      address: addr("obj_1", "value"),
      slot: { kind: "formula", ast: { type: "literal", value: NaN }, value: null },
    };

    const result = mutate(initial, [operation], []);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("value_1.value");
    }
    expect(initial).toEqual(snapshotBefore);
  });

  it("never throws, including on a deeply nested illegal literal", () => {
    const objects: GraphObject[] = [
      {
        id: "obj_1",
        name: "value_1",
        type: "value",
        slots: {
          value: {
            kind: "formula",
            ast: { type: "unaryOp", operator: "-", operand: { type: "unaryOp", operator: "-", operand: { type: "literal", value: -Infinity } } },
            value: null,
          },
        },
      },
    ];
    expect(() => validateIntegrity(objects, deriveEdges(objects))).not.toThrow();
  });
});

describe("validateIntegrity — §5.1.1: a formula referencing a slot that does not exist", () => {
  it("rejects a formula whose reference resolves to no object at all, naming the DEPENDENT slot", () => {
    const objects = [
      valueObject("obj_2", "value_2", 5),
      addObject("obj_3", "add_1", addr("obj_999", "value"), addr("obj_2", "value")),
    ];
    const edges = deriveEdges(objects);

    const result = validateIntegrity(objects, edges);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("add_1.in.a"); // the referencing slot, not the missing obj_999
      expect(result.message).not.toContain("obj_999"); // D-015: never leak a raw internal id
    }
  });

  it("rejects a formula referencing a real object's slot that does not exist on it", () => {
    const objects = [
      valueObject("obj_2", "value_2", 5),
      addObject("obj_3", "add_1", addr("obj_2", "nonexistent_slot"), addr("obj_2", "value")),
    ];
    const edges = deriveEdges(objects);

    const result = validateIntegrity(objects, edges);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("add_1.in.a");
    }
  });

  it("passes PROJECT_BRIEF §6's well-formed value/add fixture", () => {
    const objects = [
      valueObject("obj_1", "value_1", 10),
      valueObject("obj_2", "value_2", 5),
      addObject("obj_3", "add_1", addr("obj_1", "value"), addr("obj_2", "value")),
    ];
    expect(validateIntegrity(objects, deriveEdges(objects))).toEqual({ ok: true });
  });

  it("runs the D-017 check before the dangling-reference check, on a document with both problems", () => {
    // add_9 has BOTH an undeclared slot (in.c) AND, separately, add_1's in.a
    // dangles at a nonexistent object. Only the D-017 problem should be
    // reported — the ordering itself is load-bearing (0014-REVIEW-phase0's
    // constraint 1), not merely convenient, so it is pinned by a test rather
    // than only asserted in the header.
    const objects = [
      addWithUndeclaredSlot(addr("obj_1", "value")),
      valueObject("obj_1", "value_1", 42),
      addObject("obj_3", "add_1", addr("obj_999", "value"), addr("obj_1", "value")),
    ];
    const edges = deriveEdges(objects);

    const result = validateIntegrity(objects, edges);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("add_9.in.c");
      expect(result.message).not.toContain("add_1.in.a"); // the OTHER problem — not reached this call
    }
  });

  it("never throws for any of the above documents", () => {
    const objects = [addWithUndeclaredSlot(addr("obj_1", "value")), valueObject("obj_1", "value_1", 42)];
    expect(() => validateIntegrity(objects, deriveEdges(objects))).not.toThrow();
    expect(() => validateIntegrity([], [])).not.toThrow();
  });
});

describe("deriveValidateAndEvaluate — composing deriveEdges -> validateIntegrity -> detectCycle -> evaluate", () => {
  it("evaluates PROJECT_BRIEF §6's fixture end-to-end, including through a derived slot, with no hand-built edges anywhere", () => {
    // Same two-hop literal -> formula -> derived -> formula -> derived chain
    // as the "deriveEdges — integration with graph/eval.ts" describe block
    // above, but exercised through the single composed entry point this
    // cycle adds, rather than by calling deriveEdges/evaluate directly.
    const objects = [
      valueObject("obj_1", "value_1", 3),
      valueObject("obj_2", "value_2", 4),
      addObject("obj_3", "add_1", addr("obj_1", "value"), addr("obj_2", "value")),
      valueObject("obj_4", "value_3", 1),
      addObject("obj_5", "add_2", addr("obj_3", "out", "result"), addr("obj_4", "value")),
    ];

    const result = deriveValidateAndEvaluate(objects);

    expect(result.ok).toBe(true);
    if (result.ok) {
      const add1 = result.objects.find((object) => object.id === "obj_3");
      const add2 = result.objects.find((object) => object.id === "obj_5");
      expect(add1?.slots["out.result"]).toEqual({ kind: "derived", value: 7 });
      expect(add2?.slots["out.result"]).toEqual({ kind: "derived", value: 8 });
    }
  });

  it("rejects a genuine cycle (in.a reads its own out.result) before evaluate ever runs, naming every slot in the cycle via formatAddress", () => {
    // A minimal SELF-cycle using only schema-declared paths — no undeclared
    // slot involved — so this exercises detectCycle's rejection specifically,
    // not validateIntegrity's D-017 check (covered separately below).
    const selfCyclicAdd: GraphObject = {
      id: "obj_1",
      name: "add_1",
      type: "add",
      slots: {
        "in.a": { kind: "formula", ast: { type: "reference", address: addr("obj_1", "out", "result") }, value: null },
        "in.b": { kind: "literal", value: 2 },
        "out.result": { kind: "derived", value: null },
      },
    };

    const result = deriveValidateAndEvaluate([selfCyclicAdd]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("add_1.in.a");
      expect(result.message).toContain("add_1.out.result");
    }
  });

  it("runs validateIntegrity before detectCycle: when a document has BOTH an undeclared slot AND an unrelated genuine cycle, only the D-017 message is reported", () => {
    // add_1 has TWO independent problems: (1) an undeclared in.c slot (D-017,
    // caught by validateIntegrity), and (2) a genuine self-cycle in.a <->
    // out.result that IS fully captured by deriveEdges (both in.a and
    // out.result are schema-declared, so unlike the "KNOWN GAP" fixture
    // above, detectCycle CAN and does see this one on its own). This is the
    // fixture that actually distinguishes the two orders — mutation-tested by
    // temporarily swapping validateIntegrity and detectCycle in
    // deriveValidateAndEvaluate: the swap left all other tests green but
    // failed only this one, now reporting "cyclic dependency" instead of
    // "add_1.in.c" (see 0016's log entry).
    const bothProblems: GraphObject = {
      id: "obj_1",
      name: "add_1",
      type: "add",
      slots: {
        "in.a": { kind: "formula", ast: { type: "reference", address: addr("obj_1", "out", "result") }, value: null },
        "in.b": { kind: "literal", value: 2 },
        "out.result": { kind: "derived", value: null },
        "in.c": { kind: "formula", ast: { type: "reference", address: addr("obj_1", "in", "c") }, value: null },
      },
    };

    const result = deriveValidateAndEvaluate([bothProblems]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("add_1.in.c");
      expect(result.message).not.toContain("cyclic dependency"); // never reached detectCycle's message
    }
  });

  it("rejects a dangling reference before evaluate ever runs, naming the dependent slot", () => {
    const objects = [
      valueObject("obj_2", "value_2", 5),
      addObject("obj_3", "add_1", addr("obj_999", "value"), addr("obj_2", "value")),
    ];

    const result = deriveValidateAndEvaluate(objects);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("add_1.in.a");
    }
  });

  it("never throws, for a well-formed document, a rejected one, or an empty one", () => {
    const wellFormed = [
      valueObject("obj_1", "value_1", 10),
      valueObject("obj_2", "value_2", 5),
      addObject("obj_3", "add_1", addr("obj_1", "value"), addr("obj_2", "value")),
    ];
    expect(() => deriveValidateAndEvaluate(wellFormed)).not.toThrow();
    expect(() => deriveValidateAndEvaluate([addWithUndeclaredSlot(addr("obj_1", "value"))])).not.toThrow();
    expect(() => deriveValidateAndEvaluate([])).not.toThrow();
    expect(deriveValidateAndEvaluate([])).toEqual({ ok: true, objects: [] });
  });

  it("forwards a caller-supplied EvalContext (§5.1) to step 7 untouched, without changing a context-ignoring result", () => {
    const objects = [
      valueObject("obj_1", "value_1", 10),
      valueObject("obj_2", "value_2", 5),
      addObject("obj_3", "add_1", addr("obj_1", "value"), addr("obj_2", "value")),
    ];
    let measureCalls = 0;
    const spyContext: EvalContext = {
      measurer: {
        measure: (text) => {
          measureCalls += 1;
          return { width: text.length, height: 1 };
        },
      },
    };

    const withDefault = deriveValidateAndEvaluate(objects);
    const withContext = deriveValidateAndEvaluate(objects, spyContext);

    expect(withDefault).toEqual(withContext); // `add` ignores context — same result either way.
    expect(measureCalls).toBe(0); // nothing here needs measuring, so the measurer is never touched.
  });
});

describe("mutate — §5.1's full loop (stage, apply, validate/detect/evaluate, commit+journal)", () => {
  it("mutates a value's literal and watches it propagate through a derived slot, appending one journal entry (PROJECT_BRIEF §6)", () => {
    const initial = [
      valueObject("obj_1", "value_1", 3),
      valueObject("obj_2", "value_2", 4),
      addObject("obj_3", "add_1", addr("obj_1", "value"), addr("obj_2", "value")),
    ];
    const operation: Operation = {
      kind: "setSlot",
      address: addr("obj_1", "value"),
      slot: { kind: "literal", value: 100 },
    };

    const result = mutate(initial, [operation], []);

    expect(result.ok).toBe(true);
    if (result.ok) {
      const add1 = result.objects.find((object) => object.id === "obj_3");
      expect(add1?.slots["out.result"]).toEqual({ kind: "derived", value: 104 }); // 100 + 4
      expect(result.journal).toEqual([{ operations: [operation] }]);
    }
  });

  it("accepts an optional EvalContext (§5.1) as its fourth argument and forwards it to evaluation", () => {
    const initial = [
      valueObject("obj_1", "value_1", 3),
      valueObject("obj_2", "value_2", 4),
      addObject("obj_3", "add_1", addr("obj_1", "value"), addr("obj_2", "value")),
    ];
    const operation: Operation = { kind: "setSlot", address: addr("obj_1", "value"), slot: { kind: "literal", value: 100 } };
    let measureCalls = 0;
    const spyContext: EvalContext = {
      measurer: {
        measure: (text) => {
          measureCalls += 1;
          return { width: text.length, height: 1 };
        },
      },
    };

    const withContext = mutate(initial, [operation], [], spyContext);
    const withDefault = mutate(initial, [operation], []);

    expect(withContext.ok).toBe(true);
    // Same graph result as the default path — `add` never consults the measurer.
    if (withContext.ok && withDefault.ok) {
      expect(withContext.objects).toEqual(withDefault.objects);
    }
    expect(measureCalls).toBe(0);
  });

  it("rejects a mutation that would introduce a cycle, naming every slot in it (PROJECT_BRIEF §6)", () => {
    const initial: GraphObject[] = [
      {
        id: "obj_1",
        name: "add_1",
        type: "add",
        slots: {
          "in.a": { kind: "literal", value: 1 },
          "in.b": { kind: "literal", value: 2 },
          "out.result": { kind: "derived", value: null },
        },
      },
    ];
    // Rebinds in.a to read the object's OWN out.result — a genuine self-cycle
    // (in.a <-> out.result), exactly like 0016's standalone detectCycle test,
    // but reached here through the real mutate() entry point.
    const operation: Operation = {
      kind: "setSlot",
      address: addr("obj_1", "in", "a"),
      slot: { kind: "formula", ast: { type: "reference", address: addr("obj_1", "out", "result") }, value: null },
    };

    const result = mutate(initial, [operation], []);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("add_1.in.a");
      expect(result.message).toContain("add_1.out.result");
    }
  });

  it("leaves the caller's objects and journal provably unchanged when a mutation is rejected (PROJECT_BRIEF §6, D-016)", () => {
    // D-016: a rejection test that only checks the return shape proves
    // nothing about state — this one deep-compares a pre-call snapshot
    // against the caller's own references AFTER the call, not just the
    // result. See this cycle's log entry for the two mutation-test runs that
    // confirm this check is real, not just shaped like one.
    const initial: GraphObject[] = [
      {
        id: "obj_1",
        name: "add_1",
        type: "add",
        slots: {
          "in.a": { kind: "literal", value: 1 },
          "in.b": { kind: "literal", value: 2 },
          "out.result": { kind: "derived", value: null },
        },
      },
    ];
    const priorJournal: MutationJournalEntry[] = [];
    const snapshotObjectsBefore = JSON.parse(JSON.stringify(initial)) as unknown;
    const snapshotJournalBefore = JSON.parse(JSON.stringify(priorJournal)) as unknown;

    const operation: Operation = {
      kind: "setSlot",
      address: addr("obj_1", "in", "a"),
      slot: { kind: "formula", ast: { type: "reference", address: addr("obj_1", "out", "result") }, value: null },
    };

    const result = mutate(initial, [operation], priorJournal);

    expect(result.ok).toBe(false); // this mutation is the same genuine cycle as the test above
    expect(initial).toEqual(snapshotObjectsBefore);
    expect(priorJournal).toEqual(snapshotJournalBefore);
  });

  it("rejects a dangling reference before ever evaluating, leaving prior state unchanged", () => {
    const initial = [valueObject("obj_1", "value_1", 1)];
    const snapshotBefore = JSON.parse(JSON.stringify(initial)) as unknown;
    const operation: Operation = {
      kind: "setSlot",
      address: addr("obj_1", "value"),
      // obj_1 only has a "value" nonDerivedSlotPath — this rewrites it to a
      // formula slot reading a nonexistent object, matching PROJECT_BRIEF
      // §5.1.1's "any formula references a slot that does not exist."
      slot: { kind: "formula", ast: { type: "reference", address: addr("obj_999", "value") }, value: null },
    };

    const result = mutate(initial, [operation], []);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("value_1.value");
    }
    expect(initial).toEqual(snapshotBefore);
  });

  it("never throws, for an accepted mutation, a rejected one, or an operation naming a nonexistent object", () => {
    const initial = [valueObject("obj_1", "value_1", 1)];
    const acceptedOp: Operation = { kind: "setSlot", address: addr("obj_1", "value"), slot: { kind: "literal", value: 2 } };
    const rejectingOp: Operation = {
      kind: "setSlot",
      address: addr("obj_1", "value"),
      slot: { kind: "formula", ast: { type: "reference", address: addr("obj_999", "value") }, value: null },
    };
    const noOtherObjectOp: Operation = { kind: "setSlot", address: addr("obj_404", "value"), slot: { kind: "literal", value: 9 } };

    expect(() => mutate(initial, [acceptedOp], [])).not.toThrow();
    expect(() => mutate(initial, [rejectingOp], [])).not.toThrow();
    expect(() => mutate(initial, [noOtherObjectOp], [])).not.toThrow();
  });

  it("rejects an operation naming a nonexistent object, rather than applying nothing and journalling a false record (D-021)", () => {
    // D-021 (0018-REVIEW-phase0), answering cycle 0017's own open question:
    // a "no-op" acceptance would append a journal entry for an operation that
    // changed nothing — indistinguishable, later, from one that did.
    const initial = [valueObject("obj_1", "value_1", 1)];
    const priorJournal: MutationJournalEntry[] = [];
    const snapshotObjectsBefore = JSON.parse(JSON.stringify(initial)) as unknown;
    const operation: Operation = { kind: "setSlot", address: addr("obj_404", "value"), slot: { kind: "literal", value: 9 } };

    const result = mutate(initial, [operation], priorJournal);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      // D-023 (0021-REVIEW): the id IS named, labelled as an id, because the
      // rejection is precisely that it resolves to no name.
      expect(result.message).toContain(`object id "obj_404"`);
      expect(result.message).toContain(`slot "value"`);
    }
    expect(initial).toEqual(snapshotObjectsBefore);
    expect(priorJournal).toEqual([]); // unchanged — nothing was journalled
  });
});

describe("mutate — D-020: the batch form (0018-REVIEW-phase0, fix 5)", () => {
  it("applies every operation in the batch to the SAME clone, in order, appending exactly ONE journal entry holding the whole list", () => {
    const initial = [valueObject("obj_1", "value_1", 3), valueObject("obj_2", "value_2", 4), addObject("obj_3", "add_1", addr("obj_1", "value"), addr("obj_2", "value"))];
    const firstOp: Operation = { kind: "setSlot", address: addr("obj_1", "value"), slot: { kind: "literal", value: 10 } };
    const secondOp: Operation = { kind: "setSlot", address: addr("obj_2", "value"), slot: { kind: "literal", value: 20 } };

    const result = mutate(initial, [firstOp, secondOp], []);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Both operations' effects are visible — derived from a SINGLE evaluation
    // pass over both changes at once, not two independent mutate() calls.
    const add1 = result.objects.find((object) => object.id === "obj_3");
    expect(add1?.slots["out.result"]).toEqual({ kind: "derived", value: 30 }); // 10 + 20
    // Exactly one journal entry, holding BOTH operations (D-020: "one
    // committed batch is one journal entry"), not two entries.
    expect(result.journal).toEqual([{ operations: [firstOp, secondOp] }]);
  });

  it("lets a LATER operation in the same batch overwrite what an EARLIER one in the same batch just wrote — last write wins", () => {
    // Both operations target the SAME slot. Mutation-tested: this fixture
    // alone does NOT distinguish "folded over one shared clone" from "each
    // operation applied to its own fresh clone of the original, keeping only
    // the last" — both produce 200 here, since nothing about an earlier
    // conflicting write to the SAME address survives either way. The test
    // above ("appends exactly ONE journal entry...", asserting 30 = 10 + 20
    // across TWO DIFFERENT slots) is the one that actually proves the shared-
    // clone claim; this one only pins last-write-wins as its own, separate,
    // observable behaviour worth having a name for.
    const initial = [valueObject("obj_1", "value_1", 1)];
    const first: Operation = { kind: "setSlot", address: addr("obj_1", "value"), slot: { kind: "literal", value: 100 } };
    const second: Operation = { kind: "setSlot", address: addr("obj_1", "value"), slot: { kind: "literal", value: 200 } };

    const result = mutate(initial, [first, second], []);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.objects[0]?.slots.value).toEqual({ kind: "literal", value: 200 });
  });

  it("rejects the WHOLE batch (all-or-nothing) when only ONE of several operations would break the graph, leaving prior state unchanged", () => {
    const initial = [
      valueObject("obj_1", "value_1", 3),
      valueObject("obj_2", "value_2", 4),
      addObject("obj_3", "add_1", addr("obj_1", "value"), addr("obj_2", "value")),
    ];
    const snapshotBefore = JSON.parse(JSON.stringify(initial)) as unknown;
    const fineOp: Operation = { kind: "setSlot", address: addr("obj_1", "value"), slot: { kind: "literal", value: 99 } };
    // The offending operation: rebinds add_1.in.a to read its own out.result — a genuine self-cycle.
    const cyclicOp: Operation = {
      kind: "setSlot",
      address: addr("obj_3", "in", "a"),
      slot: { kind: "formula", ast: { type: "reference", address: addr("obj_3", "out", "result") }, value: null },
    };

    const result = mutate(initial, [fineOp, cyclicOp], []);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("add_1.in.a");
    }
    // fineOp's change did NOT partially commit — the whole batch was discarded.
    expect(initial).toEqual(snapshotBefore);
  });

  it("rejects an empty batch outright, rather than cloning/validating/evaluating/journalling nothing", () => {
    const initial = [valueObject("obj_1", "value_1", 1)];
    const snapshotBefore = JSON.parse(JSON.stringify(initial)) as unknown;

    const result = mutate(initial, [], []);

    expect(result.ok).toBe(false);
    expect(initial).toEqual(snapshotBefore);
  });

  it("rejects the whole batch, naming EVERY operation with a nonexistent target, not just the first (D-021 across a batch)", () => {
    const initial = [valueObject("obj_1", "value_1", 1)];
    const firstMissing: Operation = { kind: "setSlot", address: addr("obj_404", "value"), slot: { kind: "literal", value: 1 } };
    const fine: Operation = { kind: "setSlot", address: addr("obj_1", "value"), slot: { kind: "literal", value: 2 } };
    const secondMissing: Operation = { kind: "setSlot", address: addr("obj_405", "x", "y"), slot: { kind: "literal", value: 3 } };

    const result = mutate(initial, [firstMissing, fine, secondMissing], []);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      // D-023 (0021-REVIEW): the two offending operations must be tellable
      // APART. Naming only the slot path printed the same sentence twice
      // whenever two missing objects shared a path.
      expect(result.message).toContain(`operation 1 of 3`);
      expect(result.message).toContain(`operation 3 of 3`);
      expect(result.message).toContain(`object id "obj_404"`);
      expect(result.message).toContain(`object id "obj_405"`);
      expect(result.message).toContain(`slot "value"`); // firstMissing's target slot path
      expect(result.message).toContain(`slot "x.y"`); // secondMissing's target slot path
      expect(result.message).not.toContain("operation 2 of 3"); // the fine one is not blamed
    }
  });
});

describe("validateIntegrity — D-018: schema/slot reconciliation is two-way (0018-REVIEW-phase0)", () => {
  it("rejects an object MISSING its schema-declared derived slot, naming it (D-018 part 1)", () => {
    // Exactly the shape a §5.11 load produces: DerivedSlot.value is never
    // serialized, so a naive load hands mutation.ts an `add` with no
    // out.result at all.
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
    const edges = deriveEdges(objects);
    // The hazard D-018 exists to close: deriveEdges still emits two edges
    // pointing at a slot that does not exist.
    expect(edges.filter((edge) => addressKey(edge.dependentSlot) === "obj_3::out.result")).toHaveLength(2);

    const result = validateIntegrity(objects, edges);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("add_1.out.result");
    }
    expect(deriveValidateAndEvaluate(objects).ok).toBe(false);
  });

  it("rejects a slot whose kind disagrees with its schema-declared position: non-derived at a derived path (D-018 part 2)", () => {
    const objects: GraphObject[] = [
      {
        id: "obj_3",
        name: "add_1",
        type: "add",
        slots: {
          "in.a": { kind: "literal", value: 1 },
          "in.b": { kind: "literal", value: 2 },
          "out.result": { kind: "literal", value: 999 }, // wrong kind at a schema-declared derived path
        },
      },
    ];
    const edges = deriveEdges(objects);

    const result = validateIntegrity(objects, edges);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("add_1.out.result");
    }
  });

  it("rejects a slot whose kind disagrees with its schema-declared position: derived at a non-derived path (D-018 part 2)", () => {
    const objects: GraphObject[] = [
      {
        id: "obj_3",
        name: "add_1",
        type: "add",
        slots: {
          "in.a": { kind: "derived", value: null }, // wrong kind — a nonDerivedSlotPaths entry
          "in.b": { kind: "literal", value: 2 },
          "out.result": { kind: "derived", value: null },
        },
      },
    ];
    const edges = deriveEdges(objects);

    const result = validateIntegrity(objects, edges);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("add_1.in.a");
    }
  });

  it("rejects, via the real mutate() entry point, a setSlot that would overwrite a DERIVED slot with a literal (D-018 part 2)", () => {
    // §5.1: "derived is fixed by schema and can never be converted; attempting
    // to link or set a derived slot is rejected." Rule 2 makes mutation.ts the
    // only place that rejection can live.
    const objects = [
      valueObject("obj_1", "value_1", 3),
      valueObject("obj_2", "value_2", 4),
      addObject("obj_3", "add_1", addr("obj_1", "value"), addr("obj_2", "value")),
    ];
    const snapshotBefore = JSON.parse(JSON.stringify(objects)) as unknown;
    const operation: Operation = {
      kind: "setSlot",
      address: addr("obj_3", "out", "result"),
      slot: { kind: "literal", value: 999 },
    };

    const result = mutate(objects, [operation], []);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("add_1.out.result");
    }
    expect(objects).toEqual(snapshotBefore); // prior state unchanged (D-016)
  });
});

describe("mutate — D-019: the step-1 clone preserves every member of Value, not just what JSON can represent (0018-REVIEW-phase0)", () => {
  // D-025 (Q-006, cycle 0023) landed AFTER this describe block was first
  // written: non-finite numbers are no longer legal document state. The
  // ORIGINAL version of this test committed NaN/+Infinity/-Infinity as part
  // of its fixture and asserted ACCEPTANCE — that fixture is now illegal, so
  // this is a changed test expectation (PROCESS_BRIEF §6.1 trigger 5,
  // authorized by D-025 itself, disclosed in cycle 0023's log entry). Split
  // in two: fidelity for what remains LEGAL (below), and D-025's rejection of
  // what no longer is (next describe block) — which itself depends on this
  // same clone fidelity, see that block's own comment.
  it("commits null, a Point, a Point[], and an ErrorValue unchanged through an UNRELATED mutation — everything JSON cannot round-trip faithfully EXCEPT a non-finite number", () => {
    // 'value' schema declares only its own "value" path (schema.ts) — every
    // other key here is an extra literal slot, which validateIntegrity does
    // not restrict (only formula/derived-kind slots are checked against the
    // schema; D-025's finiteness check is the only one that touches literals,
    // and none of these values are numbers at all).
    const fidelityObject: GraphObject = {
      id: "obj_1",
      name: "value_1",
      type: "value",
      slots: {
        value: { kind: "literal", value: 1 },
        nullSlot: { kind: "literal", value: null },
        pointSlot: { kind: "literal", value: { x: 1, y: 2 } },
        pointsSlot: {
          kind: "literal",
          value: [
            { x: 1, y: 2 },
            { x: 3, y: 4 },
          ],
        },
        errorSlot: { kind: "literal", value: { error: "#REF", message: "boom" } },
      },
    };
    const other = valueObject("obj_2", "value_2", 10);
    // Names ONLY obj_2 — obj_1 does not appear anywhere in this operation,
    // matching exactly the shape 0018-REVIEW-phase0 verified D-019 through.
    const operation: Operation = { kind: "setSlot", address: addr("obj_2", "value"), slot: { kind: "literal", value: 20 } };

    const result = mutate([fidelityObject, other], [operation], []);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const committed = result.objects.find((object) => object.id === "obj_1");
    expect(committed?.slots.nullSlot).toEqual({ kind: "literal", value: null });
    expect(committed?.slots.pointSlot).toEqual({ kind: "literal", value: { x: 1, y: 2 } });
    expect(committed?.slots.pointsSlot).toEqual({
      kind: "literal",
      value: [
        { x: 1, y: 2 },
        { x: 3, y: 4 },
      ],
    });
    expect(committed?.slots.errorSlot).toEqual({ kind: "literal", value: { error: "#REF", message: "boom" } });
  });
});

describe("mutate — D-025: non-finite numbers are not legal document state (Q-006, ruled by the human directly, cycle 0023)", () => {
  it("rejects a setSlot writing a non-finite literal (NaN, +Infinity, -Infinity in turn), naming the slot, prior state unchanged", () => {
    for (const nonFinite of [NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const initial = [valueObject("obj_1", "value_1", 1)];
      const snapshotBefore = JSON.parse(JSON.stringify(initial)) as unknown;
      const operation: Operation = { kind: "setSlot", address: addr("obj_1", "value"), slot: { kind: "literal", value: nonFinite } };

      const result = mutate(initial, [operation], []);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.message).toContain("value_1.value");
        expect(result.message).toContain("D-025");
      }
      expect(initial).toEqual(snapshotBefore);
    }
  });

  it("rejects a mutation touching an UNRELATED object when the document ALREADY holds a non-finite literal elsewhere, naming the pre-existing offender (Rule 5: recheck the whole graph)", () => {
    // The illegal value is not introduced by this operation at all — it was
    // already sitting on obj_1 before the call. D-025 rechecks the WHOLE
    // graph every time (the same discipline D-017/D-018/dangling-reference
    // already use), not just what this operation touched.
    const alreadyIllegal: GraphObject = {
      id: "obj_1",
      name: "value_1",
      type: "value",
      slots: { value: { kind: "literal", value: Number.POSITIVE_INFINITY } },
    };
    const other = valueObject("obj_2", "value_2", 1);
    const operation: Operation = { kind: "setSlot", address: addr("obj_2", "value"), slot: { kind: "literal", value: 2 } };

    const result = mutate([alreadyIllegal, other], [operation], []);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("value_1.value");
    }
    // Prior state unchanged (D-016) — checked field-by-field rather than via a
    // JSON-round-tripped snapshot, because JSON is exactly what would silently
    // turn this test's own Infinity fixture into null (D-019's own point).
    expect(alreadyIllegal.slots.value).toEqual({ kind: "literal", value: Number.POSITIVE_INFINITY });
    expect(other.slots.value).toEqual({ kind: "literal", value: 1 });
  });

  it("rejects a non-finite number nested inside a Point literal (x or y)", () => {
    const initial: GraphObject[] = [
      {
        id: "obj_1",
        name: "value_1",
        type: "value",
        slots: { value: { kind: "literal", value: 1 }, originSlot: { kind: "literal", value: { x: NaN, y: 0 } } },
      },
    ];
    const operation: Operation = { kind: "setSlot", address: addr("obj_1", "value"), slot: { kind: "literal", value: 2 } };

    const result = mutate(initial, [operation], []);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("value_1.originSlot");
    }
  });

  it("accepts a legal, finite `add` sum, and rejects one that would overflow to a non-finite result via #TYPE, never committing Infinity", () => {
    const initial = [
      valueObject("obj_1", "value_1", 3),
      valueObject("obj_2", "value_2", 4),
      addObject("obj_3", "add_1", addr("obj_1", "value"), addr("obj_2", "value")),
    ];
    const finite = deriveValidateAndEvaluate(initial);
    expect(finite.ok).toBe(true);
    if (finite.ok) {
      expect(finite.objects.find((object) => object.id === "obj_3")?.slots["out.result"]).toEqual({ kind: "derived", value: 7 });
    }

    // Rebind both inputs to overflow-sized literals, then re-evaluate: add's
    // own compute (primitives/schema.ts) maps the non-finite sum to #TYPE
    // itself. This is NOT redundant with validateIntegrity's D-025 check —
    // that check runs BEFORE evaluate and never re-inspects what evaluate
    // just produced, so add's own guard is the ONLY thing standing between a
    // finite input pair and a committed raw Infinity (see this cycle's log
    // entry for the mutation-test that removes add's guard and shows exactly
    // that: mutate still returns ok:true, holding Infinity).
    const overflowing = [
      valueObject("obj_1", "value_1", Number.MAX_VALUE),
      valueObject("obj_2", "value_2", Number.MAX_VALUE),
      addObject("obj_3", "add_1", addr("obj_1", "value"), addr("obj_2", "value")),
    ];
    const overflowed = deriveValidateAndEvaluate(overflowing);
    expect(overflowed.ok).toBe(true); // an ErrorValue is legitimate graph state, not a rejection (§5.1)
    if (overflowed.ok) {
      const result = overflowed.objects.find((object) => object.id === "obj_3")?.slots["out.result"];
      expect(result).toMatchObject({ kind: "derived", value: { error: "#TYPE" } });
    }
  });

  it("(correctness link to D-019) a lossy clone would have hidden the illegal value from this check entirely", () => {
    // Not a mutation-test experiment on THIS cycle's own new code — it
    // probes why D-019 (closed 0019, unchanged here) still matters now that
    // Q-006 has landed: if cloneObjects ever regressed to a JSON round-trip,
    // NaN would silently become `null` — a LEGAL value — before this
    // describe block's own rejection check ever ran, and the document below
    // would be wrongly ACCEPTED instead of correctly rejected. Demonstrated
    // here by asserting the ACTUAL (real clone) behaviour is rejection; see
    // this cycle's log entry for the paired mutation-test run that reverts
    // the clone and shows this same assertion then fails.
    const initial = [valueObject("obj_1", "value_1", 1)];
    const operation: Operation = { kind: "setSlot", address: addr("obj_1", "value"), slot: { kind: "literal", value: NaN } };

    const result = mutate(initial, [operation], []);

    expect(result.ok).toBe(false);
  });
});

describe("mutate — CreateObjectOperation (§5.11's loader primitive, cycle 0024)", () => {
  it("creates a brand-new object into an EMPTY graph, appending one journal entry", () => {
    const newObject: GraphObject = { id: "obj_1", name: "value_1", type: "value", slots: { value: { kind: "literal", value: 42 } } };
    const operation: Operation = { kind: "createObject", object: newObject };

    const result = mutate([], [operation], []);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.objects).toEqual([newObject]);
    expect(result.journal).toEqual([{ operations: [operation] }]);
  });

  it("creates several objects in ONE batch, including a formula binding between two objects created in the SAME batch", () => {
    // This is exactly document.ts's shape: every object of a saved document
    // created together, so a formula slot can reference a sibling object
    // that's ALSO being created in this same call — neither exists yet at
    // the start of the batch, so this only works because the existence
    // simulation ADDS each id as its createObject is processed (cycle 0024).
    const value1: GraphObject = { id: "obj_1", name: "value_1", type: "value", slots: { value: { kind: "literal", value: 3 } } };
    const value2: GraphObject = { id: "obj_2", name: "value_2", type: "value", slots: { value: { kind: "literal", value: 4 } } };
    const add1 = addObject("obj_3", "add_1", addr("obj_1", "value"), addr("obj_2", "value"));
    const operations: Operation[] = [
      { kind: "createObject", object: value1 },
      { kind: "createObject", object: value2 },
      { kind: "createObject", object: add1 },
    ];

    const result = mutate([], operations, []);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.objects.find((object) => object.id === "obj_3")?.slots["out.result"]).toEqual({ kind: "derived", value: 7 });
  });

  it("rejects creating an object whose id ALREADY exists, leaving prior state unchanged (D-002/D-021)", () => {
    const initial = [valueObject("obj_1", "value_1", 1)];
    const snapshotBefore = JSON.parse(JSON.stringify(initial)) as unknown;
    const duplicate: GraphObject = { id: "obj_1", name: "value_1_again", type: "value", slots: { value: { kind: "literal", value: 2 } } };
    const operation: Operation = { kind: "createObject", object: duplicate };

    const result = mutate(initial, [operation], []);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain(`object id "obj_1"`);
      expect(result.message).toContain("ALREADY exists");
    }
    expect(initial).toEqual(snapshotBefore);
  });

  it("rejects a batch that creates the SAME id twice, blaming only the second occurrence", () => {
    const first: Operation = { kind: "createObject", object: valueObject("obj_1", "value_1", 1) };
    const second: Operation = { kind: "createObject", object: valueObject("obj_1", "value_1_dup", 2) };

    const result = mutate([], [first, second], []);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("operation 2 of 2");
      expect(result.message).not.toContain("operation 1 of 2");
    }
  });

  it("clones the created object into committed state (D-024) — the caller's own payload is not aliased", () => {
    const payload: GraphObject = { id: "obj_1", name: "value_1", type: "value", slots: { value: { kind: "literal", value: 1 } } };
    const operation: Operation = { kind: "createObject", object: payload };

    const result = mutate([], [operation], []);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.objects[0]).toEqual(payload);
    expect(result.objects[0]).not.toBe(payload);
  });

  it("rejects creating an object that would introduce a dangling reference or a cycle, via validateIntegrity, unchanged", () => {
    const dangling: GraphObject = addObject("obj_1", "add_1", addr("obj_999", "value"), addr("obj_1", "value"));
    const operation: Operation = { kind: "createObject", object: dangling };

    const result = mutate([], [operation], []);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("add_1.in.a");
    }
  });
});

describe("mutate — D-024: nothing the caller hands mutate enters committed state or the journal by reference", () => {
  it("clones the operation's own Slot into committed state, so two operations sharing one payload do not share one committed slot", () => {
    const initial = [valueObject("obj_1", "value_1", 1), valueObject("obj_2", "value_2", 2)];
    const sharedPayload: Slot = { kind: "literal", value: 7 };
    const operations: Operation[] = [
      { kind: "setSlot", address: addr("obj_1", "value"), slot: sharedPayload },
      { kind: "setSlot", address: addr("obj_2", "value"), slot: sharedPayload },
    ];

    const result = mutate(initial, operations, []);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const first = result.objects[0]?.slots["value"];
    const second = result.objects[1]?.slots["value"];
    expect(first).toEqual({ kind: "literal", value: 7 });
    expect(first).not.toBe(sharedPayload); // committed state holds its own copy
    expect(first).not.toBe(second); // and two slots are two objects, not one aliased twice
  });

  it("stores the journal's own copy of the batch, so the caller's array cannot rewrite recorded history", () => {
    const initial = [valueObject("obj_1", "value_1", 1)];
    const operations: Operation[] = [{ kind: "setSlot", address: addr("obj_1", "value"), slot: { kind: "literal", value: 5 } }];

    const result = mutate(initial, operations, []);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.journal[0]?.operations).toEqual(operations);
    expect(result.journal[0]?.operations).not.toBe(operations);
    expect(result.journal[0]?.operations[0]).not.toBe(operations[0]);
  });
});

describe("mutate — DeleteObjectOperation (§5.1.1's `delete <object>`, closes Phase 0 acceptance clause 3, cycle 0022)", () => {
  it("deletes an object with no dependents, removing it from the result and appending one journal entry", () => {
    const initial = [valueObject("obj_1", "value_1", 10), valueObject("obj_2", "value_2", 20)];
    const operation: Operation = { kind: "deleteObject", objectId: "obj_2" };

    const result = mutate(initial, [operation], []);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.objects.map((object) => object.id)).toEqual(["obj_1"]);
    expect(result.journal).toEqual([{ operations: [operation] }]);
  });

  it("rejects deleting an object a formula elsewhere still depends on, naming the dependent and leaving prior state unchanged (PROJECT_BRIEF §6 clause 3, D-016)", () => {
    // No new rejection mechanism: deleting obj_1 makes add_1's in.a edge
    // dangle exactly the way a typo'd formula reference already does, and
    // validateIntegrity's existing dangling-reference check (§5.1.1) is what
    // rejects it — see DeleteObjectOperation's own doc comment.
    const initial = [
      valueObject("obj_1", "value_1", 3),
      valueObject("obj_2", "value_2", 4),
      addObject("obj_3", "add_1", addr("obj_1", "value"), addr("obj_2", "value")),
    ];
    const snapshotBefore = JSON.parse(JSON.stringify(initial)) as unknown;
    const operation: Operation = { kind: "deleteObject", objectId: "obj_1" };

    const result = mutate(initial, [operation], []);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("add_1.in.a");
    }
    expect(initial).toEqual(snapshotBefore); // prior state provably unchanged
  });

  it("accepts deleting an object whose ONLY dependent is being deleted in the SAME batch", () => {
    // Both obj_1 (the dependency) and add_1 (its only dependent) are removed
    // together — the resulting graph has no dangling edge at all, because
    // add_1's own formula/derived slots are gone along with it.
    const initial = [
      valueObject("obj_1", "value_1", 3),
      valueObject("obj_2", "value_2", 4),
      addObject("obj_3", "add_1", addr("obj_1", "value"), addr("obj_2", "value")),
    ];
    const deleteValue: Operation = { kind: "deleteObject", objectId: "obj_1" };
    const deleteAdd: Operation = { kind: "deleteObject", objectId: "obj_3" };

    const result = mutate(initial, [deleteValue, deleteAdd], []);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.objects.map((object) => object.id)).toEqual(["obj_2"]);
  });

  it("rejects deleting an object that does not exist, naming the id as an id (D-021/D-023, deleteObject variant)", () => {
    const initial = [valueObject("obj_1", "value_1", 1)];
    const operation: Operation = { kind: "deleteObject", objectId: "obj_404" };

    const result = mutate(initial, [operation], []);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain(`attempts to delete object id "obj_404"`);
      expect(result.message).toContain("does not exist in this document");
    }
  });

  it("rejects the WHOLE batch when an EARLIER operation deletes an object a LATER operation in the SAME batch still targets (fold-aware existence check)", () => {
    // The pre-batch-only existence check 0019/0020 shipped would have passed
    // this — obj_1 exists when the batch STARTS. It must be checked against
    // the id set as it would exist at the moment each operation folds.
    const initial = [valueObject("obj_1", "value_1", 1)];
    const deleteOp: Operation = { kind: "deleteObject", objectId: "obj_1" };
    const laterSetOp: Operation = { kind: "setSlot", address: addr("obj_1", "value"), slot: { kind: "literal", value: 2 } };

    const result = mutate(initial, [deleteOp, laterSetOp], []);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("operation 2 of 2");
      expect(result.message).toContain(`object id "obj_1"`);
    }
  });

  it("rejects a batch that deletes the SAME object twice, blaming only the second occurrence", () => {
    const initial = [valueObject("obj_1", "value_1", 1)];
    const first: Operation = { kind: "deleteObject", objectId: "obj_1" };
    const second: Operation = { kind: "deleteObject", objectId: "obj_1" };

    const result = mutate(initial, [first, second], []);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("operation 2 of 2");
      expect(result.message).not.toContain("operation 1 of 2");
    }
  });

  it("accepts a batch that deletes one object and mutates an unrelated one in the SAME transaction, appending one journal entry", () => {
    const initial = [valueObject("obj_1", "value_1", 1), valueObject("obj_2", "value_2", 2)];
    const deleteOp: Operation = { kind: "deleteObject", objectId: "obj_1" };
    const setOp: Operation = { kind: "setSlot", address: addr("obj_2", "value"), slot: { kind: "literal", value: 99 } };

    const result = mutate(initial, [deleteOp, setOp], []);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.objects.map((object) => object.id)).toEqual(["obj_2"]);
    expect(result.objects[0]?.slots.value).toEqual({ kind: "literal", value: 99 });
    expect(result.journal).toEqual([{ operations: [deleteOp, setOp] }]);
  });
});

describe("mutate — DeleteObjectOperation's `force` flag (entry 0053, closing Phase 2's LAST acceptance clause: `delete <table>` rejected-until-force)", () => {
  it("rejects `delete <table>` BY DEFAULT (force absent) when a live formula depends on one of its cells — the REJECT half, unchanged since cycle 0022", () => {
    const table = tableObject("obj_1", "table_x", 3, 1, { "cells.A1": { kind: "literal", value: 10 } });
    const dependent: GraphObject = {
      id: "obj_2",
      name: "value_1",
      type: "value",
      slots: { value: { kind: "formula", ast: { type: "reference", address: addr("obj_1", "cells", "A1") }, value: 10 } },
    };
    const snapshotBefore = JSON.parse(JSON.stringify([table, dependent])) as unknown;

    const result = mutate([table, dependent], [{ kind: "deleteObject", objectId: "obj_1" }], []);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("value_1.value");
    }
    expect([table, dependent]).toEqual(snapshotBefore); // step 6: prior state provably unchanged.
  });

  it("`force: true` REPAIRS a live REFERENCE dependent to #REF instead of rejecting, removes the table, and reports the broken slot in `brokenSlots` (D-056/D-057) — the force half, closing the clause", () => {
    const table = tableObject("obj_1", "table_x", 3, 1, { "cells.A1": { kind: "literal", value: 10 } });
    const dependent: GraphObject = {
      id: "obj_2",
      name: "value_1",
      type: "value",
      slots: { value: { kind: "formula", ast: { type: "reference", address: addr("obj_1", "cells", "A1") }, value: 10 } },
    };

    const result = mutate([table, dependent], [{ kind: "deleteObject", objectId: "obj_1", force: true }], []);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.objects.map((object) => object.id)).toEqual(["obj_2"]); // table gone.

    const repaired = result.objects.find((object) => object.id === "obj_2");
    expect(repaired?.slots.value).toMatchObject({ kind: "formula", ast: { type: "error", error: "#REF" } });
    expect((repaired?.slots.value as { value: unknown }).value).toMatchObject({ error: "#REF" });

    expect(result.brokenSlots).toEqual([{ objectId: "obj_2", path: ["value"] }]);

    // No dangling edge either — re-deriving and re-validating the COMMITTED
    // result must still be internally consistent (D-018's own standard),
    // same check the row/column deletion demonstration test already makes.
    expect(deriveValidateAndEvaluate(result.objects).ok).toBe(true);
  });

  it("`force: true` repairs a RANGE dependent with an endpoint on the deleted table to #REF ENTIRELY, per D-056/0051-REVIEW §9 answer 3 — no remaining extent to clamp to", () => {
    const table = tableObject("obj_1", "table_x", 3, 1, {
      "cells.A1": { kind: "literal", value: 1 },
      "cells.A2": { kind: "literal", value: 2 },
      "cells.A3": { kind: "literal", value: 3 },
    });
    const dependent: GraphObject = {
      id: "obj_2",
      name: "value_1",
      type: "value",
      slots: {
        value: {
          kind: "formula",
          ast: { type: "functionCall", name: "SUM", args: [{ type: "range", start: addr("obj_1", "cells", "A1"), end: addr("obj_1", "cells", "A3") }] },
          value: 6,
        },
      },
    };

    const result = mutate([table, dependent], [{ kind: "deleteObject", objectId: "obj_1", force: true }], []);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const repaired = result.objects.find((object) => object.id === "obj_2");
    // D-028: the ErrorNode replaces the RangeNode AT ITS OWN POSITION, not the
    // whole formula — the SUM(...) call survives, its one argument becomes #REF.
    expect(repaired?.slots.value).toMatchObject({ kind: "formula", ast: { type: "functionCall", name: "SUM", args: [{ type: "error", error: "#REF" }] } });
    expect(result.brokenSlots).toEqual([{ objectId: "obj_2", path: ["value"] }]);
  });

  it("`force: true` on an object with NO dependents simply removes it, reporting an empty `brokenSlots`", () => {
    const table = tableObject("obj_1", "table_x", 2, 1, {});

    const result = mutate([table], [{ kind: "deleteObject", objectId: "obj_1", force: true }], []);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.objects).toEqual([]);
    expect(result.brokenSlots).toEqual([]);
  });

  it("`force: true` reports a slot broken by TWO DIFFERENT references into the deleted table only ONCE (dedup, `mutate`'s own doc comment)", () => {
    const table = tableObject("obj_1", "table_x", 1, 1, { "cells.A1": { kind: "literal", value: 1 } });
    const dependent: GraphObject = {
      id: "obj_2",
      name: "value_1",
      type: "value",
      slots: {
        value: {
          kind: "formula",
          ast: {
            type: "binaryOp",
            operator: "+",
            left: { type: "reference", address: addr("obj_1", "cells", "A1") },
            right: { type: "reference", address: addr("obj_1", "rows") },
          },
          value: 2,
        },
      },
    };

    const result = mutate([table, dependent], [{ kind: "deleteObject", objectId: "obj_1", force: true }], []);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.brokenSlots).toEqual([{ objectId: "obj_2", path: ["value"] }]); // once, not twice.
  });

  // D-059 (0054-REVIEW-phase2, reviewer edit): the report must name only
  // slots that still EXIST once the whole batch has committed. Both tests
  // below reported a slot on an already-deleted object before the fix —
  // probed against the built code at review, then re-run after it.
  it("does NOT report a slot broken by an EARLIER operation when a LATER operation in the SAME batch deletes the object carrying it (D-059)", () => {
    const table = tableObject("obj_1", "table_x", 1, 1, { "cells.A1": { kind: "literal", value: 1 } });
    const dependent: GraphObject = {
      id: "obj_2",
      name: "value_1",
      type: "value",
      slots: { value: { kind: "formula", ast: { type: "reference", address: addr("obj_1", "cells", "A1") }, value: 1 } },
    };

    const result = mutate(
      [table, dependent],
      [
        { kind: "deleteObject", objectId: "obj_1", force: true },
        { kind: "deleteObject", objectId: "obj_2", force: true },
      ],
      [],
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.objects).toEqual([]);
    // obj_2.value WAS rewritten to #REF by operation 1 — but operation 2
    // removed the object carrying it, so there is nothing left to repair and
    // nothing `formatAddress` could name.
    expect(result.brokenSlots).toEqual([]);
  });

  it("does NOT report a cell broken by a row deletion when the SAME batch then force-deletes that whole table (D-059)", () => {
    const table = tableObject("obj_1", "table_x", 3, 2, {
      "cells.A1": { kind: "literal", value: 1 },
      "cells.A2": { kind: "literal", value: 2 },
      "cells.B1": { kind: "formula", ast: { type: "reference", address: addr("obj_1", "cells", "A2") }, value: 2 },
    });

    const result = mutate(
      [table],
      [
        { kind: "deleteTableLine", objectId: "obj_1", axis: "row", index: 2 },
        { kind: "deleteObject", objectId: "obj_1", force: true },
      ],
      [],
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.objects).toEqual([]);
    expect(result.brokenSlots).toEqual([]);
  });

  // D-016 mutation check: confirm the `force` gate is genuinely load-bearing,
  // not merely exercised. Temporarily inverted `operation.force !== true` to
  // `operation.force === true` (swapping which branch runs) directly in
  // mutation.ts and re-ran this whole describe block — 4 of the 5 tests above
  // failed (the exception: "on an object with NO dependents" passes under
  // EITHER branch, since there is nothing to reject or repair either way —
  // expected, not a gap). Restored the real condition and re-ran the full
  // suite (green, see this entry's log). Recorded here rather than automated:
  // the mutant is a one-line manual edit to `applyOperation`, not a fixture
  // this test file can express on its own.
});

describe("mutate — D-025's rejection says WHICH non-finite value it found (reviewer edit, 0025-REVIEW-phase0)", () => {
  // The message interpolated the offending value directly, so a non-finite
  // number nested inside a Point/Point[] printed as "[object Object]" — a
  // rejection that names the slot but cannot say what is wrong with it. Same
  // defect, and same §5.1 step 6 requirement, as D-023 fixed for D-021's own
  // message. JSON.stringify would not have helped: it renders NaN/±Infinity
  // as null, which is the very corruption this check exists to catch.
  it("names the offending coordinate inside a Point literal, not [object Object]", () => {
    const initial: GraphObject[] = [
      { id: "obj_1", name: "value_1", type: "value", slots: { origin: { kind: "literal", value: { x: Number.NEGATIVE_INFINITY, y: 2 } } } },
    ];
    const operation: Operation = { kind: "setSlot", address: addr("obj_1", "other"), slot: { kind: "literal", value: 1 } };

    const result = mutate(initial, [operation], []);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("{ x: -Infinity, y: 2 }");
      expect(result.message).not.toContain("[object Object]");
    }
  });

  it("names the offending point inside a Point[] literal", () => {
    const initial: GraphObject[] = [
      { id: "obj_1", name: "value_1", type: "value", slots: { vertices: { kind: "literal", value: [{ x: 0, y: 0 }, { x: 1, y: NaN }] } } },
    ];
    const operation: Operation = { kind: "setSlot", address: addr("obj_1", "other"), slot: { kind: "literal", value: 1 } };

    const result = mutate(initial, [operation], []);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("{ x: 1, y: NaN }");
      expect(result.message).not.toContain("[object Object]");
    }
  });
});

describe("mutate — Q-008: -0 is not legal document state (PROVISIONAL, recommendation (a), 0025-REVIEW-phase0, enforced cycle 0026)", () => {
  it("rejects a setSlot writing a bare -0 literal, naming the slot, prior state unchanged, distinguishing it from legal 0", () => {
    const initial = [valueObject("obj_1", "value_1", 1)];
    const snapshotBefore = JSON.parse(JSON.stringify(initial)) as unknown;
    const operation: Operation = { kind: "setSlot", address: addr("obj_1", "value"), slot: { kind: "literal", value: -0 } };

    const result = mutate(initial, [operation], []);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("value_1.value");
      expect(result.message).toContain("D-025/Q-008");
      expect(result.message).toContain("-0"); // not "0" — Q-008's own defect if it printed that
    }
    expect(initial).toEqual(snapshotBefore);
  });

  it("accepts a setSlot writing plain 0 — Q-008 is specifically about the SIGN, not zero itself", () => {
    const initial = [valueObject("obj_1", "value_1", 1)];
    const operation: Operation = { kind: "setSlot", address: addr("obj_1", "value"), slot: { kind: "literal", value: 0 } };

    const result = mutate(initial, [operation], []);

    expect(result.ok).toBe(true);
  });

  it("rejects a -0 nested inside a Point literal (x or y)", () => {
    const initial: GraphObject[] = [{ id: "obj_1", name: "value_1", type: "value", slots: { value: { kind: "literal", value: 1 } } }];
    const operation: Operation = { kind: "setSlot", address: addr("obj_1", "origin"), slot: { kind: "literal", value: { x: -0, y: 3 } } };

    const result = mutate(initial, [operation], []);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("{ x: -0, y: 3 }");
    }
  });
});

describe("mutate — D-025/Q-008 on the OPERATION PAYLOAD, before staging, closing 0025-REVIEW-phase0 finding 1's write side (cycle 0026)", () => {
  it("(probe A) rejects a batch where an EARLIER setSlot carries an illegal value even though a LATER setSlot in the SAME batch overwrites it — nothing partially commits, nothing is journalled", () => {
    // 0025-REVIEW-phase0's own probe: mutate([setSlot v=Infinity, setSlot
    // v=5]) previously returned ok:true (committed value 5, correct — but
    // journal[0].operations[0].slot.value was Infinity, never checked).
    // findIllegalSlotValues alone can never catch this: it only ever sees the
    // POST-FOLD graph, and the fold's final value (5) is perfectly legal.
    const initial = [valueObject("obj_1", "value_1", 1)];
    const snapshotBefore = JSON.parse(JSON.stringify(initial)) as unknown;
    const illegalFirst: Operation = { kind: "setSlot", address: addr("obj_1", "value"), slot: { kind: "literal", value: Number.POSITIVE_INFINITY } };
    const legalSecond: Operation = { kind: "setSlot", address: addr("obj_1", "value"), slot: { kind: "literal", value: 5 } };

    const result = mutate(initial, [illegalFirst, legalSecond], []);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("operation 1 of 2");
      expect(result.message).toContain("value_1.value");
      expect(result.message).toContain("D-025/Q-008");
    }
    expect(initial).toEqual(snapshotBefore);
  });

  it("(probe F) rejects a batch that creates an object with an illegal slot even though the SAME batch deletes that object afterward", () => {
    // The other half of 0025-REVIEW-phase0's probes: the illegal payload
    // never survives the fold (the object is gone by the time the candidate
    // graph is checked), so findIllegalSlotValues would see nothing wrong —
    // but the CREATE operation's payload itself was illegal, and it still
    // would have entered the journal.
    const illegalObject: GraphObject = { id: "obj_2", name: "value_2", type: "value", slots: { value: { kind: "literal", value: NaN } } };
    const create: Operation = { kind: "createObject", object: illegalObject };
    const deleteAfter: Operation = { kind: "deleteObject", objectId: "obj_2" };

    const result = mutate([], [create, deleteAfter], []);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("operation 1 of 2");
      expect(result.message).toContain("value_2.value");
      expect(result.message).toContain("D-025/Q-008");
    }
  });

  it("rejects a createObject whose payload holds an illegal value, naming the object and slot, without needing the object to exist in `objects` first", () => {
    const illegalObject: GraphObject = { id: "obj_1", name: "value_1", type: "value", slots: { value: { kind: "literal", value: Number.NEGATIVE_INFINITY } } };
    const operation: Operation = { kind: "createObject", object: illegalObject };

    const result = mutate([], [operation], []);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("value_1.value");
      expect(result.message).toContain("-Infinity");
    }
  });

  it("gathers EVERY illegal slot on a createObject payload, not just the first", () => {
    const illegalObject: GraphObject = {
      id: "obj_1",
      name: "value_1",
      type: "value",
      slots: { value: { kind: "literal", value: NaN }, other: { kind: "literal", value: -0 } },
    };
    const operation: Operation = { kind: "createObject", object: illegalObject };

    const result = mutate([], [operation], []);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("value_1.value");
      expect(result.message).toContain("value_1.other");
    }
  });

  it("gathers EVERY offending operation across the whole batch, not just the first", () => {
    const firstIllegal: Operation = { kind: "setSlot", address: addr("obj_1", "value"), slot: { kind: "literal", value: NaN } };
    const fine: Operation = { kind: "setSlot", address: addr("obj_1", "value"), slot: { kind: "literal", value: 1 } };
    const secondIllegal: Operation = { kind: "setSlot", address: addr("obj_1", "value"), slot: { kind: "literal", value: -0 } };
    const initial = [valueObject("obj_1", "value_1", 1)];

    const result = mutate(initial, [firstIllegal, fine, secondIllegal], []);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("operation 1 of 3");
      expect(result.message).toContain("operation 3 of 3");
      expect(result.message).not.toContain("operation 2 of 3");
    }
  });

  it("does not reject a batch whose payloads are all legal, even when the post-fold graph is exactly the same shape as an illegal one would be", () => {
    // Sanity check that this new precondition is not over-broad: a perfectly
    // ordinary accepted batch must still succeed.
    const initial = [valueObject("obj_1", "value_1", 1)];
    const operation: Operation = { kind: "setSlot", address: addr("obj_1", "value"), slot: { kind: "literal", value: 42 } };

    const result = mutate(initial, [operation], []);

    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The DYNAMIC SLOT FAMILY (D-017's own forward note; solved this cycle, per
// 0041-REVIEW-phase2 §9's naming of it as Phase 2's critical path):
// `primitives/schema.ts`'s `table` entry declares `rows`/`cols` as a fixed
// `static` group and `cells.*` as a `dynamic` one
// (`primitives/table.ts`'s `enumerateTableCellSlotPaths`). These tests prove
// `deriveEdges`/`validateIntegrity` treat a table's cells exactly the way they
// already treat `value`/`add`'s fixed slots — including the D-017 failure mode
// (a formula slot the object carries but the CURRENT resolution does not
// declare) reached, for the first time, through a family whose membership
// depends on the object's own state rather than a compile-time list.
// ---------------------------------------------------------------------------

/** A table object (§5.4): `rows`/`cols` as literal number slots, plus whatever cell slots are given. */
function tableObject(id: string, name: string, rows: number, cols: number, cellSlots: Record<string, Slot> = {}): GraphObject {
  return {
    id,
    name,
    type: "table",
    slots: {
      rows: { kind: "literal", value: rows },
      cols: { kind: "literal", value: cols },
      ...cellSlots,
    },
  };
}

describe("deriveEdges — table's dynamic cell family (D-017/0041-REVIEW-phase2 §9)", () => {
  it("derives a binding edge for a formula cell within the table's current rows/cols, and none for a literal cell", () => {
    const objects = [
      valueObject("obj_1", "value_1", 42),
      tableObject("obj_2", "table_x", 2, 2, {
        "cells.A1": { kind: "formula", ast: { type: "reference", address: addr("obj_1", "value") }, value: null },
        "cells.B1": { kind: "literal", value: 7 },
      }),
    ];

    const edges = deriveEdges(objects);

    expectSameEdges(edges, [{ sourceSlot: addr("obj_1", "value"), dependentSlot: addr("obj_2", "cells", "A1") }]);
  });

  it("derives edges for every populated cell across the table's whole current extent, not just A1", () => {
    const objects = [
      valueObject("obj_1", "value_1", 1),
      valueObject("obj_2", "value_2", 2),
      tableObject("obj_3", "table_x", 2, 2, {
        "cells.A1": { kind: "formula", ast: { type: "reference", address: addr("obj_1", "value") }, value: null },
        "cells.B2": { kind: "formula", ast: { type: "reference", address: addr("obj_2", "value") }, value: null },
      }),
    ];

    expectSameEdges(deriveEdges(objects), [
      { sourceSlot: addr("obj_1", "value"), dependentSlot: addr("obj_3", "cells", "A1") },
      { sourceSlot: addr("obj_2", "value"), dependentSlot: addr("obj_3", "cells", "B2") },
    ]);
  });

  it("derives no edge for a formula cell OUTSIDE the table's current rows/cols — the dynamic-family analogue of D-017's fixed-list gap", () => {
    // rows=1, cols=1 declares only cells.A1 — cells.C5 is a formula slot the
    // OBJECT carries but the current resolution does not produce.
    const objects = [
      valueObject("obj_1", "value_1", 9),
      tableObject("obj_2", "table_x", 1, 1, {
        "cells.C5": { kind: "formula", ast: { type: "reference", address: addr("obj_1", "value") }, value: null },
      }),
    ];

    expect(deriveEdges(objects)).not.toContainEqual({
      sourceSlot: addr("obj_1", "value"),
      dependentSlot: addr("obj_2", "cells", "C5"),
    });
  });

  it("a formula cell in one table may reference a cell in a DIFFERENT table (§5.4: tables are self-contained but may reference each other)", () => {
    const objects = [
      tableObject("obj_1", "table_a", 1, 1, { "cells.A1": { kind: "literal", value: 3 } }),
      tableObject("obj_2", "table_b", 1, 1, {
        "cells.A1": { kind: "formula", ast: { type: "reference", address: addr("obj_1", "cells", "A1") }, value: null },
      }),
    ];

    expectSameEdges(deriveEdges(objects), [
      { sourceSlot: addr("obj_1", "cells", "A1"), dependentSlot: addr("obj_2", "cells", "A1") },
    ]);
  });
});

describe("validateIntegrity — D-017 rejects a table's stray out-of-extent formula cell", () => {
  it("rejects a formula cell the object carries but the table's current rows/cols do not declare, naming it", () => {
    const objects = [
      valueObject("obj_1", "value_1", 9),
      tableObject("obj_2", "table_x", 1, 1, {
        "cells.C5": { kind: "formula", ast: { type: "reference", address: addr("obj_1", "value") }, value: null },
      }),
    ];
    const edges = deriveEdges(objects);

    const result = validateIntegrity(objects, edges);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("table_x.cells.C5");
    }
  });

  it("accepts the same table once its rows/cols actually cover the formula cell", () => {
    const objects = [
      valueObject("obj_1", "value_1", 9),
      tableObject("obj_2", "table_x", 5, 5, {
        "cells.C5": { kind: "formula", ast: { type: "reference", address: addr("obj_1", "value") }, value: null },
      }),
    ];
    const edges = deriveEdges(objects);

    expect(validateIntegrity(objects, edges)).toEqual({ ok: true });
  });

  it("D-018's other direction still applies: a cell WITHIN the declared extent that is 'derived'-kind is rejected (tables declare no derived slots)", () => {
    const objects: GraphObject[] = [
      tableObject("obj_1", "table_x", 1, 1, {
        "cells.A1": { kind: "derived", value: 5 },
      }),
    ];
    const edges = deriveEdges(objects);

    const result = validateIntegrity(objects, edges);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      // formatAddress prints the table cell's SURFACE form (D-005/D-008), not
      // the written-out "cells.A1" stored path — "table_x.A1", not
      // "table_x.cells.A1".
      expect(result.message).toContain("table_x.A1");
      expect(result.message).toContain("derived");
    }
  });

  // D-022's own instruction, pinned here for the first time it applies: "Pin
  // it with a test comparing the two for every registered type, so the day a
  // table gets a schema entry the divergence fails loudly instead of shipping
  // a wrong name." That day is this cycle. `describeUndeclaredSlot`'s raw-key
  // style (D-017's own naming for a slot with no schema-declared path to
  // format) produces "table_x.cells.C5" for the stray cell above; formatAddress
  // would print the shorter surface form, "table_x.C5" (D-005/D-008's cell
  // shorthand), for the IDENTICAL Address. Both spellings resolve to the same
  // stored slot (D-043) — nothing is factually wrong, and D-017's rejection is
  // still correct — but the bounded-correctness CLAIM D-022 relied on
  // ("identical to formatAddress's") no longer holds for `table`. Disclosed in
  // this cycle's log entry rather than silently fixed: closing it cleanly
  // needs either inverting a slot key (D-010 forbids it) or teaching
  // mutation.ts itself which keys belong to a table's cell family, which
  // reintroduces the exact table-specific special-casing this cycle's design
  // was written to avoid.
  it("D-022's bounded-correctness claim (describeUndeclaredSlot matches formatAddress) no longer holds for table — disclosed, not fixed", () => {
    const objects = [tableObject("obj_2", "table_x", 1, 1, {})];
    const rawKeyNaming = "table_x.cells.C5"; // what findUndeclaredFormulaOrDerivedSlots's message contains, above
    const surfaceForm = formatAddress(addr("obj_2", "cells", "C5"), objects);
    expect(rawKeyNaming).not.toBe(surfaceForm);
    expect(surfaceForm).toBe("table_x.C5");
  });
});

describe("mutate — end-to-end through a real table object (D-017/0041-REVIEW-phase2 §9)", () => {
  it("creates a table and a value, binds a cell to the value by formula, and evaluates it live", () => {
    const value = valueObject("obj_1", "value_1", 42);
    const table = tableObject("obj_2", "table_x", 1, 1, {
      "cells.A1": { kind: "formula", ast: { type: "reference", address: addr("obj_1", "value") }, value: null },
    });

    const result = mutate([], [{ kind: "createObject", object: value }, { kind: "createObject", object: table }], []);

    expect(result.ok).toBe(true);
    if (result.ok) {
      const tableResult = result.objects.find((object) => object.id === "obj_2");
      expect(tableResult?.slots["cells.A1"]).toMatchObject({ kind: "formula", value: 42 });
    }
  });

  it("rejects creating a table whose formula cell falls outside its own declared rows/cols", () => {
    const table = tableObject("obj_1", "table_x", 1, 1, {
      "cells.B2": { kind: "formula", ast: { type: "reference", address: addr("obj_9", "value") }, value: null },
    });

    const result = mutate([], [{ kind: "createObject", object: table }], []);

    expect(result.ok).toBe(false);
  });

  it("rejects a genuine cycle running entirely through two tables' cells", () => {
    // table_a.A1 = table_b.A1, table_b.A1 = table_a.A1 — a real self-inclusive
    // cycle through the dynamic family, the same class D-016 requires a
    // fixture whose own order does not already look sorted.
    const tableA = tableObject("obj_1", "table_a", 1, 1, {
      "cells.A1": { kind: "formula", ast: { type: "reference", address: addr("obj_2", "cells", "A1") }, value: null },
    });
    const tableB = tableObject("obj_2", "table_b", 1, 1, {
      "cells.A1": { kind: "formula", ast: { type: "reference", address: addr("obj_1", "cells", "A1") }, value: null },
    });

    const result = mutate([], [{ kind: "createObject", object: tableA }, { kind: "createObject", object: tableB }], []);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("cyclic dependency");
    }
  });
});

// ---------------------------------------------------------------------------
// D-046 (0043-REVIEW finding 1) — RULE 6: a table's dimension slots must be
// `literal`, so the declared cell family can never be a function of an
// EVALUATED value. Before the `readTableDimension` guard these two tests
// pinned real, reachable defects: `rows` as a formula slot let evaluation
// (step 7, after edge derivation and validateIntegrity have run) grow or
// shrink the declared extent, and `mutate` committed `ok: true` on a document
// that its OWN validateIntegrity rejected on the next pass.
// ---------------------------------------------------------------------------

describe("table dimensions are literal-only — Rule 6 (D-046)", () => {
  /** A table whose `rows` is a FORMULA slot with the given cached value. */
  function tableWithFormulaRows(cachedRows: number, cellSlots: Record<string, Slot>): GraphObject {
    return {
      id: "obj_2",
      name: "table_x",
      type: "table",
      slots: {
        rows: { kind: "formula", ast: { type: "reference", address: addr("obj_1", "value") }, value: cachedRows },
        cols: { kind: "literal", value: 1 },
        ...cellSlots,
      },
    };
  }

  it("declares no cells at all for a table whose rows slot is a formula, rather than trusting its cached value", () => {
    const table = tableWithFormulaRows(3, {});

    // Not "three rows' worth of paths from the cached 3" — none, because a
    // formula slot's value is written by evaluation and must never size the
    // slot set (Rule 6).
    expect(enumerateTableCellSlotPaths(table)).toEqual([]);
  });

  it("rejects a formula cell on a formula-dimensioned table instead of committing state its own validateIntegrity would reject", () => {
    const value = valueObject("obj_1", "value_1", 3);
    const other = valueObject("obj_3", "value_2", 99);
    const table = tableWithFormulaRows(3, {
      "cells.A3": { kind: "formula", ast: { type: "reference", address: addr("obj_3", "value") }, value: 99 },
    });
    const objects = [value, other, table];

    // The document is refused up front: with no declared cells, D-017's check
    // catches `cells.A3` as an undeclared formula slot.
    const rejection = validateIntegrity(objects, deriveEdges(objects));
    expect(rejection.ok).toBe(false);
    if (!rejection.ok) {
      expect(rejection.message).toContain("table_x.cells.A3");
    }

    // And the mutation that used to commit `ok: true` here — shrinking the
    // table by evaluation alone — is refused too, so no committed document can
    // fail its own re-validation.
    const result = mutate(objects, [{ kind: "setSlot", address: addr("obj_1", "value"), slot: { kind: "literal", value: 1 } }], []);
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// D-097 (0100-REVIEW-phase4, the human's "vanishing table"): a plain `setSlot`
// writing `table`'s `rows`/`cols` is bounded at EVERY write, not only at
// `insertTableLine`/`deleteTableLine` (which `findInvalidTableResizes` above
// already covers) or at creation (`command/commands.ts`'s own check). One
// test per row of D-097's ruling table, each asserting the refusal AND that
// the document is bit-for-bit unchanged (Rule 2's rejection invariant).
// ---------------------------------------------------------------------------

// The human's 2026-09-02 report: an in-place edit of an EMPTY table cell that
// typed nothing left the cell holding `""` — "although it looks empty visually,
// it's not anymore." There was no way to express "make this cell empty again":
// D-047 makes an ABSENT slot the empty state, `setSlot` only ever writes one,
// and every `Value` (`""` and `0` included) is content.
describe("mutate — ClearSlotOperation: emptying a table cell by REMOVING its slot (2026-09-02)", () => {
  it("removes the slot entirely rather than writing an empty value into it", () => {
    const table = tableObject("obj_1", "table_x", 2, 2, { "cells.A1": { kind: "literal", value: "hello" } });
    const result = mutate([table], [{ kind: "clearSlot", address: addr("obj_1", "cells", "A1") }], []);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const cleared = result.objects.find((object) => object.id === "obj_1");
      expect(cleared?.slots["cells.A1"]).toBeUndefined();
      expect(Object.keys(cleared?.slots ?? {})).not.toContain("cells.A1");
    }
  });

  it("leaves every other slot on the object untouched", () => {
    const table = tableObject("obj_1", "table_x", 2, 2, {
      "cells.A1": { kind: "literal", value: 1 },
      "cells.B1": { kind: "literal", value: 2 },
    });
    const result = mutate([table], [{ kind: "clearSlot", address: addr("obj_1", "cells", "A1") }], []);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const cleared = result.objects.find((object) => object.id === "obj_1");
      expect(cleared?.slots["cells.B1"]).toEqual({ kind: "literal", value: 2 });
      expect(cleared?.slots["rows"]).toEqual({ kind: "literal", value: 2 });
    }
  });

  it("does not mutate the caller's own object (step 6 / D-024)", () => {
    const table = tableObject("obj_1", "table_x", 2, 2, { "cells.A1": { kind: "literal", value: "hello" } });
    const snapshotBefore = JSON.parse(JSON.stringify([table])) as unknown;
    mutate([table], [{ kind: "clearSlot", address: addr("obj_1", "cells", "A1") }], []);
    expect([table]).toEqual(snapshotBefore);
  });

  it("journals the clear like any other operation (D-020: one entry holding the whole batch)", () => {
    const table = tableObject("obj_1", "table_x", 2, 2, { "cells.A1": { kind: "literal", value: "hello" } });
    const result = mutate([table], [{ kind: "clearSlot", address: addr("obj_1", "cells", "A1") }], []);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.journal).toHaveLength(1);
    }
  });

  it("clearing a cell a formula elsewhere READS is legal — an empty in-extent cell reads 0 and contributes no edge (D-110 clause 4), so nothing dangles", () => {
    const table = tableObject("obj_1", "table_x", 2, 2, {
      "cells.A1": { kind: "literal", value: 10 },
      "cells.B1": { kind: "formula", ast: { type: "reference", address: addr("obj_1", "cells", "A1") }, value: 10 },
    });
    const result = mutate([table], [{ kind: "clearSlot", address: addr("obj_1", "cells", "A1") }], []);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // The dependent re-evaluates against the now-empty cell rather than breaking.
      expect(result.objects.find((object) => object.id === "obj_1")?.slots["cells.B1"]?.value).toBe(0);
    }
  });

  it("clearing an ALREADY-absent cell is legal and simply changes nothing", () => {
    const table = tableObject("obj_1", "table_x", 2, 2, {});
    const result = mutate([table], [{ kind: "clearSlot", address: addr("obj_1", "cells", "A1") }], []);
    expect(result.ok).toBe(true);
  });

  it("REFUSES a clear at anything but a table cell — only D-047 settles what an absent slot means", () => {
    const objects = [valueObject("obj_1", "value_a", 5)];
    const result = mutate(objects, [{ kind: "clearSlot", address: addr("obj_1", "in", "value") }], []);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("cannot be cleared");
      expect(result.message).toContain("D-047");
    }
  });

  it("REFUSES a clear of a table's own `rows` slot — a table cell means a cell, not any slot on a table", () => {
    const table = tableObject("obj_1", "table_x", 2, 2, {});
    const result = mutate([table], [{ kind: "clearSlot", address: addr("obj_1", "rows") }], []);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("table_x.rows");
    }
  });

  it("REFUSES a clear naming an object that does not exist, through the SAME existence check every other operation uses (D-021)", () => {
    const table = tableObject("obj_1", "table_x", 2, 2, {});
    const result = mutate([table], [{ kind: "clearSlot", address: addr("obj_404", "cells", "A1") }], []);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("D-021");
    }
  });
});

describe("mutate — findInvalidDimensionWrites (D-097): a setSlot bounding table rows/cols at write time", () => {
  const REJECTED_ROWS_WRITES: readonly { readonly label: string; readonly slot: Slot }[] = [
    { label: "a formula (evaluation could resize the table, Rule 6)", slot: { kind: "formula", ast: { type: "literal", value: 5 }, value: 5 } },
    { label: "zero", slot: { kind: "literal", value: 0 } },
    { label: "a negative number", slot: { kind: "literal", value: -2 } },
    { label: "a non-integer", slot: { kind: "literal", value: 2.5 } },
  ];

  for (const { label, slot } of REJECTED_ROWS_WRITES) {
    it(`rejects a setSlot writing ${label} to table_x.rows, leaving prior state bit-for-bit unchanged`, () => {
      const table = tableObject("obj_1", "table_x", 3, 3, {});
      const snapshotBefore = JSON.parse(JSON.stringify([table])) as unknown;

      const result = mutate([table], [{ kind: "setSlot", address: addr("obj_1", "rows"), slot }], []);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.message).toContain("table_x.rows");
        expect(result.message).toContain("Rule 6");
      }
      expect([table]).toEqual(snapshotBefore); // step 6: prior state provably untouched.
    });
  }

  it("rejects the same shape (zero) for cols, symmetric to rows", () => {
    const table = tableObject("obj_1", "table_x", 3, 3, {});
    const result = mutate([table], [{ kind: "setSlot", address: addr("obj_1", "cols"), slot: { kind: "literal", value: 0 } }], []);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("table_x.cols");
    }
  });

  it("a legal set table_x.rows 5 still commits and GROWS the declared cell family", () => {
    const table = tableObject("obj_1", "table_x", 3, 3, {});

    const result = mutate([table], [{ kind: "setSlot", address: addr("obj_1", "rows"), slot: { kind: "literal", value: 5 } }], []);

    expect(result.ok).toBe(true);
    if (result.ok) {
      const resized = result.objects.find((object) => object.id === "obj_1");
      expect(resized?.slots.rows).toMatchObject({ value: 5 });
      expect(resized === undefined ? [] : enumerateTableCellSlotPaths(resized)).toHaveLength(5 * 3);
    }
  });

  it("validates a setSlot on a table created EARLIER IN THE SAME BATCH — not skipped, mirroring findInvalidTableResizes' own same-batch case", () => {
    const table = tableObject("obj_1", "table_x", 2, 2, {});

    const result = mutate(
      [],
      [
        { kind: "createObject", object: table },
        { kind: "setSlot", address: addr("obj_1", "rows"), slot: { kind: "literal", value: 0 } },
      ],
      [],
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("operation 2 of 2");
    }
  });

  it("leaves a NON-table object's own 'rows'-named literal slot alone — an undeclared literal is ordinary legal state (D-017)", () => {
    const notATable = valueObject("obj_1", "value_1", 1);
    // `value` declares no "rows" path at all — this check is about `table`'s
    // dynamic sizing slot specifically, not any slot that happens to share the name.
    const result = mutate([notATable], [{ kind: "setSlot", address: addr("obj_1", "rows"), slot: { kind: "literal", value: -1 } }], []);
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The range-evaluation wiring (D-036's five constraints). These are the
// end-to-end proofs closest to PROJECT_BRIEF §6 Phase 2's own acceptance
// criterion, built from hand-written table fixtures; see each test's own note
// for which clause it demonstrates. Row/column insert and delete landed at
// entries 0047/0050 and are tested in their own blocks above; object creation
// landed at entry 0075 and lives in `command/commands.test.ts`, which builds
// its tables from real typed lines rather than fixtures.
// ---------------------------------------------------------------------------

describe("mutate — two separate tables, a cross-table formula, live update (Phase 2 criterion clause 1, real end-to-end)", () => {
  it("table_a.B2 holds a formula reading table_b.C3 * 2 and updates live when table_b.C3 changes", () => {
    const tableB = tableObject("obj_2", "table_b", 3, 3, { "cells.C3": { kind: "literal", value: 10 } });
    const tableA = tableObject("obj_1", "table_a", 2, 2, {
      "cells.B2": {
        kind: "formula",
        ast: { type: "binaryOp", operator: "*", left: { type: "reference", address: addr("obj_2", "cells", "C3") }, right: { type: "literal", value: 2 } },
        value: null,
      },
    });

    const created = mutate([], [{ kind: "createObject", object: tableB }, { kind: "createObject", object: tableA }], []);
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }
    expect(created.objects.find((o) => o.id === "obj_1")?.slots["cells.B2"]).toMatchObject({ value: 20 });

    // Change the SOURCE cell — table_a.B2 must recompute, live, in the SAME
    // mutation that only touched table_b.
    const updated = mutate(created.objects, [{ kind: "setSlot", address: addr("obj_2", "cells", "C3"), slot: { kind: "literal", value: 100 } }], created.journal);
    expect(updated.ok).toBe(true);
    if (updated.ok) {
      expect(updated.objects.find((o) => o.id === "obj_1")?.slots["cells.B2"]).toMatchObject({ value: 200 });
    }
  });
});

describe("mutate — a circular reference between two tables, running through a RANGE this time, is rejected (Phase 2 criterion clause 2)", () => {
  it("table_a.A1 = SUM(table_b.A1:A1), table_b.A1 = SUM(table_a.A1:A1) — a genuine cycle through range-derived edges", () => {
    const tableA = tableObject("obj_1", "table_a", 1, 1, {
      "cells.A1": {
        kind: "formula",
        ast: { type: "functionCall", name: "SUM", args: [{ type: "range", start: addr("obj_2", "cells", "A1"), end: addr("obj_2", "cells", "A1") }] },
        value: null,
      },
    });
    const tableB = tableObject("obj_2", "table_b", 1, 1, {
      "cells.A1": {
        kind: "formula",
        ast: { type: "functionCall", name: "SUM", args: [{ type: "range", start: addr("obj_1", "cells", "A1"), end: addr("obj_1", "cells", "A1") }] },
        value: null,
      },
    });

    const result = mutate([], [{ kind: "createObject", object: tableA }, { kind: "createObject", object: tableB }], []);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("cyclic dependency");
    }
  });

  it("a self-inclusive range (A6 = SUM(A1:A6)) is a genuine self-edge and is correctly rejected as a cycle — §5.3: 'do not special-case it'", () => {
    const table = tableObject("obj_1", "table_x", 6, 1, {
      "cells.A1": { kind: "literal", value: 1 },
      "cells.A2": { kind: "literal", value: 1 },
      "cells.A3": { kind: "literal", value: 1 },
      "cells.A4": { kind: "literal", value: 1 },
      "cells.A5": { kind: "literal", value: 1 },
      "cells.A6": {
        kind: "formula",
        ast: { type: "functionCall", name: "SUM", args: [{ type: "range", start: addr("obj_1", "cells", "A1"), end: addr("obj_1", "cells", "A6") }] },
        value: null,
      },
    });

    const result = mutate([], [{ kind: "createObject", object: table }], []);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("cyclic dependency");
    }
  });
});

describe("mutate — SUM(A1:A5) recomputes correctly as cell values change (Phase 2 criterion clause 3's LIVE-UPDATE half; the row-INSERT half needs the still-deferred resize cycle — see STATUS.md)", () => {
  it("recomputes when a cell WITHIN the range changes, in the same batch that changed only that cell", () => {
    const table = tableObject("obj_1", "table_x", 5, 1, {
      "cells.A1": { kind: "literal", value: 1 },
      "cells.A2": { kind: "literal", value: 1 },
      "cells.A3": { kind: "literal", value: 1 },
      "cells.A4": { kind: "literal", value: 1 },
      "cells.A5": {
        kind: "formula",
        ast: { type: "functionCall", name: "SUM", args: [{ type: "range", start: addr("obj_1", "cells", "A1"), end: addr("obj_1", "cells", "A4") }] },
        value: null,
      },
    });

    const created = mutate([], [{ kind: "createObject", object: table }], []);
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }
    expect(created.objects.find((o) => o.id === "obj_1")?.slots["cells.A5"]).toMatchObject({ value: 4 });

    const updated = mutate(created.objects, [{ kind: "setSlot", address: addr("obj_1", "cells", "A2"), slot: { kind: "literal", value: 10 } }], created.journal);
    expect(updated.ok).toBe(true);
    if (updated.ok) {
      expect(updated.objects.find((o) => o.id === "obj_1")?.slots["cells.A5"]).toMatchObject({ value: 13 });
    }
  });
});

describe("deriveEdges/mutate — D-044: range expansion is bounded by the table's CURRENT extent, re-derived every call, never cached", () => {
  it("SUM(A1:Z99) over a small table only sums the cells that actually exist", () => {
    const table = tableObject("obj_1", "table_x", 2, 2, {
      "cells.A1": { kind: "literal", value: 1 },
      "cells.B1": { kind: "literal", value: 2 },
      "cells.A2": { kind: "literal", value: 3 },
      "cells.B2": { kind: "literal", value: 4 },
    });
    const sumConsumer: GraphObject = {
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

    const result = mutate([], [{ kind: "createObject", object: table }, { kind: "createObject", object: sumConsumer }], []);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.objects.find((o) => o.id === "obj_2")?.slots.value).toMatchObject({ value: 10 });
    }
  });

  it("the SAME range expands to MORE edges once the table's rows/cols grow — never a cached expansion from the first call", () => {
    const small = tableObject("obj_1", "table_x", 1, 1, { "cells.A1": { kind: "literal", value: 1 } });
    const rangeFormula: Slot = {
      kind: "formula",
      ast: { type: "functionCall", name: "SUM", args: [{ type: "range", start: addr("obj_1", "cells", "A1"), end: addr("obj_1", "cells", "B2") }] },
      value: null,
    };
    const consumer: GraphObject = { id: "obj_2", name: "value_1", type: "value", slots: { value: rangeFormula } };

    const smallEdges = deriveEdges([small, consumer]);
    expect(smallEdges).toHaveLength(1); // only A1 exists yet.

    const grown = tableObject("obj_1", "table_x", 2, 2, {
      "cells.A1": { kind: "literal", value: 1 },
      "cells.B1": { kind: "literal", value: 2 },
      "cells.A2": { kind: "literal", value: 3 },
      "cells.B2": { kind: "literal", value: 4 },
    });
    const grownEdges = deriveEdges([grown, consumer]);
    expect(grownEdges).toHaveLength(4); // the SAME range now spans all four cells.
  });
});

describe("deriveEdges — a range naming a table that does not resolve falls back to ONE edge from its own start address, so the dangling-reference check still catches and names it (the defensive arm; D-045 rejects the reachable authored case at parse time)", () => {
  it("a range dependency whose table id does not exist in objects still produces a dangling edge, not a silently-dropped dependency", () => {
    const consumer: GraphObject = {
      id: "obj_1",
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

    const edges = deriveEdges([consumer]);
    expect(edges).toEqual([{ sourceSlot: addr("obj_missing", "cells", "A1"), dependentSlot: addr("obj_1", "value") }]);

    const result = validateIntegrity([consumer], edges);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("value_1.value");
    }
  });

  it("this is what makes `delete <table>` correctly REJECTED while a range elsewhere still names it — deleting the table the range depends on leaves a dangling edge, the same way deleting a plainly-referenced object already does", () => {
    const table = tableObject("obj_1", "table_x", 1, 1, { "cells.A1": { kind: "literal", value: 1 } });
    const consumer: GraphObject = {
      id: "obj_2",
      name: "value_1",
      type: "value",
      slots: {
        value: {
          kind: "formula",
          ast: { type: "functionCall", name: "SUM", args: [{ type: "range", start: addr("obj_1", "cells", "A1"), end: addr("obj_1", "cells", "A1") }] },
          value: null,
        },
      },
    };

    const created = mutate([], [{ kind: "createObject", object: table }, { kind: "createObject", object: consumer }], []);
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    const deletion = mutate(created.objects, [{ kind: "deleteObject", objectId: "obj_1" }], created.journal);
    expect(deletion.ok).toBe(false);
  });
});

describe("deriveEdges/mutate — D-047: an EMPTY cell inside a range is skipped, not an error, so an aggregate over a PARTIALLY populated table commits (0045-REVIEW Finding 1's fix)", () => {
  it("SUM(A1:A5) over a table with genuinely ABSENT cells (no slot at all) commits and sums only the cells that exist", () => {
    const table = tableObject("obj_1", "table_x", 5, 1, {
      "cells.A1": { kind: "literal", value: 1 },
      // A2 intentionally absent — no slot at all.
      "cells.A3": { kind: "literal", value: 3 },
      // A4 intentionally absent.
      "cells.A5": { kind: "literal", value: 5 },
    });
    const consumer: GraphObject = {
      id: "obj_2",
      name: "value_1",
      type: "value",
      slots: {
        value: {
          kind: "formula",
          ast: { type: "functionCall", name: "SUM", args: [{ type: "range", start: addr("obj_1", "cells", "A1"), end: addr("obj_1", "cells", "A5") }] },
          value: null,
        },
      },
    };

    const result = mutate([], [{ kind: "createObject", object: table }, { kind: "createObject", object: consumer }], []);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.objects.find((o) => o.id === "obj_2")?.slots.value).toMatchObject({ value: 9 });
    }
  });

  it("the SAME sum, with the gaps holding an explicit `null` literal instead of no slot at all — both representations of empty must agree (D-047 item 3)", () => {
    const table = tableObject("obj_1", "table_x", 5, 1, {
      "cells.A1": { kind: "literal", value: 1 },
      "cells.A2": { kind: "literal", value: null },
      "cells.A3": { kind: "literal", value: 3 },
      "cells.A4": { kind: "literal", value: null },
      "cells.A5": { kind: "literal", value: 5 },
    });
    const consumer: GraphObject = {
      id: "obj_2",
      name: "value_1",
      type: "value",
      slots: {
        value: {
          kind: "formula",
          ast: { type: "functionCall", name: "SUM", args: [{ type: "range", start: addr("obj_1", "cells", "A1"), end: addr("obj_1", "cells", "A5") }] },
          value: null,
        },
      },
    };

    const result = mutate([], [{ kind: "createObject", object: table }, { kind: "createObject", object: consumer }], []);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.objects.find((o) => o.id === "obj_2")?.slots.value).toMatchObject({ value: 9 });
    }
  });

  it("AVG(A1:A5) divides by the COUNT OF NON-EMPTY cells, not the range's full span — the clause most likely to regress silently", () => {
    const table = tableObject("obj_1", "table_x", 5, 1, {
      "cells.A1": { kind: "literal", value: 2 },
      "cells.A3": { kind: "literal", value: 4 },
      "cells.A5": { kind: "literal", value: 6 },
    });
    const consumer: GraphObject = {
      id: "obj_2",
      name: "value_1",
      type: "value",
      slots: {
        value: {
          kind: "formula",
          ast: { type: "functionCall", name: "AVG", args: [{ type: "range", start: addr("obj_1", "cells", "A1"), end: addr("obj_1", "cells", "A5") }] },
          value: null,
        },
      },
    };

    const result = mutate([], [{ kind: "createObject", object: table }, { kind: "createObject", object: consumer }], []);

    expect(result.ok).toBe(true);
    if (result.ok) {
      // (2+4+6)/3 = 4, NOT /5 (which would be 2.4).
      expect(result.objects.find((o) => o.id === "obj_2")?.slots.value).toMatchObject({ value: 4 });
    }
  });

  it("a range where NO cell in the range exists at all commits and returns the aggregate's own empty answer (SUM's 0), not #REF", () => {
    const table = tableObject("obj_1", "table_x", 5, 1); // no cell slots whatsoever.
    const consumer: GraphObject = {
      id: "obj_2",
      name: "value_1",
      type: "value",
      slots: {
        value: {
          kind: "formula",
          ast: { type: "functionCall", name: "SUM", args: [{ type: "range", start: addr("obj_1", "cells", "A1"), end: addr("obj_1", "cells", "A5") }] },
          value: null,
        },
      },
    };

    const result = mutate([], [{ kind: "createObject", object: table }, { kind: "createObject", object: consumer }], []);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.objects.find((o) => o.id === "obj_2")?.slots.value).toMatchObject({ value: 0 });
    }
  });

  it("a plain ReferenceNode (not a range) to an ABSENT slot OUTSIDE a table (or to an unknown object) is STILL rejected as a dangling reference — D-110 clause 6's boundary, formerly D-047 item 4's", () => {
    const nowhere: GraphObject = {
      id: "obj_2",
      name: "value_1",
      type: "value",
      slots: {
        // References an object that does not exist at all — not a table cell
        // question, so D-110 has nothing to say about it (clause 6).
        value: { kind: "formula", ast: { type: "reference", address: addr("obj_9", "value") }, value: null },
      },
    };

    const result = mutate([], [{ kind: "createObject", object: nowhere }], []);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("does not exist");
    }
  });
});

// ---------------------------------------------------------------------------
// D-110 (the human's ruling on Q-018, at entry 0114-REVIEW-phase4-gate): a
// bare reference to an EMPTY cell within an EXISTING table's current extent
// reads as the number `0` instead of being a dangling reference — reversing
// D-047 clause 4's bare-reference half FOR CELLS ONLY. D-111 clause 3 binds
// this cycle to pin clause 5 (the cycle-appears-once-populated case)
// executably — see the last test below.
// ---------------------------------------------------------------------------

describe("mutate — D-110: a bare reference to an EMPTY IN-EXTENT table cell reads as 0, and gets no edge, instead of being refused", () => {
  it("clause 1: accepts a formula referencing an in-extent cell with NO SLOT AT ALL, and it reads as 0", () => {
    const table = tableObject("obj_1", "table_x", 2, 1, { "cells.A1": { kind: "literal", value: 1 } }); // A2 absent.
    const consumer: GraphObject = {
      id: "obj_2",
      name: "value_1",
      type: "value",
      slots: {
        value: { kind: "formula", ast: { type: "reference", address: addr("obj_1", "cells", "A2") }, value: null },
      },
    };

    const result = mutate([], [{ kind: "createObject", object: table }, { kind: "createObject", object: consumer }], []);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.objects.find((o) => o.id === "obj_2")?.slots.value).toMatchObject({ value: 0 });
    }
  });

  it("clause 2: a cell that EXISTS holding an explicit `null` literal reads as 0 too — both spellings of empty must agree", () => {
    const table = tableObject("obj_1", "table_x", 2, 1, {
      "cells.A1": { kind: "literal", value: 1 },
      "cells.A2": { kind: "literal", value: null },
    });
    const consumer: GraphObject = {
      id: "obj_2",
      name: "value_1",
      type: "value",
      slots: {
        value: { kind: "formula", ast: { type: "reference", address: addr("obj_1", "cells", "A2") }, value: null },
      },
    };

    const result = mutate([], [{ kind: "createObject", object: table }, { kind: "createObject", object: consumer }], []);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.objects.find((o) => o.id === "obj_2")?.slots.value).toMatchObject({ value: 0 });
    }
  });

  it("clause 3: arithmetic over an empty cell uses the coerced 0, not a special case — `= A2 + 1` on an empty A2 is 1", () => {
    const table = tableObject("obj_1", "table_x", 2, 1, { "cells.A1": { kind: "literal", value: 1 } }); // A2 absent.
    const consumer: GraphObject = {
      id: "obj_2",
      name: "value_1",
      type: "value",
      slots: {
        value: {
          kind: "formula",
          ast: { type: "binaryOp", operator: "+", left: { type: "reference", address: addr("obj_1", "cells", "A2") }, right: { type: "literal", value: 1 } },
          value: null,
        },
      },
    };

    const result = mutate([], [{ kind: "createObject", object: table }, { kind: "createObject", object: consumer }], []);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.objects.find((o) => o.id === "obj_2")?.slots.value).toMatchObject({ value: 1 });
    }
  });

  it("clause 3: SUM(A2, 1) — an empty cell as an EXPLICIT SCALAR argument, not a range member — also coerces to 0, unlike SUM(A2, null) which stays #TYPE", () => {
    const table = tableObject("obj_1", "table_x", 2, 1, { "cells.A1": { kind: "literal", value: 1 } }); // A2 absent.
    const consumer: GraphObject = {
      id: "obj_2",
      name: "value_1",
      type: "value",
      slots: {
        value: {
          kind: "formula",
          ast: { type: "functionCall", name: "SUM", args: [{ type: "reference", address: addr("obj_1", "cells", "A2") }, { type: "literal", value: 1 }] },
          value: null,
        },
      },
    };

    const result = mutate([], [{ kind: "createObject", object: table }, { kind: "createObject", object: consumer }], []);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.objects.find((o) => o.id === "obj_2")?.slots.value).toMatchObject({ value: 1 });
    }
  });

  it("clause 4: deriveEdges emits NO edge at all for a reference to an empty in-extent cell — mutation-checked (dropping the guard makes this fail)", () => {
    const objects = [
      tableObject("obj_1", "table_x", 2, 1, { "cells.A1": { kind: "literal", value: 1 } }), // A2 absent.
      {
        id: "obj_2",
        name: "value_1",
        type: "value" as const,
        slots: { value: { kind: "formula" as const, ast: { type: "reference" as const, address: addr("obj_1", "cells", "A2") }, value: null } },
      },
    ];

    expectSameEdges(deriveEdges(objects), []); // NOT [{ sourceSlot: A2, dependentSlot: value_1.value }] — verified by hand against the guard removed.
  });

  it("clause 6's other boundary: a cell OUTSIDE the table's extent is STILL a dangling reference — D-044 gives it no bound to be legal within", () => {
    const table = tableObject("obj_1", "table_x", 2, 1, { "cells.A1": { kind: "literal", value: 1 } }); // extent is A1:A2 only.
    const consumer: GraphObject = {
      id: "obj_2",
      name: "value_1",
      type: "value",
      slots: {
        // A5 is past the table's 2-row extent — not "empty", genuinely dangling.
        value: { kind: "formula", ast: { type: "reference", address: addr("obj_1", "cells", "A5") }, value: null },
      },
    };

    const result = mutate([], [{ kind: "createObject", object: table }, { kind: "createObject", object: consumer }], []);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("does not exist");
    }
  });

  it("clause 5 (D-111 clause 3's own pin): a cycle that only exists once the empty cell is populated is accepted while empty and caught at the mutation that populates it — prior state left bit-for-bit unchanged by the refusal", () => {
    // table_x.A2 = table_x.A1, with A1 intentionally absent — legal and
    // acyclic per clause 1, since A1 contributes no edge while it is empty.
    const table = tableObject("obj_1", "table_x", 2, 1, {
      "cells.A2": { kind: "formula", ast: { type: "reference", address: addr("obj_1", "cells", "A1") }, value: null },
    });

    const firstResult = mutate([], [{ kind: "createObject", object: table }], []);
    expect(firstResult.ok).toBe(true); // ACCEPTED: no false cycle through the still-empty A1.
    if (!firstResult.ok) {
      return;
    }
    expect(firstResult.objects.find((o) => o.id === "obj_1")?.slots["cells.A2"]).toMatchObject({ value: 0 });

    const committed = firstResult.objects;
    const snapshotBefore = JSON.parse(JSON.stringify(committed)) as unknown;

    // NOW populate A1 with a formula reading A2 — the genuine cycle appears
    // only at THIS mutation, and must be rejected here, naming both slots.
    const secondResult = mutate(
      committed,
      [
        {
          kind: "setSlot",
          address: addr("obj_1", "cells", "A1"),
          slot: { kind: "formula", ast: { type: "reference", address: addr("obj_1", "cells", "A2") }, value: null },
        },
      ],
      [],
    );

    expect(secondResult.ok).toBe(false);
    if (!secondResult.ok) {
      expect(secondResult.message).toContain("cyclic dependency");
      expect(secondResult.message).toContain("table_x.A1");
      expect(secondResult.message).toContain("table_x.A2");
    }
    // §5.1 step 6 / D-016: a rejected mutation leaves prior state untouched.
    expect(committed).toEqual(snapshotBefore);
  });
});

describe("mutate — D-048: `findIllegalOperationPayloads` walks a payload's stored formula AST, the same as `findIllegalSlotValues` does post-fold (0045-REVIEW Finding 3, closing entry 0044's reviewer question 1)", () => {
  it("rejects a batch where an EARLIER setSlot's FORMULA payload holds an illegal AST literal even though a LATER setSlot in the SAME batch overwrites it", () => {
    const initial = [valueObject("obj_1", "value_1", 1)];
    const snapshotBefore = JSON.parse(JSON.stringify(initial)) as unknown;
    const illegalFirst: Operation = {
      kind: "setSlot",
      address: addr("obj_1", "value"),
      slot: { kind: "formula", ast: { type: "literal", value: Number.POSITIVE_INFINITY }, value: null },
    };
    const legalSecond: Operation = { kind: "setSlot", address: addr("obj_1", "value"), slot: { kind: "literal", value: 5 } };

    const result = mutate(initial, [illegalFirst, legalSecond], []);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("operation 1 of 2");
      expect(result.message).toContain("value_1.value");
      expect(result.message).toContain("D-048");
    }
    expect(initial).toEqual(snapshotBefore);
  });

  it("rejects a createObject whose payload holds a formula-kind slot with an illegal AST literal, even though a LATER op in the batch deletes that object", () => {
    const illegalObject: GraphObject = {
      id: "obj_2",
      name: "value_2",
      type: "value",
      slots: { value: { kind: "formula", ast: { type: "literal", value: NaN }, value: null } },
    };
    const create: Operation = { kind: "createObject", object: illegalObject };
    const deleteAfter: Operation = { kind: "deleteObject", objectId: "obj_2" };

    const result = mutate([], [create, deleteAfter], []);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("operation 1 of 2");
      expect(result.message).toContain("value_2.value");
      expect(result.message).toContain("D-048");
    }
  });

  it("catches an illegal literal buried inside the payload AST, not just at its root", () => {
    const operation: Operation = {
      kind: "setSlot",
      address: addr("obj_1", "value"),
      slot: {
        kind: "formula",
        ast: { type: "functionCall", name: "ABS", args: [{ type: "binaryOp", operator: "+", left: { type: "literal", value: -0 }, right: { type: "literal", value: 1 } }] },
        value: null,
      },
    };

    const result = mutate([valueObject("obj_1", "value_1", 1)], [operation], []);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("-0");
    }
  });

  it("does not reject a batch whose formula payloads are all legal", () => {
    const operation: Operation = {
      kind: "setSlot",
      address: addr("obj_1", "value"),
      slot: { kind: "formula", ast: { type: "literal", value: 42 }, value: null },
    };

    const result = mutate([valueObject("obj_1", "value_1", 1)], [operation], []);

    expect(result.ok).toBe(true);
  });
});

describe("mutate — InsertTableLineOperation: §5.4 row/column insertion (entry 0047)", () => {
  it("grows the extent and shifts every populated cell at or after the index down by one row", () => {
    const table = tableObject("obj_1", "table_x", 3, 1, {
      "cells.A1": { kind: "literal", value: 1 },
      "cells.A2": { kind: "literal", value: 2 },
      "cells.A3": { kind: "literal", value: 3 },
    });

    const result = mutate([table], [{ kind: "insertTableLine", objectId: "obj_1", axis: "row", index: 2 }], []);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const resized = result.objects.find((o) => o.id === "obj_1");
    expect(resized?.slots.rows).toMatchObject({ value: 4 });
    expect(resized?.slots["cells.A1"]).toMatchObject({ value: 1 }); // before the index: unchanged.
    expect(resized?.slots["cells.A2"]).toBeUndefined(); // the NEW row: empty (D-047-legal).
    expect(resized?.slots["cells.A3"]).toMatchObject({ value: 2 }); // old A2 moved here.
    expect(resized?.slots["cells.A4"]).toMatchObject({ value: 3 }); // old A3 moved here.
  });

  it("§5.4: a reference from ANOTHER object into the resized table shifts too — the WHOLE document, not just the table's own formulas", () => {
    const table = tableObject("obj_1", "table_x", 3, 1, {
      "cells.A1": { kind: "literal", value: 1 },
      "cells.A2": { kind: "literal", value: 2 },
      "cells.A3": { kind: "literal", value: 3 },
    });
    const reader: GraphObject = {
      id: "obj_2",
      name: "value_1",
      type: "value",
      slots: { value: { kind: "formula", ast: { type: "reference", address: addr("obj_1", "cells", "A3") }, value: null } },
    };

    const result = mutate([table, reader], [{ kind: "insertTableLine", objectId: "obj_1", axis: "row", index: 2 }], []);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const rewritten = result.objects.find((o) => o.id === "obj_2");
    expect(rewritten?.slots.value).toMatchObject({
      kind: "formula",
      ast: { type: "reference", address: addr("obj_1", "cells", "A4") }, // A3 shifted to A4 with everything else.
    });
    expect(rewritten?.slots.value).toMatchObject({ value: 3 }); // and it still resolves to old A3's value, live.
  });

  it("a reference that named a row BEFORE the insertion point is left completely unchanged", () => {
    const table = tableObject("obj_1", "table_x", 3, 1, {
      "cells.A1": { kind: "literal", value: 1 },
      "cells.A2": { kind: "literal", value: 2 },
      "cells.A3": { kind: "literal", value: 3 },
    });
    const reader: GraphObject = {
      id: "obj_2",
      name: "value_1",
      type: "value",
      slots: { value: { kind: "formula", ast: { type: "reference", address: addr("obj_1", "cells", "A1") }, value: null } },
    };

    const result = mutate([table, reader], [{ kind: "insertTableLine", objectId: "obj_1", axis: "row", index: 2 }], []);

    expect(result.ok).toBe(true);
    if (result.ok) {
      const rewritten = result.objects.find((o) => o.id === "obj_2");
      expect(rewritten?.slots.value).toMatchObject({ ast: { type: "reference", address: addr("obj_1", "cells", "A1") } });
    }
  });

  it("a reference into a table OTHER than the one being resized is completely untouched", () => {
    const tableX = tableObject("obj_1", "table_x", 2, 1, { "cells.A1": { kind: "literal", value: 1 } });
    const tableZ = tableObject("obj_3", "table_z", 2, 1, { "cells.A1": { kind: "literal", value: 9 } });
    const tableY = tableObject("obj_2", "table_y", 2, 1, {
      // Points into table_z, NOT table_x — insertion on table_x must not touch this at all.
      "cells.A2": { kind: "formula", ast: { type: "reference", address: addr("obj_3", "cells", "A1") }, value: null },
    });

    const result = mutate([tableX, tableY, tableZ], [{ kind: "insertTableLine", objectId: "obj_1", axis: "row", index: 1 }], []);

    expect(result.ok).toBe(true);
    if (result.ok) {
      const untouched = result.objects.find((o) => o.id === "obj_2");
      expect(untouched?.slots["cells.A2"]).toMatchObject({ ast: { type: "reference", address: addr("obj_3", "cells", "A1") } });
    }
  });

  it("column insertion shifts columns, independent of rows", () => {
    const table = tableObject("obj_1", "table_x", 1, 3, {
      "cells.A1": { kind: "literal", value: "a" },
      "cells.B1": { kind: "literal", value: "b" },
      "cells.C1": { kind: "literal", value: "c" },
    });

    const result = mutate([table], [{ kind: "insertTableLine", objectId: "obj_1", axis: "column", index: 2 }], []);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const resized = result.objects.find((o) => o.id === "obj_1");
    expect(resized?.slots.cols).toMatchObject({ value: 4 });
    expect(resized?.slots["cells.A1"]).toMatchObject({ value: "a" });
    expect(resized?.slots["cells.B1"]).toBeUndefined();
    expect(resized?.slots["cells.C1"]).toMatchObject({ value: "b" });
    expect(resized?.slots["cells.D1"]).toMatchObject({ value: "c" });
  });

  it("rejects an insertion index out of range, naming the operation and the problem", () => {
    const table = tableObject("obj_1", "table_x", 2, 1, {});
    const result = mutate([table], [{ kind: "insertTableLine", objectId: "obj_1", axis: "row", index: 99 }], []);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("operation 1 of 1");
      expect(result.message).toContain("out of range");
    }
  });

  it("rejects an insertion index of 0 (not 1-based) and leaves prior state untouched", () => {
    const table = tableObject("obj_1", "table_x", 2, 1, {});
    const snapshotBefore = JSON.parse(JSON.stringify([table])) as unknown;
    const result = mutate([table], [{ kind: "insertTableLine", objectId: "obj_1", axis: "row", index: 0 }], []);

    expect(result.ok).toBe(false);
    expect([table]).toEqual(snapshotBefore);
  });

  it("rejects an insertion targeting a non-table object", () => {
    const result = mutate([valueObject("obj_1", "value_1", 1)], [{ kind: "insertTableLine", objectId: "obj_1", axis: "row", index: 1 }], []);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("is not a table");
    }
  });

  it("rejects an insertion targeting an object id that does not exist (D-021)", () => {
    const result = mutate([], [{ kind: "insertTableLine", objectId: "obj_missing", axis: "row", index: 1 }], []);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("does not exist in this document");
    }
  });

  it("composes with an ordinary setSlot in the SAME batch, folding left-to-right", () => {
    const table = tableObject("obj_1", "table_x", 2, 1, {
      "cells.A1": { kind: "literal", value: 1 },
      "cells.A2": { kind: "literal", value: 2 },
    });

    const result = mutate(
      [table],
      [
        { kind: "insertTableLine", objectId: "obj_1", axis: "row", index: 1 },
        { kind: "setSlot", address: addr("obj_1", "cells", "A1"), slot: { kind: "literal", value: 100 } }, // the NEW, empty row.
      ],
      [],
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      const resized = result.objects.find((o) => o.id === "obj_1");
      expect(resized?.slots["cells.A1"]).toMatchObject({ value: 100 }); // the new row, now set.
      expect(resized?.slots["cells.A2"]).toMatchObject({ value: 1 }); // old A1, shifted down.
      expect(resized?.slots["cells.A3"]).toMatchObject({ value: 2 }); // old A2, shifted down.
    }
  });
});

describe("mutate — findInvalidTableResizes, 0048-REVIEW-phase2 fix 2 (D-050): simulates the batch LEFT-TO-RIGHT", () => {
  it("two inserts on the SAME table in one batch both commit — the false-reject D-050 closes", () => {
    // Verified false-reject at 0048-REVIEW: against pre-batch state alone,
    // operation 2's index 4 looked out of range for a table that (by the
    // time it actually applies) genuinely has 3 rows.
    const table = tableObject("obj_1", "table_x", 2, 1, {});

    const result = mutate(
      [table],
      [
        { kind: "insertTableLine", objectId: "obj_1", axis: "row", index: 1 },
        { kind: "insertTableLine", objectId: "obj_1", axis: "row", index: 4 }, // legal: rows is 3 by now.
      ],
      [],
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      const resized = result.objects.find((o) => o.id === "obj_1");
      expect(resized?.slots.rows).toMatchObject({ value: 4 });
    }
  });

  it("an out-of-range index in a LATER operation is still rejected, against the state AS OF ITS OWN position", () => {
    const table = tableObject("obj_1", "table_x", 2, 1, {});

    const result = mutate(
      [table],
      [
        { kind: "insertTableLine", objectId: "obj_1", axis: "row", index: 1 }, // legal: rows becomes 3.
        { kind: "insertTableLine", objectId: "obj_1", axis: "row", index: 10 }, // illegal even against 3 rows.
      ],
      [],
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("operation 2 of 2");
      expect(result.message).toContain("out of range");
    }
  });

  it("an insertTableLine on a table created EARLIER IN THE SAME BATCH is now VALIDATED, not skipped", () => {
    const table = tableObject("obj_1", "table_x", 2, 1, {});

    const result = mutate(
      [],
      [
        { kind: "createObject", object: table },
        { kind: "insertTableLine", objectId: "obj_1", axis: "row", index: 99 }, // out of range for the 2-row table just created.
      ],
      [],
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("operation 2 of 2");
      expect(result.message).toContain("out of range");
    }
  });

  it("...and a LEGAL insertTableLine on a same-batch-created table commits", () => {
    const table = tableObject("obj_1", "table_x", 2, 1, { "cells.A1": { kind: "literal", value: 1 } });

    const result = mutate(
      [],
      [
        { kind: "createObject", object: table },
        { kind: "insertTableLine", objectId: "obj_1", axis: "row", index: 3 }, // legal: bound+1 = 3.
      ],
      [],
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      const resized = result.objects.find((o) => o.id === "obj_1");
      expect(resized?.slots.rows).toMatchObject({ value: 3 });
    }
  });
});

describe("mutate — findInvalidTableResizes, 0048-REVIEW-phase2 fix 3: rejects an insert whose dimension is not literal (D-046)", () => {
  it("rejects an insert whose ROWS slot is formula-kind, naming D-046, leaving prior state bit-for-bit unchanged", () => {
    const table: GraphObject = {
      id: "obj_1",
      name: "table_x",
      type: "table",
      slots: {
        rows: { kind: "formula", ast: { type: "literal", value: 2 }, value: 2 },
        cols: { kind: "literal", value: 1 },
        "cells.A1": { kind: "literal", value: 1 },
      },
    };
    const snapshotBefore = JSON.parse(JSON.stringify([table])) as unknown;

    const result = mutate([table], [{ kind: "insertTableLine", objectId: "obj_1", axis: "row", index: 1 }], []);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("not \"literal\"");
      expect(result.message).toContain("D-046");
    }
    expect([table]).toEqual(snapshotBefore); // step 6: prior state provably untouched.
  });

  it("rejects a COLUMN insert whose COLS slot is formula-kind", () => {
    const table: GraphObject = {
      id: "obj_1",
      name: "table_x",
      type: "table",
      slots: {
        rows: { kind: "literal", value: 1 },
        cols: { kind: "formula", ast: { type: "literal", value: 2 }, value: 2 },
      },
    };

    const result = mutate([table], [{ kind: "insertTableLine", objectId: "obj_1", axis: "column", index: 1 }], []);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("not \"literal\"");
    }
  });

  it("a literal-dimensioned table is unaffected by fix 3 — an ordinary insert still commits", () => {
    const table = tableObject("obj_1", "table_x", 2, 1, {});
    const result = mutate([table], [{ kind: "insertTableLine", objectId: "obj_1", axis: "row", index: 1 }], []);
    expect(result.ok).toBe(true);
  });

  // D-053 (0051-REVIEW-phase2 §4/§8 item 1): fix 3 originally checked only
  // `operation.axis`'s own dimension flag, so a ROW insert on a table whose
  // UNTOUCHED `cols` slot was formula-kind committed `ok: true` and silently
  // reset `cols` to `literal 0` — destroying its AST, cached value, and
  // inbound edge from `value_1.value`. This is the cross-axis case fix 3's
  // own tests above never exercised (both targeted the SAME axis as the
  // non-literal dimension).
  it("rejects a ROW insert whose UNTOUCHED cols slot is formula-kind (D-053 — a resize checks the WHOLE extent, not only its own axis), leaving prior state bit-for-bit unchanged", () => {
    const source: GraphObject = { id: "obj_2", name: "value_1", type: "value", slots: { value: { kind: "literal", value: 0 } } };
    const table: GraphObject = {
      id: "obj_1",
      name: "table_x",
      type: "table",
      slots: {
        rows: { kind: "literal", value: 3 },
        cols: { kind: "formula", ast: { type: "reference", address: addr("obj_2", "value") }, value: 0 },
        "cells.A1": { kind: "literal", value: 1 },
      },
    };
    const snapshotBefore = JSON.parse(JSON.stringify([source, table])) as unknown;

    const result = mutate([source, table], [{ kind: "insertTableLine", objectId: "obj_1", axis: "row", index: 1 }], []);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("cols");
      expect(result.message).toContain("not \"literal\"");
      expect(result.message).toContain("D-046");
    }
    expect([source, table]).toEqual(snapshotBefore); // step 6: prior state provably untouched — cols never became literal 0.
  });
});

describe("mutate — Phase 2 acceptance criterion clause 3, completed: SUM(A1:A5) recomputes correctly AFTER INSERTING A ROW INSIDE THE RANGE", () => {
  it("insertion WIDENS the formula's stored range to include the new row, and the new row's cell participates live once set", () => {
    const table = tableObject("obj_1", "table_x", 5, 1, {
      "cells.A1": { kind: "literal", value: 1 },
      "cells.A2": { kind: "literal", value: 2 },
      "cells.A3": { kind: "literal", value: 3 },
      "cells.A4": { kind: "literal", value: 4 },
      "cells.A5": { kind: "literal", value: 5 },
    });
    const consumer: GraphObject = {
      id: "obj_2",
      name: "value_1",
      type: "value",
      slots: {
        value: {
          kind: "formula",
          ast: { type: "functionCall", name: "SUM", args: [{ type: "range", start: addr("obj_1", "cells", "A1"), end: addr("obj_1", "cells", "A5") }] },
          value: null,
        },
      },
    };

    const created = mutate([], [{ kind: "createObject", object: table }, { kind: "createObject", object: consumer }], []);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.objects.find((o) => o.id === "obj_2")?.slots.value).toMatchObject({ value: 15 }); // 1+2+3+4+5.

    // Insert a row INSIDE the range (index 3 — strictly between A1 and A5, so
    // §5.4's "a range that spans an insertion point widens" clause applies).
    const inserted = mutate(created.objects, [{ kind: "insertTableLine", objectId: "obj_1", axis: "row", index: 3 }], created.journal);
    expect(inserted.ok).toBe(true);
    if (!inserted.ok) return;

    // The stored range widened from A1:A5 to A1:A6 — A1/A2 (before the
    // insertion point) stayed put; A5 (at/after it) shifted to A6.
    expect(inserted.objects.find((o) => o.id === "obj_2")?.slots.value).toMatchObject({
      kind: "formula",
      ast: { type: "functionCall", name: "SUM", args: [{ type: "range", start: addr("obj_1", "cells", "A1"), end: addr("obj_1", "cells", "A6") }] },
    });
    // The new row (A3) is empty (D-047) — the sum is UNCHANGED, still 15, not #REF and not rejected.
    expect(inserted.objects.find((o) => o.id === "obj_2")?.slots.value).toMatchObject({ value: 15 });

    // Now the row-insert acceptance clause's whole point: editing the NEWLY
    // INSERTED cell recomputes the sum live, because the widened range
    // genuinely includes it.
    const edited = mutate(inserted.objects, [{ kind: "setSlot", address: addr("obj_1", "cells", "A3"), slot: { kind: "literal", value: 100 } }], inserted.journal);
    expect(edited.ok).toBe(true);
    if (edited.ok) {
      expect(edited.objects.find((o) => o.id === "obj_2")?.slots.value).toMatchObject({ value: 115 }); // 15 + 100.
    }
  });
});

describe("mutate — DeleteTableLineOperation: §5.4 row/column deletion, the FIRST §5.1.1 REPAIR-path operation (entry 0050)", () => {
  it("shrinks the extent, drops the cell AT the deleted index, and shifts every populated cell AFTER it back by one row", () => {
    const table = tableObject("obj_1", "table_x", 4, 1, {
      "cells.A1": { kind: "literal", value: 1 },
      "cells.A2": { kind: "literal", value: 2 },
      "cells.A3": { kind: "literal", value: 3 },
      "cells.A4": { kind: "literal", value: 4 },
    });

    const result = mutate([table], [{ kind: "deleteTableLine", objectId: "obj_1", axis: "row", index: 2 }], []);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const resized = result.objects.find((o) => o.id === "obj_1");
    expect(resized?.slots.rows).toMatchObject({ value: 3 });
    expect(resized?.slots["cells.A1"]).toMatchObject({ value: 1 }); // before the index: unchanged.
    expect(resized?.slots["cells.A2"]).toMatchObject({ value: 3 }); // old A3, shifted back.
    expect(resized?.slots["cells.A3"]).toMatchObject({ value: 4 }); // old A4, shifted back.
    expect(resized?.slots["cells.A4"]).toBeUndefined(); // no longer within the extent.
  });

  it("§5.1.1 REPAIR: a reference from ANOTHER object into the DELETED cell becomes #REF, live — never a dangling edge, never a rejection", () => {
    const table = tableObject("obj_1", "table_x", 3, 1, {
      "cells.A1": { kind: "literal", value: 1 },
      "cells.A2": { kind: "literal", value: 2 },
      "cells.A3": { kind: "literal", value: 3 },
    });
    const reader: GraphObject = {
      id: "obj_2",
      name: "value_1",
      type: "value",
      slots: { value: { kind: "formula", ast: { type: "reference", address: addr("obj_1", "cells", "A2") }, value: null } },
    };

    const result = mutate([table, reader], [{ kind: "deleteTableLine", objectId: "obj_1", axis: "row", index: 2 }], []);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const repaired = result.objects.find((o) => o.id === "obj_2");
    expect(repaired?.slots.value).toMatchObject({ kind: "formula", ast: { type: "error", error: "#REF" } });
    expect((repaired?.slots.value as { value: unknown })?.value).toMatchObject({ error: "#REF" }); // evaluates live too (D-028).
  });

  it("§5.4: a reference from ANOTHER object into a row AFTER the deleted one shifts back — the WHOLE document, not just the table's own formulas", () => {
    const table = tableObject("obj_1", "table_x", 3, 1, {
      "cells.A1": { kind: "literal", value: 1 },
      "cells.A2": { kind: "literal", value: 2 },
      "cells.A3": { kind: "literal", value: 3 },
    });
    const reader: GraphObject = {
      id: "obj_2",
      name: "value_1",
      type: "value",
      slots: { value: { kind: "formula", ast: { type: "reference", address: addr("obj_1", "cells", "A3") }, value: null } },
    };

    const result = mutate([table, reader], [{ kind: "deleteTableLine", objectId: "obj_1", axis: "row", index: 1 }], []);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const rewritten = result.objects.find((o) => o.id === "obj_2");
    expect(rewritten?.slots.value).toMatchObject({ ast: { type: "reference", address: addr("obj_1", "cells", "A2") } }); // A3 shifted to A2.
    expect(rewritten?.slots.value).toMatchObject({ value: 3 }); // still resolves to the old A3's value, live.
  });

  it("a reference that named a row BEFORE the deletion point is left completely unchanged", () => {
    const table = tableObject("obj_1", "table_x", 3, 1, {
      "cells.A1": { kind: "literal", value: 1 },
      "cells.A2": { kind: "literal", value: 2 },
      "cells.A3": { kind: "literal", value: 3 },
    });
    const reader: GraphObject = {
      id: "obj_2",
      name: "value_1",
      type: "value",
      slots: { value: { kind: "formula", ast: { type: "reference", address: addr("obj_1", "cells", "A1") }, value: null } },
    };

    const result = mutate([table, reader], [{ kind: "deleteTableLine", objectId: "obj_1", axis: "row", index: 2 }], []);

    expect(result.ok).toBe(true);
    if (result.ok) {
      const untouched = result.objects.find((o) => o.id === "obj_2");
      expect(untouched?.slots.value).toMatchObject({ ast: { type: "reference", address: addr("obj_1", "cells", "A1") } });
    }
  });

  it("a reference into a table OTHER than the one being resized is completely untouched", () => {
    const tableX = tableObject("obj_1", "table_x", 2, 1, { "cells.A1": { kind: "literal", value: 1 } });
    const tableZ = tableObject("obj_3", "table_z", 2, 1, { "cells.A1": { kind: "literal", value: 9 } });
    const tableY = tableObject("obj_2", "table_y", 2, 1, {
      "cells.A2": { kind: "formula", ast: { type: "reference", address: addr("obj_3", "cells", "A1") }, value: null },
    });

    const result = mutate([tableX, tableY, tableZ], [{ kind: "deleteTableLine", objectId: "obj_1", axis: "row", index: 1 }], []);

    expect(result.ok).toBe(true);
    if (result.ok) {
      const untouched = result.objects.find((o) => o.id === "obj_2");
      expect(untouched?.slots["cells.A2"]).toMatchObject({ ast: { type: "reference", address: addr("obj_3", "cells", "A1") } });
    }
  });

  it("column deletion shifts columns, independent of rows", () => {
    const table = tableObject("obj_1", "table_x", 1, 4, {
      "cells.A1": { kind: "literal", value: "a" },
      "cells.B1": { kind: "literal", value: "b" },
      "cells.C1": { kind: "literal", value: "c" },
      "cells.D1": { kind: "literal", value: "d" },
    });

    const result = mutate([table], [{ kind: "deleteTableLine", objectId: "obj_1", axis: "column", index: 2 }], []);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const resized = result.objects.find((o) => o.id === "obj_1");
    expect(resized?.slots.cols).toMatchObject({ value: 3 });
    expect(resized?.slots["cells.A1"]).toMatchObject({ value: "a" });
    expect(resized?.slots["cells.B1"]).toMatchObject({ value: "c" }); // old C1.
    expect(resized?.slots["cells.C1"]).toMatchObject({ value: "d" }); // old D1.
    expect(resized?.slots["cells.D1"]).toBeUndefined();
  });

  it("a RANGE spanning the deleted row narrows (clamps) and keeps computing correctly — §5.4's other repair clause", () => {
    const table = tableObject("obj_1", "table_x", 5, 1, {
      "cells.A1": { kind: "literal", value: 1 },
      "cells.A2": { kind: "literal", value: 2 },
      "cells.A3": { kind: "literal", value: 3 },
      "cells.A4": { kind: "literal", value: 4 },
      "cells.A5": { kind: "literal", value: 5 },
    });
    const consumer: GraphObject = {
      id: "obj_2",
      name: "value_1",
      type: "value",
      slots: {
        value: {
          kind: "formula",
          ast: { type: "functionCall", name: "SUM", args: [{ type: "range", start: addr("obj_1", "cells", "A1"), end: addr("obj_1", "cells", "A5") }] },
          value: null,
        },
      },
    };

    const result = mutate([table, consumer], [{ kind: "deleteTableLine", objectId: "obj_1", axis: "row", index: 3 }], []);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // A1:A5, delete row 3 (interior) -> clamps to A1:A4 (§5.4's own words).
    expect(result.objects.find((o) => o.id === "obj_2")?.slots.value).toMatchObject({
      ast: { type: "functionCall", name: "SUM", args: [{ type: "range", start: addr("obj_1", "cells", "A1"), end: addr("obj_1", "cells", "A4") }] },
    });
    // Remaining rows (old A1,A2,A4,A5 -> new A1,A2,A3,A4) sum to 1+2+4+5 = 12.
    expect(result.objects.find((o) => o.id === "obj_2")?.slots.value).toMatchObject({ value: 12 });
  });

  it("a range naming ONLY the deleted line becomes #REF entirely (§5.4: \"a range deleted entirely becomes #REF\")", () => {
    const table = tableObject("obj_1", "table_x", 3, 1, { "cells.A2": { kind: "literal", value: 2 } });
    const consumer: GraphObject = {
      id: "obj_2",
      name: "value_1",
      type: "value",
      slots: {
        value: {
          kind: "formula",
          ast: { type: "functionCall", name: "SUM", args: [{ type: "range", start: addr("obj_1", "cells", "A2"), end: addr("obj_1", "cells", "A2") }] },
          value: null,
        },
      },
    };

    const result = mutate([table, consumer], [{ kind: "deleteTableLine", objectId: "obj_1", axis: "row", index: 2 }], []);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.objects.find((o) => o.id === "obj_2")?.slots.value).toMatchObject({
      ast: { type: "functionCall", name: "SUM", args: [{ type: "error", error: "#REF" }] },
    });
  });

  it("rejects a deletion index out of range, naming the operation and the problem", () => {
    const table = tableObject("obj_1", "table_x", 2, 1, {});
    const result = mutate([table], [{ kind: "deleteTableLine", objectId: "obj_1", axis: "row", index: 99 }], []);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("operation 1 of 1");
      expect(result.message).toContain("out of range");
    }
  });

  it("rejects a deletion index of 0 (not 1-based) and leaves prior state untouched", () => {
    const table = tableObject("obj_1", "table_x", 2, 1, {});
    const snapshotBefore = JSON.parse(JSON.stringify([table])) as unknown;
    const result = mutate([table], [{ kind: "deleteTableLine", objectId: "obj_1", axis: "row", index: 0 }], []);

    expect(result.ok).toBe(false);
    expect([table]).toEqual(snapshotBefore);
  });

  it("rejects a deletion from an already-empty (0-row) table — unlike insertion, there is no valid index at all", () => {
    const table = tableObject("obj_1", "table_x", 0, 1, {});
    const result = mutate([table], [{ kind: "deleteTableLine", objectId: "obj_1", axis: "row", index: 1 }], []);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("out of range");
    }
  });

  it("rejects a deletion targeting a non-table object", () => {
    const result = mutate([valueObject("obj_1", "value_1", 1)], [{ kind: "deleteTableLine", objectId: "obj_1", axis: "row", index: 1 }], []);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("is not a table");
    }
  });

  it("rejects a deletion targeting an object id that does not exist (D-021)", () => {
    const result = mutate([], [{ kind: "deleteTableLine", objectId: "obj_missing", axis: "row", index: 1 }], []);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("does not exist in this document");
    }
  });

  it("rejects a deletion whose dimension is not literal (D-046), same guard as insertion", () => {
    const table: GraphObject = {
      id: "obj_1",
      name: "table_x",
      type: "table",
      slots: { rows: { kind: "formula", ast: { type: "literal", value: 2 }, value: 2 }, cols: { kind: "literal", value: 1 } },
    };
    const result = mutate([table], [{ kind: "deleteTableLine", objectId: "obj_1", axis: "row", index: 1 }], []);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("D-046");
    }
  });

  // D-053 (0051-REVIEW-phase2 §4/§8 item 1) — the same cross-axis defect fix
  // 3 missed on the insert side, verified LIVE on deletion too (0051-REVIEW
  // §4's own probe): a ROW delete on a table whose UNTOUCHED cols slot is
  // formula-kind must not silently reset it to literal 0.
  it("rejects a ROW delete whose UNTOUCHED cols slot is formula-kind (D-053 — a resize checks the WHOLE extent, not only its own axis), leaving prior state bit-for-bit unchanged", () => {
    const source: GraphObject = { id: "obj_2", name: "value_1", type: "value", slots: { value: { kind: "literal", value: 0 } } };
    const table: GraphObject = {
      id: "obj_1",
      name: "table_x",
      type: "table",
      slots: {
        rows: { kind: "literal", value: 3 },
        cols: { kind: "formula", ast: { type: "reference", address: addr("obj_2", "value") }, value: 0 },
        "cells.A1": { kind: "literal", value: 1 },
      },
    };
    const snapshotBefore = JSON.parse(JSON.stringify([source, table])) as unknown;

    const result = mutate([source, table], [{ kind: "deleteTableLine", objectId: "obj_1", axis: "row", index: 1 }], []);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("cols");
      expect(result.message).toContain("not \"literal\"");
      expect(result.message).toContain("D-046");
    }
    expect([source, table]).toEqual(snapshotBefore); // step 6: prior state provably untouched — cols never became literal 0.
  });

  it("composes with an ordinary setSlot in the SAME batch, folding left-to-right", () => {
    const table = tableObject("obj_1", "table_x", 3, 1, {
      "cells.A1": { kind: "literal", value: 1 },
      "cells.A2": { kind: "literal", value: 2 },
      "cells.A3": { kind: "literal", value: 3 },
    });

    const result = mutate(
      [table],
      [
        { kind: "deleteTableLine", objectId: "obj_1", axis: "row", index: 1 },
        { kind: "setSlot", address: addr("obj_1", "cells", "A1"), slot: { kind: "literal", value: 100 } }, // old A2, now shifted to A1.
      ],
      [],
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      const resized = result.objects.find((o) => o.id === "obj_1");
      expect(resized?.slots["cells.A1"]).toMatchObject({ value: 100 }); // overwritten by the setSlot.
      expect(resized?.slots["cells.A2"]).toMatchObject({ value: 3 }); // old A3, shifted back.
    }
  });
});

describe("mutate — findInvalidTableResizes widened for deleteTableLine (D-050, entry 0050): one simulation covers insert AND delete together", () => {
  it("two deletes on the same table in one batch both commit, each validated against the state as of its own position", () => {
    const table = tableObject("obj_1", "table_x", 4, 1, {
      "cells.A1": { kind: "literal", value: 1 },
      "cells.A2": { kind: "literal", value: 2 },
      "cells.A3": { kind: "literal", value: 3 },
      "cells.A4": { kind: "literal", value: 4 },
    });

    const result = mutate(
      [table],
      [
        { kind: "deleteTableLine", objectId: "obj_1", axis: "row", index: 4 }, // legal: rows is 4.
        { kind: "deleteTableLine", objectId: "obj_1", axis: "row", index: 3 }, // legal: rows is 3 by now.
      ],
      [],
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      const resized = result.objects.find((o) => o.id === "obj_1");
      expect(resized?.slots.rows).toMatchObject({ value: 2 });
    }
  });

  it("an INTERLEAVED insert-then-delete batch on one table is validated against each operation's own position, not pre-batch state", () => {
    // Starts at 2 rows. Insert at index 3 (append) -> 3 rows, legal only
    // because the simulation already knows about the insert. Then delete
    // index 3 (the row just inserted) -> back to 2 rows.
    const table = tableObject("obj_1", "table_x", 2, 1, { "cells.A1": { kind: "literal", value: 1 }, "cells.A2": { kind: "literal", value: 2 } });

    const result = mutate(
      [table],
      [
        { kind: "insertTableLine", objectId: "obj_1", axis: "row", index: 3 },
        { kind: "deleteTableLine", objectId: "obj_1", axis: "row", index: 3 },
      ],
      [],
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      const resized = result.objects.find((o) => o.id === "obj_1");
      expect(resized?.slots.rows).toMatchObject({ value: 2 });
      expect(resized?.slots["cells.A1"]).toMatchObject({ value: 1 });
      expect(resized?.slots["cells.A2"]).toMatchObject({ value: 2 });
    }
  });

  it("a delete-then-insert batch: the delete's out-of-range check runs against PRE-delete state, the insert's against POST-delete state", () => {
    const table = tableObject("obj_1", "table_x", 3, 1, {});

    const result = mutate(
      [table],
      [
        { kind: "deleteTableLine", objectId: "obj_1", axis: "row", index: 3 }, // legal: rows is 3 -> 2.
        { kind: "insertTableLine", objectId: "obj_1", axis: "row", index: 3 }, // legal: bound+1 = 3, against the NOW-2-row table.
      ],
      [],
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.objects.find((o) => o.id === "obj_1")?.slots.rows).toMatchObject({ value: 3 });
    }
  });

  it("a SECOND delete beyond what remains is rejected, validated against the state AS OF ITS OWN POSITION — not the table's original row count", () => {
    // Starts at 1 row. Delete index 1 (legal: rows becomes 0). A second
    // delete at index 1 must now be rejected — there is nothing left to
    // delete — even though index 1 WAS legal against the table's original
    // (pre-batch) row count.
    const table = tableObject("obj_1", "table_x", 1, 1, { "cells.A1": { kind: "literal", value: 1 } });

    const result = mutate(
      [table],
      [
        { kind: "deleteTableLine", objectId: "obj_1", axis: "row", index: 1 },
        { kind: "deleteTableLine", objectId: "obj_1", axis: "row", index: 1 },
      ],
      [],
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("operation 2 of 2");
      expect(result.message).toContain("out of range");
    }
  });

  it("a deletion targeting a table created EARLIER IN THE SAME BATCH is validated, not skipped", () => {
    const freshTable = tableObject("obj_1", "table_x", 2, 1, {});

    const result = mutate(
      [],
      [
        { kind: "createObject", object: freshTable },
        { kind: "deleteTableLine", objectId: "obj_1", axis: "row", index: 99 }, // out of range for the 2-row table just created.
      ],
      [],
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("out of range");
    }
  });
});

describe("mutate — Phase 2 acceptance criterion clause 4, DELETE half: row/column DELETE with #REF repair (entry 0050)", () => {
  it("§5.4/§5.1.1: deleting a row whose cells have external dependents rewrites those references to #REF (repair path) rather than leaving a dangling edge, and NEVER rejects", () => {
    const table = tableObject("obj_1", "table_x", 3, 1, {
      "cells.A1": { kind: "literal", value: 10 },
      "cells.A2": { kind: "literal", value: 20 },
      "cells.A3": { kind: "literal", value: 30 },
    });
    const dependent: GraphObject = {
      id: "obj_2",
      name: "text_1",
      type: "value", // stands in for a Phase 5 text box — any object with a formula slot demonstrates the same edge.
      slots: { value: { kind: "formula", ast: { type: "reference", address: addr("obj_1", "cells", "A2") }, value: null } },
    };

    const result = mutate([table, dependent], [{ kind: "deleteTableLine", objectId: "obj_1", axis: "row", index: 2 }], []);

    // The defining assertion: this commits. §5.1.1's REJECT path (used by
    // plain `delete <object>` today) is NOT what row/column deletion does —
    // it repairs, unconditionally, per §5.4's own words.
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const repaired = result.objects.find((o) => o.id === "obj_2");
    expect(repaired?.slots.value).toMatchObject({ kind: "formula", ast: { type: "error", error: "#REF" } });
    expect((repaired?.slots.value as { value: unknown }).value).toMatchObject({ error: "#REF" });

    // D-057 (built entry 0053): this repair site now reports through the
    // SAME channel `delete <table> force` uses — proving "ONE channel serving
    // BOTH repair sites" is real, not merely a claim in a doc comment.
    expect(result.brokenSlots).toEqual([{ objectId: "obj_2", path: ["value"] }]);

    // No dangling edge either: re-deriving and re-validating the COMMITTED
    // result must still be internally consistent (D-018's own "committed
    // state must always be valid on its own terms" standard).
    const rechecked = deriveValidateAndEvaluate(result.objects);
    expect(rechecked.ok).toBe(true);
  });
});

// KNOWN INCOHERENCE, PINNED not fixed — 0051-REVIEW-phase2 §5, D-053's
// companion ruling. This is NOT a desired outcome: §5.4 says row/column
// deletion "proceeds even when other objects depend on the deleted cells,"
// unconditionally. This test documents the one route by which it currently
// can still reject anyway, so a future change to this behaviour is a
// deliberate, visible diff against a named test — not a silent regression.
describe("mutate — KNOWN INCOHERENCE (pinned, not fixed): row/column deletion CAN still reject, contradicting §5.4's unconditional repair (0051-REVIEW-phase2 §5)", () => {
  it("rejects a row deletion when an OUT-OF-EXTENT cell slot has an external dependent, because the address-repair pass is unbounded while the cell-slot walk is extent-bounded (D-049) — the repaired reference points at a shifted position with no slot, dangling. Reachable only via the carried dimension/cell coherence gap (a raw setSlot; the eventual command line's extent-bounded resolution would refuse to write an out-of-extent cell). Do NOT patch this on the delete side alone — D-053's companion ruling forbids it until insertion's identical divergence (accepted at 0048-REVIEW as case 4) closes with it", () => {
    const table: GraphObject = {
      id: "obj_1",
      name: "table_x",
      type: "table",
      slots: {
        rows: { kind: "literal", value: 3 },
        cols: { kind: "literal", value: 1 },
        "cells.A1": { kind: "literal", value: 1 },
        // Out-of-extent (rows is 3): only reachable by constructing the
        // object directly, as this fixture does — no sanctioned command
        // path can write it, since address resolution is extent-bounded.
        "cells.A5": { kind: "literal", value: 5 },
      },
    };
    const dependent: GraphObject = {
      id: "obj_2",
      name: "text_1",
      type: "value", // stands in for a Phase 5 text box, same as the demonstration test above.
      slots: { value: { kind: "formula", ast: { type: "reference", address: addr("obj_1", "cells", "A5") }, value: null } },
    };

    // The pre-state is itself internally valid — the rejection below is
    // caused by the deletion, not by an already-broken fixture.
    expect(deriveValidateAndEvaluate([table, dependent]).ok).toBe(true);

    const result = mutate([table, dependent], [{ kind: "deleteTableLine", objectId: "obj_1", axis: "row", index: 1 }], []);

    // The address-repair pass rewrites A5 -> A4 (shiftCoordinatesForDelete,
    // unbounded); the cell-slot walk never moved A5 in the first place
    // (enumerateTableCellSlotPaths, bounded to the CURRENT 1..3 extent) —
    // so "cells.A4" names no slot, and validateIntegrity's dangling-
    // reference check rejects the whole batch. Contradicts §5.4.
    expect(result.ok).toBe(false);
  });
});

// RenameObjectOperation (entry 0083) — §5.2/§5.10's `rename`, and the one
// operation kind whose whole effect is a name. §5.3's two-layer scheme is what
// makes it this small: every stored AST holds an ID, so nothing outside the
// renamed object's own `name` field moves.
describe("mutate — RenameObjectOperation (§5.2/§5.10's `rename`, entry 0083)", () => {
  /** `value_1` read by `add_1`, so a rename has real inbound edges to leave alone. */
  function wired(): readonly GraphObject[] {
    return [
      valueObject("obj_1", "value_1", 10),
      valueObject("obj_2", "value_2", 5),
      addObject("obj_3", "add_1", addr("obj_1", "value"), addr("obj_2", "value")),
    ];
  }

  it("writes the new name and touches nothing else — same id, same slots, and the object's position in the array is unchanged", () => {
    const result = mutate(wired(), [{ kind: "renameObject", objectId: "obj_1", name: "intersection_a" }], []);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.objects[0]?.name).toBe("intersection_a");
    expect(result.objects[0]?.id).toBe("obj_1");
    expect(result.objects[0]?.slots).toEqual(wired()[0]?.slots);
    expect(result.objects.map((object) => object.id)).toEqual(["obj_1", "obj_2", "obj_3"]);
  });

  it("breaks no reference at all — the dependent still evaluates, and brokenSlots is empty (§5.3's whole reason for storing ids)", () => {
    const before = deriveValidateAndEvaluate(wired());
    const result = mutate(wired(), [{ kind: "renameObject", objectId: "obj_1", name: "intersection_a" }], []);
    expect(result.ok && result.brokenSlots).toEqual([]);
    expect(result.ok && result.objects[2]?.slots["out.result"]?.value).toBe(before.ok ? before.objects[2]?.slots["out.result"]?.value : undefined);
    // The stored AST still names the ID, not either name (the VALUE moves,
    // because step 7 evaluates every candidate — the AST does not).
    const dependentSlot = result.ok ? result.objects[2]?.slots["in.a"] : undefined;
    expect(dependentSlot?.kind === "formula" ? dependentSlot.ast : undefined).toEqual({ type: "reference", address: addr("obj_1", "value") });
  });

  it("derives the SAME edge set after the rename, so a name is provably not part of the graph", () => {
    const result = mutate(wired(), [{ kind: "renameObject", objectId: "obj_1", name: "intersection_a" }], []);
    expectSameEdges(result.ok ? deriveEdges(result.objects) : [], deriveEdges(wired()));
  });

  it("records exactly one journal entry holding the operation (Rule 2)", () => {
    const result = mutate(wired(), [{ kind: "renameObject", objectId: "obj_1", name: "intersection_a" }], []);
    expect(result.ok && result.journal).toEqual([{ operations: [{ kind: "renameObject", objectId: "obj_1", name: "intersection_a" }] }]);
  });

  it("rejects a rename of an id that does not exist, with D-021's own message shape", () => {
    const result = mutate(wired(), [{ kind: "renameObject", objectId: "obj_99", name: "whatever" }], []);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toBe(
      'operation 1 of 1 attempts to rename object id "obj_99" to "whatever", which does not exist in this document (D-021)',
    );
  });

  it("rejects a name another object already holds, case-insensitively (§5.2), through checkNameAvailable's own message", () => {
    const result = mutate(wired(), [{ kind: "renameObject", objectId: "obj_1", name: "VALUE_2" }], []);
    expect(result.ok === false && result.message).toBe('operation 1 of 1 cannot rename: the name "VALUE_2" is already in use');
  });

  it("rejects a name that fails §5.2's grammar", () => {
    const result = mutate(wired(), [{ kind: "renameObject", objectId: "obj_1", name: "3bad" }], []);
    expect(result.ok === false && result.message).toBe(
      'operation 1 of 1 cannot rename: "3bad" is not a valid name — names must match [a-zA-Z_][a-zA-Z0-9_]*',
    );
  });

  it("ACCEPTS a rename to the object's own name in a different case — uniqueness excludes the object being renamed", () => {
    const result = mutate(wired(), [{ kind: "renameObject", objectId: "obj_1", name: "VALUE_1" }], []);
    expect(result.ok && result.objects[0]?.name).toBe("VALUE_1");
  });

  it("leaves the caller's objects and journal untouched on a rejection (§5.1 step 6)", () => {
    const objects = wired();
    const snapshot = JSON.stringify(objects);
    const journal: readonly MutationJournalEntry[] = [];
    expect(mutate(objects, [{ kind: "renameObject", objectId: "obj_1", name: "value_2" }], journal).ok).toBe(false);
    expect(JSON.stringify(objects)).toBe(snapshot);
    expect(journal).toEqual([]);
  });

  it("rejects a name §5.3 lexes as a formula keyword, in ANY case — D-080, reviewer edit at 0084-REVIEW", () => {
    const result = mutate(wired(), [{ kind: "renameObject", objectId: "obj_1", name: "or" }], []);
    expect(result.ok === false && result.message).toBe(
      'operation 1 of 1 cannot rename: "or" is a reserved word — §5.3 reads AND, OR, NOT, TRUE, FALSE as formula keywords in any case, so no formula could reference this object; choose another name',
    );
  });
});

// AddPortOperation/RemovePortOperation (D-141 clause 6) — the ONLY way a
// GraphObject's structural `ports` field changes. `SCRIPT_SCHEMA` now exists
// (entry 0169), so these hand-built `script` GraphObjects must stay consistent
// with it wherever the fixture's `ports.out` is non-empty:
//   - D-018 requires a `derived`-kind slot at every declared derived path —
//     `SCRIPT_SCHEMA` declares one `out.<name>` per name in `ports.out`.
//   - `out.<name>`'s DEPENDENCIES (`engine/script/stub.ts`'s
//     `scriptOutDependencies`) are every current `in.*` address plus the
//     port's own `placeholder.<name>` — and `validateIntegrity`'s
//     dangling-reference check (§5.1.1) requires every dependency address to
//     resolve to a REAL slot, not merely a declared-but-tolerated-absent one.
//     So whenever a fixture's `ports.out` is non-empty, its `in.*`/
//     `placeholder.*` slots for every currently-declared port must exist too.
// `addPort`/`removePort` themselves still only ever touch the port NAME list
// (see each operation's own doc comment) — a test whose OWN batch adds a port
// that an existing out port would depend on must pair it with a `setSlot`
// creating the slot, the same layering `command/commands.ts`'s doc comments
// describe. A fixture whose `ports.out` is EMPTY needs none of this — most of
// the tests below still build the bare `scriptObject` they always did.
describe("mutate — AddPortOperation/RemovePortOperation (D-141 clause 6)", () => {
  function scriptObject(id: string, name: string, ports?: { readonly in: readonly string[]; readonly out: readonly string[] }): GraphObject {
    return ports === undefined ? { id, name, type: "script", slots: {} } : { id, name, type: "script", slots: {}, ports };
  }

  it("addPort appends to an absent ports field, creating { in: [], out: [] } implicitly", () => {
    const result = mutate([scriptObject("obj_1", "script_1")], [{ kind: "addPort", objectId: "obj_1", family: "in", name: "factor" }], []);
    expect(result.ok).toBe(true);
    expect(result.ok && result.objects[0]?.ports).toEqual({ in: ["factor"], out: [] });
  });

  it("addPort appends to the END of the named family's existing list, leaving the other family untouched", () => {
    // `ports.out` already names "result", so `out.result` depends on EVERY
    // current `in.*` address plus its own placeholder — all three (`in.factor`,
    // `placeholder.result`, `out.result` itself) must be real slots for the
    // fixture to be edge-valid BEFORE this batch runs. The batch adds "speed"
    // to `in`, which immediately becomes a FOURTH thing `out.result` depends
    // on (`scriptOutDependencies` is dynamic over the object's current
    // `ports.in`), so it is paired with the `setSlot` that gives it a value —
    // the realistic "declare, then wire" pattern `command/commands.ts`'s doc
    // comments describe.
    const objects: readonly GraphObject[] = [
      {
        id: "obj_1",
        name: "script_1",
        type: "script",
        slots: {
          "in.factor": { kind: "literal", value: 1 },
          "placeholder.result": { kind: "literal", value: 0 },
          "out.result": { kind: "derived", value: null },
        },
        ports: { in: ["factor"], out: ["result"] },
      },
    ];
    const result = mutate(
      objects,
      [
        { kind: "addPort", objectId: "obj_1", family: "in", name: "speed" },
        { kind: "setSlot", address: { objectId: "obj_1", path: ["in", "speed"] }, slot: { kind: "literal", value: 2 } },
      ],
      [],
    );
    expect(result.ok && result.objects[0]?.ports).toEqual({ in: ["factor", "speed"], out: ["result"] });
  });

  it("rejects an empty or dotted port name (D-141 clause 2), touching nothing", () => {
    const objects = [scriptObject("obj_1", "script_1")];
    expect(mutate(objects, [{ kind: "addPort", objectId: "obj_1", family: "in", name: "" }], []).ok).toBe(false);
    expect(mutate(objects, [{ kind: "addPort", objectId: "obj_1", family: "in", name: "a.b" }], []).ok).toBe(false);
  });

  it("rejects a port name outside address.ts's path-segment grammar even with no dot — REVIEWER EDIT, 0168-REVIEW", () => {
    // A name like "my-port" is dot-free but would forge an address
    // (`script_1.in.my-port`) that parseAddress can never accept — a gap
    // 0167's original `isLegalPortName` let through.
    const objects = [scriptObject("obj_1", "script_1")];
    expect(mutate(objects, [{ kind: "addPort", objectId: "obj_1", family: "in", name: "my-port" }], []).ok).toBe(false);
    expect(mutate(objects, [{ kind: "addPort", objectId: "obj_1", family: "in", name: "my port" }], []).ok).toBe(false);
  });

  it("rejects adding a name that already exists in the SAME family", () => {
    const objects = [scriptObject("obj_1", "script_1", { in: ["factor"], out: [] })];
    const result = mutate(objects, [{ kind: "addPort", objectId: "obj_1", family: "in", name: "factor" }], []);
    expect(result.ok).toBe(false);
  });

  it("ALLOWS the same name in the OTHER family — 'in' and 'out' are independent namespaces", () => {
    // `in.result` is pre-seeded: `ports.in` already names it, and it becomes a
    // dependency of `out.result` the moment the batch below declares that
    // out port — see the describe block's own header for why. `ports.out`
    // starts empty, so nothing requires it to exist YET.
    const objects: readonly GraphObject[] = [
      { id: "obj_1", name: "script_1", type: "script", slots: { "in.result": { kind: "literal", value: 1 } }, ports: { in: ["result"], out: [] } },
    ];
    // Adding an OUT port declares the name only (`AddPortOperation`'s own doc
    // comment) — `SCRIPT_SCHEMA` (entry 0169) then requires both its own
    // derived slot AND its placeholder dependency, so the batch pairs all
    // three, the same layering `command/commands.ts` describes for a real
    // script command.
    const result = mutate(
      objects,
      [
        { kind: "addPort", objectId: "obj_1", family: "out", name: "result" },
        { kind: "setSlot", address: { objectId: "obj_1", path: ["placeholder", "result"] }, slot: { kind: "literal", value: 0 } },
        { kind: "setSlot", address: { objectId: "obj_1", path: ["out", "result"] }, slot: { kind: "derived", value: null } },
      ],
      [],
    );
    expect(result.ok).toBe(true);
    expect(result.ok && result.objects[0]?.ports).toEqual({ in: ["result"], out: ["result"] });
  });

  it("removePort removes the name from its family and drops the corresponding slot, if present", () => {
    const objects: readonly GraphObject[] = [
      { id: "obj_1", name: "script_1", type: "script", slots: { "out.result": { kind: "derived", value: 5 } }, ports: { in: [], out: ["result"] } },
    ];
    const result = mutate(objects, [{ kind: "removePort", objectId: "obj_1", family: "out", name: "result" }], []);
    expect(result.ok).toBe(true);
    expect(result.ok && result.objects[0]?.ports).toEqual({ in: [], out: [] });
    expect(result.ok && result.objects[0]?.slots["out.result"]).toBeUndefined();
  });

  it("rejects removing a port that does not exist in that family", () => {
    const objects = [scriptObject("obj_1", "script_1", { in: [], out: ["result"] })];
    expect(mutate(objects, [{ kind: "removePort", objectId: "obj_1", family: "in", name: "result" }], []).ok).toBe(false);
  });

  it("REJECTS removing an out port some OTHER object's formula still references — D-141 clause 6, no new mechanism beyond the existing dangling-reference check", () => {
    const scriptWithOut: GraphObject = {
      id: "obj_1",
      name: "script_1",
      type: "script",
      slots: { "out.result": { kind: "derived", value: 5 } },
      ports: { in: [], out: ["result"] },
    };
    const dependent: GraphObject = {
      id: "obj_2",
      name: "value_1",
      type: "value",
      slots: { value: { kind: "formula", ast: { type: "reference", address: addr("obj_1", "out", "result") }, value: 5 } },
    };
    const result = mutate([scriptWithOut, dependent], [{ kind: "removePort", objectId: "obj_1", family: "out", name: "result" }], []);
    expect(result.ok).toBe(false);
  });

  it("a batch that removes then re-adds the same name in one call is legal — simulated left-to-right (D-050's reasoning)", () => {
    // Starts WITH both the derived slot AND its placeholder dependency
    // (`ports.in` is empty, so `out.result` depends on nothing but its own
    // placeholder). `removePort` drops the `out.result` SLOT along with the
    // name — `removePort`'s own key is exactly `family.name`, so `placeholder.
    // result` is untouched and survives the round trip — but the re-`addPort`
    // restores only the NAME, so the re-add must be paired with a `setSlot`
    // recreating `out.result` itself (`AddPortOperation`'s own doc comment).
    const objects: readonly GraphObject[] = [
      {
        id: "obj_1",
        name: "script_1",
        type: "script",
        slots: { "placeholder.result": { kind: "literal", value: 0 }, "out.result": { kind: "derived", value: null } },
        ports: { in: [], out: ["result"] },
      },
    ];
    const result = mutate(
      objects,
      [
        { kind: "removePort", objectId: "obj_1", family: "out", name: "result" },
        { kind: "addPort", objectId: "obj_1", family: "out", name: "result" },
        { kind: "setSlot", address: { objectId: "obj_1", path: ["out", "result"] }, slot: { kind: "derived", value: null } },
      ],
      [],
    );
    expect(result.ok).toBe(true);
    expect(result.ok && result.objects[0]?.ports).toEqual({ in: [], out: ["result"] });
  });

  it("leaves the caller's objects untouched on a rejection (§5.1 step 6)", () => {
    const objects = [scriptObject("obj_1", "script_1")];
    const snapshot = JSON.stringify(objects);
    expect(mutate(objects, [{ kind: "addPort", objectId: "obj_1", family: "in", name: "a.b" }], []).ok).toBe(false);
    expect(JSON.stringify(objects)).toBe(snapshot);
  });
});

describe("mutate — findInvalidNames simulates the batch LEFT-TO-RIGHT, the same way findInvalidTableResizes does (D-050's reasoning)", () => {
  function pair(): readonly GraphObject[] {
    return [valueObject("obj_1", "value_1", 1), valueObject("obj_2", "value_2", 2)];
  }

  it("ACCEPTS a rename onto a name an EARLIER rename in the same batch just freed", () => {
    const result = mutate(
      pair(),
      [
        { kind: "renameObject", objectId: "obj_1", name: "freed_later" },
        { kind: "renameObject", objectId: "obj_2", name: "value_1" },
      ],
      [],
    );
    expect(result.ok && result.objects.map((object) => object.name)).toEqual(["freed_later", "value_1"]);
  });

  it("ACCEPTS a rename onto a name an EARLIER deleteObject in the same batch just freed", () => {
    const result = mutate(
      pair(),
      [
        { kind: "deleteObject", objectId: "obj_1" },
        { kind: "renameObject", objectId: "obj_2", name: "value_1" },
      ],
      [],
    );
    expect(result.ok && result.objects.map((object) => object.name)).toEqual(["value_1"]);
  });

  it("REJECTS two renames in one batch claiming the SAME new name, naming the second operation", () => {
    const result = mutate(
      pair(),
      [
        { kind: "renameObject", objectId: "obj_1", name: "same" },
        { kind: "renameObject", objectId: "obj_2", name: "same" },
      ],
      [],
    );
    expect(result.ok === false && result.message).toBe('operation 2 of 2 cannot rename: the name "same" is already in use');
  });

  it("REJECTS a rename onto a name an EARLIER createObject in the same batch took — the created object is in the simulation too", () => {
    const result = mutate(
      pair(),
      [
        { kind: "createObject", object: valueObject("obj_3", "fresh", 3) },
        { kind: "renameObject", objectId: "obj_1", name: "FRESH" },
      ],
      [],
    );
    expect(result.ok === false && result.message).toBe('operation 2 of 2 cannot rename: the name "FRESH" is already in use');
  });

  it("names EVERY offending rename in one pass, not just the first, and a REFUSED rename frees nothing for a later one", () => {
    // Operation 1 is refused (grammar), so `value_1` is still taken when
    // operation 2 asks for it — a refused rename never enters the simulation.
    const result = mutate(
      pair(),
      [
        { kind: "renameObject", objectId: "obj_1", name: "3bad" },
        { kind: "renameObject", objectId: "obj_2", name: "value_1" },
      ],
      [],
    );
    expect(result.ok === false && result.message).toBe(
      'operation 1 of 2 cannot rename: "3bad" is not a valid name — names must match [a-zA-Z_][a-zA-Z0-9_]*; ' +
        'operation 2 of 2 cannot rename: the name "value_1" is already in use',
    );
  });

  it("D-081, now built: createObject's OWN name is checked, so a duplicate name is REJECTED rather than committed (this test used to pin the KNOWN GAP; it now pins the fix)", () => {
    const result = mutate(pair(), [{ kind: "createObject", object: valueObject("obj_3", "value_1", 3) }], []);
    expect(result.ok === false && result.message).toBe('operation 1 of 1 cannot create: the name "value_1" is already in use');
  });

  it("D-081: rejects a createObject whose name fails §5.2's grammar", () => {
    const result = mutate(pair(), [{ kind: "createObject", object: valueObject("obj_3", "3bad", 3) }], []);
    expect(result.ok === false && result.message).toBe(
      'operation 1 of 1 cannot create: "3bad" is not a valid name — names must match [a-zA-Z_][a-zA-Z0-9_]*',
    );
  });

  it("D-081/D-080: rejects a createObject whose name is a formula keyword, in any case", () => {
    const result = mutate(pair(), [{ kind: "createObject", object: valueObject("obj_3", "true", 3) }], []);
    expect(result.ok === false && (result.message.includes("reserved word") && result.message.includes('"true"'))).toBe(true);
  });

  it("D-081: two createObjects in ONE batch claiming the SAME name — the SECOND is rejected, the simulation catches what the pre-batch document could not", () => {
    const result = mutate(
      [],
      [
        { kind: "createObject", object: valueObject("obj_1", "twin", 1) },
        { kind: "createObject", object: valueObject("obj_2", "TWIN", 2) },
      ],
      [],
    );
    expect(result.ok === false && result.message).toBe('operation 2 of 2 cannot create: the name "TWIN" is already in use');
  });

  it("D-081: ACCEPTS a createObject onto a name an EARLIER delete in the same batch just freed — symmetric with the rename case above", () => {
    const result = mutate(
      pair(),
      [
        { kind: "deleteObject", objectId: "obj_1" },
        { kind: "createObject", object: valueObject("obj_3", "value_1", 3) },
      ],
      [],
    );
    expect(result.ok && result.objects.map((object) => object.name)).toEqual(["value_2", "value_1"]);
  });

  it("D-081: a REFUSED createObject claims no name for the simulation — a later operation still sees the name as taken", () => {
    // Operation 1 is refused (duplicate), so `value_1` stays claimed by the
    // ORIGINAL object — the simulation must not have half-applied the refused
    // creation on its way to rejecting the whole batch.
    const result = mutate(
      pair(),
      [
        { kind: "createObject", object: valueObject("obj_3", "value_1", 3) },
        { kind: "renameObject", objectId: "obj_2", name: "value_1" },
      ],
      [],
    );
    expect(result.ok === false && result.message).toBe(
      'operation 1 of 2 cannot create: the name "value_1" is already in use; ' +
        'operation 2 of 2 cannot rename: the name "value_1" is already in use',
    );
  });
});

describe("text.resolvedContent end-to-end through mutate (§5.6, D-114 — entry 0127)", () => {
  /**
   * A well-formed `text` object (§5.6): the five non-derived slots a derived slot
   * reads (`content` for `resolvedContent`; `width` + `style.font/fontSize/lineHeight`
   * for `measuredHeight`/`measuredWidth`) plus all THREE D-018 derived placeholders
   * (`measuredWidth` — D-123). The four pure render-config slots
   * (`height`/`overflow`/`style.color`/`style.align`) are omitted — nothing computes
   * from them, so an absent one is D-047-legal. `width: "auto"` (no wrap). Both
   * measured slots evaluate to `#MEASURE` here (`mutate` passes
   * `NULL_EVAL_CONTEXT`) — legitimate state, not a refusal.
   */
  function textObject(id: string, name: string, content: string): GraphObject {
    return {
      id,
      name,
      type: "text",
      slots: {
        content: { kind: "literal", value: content },
        width: { kind: "literal", value: "auto" },
        "style.font": { kind: "literal", value: "sans" },
        "style.fontSize": { kind: "literal", value: 12 },
        "style.lineHeight": { kind: "literal", value: 14 },
        resolvedContent: { kind: "derived", value: null },
        measuredHeight: { kind: "derived", value: null },
        measuredWidth: { kind: "derived", value: null },
      },
    };
  }

  function resolvedContentOf(objects: readonly GraphObject[], textId: string): unknown {
    const created = mutate([], objects.map((object) => ({ kind: "createObject", object }) as const), []);
    expect(created.ok).toBe(true);
    if (!created.ok) {
      throw new Error(created.message);
    }
    return created.objects.find((o) => o.id === textId)?.slots.resolvedContent?.value;
  }

  it("derives one edge per referenced cell plus the content self-edge, and no edge for an empty in-extent cell (D-110 clause 4)", () => {
    const table = tableObject("obj_t", "table_1", 4, 4, { "cells.A1": { kind: "literal", value: 3 } });
    const text = textObject("obj_x", "text_1", "{= table_1.A1 } vs empty {= table_1.C3 }");
    expectSameEdges(deriveEdges([table, text]), [
      // resolvedContent (dynamic): content self-edge + one per populated referenced
      // cell. table_1.C3 is empty in-extent -> no edge (D-110 clause 4).
      { sourceSlot: addr("obj_x", "content"), dependentSlot: addr("obj_x", "resolvedContent") },
      { sourceSlot: addr("obj_t", "cells", "A1"), dependentSlot: addr("obj_x", "resolvedContent") },
      // measuredHeight (static, entry 0129): resolvedContent + width + the three
      // size-relevant style fields, all same-object.
      { sourceSlot: addr("obj_x", "resolvedContent"), dependentSlot: addr("obj_x", "measuredHeight") },
      { sourceSlot: addr("obj_x", "width"), dependentSlot: addr("obj_x", "measuredHeight") },
      { sourceSlot: addr("obj_x", "style", "font"), dependentSlot: addr("obj_x", "measuredHeight") },
      { sourceSlot: addr("obj_x", "style", "fontSize"), dependentSlot: addr("obj_x", "measuredHeight") },
      { sourceSlot: addr("obj_x", "style", "lineHeight"), dependentSlot: addr("obj_x", "measuredHeight") },
      // measuredWidth (static, D-123): the SAME five sources — one measurement
      // answers both, so both subscribe identically.
      { sourceSlot: addr("obj_x", "resolvedContent"), dependentSlot: addr("obj_x", "measuredWidth") },
      { sourceSlot: addr("obj_x", "width"), dependentSlot: addr("obj_x", "measuredWidth") },
      { sourceSlot: addr("obj_x", "style", "font"), dependentSlot: addr("obj_x", "measuredWidth") },
      { sourceSlot: addr("obj_x", "style", "fontSize"), dependentSlot: addr("obj_x", "measuredWidth") },
      { sourceSlot: addr("obj_x", "style", "lineHeight"), dependentSlot: addr("obj_x", "measuredWidth") },
    ]);
  });

  it("resolves an embedded formula against a real cell, end to end", () => {
    const table = tableObject("obj_t", "table_1", 4, 4, { "cells.A1": { kind: "literal", value: 21 } });
    const text = textObject("obj_x", "text_1", "double is {= table_1.A1 * 2 }");
    expect(resolvedContentOf([table, text], "obj_x")).toBe("double is 42");
  });

  it("re-resolves when a referenced cell changes — a fresh mutation, full re-derive (Rule 5)", () => {
    const table = tableObject("obj_t", "table_1", 4, 4, { "cells.A1": { kind: "literal", value: 10 } });
    const text = textObject("obj_x", "text_1", "value {= table_1.A1 }");
    const created = mutate([], [{ kind: "createObject", object: table }, { kind: "createObject", object: text }], []);
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.message);
    expect(created.objects.find((o) => o.id === "obj_x")?.slots.resolvedContent?.value).toBe("value 10");

    const bumped = mutate(created.objects, [{ kind: "setSlot", address: addr("obj_t", "cells", "A1"), slot: { kind: "literal", value: 99 } }], created.journal);
    expect(bumped.ok).toBe(true);
    if (!bumped.ok) throw new Error(bumped.message);
    expect(bumped.objects.find((o) => o.id === "obj_x")?.slots.resolvedContent?.value).toBe("value 99");
  });

  it("subscribes to a range and a non-taken conditional branch, so both drive resolvedContent (Phase 5 gate property)", () => {
    const table = tableObject("obj_t", "table_1", 4, 4, {
      "cells.A1": { kind: "literal", value: 1 },
      "cells.A2": { kind: "literal", value: 2 },
      "cells.B1": { kind: "literal", value: 5 },
    });
    const text = textObject("obj_x", "text_1", "{? table_1.B1 > 0 }sum {= SUM(table_1.A1:table_1.A2) }{:}neg {= table_1.B1 }{?}");
    const edges = deriveEdges([table, text]);
    const sources = edges.filter((e) => addressKey(e.dependentSlot) === addressKey(addr("obj_x", "resolvedContent"))).map((e) => addressKey(e.sourceSlot));
    // content self-edge, the condition's B1, both range cells, AND B1 again from the untaken branch's own embedding.
    expect(sources).toContain(addressKey(addr("obj_t", "cells", "A1")));
    expect(sources).toContain(addressKey(addr("obj_t", "cells", "A2")));
    expect(sources).toContain(addressKey(addr("obj_t", "cells", "B1")));
    expect(resolvedContentOf([table, text], "obj_x")).toBe("sum 3");
  });

  it("a cycle through resolvedContent is rejected, naming the slots (§5.1 step 5)", () => {
    // table_1.A1 = text_1.resolvedContent (a formula cell), and text_1's content
    // reads table_1.A1 — a real slot-level cycle.
    const table = tableObject("obj_t", "table_1", 4, 4, {
      "cells.A1": { kind: "formula", ast: { type: "reference", address: addr("obj_x", "resolvedContent") }, value: null },
    });
    const text = textObject("obj_x", "text_1", "loop {= table_1.A1 }");
    const result = mutate([], [{ kind: "createObject", object: table }, { kind: "createObject", object: text }], []);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain("cyclic");
    expect(result.ok === false && result.message).toContain("resolvedContent");
  });

  it("an embedding of an OUT-OF-extent cell is a dangling reference and the whole mutation is refused (D-110 clause 6)", () => {
    const table = tableObject("obj_t", "table_1", 2, 2, {});
    const text = textObject("obj_x", "text_1", "{= table_1.D4 }");
    const result = mutate([], [{ kind: "createObject", object: table }, { kind: "createObject", object: text }], []);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain("does not exist");
  });
});

describe("text.measuredHeight end-to-end through mutate (§5.6, D-118 — entry 0129)", () => {
  const WELL_FORMED_TEXT_SLOTS: Record<string, Slot> = {
    content: { kind: "literal", value: "hello world" },
    width: { kind: "literal", value: "auto" },
    "style.font": { kind: "literal", value: "sans" },
    "style.fontSize": { kind: "literal", value: 12 },
    "style.lineHeight": { kind: "literal", value: 14 },
    resolvedContent: { kind: "derived", value: null },
    measuredHeight: { kind: "derived", value: null },
    measuredWidth: { kind: "derived", value: null }, // D-123's third derived slot
  };

  /** A `text` object with the well-formed slot set minus whatever `omit` names (§5.6, entry 0129). */
  function textObject(id: string, name: string, omit: readonly string[] = []): GraphObject {
    const slots: Record<string, Slot> = {};
    for (const [key, slot] of Object.entries(WELL_FORMED_TEXT_SLOTS)) {
      if (!omit.includes(key)) {
        slots[key] = slot;
      }
    }
    return { id, name, type: "text", slots };
  }

  function createAndGet(object: GraphObject): GraphObject {
    const r = mutate([], [{ kind: "createObject", object }], []);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.message);
    const found = r.objects.find((o) => o.id === object.id);
    if (found === undefined) throw new Error("created object missing from result");
    return found;
  }

  it("D-118: a real text object created through mutate (which passes NULL_EVAL_CONTEXT) gets measuredHeight = #MEASURE, and the mutation still commits", () => {
    const created = createAndGet(textObject("obj_x", "text_1"));
    expect(created.slots.measuredHeight?.value).toMatchObject({ error: "#MEASURE" });
    // §5.1: an ErrorValue is legitimate state, not a reason to reject.
    expect(created.slots.resolvedContent?.value).toBe("hello world");
  });

  it("measuredHeight subscribes to width and the size-relevant style fields (deriveEdges Source 2, static)", () => {
    const edges = deriveEdges([textObject("obj_x", "text_1")]);
    const intoMeasuredHeight = edges
      .filter((e) => addressKey(e.dependentSlot) === addressKey(addr("obj_x", "measuredHeight")))
      .map((e) => addressKey(e.sourceSlot))
      .sort();
    expect(intoMeasuredHeight).toEqual(
      [
        addr("obj_x", "resolvedContent"),
        addr("obj_x", "width"),
        addr("obj_x", "style", "font"),
        addr("obj_x", "style", "fontSize"),
        addr("obj_x", "style", "lineHeight"),
      ]
        .map(addressKey)
        .sort(),
    );
  });

  it("a text object missing a measuredHeight input slot (style.font) is REFUSED — the static dep would be a dangling edge (§5.1.1)", () => {
    const r = mutate([], [{ kind: "createObject", object: textObject("obj_x", "text_1", ["style.font"]) }], []);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.message).toContain("does not exist");
  });

  it("a text object with NO measuredHeight derived-slot placeholder is REFUSED (D-018)", () => {
    const r = mutate([], [{ kind: "createObject", object: textObject("obj_x", "text_1", ["measuredHeight"]) }], []);
    expect(r.ok).toBe(false);
  });

  it("D-123: measuredWidth is #MEASURE under NULL_EVAL_CONTEXT too — the pair fails together, never one and not the other", () => {
    const created = createAndGet(textObject("obj_x", "text_1"));
    expect(created.slots.measuredWidth?.value).toMatchObject({ error: "#MEASURE" });
    expect(created.slots.measuredHeight?.value).toMatchObject({ error: "#MEASURE" });
  });

  it("D-123 clause 1: measuredWidth subscribes to the SAME five sources measuredHeight does", () => {
    const edges = deriveEdges([textObject("obj_x", "text_1")]);
    const sourcesInto = (path: readonly string[]): readonly string[] =>
      edges
        .filter((e) => addressKey(e.dependentSlot) === addressKey({ objectId: "obj_x", path }))
        .map((e) => addressKey(e.sourceSlot))
        .sort();
    expect(sourcesInto(["measuredWidth"])).toEqual(sourcesInto(["measuredHeight"]));
    expect(sourcesInto(["measuredWidth"])).toHaveLength(5);
  });

  it("a text object with NO measuredWidth derived-slot placeholder is REFUSED (D-018, D-123)", () => {
    const r = mutate([], [{ kind: "createObject", object: textObject("obj_x", "text_1", ["measuredWidth"]) }], []);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.message).toContain("measuredWidth");
  });
});
