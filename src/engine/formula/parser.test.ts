/**
 * parser.test.ts
 *
 * Operator precedence, nested calls, name resolution, and the depth
 * limit. Bad input must give a parse error, never an exception.
 */
import { describe, expect, it } from "vitest";
import type { AddressableObject } from "../address.ts";
import type { ObjectType } from "../graph/node.ts";
import { MAX_FORMULA_AST_DEPTH, type FormulaAst } from "./ast.ts";
import { isParseError, MAX_FORMULA_PARSE_DEPTH, type ParseError, parseFormula, parseFormulaTokens } from "./parser.ts";

function objects(...entries: Array<[id: string, name: string, type?: ObjectType]>): AddressableObject[] {
  return entries.map(([id, name, type = "polygon"]) => ({ id, name, type }));
}

function parseOk(source: string, docObjects: readonly AddressableObject[] = [], tableObjectId?: string): FormulaAst {
  const result = parseFormula(source, docObjects, tableObjectId);
  if (isParseError(result)) {
    throw new Error(`expected "${source}" to parse, got #PARSE: ${result.message}`);
  }
  return result;
}

function parseFail(source: string, docObjects: readonly AddressableObject[] = [], tableObjectId?: string): ParseError {
  const result = parseFormula(source, docObjects, tableObjectId);
  if (!isParseError(result)) {
    throw new Error(`expected "${source}" to fail to parse, got: ${JSON.stringify(result)}`);
  }
  return result;
}

describe("parseFormula — literals", () => {
  it("parses a number literal", () => {
    expect(parseOk("42")).toEqual({ type: "literal", value: 42 });
  });

  it("parses a decimal number literal", () => {
    expect(parseOk("1.5")).toEqual({ type: "literal", value: 1.5 });
  });

  it("parses a string literal, escape already resolved by the lexer", () => {
    expect(parseOk('"say \\"hi\\""')).toEqual({ type: "literal", value: 'say "hi"' });
  });

  it("parses TRUE and FALSE as boolean literals", () => {
    expect(parseOk("TRUE")).toEqual({ type: "literal", value: true });
    expect(parseOk("FALSE")).toEqual({ type: "literal", value: false });
  });

  it("parses unary minus over a number literal as UnaryOpNode, not a signed literal", () => {
    expect(parseOk("-2")).toEqual({
      type: "unaryOp",
      operator: "-",
      operand: { type: "literal", value: 2 },
    });
  });

  it("parses repeated unary prefixes", () => {
    expect(parseOk("- -2")).toEqual({
      type: "unaryOp",
      operator: "-",
      operand: { type: "unaryOp", operator: "-", operand: { type: "literal", value: 2 } },
    });
    expect(parseOk("NOT NOT TRUE")).toEqual({
      type: "unaryOp",
      operator: "NOT",
      operand: { type: "unaryOp", operator: "NOT", operand: { type: "literal", value: true } },
    });
  });
});

describe("parseFormula — references", () => {
  it("resolves a dotted name.path reference to a stored Address (§5.2 — IDs, not names)", () => {
    const docObjects = objects(["obj_7", "polygon_1"]);
    expect(parseOk("polygon_1.origin.x", docObjects)).toEqual({
      type: "reference",
      address: { objectId: "obj_7", path: ["origin", "x"] },
    });
  });

  it("resolves a numeric path segment (vertex.0.x) — the lexer's own disclosed number-vs-identifier split", () => {
    const docObjects = objects(["obj_1", "polyline_1"]);
    expect(parseOk("polyline_1.vertex.0.x", docObjects)).toEqual({
      type: "reference",
      address: { objectId: "obj_1", path: ["vertex", "0", "x"] },
    });
  });

  it("rejects an unresolvable name as a hard #PARSE, immediately", () => {
    const error = parseFail("nonexistent_object.value", []);
    expect(error.message).toContain('no object named "nonexistent_object"');
  });

  it("rejects a bare single word with no table context (Bare refs in text formulas are a parse error, §5.3)", () => {
    const error = parseFail("A1", []);
    expect(error.error).toBe("#PARSE");
  });

  it("resolves a bare cell ref only when a tableObjectId is supplied, to that table's cells.* path", () => {
    const docObjects = objects(["obj_5", "table_x", "table"]);
    expect(parseOk("A1", docObjects, "obj_5")).toEqual({
      type: "reference",
      address: { objectId: "obj_5", path: ["cells", "A1"] },
    });
  });

  it("treats a lowercase cell-shaped word as a bare cell ref too, normalised to uppercase (D-039, inherited from address.ts's isCellReferenceForm)", () => {
    const docObjects = objects(["obj_5", "table_x", "table"]);
    expect(parseOk("a1", docObjects, "obj_5")).toEqual({
      type: "reference",
      address: { objectId: "obj_5", path: ["cells", "A1"] },
    });
  });

  it("a dotted reference into a table's cell still works even with tableObjectId set (the bare-ref path only applies to a single, dot-free segment)", () => {
    const docObjects = objects(["obj_1", "table_x", "table"], ["obj_2", "table_y", "table"]);
    expect(parseOk("table_y.A1", docObjects, "obj_1")).toEqual({
      type: "reference",
      address: { objectId: "obj_2", path: ["cells", "A1"] },
    });
  });
});

