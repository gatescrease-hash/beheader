import { describe, expect, it } from "vitest";
import { isMathParseError, parseMath } from "./parser.ts";
import { isMathNameError, resolveMathNames, type MathNames } from "./names.ts";

function resolve(source: string): MathNames {
  const program = parseMath(source);
  if (isMathParseError(program)) throw new Error(`${source}: ${program.message}`);
  const names = resolveMathNames(program);
  if (isMathNameError(names)) throw new Error(`${source}: ${names.message}`);
  return names;
}

function refusal(source: string): string {
  const program = parseMath(source);
  if (isMathParseError(program)) throw new Error(`${source} failed at the parser: ${program.message}`);
  const names = resolveMathNames(program);
  if (!isMathNameError(names)) throw new Error(`${source} was expected to fail`);
  return names.message;
}

describe("resolveMathNames", () => {
  it("makes a free name an input and a defined name an export", () => {
    expect(resolve("y=a+b")).toMatchObject({ inputs: ["a", "b"], exports: ["y"] });
  });

  it("lists an input once however often the source reads it", () => {
    expect(resolve("y=a+a+a").inputs).toEqual(["a"]);
  });

  it("lists inputs in the order the source first reads them", () => {
    expect(resolve("y=b+a").inputs).toEqual(["b", "a"]);
  });

  it("keeps the variable of an integral out of the inputs", () => {
    expect(resolve("y=\\int_{0}^{1}x^2dx").inputs).toEqual([]);
  });

  it("keeps the variable of a sum and of a product out of the inputs", () => {
    expect(resolve("y=\\sum_{i=1}^{3}i").inputs).toEqual([]);
    expect(resolve("y=\\prod_{k=1}^{3}k").inputs).toEqual([]);
  });

  it("reads the bounds of a binding form outside that binding", () => {
    expect(resolve("y=\\int_{a}^{b}x dx").inputs).toEqual(["a", "b"]);
  });

  it("keeps a function parameter out of the inputs and keeps a free name in", () => {
    expect(resolve("f(t)=t+c").inputs).toEqual(["c"]);
  });

  it("lets a later line read a name an earlier line defines", () => {
    expect(resolve("a=1\nb=a+1")).toMatchObject({ exports: ["a", "b"], inputs: [] });
  });

  it("refuses a name read above the line that defines it", () => {
    expect(refusal("b=a\na=1")).toContain("above");
  });

  it("refuses a name defined twice", () => {
    expect(refusal("a=1\na=2")).toContain("twice");
  });

  it("refuses a function defined twice", () => {
    expect(refusal("f(x)=x\nf(y)=y")).toContain("twice");
  });

  it("refuses a name that is both a function and a value", () => {
    expect(refusal("f(x)=x\nf=1")).toContain("both");
  });

  it("refuses a function used as a value", () => {
    expect(refusal("f(x)=x\ny=f+1")).toContain("no value of its own");
  });

  it("reads a name in front of a bracket as a product when no line defines that function", () => {
    // Nothing names h as a function, so h(1) is h times 1 and h is an input.
    // A source that meant a call defines the function, and the parser then
    // reads the same text as one.
    expect(resolve("y=h(1)").inputs).toEqual(["h"]);
    expect(resolve("h(t)=t+1\ny=h(1)").inputs).toEqual([]);
  });

  it("refuses a function that calls itself, so evaluation cannot recurse", () => {
    expect(refusal("f(x)=f(x)\ny=f(1)")).toContain("never calls itself");
  });

  it("refuses a pair of functions that call each other", () => {
    expect(refusal("f(x)=g(x)\ng(x)=f(x)\ny=f(1)")).toContain("below this line");
  });

  it("refuses a call with the wrong number of arguments", () => {
    expect(refusal("y=\\sin(1,2)")).toContain("takes 1 argument");
    expect(refusal("f(a,b)=a+b\ny=f(1)")).toContain("takes 2 arguments");
  });

  it("reports the functions the source defines", () => {
    expect(resolve("f(x)=x\ng(y)=y\nz=1").functions).toEqual(["f", "g"]);
  });

  it("gives an empty result for an empty source", () => {
    expect(resolve("")).toMatchObject({ exports: [], inputs: [], functions: [] });
  });
});
