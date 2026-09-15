import { describe, expect, it } from "vitest";
import { evaluateMathObject } from "./eval.ts";
import { isMathParseError, parseMath } from "./parser.ts";
import { MATH_MAX_DEPTH, type MathProgram } from "./ast.ts";

function program(source: string): MathProgram {
  const result = parseMath(source);
  if (isMathParseError(result)) throw new Error(`${source}: ${result.message}`);
  return result;
}

function failure(source: string): { message: string; line: number } {
  const result = parseMath(source);
  if (!isMathParseError(result)) throw new Error(`${source} was expected to fail`);
  return { message: result.message, line: result.line };
}

/** The value of the one export of a source, which is how a shape is checked. */
function value(source: string, inputs: Record<string, number> = {}): unknown {
  const exports = evaluateMathObject(program(source), inputs).exports;
  return Object.values(exports)[0];
}

describe("parseMath", () => {
  it("reads a definition, a function definition and a bare expression", () => {
    expect(program("y=1").lines[0]?.type).toBe("definition");
    expect(program("f(x)=x").lines[0]?.type).toBe("functionDefinition");
    expect(program("1+1").lines[0]?.type).toBe("expression");
  });

  it("drops a blank line rather than refusing it", () => {
    expect(program("y=1\n\n\nz=2").lines).toHaveLength(2);
  });

  it("multiplies juxtaposed factors", () => {
    expect(value("y=2x", { x: 5 })).toBe(10);
    expect(value("y=xy", { x: 3, y: 4 })).toBe(12);
    expect(value("y=2\\sin(0)")).toBe(0);
  });

  it("gives multiplication and division a tighter hold than addition", () => {
    expect(value("y=2+3\\cdot4")).toBe(14);
    expect(value("y=1/2+1")).toBe(1.5);
  });

  it("reads a power as right associative", () => {
    expect(value("y=2^3^2")).toBe(512);
  });

  it("keeps a product outside an exponent", () => {
    expect(value("y=2^2x", { x: 3 })).toBe(12);
  });

  it("reads a fraction as a division of its two groups", () => {
    expect(value("y=\\frac{a+b}{2}", { a: 3, b: 7 })).toBe(5);
  });

  it("reads a square root, and a root of any degree", () => {
    expect(value("y=\\sqrt{9}")).toBe(3);
    expect(value("y=\\sqrt[3]{27}")).toBeCloseTo(3, 10);
  });

  it("reads a pair of bars as an absolute value", () => {
    expect(value("y=|0-4|")).toBe(4);
  });

  it("reads pi as a number", () => {
    expect(value("y=\\pi")).toBeCloseTo(Math.PI, 12);
  });

  it("ends an integrand at its differential rather than multiplying by it", () => {
    expect(value("y=\\int_{0}^{1}x^2dx")).toBeCloseTo(1 / 3, 9);
  });

  it("integrates an expression that sums across the differential", () => {
    expect(value("y=\\int_{0}^{2}x+1dx")).toBeCloseTo(4, 9);
  });

  it("reads a sum and a product over a range", () => {
    expect(value("y=\\sum_{i=1}^{4}i")).toBe(10);
    expect(value("y=\\prod_{i=1}^{4}i")).toBe(24);
  });

  it("calls a function the source defines, and one built in", () => {
    expect(value("f(t)=t^2\ny=f(3)")).toBe(9);
    expect(value("y=\\max(2,7)")).toBe(7);
  });

  it("reads a name in front of a bracket as a product when no function has that name", () => {
    expect(value("y=x(2+1)", { x: 4 })).toBe(12);
  });

  it("parses a call of a function a later line defines, and evaluates it to an error", () => {
    // The two passes let the bracket parse as a call rather than a product.
    // Evaluation still refuses it, because a line calls the functions above it
    // alone, and names.ts turns that into a refusal before a mutation commits.
    expect(value("y=g(2)\ng(t)=t+1")).toMatchObject({ error: "#MATH" });
    expect(value("g(t)=t+1\ny=g(2)")).toBe(3);
  });

  it("reports the line a failure happened on", () => {
    expect(failure("y=1\nz=(2").line).toBe(1);
  });

  it("explains that letters beside each other multiply, for a multi-letter name", () => {
    expect(failure("abc=1").message).toContain("times");
  });

  it("refuses a command it does not read", () => {
    expect(failure("y=\\zeta(2)").message).toContain("zeta");
  });

  it("refuses an integral with no differential", () => {
    expect(failure("y=\\int_{0}^{1}x").message).toContain("differential");
  });

  it("refuses an expression nested deeper than the limit", () => {
    expect(failure(`y=${"-".repeat(80)}1`).message).toContain("nests deeper");
    expect(failure(`y=${"(".repeat(200)}1${")".repeat(200)}`).message).toContain("nests deeper");
  });
});

describe("parseMath — an implicit line", () => {
  it("reads the unknown and the two sides of the equation", () => {
    expect(program("\\solve{x}x^2+3=y").lines[0]).toMatchObject({
      type: "solve",
      unknown: "x",
      left: { type: "binary", operator: "+" },
      right: { type: "name", name: "y" },
      sourceLine: 0,
    });
  });

  it("carries the line of the source the equation came from", () => {
    expect(program("a=1\n\\solve{x}2x=a").lines[1]).toMatchObject({ type: "solve", sourceLine: 1 });
  });

  it("multiplies letters beside each other on both sides, the way every other line does", () => {
    expect(program("\\solve{x}2x=3a").lines[0]).toMatchObject({
      left: { type: "binary", operator: "*" },
      right: { type: "binary", operator: "*" },
    });
  });

  it("refuses an implicit line with no equals sign in it", () => {
    expect(failure("\\solve{x}x^2").message).toContain("equals sign");
  });

  it("refuses an implicit line carrying a second equals sign", () => {
    expect(failure("\\solve{x}x=y=2").message).toContain("the end of the line");
  });

  it("refuses a solve command in the middle of an expression, and quotes it", () => {
    expect(failure("y=2+\\solve{x}").message).toContain("a value was expected");
    expect(failure("y=2\\solve{x}").message).toContain("\\solve{x}");
  });

  it("refuses an equation nesting deeper than the language runs", () => {
    const deep = `\\solve{x}x=${"-".repeat(MATH_MAX_DEPTH + 2)}1`;
    expect(failure(deep).message).toContain("nests deeper");
  });
});