const refA: FormulaAst = { type: "reference", address: { objectId: "obj_1", path: ["v"] } };
const refB: FormulaAst = { type: "reference", address: { objectId: "obj_2", path: ["v"] } };
const refC: FormulaAst = { type: "reference", address: { objectId: "obj_3", path: ["v"] } };

describe("parseFormula — operator precedence (§5.3: OR -> AND -> comparison -> + - -> * / % -> ^ -> unary/NOT -> primary)", () => {
  it("* binds tighter than +", () => {
    expect(parseOk("1 + 2 * 3")).toEqual({
      type: "binaryOp",
      operator: "+",
      left: { type: "literal", value: 1 },
      right: { type: "binaryOp", operator: "*", left: { type: "literal", value: 2 }, right: { type: "literal", value: 3 } },
    });
  });

  it("+ binds tighter than comparison", () => {
    expect(parseOk("1 + 2 > 3")).toEqual({
      type: "binaryOp",
      operator: ">",
      left: { type: "binaryOp", operator: "+", left: { type: "literal", value: 1 }, right: { type: "literal", value: 2 } },
      right: { type: "literal", value: 3 },
    });
  });

  it("comparison binds tighter than AND, which binds tighter than OR", () => {
    expect(parseOk("a.v = 1 AND b.v = 2 OR c.v = 3", objects(["obj_1", "a"], ["obj_2", "b"], ["obj_3", "c"]))).toEqual({
      type: "binaryOp",
      operator: "OR",
      left: {
        type: "binaryOp",
        operator: "AND",
        left: { type: "binaryOp", operator: "=", left: refA, right: { type: "literal", value: 1 } },
        right: { type: "binaryOp", operator: "=", left: refB, right: { type: "literal", value: 2 } },
      },
      right: { type: "binaryOp", operator: "=", left: refC, right: { type: "literal", value: 3 } },
    });
  });

  it("^ binds tighter than unary minus's operand position, and is left-associative (Excel's convention, per the file header)", () => {
    expect(parseOk("2 ^ 3 ^ 2")).toEqual({
      type: "binaryOp",
      operator: "^",
      left: { type: "binaryOp", operator: "^", left: { type: "literal", value: 2 }, right: { type: "literal", value: 3 } },
      right: { type: "literal", value: 2 },
    });
  });

  it("unary NOT binds tighter than comparison — 'NOT a.v = b.v' parses as '(NOT a.v) = b.v', per §5.3's own precedence chain", () => {
    const docObjects = objects(["obj_1", "a"], ["obj_2", "b"]);
    expect(parseOk("NOT a.v = b.v", docObjects)).toEqual({
      type: "binaryOp",
      operator: "=",
      left: { type: "unaryOp", operator: "NOT", operand: refA },
      right: refB,
    });
  });

  it("every symbol comparison operator lexes and parses to its own BinaryOperator", () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ["a.v = b.v", "="],
      ["a.v <> b.v", "<>"],
      ["a.v < b.v", "<"],
      ["a.v > b.v", ">"],
      ["a.v <= b.v", "<="],
      ["a.v >= b.v", ">="],
    ];
    const docObjects = objects(["obj_1", "a"], ["obj_2", "b"]);
    for (const [source, operator] of cases) {
      const ast = parseOk(source, docObjects) as { type: string; operator: string };
      expect(ast.type, source).toBe("binaryOp");
      expect(ast.operator, source).toBe(operator);
    }
  });

  it("parentheses override precedence", () => {
    expect(parseOk("(1 + 2) * 3")).toEqual({
      type: "binaryOp",
      operator: "*",
      left: { type: "binaryOp", operator: "+", left: { type: "literal", value: 1 }, right: { type: "literal", value: 2 } },
      right: { type: "literal", value: 3 },
    });
  });
});

