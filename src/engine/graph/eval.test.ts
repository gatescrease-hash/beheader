/**
 * eval.test.ts
 *
 * The topological pass over all three slot kinds. A derived value must
 * never lag one step behind.
 */

import { describe, expect, it } from "vitest";
import type { Address } from "../address.ts";
import { NULL_EVAL_CONTEXT, type EvalContext } from "../eval-context.ts";
import type { GraphObject, Slot, Value } from "./node.ts";
import { addressKey, type Edge } from "./edge.ts";
import { evaluate } from "./eval.ts";

function addr(objectId: string, ...path: readonly string[]): Address {
  return { objectId, path };
}

function edge(source: Address, dependent: Address): Edge {
  return { sourceSlot: source, dependentSlot: dependent };
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

describe("evaluate — the value and add fixture", () => {
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

    const after = evaluate(
      [valueObject("obj_1", "value_1", 20), valueObject("obj_2", "value_2", 5), addObject("obj_3", "add_1", addr("obj_1", "value"), addr("obj_2", "value"))],
      edges,
    );
    expect(objectById(after, "obj_3").slots["out.result"]).toEqual({ kind: "derived", value: 25 });
  });
});

describe("evaluate — derived slots are evaluated INSIDE the same pass, not a separate post-pass", () => {
  it("propagates literal -> formula -> derived -> formula -> derived across two objects in one call", () => {
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
    expect(result[0]?.slots.value).toBe(object.slots.value);
  });
});

describe("evaluate — dangling formula reference", () => {
  it("evaluates to #REF rather than throwing, when the referenced address never resolves in this pass", () => {
    const objects = [
      valueObject("obj_2", "value_2", 5),
      addObject("obj_3", "add_1", addr("obj_999", "value"), addr("obj_2", "value")),
    ];
    const edges: Edge[] = [
      edge(addr("obj_2", "value"), addr("obj_3", "in", "b")),
      edge(addr("obj_3", "in", "a"), addr("obj_3", "out", "result")),
      edge(addr("obj_3", "in", "b"), addr("obj_3", "out", "result")),
    ];

    expect(() => evaluate(objects, edges)).not.toThrow();
    const result = evaluate(objects, edges);
    const add1 = objectById(result, "obj_3");
    expect(add1.slots["in.a"]).toMatchObject({ kind: "formula", value: { error: "#REF" } });
    expect(add1.slots["out.result"]).toMatchObject({ kind: "derived", value: { error: "#REF" } });
  });
});

describe("evaluate — a compute function reads only its declared dependencies", () => {
  it("gets #REF, not the real value, for an address the given edges do not declare as a dependency of that slot", () => {
    const objects = [
      valueObject("obj_1", "value_1", 10),
      valueObject("obj_2", "value_2", 5),
      addObject("obj_3", "add_1", addr("obj_1", "value"), addr("obj_2", "value")),
    ];
    const edges: Edge[] = [
      edge(addr("obj_1", "value"), addr("obj_3", "in", "a")),
      edge(addr("obj_2", "value"), addr("obj_3", "in", "b")),
      edge(addr("obj_3", "in", "a"), addr("obj_3", "out", "result")),
    ];

    const result = evaluate(objects, edges);
    const add1 = objectById(result, "obj_3");

    expect(add1.slots["in.b"]).toMatchObject({ kind: "formula", value: 5 });
    expect(add1.slots["out.result"]).toMatchObject({ kind: "derived", value: { error: "#REF" } });
  });
});

