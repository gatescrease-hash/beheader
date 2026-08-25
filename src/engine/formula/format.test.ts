/**
 * format.test.ts — tests for formula/format.ts (§5.2's "displaying a formula maps IDs
 * back to current names", and the report D-040 requires).
 *
 * The claim most of this file makes is a ROUND TRIP: parse a source string, format the
 * AST, parse the result, and require the two ASTs to be identical. That is the only
 * assertion strong enough to catch a dropped parenthesis, because a formatter that
 * loses one still produces a plausible-looking string — `a - (b - c)` and `a - b - c`
 * differ by nothing a reader would flag and by everything the evaluator would.
 */
import { describe, expect, it } from "vitest";
import type { AddressableObject } from "../address.ts";
import type { ObjectType } from "../graph/node.ts";
import type { FormulaAst } from "./ast.ts";
import { formatFormula } from "./format.ts";
import { isParseError, parseFormula } from "./parser.ts";

/** Same fixture convention as `parser.test.ts`: a non-table type unless a test is about bare cell refs. */
function objects(...entries: Array<[id: string, name: string, type?: ObjectType]>): AddressableObject[] {
  return entries.map(([id, name, type = "polygon"]) => ({ id, name, type }));
}

const DOCUMENT = objects(["obj_1", "polygon_1"], ["obj_3", "table_x", "table"]);

function parseOk(source: string, docObjects: readonly AddressableObject[] = DOCUMENT, tableObjectId?: string): FormulaAst {
  const result = parseFormula(source, docObjects, tableObjectId);
  if (isParseError(result)) {
    throw new Error(`expected "${source}" to parse, got #PARSE: ${result.message}`);
  }
  return result;
}

/** Formats a parsed source string — the shape almost every test below wants. */
function formatted(source: string, docObjects: readonly AddressableObject[] = DOCUMENT, tableObjectId?: string): string {
  return formatFormula(parseOk(source, docObjects, tableObjectId), docObjects);
}

/** Asserts that formatting then re-parsing yields an AST identical to the original. */
function expectRoundTrip(source: string, docObjects: readonly AddressableObject[] = DOCUMENT, tableObjectId?: string): string {
  const first = parseOk(source, docObjects, tableObjectId);
  const text = formatFormula(first, docObjects);
  expect(parseOk(text, docObjects, tableObjectId)).toEqual(first);
  return text;
}

describe("names, not ids (§5.2)", () => {
  it("prints an object's CURRENT name, which is why renaming rewrites no formula", () => {
    const ast = parseOk("polygon_1.origin.x + 1");
    const renamed = objects(["obj_1", "intersection_a"], ["obj_3", "table_x", "table"]);
    expect(formatFormula(ast, renamed)).toBe("intersection_a.origin.x + 1");
  });

  it("prints a bare cell ref in the short form it was typed in, because formatAddress strips the stored cells prefix (D-005/D-008)", () => {
    expect(formatted("A1 + 1", DOCUMENT, "obj_3")).toBe("table_x.A1 + 1");
  });

  it("prints a lowercase cell ref uppercased, because exactly one spelling is ever stored (D-039)", () => {
    expect(formatted("a1", DOCUMENT, "obj_3")).toBe("table_x.A1");
  });

  it("reports an address whose object is gone as the AddressError's own message rather than throwing (§5.1: errors never throw)", () => {
    const ast = parseOk("polygon_1.radius");
    expect(() => formatFormula(ast, [])).not.toThrow();
    expect(formatFormula(ast, [])).toContain('no object with id "obj_1"');
  });
});