describe("parseFormula — function calls", () => {
  it("parses a nested IF as an ordinary FunctionCallNode (no ConditionalNode — §5.3/D-029)", () => {
    const docObjects = objects(["obj_1", "a"]);
    expect(parseOk('IF(a.v > 0, "pos", IF(a.v < 0, "neg", "zero"))', docObjects)).toEqual({
      type: "functionCall",
      name: "IF",
      args: [
        { type: "binaryOp", operator: ">", left: refA, right: { type: "literal", value: 0 } },
        { type: "literal", value: "pos" },
        {
          type: "functionCall",
          name: "IF",
          args: [
            { type: "binaryOp", operator: "<", left: refA, right: { type: "literal", value: 0 } },
            { type: "literal", value: "neg" },
            { type: "literal", value: "zero" },
          ],
        },
      ],
    });
  });

  it("parses a zero-argument call", () => {
    expect(parseOk("PI()")).toEqual({ type: "functionCall", name: "PI", args: [] });
  });

  it("rejects an unrecognised function name at parse time (D-038), naming it and pointing at its position", () => {
    const error = parseFail("FOO(1, 2, 3)");
    expect(error.message).toContain('"FOO"');
    expect(error.start).toBe(0);
  });

  it("rejects a known function called with the wrong argument count (D-038)", () => {
    const error = parseFail("ROUND(1)");
    expect(error.message).toContain("ROUND");
    expect(error.start).toBe(0);
  });

  it("reports the wrong-arity function's position, not offset 0, when it is not at the start of the source", () => {
    const error = parseFail("1 + ROUND(1)");
    expect(error.message).toContain("ROUND");
    expect(error.start).toBe(4);
  });

  it("still parses a known function with a correct argument count, including AND/OR's at-least-one arity (D-035)", () => {
    const docObjects = objects(["obj_1", "a"]);
    expect(parseOk("ROUND(1.5, 0)")).toEqual({
      type: "functionCall",
      name: "ROUND",
      args: [{ type: "literal", value: 1.5 }, { type: "literal", value: 0 }],
    });
    expect(parseOk("AND(a.v)", docObjects)).toEqual({ type: "functionCall", name: "AND", args: [refA] });
  });

  it("rejects a missing closing paren", () => {
    const error = parseFail("SUM(1, 2");
    expect(error.error).toBe("#PARSE");
  });
});

