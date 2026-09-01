/**
 * ast.test.ts — Tests for the widened §5.3 formula AST (Q-005, cycle 0028).
 *
 * Colocated with ast.ts per D-001. This file has no lexer/parser to build
 * fixtures from yet (both are later Phase 1 cycles) — every AST here is
 * hand-built, the same convention `mutation.test.ts` uses for `GraphObject`
 * fixtures. Tests are SHAPE tests: can every node type be constructed, does
 * the union compose recursively, and is `ReferenceNode` byte-for-byte
 * unchanged from Phase 0 (Q-005's own binding constraint).
 */
import { describe, expect, it } from "vitest";
import type { Address } from "../address.ts";
import {
  exceedsMaxFormulaAstDepth,
  isReferenceNode,
  MAX_FORMULA_AST_DEPTH,
  type BinaryOpNode,
  type ErrorNode,
  type FormulaAst,
  type FunctionCallNode,
  type LiteralNode,
  type RangeNode,
  type ReferenceNode,
  type UnaryOpNode,
} from "./ast.ts";

function addr(objectId: string, ...path: readonly string[]): Address {
  return { objectId, path };
}

describe("LiteralNode", () => {
  it("holds a number, a string, or a boolean — one node type for all three (§5.3)", () => {
    const numberLiteral: LiteralNode = { type: "literal", value: 3 };
    const stringLiteral: LiteralNode = { type: "literal", value: "hello" };
    const booleanLiteral: LiteralNode = { type: "literal", value: true };
    expect(numberLiteral.value).toBe(3);
    expect(stringLiteral.value).toBe("hello");
    expect(booleanLiteral.value).toBe(true);
  });
});

describe("ReferenceNode — UNCHANGED from Phase 0 (Q-005's binding constraint)", () => {
  it("is exactly { type: \"reference\", address } — the same shape a binding parsed to before this cycle", () => {
    const node: ReferenceNode = { type: "reference", address: addr("obj_1", "value") };
    expect(node.type).toBe("reference");
    expect(node.address).toEqual({ objectId: "obj_1", path: ["value"] });
    // Structural guarantee: exactly two fields, nothing added.
    expect(Object.keys(node).sort()).toEqual(["address", "type"]);
  });

  it("still satisfies FormulaAst — a binding is still representable as a bare reference under the full grammar", () => {
    const node: FormulaAst = { type: "reference", address: addr("obj_1", "value") };
    expect(isReferenceNode(node)).toBe(true);
  });
});

describe("RangeNode", () => {
  it("holds an endpoint pair, never a pre-expanded cell list (§5.3)", () => {
    const range: RangeNode = { type: "range", start: addr("obj_3", "cells", "A1"), end: addr("obj_3", "cells", "B4") };
    expect(range.start).toEqual({ objectId: "obj_3", path: ["cells", "A1"] });
    expect(range.end).toEqual({ objectId: "obj_3", path: ["cells", "B4"] });
    expect(Object.keys(range).sort()).toEqual(["end", "start", "type"]);
  });
});

describe("BinaryOpNode", () => {
  it("spans the WHOLE §5.3 precedence chain through one operator field, not one node per tier", () => {
    const operators: BinaryOpNode["operator"][] = ["OR", "AND", "=", "<>", "<", ">", "<=", ">=", "+", "-", "*", "/", "%", "^"];
    for (const operator of operators) {
      const node: BinaryOpNode = { type: "binaryOp", operator, left: { type: "literal", value: 1 }, right: { type: "literal", value: 2 } };
      expect(node.operator).toBe(operator);
    }
  });

  it("nests recursively — the left/right fields are FormulaAst, not leaf-only", () => {
    // (1 + 2) * 3
    const node: BinaryOpNode = {
      type: "binaryOp",
      operator: "*",
      left: { type: "binaryOp", operator: "+", left: { type: "literal", value: 1 }, right: { type: "literal", value: 2 } },
      right: { type: "literal", value: 3 },
    };
    expect(node.left).toMatchObject({ type: "binaryOp", operator: "+" });
  });
});

describe("UnaryOpNode", () => {
  it("holds §5.3's two prefix operators: numeric negation and boolean NOT", () => {
    const negation: UnaryOpNode = { type: "unaryOp", operator: "-", operand: { type: "literal", value: 5 } };
    const notNode: UnaryOpNode = { type: "unaryOp", operator: "NOT", operand: { type: "literal", value: true } };
    expect(negation.operator).toBe("-");
    expect(notNode.operator).toBe("NOT");
  });
});

describe("FunctionCallNode", () => {
  it("holds a bare string name and a list of FormulaAst args, arity unconstrained at the type level", () => {
    const call: FunctionCallNode = {
      type: "functionCall",
      name: "SUM",
      args: [
        { type: "reference", address: addr("obj_3", "cells", "A1") },
        { type: "literal", value: 10 },
      ],
    };
    expect(call.name).toBe("SUM");
    expect(call.args).toHaveLength(2);
  });

  it("represents IF as an ordinary function call, not a dedicated ConditionalNode (§5.3: IF is a built-in)", () => {
    // IF(A1 > 5, "big", "small")
    const ifCall: FunctionCallNode = {
      type: "functionCall",
      name: "IF",
      args: [
        { type: "binaryOp", operator: ">", left: { type: "reference", address: addr("obj_3", "cells", "A1") }, right: { type: "literal", value: 5 } },
        { type: "literal", value: "big" },
        { type: "literal", value: "small" },
      ],
    };
    expect(ifCall.type).toBe("functionCall");
    expect(ifCall.args[0]).toMatchObject({ type: "binaryOp", operator: ">" });
  });

  it("nests a range only where the grammar allows it — inside an aggregate call's args", () => {
    const sumOfRange: FunctionCallNode = {
      type: "functionCall",
      name: "SUM",
      args: [{ type: "range", start: addr("obj_3", "cells", "A1"), end: addr("obj_3", "cells", "A5") }],
    };
    expect(sumOfRange.args[0]?.type).toBe("range");
  });
});