describe("literals (§5.3)", () => {
  it("round-trips a number, a string, and both booleans", () => {
    expect(expectRoundTrip("42")).toBe("42");
    expect(expectRoundTrip("1.5")).toBe("1.5");
    expect(expectRoundTrip('"hello"')).toBe('"hello"');
    expect(expectRoundTrip("TRUE")).toBe("TRUE");
    expect(expectRoundTrip("FALSE")).toBe("FALSE");
  });

  it("re-escapes an embedded quote with §5.3's one escape, so the string re-parses to the same value", () => {
    expect(expectRoundTrip('"say \\"hi\\""')).toBe('"say \\"hi\\""');
  });

  it("prints a number too large for the lexer's grammar in JS exponent form, which does NOT re-parse — a disclosed lexer limit, not a choice made here", () => {
    const ast: FormulaAst = { type: "literal", value: 1e21 };
    const text = formatFormula(ast, DOCUMENT);
    expect(text).toBe("1e+21");
    expect(isParseError(parseFormula(text, DOCUMENT))).toBe(true);
  });
});

describe("precedence — parentheses are re-inserted from §5.3's chain, never remembered", () => {
  it("omits a parenthesis the precedence chain already implies", () => {
    expect(formatted("1 + 2 * 3")).toBe("1 + 2 * 3");
    expect(formatted("(1 + 2) * 3")).toBe("(1 + 2) * 3");
  });

  it("normalises the operator's own spacing, because the AST carries none", () => {
    expect(formatted("1+2*3")).toBe("1 + 2 * 3");
  });

  it("keeps the parenthesis a left-associative operator needs on its RIGHT — a - (b - c) is not a - b - c", () => {
    expect(expectRoundTrip("1 - (2 - 3)")).toBe("1 - (2 - 3)");
    expect(expectRoundTrip("1 - 2 - 3")).toBe("1 - 2 - 3");
  });

  it("treats ^ as left-associative too (D-030), so its right operand parenthesises the same way", () => {
    expect(expectRoundTrip("2 ^ (3 ^ 2)")).toBe("2 ^ (3 ^ 2)");
    expect(expectRoundTrip("2 ^ 3 ^ 2")).toBe("2 ^ 3 ^ 2");
  });

  it("round-trips every step of §5.3's chain from OR down to ^", () => {
    for (const source of [
      "TRUE OR FALSE AND TRUE",
      "1 < 2 OR 3 >= 4",
      "1 = 2",
      "1 <> 2",
      "1 + 2 - 3",
      "1 * 2 / 3 % 4",
      "(1 OR 2) * 3",
      "NOT TRUE OR FALSE",
      "-(1 + 2)",
      "- -1",
      "NOT (1 < 2)",
    ]) {
      expectRoundTrip(source);
    }
  });

  it("keeps a unary minus off a nested unary minus, so - -1 never prints as --1", () => {
    expect(formatted("- -1")).toBe("-(-1)");
  });
});

describe("references, ranges and calls", () => {
  it("round-trips a function call, including a nested IF (§5.3's own example shape)", () => {
    expect(expectRoundTrip("IF(polygon_1.radius > 10, 1, IF(TRUE, 2, 3))")).toBe("IF(polygon_1.radius > 10, 1, IF(TRUE, 2, 3))");
  });

  it("prints a range with BOTH endpoints qualified, because a bare second endpoint would not re-parse", () => {
    expect(expectRoundTrip("SUM(table_x.A1:table_x.B4)")).toBe("SUM(table_x.A1:table_x.B4)");
  });

  it("qualifies both endpoints of a range written from inside a cell as bare refs, and it still re-parses", () => {
    expect(expectRoundTrip("SUM(A1:B4)", DOCUMENT, "obj_3")).toBe("SUM(table_x.A1:table_x.B4)");
  });

  it("prints a zero-argument call with empty parens", () => {
    expect(expectRoundTrip("PI()")).toBe("PI()");
  });
});

describe("the one node that is displayable but was never typed", () => {
  it("prints a repaired reference as #REF, which §5.3 has no syntax for (D-028)", () => {
    const ast: FormulaAst = { type: "binaryOp", operator: "+", left: { type: "error", error: "#REF" }, right: { type: "literal", value: 1 } };
    expect(formatFormula(ast, DOCUMENT)).toBe("#REF + 1");
  });
});
