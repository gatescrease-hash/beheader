/**
 * mutation.test.ts
 *
 * The eight step mutation loop. The largest suite in the repository.
 * It covers each refusal path, the batch form, and the proof that a refused
 * mutation leaves the old state untouched.
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

function addr(objectId: string, ...path: readonly string[]): Address {
  return { objectId, path };
}

function valueObject(id: string, name: string, value: number): GraphObject {
  return { id, name, type: "value", slots: { value: { kind: "literal", value } } };
}

function addObject(id: string, name: string, aRef: Address, bRef: Address): GraphObject {
  const slots: Record<string, Slot> = {
    "in.a": { kind: "formula", ast: { type: "reference", address: aRef }, value: null },
    "in.b": { kind: "formula", ast: { type: "reference", address: bRef }, value: null },
    "out.result": { kind: "derived", value: null },
  };
  return { id, name, type: "add", slots };
}

function edgeIdentity(edge: Edge): string {
  return `${addressKey(edge.sourceSlot)}=>${addressKey(edge.dependentSlot)}`;
}

function expectSameEdges(actual: readonly Edge[], expected: readonly Edge[]): void {
  expect(new Set(actual.map(edgeIdentity))).toEqual(new Set(expected.map(edgeIdentity)));
  expect(actual).toHaveLength(expected.length);
}

describe("deriveEdges — the value and add fixture", () => {
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
      name: "unbuilt_1",
      type: "unbuilt" as GraphObject["type"],
      slots: { radius: { kind: "literal", value: 5 } },
    };

    expect(() => deriveEdges([noSchemaYet])).not.toThrow();
    expect(deriveEdges([noSchemaYet])).toEqual([]);
  });
});

describe("deriveEdges — a non-derived path currently holding a literal, not a formula", () => {
  it("derives no binding edge for that path, but still derives the derived slot's schema-declared dependency edges", () => {
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
  it("still derives the edge verbatim — an address's VALIDITY is step 4's job, not edge derivation's", () => {
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

describe("deriveEdges — a formula slot the object carries but its schema does not declare", () => {
  it("still derives NO edge for it, because the check that catches this lives in validateIntegrity", () => {
    const objects = [addWithUndeclaredSlot(addr("obj_1", "value")), valueObject("obj_1", "value_1", 42)];

    expect(deriveEdges(objects)).not.toContainEqual({
      sourceSlot: addr("obj_1", "value"),
      dependentSlot: addr("obj_9", "in", "c"),
    });
  });
});

describe("validateIntegrity — it refuses an undeclared formula or derived slot", () => {
  it("rejects an object carrying a formula slot its own schema does not declare, naming it", () => {
    const objects = [addWithUndeclaredSlot(addr("obj_1", "value")), valueObject("obj_1", "value_1", 42)];
    const edges = deriveEdges(objects);

    const result = validateIntegrity(objects, edges);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("add_9.in.c");
    }
  });

  it("was previously a KNOWN GAP: the same cyclic document that hid a real cycle from detectCycle is now rejected before detectCycle is ever reached", () => {
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

    expect(detectCycle(edges)).toEqual({ hasCycle: false });

    const result = validateIntegrity([cyclic], edges);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("add_9.in.c");
    }
  });

  it("does not flag an object whose type has no schema entry at all, the one permitted exception", () => {
    const noSchemaYet: GraphObject = {
      id: "obj_1",
      name: "unbuilt_1",
      type: "unbuilt" as GraphObject["type"],
      slots: { radius: { kind: "literal", value: 5 } },
    };
    expect(validateIntegrity([noSchemaYet], deriveEdges([noSchemaYet]))).toEqual({ ok: true });
  });
});

describe("deriveEdges and validateIntegrity — every FormulaAst shape is supported", () => {
  it("accepts a formula slot holding a bare LiteralNode — no edges needed, no rejection", () => {
    const objects: GraphObject[] = [
      { id: "obj_1", name: "value_1", type: "value", slots: { value: { kind: "formula", ast: { type: "literal", value: 42 }, value: null } } },
    ];

    expect(deriveEdges(objects)).toEqual([]);
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

  it("an ErrorNode is accepted as legitimate, already-repaired state, not rejected", () => {
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

  it("committed via the real mutate() entry point — a formula that holds a range is storable", () => {
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

describe("validateIntegrity — it refuses an illegal number literal inside a stored AST, as it already refuses an illegal slot value", () => {
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

describe("validateIntegrity — a formula that names a slot which does not exist", () => {
  it("rejects a formula whose reference resolves to no object at all, naming the DEPENDENT slot", () => {
    const objects = [
      valueObject("obj_2", "value_2", 5),
      addObject("obj_3", "add_1", addr("obj_999", "value"), addr("obj_2", "value")),
    ];
    const edges = deriveEdges(objects);

    const result = validateIntegrity(objects, edges);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("add_1.in.a");
      expect(result.message).not.toContain("obj_999");
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

  it("passes the well formed value and add fixture", () => {
    const objects = [
      valueObject("obj_1", "value_1", 10),
      valueObject("obj_2", "value_2", 5),
      addObject("obj_3", "add_1", addr("obj_1", "value"), addr("obj_2", "value")),
    ];
    expect(validateIntegrity(objects, deriveEdges(objects))).toEqual({ ok: true });
  });

  it("runs the undeclared slot check before the dangling reference check, on a document with both problems", () => {
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
      expect(result.message).not.toContain("add_1.in.a");
    }
  });

  it("never throws for any of the above documents", () => {
    const objects = [addWithUndeclaredSlot(addr("obj_1", "value")), valueObject("obj_1", "value_1", 42)];
    expect(() => validateIntegrity(objects, deriveEdges(objects))).not.toThrow();
    expect(() => validateIntegrity([], [])).not.toThrow();
  });
});

describe("deriveValidateAndEvaluate — composing deriveEdges -> validateIntegrity -> detectCycle -> evaluate", () => {
  it("evaluates the fixture end to end, including through a derived slot, with no hand-built edges anywhere", () => {
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

  it("runs validateIntegrity before detectCycle: when a document has BOTH an undeclared slot AND an unrelated genuine cycle, only the undeclared slot message is reported", () => {
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
      expect(result.message).not.toContain("cyclic dependency");
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

  it("forwards a caller-supplied EvalContext to step 7 untouched, without changing a context-ignoring result", () => {
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

    expect(withDefault).toEqual(withContext);
    expect(measureCalls).toBe(0);
  });
});

describe("mutate — the full loop: stage, apply, validate, detect, evaluate, commit and journal", () => {
  it("mutates a value's literal and watches it propagate through a derived slot, and appends one journal entry", () => {
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
      expect(add1?.slots["out.result"]).toEqual({ kind: "derived", value: 104 });
      expect(result.journal).toEqual([{ operations: [operation] }]);
    }
  });

  it("accepts an optional EvalContext as its fourth argument and forwards it to evaluation", () => {
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
    if (withContext.ok && withDefault.ok) {
      expect(withContext.objects).toEqual(withDefault.objects);
    }
    expect(measureCalls).toBe(0);
  });

  it("rejects a mutation that would introduce a cycle, naming every slot in it", () => {
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

  it("leaves the caller's objects and journal provably unchanged when a mutation is rejected", () => {
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

    expect(result.ok).toBe(false);
    expect(initial).toEqual(snapshotObjectsBefore);
    expect(priorJournal).toEqual(snapshotJournalBefore);
  });

  it("rejects a dangling reference before ever evaluating, leaving prior state unchanged", () => {
    const initial = [valueObject("obj_1", "value_1", 1)];
    const snapshotBefore = JSON.parse(JSON.stringify(initial)) as unknown;
    const operation: Operation = {
      kind: "setSlot",
      address: addr("obj_1", "value"),
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

  it("rejects an operation naming a nonexistent object, rather than applying nothing and journalling a false record", () => {
    const initial = [valueObject("obj_1", "value_1", 1)];
    const priorJournal: MutationJournalEntry[] = [];
    const snapshotObjectsBefore = JSON.parse(JSON.stringify(initial)) as unknown;
    const operation: Operation = { kind: "setSlot", address: addr("obj_404", "value"), slot: { kind: "literal", value: 9 } };

    const result = mutate(initial, [operation], priorJournal);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain(`object id "obj_404"`);
      expect(result.message).toContain(`slot "value"`);
    }
    expect(initial).toEqual(snapshotObjectsBefore);
    expect(priorJournal).toEqual([]);
  });
});

describe("mutate — the batch form", () => {
  it("applies every operation in the batch to the SAME clone, in order, appending exactly ONE journal entry holding the whole list", () => {
    const initial = [valueObject("obj_1", "value_1", 3), valueObject("obj_2", "value_2", 4), addObject("obj_3", "add_1", addr("obj_1", "value"), addr("obj_2", "value"))];
    const firstOp: Operation = { kind: "setSlot", address: addr("obj_1", "value"), slot: { kind: "literal", value: 10 } };
    const secondOp: Operation = { kind: "setSlot", address: addr("obj_2", "value"), slot: { kind: "literal", value: 20 } };

    const result = mutate(initial, [firstOp, secondOp], []);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const add1 = result.objects.find((object) => object.id === "obj_3");
    expect(add1?.slots["out.result"]).toEqual({ kind: "derived", value: 30 });
    expect(result.journal).toEqual([{ operations: [firstOp, secondOp] }]);
  });

  it("lets a LATER operation in the same batch overwrite what an EARLIER one in the same batch just wrote — last write wins", () => {
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
    expect(initial).toEqual(snapshotBefore);
  });

  it("rejects an empty batch outright, rather than cloning/validating/evaluating/journalling nothing", () => {
    const initial = [valueObject("obj_1", "value_1", 1)];
    const snapshotBefore = JSON.parse(JSON.stringify(initial)) as unknown;

    const result = mutate(initial, [], []);

    expect(result.ok).toBe(false);
    expect(initial).toEqual(snapshotBefore);
  });

  it("rejects the whole batch, naming EVERY operation with a nonexistent target, not only the first, across the whole batch", () => {
    const initial = [valueObject("obj_1", "value_1", 1)];
    const firstMissing: Operation = { kind: "setSlot", address: addr("obj_404", "value"), slot: { kind: "literal", value: 1 } };
    const fine: Operation = { kind: "setSlot", address: addr("obj_1", "value"), slot: { kind: "literal", value: 2 } };
    const secondMissing: Operation = { kind: "setSlot", address: addr("obj_405", "x", "y"), slot: { kind: "literal", value: 3 } };

    const result = mutate(initial, [firstMissing, fine, secondMissing], []);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain(`operation 1 of 3`);
      expect(result.message).toContain(`operation 3 of 3`);
      expect(result.message).toContain(`object id "obj_404"`);
      expect(result.message).toContain(`object id "obj_405"`);
      expect(result.message).toContain(`slot "value"`);
      expect(result.message).toContain(`slot "x.y"`);
      expect(result.message).not.toContain("operation 2 of 3");
    }
  });
});

describe("validateIntegrity — the schema and the slots must agree in both directions", () => {
  it("rejects an object MISSING its schema-declared derived slot, naming it", () => {
    const missingDerivedSlot: GraphObject = {
      id: "obj_3",
      name: "add_1",
      type: "add",
      slots: {
        "in.a": { kind: "formula", ast: { type: "reference", address: addr("obj_1", "value") }, value: null },
        "in.b": { kind: "formula", ast: { type: "reference", address: addr("obj_1", "value") }, value: null },
      },
    };
    const objects = [valueObject("obj_1", "value_1", 3), missingDerivedSlot];
    const edges = deriveEdges(objects);
    expect(edges.filter((edge) => addressKey(edge.dependentSlot) === "obj_3::out.result")).toHaveLength(2);

    const result = validateIntegrity(objects, edges);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("add_1.out.result");
    }
    expect(deriveValidateAndEvaluate(objects).ok).toBe(false);
  });

  it("rejects a slot whose kind disagrees with the position the schema declares: non-derived at a derived path", () => {
    const objects: GraphObject[] = [
      {
        id: "obj_3",
        name: "add_1",
        type: "add",
        slots: {
          "in.a": { kind: "literal", value: 1 },
          "in.b": { kind: "literal", value: 2 },
          "out.result": { kind: "literal", value: 999 },
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

  it("rejects a slot whose kind disagrees with the position the schema declares: derived at a non-derived path", () => {
    const objects: GraphObject[] = [
      {
        id: "obj_3",
        name: "add_1",
        type: "add",
        slots: {
          "in.a": { kind: "derived", value: null },
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

  it("rejects, via the real mutate() entry point, a setSlot that would overwrite a derived slot with a literal", () => {
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
    expect(objects).toEqual(snapshotBefore);
  });
});

describe("mutate — the clone at step 1 keeps every member of Value, not only what JSON can hold", () => {
  it("commits null, a Point, a Point[], and an ErrorValue unchanged through an UNRELATED mutation — everything JSON cannot round-trip faithfully EXCEPT a non-finite number", () => {
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

describe("mutate — a non-finite number is not legal document state", () => {
  it("rejects a setSlot writing a non-finite literal (NaN, +Infinity, -Infinity in turn), naming the slot, prior state unchanged", () => {
    for (const nonFinite of [NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const initial = [valueObject("obj_1", "value_1", 1)];
      const snapshotBefore = JSON.parse(JSON.stringify(initial)) as unknown;
      const operation: Operation = { kind: "setSlot", address: addr("obj_1", "value"), slot: { kind: "literal", value: nonFinite } };

      const result = mutate(initial, [operation], []);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.message).toContain("value_1.value");
        expect(result.message).toContain("not legal document state");
      }
      expect(initial).toEqual(snapshotBefore);
    }
  });

  it("rejects a mutation touching an UNRELATED object when the document ALREADY holds a non-finite literal elsewhere, naming the pre-existing offender (Rule 5: recheck the whole graph)", () => {
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

    const overflowing = [
      valueObject("obj_1", "value_1", Number.MAX_VALUE),
      valueObject("obj_2", "value_2", Number.MAX_VALUE),
      addObject("obj_3", "add_1", addr("obj_1", "value"), addr("obj_2", "value")),
    ];
    const overflowed = deriveValidateAndEvaluate(overflowing);
    expect(overflowed.ok).toBe(true);
    if (overflowed.ok) {
      const result = overflowed.objects.find((object) => object.id === "obj_3")?.slots["out.result"];
      expect(result).toMatchObject({ kind: "derived", value: { error: "#TYPE" } });
    }
  });

  it("a lossy clone hides the illegal value from this check entirely", () => {
    const initial = [valueObject("obj_1", "value_1", 1)];
    const operation: Operation = { kind: "setSlot", address: addr("obj_1", "value"), slot: { kind: "literal", value: NaN } };

    const result = mutate(initial, [operation], []);

    expect(result.ok).toBe(false);
  });
});

describe("mutate — CreateObjectOperation, which the loader uses", () => {
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

  it("rejects creating an object whose id ALREADY exists, leaving prior state unchanged", () => {
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

  it("clones the created object into committed state — the caller's own payload is not aliased", () => {
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

describe("mutate — nothing the caller hands in enters committed state or the journal by reference", () => {
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
    expect(first).not.toBe(sharedPayload);
    expect(first).not.toBe(second);
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

describe("mutate — DeleteObjectOperation, behind `delete <object>`", () => {
  it("deletes an object with no dependents, removing it from the result and appending one journal entry", () => {
    const initial = [valueObject("obj_1", "value_1", 10), valueObject("obj_2", "value_2", 20)];
    const operation: Operation = { kind: "deleteObject", objectId: "obj_2" };

    const result = mutate(initial, [operation], []);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.objects.map((object) => object.id)).toEqual(["obj_1"]);
    expect(result.journal).toEqual([{ operations: [operation] }]);
  });

  it("rejects deleting an object a formula elsewhere still depends on, naming the dependent and leaving prior state unchanged", () => {
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
    expect(initial).toEqual(snapshotBefore);
  });

  it("accepts deleting an object whose ONLY dependent is being deleted in the SAME batch", () => {
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

  it("rejects deleting an object that does not exist, naming the id as an id", () => {
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

describe("mutate — the `force` flag on DeleteObjectOperation, which turns a refusal into a repair", () => {
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
    expect([table, dependent]).toEqual(snapshotBefore);
  });

  it("`force: true` REPAIRS a live REFERENCE dependent to #REF instead of rejecting, removes the table, and reports the broken slot in `brokenSlots` — the force half, closing the clause", () => {
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
    expect(result.objects.map((object) => object.id)).toEqual(["obj_2"]);

    const repaired = result.objects.find((object) => object.id === "obj_2");
    expect(repaired?.slots.value).toMatchObject({ kind: "formula", ast: { type: "error", error: "#REF" } });
    expect((repaired?.slots.value as { value: unknown }).value).toMatchObject({ error: "#REF" });

    expect(result.brokenSlots).toEqual([{ objectId: "obj_2", path: ["value"] }]);

    expect(deriveValidateAndEvaluate(result.objects).ok).toBe(true);
  });

  it("`force: true` repairs a RANGE dependent with an endpoint on the deleted table to #REF in full, because no extent remains to clamp to", () => {
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
    expect(result.brokenSlots).toEqual([{ objectId: "obj_2", path: ["value"] }]);
  });

  it("does NOT report a slot broken by an EARLIER operation when a LATER operation in the SAME batch deletes the object carrying it", () => {
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
    expect(result.brokenSlots).toEqual([]);
  });

  it("does NOT report a cell broken by a row deletion when the SAME batch then force-deletes that whole table", () => {
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

});

describe("mutate — AddVertexOperation, behind `addvertex`", () => {
  it("appends a literal vertex pair and grows vertexCount by one, leaving every earlier vertex untouched", () => {
    const polyline = polylineObject("obj_1", "polyline_1", [{ x: 0, y: 0 }, { x: 10, y: 0 }]);
    const result = mutate([polyline], [{ kind: "addVertex", objectId: "obj_1", point: { x: 10, y: 10 } }], []);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const object = result.objects.find((candidate) => candidate.id === "obj_1");
    expect(object?.vertexCount).toBe(3);
    expect(object?.slots["vertex.2.x"]).toEqual({ kind: "literal", value: 10 });
    expect(object?.slots["vertex.2.y"]).toEqual({ kind: "literal", value: 10 });
    expect(object?.slots["vertex.0.x"]).toEqual({ kind: "literal", value: 0 });
    expect(object?.slots["vertices"]).toEqual({
      kind: "derived",
      value: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }],
    });
  });

  it("rejects a point holding an illegal number, the same rule every other write follows", () => {
    const polyline = polylineObject("obj_1", "polyline_1", [{ x: 0, y: 0 }, { x: 10, y: 0 }]);
    const result = mutate([polyline], [{ kind: "addVertex", objectId: "obj_1", point: { x: Number.NaN, y: 0 } }], []);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("not legal document state");
    }
  });

  it("rejects addvertex against an object that is not a polyline, naming its real type", () => {
    const value = valueObject("obj_1", "value_1", 1);
    const result = mutate([value], [{ kind: "addVertex", objectId: "obj_1", point: { x: 0, y: 0 } }], []);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('"value"');
    }
  });
});

describe("mutate — DeleteVertexOperation, behind `delvertex`, refuses by default and repairs with force", () => {
  it("gives an appended vertex a straight edge, and leaves every bulge already drawn alone", () => {
    const polyline = polylineObject("obj_1", "polyline_1", [{ x: 0, y: 0 }, { x: 5, y: 5 }], {
      "vertex.0.bulge": { kind: "literal", value: 0.4 },
      "vertex.1.bulge": { kind: "literal", value: 0.5 },
    });
    const result = mutate([polyline], [{ kind: "addVertex", objectId: "obj_1", point: { x: 9, y: 9 } }], []);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const object = result.objects.find((candidate) => candidate.id === "obj_1");
    expect(object?.vertexCount).toBe(3);
    expect(object?.slots["vertex.0.bulge"]?.value).toBe(0.4);
    expect(object?.slots["vertex.1.bulge"]?.value).toBe(0.5);
    expect(object?.slots["vertex.2.bulge"]).toEqual({ kind: "literal", value: 0 });
  });

  it("removes the target vertex and renumbers every later one down by one, in storage", () => {
    const polyline = polylineObject("obj_1", "polyline_1", [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 10 }]);
    const result = mutate([polyline], [{ kind: "deleteVertex", objectId: "obj_1", index: 0 }], []);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const object = result.objects.find((candidate) => candidate.id === "obj_1");
    expect(object?.vertexCount).toBe(2);
    expect(object?.slots["vertex.0.x"]).toEqual({ kind: "literal", value: 5 });
    expect(object?.slots["vertex.1.x"]).toEqual({ kind: "literal", value: 10 });
    expect(object?.slots["vertex.2.x"]).toBeUndefined();
    expect(object?.slots["vertices"]).toEqual({ kind: "derived", value: [{ x: 5, y: 5 }, { x: 10, y: 10 }] });
  });

  it("carries the bulge of each surviving vertex down with it, and never leaves one behind", () => {
    const polyline = polylineObject("obj_1", "polyline_1", [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 10 }], {
      "vertex.0.bulge": { kind: "literal", value: 0.1 },
      "vertex.1.bulge": { kind: "literal", value: 0.2 },
      "vertex.2.bulge": { kind: "literal", value: 0.3 },
    });
    const result = mutate([polyline], [{ kind: "deleteVertex", objectId: "obj_1", index: 0 }], []);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const object = result.objects.find((candidate) => candidate.id === "obj_1");
    expect(object?.slots["vertex.0.bulge"]?.value).toBe(0.2);
    expect(object?.slots["vertex.1.bulge"]?.value).toBe(0.3);
    expect(object?.slots["vertex.2.bulge"]).toBeUndefined();
  });

  it("REFUSES a live reference to the bulge of the deleted vertex, the same trap the coordinates carry", () => {
    const polyline = polylineObject("obj_1", "polyline_1", [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 10 }], {
      "vertex.1.bulge": { kind: "literal", value: 0.2 },
    });
    const dependent: GraphObject = {
      id: "obj_2",
      name: "value_1",
      type: "value",
      slots: { value: { kind: "formula", ast: { type: "reference", address: addr("obj_1", "vertex", "1", "bulge") }, value: 0.2 } },
    };
    const result = mutate([polyline, dependent], [{ kind: "deleteVertex", objectId: "obj_1", index: 1 }], []);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("value_1.value");
    }
  });

  it("shifts a reference to a LATER bulge down one, the same as a reference to a later coordinate", () => {
    const polyline = polylineObject("obj_1", "polyline_1", [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 10 }], {
      "vertex.2.bulge": { kind: "literal", value: 0.3 },
    });
    const dependent: GraphObject = {
      id: "obj_2",
      name: "value_1",
      type: "value",
      slots: { value: { kind: "formula", ast: { type: "reference", address: addr("obj_1", "vertex", "2", "bulge") }, value: 0.3 } },
    };
    const result = mutate([polyline, dependent], [{ kind: "deleteVertex", objectId: "obj_1", index: 0 }], []);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.objects.find((candidate) => candidate.id === "obj_2")?.slots.value).toMatchObject({
      kind: "formula",
      ast: { type: "reference", address: addr("obj_1", "vertex", "1", "bulge") },
    });
  });

  it("shifts a SURVIVING reference elsewhere down to match, without force — it is not a break, the same vertex moved", () => {
    const polyline = polylineObject("obj_1", "polyline_1", [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 10 }]);
    const dependent: GraphObject = {
      id: "obj_2",
      name: "value_1",
      type: "value",
      slots: { value: { kind: "formula", ast: { type: "reference", address: addr("obj_1", "vertex", "2", "x") }, value: 10 } },
    };
    const result = mutate([polyline, dependent], [{ kind: "deleteVertex", objectId: "obj_1", index: 0 }], []);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const repaired = result.objects.find((candidate) => candidate.id === "obj_2");
    expect(repaired?.slots.value).toMatchObject({ kind: "formula", ast: { type: "reference", address: addr("obj_1", "vertex", "1", "x") } });
    expect(repaired?.slots.value?.value).toBe(10);
  });

  it("REJECTS by default when a live reference names the exact deleted vertex, leaving prior state unchanged", () => {
    const polyline = polylineObject("obj_1", "polyline_1", [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 10 }]);
    const dependent: GraphObject = {
      id: "obj_2",
      name: "value_1",
      type: "value",
      slots: { value: { kind: "formula", ast: { type: "reference", address: addr("obj_1", "vertex", "1", "x") }, value: 5 } },
    };
    const snapshotBefore = JSON.parse(JSON.stringify([polyline, dependent])) as unknown;

    const result = mutate([polyline, dependent], [{ kind: "deleteVertex", objectId: "obj_1", index: 1 }], []);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("value_1.value");
    }
    expect([polyline, dependent]).toEqual(snapshotBefore);
  });

  it("`force: true` repairs the exact hit to #REF, still shifts the survivors, and reports the broken slot", () => {
    const polyline = polylineObject("obj_1", "polyline_1", [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 10 }]);
    const exactHit: GraphObject = {
      id: "obj_2",
      name: "value_1",
      type: "value",
      slots: { value: { kind: "formula", ast: { type: "reference", address: addr("obj_1", "vertex", "1", "x") }, value: 5 } },
    };
    const survivor: GraphObject = {
      id: "obj_3",
      name: "value_2",
      type: "value",
      slots: { value: { kind: "formula", ast: { type: "reference", address: addr("obj_1", "vertex", "2", "x") }, value: 10 } },
    };
    const result = mutate([polyline, exactHit, survivor], [{ kind: "deleteVertex", objectId: "obj_1", index: 1, force: true }], []);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const repairedExactHit = result.objects.find((candidate) => candidate.id === "obj_2");
    expect(repairedExactHit?.slots.value).toMatchObject({ kind: "formula", ast: { type: "error", error: "#REF" } });
    const repairedSurvivor = result.objects.find((candidate) => candidate.id === "obj_3");
    expect(repairedSurvivor?.slots.value).toMatchObject({ kind: "formula", ast: { type: "reference", address: addr("obj_1", "vertex", "1", "x") } });
    expect(result.brokenSlots).toEqual([{ objectId: "obj_2", path: ["value"] }]);
    expect(deriveValidateAndEvaluate(result.objects).ok).toBe(true);
  });

  it("rejects an out of range index, naming the current count and the legal range", () => {
    const polyline = polylineObject("obj_1", "polyline_1", [{ x: 0, y: 0 }, { x: 5, y: 5 }]);
    const result = mutate([polyline], [{ kind: "deleteVertex", objectId: "obj_1", index: 2 }], []);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("out of range");
      expect(result.message).toContain("0 to 1");
    }
  });

  it("rejects delvertex against an object that is not a polyline, naming its real type", () => {
    const value = valueObject("obj_1", "value_1", 1);
    const result = mutate([value], [{ kind: "deleteVertex", objectId: "obj_1", index: 0 }], []);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('"value"');
    }
  });

  it("lets a polyline go below two vertices — a degenerate polyline is normal state, evaluated to #TYPE, not a refusal", () => {
    const polyline = polylineObject("obj_1", "polyline_1", [{ x: 0, y: 0 }, { x: 5, y: 5 }]);
    const result = mutate([polyline], [{ kind: "deleteVertex", objectId: "obj_1", index: 0 }], []);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const object = result.objects.find((candidate) => candidate.id === "obj_1");
    expect(object?.vertexCount).toBe(1);
    expect(object?.slots["vertices"]).toMatchObject({ kind: "derived", value: { error: "#TYPE" } });
  });
});

describe("mutate — ExplodeOperation, behind `explode`, turns a preset into an editable path", () => {
  it("changes only the type, keeping the same id and name, and snapshots vertices into literal per vertex slots", () => {
    const rect = createdRect("obj_1", "rect_1", 0, 0, 10, 5);
    const result = mutate([rect], [{ kind: "explode", objectId: "obj_1" }], []);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const object = result.objects.find((candidate) => candidate.id === "obj_1");
    expect(object?.id).toBe("obj_1");
    expect(object?.name).toBe("rect_1");
    expect(object?.type).toBe("polyline");
    expect(object?.vertexCount).toBe(4);
    expect(object?.slots["vertex.0.x"]).toEqual({ kind: "literal", value: 0 });
    expect(object?.slots["vertex.1.x"]).toEqual({ kind: "literal", value: 10 });
  });

  it("keeps vertices, centroid, area, length and bounds working at the same paths, with no repair needed", () => {
    const rect = createdRect("obj_1", "rect_1", 0, 0, 10, 5);
    const result = mutate([rect], [{ kind: "explode", objectId: "obj_1" }], []);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const object = result.objects.find((candidate) => candidate.id === "obj_1");
    expect(object?.slots["vertices"]).toEqual({
      kind: "derived",
      value: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 5 },
        { x: 0, y: 5 },
      ],
    });
    expect(object?.slots["centroid.x"]?.value).toBeCloseTo(5);
    expect(object?.slots["bounds.maxX"]?.value).toBe(10);
    expect(object?.slots["closed"]).toEqual({ kind: "literal", value: true });
    expect(object?.slots["area"]?.value).toBeCloseTo(50);
  });

  it("does not refuse when a live reference reads a path that survives the explode (vertices, centroid, length, bounds)", () => {
    const rect = createdRect("obj_1", "rect_1", 0, 0, 10, 5);
    const dependent: GraphObject = {
      id: "obj_2",
      name: "value_1",
      type: "value",
      slots: { value: { kind: "formula", ast: { type: "reference", address: addr("obj_1", "centroid", "x") }, value: 5 } },
    };
    const result = mutate([rect, dependent], [{ kind: "explode", objectId: "obj_1" }], []);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const survivor = result.objects.find((candidate) => candidate.id === "obj_2");
    expect(survivor?.slots.value?.value).toBeCloseTo(5);
  });

  it("REJECTS by default when a live reference reads a parameter slot the explode would remove, leaving prior state unchanged", () => {
    const rect = createdRect("obj_1", "rect_1", 0, 0, 10, 5);
    const dependent: GraphObject = {
      id: "obj_2",
      name: "value_1",
      type: "value",
      slots: { value: { kind: "formula", ast: { type: "reference", address: addr("obj_1", "width") }, value: 10 } },
    };
    const snapshotBefore = JSON.parse(JSON.stringify([rect, dependent])) as unknown;

    const result = mutate([rect, dependent], [{ kind: "explode", objectId: "obj_1" }], []);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("value_1.value");
    }
    expect([rect, dependent]).toEqual(snapshotBefore);
  });

  it("does not refuse a live reference to AREA either — the exploded path is closed, so area survives with the same value", () => {
    const rect = createdRect("obj_1", "rect_1", 0, 0, 10, 5);
    const dependent: GraphObject = {
      id: "obj_2",
      name: "value_1",
      type: "value",
      slots: { value: { kind: "formula", ast: { type: "reference", address: addr("obj_1", "area") }, value: 50 } },
    };
    const result = mutate([rect, dependent], [{ kind: "explode", objectId: "obj_1" }], []);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.objects.find((candidate) => candidate.id === "obj_2")?.slots["value"]?.value).toBeCloseTo(50);
  });

  it("`force: true` repairs a removed parameter reference to #REF, still leaves a surviving reference untouched, and reports the broken slot", () => {
    const rect = createdRect("obj_1", "rect_1", 0, 0, 10, 5);
    const removed: GraphObject = {
      id: "obj_2",
      name: "value_1",
      type: "value",
      slots: { value: { kind: "formula", ast: { type: "reference", address: addr("obj_1", "width") }, value: 10 } },
    };
    const survivor: GraphObject = {
      id: "obj_3",
      name: "value_2",
      type: "value",
      slots: { value: { kind: "formula", ast: { type: "reference", address: addr("obj_1", "centroid", "x") }, value: 5 } },
    };
    const result = mutate([rect, removed, survivor], [{ kind: "explode", objectId: "obj_1", force: true }], []);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const repairedRemoved = result.objects.find((candidate) => candidate.id === "obj_2");
    expect(repairedRemoved?.slots.value).toMatchObject({ kind: "formula", ast: { type: "error", error: "#REF" } });
    const repairedSurvivor = result.objects.find((candidate) => candidate.id === "obj_3");
    expect(repairedSurvivor?.slots.value).toMatchObject({ kind: "formula", ast: { type: "reference", address: addr("obj_1", "centroid", "x") } });
    expect(result.brokenSlots).toEqual([{ objectId: "obj_2", path: ["value"] }]);
    expect(deriveValidateAndEvaluate(result.objects).ok).toBe(true);
  });

  it("refuses a type that is not a preset, naming its real type", () => {
    const polyline = polylineObject("obj_1", "polyline_1", [{ x: 0, y: 0 }, { x: 5, y: 5 }]);
    const result = mutate([polyline], [{ kind: "explode", objectId: "obj_1" }], []);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('"polyline"');
    }
  });

  it("refuses when vertices holds an error, since there is nothing to snapshot", () => {
    const negativeRadius: GraphObject = {
      id: "obj_1",
      name: "circle_1",
      type: "circle",
      slots: {
        "origin.x": { kind: "literal", value: 0 },
        "origin.y": { kind: "literal", value: 0 },
        radius: { kind: "literal", value: -5 },
        ...presetPlaceholders(),
      },
    };
    const created = mutate([], [{ kind: "createObject", object: negativeRadius }], []);
    if (!created.ok) {
      throw new Error(`test setup: expected creation to succeed, got: ${created.message}`);
    }
    const result = mutate(created.objects, [{ kind: "explode", objectId: "obj_1" }], []);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("nothing to snapshot");
    }
  });
});

describe("mutate — the refusal says which non-finite value it found", () => {
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

describe("mutate — a negative zero is not legal document state", () => {
  it("rejects a setSlot writing a bare -0 literal, naming the slot, prior state unchanged, distinguishing it from legal 0", () => {
    const initial = [valueObject("obj_1", "value_1", 1)];
    const snapshotBefore = JSON.parse(JSON.stringify(initial)) as unknown;
    const operation: Operation = { kind: "setSlot", address: addr("obj_1", "value"), slot: { kind: "literal", value: -0 } };

    const result = mutate(initial, [operation], []);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("value_1.value");
      expect(result.message).toContain("not legal document state");
      expect(result.message).toContain("-0");
    }
    expect(initial).toEqual(snapshotBefore);
  });

  it("accepts a setSlot writing plain 0, because the rule is about the sign, not about zero", () => {
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

describe("mutate — the same value rules on the operation payload, before the stage step", () => {
  it("(probe A) rejects a batch where an EARLIER setSlot carries an illegal value even though a LATER setSlot in the SAME batch overwrites it — nothing partially commits, nothing is journalled", () => {
    const initial = [valueObject("obj_1", "value_1", 1)];
    const snapshotBefore = JSON.parse(JSON.stringify(initial)) as unknown;
    const illegalFirst: Operation = { kind: "setSlot", address: addr("obj_1", "value"), slot: { kind: "literal", value: Number.POSITIVE_INFINITY } };
    const legalSecond: Operation = { kind: "setSlot", address: addr("obj_1", "value"), slot: { kind: "literal", value: 5 } };

    const result = mutate(initial, [illegalFirst, legalSecond], []);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("operation 1 of 2");
      expect(result.message).toContain("value_1.value");
      expect(result.message).toContain("not legal document state");
    }
    expect(initial).toEqual(snapshotBefore);
  });

  it("(probe F) rejects a batch that creates an object with an illegal slot even though the SAME batch deletes that object afterward", () => {
    const illegalObject: GraphObject = { id: "obj_2", name: "value_2", type: "value", slots: { value: { kind: "literal", value: NaN } } };
    const create: Operation = { kind: "createObject", object: illegalObject };
    const deleteAfter: Operation = { kind: "deleteObject", objectId: "obj_2" };

    const result = mutate([], [create, deleteAfter], []);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("operation 1 of 2");
      expect(result.message).toContain("value_2.value");
      expect(result.message).toContain("not legal document state");
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
    const initial = [valueObject("obj_1", "value_1", 1)];
    const operation: Operation = { kind: "setSlot", address: addr("obj_1", "value"), slot: { kind: "literal", value: 42 } };

    const result = mutate(initial, [operation], []);

    expect(result.ok).toBe(true);
  });
});

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

function polylinePlaceholders(): Record<string, Slot> {
  return {
    vertices: { kind: "derived", value: null },
    "centroid.x": { kind: "derived", value: null },
    "centroid.y": { kind: "derived", value: null },
    area: { kind: "derived", value: null },
    length: { kind: "derived", value: null },
    "bounds.minX": { kind: "derived", value: null },
    "bounds.minY": { kind: "derived", value: null },
    "bounds.maxX": { kind: "derived", value: null },
    "bounds.maxY": { kind: "derived", value: null },
  };
}

function polylineObject(id: string, name: string, points: readonly { readonly x: number; readonly y: number }[], vertexSlots: Record<string, Slot> = {}): GraphObject {
  const slots: Record<string, Slot> = { closed: { kind: "literal", value: false }, ...polylinePlaceholders() };
  points.forEach((point, index) => {
    slots[`vertex.${index}.x`] = { kind: "literal", value: point.x };
    slots[`vertex.${index}.y`] = { kind: "literal", value: point.y };
  });
  return { id, name, type: "polyline", vertexCount: points.length, slots: { ...slots, ...vertexSlots } };
}

function presetPlaceholders(): Record<string, Slot> {
  return {
    vertices: { kind: "derived", value: null },
    "centroid.x": { kind: "derived", value: null },
    "centroid.y": { kind: "derived", value: null },
    area: { kind: "derived", value: null },
    length: { kind: "derived", value: null },
    "bounds.minX": { kind: "derived", value: null },
    "bounds.minY": { kind: "derived", value: null },
    "bounds.maxX": { kind: "derived", value: null },
    "bounds.maxY": { kind: "derived", value: null },
  };
}

function rectObject(id: string, name: string, originX: number, originY: number, width: number, height: number): GraphObject {
  return {
    id,
    name,
    type: "rect",
    slots: {
      "origin.x": { kind: "literal", value: originX },
      "origin.y": { kind: "literal", value: originY },
      width: { kind: "literal", value: width },
      height: { kind: "literal", value: height },
      ...presetPlaceholders(),
    },
  };
}

function createdRect(id: string, name: string, originX: number, originY: number, width: number, height: number): GraphObject {
  const result = mutate([], [{ kind: "createObject", object: rectObject(id, name, originX, originY, width, height) }], []);
  if (!result.ok) {
    throw new Error(`test setup: expected the rect to be created, got: ${result.message}`);
  }
  const object = result.objects.find((candidate) => candidate.id === id);
  if (object === undefined) {
    throw new Error("test setup: expected the rect to survive creation");
  }
  return object;
}

describe("deriveEdges — table's dynamic cell family", () => {
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

  it("derives no edge for a formula cell OUTSIDE the table's current rows/cols, which is the dynamic family version of the same gap", () => {
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

  it("a formula cell in one table may reference a cell in a DIFFERENT table, because a table is self contained and can still read another one", () => {
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

describe("validateIntegrity — it refuses a stray formula cell outside the extent of a table", () => {
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

  it("the other direction still applies: a cell inside the extent with a derived kind is refused, because a table declares no derived slots", () => {
    const objects: GraphObject[] = [
      tableObject("obj_1", "table_x", 1, 1, {
        "cells.A1": { kind: "derived", value: 5 },
      }),
    ];
    const edges = deriveEdges(objects);

    const result = validateIntegrity(objects, edges);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("table_x.A1");
      expect(result.message).toContain("derived");
    }
  });

  it("describeUndeclaredSlot no longer matches formatAddress for a table, which is disclosed and not fixed", () => {
    const objects = [tableObject("obj_2", "table_x", 1, 1, {})];
    const rawKeyNaming = "table_x.cells.C5";
    const surfaceForm = formatAddress(addr("obj_2", "cells", "C5"), objects);
    expect(rawKeyNaming).not.toBe(surfaceForm);
    expect(surfaceForm).toBe("table_x.C5");
  });
});

describe("mutate — end-to-end through a real table object", () => {
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

describe("table dimensions are literal-only — Rule 6", () => {
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

    expect(enumerateTableCellSlotPaths(table)).toEqual([]);
  });

  it("rejects a formula cell on a formula-dimensioned table instead of committing state its own validateIntegrity would reject", () => {
    const value = valueObject("obj_1", "value_1", 3);
    const other = valueObject("obj_3", "value_2", 99);
    const table = tableWithFormulaRows(3, {
      "cells.A3": { kind: "formula", ast: { type: "reference", address: addr("obj_3", "value") }, value: 99 },
    });
    const objects = [value, other, table];

    const rejection = validateIntegrity(objects, deriveEdges(objects));
    expect(rejection.ok).toBe(false);
    if (!rejection.ok) {
      expect(rejection.message).toContain("table_x.cells.A3");
    }

    const result = mutate(objects, [{ kind: "setSlot", address: addr("obj_1", "value"), slot: { kind: "literal", value: 1 } }], []);
    expect(result.ok).toBe(false);
  });
});

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

  it("does not mutate the caller's own object (step 6)", () => {
    const table = tableObject("obj_1", "table_x", 2, 2, { "cells.A1": { kind: "literal", value: "hello" } });
    const snapshotBefore = JSON.parse(JSON.stringify([table])) as unknown;
    mutate([table], [{ kind: "clearSlot", address: addr("obj_1", "cells", "A1") }], []);
    expect([table]).toEqual(snapshotBefore);
  });

  it("journals the clear like any other operation as one entry that holds the whole batch", () => {
    const table = tableObject("obj_1", "table_x", 2, 2, { "cells.A1": { kind: "literal", value: "hello" } });
    const result = mutate([table], [{ kind: "clearSlot", address: addr("obj_1", "cells", "A1") }], []);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.journal).toHaveLength(1);
    }
  });

  it("clearing a cell a formula elsewhere READS is legal — an empty in-extent cell reads 0 and contributes no edge, so nothing dangles", () => {
    const table = tableObject("obj_1", "table_x", 2, 2, {
      "cells.A1": { kind: "literal", value: 10 },
      "cells.B1": { kind: "formula", ast: { type: "reference", address: addr("obj_1", "cells", "A1") }, value: 10 },
    });
    const result = mutate([table], [{ kind: "clearSlot", address: addr("obj_1", "cells", "A1") }], []);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.objects.find((object) => object.id === "obj_1")?.slots["cells.B1"]?.value).toBe(0);
    }
  });

  it("clearing an ALREADY-absent cell is legal and simply changes nothing", () => {
    const table = tableObject("obj_1", "table_x", 2, 2, {});
    const result = mutate([table], [{ kind: "clearSlot", address: addr("obj_1", "cells", "A1") }], []);
    expect(result.ok).toBe(true);
  });

  it("REFUSES a clear at anything but a table cell, because only a table cell has a settled meaning for an absent slot", () => {
    const objects = [valueObject("obj_1", "value_a", 5)];
    const result = mutate(objects, [{ kind: "clearSlot", address: addr("obj_1", "in", "value") }], []);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("cannot be cleared");
      expect(result.message).toContain("only a table cell may be emptied");
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

  it("REFUSES a clear naming an object that does not exist, through the SAME existence check every other operation uses", () => {
    const table = tableObject("obj_1", "table_x", 2, 2, {});
    const result = mutate([table], [{ kind: "clearSlot", address: addr("obj_404", "cells", "A1") }], []);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("does not exist in this document");
    }
  });
});

describe("mutate — findInvalidDimensionWrites: a setSlot bounding table rows/cols at write time", () => {
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
      expect([table]).toEqual(snapshotBefore);
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

  it("leaves a NON-table object's own 'rows'-named literal slot alone — an undeclared literal is ordinary legal state", () => {
    const notATable = valueObject("obj_1", "value_1", 1);
    const result = mutate([notATable], [{ kind: "setSlot", address: addr("obj_1", "rows"), slot: { kind: "literal", value: -1 } }], []);
    expect(result.ok).toBe(true);
  });
});

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

  it("a self-inclusive range (A6 = SUM(A1:A6)) is a genuine self-edge and is correctly rejected as a cycle, with no special case", () => {
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

describe("deriveEdges and mutate — range expansion is bounded by the current extent, re-derived every call and never cached", () => {
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
    expect(smallEdges).toHaveLength(1);

    const grown = tableObject("obj_1", "table_x", 2, 2, {
      "cells.A1": { kind: "literal", value: 1 },
      "cells.B1": { kind: "literal", value: 2 },
      "cells.A2": { kind: "literal", value: 3 },
      "cells.B2": { kind: "literal", value: 4 },
    });
    const grownEdges = deriveEdges([grown, consumer]);
    expect(grownEdges).toHaveLength(4);
  });
});

describe("deriveEdges — a range naming a table that does not resolve falls back to ONE edge from its own start address, so the dangling-reference check still catches and names it (a defensive arm, because the parser already refuses the case a person can type)", () => {
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

describe("deriveEdges and mutate — an empty cell inside a range is skipped and is not an error, so an aggregate over a part filled table commits", () => {
  it("SUM(A1:A5) over a table with genuinely ABSENT cells (no slot at all) commits and sums only the cells that exist", () => {
    const table = tableObject("obj_1", "table_x", 5, 1, {
      "cells.A1": { kind: "literal", value: 1 },
      "cells.A3": { kind: "literal", value: 3 },
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

  it("the SAME sum, with the gaps holding an explicit `null` literal instead of no slot at all — both spellings of empty must agree", () => {
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
      expect(result.objects.find((o) => o.id === "obj_2")?.slots.value).toMatchObject({ value: 4 });
    }
  });

  it("a range where NO cell in the range exists at all commits and returns the aggregate's own empty answer (SUM's 0), not #REF", () => {
    const table = tableObject("obj_1", "table_x", 5, 1);
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

  it("a plain ReferenceNode (not a range) to an ABSENT slot OUTSIDE a table (or to an unknown object) is STILL rejected as a dangling reference, which is the boundary", () => {
    const nowhere: GraphObject = {
      id: "obj_2",
      name: "value_1",
      type: "value",
      slots: {
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

describe("mutate — a bare reference to an empty in-extent cell reads as 0 and gets no edge, instead of a refusal", () => {
  it("clause 1: accepts a formula referencing an in-extent cell with NO SLOT AT ALL, and it reads as 0", () => {
    const table = tableObject("obj_1", "table_x", 2, 1, { "cells.A1": { kind: "literal", value: 1 } });
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
    const table = tableObject("obj_1", "table_x", 2, 1, { "cells.A1": { kind: "literal", value: 1 } });
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
    const table = tableObject("obj_1", "table_x", 2, 1, { "cells.A1": { kind: "literal", value: 1 } });
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
      tableObject("obj_1", "table_x", 2, 1, { "cells.A1": { kind: "literal", value: 1 } }),
      {
        id: "obj_2",
        name: "value_1",
        type: "value" as const,
        slots: { value: { kind: "formula" as const, ast: { type: "reference" as const, address: addr("obj_1", "cells", "A2") }, value: null } },
      },
    ];

    expectSameEdges(deriveEdges(objects), []);
  });

  it("the other boundary: a cell outside the extent is still a dangling reference, because no bound makes it legal", () => {
    const table = tableObject("obj_1", "table_x", 2, 1, { "cells.A1": { kind: "literal", value: 1 } });
    const consumer: GraphObject = {
      id: "obj_2",
      name: "value_1",
      type: "value",
      slots: {
        value: { kind: "formula", ast: { type: "reference", address: addr("obj_1", "cells", "A5") }, value: null },
      },
    };

    const result = mutate([], [{ kind: "createObject", object: table }, { kind: "createObject", object: consumer }], []);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("does not exist");
    }
  });

  it("a cycle that only exists once the empty cell is populated is accepted while empty and caught at the mutation that populates it — prior state left bit-for-bit unchanged by the refusal", () => {
    const table = tableObject("obj_1", "table_x", 2, 1, {
      "cells.A2": { kind: "formula", ast: { type: "reference", address: addr("obj_1", "cells", "A1") }, value: null },
    });

    const firstResult = mutate([], [{ kind: "createObject", object: table }], []);
    expect(firstResult.ok).toBe(true);
    if (!firstResult.ok) {
      return;
    }
    expect(firstResult.objects.find((o) => o.id === "obj_1")?.slots["cells.A2"]).toMatchObject({ value: 0 });

    const committed = firstResult.objects;
    const snapshotBefore = JSON.parse(JSON.stringify(committed)) as unknown;

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
    expect(committed).toEqual(snapshotBefore);
  });
});

describe("mutate — `findIllegalOperationPayloads` walks the stored AST of a payload, as `findIllegalSlotValues` does after the fold", () => {
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
      expect(result.message).toContain("not legal document state");
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
      expect(result.message).toContain("not legal document state");
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

describe("mutate — InsertTableLineOperation, the row and column insert", () => {
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
    expect(resized?.slots["cells.A1"]).toMatchObject({ value: 1 });
    expect(resized?.slots["cells.A2"]).toBeUndefined();
    expect(resized?.slots["cells.A3"]).toMatchObject({ value: 2 });
    expect(resized?.slots["cells.A4"]).toMatchObject({ value: 3 });
  });

  it("a reference from ANOTHER object into the resized table shifts too — the WHOLE document, not just the table's own formulas", () => {
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
      ast: { type: "reference", address: addr("obj_1", "cells", "A4") },
    });
    expect(rewritten?.slots.value).toMatchObject({ value: 3 });
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

  it("rejects an insertion targeting an object id that does not exist", () => {
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
        { kind: "setSlot", address: addr("obj_1", "cells", "A1"), slot: { kind: "literal", value: 100 } },
      ],
      [],
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      const resized = result.objects.find((o) => o.id === "obj_1");
      expect(resized?.slots["cells.A1"]).toMatchObject({ value: 100 });
      expect(resized?.slots["cells.A2"]).toMatchObject({ value: 1 });
      expect(resized?.slots["cells.A3"]).toMatchObject({ value: 2 });
    }
  });
});

describe("mutate — findInvalidTableResizes simulates the batch from left to right", () => {
  it("two inserts on the SAME table in one batch both commit, which closes a false refusal", () => {
    const table = tableObject("obj_1", "table_x", 2, 1, {});

    const result = mutate(
      [table],
      [
        { kind: "insertTableLine", objectId: "obj_1", axis: "row", index: 1 },
        { kind: "insertTableLine", objectId: "obj_1", axis: "row", index: 4 },
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
        { kind: "insertTableLine", objectId: "obj_1", axis: "row", index: 1 },
        { kind: "insertTableLine", objectId: "obj_1", axis: "row", index: 10 },
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
        { kind: "insertTableLine", objectId: "obj_1", axis: "row", index: 99 },
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
        { kind: "insertTableLine", objectId: "obj_1", axis: "row", index: 3 },
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

describe("mutate — findInvalidTableResizes refuses an insert whose dimension is not literal", () => {
  it("rejects an insert whose ROWS slot is formula-kind, naming the rule, and leaving prior state unchanged", () => {
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
      expect(result.message).toContain("its extent cannot be coherently resized");
    }
    expect([table]).toEqual(snapshotBefore);
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

  it("rejects a ROW insert whose UNTOUCHED cols slot is formula-kind, because a resize checks the whole extent and not only its own axis, and prior state stays unchanged", () => {
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
      expect(result.message).toContain("its extent cannot be coherently resized");
    }
    expect([source, table]).toEqual(snapshotBefore);
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
    expect(created.objects.find((o) => o.id === "obj_2")?.slots.value).toMatchObject({ value: 15 });

    const inserted = mutate(created.objects, [{ kind: "insertTableLine", objectId: "obj_1", axis: "row", index: 3 }], created.journal);
    expect(inserted.ok).toBe(true);
    if (!inserted.ok) return;

    expect(inserted.objects.find((o) => o.id === "obj_2")?.slots.value).toMatchObject({
      kind: "formula",
      ast: { type: "functionCall", name: "SUM", args: [{ type: "range", start: addr("obj_1", "cells", "A1"), end: addr("obj_1", "cells", "A6") }] },
    });
    expect(inserted.objects.find((o) => o.id === "obj_2")?.slots.value).toMatchObject({ value: 15 });

    const edited = mutate(inserted.objects, [{ kind: "setSlot", address: addr("obj_1", "cells", "A3"), slot: { kind: "literal", value: 100 } }], inserted.journal);
    expect(edited.ok).toBe(true);
    if (edited.ok) {
      expect(edited.objects.find((o) => o.id === "obj_2")?.slots.value).toMatchObject({ value: 115 });
    }
  });
});

describe("mutate — DeleteTableLineOperation, the row and column delete, and the first user of the repair path", () => {
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
    expect(resized?.slots["cells.A1"]).toMatchObject({ value: 1 });
    expect(resized?.slots["cells.A2"]).toMatchObject({ value: 3 });
    expect(resized?.slots["cells.A3"]).toMatchObject({ value: 4 });
    expect(resized?.slots["cells.A4"]).toBeUndefined();
  });

  it("the repair path: a reference from another object into the deleted cell becomes #REF, live — never a dangling edge, never a rejection", () => {
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
    expect((repaired?.slots.value as { value: unknown })?.value).toMatchObject({ error: "#REF" });
  });

  it("a reference from ANOTHER object into a row AFTER the deleted one shifts back — the WHOLE document, not just the table's own formulas", () => {
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
    expect(rewritten?.slots.value).toMatchObject({ ast: { type: "reference", address: addr("obj_1", "cells", "A2") } });
    expect(rewritten?.slots.value).toMatchObject({ value: 3 });
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
    expect(resized?.slots["cells.B1"]).toMatchObject({ value: "c" });
    expect(resized?.slots["cells.C1"]).toMatchObject({ value: "d" });
    expect(resized?.slots["cells.D1"]).toBeUndefined();
  });

  it("a RANGE spanning the deleted row narrows (clamps) and keeps computing correctly, the other repair clause", () => {
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
    expect(result.objects.find((o) => o.id === "obj_2")?.slots.value).toMatchObject({
      ast: { type: "functionCall", name: "SUM", args: [{ type: "range", start: addr("obj_1", "cells", "A1"), end: addr("obj_1", "cells", "A4") }] },
    });
    expect(result.objects.find((o) => o.id === "obj_2")?.slots.value).toMatchObject({ value: 12 });
  });

  it("a range naming ONLY the deleted line becomes #REF entirely, because a range deleted in full becomes #REF", () => {
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

  it("rejects a deletion targeting an object id that does not exist", () => {
    const result = mutate([], [{ kind: "deleteTableLine", objectId: "obj_missing", axis: "row", index: 1 }], []);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("does not exist in this document");
    }
  });

  it("rejects a deletion whose dimension is not literal, same guard as insertion", () => {
    const table: GraphObject = {
      id: "obj_1",
      name: "table_x",
      type: "table",
      slots: { rows: { kind: "formula", ast: { type: "literal", value: 2 }, value: 2 }, cols: { kind: "literal", value: 1 } },
    };
    const result = mutate([table], [{ kind: "deleteTableLine", objectId: "obj_1", axis: "row", index: 1 }], []);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("its extent cannot be coherently resized");
    }
  });

  it("rejects a ROW delete whose UNTOUCHED cols slot is formula-kind, because a resize checks the whole extent and not only its own axis, and prior state stays unchanged", () => {
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
      expect(result.message).toContain("its extent cannot be coherently resized");
    }
    expect([source, table]).toEqual(snapshotBefore);
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
        { kind: "setSlot", address: addr("obj_1", "cells", "A1"), slot: { kind: "literal", value: 100 } },
      ],
      [],
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      const resized = result.objects.find((o) => o.id === "obj_1");
      expect(resized?.slots["cells.A1"]).toMatchObject({ value: 100 });
      expect(resized?.slots["cells.A2"]).toMatchObject({ value: 3 });
    }
  });
});

describe("mutate — findInvalidTableResizes widened for deleteTableLine: one simulation covers insert AND delete together", () => {
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
        { kind: "deleteTableLine", objectId: "obj_1", axis: "row", index: 4 },
        { kind: "deleteTableLine", objectId: "obj_1", axis: "row", index: 3 },
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
        { kind: "deleteTableLine", objectId: "obj_1", axis: "row", index: 3 },
        { kind: "insertTableLine", objectId: "obj_1", axis: "row", index: 3 },
      ],
      [],
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.objects.find((o) => o.id === "obj_1")?.slots.rows).toMatchObject({ value: 3 });
    }
  });

  it("a SECOND delete beyond what remains is rejected, validated against the state AS OF ITS OWN POSITION — not the table's original row count", () => {
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
        { kind: "deleteTableLine", objectId: "obj_1", axis: "row", index: 99 },
      ],
      [],
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("out of range");
    }
  });
});

describe("mutate — Phase 2 acceptance criterion clause 4, DELETE half: row/column DELETE with #REF repair", () => {
  it("a row delete whose cells have external dependents rewrites those references to #REF, takes the repair path rather than a dangling edge, and never refuses", () => {
    const table = tableObject("obj_1", "table_x", 3, 1, {
      "cells.A1": { kind: "literal", value: 10 },
      "cells.A2": { kind: "literal", value: 20 },
      "cells.A3": { kind: "literal", value: 30 },
    });
    const dependent: GraphObject = {
      id: "obj_2",
      name: "text_1",
      type: "value",
      slots: { value: { kind: "formula", ast: { type: "reference", address: addr("obj_1", "cells", "A2") }, value: null } },
    };

    const result = mutate([table, dependent], [{ kind: "deleteTableLine", objectId: "obj_1", axis: "row", index: 2 }], []);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const repaired = result.objects.find((o) => o.id === "obj_2");
    expect(repaired?.slots.value).toMatchObject({ kind: "formula", ast: { type: "error", error: "#REF" } });
    expect((repaired?.slots.value as { value: unknown }).value).toMatchObject({ error: "#REF" });

    expect(result.brokenSlots).toEqual([{ objectId: "obj_2", path: ["value"] }]);

    const rechecked = deriveValidateAndEvaluate(result.objects);
    expect(rechecked.ok).toBe(true);
  });
});

describe("mutate — a known incoherence, pinned and not fixed: a row or column delete can still refuse, against the rule that it must always repair", () => {
  it("rejects a row deletion when an OUT-OF-EXTENT cell slot has an external dependent, because the address repair pass is unbounded while the cell slot walk is bounded by the extent, so the repaired reference points at a shifted position with no slot, dangling. Only a raw setSlot reaches it, because the command line refuses to write a cell outside the extent. Do not patch this on the delete side alone. The same divergence exists on the insert side, and the two must close together", () => {
    const table: GraphObject = {
      id: "obj_1",
      name: "table_x",
      type: "table",
      slots: {
        rows: { kind: "literal", value: 3 },
        cols: { kind: "literal", value: 1 },
        "cells.A1": { kind: "literal", value: 1 },
        "cells.A5": { kind: "literal", value: 5 },
      },
    };
    const dependent: GraphObject = {
      id: "obj_2",
      name: "text_1",
      type: "value",
      slots: { value: { kind: "formula", ast: { type: "reference", address: addr("obj_1", "cells", "A5") }, value: null } },
    };

    expect(deriveValidateAndEvaluate([table, dependent]).ok).toBe(true);

    const result = mutate([table, dependent], [{ kind: "deleteTableLine", objectId: "obj_1", axis: "row", index: 1 }], []);

    expect(result.ok).toBe(false);
  });
});

describe("mutate — RenameObjectOperation, behind `rename`", () => {
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

  it("breaks no reference at all — the dependent still evaluates, and brokenSlots is empty, which is the whole reason for storing ids", () => {
    const before = deriveValidateAndEvaluate(wired());
    const result = mutate(wired(), [{ kind: "renameObject", objectId: "obj_1", name: "intersection_a" }], []);
    expect(result.ok && result.brokenSlots).toEqual([]);
    expect(result.ok && result.objects[2]?.slots["out.result"]?.value).toBe(before.ok ? before.objects[2]?.slots["out.result"]?.value : undefined);
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

  it("rejects a rename of an id that does not exist, in the usual message shape", () => {
    const result = mutate(wired(), [{ kind: "renameObject", objectId: "obj_99", name: "whatever" }], []);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toBe(
      'operation 1 of 1 attempts to rename object id "obj_99" to "whatever", which does not exist in this document',
    );
  });

  it("rejects a name another object already holds, case-insensitively, through checkNameAvailable's own message", () => {
    const result = mutate(wired(), [{ kind: "renameObject", objectId: "obj_1", name: "VALUE_2" }], []);
    expect(result.ok === false && result.message).toBe('operation 1 of 1 cannot rename: the name "VALUE_2" is already in use');
  });

  it("refuses a name that fails the name grammar", () => {
    const result = mutate(wired(), [{ kind: "renameObject", objectId: "obj_1", name: "3bad" }], []);
    expect(result.ok === false && result.message).toBe(
      'operation 1 of 1 cannot rename: "3bad" is not a valid name — names must match [a-zA-Z_][a-zA-Z0-9_]*',
    );
  });

  it("ACCEPTS a rename to the object's own name in a different case — uniqueness excludes the object being renamed", () => {
    const result = mutate(wired(), [{ kind: "renameObject", objectId: "obj_1", name: "VALUE_1" }], []);
    expect(result.ok && result.objects[0]?.name).toBe("VALUE_1");
  });

  it("leaves the caller's objects and journal untouched on a rejection", () => {
    const objects = wired();
    const snapshot = JSON.stringify(objects);
    const journal: readonly MutationJournalEntry[] = [];
    expect(mutate(objects, [{ kind: "renameObject", objectId: "obj_1", name: "value_2" }], journal).ok).toBe(false);
    expect(JSON.stringify(objects)).toBe(snapshot);
    expect(journal).toEqual([]);
  });

  it("refuses a name the formula lexer treats as a keyword, in any case", () => {
    const result = mutate(wired(), [{ kind: "renameObject", objectId: "obj_1", name: "or" }], []);
    expect(result.ok === false && result.message).toBe(
      'operation 1 of 1 cannot rename: "or" is a reserved word — the formula language reads AND, OR, NOT, TRUE, FALSE as formula keywords in any case, so no formula could reference this object; choose another name',
    );
  });
});

describe("mutate — AddPortOperation/RemovePortOperation", () => {
  function scriptObject(id: string, name: string, ports?: { readonly in: readonly string[]; readonly out: readonly string[] }): GraphObject {
    return ports === undefined ? { id, name, type: "script", slots: {} } : { id, name, type: "script", slots: {}, ports };
  }

  it("addPort appends to an absent ports field, creating { in: [], out: [] } implicitly", () => {
    const result = mutate([scriptObject("obj_1", "script_1")], [{ kind: "addPort", objectId: "obj_1", family: "in", name: "factor" }], []);
    expect(result.ok).toBe(true);
    expect(result.ok && result.objects[0]?.ports).toEqual({ in: ["factor"], out: [] });
  });

  it("addPort appends to the END of the named family's existing list, leaving the other family untouched", () => {
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

  it("rejects an empty or dotted port name, touching nothing", () => {
    const objects = [scriptObject("obj_1", "script_1")];
    expect(mutate(objects, [{ kind: "addPort", objectId: "obj_1", family: "in", name: "" }], []).ok).toBe(false);
    expect(mutate(objects, [{ kind: "addPort", objectId: "obj_1", family: "in", name: "a.b" }], []).ok).toBe(false);
  });

  it("refuses a port name outside the path segment grammar in address.ts, even with no dot", () => {
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
    const objects: readonly GraphObject[] = [
      { id: "obj_1", name: "script_1", type: "script", slots: { "in.result": { kind: "literal", value: 1 } }, ports: { in: ["result"], out: [] } },
    ];
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

  it("REJECTS removing an out port some OTHER object's formula still references, through the existing dangling reference check and no new mechanism", () => {
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

  it("a batch that removes then re-adds the same name in one call is legal, because the batch simulates from left to right", () => {
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

  it("leaves the caller's objects untouched on a rejection", () => {
    const objects = [scriptObject("obj_1", "script_1")];
    const snapshot = JSON.stringify(objects);
    expect(mutate(objects, [{ kind: "addPort", objectId: "obj_1", family: "in", name: "a.b" }], []).ok).toBe(false);
    expect(JSON.stringify(objects)).toBe(snapshot);
  });
});

describe("mutate — findInvalidNames simulates the batch LEFT-TO-RIGHT, the same way findInvalidTableResizes does", () => {
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

  it("createObject checks its own name, so a duplicate name is refused rather than committed", () => {
    const result = mutate(pair(), [{ kind: "createObject", object: valueObject("obj_3", "value_1", 3) }], []);
    expect(result.ok === false && result.message).toBe('operation 1 of 1 cannot create: the name "value_1" is already in use');
  });

  it("refuses a createObject whose name fails the name grammar", () => {
    const result = mutate(pair(), [{ kind: "createObject", object: valueObject("obj_3", "3bad", 3) }], []);
    expect(result.ok === false && result.message).toBe(
      'operation 1 of 1 cannot create: "3bad" is not a valid name — names must match [a-zA-Z_][a-zA-Z0-9_]*',
    );
  });

  it("refuses a createObject whose name is a formula keyword, in any case", () => {
    const result = mutate(pair(), [{ kind: "createObject", object: valueObject("obj_3", "true", 3) }], []);
    expect(result.ok === false && (result.message.includes("reserved word") && result.message.includes('"true"'))).toBe(true);
  });

  it("two createObjects in ONE batch claiming the SAME name — the SECOND is rejected, the simulation catches what the pre-batch document could not", () => {
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

  it("ACCEPTS a createObject onto a name an EARLIER delete in the same batch just freed — symmetric with the rename case above", () => {
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

  it("a REFUSED createObject claims no name for the simulation — a later operation still sees the name as taken", () => {
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

describe("text.resolvedContent end to end through mutate", () => {

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

  it("derives one edge per referenced cell plus the content self-edge, and no edge for an empty in-extent cell", () => {
    const table = tableObject("obj_t", "table_1", 4, 4, { "cells.A1": { kind: "literal", value: 3 } });
    const text = textObject("obj_x", "text_1", "{= table_1.A1 } vs empty {= table_1.C3 }");
    expectSameEdges(deriveEdges([table, text]), [
      { sourceSlot: addr("obj_x", "content"), dependentSlot: addr("obj_x", "resolvedContent") },
      { sourceSlot: addr("obj_t", "cells", "A1"), dependentSlot: addr("obj_x", "resolvedContent") },
      { sourceSlot: addr("obj_x", "resolvedContent"), dependentSlot: addr("obj_x", "measuredHeight") },
      { sourceSlot: addr("obj_x", "width"), dependentSlot: addr("obj_x", "measuredHeight") },
      { sourceSlot: addr("obj_x", "style", "font"), dependentSlot: addr("obj_x", "measuredHeight") },
      { sourceSlot: addr("obj_x", "style", "fontSize"), dependentSlot: addr("obj_x", "measuredHeight") },
      { sourceSlot: addr("obj_x", "style", "lineHeight"), dependentSlot: addr("obj_x", "measuredHeight") },
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
    expect(sources).toContain(addressKey(addr("obj_t", "cells", "A1")));
    expect(sources).toContain(addressKey(addr("obj_t", "cells", "A2")));
    expect(sources).toContain(addressKey(addr("obj_t", "cells", "B1")));
    expect(resolvedContentOf([table, text], "obj_x")).toBe("sum 3");
  });

  it("a cycle through resolvedContent is rejected, naming the slots", () => {
    const table = tableObject("obj_t", "table_1", 4, 4, {
      "cells.A1": { kind: "formula", ast: { type: "reference", address: addr("obj_x", "resolvedContent") }, value: null },
    });
    const text = textObject("obj_x", "text_1", "loop {= table_1.A1 }");
    const result = mutate([], [{ kind: "createObject", object: table }, { kind: "createObject", object: text }], []);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain("cyclic");
    expect(result.ok === false && result.message).toContain("resolvedContent");
  });

  it("an embedding of an OUT-OF-extent cell is a dangling reference and the whole mutation is refused", () => {
    const table = tableObject("obj_t", "table_1", 2, 2, {});
    const text = textObject("obj_x", "text_1", "{= table_1.D4 }");
    const result = mutate([], [{ kind: "createObject", object: table }, { kind: "createObject", object: text }], []);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain("does not exist");
  });
});

describe("text.measuredHeight end to end through mutate", () => {
  const WELL_FORMED_TEXT_SLOTS: Record<string, Slot> = {
    content: { kind: "literal", value: "hello world" },
    width: { kind: "literal", value: "auto" },
    "style.font": { kind: "literal", value: "sans" },
    "style.fontSize": { kind: "literal", value: 12 },
    "style.lineHeight": { kind: "literal", value: 14 },
    resolvedContent: { kind: "derived", value: null },
    measuredHeight: { kind: "derived", value: null },
    measuredWidth: { kind: "derived", value: null },
  };

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

  it("a real text object created through mutate (which passes NULL_EVAL_CONTEXT) gets measuredHeight = #MEASURE, and the mutation still commits", () => {
    const created = createAndGet(textObject("obj_x", "text_1"));
    expect(created.slots.measuredHeight?.value).toMatchObject({ error: "#MEASURE" });
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

  it("a text object missing a measuredHeight input slot (style.font) is REFUSED — the static dep would be a dangling edge", () => {
    const r = mutate([], [{ kind: "createObject", object: textObject("obj_x", "text_1", ["style.font"]) }], []);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.message).toContain("does not exist");
  });

  it("a text object with NO measuredHeight derived-slot placeholder is REFUSED", () => {
    const r = mutate([], [{ kind: "createObject", object: textObject("obj_x", "text_1", ["measuredHeight"]) }], []);
    expect(r.ok).toBe(false);
  });

  it("measuredWidth is #MEASURE under NULL_EVAL_CONTEXT too — the pair fails together, never one and not the other", () => {
    const created = createAndGet(textObject("obj_x", "text_1"));
    expect(created.slots.measuredWidth?.value).toMatchObject({ error: "#MEASURE" });
    expect(created.slots.measuredHeight?.value).toMatchObject({ error: "#MEASURE" });
  });

  it("measuredWidth subscribes to the SAME five sources measuredHeight does", () => {
    const edges = deriveEdges([textObject("obj_x", "text_1")]);
    const sourcesInto = (path: readonly string[]): readonly string[] =>
      edges
        .filter((e) => addressKey(e.dependentSlot) === addressKey({ objectId: "obj_x", path }))
        .map((e) => addressKey(e.sourceSlot))
        .sort();
    expect(sourcesInto(["measuredWidth"])).toEqual(sourcesInto(["measuredHeight"]));
    expect(sourcesInto(["measuredWidth"])).toHaveLength(5);
  });

  it("a text object with NO measuredWidth derived-slot placeholder is REFUSED", () => {
    const r = mutate([], [{ kind: "createObject", object: textObject("obj_x", "text_1", ["measuredWidth"]) }], []);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.message).toContain("measuredWidth");
  });
});
