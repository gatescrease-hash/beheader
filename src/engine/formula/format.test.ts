/**
 * format.test.ts
 *
 * These tests cover the way an AST turns back into text, where a renamed
 * object formats under its new name.
 */
import { describe, expect, it } from "vitest";
import type { AddressableObject } from "../address.ts";
import type { ObjectType } from "../graph/node.ts";
import { MAX_FORMULA_AST_DEPTH, type FormulaAst } from "./ast.ts";
import { formatFormula } from "./format.ts";
import { isParseError, parseFormula } from "./parser.ts";

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

function formatted(source: string, docObjects: readonly AddressableObject[] = DOCUMENT, tableObjectId?: string): string {
  return formatFormula(parseOk(source, docObjects, tableObjectId), docObjects);
}

function expectRoundTrip(source: string, docObjects: readonly AddressableObject[] = DOCUMENT, tableObjectId?: string): string {
  const first = parseOk(source, docObjects, tableObjectId);
  const text = formatFormula(first, docObjects);
  expect(parseOk(text, docObjects, tableObjectId)).toEqual(first);
  return text;
}

describe("names, not ids", () => {
  it("prints an object's CURRENT name, which is why renaming rewrites no formula", () => {
    const ast = parseOk("polygon_1.origin.x + 1");
    const renamed = objects(["obj_1", "intersection_a"], ["obj_3", "table_x", "table"]);
    expect(formatFormula(ast, renamed)).toBe("intersection_a.origin.x + 1");
  });

  it("prints a bare cell ref in the short form it was typed in, because formatAddress strips the stored cells prefix", () => {
    expect(formatted("A1 + 1", DOCUMENT, "obj_3")).toBe("table_x.A1 + 1");
  });

  it("prints a lowercase cell ref uppercased, because exactly one spelling is ever stored", () => {
    expect(formatted("a1", DOCUMENT, "obj_3")).toBe("table_x.A1");
  });

  it("reports an address whose object is gone as the AddressError's own message rather than throwing, because an error never throws", () => {
    const ast = parseOk("polygon_1.radius");
    expect(() => formatFormula(ast, [])).not.toThrow();
    expect(formatFormula(ast, [])).toContain('no object with id "obj_1"');
  });
});

describe("literals", () => {
  it("round-trips a number, a string, and both booleans", () => {
    expect(expectRoundTrip("42")).toBe("42");
    expect(expectRoundTrip("1.5")).toBe("1.5");
    expect(expectRoundTrip('"hello"')).toBe('"hello"');
    expect(expectRoundTrip("TRUE")).toBe("TRUE");
    expect(expectRoundTrip("FALSE")).toBe("FALSE");
  });

  it("re-escapes an embedded quote with the one escape the language has, so the string re-parses to the same value", () => {
    expect(expectRoundTrip('"say \\"hi\\""')).toBe('"say \\"hi\\""');
  });

  it("prints a number too large for the lexer's grammar in JS exponent form, which does NOT re-parse — a disclosed lexer limit, not a choice made here", () => {
    const ast: FormulaAst = { type: "literal", value: 1e21 };
    const text = formatFormula(ast, DOCUMENT);
    expect(text).toBe("1e+21");
    expect(isParseError(parseFormula(text, DOCUMENT))).toBe(true);
  });
});