describe("parseFormula — D-029: AND/OR/NOT are both operators and functions, meaning the same thing", () => {
  it("parses AND(a.v, b.v) as a FunctionCallNode named AND, not a BinaryOpNode", () => {
    const docObjects = objects(["obj_1", "a"], ["obj_2", "b"]);
    expect(parseOk("AND(a.v, b.v)", docObjects)).toEqual({ type: "functionCall", name: "AND", args: [refA, refB] });
  });

  it("parses OR(a.v, b.v) as a FunctionCallNode named OR", () => {
    const docObjects = objects(["obj_1", "a"], ["obj_2", "b"]);
    expect(parseOk("OR(a.v, b.v)", docObjects)).toEqual({ type: "functionCall", name: "OR", args: [refA, refB] });
  });

  it("parses NOT(a.v) as a FunctionCallNode named NOT, not a UnaryOpNode", () => {
    const docObjects = objects(["obj_1", "a"]);
    expect(parseOk("NOT(a.v)", docObjects)).toEqual({ type: "functionCall", name: "NOT", args: [refA] });
  });

  it("parses AND/OR N-ary call forms (more than two arguments)", () => {
    const docObjects = objects(["obj_1", "a"], ["obj_2", "b"], ["obj_3", "c"]);
    expect(parseOk("AND(a.v, b.v, c.v)", docObjects)).toEqual({ type: "functionCall", name: "AND", args: [refA, refB, refC] });
  });

  it("still parses a.v AND b.v as an ordinary infix BinaryOpNode when not followed by '('", () => {
    const docObjects = objects(["obj_1", "a"], ["obj_2", "b"]);
    expect(parseOk("a.v AND b.v", docObjects)).toEqual({ type: "binaryOp", operator: "AND", left: refA, right: refB });
  });

  it("a bare AND/OR keyword with no '(' and no left operand is a #PARSE, not a value", () => {
    expect(parseFail("AND").error).toBe("#PARSE");
    expect(parseFail("OR").error).toBe("#PARSE");
  });
});

describe("parseFormula — ranges (§5.3: only as a direct argument to SUM/MIN/MAX/AVG)", () => {
  it("parses A1:B4 as a RangeNode when it is SUM's direct argument", () => {
    const docObjects = objects(["obj_5", "table_x", "table"]);
    expect(parseOk("SUM(A1:B4)", docObjects, "obj_5")).toEqual({
      type: "functionCall",
      name: "SUM",
      args: [
        {
          type: "range",
          start: { objectId: "obj_5", path: ["cells", "A1"] },
          end: { objectId: "obj_5", path: ["cells", "B4"] },
        },
      ],
    });
  });

  it("accepts a range alongside ordinary arguments in MIN/MAX/AVG", () => {
    const docObjects = objects(["obj_5", "table_x", "table"]);
    for (const name of ["MIN", "MAX", "AVG"]) {
      const ast = parseOk(`${name}(A1:B4, 0)`, docObjects, "obj_5");
      if (ast.type !== "functionCall") {
        throw new Error(`expected a functionCall node for ${name}, got ${ast.type}`);
      }
      expect(ast.args[0]?.type, name).toBe("range");
    }
  });

  it("rejects a range as a non-aggregate function's argument", () => {
    const docObjects = objects(["obj_5", "table_x", "table"]);
    const error = parseFail("IF(A1:B4, 1, 2)", docObjects, "obj_5");
    expect(error.message).toContain("aggregate function");
  });

  it("rejects a bare range as a whole formula (not first-class — §5.3)", () => {
    const docObjects = objects(["obj_5", "table_x", "table"]);
    const error = parseFail("A1:B4", docObjects, "obj_5");
    expect(error.error).toBe("#PARSE");
  });

  it("rejects a range nested one level inside an aggregate argument (SUM(A1:B4 + 1)) — the range's DIRECT parent is '+', not SUM", () => {
    const docObjects = objects(["obj_5", "table_x", "table"]);
    const error = parseFail("SUM(A1:B4 + 1)", docObjects, "obj_5");
    expect(error.message).toContain("aggregate function");
  });

  it("accepts SUM(A1:B4) + 1 — the range itself IS a direct SUM argument; '+1' only adds to the call's RESULT, never touches the range", () => {
    const docObjects = objects(["obj_5", "table_x", "table"]);
    expect(parseOk("SUM(A1:B4) + 1", docObjects, "obj_5")).toEqual({
      type: "binaryOp",
      operator: "+",
      left: {
        type: "functionCall",
        name: "SUM",
        args: [{ type: "range", start: { objectId: "obj_5", path: ["cells", "A1"] }, end: { objectId: "obj_5", path: ["cells", "B4"] } }],
      },
      right: { type: "literal", value: 1 },
    });
  });

  it("a self-inclusive range is still just a RangeNode here — cycle-ness is a graph-time concern, not this file's (§5.3: 'do not special-case it')", () => {
    const docObjects = objects(["obj_5", "table_x", "table"]);
    expect(parseOk("SUM(A6:A6)", docObjects, "obj_5")).toEqual({
      type: "functionCall",
      name: "SUM",
      args: [{ type: "range", start: { objectId: "obj_5", path: ["cells", "A6"] }, end: { objectId: "obj_5", path: ["cells", "A6"] } }],
    });
  });

  it("accepts SUM((A1:B4)) — a redundant paren does not defeat the placement check (disclosed in the file header: parens add no AST node)", () => {
    const docObjects = objects(["obj_5", "table_x", "table"]);
    expect(parseOk("SUM((A1:B4))", docObjects, "obj_5")).toEqual({
      type: "functionCall",
      name: "SUM",
      args: [{ type: "range", start: { objectId: "obj_5", path: ["cells", "A1"] }, end: { objectId: "obj_5", path: ["cells", "B4"] } }],
    });
  });
});

