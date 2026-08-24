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
    const noSchemaYet: GraphObject = {
      id: "obj_1",
      name: "circle_1",
      type: "circle",
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
    const noSchemaYet: GraphObject = {
      id: "obj_1",
      name: "circle_1",
      type: "circle",
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
// The range-evaluation wiring (STATUS.md's "Next slice"; D-036's five
// constraints, all landing this cycle). These are the end-to-end proofs
// closest to PROJECT_BRIEF §6 Phase 2's own acceptance criterion — but see
// each test's own note for exactly which clause it demonstrates and which
// clause (row/column insert/delete, the repair-vs-force reject path) still
// needs the still-deferred resize/creation cycle: this cycle does not claim
// the phase criterion complete.
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

  it("D-047 item 4's boundary: a plain ReferenceNode (not a range) to an absent slot is STILL rejected as a dangling reference — this fix must not over-reach", () => {
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

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("does not exist");
    }
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

describe("mutate — InsertTableLineOperation: §5.4 row/column insertion (entry 0046)", () => {
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
