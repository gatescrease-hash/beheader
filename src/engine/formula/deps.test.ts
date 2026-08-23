/**
 * deps.test.ts — tests for formula/deps.ts (PROJECT_BRIEF §5.3/§9, eager total dependency
 * extraction).
 *
 * IMPLEMENTS: the "dependency extraction is TOTAL across both IF branches" slice of Phase 1's
 * acceptance criterion, and D-029's rider (both syntactic forms of `AND`/`OR`/`NOT` produce
 * identical dependency sets). NOT demonstrated here: lazy/short-circuit EVALUATION (needs
 * `eval.ts`, a later cycle) — this file only walks the AST; it never evaluates it. Most fixtures
 * are hand-built `FormulaAst` literals (this file's input type, isolating it from `parser.ts`);
 * a handful of integration-style tests build the AST via the real `parseFormula` to prove the two
 * files agree at the boundary they actually share.
 */
import { describe, expect, it } from "vitest";
import type { Address, AddressableObject } from "../address.ts";
import { isParseError, parseFormula } from "./parser.ts";
import type { BinaryOpNode, ErrorNode, FormulaAst, FunctionCallNode, RangeNode, ReferenceNode, UnaryOpNode } from "./ast.ts";
import { extractDependencies } from "./deps.ts";

const addrA: Address = { objectId: "obj_1", path: ["v"] };
const addrB: Address = { objectId: "obj_2", path: ["v"] };
const addrC: Address = { objectId: "obj_3", path: ["v"] };

const refA: ReferenceNode = { type: "reference", address: addrA };
const refB: ReferenceNode = { type: "reference", address: addrB };
const refC: ReferenceNode = { type: "reference", address: addrC };

describe("extractDependencies — literals and references", () => {
  it("yields nothing for a literal", () => {
    expect(extractDependencies({ type: "literal", value: 42 })).toEqual([]);
    expect(extractDependencies({ type: "literal", value: "hi" })).toEqual([]);
    expect(extractDependencies({ type: "literal", value: true })).toEqual([]);
  });

  it("yields one ReferenceDependency for a bare reference", () => {
    expect(extractDependencies(refA)).toEqual([{ kind: "reference", address: addrA }]);
  });

  it("yields nothing for an ErrorNode (D-028: absence of a dependency, made explicit)", () => {
    const errorNode: ErrorNode = { type: "error", error: "#REF" };
    expect(extractDependencies(errorNode)).toEqual([]);
  });
});

describe("extractDependencies — ranges", () => {
  it("yields one RangeDependency holding the endpoint pair, NOT expanded into individual cells", () => {
    const range: RangeNode = { type: "range", start: addrA, end: addrB };
    expect(extractDependencies(range)).toEqual([{ kind: "range", start: addrA, end: addrB }]);
  });

  it("a range nested inside a SUM call still reports the endpoint pair, not per-cell entries", () => {
    const call: FunctionCallNode = {
      type: "functionCall",
      name: "SUM",
      args: [{ type: "range", start: addrA, end: addrC }],
    };
    expect(extractDependencies(call)).toEqual([{ kind: "range", start: addrA, end: addrC }]);
  });
});

describe("extractDependencies — operators walk both operands", () => {
  it("binaryOp: walks left then right", () => {
    const node: BinaryOpNode = { type: "binaryOp", operator: "+", left: refA, right: refB };
    expect(extractDependencies(node)).toEqual([
      { kind: "reference", address: addrA },
      { kind: "reference", address: addrB },
    ]);
  });

  it("unaryOp: walks the operand", () => {
    const node: UnaryOpNode = { type: "unaryOp", operator: "-", operand: refA };
    expect(extractDependencies(node)).toEqual([{ kind: "reference", address: addrA }]);
  });

  it("nested operators: walks every leaf across a deep tree", () => {
    // (a.v + b.v) * -c.v
    const node: BinaryOpNode = {
      type: "binaryOp",
      operator: "*",
      left: { type: "binaryOp", operator: "+", left: refA, right: refB },
      right: { type: "unaryOp", operator: "-", operand: refC },
    };
    expect(extractDependencies(node)).toEqual([
      { kind: "reference", address: addrA },
      { kind: "reference", address: addrB },
      { kind: "reference", address: addrC },
    ]);
  });

  it("does NOT deduplicate a repeated reference", () => {
    const node: BinaryOpNode = { type: "binaryOp", operator: "+", left: refA, right: refA };
    expect(extractDependencies(node)).toEqual([
      { kind: "reference", address: addrA },
      { kind: "reference", address: addrA },
    ]);
  });
});