describe("parseFormula — D-045: a range whose endpoints name different objects is rejected at PARSE time", () => {
  it("rejects SUM(table_x.A1:table_y.B4) — two DIFFERENT tables — with a #PARSE naming the problem", () => {
    const docObjects = objects(["obj_5", "table_x", "table"], ["obj_6", "table_y", "table"]);
    const error = parseFail("SUM(table_x.A1:table_y.B4)", docObjects);
    expect(error.error).toBe("#PARSE");
    expect(error.message).toContain("same table");
  });

  it("accepts SUM(table_x.A1:table_x.B4) — both endpoints naming the SAME table, written out in full", () => {
    const docObjects = objects(["obj_5", "table_x", "table"]);
    expect(parseOk("SUM(table_x.A1:table_x.B4)", docObjects)).toEqual({
      type: "functionCall",
      name: "SUM",
      args: [{ type: "range", start: { objectId: "obj_5", path: ["cells", "A1"] }, end: { objectId: "obj_5", path: ["cells", "B4"] } }],
    });
  });

  it("still runs the placement check first — a cross-object range in a non-aggregate position is rejected for placement, not object identity", () => {
    const docObjects = objects(["obj_5", "table_x", "table"], ["obj_6", "table_y", "table"]);
    const error = parseFail("IF(table_x.A1:table_y.B4, 1, 2)", docObjects);
    expect(error.message).toContain("aggregate function");
  });
});

describe("parseFormula — malformed input never throws, returns a #PARSE ParseError instead", () => {
  it("rejects an empty formula", () => {
    const error = parseFail("");
    expect(error.message).toBe("empty formula");
  });

  it("rejects a formula that is only whitespace", () => {
    expect(parseFail("   ").error).toBe("#PARSE");
  });

  it("rejects trailing garbage after a complete expression", () => {
    const error = parseFail("1 + 2 3");
    expect(error.message).toContain("trailing input");
  });

  it("propagates a LexError from the lex stage unchanged, as a valid ParseError", () => {
    const error = parseFail('"unterminated');
    expect(error.error).toBe("#PARSE");
    expect(error.message).toContain("unterminated string literal");
  });

  it("rejects a dangling operator with nothing after it", () => {
    expect(parseFail("1 +").error).toBe("#PARSE");
  });

  it("rejects a stray comma", () => {
    expect(parseFail("1, 2").error).toBe("#PARSE");
  });

  it("never throws across a battery of malformed inputs", () => {
    const malformed = ["", "(", ")", "1 +", "+ 1 +", "SUM(", "SUM(,)", "1 2 3", "@", "AND(", ".", "A1:", ":A1", "1:2"];
    for (const source of malformed) {
      let result: unknown;
      expect(() => {
        result = parseFormula(source, []);
      }, `expected parseFormula(${JSON.stringify(source)}) not to throw`).not.toThrow();
      expect(result).toMatchObject({ error: "#PARSE" });
    }
  });
});

