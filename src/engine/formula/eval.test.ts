/**
 * eval.test.ts — tests for formula/eval.ts (PROJECT_BRIEF §5.3, the evaluator).
 *
 * IMPLEMENTS: the LAZY/short-circuit half of Phase 1's acceptance criterion ("evaluation
 * short-circuits" — `deps.test.ts` already covers the eager/total half) and D-029's dispatch
 * rider. Most fixtures are hand-built `FormulaAst` literals (this file's input type, isolating it
 * from `parser.ts`, same convention `deps.test.ts` established); a capstone section builds ASTs
 * via the real `lex` -> `parseFormula` -> `evaluate` pipeline to prove all four stages agree.
 */
import { describe, expect, it } from "vitest";
import type { Address, AddressableObject } from "../address.ts";
import { isParseError, parseFormula } from "./parser.ts";
import type {
  BinaryOpNode,
  ErrorNode,
  FormulaAst,
  FunctionCallNode,
  LiteralNode,
  RangeNode,
  ReferenceNode,
  UnaryOpNode,
} from "./ast.ts";
import { FUNCTION_REGISTRY, LAZY_FUNCTION_NAMES } from "./functions.ts";
import { evaluate, type ReadSlot } from "./eval.ts";
import type { ErrorValue, Value } from "../graph/node.ts";

const addrA: Address = { objectId: "obj_1", path: ["v"] };
const addrB: Address = { objectId: "obj_2", path: ["v"] };
const addrC: Address = { objectId: "obj_3", path: ["v"] };

const refA: ReferenceNode = { type: "reference", address: addrA };
const refB: ReferenceNode = { type: "reference", address: addrB };
const refC: ReferenceNode = { type: "reference", address: addrC };

function num(value: number): LiteralNode {
  return { type: "literal", value };
}
function str(value: string): LiteralNode {
  return { type: "literal", value };
}
function bool(value: boolean): LiteralNode {
  return { type: "literal", value };
}

/** A `read` backed by a plain map from `objectId::path` to `Value` — enough for every hand-built
 * fixture in this file (all use `addrA`/`addrB`/`addrC`, each a single-segment `["v"]` path). */
function reader(values: Record<string, Value>): ReadSlot {
  return (address) => {
    const key = `${address.objectId}::${address.path.join(".")}`;
    return Object.hasOwn(values, key) ? values[key] : undefined;
  };
}

const EMPTY_READ: ReadSlot = () => undefined;

/** A node that ALWAYS errors if evaluated — used to prove a branch was never touched (§5.3: "an
 * error in an untaken branch never occurs and never surfaces"). Division by zero, not a made-up
 * shape, so the proof runs through this file's own real arithmetic path. */
const POISON: FormulaAst = { type: "binaryOp", operator: "/", left: num(1), right: num(0) };

function expectError(value: Value, code: string): void {
  expect(value).toMatchObject({ error: code });
}

describe("evaluate — literals and references", () => {
  it("a literal evaluates to its own value", () => {
    expect(evaluate(num(42), EMPTY_READ)).toBe(42);
    expect(evaluate(str("hi"), EMPTY_READ)).toBe("hi");
    expect(evaluate(bool(true), EMPTY_READ)).toBe(true);
  });

  it("a reference reads through the injected `read` callback", () => {
    expect(evaluate(refA, reader({ "obj_1::v": 99 }))).toBe(99);
  });

  it("an unresolved reference is #REF, not undefined or a throw", () => {
    expectError(evaluate(refA, EMPTY_READ), "#REF");
  });

  it("a reference's value is propagated unchanged, including an existing ErrorValue", () => {
    const upstream: ErrorValue = { error: "#DIV0", message: "upstream" };
    expect(evaluate(refA, reader({ "obj_1::v": upstream }))).toEqual(upstream);
  });
});

describe("evaluate — D-028: an ErrorNode evaluates to its ErrorValue, never #PARSE", () => {
  it("evaluates to {error: '#REF', ...}", () => {
    const node: ErrorNode = { type: "error", error: "#REF" };
    const result = evaluate(node, EMPTY_READ);
    expectError(result, "#REF");
    expect(result).not.toMatchObject({ error: "#PARSE" });
  });
});