describe("ErrorNode (0029-REVIEW-phase1, D-028)", () => {
  it("replaces ONE reference inside a surviving formula, not the whole formula — §5.1.1's repair path rewrites \"every inbound reference into a #REF error node in the referring AST\"", () => {
    // `= A1 + B1` after B1's column was deleted (§5.4's adjustment pass). The
    // BinaryOpNode survives, so A1 still derives its edge — which is the whole
    // point of repairing at node level rather than failing the formula.
    const repaired: BinaryOpNode = {
      type: "binaryOp",
      operator: "+",
      left: { type: "reference", address: addr("obj_3", "cells", "A1") },
      right: { type: "error", error: "#REF" },
    };
    expect(repaired.left).toMatchObject({ type: "reference" });
    expect(repaired.right).toEqual({ type: "error", error: "#REF" });
  });

  it("carries the code alone — a stored AST holds no ErrorValue message (D-028)", () => {
    const node: ErrorNode = { type: "error", error: "#REF" };
    expect(Object.keys(node).sort()).toEqual(["error", "type"]);
  });
});

describe("isReferenceNode", () => {
  it("is true only for a ReferenceNode, false for every other variant", () => {
    const nodes: readonly FormulaAst[] = [
      { type: "literal", value: 1 },
      { type: "reference", address: addr("obj_1", "value") },
      { type: "range", start: addr("obj_1", "cells", "A1"), end: addr("obj_1", "cells", "A2") },
      { type: "binaryOp", operator: "+", left: { type: "literal", value: 1 }, right: { type: "literal", value: 2 } },
      { type: "unaryOp", operator: "-", operand: { type: "literal", value: 1 } },
      { type: "functionCall", name: "SUM", args: [] },
      { type: "error", error: "#REF" },
    ];
    const results = nodes.map(isReferenceNode);
    expect(results).toEqual([false, true, false, false, false, false, false]);
  });
});

describe("exceedsMaxFormulaAstDepth — D-083 clause 4's load-boundary check", () => {
  /** A left-deep `1 + 1 + ...` ladder — the same fixture shape `format.test.ts`'s depth-guard tests use. */
  function ladder(levels: number): FormulaAst {
    let ast: FormulaAst = { type: "literal", value: 1 };
    for (let index = 0; index < levels; index += 1) {
      ast = { type: "binaryOp", operator: "+", left: ast, right: { type: "literal", value: 1 } };
    }
    return ast;
  }

  it("is false for a single leaf node (depth 1)", () => {
    expect(exceedsMaxFormulaAstDepth({ type: "literal", value: 1 })).toBe(false);
  });

  it("is false for an AST exactly at the limit", () => {
    // MAX_FORMULA_AST_DEPTH - 1 binaryOp levels over one literal = depth 1000.
    expect(exceedsMaxFormulaAstDepth(ladder(MAX_FORMULA_AST_DEPTH - 1))).toBe(false);
  });

  it("is true for an AST one level past the limit", () => {
    expect(exceedsMaxFormulaAstDepth(ladder(MAX_FORMULA_AST_DEPTH))).toBe(true);
  });

  it("does not throw a RangeError for a 40,000-level AST — the size that broke this recursion's siblings before their own guards existed", () => {
    expect(() => exceedsMaxFormulaAstDepth(ladder(40_000))).not.toThrow();
    expect(exceedsMaxFormulaAstDepth(ladder(40_000))).toBe(true);
  });

  it("checks EVERY branch of a functionCall, not just the first argument", () => {
    const shallow: FormulaAst = { type: "literal", value: 1 };
    const tooDeep = ladder(MAX_FORMULA_AST_DEPTH);
    const call: FormulaAst = { type: "functionCall", name: "SUM", args: [shallow, tooDeep] };
    expect(exceedsMaxFormulaAstDepth(call)).toBe(true);
  });

  it("is false when every branch is within the limit, even nested through unaryOp and functionCall", () => {
    const nested: FormulaAst = { type: "unaryOp", operator: "-", operand: { type: "functionCall", name: "SUM", args: [{ type: "literal", value: 1 }] } };
    expect(exceedsMaxFormulaAstDepth(nested)).toBe(false);
  });
});

describe("a deeply nested expression composes across every node kind at once", () => {
  it("builds IF(obj_1.value > SUM(obj_3.A1:obj_3.A5), NOT obj_2.flag, -3) without a type error", () => {
    const deeplyNested: FormulaAst = {
      type: "functionCall",
      name: "IF",
      args: [
        {
          type: "binaryOp",
          operator: ">",
          left: { type: "reference", address: addr("obj_1", "value") },
          right: { type: "functionCall", name: "SUM", args: [{ type: "range", start: addr("obj_3", "A1"), end: addr("obj_3", "A5") }] },
        },
        { type: "unaryOp", operator: "NOT", operand: { type: "reference", address: addr("obj_2", "flag") } },
        { type: "unaryOp", operator: "-", operand: { type: "literal", value: 3 } },
      ],
    };
    expect(deeplyNested.type).toBe("functionCall");
  });
});