describe("extractDependencies — function calls", () => {
  it("yields nothing for a zero-arg call", () => {
    const call: FunctionCallNode = { type: "functionCall", name: "PI", args: [] };
    expect(extractDependencies(call)).toEqual([]);
  });

  it("walks every argument of an ordinary call", () => {
    const call: FunctionCallNode = { type: "functionCall", name: "CONCAT", args: [refA, refB, refC] };
    expect(extractDependencies(call)).toEqual([
      { kind: "reference", address: addrA },
      { kind: "reference", address: addrB },
      { kind: "reference", address: addrC },
    ]);
  });

  it("IF: is EAGER and TOTAL across BOTH the taken-looking and untaken-looking branch (§5.3)", () => {
    // IF(cond, a.v, b.v) — a.v and b.v are mutually exclusive at evaluation time, but
    // extractDependencies has no notion of "taken" at all and must report both.
    const ifCall: FunctionCallNode = {
      type: "functionCall",
      name: "IF",
      args: [{ type: "literal", value: true }, refA, refB],
    };
    expect(extractDependencies(ifCall)).toEqual([
      { kind: "reference", address: addrA },
      { kind: "reference", address: addrB },
    ]);
  });

  it("a formula condition itself contributes dependencies too (IF's first arg is walked, not skipped)", () => {
    const ifCall: FunctionCallNode = {
      type: "functionCall",
      name: "IF",
      args: [refA, refB, refC],
    };
    expect(extractDependencies(ifCall)).toEqual([
      { kind: "reference", address: addrA },
      { kind: "reference", address: addrB },
      { kind: "reference", address: addrC },
    ]);
  });
});

describe("extractDependencies — D-029: AND/OR/NOT's two syntactic forms are IDENTICAL", () => {
  it("AND: infix BinaryOpNode and call-form FunctionCallNode produce the same dependency list", () => {
    const infix: BinaryOpNode = { type: "binaryOp", operator: "AND", left: refA, right: refB };
    const call: FunctionCallNode = { type: "functionCall", name: "AND", args: [refA, refB] };
    const expected = [
      { kind: "reference", address: addrA },
      { kind: "reference", address: addrB },
    ];
    expect(extractDependencies(infix)).toEqual(expected);
    expect(extractDependencies(call)).toEqual(expected);
  });

  it("OR: infix BinaryOpNode and call-form FunctionCallNode produce the same dependency list", () => {
    const infix: BinaryOpNode = { type: "binaryOp", operator: "OR", left: refA, right: refB };
    const call: FunctionCallNode = { type: "functionCall", name: "OR", args: [refA, refB] };
    const expected = [
      { kind: "reference", address: addrA },
      { kind: "reference", address: addrB },
    ];
    expect(extractDependencies(infix)).toEqual(expected);
    expect(extractDependencies(call)).toEqual(expected);
  });

  it("NOT: prefix UnaryOpNode and call-form FunctionCallNode produce the same dependency list", () => {
    const prefix: UnaryOpNode = { type: "unaryOp", operator: "NOT", operand: refA };
    const call: FunctionCallNode = { type: "functionCall", name: "NOT", args: [refA] };
    const expected = [{ kind: "reference", address: addrA }];
    expect(extractDependencies(prefix)).toEqual(expected);
    expect(extractDependencies(call)).toEqual(expected);
  });

  it("N-ary AND call form is total over every argument, not just the first two", () => {
    const call: FunctionCallNode = { type: "functionCall", name: "AND", args: [refA, refB, refC] };
    expect(extractDependencies(call)).toEqual([
      { kind: "reference", address: addrA },
      { kind: "reference", address: addrB },
      { kind: "reference", address: addrC },
    ]);
  });
});

describe("extractDependencies — integration: real ASTs from parseFormula", () => {
  const docObjects: readonly AddressableObject[] = [
    { id: "obj_1", name: "a", type: "polygon" },
    { id: "obj_2", name: "b", type: "polygon" },
    { id: "obj_3", name: "c", type: "polygon" },
  ];

  function parseOk(source: string): FormulaAst {
    const result = parseFormula(source, docObjects);
    if (isParseError(result)) {
      throw new Error(`expected "${source}" to parse, got #PARSE: ${result.message}`);
    }
    return result;
  }

  it("a realistic nested IF over real parsed addresses", () => {
    const ast = parseOk('IF(a.v > 0, b.v, c.v)');
    expect(extractDependencies(ast)).toEqual([
      { kind: "reference", address: { objectId: "obj_1", path: ["v"] } },
      { kind: "reference", address: { objectId: "obj_2", path: ["v"] } },
      { kind: "reference", address: { objectId: "obj_3", path: ["v"] } },
    ]);
  });

  it("the infix and call forms of AND agree on real parsed input too", () => {
    const infixDeps = extractDependencies(parseOk("a.v AND b.v"));
    const callDeps = extractDependencies(parseOk("AND(a.v, b.v)"));
    expect(infixDeps).toEqual(callDeps);
    expect(infixDeps).toEqual([
      { kind: "reference", address: { objectId: "obj_1", path: ["v"] } },
      { kind: "reference", address: { objectId: "obj_2", path: ["v"] } },
    ]);
  });

  it("a SUM over a real parsed range (dotted table.A1 form) reports the endpoint pair", () => {
    const tableObjects: readonly AddressableObject[] = [{ id: "obj_9", name: "table_x", type: "table" }];
    const result = parseFormula("SUM(table_x.A1:table_x.B4)", tableObjects);
    if (isParseError(result)) {
      throw new Error(`expected to parse, got #PARSE: ${result.message}`);
    }
    expect(extractDependencies(result)).toEqual([
      {
        kind: "range",
        start: { objectId: "obj_9", path: ["cells", "A1"] },
        end: { objectId: "obj_9", path: ["cells", "B4"] },
      },
    ]);
  });
});
