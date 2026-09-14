import { describe, expect, it } from "vitest";
import { evaluateMathObject, MATH_MAX_CALL_DEPTH, MATH_MAX_SERIES_TERMS } from "./eval.ts";
import { isMathParseError, parseMath } from "./parser.ts";
import type { MathAst, MathProgram } from "./ast.ts";

function run(source: string, inputs: Record<string, number> = {}): Record<string, unknown> {
  const program = parseMath(source);
  if (isMathParseError(program)) throw new Error(`${source}: ${program.message}`);
  return evaluateMathObject(program, inputs).exports;
}

describe("evaluateMathObject", () => {
  it("evaluates arithmetic in the usual order", () => {
    expect(run("y=1+2*3")).toEqual({ y: 7 });
    expect(run("y=(1+2)*3")).toEqual({ y: 9 });
  });

  it("reads a value from the inputs it is given", () => {
    expect(run("y=x*2", { x: 21 })).toEqual({ y: 42 });
  });

  it("gives every export of a source, in the order the lines define them", () => {
    expect(Object.keys(run("a=1\nb=2\nc=3"))).toEqual(["a", "b", "c"]);
  });

  it("lets a line read a value an earlier line defined", () => {
    expect(run("a=2\nb=a*3")).toEqual({ a: 2, b: 6 });
  });

  it("gives a function no export of its own", () => {
    expect(run("f(x)=x^2\ny=f(4)")).toEqual({ y: 16 });
  });

  it("integrates a constant integrand across its range", () => {
    // Six units of width, and the integrand never reads the variable.
    expect(run("y=\\int_{2}^{8}\\sin(a)dx", { a: 1 }).y).toBeCloseTo(6 * Math.sin(1), 9);
  });

  it("integrates a polynomial exactly, which Simpson's rule does", () => {
    expect(run("y=\\int_{0}^{3}x^2dx").y).toBeCloseTo(9, 9);
  });

  it("integrates a curve Simpson's rule approaches", () => {
    expect(run("y=\\int_{0}^{\\pi}\\sin(x)dx").y).toBeCloseTo(2, 8);
  });

  it("gives zero for an integral whose bounds meet", () => {
    expect(run("y=\\int_{5}^{5}x dx")).toEqual({ y: 0 });
  });

  it("reverses the sign when the upper bound is below the lower one", () => {
    expect(run("y=\\int_{1}^{0}x dx").y).toBeCloseTo(-0.5, 9);
  });

  it("sums and multiplies over a range", () => {
    expect(run("y=\\sum_{i=1}^{5}i^2")).toEqual({ y: 55 });
    expect(run("y=\\prod_{i=1}^{5}i")).toEqual({ y: 120 });
  });

  it("gives the empty answer for a range that runs backwards", () => {
    expect(run("y=\\sum_{i=3}^{1}i")).toEqual({ y: 0 });
    expect(run("y=\\prod_{i=3}^{1}i")).toEqual({ y: 1 });
  });

  it("refuses a range between two numbers that are not whole", () => {
    expect(run("y=\\sum_{i=1}^{b}i", { b: 2.5 }).y).toMatchObject({ error: "#MATH" });
  });

  it("refuses a range wider than the term limit rather than running it", () => {
    const result = run("y=\\sum_{i=1}^{n}i", { n: MATH_MAX_SERIES_TERMS + 1 }).y;
    expect(result).toMatchObject({ error: "#MATH" });
    expect((result as { message: string }).message).toContain("wider than the limit");
  });

  it("gives a division by zero its own error code", () => {
    expect(run("y=1/z", { z: 0 }).y).toMatchObject({ error: "#DIV0" });
  });

  it("refuses a result that leaves the finite numbers", () => {
    expect(run("y=10^n", { n: 400 }).y).toMatchObject({ error: "#MATH" });
  });

  it("keeps a failed line from touching the lines around it", () => {
    const exports = run("a=1\nb=1/z\nc=3", { z: 0 });
    expect(exports["a"]).toBe(1);
    expect(exports["b"]).toMatchObject({ error: "#DIV0" });
    expect(exports["c"]).toBe(3);
  });

  it("gives a name with no value an error rather than reading undefined", () => {
    // parseMath would make x an input, so this shape reaches the evaluator
    // only from a program built by hand.
    const program: MathProgram = { lines: [{ type: "definition", name: "y", value: { type: "name", name: "x" }, sourceLine: 0 }] };
    expect(evaluateMathObject(program, {}).exports["y"]).toMatchObject({ error: "#MATH" });
  });

  it("stops a chain of calls at the depth limit rather than exhausting the stack", () => {
    // names.ts refuses a function that calls itself, so this program is built
    // by hand to reach the guard that keeps the promise of termination a
    // property of the evaluator.
    const body: MathAst = { type: "call", name: "f", args: [{ type: "name", name: "t" }] };
    const program: MathProgram = {
      lines: [
        { type: "functionDefinition", name: "f", parameters: ["t"], body },
        { type: "definition", name: "y", value: { type: "call", name: "f", args: [{ type: "number", value: 1 }] }, sourceLine: 1 },
      ],
    };
    const result = evaluateMathObject(program, {}).exports["y"];
    expect(result).toMatchObject({ error: "#MATH" });
    expect((result as { message: string }).message).toContain(String(MATH_MAX_CALL_DEPTH));
  });

  it("gives nothing for a source with no definition in it", () => {
    expect(run("1+1")).toEqual({});
  });
});