describe("precedence — parentheses are re-inserted from the precedence chain, never remembered", () => {
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

  it("treats ^ as left-associative too, so its right operand parenthesises the same way", () => {
    expect(expectRoundTrip("2 ^ (3 ^ 2)")).toBe("2 ^ (3 ^ 2)");
    expect(expectRoundTrip("2 ^ 3 ^ 2")).toBe("2 ^ 3 ^ 2");
  });

  it("round-trips every step of the precedence chain from OR down to ^", () => {
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
  it("round-trips a function call, including a nested IF", () => {
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
  it("prints a repaired reference as #REF, which the language has no syntax for", () => {
    const ast: FormulaAst = { type: "binaryOp", operator: "+", left: { type: "error", error: "#REF" }, right: { type: "literal", value: 1 } };
    expect(formatFormula(ast, DOCUMENT)).toBe("#REF + 1");
  });
});

describe("relativeToObjectId — the in-place cell editor's bare Excel form", () => {
  it("prints a same-table cell reference bare when its table is the relative object", () => {
    const ast = parseOk("A1 * 2", DOCUMENT, "obj_3");
    expect(formatFormula(ast, DOCUMENT, "obj_3")).toBe("A1 * 2");
  });

  it("leaves the reference fully qualified when NO relativeToObjectId is passed — every existing caller is unaffected", () => {
    const ast = parseOk("A1 * 2", DOCUMENT, "obj_3");
    expect(formatFormula(ast, DOCUMENT)).toBe("table_x.A1 * 2");
  });

  it("keeps a reference to a DIFFERENT object qualified even with a relative object set", () => {
    const ast = parseOk("A1 + polygon_1.origin.x", DOCUMENT, "obj_3");
    expect(formatFormula(ast, DOCUMENT, "obj_3")).toBe("A1 + polygon_1.origin.x");
  });

  it("keeps a same-table cell reference qualified when the relative object is some OTHER object", () => {
    const ast = parseOk("A1 * 2", DOCUMENT, "obj_3");
    expect(formatFormula(ast, DOCUMENT, "obj_1")).toBe("table_x.A1 * 2");
  });

  it("keeps a NON-CELL slot of the relative object itself qualified — only a `cells.*` slot has a bare form that re-parses", () => {
    const ast = parseOk("table_x.rows + A1", DOCUMENT, "obj_3");
    expect(formatFormula(ast, DOCUMENT, "obj_3")).toBe("table_x.rows + A1");
  });

  it("prints BOTH endpoints of a same-table range bare, never the mixed form", () => {
    const ast = parseOk("SUM(A1:B4)", DOCUMENT, "obj_3");
    expect(formatFormula(ast, DOCUMENT, "obj_3")).toBe("SUM(A1:B4)");
  });

  it("keeps both endpoints of a range qualified when its table is not the relative object", () => {
    const ast = parseOk("SUM(A1:B4)", DOCUMENT, "obj_3");
    expect(formatFormula(ast, DOCUMENT, "obj_1")).toBe("SUM(table_x.A1:table_x.B4)");
  });

  it("round-trips: seed a cell formula, format relative, re-parse with the same host table -> identical AST", () => {
    const first = parseOk("B1 * 2 + SUM(A1:A4)", DOCUMENT, "obj_3");
    const text = formatFormula(first, DOCUMENT, "obj_3");
    expect(text).toBe("B1 * 2 + SUM(A1:A4)");
    expect(parseOk(text, DOCUMENT, "obj_3")).toEqual(first);
  });
});

describe("the depth guard — a saved AST deeper than any parse could build", () => {
  function ladder(levels: number): FormulaAst {
    let ast: FormulaAst = { type: "literal", value: 1 };
    for (let index = 0; index < levels; index += 1) {
      ast = { type: "binaryOp", operator: "+", left: ast, right: { type: "literal", value: 1 } };
    }
    return ast;
  }

  it("formats an AST exactly at the limit without eliding anything", () => {
    const formatted = formatFormula(ladder(MAX_FORMULA_AST_DEPTH - 1), DOCUMENT);
    expect(formatted).not.toContain("...");
    expect(formatted.startsWith("1 + 1")).toBe(true);
  });

  it("elides past the limit rather than unwinding a RangeError", () => {
    let formatted = "";
    expect(() => {
      formatted = formatFormula(ladder(40_000), DOCUMENT);
    }).not.toThrow();
    expect(formatted).toContain("...");
    expect(formatted.endsWith("1 + 1")).toBe(true);
  });
});