describe("evaluate — range: disclosed, temporary #PARSE (0035-REVIEW carried constraint 4)", () => {
  it("a bare RangeNode evaluates to #PARSE, never throws", () => {
    const node: RangeNode = { type: "range", start: addrA, end: addrB };
    expectError(evaluate(node, EMPTY_READ), "#PARSE");
  });

  it("SUM over a range therefore also evaluates to #PARSE (propagated as any other argument error would be)", () => {
    const call: FunctionCallNode = {
      type: "functionCall",
      name: "SUM",
      args: [{ type: "range", start: addrA, end: addrB }],
    };
    expectError(evaluate(call, EMPTY_READ), "#PARSE");
  });
});

describe("evaluate — arithmetic (+ - * / % ^)", () => {
  function binary(operator: BinaryOpNode["operator"], left: FormulaAst, right: FormulaAst): BinaryOpNode {
    return { type: "binaryOp", operator, left, right };
  }

  it("computes each operator correctly", () => {
    expect(evaluate(binary("+", num(2), num(3)), EMPTY_READ)).toBe(5);
    expect(evaluate(binary("-", num(5), num(3)), EMPTY_READ)).toBe(2);
    expect(evaluate(binary("*", num(4), num(3)), EMPTY_READ)).toBe(12);
    expect(evaluate(binary("/", num(10), num(4)), EMPTY_READ)).toBe(2.5);
    expect(evaluate(binary("%", num(10), num(3)), EMPTY_READ)).toBe(1);
    expect(evaluate(binary("^", num(2), num(10)), EMPTY_READ)).toBe(1024);
  });

  it("division and modulo by zero are #DIV0, not #TYPE and not Infinity/NaN", () => {
    expectError(evaluate(binary("/", num(1), num(0)), EMPTY_READ), "#DIV0");
    expectError(evaluate(binary("%", num(1), num(0)), EMPTY_READ), "#DIV0");
  });

  it("D-033: a -0 result normalises to +0 via the shared finiteResult guard", () => {
    const result = evaluate(binary("*", num(0), num(-1)), EMPTY_READ);
    expect(result).toBe(0);
    expect(Object.is(result, -0)).toBe(false);
  });

  it("a genuinely non-finite result is #TYPE", () => {
    expectError(evaluate(binary("^", num(0), num(-1)), EMPTY_READ), "#TYPE");
  });

  it("propagates an error from the left operand before touching the right", () => {
    const leftError: ErrorNode = { type: "error", error: "#REF" };
    expectError(evaluate(binary("+", leftError, num(1)), EMPTY_READ), "#REF");
  });

  it("#TYPE on a non-number operand, naming which side", () => {
    expectError(evaluate(binary("+", str("x"), num(1)), EMPTY_READ), "#TYPE");
    expectError(evaluate(binary("+", num(1), str("x")), EMPTY_READ), "#TYPE");
  });

  it("unary minus negates and routes through the same D-033 guard", () => {
    const node: UnaryOpNode = { type: "unaryOp", operator: "-", operand: num(5) };
    expect(evaluate(node, EMPTY_READ)).toBe(-5);
    const zero: UnaryOpNode = { type: "unaryOp", operator: "-", operand: num(0) };
    expect(Object.is(evaluate(zero, EMPTY_READ), -0)).toBe(false);
  });
});

describe("evaluate — comparisons (= <> < > <= >=)", () => {
  function cmp(operator: BinaryOpNode["operator"], left: FormulaAst, right: FormulaAst): BinaryOpNode {
    return { type: "binaryOp", operator, left, right };
  }

  it("compares same-typed numbers, strings, and booleans", () => {
    expect(evaluate(cmp("<", num(1), num(2)), EMPTY_READ)).toBe(true);
    expect(evaluate(cmp(">", str("b"), str("a")), EMPTY_READ)).toBe(true);
    expect(evaluate(cmp("=", bool(true), bool(true)), EMPTY_READ)).toBe(true);
    expect(evaluate(cmp("<>", num(1), num(2)), EMPTY_READ)).toBe(true);
    expect(evaluate(cmp("<=", num(2), num(2)), EMPTY_READ)).toBe(true);
    expect(evaluate(cmp(">=", num(1), num(2)), EMPTY_READ)).toBe(false);
  });

  it("a cross-type comparison is #TYPE (disclosed decision, not a brief requirement)", () => {
    expectError(evaluate(cmp("=", num(1), str("1")), EMPTY_READ), "#TYPE");
  });

  it("propagates an error from either side", () => {
    const errNode: ErrorNode = { type: "error", error: "#REF" };
    expectError(evaluate(cmp("=", errNode, num(1)), EMPTY_READ), "#REF");
    expectError(evaluate(cmp("=", num(1), errNode), EMPTY_READ), "#REF");
  });
});

