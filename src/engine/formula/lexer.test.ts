/**
 * lexer.test.ts
 *
 * Tokens. It covers the numeric path segment case.
 */
import { describe, expect, it } from "vitest";
import { lex, type Token } from "./lexer.ts";

describe("lex — whitespace", () => {
  it("skips spaces, tabs, and newlines between tokens", () => {
    const result = lex(" \t1\n+\r2 ");
    expect(result).toEqual([
      { type: "number", text: "1", start: 2, value: 1 },
      { type: "plus", text: "+", start: 4 },
      { type: "number", text: "2", start: 6, value: 2 },
      { type: "eof", text: "", start: 8 },
    ] satisfies Token[]);
  });

  it("returns just an eof token for an empty source", () => {
    expect(lex("")).toEqual([{ type: "eof", text: "", start: 0 }]);
  });

  it("returns just an eof token for a whitespace-only source", () => {
    expect(lex("   \t\n")).toEqual([{ type: "eof", text: "", start: 5 }]);
  });
});

describe("lex — numbers", () => {
  it("lexes a bare integer", () => {
    const result = lex("42");
    expect(result).toEqual([
      { type: "number", text: "42", start: 0, value: 42 },
      { type: "eof", text: "", start: 2 },
    ]);
  });

  it("lexes a decimal number", () => {
    const result = lex("1.5");
    expect(result).toEqual([
      { type: "number", text: "1.5", start: 0, value: 1.5 },
      { type: "eof", text: "", start: 3 },
    ]);
  });

  it("does not consume a trailing dot with no digit after it — '5.' is number(5) then dot, per the file header", () => {
    const result = lex("5.");
    expect(result).toEqual([
      { type: "number", text: "5", start: 0, value: 5 },
      { type: "dot", text: ".", start: 1 },
      { type: "eof", text: "", start: 2 },
    ]);
  });

  it("does not support a leading dot — '.5' is dot then number(5), not a 0.5 literal", () => {
    const result = lex(".5");
    expect(result).toEqual([
      { type: "dot", text: ".", start: 0 },
      { type: "number", text: "5", start: 1, value: 5 },
      { type: "eof", text: "", start: 2 },
    ]);
  });

  it("lexes '-2' as a standalone minus token followed by a number(2) — never a signed number literal (file header, matches ast.ts's UnaryOpNode)", () => {
    const result = lex("-2");
    expect(result).toEqual([
      { type: "minus", text: "-", start: 0 },
      { type: "number", text: "2", start: 1, value: 2 },
      { type: "eof", text: "", start: 2 },
    ]);
  });

  it("does not support exponent notation — '1e10' is number(1) then identifier(e10), not 1e10", () => {
    const result = lex("1e10");
    expect(result).toEqual([
      { type: "number", text: "1", start: 0, value: 1 },
      { type: "identifier", text: "e10", start: 1 },
      { type: "eof", text: "", start: 4 },
    ]);
  });

  it("a long digit run lexes to a numeric value that may not be finite — this file makes no legality claim (D-025/D-027 is mutate's job)", () => {
    const huge = "1" + "0".repeat(400);
    const result = lex(huge) as Token[];
    expect(Array.isArray(result)).toBe(true);
    const first = result[0];
    expect(first).toMatchObject({ type: "number", text: huge });
    expect(first).toHaveProperty("value", Infinity);
  });
});

describe("lex — strings", () => {
  it("lexes a simple double-quoted string", () => {
    const result = lex('"hello"');
    expect(result).toEqual([
      { type: "string", text: '"hello"', start: 0, value: "hello" },
      { type: "eof", text: "", start: 7 },
    ]);
  });

  it("resolves the one specified escape, \\\", to a literal quote", () => {
    const result = lex('"say \\"hi\\""');
    const [token] = result as Token[];
    expect(token).toEqual({ type: "string", text: '"say \\"hi\\""', start: 0, value: 'say "hi"' });
  });

  it("copies a backslash not followed by a quote through literally, per the file header's disclosed escape policy", () => {
    const result = lex('"a\\nb"');
    const [token] = result as Token[];
    expect(token).toEqual({ type: "string", text: '"a\\nb"', start: 0, value: "a\\nb" });
  });

  it("lexes an empty string", () => {
    expect(lex('""')).toEqual([
      { type: "string", text: '""', start: 0, value: "" },
      { type: "eof", text: "", start: 2 },
    ]);
  });

  it("returns a #PARSE LexError, never throws, for an unterminated string", () => {
    let result;
    expect(() => {
      result = lex('"never closed');
    }).not.toThrow();
    expect(result).toEqual({
      error: "#PARSE",
      message: "unterminated string literal starting at offset 0",
      start: 0,
    });
  });

  it("returns a #PARSE LexError for a string left open by a trailing escaped quote", () => {
    const result = lex('"abc\\"');
    expect(result).toEqual({
      error: "#PARSE",
      message: "unterminated string literal starting at offset 0",
      start: 0,
    });
  });
});