describe("isParseError (0032-REVIEW-phase1, D-032)", () => {
  it("is true for a real ParseError", () => {
    expect(isParseError({ error: "#PARSE", message: "x", start: 0 })).toBe(true);
  });

  it("is FALSE for ast.ts's ErrorNode, which is a FormulaAst that also has an 'error' field (D-028)", () => {
    const repairedRoot: FormulaAst = { type: "error", error: "#REF" };
    expect(isParseError(repairedRoot)).toBe(false);
  });

  it("is false for every other FormulaAst variant and for a plain Address", () => {
    expect(isParseError({ type: "literal", value: 1 })).toBe(false);
    expect(isParseError({ objectId: "obj_1", path: ["value"] })).toBe(false);
  });
});

describe("parseFormulaTokens — the lower-level, already-lexed entry point", () => {
  it("parses directly from a hand-built token array, matching lex()'s own output shape", () => {
    const tokens = [
      { type: "number" as const, text: "1", start: 0, value: 1 },
      { type: "plus" as const, text: "+", start: 2 },
      { type: "number" as const, text: "2", start: 4, value: 2 },
      { type: "eof" as const, text: "", start: 5 },
    ];
    const result = parseFormulaTokens(tokens, []);
    expect(result).toEqual({
      type: "binaryOp",
      operator: "+",
      left: { type: "literal", value: 1 },
      right: { type: "literal", value: 2 },
    });
  });
});

describe("the two depth limits — D-079's fixed constants, not a measured band", () => {
  it("MAX_FORMULA_PARSE_DEPTH is 256 nesting steps and MAX_FORMULA_AST_DEPTH is 1000 levels", () => {
    expect(MAX_FORMULA_PARSE_DEPTH).toBe(256);
    expect(MAX_FORMULA_AST_DEPTH).toBe(1000);
  });

  it("refuses a parenthesis nesting past the descent limit with a #PARSE, and does not throw", () => {
    const source = `${"(".repeat(1000)}1${")".repeat(1000)}`;
    const result = parseFormula(source, []);
    expect(isParseError(result)).toBe(true);
    expect((result as ParseError).message).toContain("nests too deeply");
  });

  it("still parses a nesting just inside the descent limit", () => {
    const source = `${"(".repeat(127)}1${")".repeat(127)}`;
    expect(parseFormula(source, [])).toEqual({ type: "literal", value: 1 });
  });

  it("refuses a unary prefix run past the descent limit rather than recursing into it", () => {
    const result = parseFormula(`${"-".repeat(300)}1`, []);
    expect(isParseError(result)).toBe(true);
    expect((result as ParseError).message).toContain("nests too deeply");
  });

  it("refuses a left-associative chain past the AST limit — the case the descent's own counter cannot see", () => {
    const source = Array.from({ length: MAX_FORMULA_AST_DEPTH + 1 }, () => "1").join(" + ");
    const result = parseFormula(source, []);
    expect(isParseError(result)).toBe(true);
    expect((result as ParseError).message).toContain("nested operations");
  });

  it("still parses a left-associative chain exactly AT the AST limit", () => {
    const source = Array.from({ length: MAX_FORMULA_AST_DEPTH }, () => "1").join(" + ");
    const result = parseFormula(source, []);
    expect(isParseError(result)).toBe(false);
    expect((result as FormulaAst).type).toBe("binaryOp");
  });

  it("does not throw for the sizes that used to throw — 20,000 and 80,000 terms", () => {
    for (const size of [20_000, 80_000]) {
      const source = Array.from({ length: size }, () => "1").join(" + ");
      expect(() => parseFormula(source, [])).not.toThrow();
      expect(isParseError(parseFormula(source, []))).toBe(true);
    }
  });

  it("does not accumulate depth across SIBLINGS — 300 nested-but-shallow terms on one line still parse", () => {
    const source = Array.from({ length: 300 }, () => "((1))").join(" + ");
    expect(isParseError(parseFormula(source, []))).toBe(false);
  });

  it("leaves the nesting counter unraised after a refusal, so a later formula on the same call path still parses", () => {
    expect(isParseError(parseFormula(`${"(".repeat(1000)}1${")".repeat(1000)}`, []))).toBe(true);
    expect(parseFormula("1 + 2", [])).toEqual({
      type: "binaryOp",
      operator: "+",
      left: { type: "literal", value: 1 },
      right: { type: "literal", value: 2 },
    });
  });
});