describe("evaluate — NOT, both syntactic forms, delegate to the same functions.ts registry entry", () => {
  it("prefix UnaryOpNode form", () => {
    const node: UnaryOpNode = { type: "unaryOp", operator: "NOT", operand: bool(true) };
    expect(evaluate(node, EMPTY_READ)).toBe(false);
  });

  it("call FunctionCallNode form", () => {
    const node: FunctionCallNode = { type: "functionCall", name: "NOT", args: [bool(false)] };
    expect(evaluate(node, EMPTY_READ)).toBe(true);
  });

  it("both forms agree on a non-boolean operand (#TYPE) and on error propagation", () => {
    const prefix: UnaryOpNode = { type: "unaryOp", operator: "NOT", operand: num(1) };
    const call: FunctionCallNode = { type: "functionCall", name: "NOT", args: [num(1)] };
    expectError(evaluate(prefix, EMPTY_READ), "#TYPE");
    expectError(evaluate(call, EMPTY_READ), "#TYPE");
  });
});

describe("evaluate — D-029 laziness: the centerpiece. An error in an untaken branch NEVER surfaces", () => {
  it("IF evaluates ONLY the taken branch — the untaken branch's error never surfaces", () => {
    const whenTrue: FunctionCallNode = { type: "functionCall", name: "IF", args: [bool(true), num(42), POISON] };
    const whenFalse: FunctionCallNode = { type: "functionCall", name: "IF", args: [bool(false), POISON, num(42)] };
    expect(evaluate(whenTrue, EMPTY_READ)).toBe(42);
    expect(evaluate(whenFalse, EMPTY_READ)).toBe(42);
  });

  it("AND short-circuits to false on the first false operand — infix form", () => {
    const node: BinaryOpNode = { type: "binaryOp", operator: "AND", left: bool(false), right: POISON };
    expect(evaluate(node, EMPTY_READ)).toBe(false);
  });

  it("AND short-circuits to false on the first false operand — call form, N-ary", () => {
    const node: FunctionCallNode = { type: "functionCall", name: "AND", args: [bool(true), bool(false), POISON] };
    expect(evaluate(node, EMPTY_READ)).toBe(false);
  });

  it("OR short-circuits to true on the first true operand — infix form", () => {
    const node: BinaryOpNode = { type: "binaryOp", operator: "OR", left: bool(true), right: POISON };
    expect(evaluate(node, EMPTY_READ)).toBe(true);
  });

  it("OR short-circuits to true on the first true operand — call form, N-ary", () => {
    const node: FunctionCallNode = { type: "functionCall", name: "OR", args: [bool(false), bool(true), POISON] };
    expect(evaluate(node, EMPTY_READ)).toBe(true);
  });

  it("AND/OR still evaluate every operand, and propagate correctly, when nothing short-circuits early", () => {
    const and: FunctionCallNode = { type: "functionCall", name: "AND", args: [bool(true), bool(true), bool(true)] };
    const or: FunctionCallNode = { type: "functionCall", name: "OR", args: [bool(false), bool(false), bool(false)] };
    expect(evaluate(and, EMPTY_READ)).toBe(true);
    expect(evaluate(or, EMPTY_READ)).toBe(false);
  });

  it("AND/OR propagate an error found before short-circuiting would otherwise apply", () => {
    const errNode: ErrorNode = { type: "error", error: "#REF" };
    const and: FunctionCallNode = { type: "functionCall", name: "AND", args: [bool(true), errNode] };
    expectError(evaluate(and, EMPTY_READ), "#REF");
  });

  it("a non-boolean operand is #TYPE for both AND and OR", () => {
    const and: BinaryOpNode = { type: "binaryOp", operator: "AND", left: num(1), right: bool(true) };
    const or: BinaryOpNode = { type: "binaryOp", operator: "OR", left: num(1), right: bool(true) };
    expectError(evaluate(and, EMPTY_READ), "#TYPE");
    expectError(evaluate(or, EMPTY_READ), "#TYPE");
  });

  it("IF's condition is always evaluated (there is no untaken condition to protect)", () => {
    const errNode: ErrorNode = { type: "error", error: "#REF" };
    const node: FunctionCallNode = { type: "functionCall", name: "IF", args: [errNode, num(1), num(2)] };
    expectError(evaluate(node, EMPTY_READ), "#REF");
  });

  it("IF's condition must be a boolean", () => {
    const node: FunctionCallNode = { type: "functionCall", name: "IF", args: [num(1), num(2), num(3)] };
    expectError(evaluate(node, EMPTY_READ), "#TYPE");
  });
});