describe("lex — booleans and keywords (case-sensitive, exact uppercase — file header, D-008's precedent)", () => {
  it("lexes TRUE and FALSE as boolean tokens", () => {
    expect(lex("TRUE")).toEqual([
      { type: "boolean", text: "TRUE", start: 0, value: true },
      { type: "eof", text: "", start: 4 },
    ]);
    expect(lex("FALSE")).toEqual([
      { type: "boolean", text: "FALSE", start: 0, value: false },
      { type: "eof", text: "", start: 5 },
    ]);
  });

  it("lexes AND, OR, NOT as their own keyword token types", () => {
    expect(lex("AND")).toEqual([{ type: "and", text: "AND", start: 0 }, { type: "eof", text: "", start: 3 }]);
    expect(lex("OR")).toEqual([{ type: "or", text: "OR", start: 0 }, { type: "eof", text: "", start: 2 }]);
    expect(lex("NOT")).toEqual([{ type: "not", text: "NOT", start: 0 }, { type: "eof", text: "", start: 3 }]);
  });

  it("does NOT give IF a keyword token — it lexes as a plain identifier, like SUM or ROUND (file header)", () => {
    expect(lex("IF")).toEqual([{ type: "identifier", text: "IF", start: 0 }, { type: "eof", text: "", start: 2 }]);
  });

  it("treats a lowercase or mixed-case spelling as an ordinary identifier, not a keyword or boolean", () => {
    for (const word of ["true", "false", "and", "or", "not", "And", "True"]) {
      const [token] = lex(word) as Token[];
      expect(token, `expected "${word}" to lex as identifier`).toEqual({
        type: "identifier",
        text: word,
        start: 0,
      });
    }
  });

  it("a keyword-shaped prefix followed by more identifier characters is one longer identifier, not a keyword plus a suffix", () => {
    expect(lex("ANDOR")).toEqual([
      { type: "identifier", text: "ANDOR", start: 0 },
      { type: "eof", text: "", start: 5 },
    ]);
  });
});

describe("lex — identifiers", () => {
  it("lexes a name-shaped identifier", () => {
    expect(lex("table_x")).toEqual([
      { type: "identifier", text: "table_x", start: 0 },
      { type: "eof", text: "", start: 7 },
    ]);
  });

  it("lexes a cell-reference-shaped identifier (grammar classification is parser.ts's job, not this file's — see NOT DONE HERE)", () => {
    expect(lex("A1")).toEqual([{ type: "identifier", text: "A1", start: 0 }, { type: "eof", text: "", start: 2 }]);
  });

  it("allows a leading underscore", () => {
    expect(lex("_private")).toEqual([
      { type: "identifier", text: "_private", start: 0 },
      { type: "eof", text: "", start: 8 },
    ]);
  });

  it("does not allow a leading digit — a purely-numeric segment lexes as a number token instead (file header's vertex.0.x note)", () => {
    const result = lex("0x") as Token[];
    expect(result).toEqual([
      { type: "number", text: "0", start: 0, value: 0 },
      { type: "identifier", text: "x", start: 1 },
      { type: "eof", text: "", start: 2 },
    ]);
  });
});

describe("lex — operators and punctuation", () => {
  it("lexes every single-character operator and punctuation mark", () => {
    const cases: ReadonlyArray<readonly [string, Token["type"]]> = [
      ["+", "plus"],
      ["-", "minus"],
      ["*", "star"],
      ["/", "slash"],
      ["%", "percent"],
      ["^", "caret"],
      ["=", "eq"],
      ["(", "lparen"],
      [")", "rparen"],
      [",", "comma"],
      [".", "dot"],
      [":", "colon"],
    ];
    for (const [text, type] of cases) {
      expect(lex(text), `expected "${text}" to lex as ${type}`).toEqual([
        { type, text, start: 0 },
        { type: "eof", text: "", start: 1 },
      ]);
    }
  });

  it("disambiguates < / <= / <>", () => {
    expect(lex("<")).toEqual([{ type: "lt", text: "<", start: 0 }, { type: "eof", text: "", start: 1 }]);
    expect(lex("<=")).toEqual([{ type: "le", text: "<=", start: 0 }, { type: "eof", text: "", start: 2 }]);
    expect(lex("<>")).toEqual([{ type: "ne", text: "<>", start: 0 }, { type: "eof", text: "", start: 2 }]);
  });

  it("disambiguates > / >=", () => {
    expect(lex(">")).toEqual([{ type: "gt", text: ">", start: 0 }, { type: "eof", text: "", start: 1 }]);
    expect(lex(">=")).toEqual([{ type: "ge", text: ">=", start: 0 }, { type: "eof", text: "", start: 2 }]);
  });

  it("does not misread '<' followed by an unrelated character as the start of a two-char operator", () => {
    expect(lex("<1")).toEqual([
      { type: "lt", text: "<", start: 0 },
      { type: "number", text: "1", start: 1, value: 1 },
      { type: "eof", text: "", start: 2 },
    ]);
  });
});

