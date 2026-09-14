import { describe, expect, it } from "vitest";
import { MATH_MAX_DEPTH, mathAstDepth, type MathAst } from "./ast.ts";

const one: MathAst = { type: "number", value: 1 };
const x: MathAst = { type: "name", name: "x" };

describe("mathAstDepth", () => {
  it("counts a leaf as one level", () => {
    expect(mathAstDepth(one)).toBe(1);
    expect(mathAstDepth(x)).toBe(1);
  });

  it("counts a negation as the level above its operand", () => {
    expect(mathAstDepth({ type: "negate", operand: one })).toBe(2);
  });

  it("follows the deeper side of a binary node", () => {
    const left: MathAst = { type: "negate", operand: { type: "negate", operand: one } };
    expect(mathAstDepth({ type: "binary", operator: "+", left, right: one })).toBe(4);
    expect(mathAstDepth({ type: "binary", operator: "+", left: one, right: left })).toBe(4);
  });

  it("follows the deepest argument of a call", () => {
    expect(mathAstDepth({ type: "call", name: "max", args: [one, { type: "negate", operand: one }] })).toBe(3);
  });

  it("counts a call with no argument as one level above nothing", () => {
    expect(mathAstDepth({ type: "call", name: "pi", args: [] })).toBe(1);
  });

  it("follows whichever of the bounds and the body of an integral is deepest", () => {
    const deep: MathAst = { type: "negate", operand: { type: "negate", operand: one } };
    expect(mathAstDepth({ type: "integral", variable: "x", lower: one, upper: one, body: deep })).toBe(4);
    expect(mathAstDepth({ type: "integral", variable: "x", lower: deep, upper: one, body: one })).toBe(4);
    expect(mathAstDepth({ type: "integral", variable: "x", lower: one, upper: deep, body: one })).toBe(4);
  });

  it("follows the same three places for a series", () => {
    const deep: MathAst = { type: "negate", operand: one };
    expect(mathAstDepth({ type: "series", operation: "sum", variable: "i", lower: one, upper: one, body: deep })).toBe(3);
  });

  it("counts a chain of negations one level per link", () => {
    let node: MathAst = one;
    for (let step = 0; step < 10; step += 1) {
      node = { type: "negate", operand: node };
    }
    expect(mathAstDepth(node)).toBe(11);
  });

  it("holds a depth limit the parser can check a line against", () => {
    expect(MATH_MAX_DEPTH).toBeGreaterThan(1);
  });
});