describe("evaluate — D-029 dispatch order: arity is checked before laziness matters", () => {
  it("IF called with the wrong number of arguments is #TYPE (checkArity, D-035's EXACTLY(3))", () => {
    const node: FunctionCallNode = { type: "functionCall", name: "IF", args: [bool(true), num(1)] };
    expectError(evaluate(node, EMPTY_READ), "#TYPE");
  });

  it("AND called with zero arguments is #TYPE (checkArity, D-035's AT_LEAST(1))", () => {
    const node: FunctionCallNode = { type: "functionCall", name: "AND", args: [] };
    expectError(evaluate(node, EMPTY_READ), "#TYPE");
  });

  it("every name in LAZY_FUNCTION_NAMES is actually wired into this file's dispatch (no drift)", () => {
    // Each one, called validly (arity satisfied, all-boolean operands), must NOT hit the
    // "has no evaluator wired in formula/eval.ts (internal error)" defensive fallback.
    for (const name of LAZY_FUNCTION_NAMES) {
      const args = name === "IF" ? [bool(true), num(1), num(2)] : [bool(true)];
      const node: FunctionCallNode = { type: "functionCall", name, args };
      const result = evaluate(node, EMPTY_READ);
      if (typeof result === "object" && result !== null && "error" in result) {
        expect((result as ErrorValue).message).not.toContain("internal error");
      }
    }
  });
});

describe("evaluate — ordinary (eager) function calls", () => {
  it("dispatches into functions.ts's registry and computes correctly", () => {
    const sum: FunctionCallNode = { type: "functionCall", name: "SUM", args: [num(1), num(2), num(3)] };
    expect(evaluate(sum, EMPTY_READ)).toBe(6);
    const abs: FunctionCallNode = { type: "functionCall", name: "ABS", args: [num(-5)] };
    expect(evaluate(abs, EMPTY_READ)).toBe(5);
    const concat: FunctionCallNode = { type: "functionCall", name: "CONCAT", args: [str("a"), str("b")] };
    expect(evaluate(concat, EMPTY_READ)).toBe("ab");
  });

  it("an unknown function name is #TYPE, never a crash (D-034)", () => {
    const node: FunctionCallNode = { type: "functionCall", name: "toString", args: [num(1)] };
    expectError(evaluate(node, EMPTY_READ), "#TYPE");
  });

  it("a wrong argument count is #TYPE (checkArity)", () => {
    const node: FunctionCallNode = { type: "functionCall", name: "ROUND", args: [num(1)] };
    expectError(evaluate(node, EMPTY_READ), "#TYPE");
  });

  it("evaluates every argument left to right, stopping at the first error", () => {
    const errNode: ErrorNode = { type: "error", error: "#REF" };
    const node: FunctionCallNode = { type: "functionCall", name: "SUM", args: [num(1), errNode, POISON] };
    // POISON would itself be a #DIV0 if ever reached — the result must be the FIRST error (#REF).
    expectError(evaluate(node, EMPTY_READ), "#REF");
  });

  it("a reference used as an argument reads through `read`, including nested inside an eager call", () => {
    const node: FunctionCallNode = { type: "functionCall", name: "SUM", args: [refA, refB] };
    expect(evaluate(node, reader({ "obj_1::v": 3, "obj_2::v": 4 }))).toBe(7);
  });
});

