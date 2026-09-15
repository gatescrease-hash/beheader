import { describe, expect, it } from "vitest";
import { isMathLexError, tokenizeMath, type MathToken } from "./lexer.ts";

function names(source: string): string[] {
  const tokens = tokenizeMath(source);
  if (isMathLexError(tokens)) throw new Error(tokens.message);
  return (tokens as readonly MathToken[]).filter((token) => token.type !== "eof").map((token) => `${token.type}:${token.name || token.text}`);
}

function failure(source: string): string {
  const tokens = tokenizeMath(source);
  if (!isMathLexError(tokens)) throw new Error("this source was expected to fail");
  return tokens.message;
}

describe("tokenizeMath", () => {
  it("joins a braced subscript to the letter in front of it", () => {
    expect(names("x_{ans}")).toEqual(["identifier:x_ans"]);
  });

  it("joins a single character subscript the same way", () => {
    expect(names("x_1")).toEqual(["identifier:x_1"]);
  });

  it("reads two bare letters as two identifiers, because they multiply", () => {
    expect(names("xy")).toEqual(["identifier:x", "identifier:y"]);
  });

  it("reads a multi-letter name out of an operator command", () => {
    expect(names("\\operatorname{speed}")).toEqual(["identifier:speed"]);
    expect(names("\\mathrm{rate_1}")).toEqual(["identifier:rate_1"]);
  });

  it("drops the commands that only size or space a bracket", () => {
    expect(names("\\left(x\\right)")).toEqual(["lparen:(", "identifier:x", "rparen:)"]);
    expect(names("x\\,y")).toEqual(["identifier:x", "identifier:y"]);
  });

  it("reads a decimal number as one token", () => {
    const tokens = tokenizeMath("3.5");
    if (isMathLexError(tokens)) throw new Error(tokens.message);
    expect(tokens[0]).toMatchObject({ type: "number", value: 3.5 });
  });

  it("keeps a command as a command token without its backslash", () => {
    expect(names("\\sin")).toEqual(["command:sin"]);
  });

  it("gives an underscore of its own after a command, which a range needs", () => {
    expect(names("\\int_2")).toEqual(["command:int", "underscore:_", "number:2"]);
  });

  it("reports a bare dotted address, and names the command that wraps one", () => {
    expect(failure("table_x.A1")).toContain("gpref");
  });

  it("reads an address command as one token carrying the whole address", () => {
    expect(names("\\gpref{obj_3.cells.A1}")).toEqual(["reference:obj_3.cells.A1"]);
  });

  it("keeps an address beside other notation as its own token", () => {
    expect(names("y=\\gpref{obj_3.radius}+1")).toEqual([
      "identifier:y",
      "equals:=",
      "reference:obj_3.radius",
      "plus:+",
      "number:1",
    ]);
  });

  it("refuses a character an address cannot carry", () => {
    expect(failure("\\gpref{obj_3.a b}")).toContain("dots");
  });

  it("refuses an address that never closes", () => {
    expect(failure("\\gpref{obj_3.a")).toContain("closing brace");
  });

  it("refuses an address with nothing in it", () => {
    expect(failure("\\gpref{}")).toContain("nothing in it");
  });

  it("reports a character it has no meaning for", () => {
    expect(failure("x @ y")).toContain("@");
  });

  it("reports a subscript that never closes", () => {
    expect(failure("x_{ans")).toContain("closing brace");
  });

  it("always ends with an eof token, so a parser reads every position", () => {
    const tokens = tokenizeMath("1+1");
    if (isMathLexError(tokens)) throw new Error(tokens.message);
    expect(tokens[tokens.length - 1]?.type).toBe("eof");
  });
});