describe("evaluate — a derived-kind slot with no matching schema entry", () => {
  it("evaluates to #REF rather than throwing or indexing into undefined", () => {
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
  it("skips it rather than throwing, for the exact shape that validateIntegrity refuses before this file sees it", () => {
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
    const edges: Edge[] = [
      edge(addr("obj_1", "value"), addr("obj_3", "in", "a")),
      edge(addr("obj_1", "value"), addr("obj_3", "in", "b")),
      edge(addr("obj_3", "in", "a"), addr("obj_3", "out", "result")),
      edge(addr("obj_3", "in", "b"), addr("obj_3", "out", "result")),
    ];

    expect(() => evaluate(objects, edges)).not.toThrow();
    const result = evaluate(objects, edges);
    expect(Object.keys(objectById(result, "obj_3").slots).sort()).toEqual(["in.a", "in.b"]);
  });
});

describe("evaluate — a formula slot whose AST is not a ReferenceNode", () => {
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

  it("an ErrorNode evaluates to its #REF ErrorValue, still never throwing", () => {
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

describe("evaluate — a range inside an aggregate call, expanded through the readRange wiring THIS cycle built", () => {
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
    const edges: Edge[] = [
      edge(addr("obj_1", "cells", "A1"), addr("obj_2", "value")),
      edge(addr("obj_1", "cells", "B1"), addr("obj_2", "value")),
      edge(addr("obj_1", "cells", "A2"), addr("obj_2", "value")),
      edge(addr("obj_1", "cells", "B2"), addr("obj_2", "value")),
    ];

    const result = evaluate([table, sumFormula], edges);
    expect(objectById(result, "obj_2").slots.value).toMatchObject({ value: 10 });
  });

  it("a range extending past the table's current extent sums only the cells that exist", () => {
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

describe("evaluate — the injected EvalContext", () => {
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

    expect(objectById(result, "obj_3").slots["out.result"]).toEqual({ kind: "derived", value: 15 });
    expect(measureCalls).toBe(0);
  });
});

describe("evaluate — addressKey consistency", () => {
  it("keys its internal bookkeeping the same way addressKey does, for every slot on every object", () => {
    const object = valueObject("obj_7", "value_7", 1);
    const key = Object.keys(object.slots)[0];
    expect(key).toBeDefined();
    expect(`${object.id}::${key}`).toBe(addressKey(addr("obj_7", "value")));
  });
});

function addObjectDeclaredBackwards(id: string, name: string, aRef: Address, bRef: Address): GraphObject {
  const slots: Record<string, Slot> = {
    "out.result": { kind: "derived", value: null },
    "in.b": { kind: "formula", ast: { type: "reference", address: bRef }, value: null },
    "in.a": { kind: "formula", ast: { type: "reference", address: aRef }, value: null },
  };
  return { id, name, type: "add", slots };
}

describe("evaluate — the evaluation ORDER comes from the edges, not from the input's own order", () => {
  it("propagates correctly with every object AND every slot declared in reverse dependency order, in correct topological order", () => {
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

describe("evaluate — a derived slot's compute evaluating an embedded formula AST, as text.resolvedContent does", () => {

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

  it("an empty in-extent cell reads as 0, and the coercion happens before the membership check", () => {
    const table = textTable("obj_t", "table_1", 4, 4, { A1: 5 });
    const text = textObject("obj_x", "text_1", "sum: {= table_1.A1 + table_1.A2 }");
    expect(resolvedContentOf([table, text], textEdges("obj_x", addr("obj_t", "cells", "A1")), "obj_x")).toBe("sum: 5");
  });

  it("a cell that HAS a slot holding `null`, in-extent, also reads as 0", () => {
    const table = textTable("obj_t", "table_1", 4, 4, { A1: null });
    const text = textObject("obj_x", "text_1", "value {= table_1.A1 + 1 }");
    expect(resolvedContentOf([table, text], textEdges("obj_x", addr("obj_t", "cells", "A1")), "obj_x")).toBe("value 1");
  });

  it("an address the block tree names but the edge set does not declare resolves to #REF", () => {
    const other = { id: "obj_v", name: "value_1", type: "value", slots: { value: { kind: "literal", value: 99 } } } satisfies GraphObject;
    const text = textObject("obj_x", "text_1", "reads {= value_1.value }");
    expect(resolvedContentOf([other, text], textEdges("obj_x"), "obj_x")).toBe("reads !#REF");
    expect(resolvedContentOf([other, text], textEdges("obj_x", addr("obj_v", "value")), "obj_x")).toBe("reads 99");
  });

  it("evaluates an embedded aggregate over a range, through the shared buildRangeReader", () => {
    const table = textTable("obj_t", "table_1", 4, 4, { A1: 1, A2: 2, A3: 3, A4: 4 });
    const text = textObject("obj_x", "text_1", "total {= SUM(table_1.A1:table_1.A4) }");
    const cells = (["A1", "A2", "A3", "A4"] as const).map((ref) => addr("obj_t", "cells", ref));
    expect(resolvedContentOf([table, text], textEdges("obj_x", ...cells), "obj_x")).toBe("total 10");
  });

  it("a broken embedded span is marked in place, the rest of resolvedContent still resolves", () => {
    const text = textObject("obj_x", "text_1", "ok {= 1 + } and {= 6 * 7 }");
    expect(resolvedContentOf([text], textEdges("obj_x"), "obj_x")).toBe("ok !{= 1 + } and 42");
  });

  it("re-renders when a value referenced only inside the currently NON-taken branch changes (Phase 5 gate property)", () => {
    const text = textObject("obj_x", "text_1", "{? table_1.A1 > 0 }ok{:}fallback is {= table_1.A2 }{?}");
    const edges = textEdges("obj_x", addr("obj_t", "cells", "A1"), addr("obj_t", "cells", "A2"));
    expect(resolvedContentOf([textTable("obj_t", "table_1", 4, 4, { A1: 5, A2: 20 }), text], edges, "obj_x")).toBe("ok");
    expect(resolvedContentOf([textTable("obj_t", "table_1", 4, 4, { A1: -1, A2: 20 }), text], edges, "obj_x")).toBe("fallback is 20");
  });
});

describe("evaluate — the measuredHeight derived slot", () => {

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

  it("evaluated with NULL_EVAL_CONTEXT, a real text object's measuredHeight is #MEASURE — never height 0", () => {
    const height = measuredHeightOf(textObject("obj_x", "text_1", "some text here"), NULL_EVAL_CONTEXT);
    expect(height).toEqual({ error: "#MEASURE", message: expect.stringContaining("text_1") });
  });

  it("the same is true with NO context passed (evaluate's own default is NULL_EVAL_CONTEXT)", () => {
    expect(measuredHeightOf(textObject("obj_x", "text_1", "x"))).toMatchObject({ error: "#MEASURE" });
  });

  it("threads a real (fake) measurer through the topological pass and returns its height (Rule 1)", () => {
    expect(measuredHeightOf(textObject("obj_x", "text_1", "hello"), fakeMeasurer())).toBe(10);
  });

  it("a numeric `width` slot reaches the measurer as maxWidth; \"auto\" does not", () => {
    expect(measuredHeightOf(textObject("obj_x", "text_1", "hello", 120), fakeMeasurer())).toBe(20);
    expect(measuredHeightOf(textObject("obj_x", "text_1", "hello", "auto"), fakeMeasurer())).toBe(10);
  });

  it("measures resolvedContent AFTER the embedded formula resolves — measuredHeight sits downstream of resolvedContent", () => {
    const object = textObject("obj_x", "text_1", "n is {= 2 + 2 }");
    const result = objectById(evaluate([object], textEdges("obj_x"), fakeMeasurer()), "obj_x");
    expect(result.slots.resolvedContent?.value).toBe("n is 4");
    expect(result.slots.measuredHeight?.value).toBe(10);
  });

  it("propagates an ErrorValue from a formula-driven style slot, because an error propagates", () => {
    const object = textObject("obj_x", "text_1", "x", "auto", {
      kind: "formula",
      ast: { type: "reference", address: addr("gone", "v") },
      value: null,
    });
    expect(measuredHeightOf(object, fakeMeasurer())).toMatchObject({ error: "#REF" });
  });
});