describe("evaluate — every §5.3 built-in is reachable through the full dispatch path (not just functions.ts's direct call)", () => {
  // One minimal, validly-typed argument list per EAGER built-in (LAZY_FUNCTION_NAMES — IF/AND/OR —
  // are covered by their own dedicated laziness tests above, not here).
  const validArgsByName: Record<string, readonly FormulaAst[]> = {
    NOT: [bool(true)],
    SUM: [num(1), num(2)],
    MIN: [num(1), num(2)],
    MAX: [num(1), num(2)],
    AVG: [num(1), num(2)],
    ABS: [num(-1)],
    ROUND: [num(1.23), num(1)],
    FLOOR: [num(1.5)],
    CEIL: [num(1.5)],
    SQRT: [num(4)],
    POW: [num(2), num(3)],
    CONCAT: [str("a"), str("b")],
    LEN: [str("hello")],
    PI: [],
    SIN: [num(0)],
    COS: [num(0)],
    TAN: [num(0)],
    ATAN2: [num(1), num(1)],
    DEG: [num(1)],
    RAD: [num(1)],
  };

  it("covers exactly the eager names functions.ts's own registry declares — no drift", () => {
    const eagerNames = Object.keys(FUNCTION_REGISTRY).filter((name) => !LAZY_FUNCTION_NAMES.has(name));
    expect(Object.keys(validArgsByName).sort()).toEqual(eagerNames.sort());
  });

  it("every one computes through evaluate() without an 'unknown function' or arity mismatch", () => {
    for (const [name, args] of Object.entries(validArgsByName)) {
      const node: FunctionCallNode = { type: "functionCall", name, args };
      const result = evaluate(node, EMPTY_READ);
      if (typeof result === "object" && result !== null && "error" in result) {
        expect((result as ErrorValue).message).not.toMatch(/unknown function|expects (exactly|at least)/);
      }
    }
  });
});

describe("evaluate — never throws, over a small malformed-input battery of hand-built ASTs", () => {
  const battery: readonly FormulaAst[] = [
    { type: "functionCall", name: "IF", args: [] },
    { type: "functionCall", name: "AND", args: [] },
    { type: "functionCall", name: "NOT", args: [] },
    { type: "functionCall", name: "FOO", args: [num(1), num(2)] },
    { type: "binaryOp", operator: "+", left: refA, right: refB },
    { type: "binaryOp", operator: "AND", left: refA, right: refB },
    { type: "unaryOp", operator: "-", operand: str("x") },
    { type: "range", start: addrA, end: addrB },
    {
      type: "functionCall",
      name: "SUM",
      args: [{ type: "functionCall", name: "IF", args: [bool(true), { type: "range", start: addrA, end: addrC }, num(0)] }],
    },
  ];

  it("survives every entry without throwing", () => {
    for (const ast of battery) {
      expect(() => evaluate(ast, EMPTY_READ)).not.toThrow();
    }
  });
});

describe("evaluate — integration: the full lex -> parse -> evaluate pipeline", () => {
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

  it("a compound formula combining references, arithmetic, comparison, and IF", () => {
    const ast = parseOk("IF(a.v > b.v, a.v - b.v, b.v - a.v)");
    const read = reader({ "obj_1::v": 3, "obj_2::v": 10 });
    // a.v (3) > b.v (10) is false, so the FALSE branch runs: b.v - a.v = 7.
    expect(evaluate(ast, read)).toBe(7);
  });

  it("infix AND and call-form AND agree on real parsed input, including short-circuiting", () => {
    // b.v never resolves in `read` below — if evaluated, this would be #REF, not a boolean #TYPE.
    // Both forms must return `false` without ever touching it.
    const infix = parseOk("FALSE AND b.v");
    const call = parseOk("AND(FALSE, b.v)");
    const read = reader({});
    expect(evaluate(infix, read)).toBe(false);
    expect(evaluate(call, read)).toBe(false);
  });

  it("a nested function call and arithmetic expression", () => {
    const ast = parseOk("ROUND(SQRT(a.v) + 1, 2)");
    expect(evaluate(ast, reader({ "obj_1::v": 2 }))).toBeCloseTo(2.41, 2);
  });

  it("malformed input never reaches evaluate at all — parseFormula rejects it first", () => {
    expect(isParseError(parseFormula("a.v +", docObjects))).toBe(true);
  });
});