describe("lex — malformed input never throws, returns a #PARSE LexError instead", () => {
  it("rejects an unrecognised character", () => {
    let result;
    expect(() => {
      result = lex("1 @ 2");
    }).not.toThrow();
    expect(result).toEqual({ error: "#PARSE", message: 'unrecognised character "@" at offset 2', start: 2 });
  });

  it("rejects an unrecognised character even as the very first character", () => {
    expect(lex("#bad")).toEqual({ error: "#PARSE", message: 'unrecognised character "#" at offset 0', start: 0 });
  });

  it("never throws across a battery of malformed inputs", () => {
    const malformed = ["#", "@", "$", "[", "]", "{", "}", "`", "~", '"unterminated', '"esc\\"', "\\"];
    for (const source of malformed) {
      let result: unknown;
      expect(() => {
        result = lex(source);
      }, `expected lex(${JSON.stringify(source)}) not to throw`).not.toThrow();
      expect(result).toMatchObject({ error: "#PARSE" });
    }
  });
});

describe("lex — realistic composite formulas", () => {
  it("tokenizes a nested IF over a comparison and string literals", () => {
    const result = lex('IF(table_x.A1 > 50, "big", -3.5)');
    expect(result).toEqual([
      { type: "identifier", text: "IF", start: 0 },
      { type: "lparen", text: "(", start: 2 },
      { type: "identifier", text: "table_x", start: 3 },
      { type: "dot", text: ".", start: 10 },
      { type: "identifier", text: "A1", start: 11 },
      { type: "gt", text: ">", start: 14 },
      { type: "number", text: "50", start: 16, value: 50 },
      { type: "comma", text: ",", start: 18 },
      { type: "string", text: '"big"', start: 20, value: "big" },
      { type: "comma", text: ",", start: 25 },
      { type: "minus", text: "-", start: 27 },
      { type: "number", text: "3.5", start: 28, value: 3.5 },
      { type: "rparen", text: ")", start: 31 },
      { type: "eof", text: "", start: 32 },
    ]);
  });

  it("tokenizes an aggregate call over a range", () => {
    const result = lex("SUM(A1:B4)");
    expect(result).toEqual([
      { type: "identifier", text: "SUM", start: 0 },
      { type: "lparen", text: "(", start: 3 },
      { type: "identifier", text: "A1", start: 4 },
      { type: "colon", text: ":", start: 6 },
      { type: "identifier", text: "B4", start: 7 },
      { type: "rparen", text: ")", start: 9 },
      { type: "eof", text: "", start: 10 },
    ]);
  });

  it("tokenizes the full operator precedence chain in one expression, both keyword and symbol operators", () => {
    const result = lex("a OR b AND c = d <> e < f > g <= h >= i + j - k * l / m % n ^ o");
    const types = (result as Token[]).map((t) => t.type);
    expect(types).toEqual([
      "identifier", "or", "identifier", "and", "identifier", "eq", "identifier", "ne", "identifier",
      "lt", "identifier", "gt", "identifier", "le", "identifier", "ge", "identifier", "plus",
      "identifier", "minus", "identifier", "star", "identifier", "slash", "identifier", "percent",
      "identifier", "caret", "identifier", "eof",
    ]);
  });
});

describe("lex — every source character is accounted for (no character silently dropped or duplicated)", () => {
  it("consecutive token 'start' offsets plus each token's own text length span the whole source, for a mixed fixture", () => {
    const source = ' IF(x>1,"y",z) ';
    const result = lex(source) as Token[];
    expect(Array.isArray(result)).toBe(true);
    let cursor = 0;
    for (const token of result) {
      expect(token.start).toBeGreaterThanOrEqual(cursor);
      const gap = source.slice(cursor, token.start);
      expect(gap.trim(), `expected only whitespace between offset ${cursor} and ${token.start}, got ${JSON.stringify(gap)}`).toBe("");
      expect(source.slice(token.start, token.start + token.text.length)).toBe(token.text);
      cursor = token.start + token.text.length;
    }
    expect(source.slice(cursor).trim()).toBe("");
  });
});
