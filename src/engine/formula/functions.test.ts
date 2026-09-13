/**
 * functions.test.ts
 *
 * These tests cover every built in function, its arity check, and the two
 * lazy entries.
 */
import { describe, expect, it } from "vitest";
import type { ErrorValue, Value } from "../graph/node.ts";
import {
  checkArity,
  FUNCTION_REGISTRY,
  getFunctionEntry,
  LAZY_FUNCTION_NAMES,
  RANGE_ACCEPTING_FUNCTION_NAMES,
  type EagerFunctionEntry,
} from "./functions.ts";

const ALL_BUILTIN_NAMES = [
  "IF", "AND", "OR", "NOT", "SUM", "MIN", "MAX", "AVG", "ABS", "ROUND", "FLOOR", "CEIL", "SQRT",
  "POW", "CONCAT", "LEN", "PI", "SIN", "COS", "TAN", "ATAN2", "DEG", "RAD",
];

const ERR: ErrorValue = { error: "#REF", message: "upstream broke" };

function call(name: string, args: readonly Value[]): Value {
  const entry = getFunctionEntry(name);
  if (entry === undefined || entry.evaluationMode !== "eager") {
    throw new Error(`expected "${name}" to be a known, eager function entry`);
  }
  return entry.implementation(args);
}

function expectError(value: Value, code: string): void {
  expect(value).toMatchObject({ error: code });
}

describe("FUNCTION_REGISTRY — completeness", () => {
  it("has exactly one entry per built in name, no more, no fewer", () => {
    expect(Object.keys(FUNCTION_REGISTRY).sort()).toEqual([...ALL_BUILTIN_NAMES].sort());
  });

  it("every entry's own `name` field matches its registry key", () => {
    for (const [key, entry] of Object.entries(FUNCTION_REGISTRY)) {
      expect(entry.name).toBe(key);
    }
  });

  it("getFunctionEntry is case-sensitive — lowercase does not resolve", () => {
    expect(getFunctionEntry("sum")).toBeUndefined();
    expect(getFunctionEntry("Sum")).toBeUndefined();
    expect(getFunctionEntry("SUM")).toBeDefined();
  });

  it("getFunctionEntry returns undefined for an unknown name", () => {
    expect(getFunctionEntry("FOO")).toBeUndefined();
  });

  it("returns undefined for an Object.prototype member name, which a bare index would resolve", () => {
    for (const inherited of ["toString", "constructor", "valueOf", "hasOwnProperty", "__proto__"]) {
      expect(getFunctionEntry(inherited)).toBeUndefined();
    }
  });
});

describe("IF/AND/OR are lazy (no implementation); NOT is the one eager exception", () => {
  it("IF, AND, OR are registered with evaluationMode 'lazy' and no implementation field", () => {
    for (const name of ["IF", "AND", "OR"]) {
      const entry = getFunctionEntry(name);
      expect(entry?.evaluationMode).toBe("lazy");
      expect(entry).not.toHaveProperty("implementation");
    }
  });

  it("LAZY_FUNCTION_NAMES is exactly {IF, AND, OR} — NOT is absent", () => {
    expect([...LAZY_FUNCTION_NAMES].sort()).toEqual(["AND", "IF", "OR"]);
    expect(LAZY_FUNCTION_NAMES.has("NOT")).toBe(false);
  });

  it("NOT is registered eager, with a callable implementation", () => {
    const entry = getFunctionEntry("NOT");
    expect(entry?.evaluationMode).toBe("eager");
    expect((entry as EagerFunctionEntry).implementation).toBeTypeOf("function");
  });

  it("IF has exact arity 3; AND/OR have at-least arity 1", () => {
    expect(getFunctionEntry("IF")?.arity).toEqual({ kind: "exact", count: 3 });
    expect(getFunctionEntry("AND")?.arity).toEqual({ kind: "atLeast", count: 1 });
    expect(getFunctionEntry("OR")?.arity).toEqual({ kind: "atLeast", count: 1 });
  });
});

describe("RANGE_ACCEPTING_FUNCTION_NAMES — folded in from parser.ts's former local set", () => {
  it("is exactly {SUM, MIN, MAX, AVG}", () => {
    expect([...RANGE_ACCEPTING_FUNCTION_NAMES].sort()).toEqual(["AVG", "MAX", "MIN", "SUM"]);
  });

  it("every other registered name does not accept a range argument", () => {
    for (const [name, entry] of Object.entries(FUNCTION_REGISTRY)) {
      if (!["SUM", "MIN", "MAX", "AVG"].includes(name)) {
        expect(entry.acceptsRangeArgument).toBe(false);
      }
    }
  });
});

describe("checkArity", () => {
  it("exact: passes when the count matches", () => {
    expect(checkArity("NOT", { kind: "exact", count: 1 }, 1)).toEqual({ ok: true });
  });

  it("exact: fails, naming both counts, when it doesn't", () => {
    const result = checkArity("NOT", { kind: "exact", count: 1 }, 2);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toContain("exactly 1 argument");
    expect(!result.ok && result.message).toContain("got 2");
  });

  it("atLeast: passes at and above the minimum", () => {
    expect(checkArity("SUM", { kind: "atLeast", count: 1 }, 1)).toEqual({ ok: true });
    expect(checkArity("SUM", { kind: "atLeast", count: 1 }, 5)).toEqual({ ok: true });
  });

  it("atLeast: fails below the minimum", () => {
    const result = checkArity("SUM", { kind: "atLeast", count: 1 }, 0);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toContain("at least 1 argument");
  });

  it("pluralises the argument count correctly (1 vs many)", () => {
    const one = checkArity("F", { kind: "exact", count: 1 }, 0);
    const two = checkArity("F", { kind: "exact", count: 2 }, 0);
    expect(!one.ok && one.message).toContain("1 argument,");
    expect(!two.ok && two.message).toContain("2 arguments,");
  });
});

describe("NOT", () => {
  it("negates a boolean", () => {
    expect(call("NOT", [true])).toBe(false);
    expect(call("NOT", [false])).toBe(true);
  });

  it("propagates an upstream error", () => {
    expect(call("NOT", [ERR])).toEqual(ERR);
  });

  it("#TYPE on a non-boolean argument", () => {
    expectError(call("NOT", [1]), "#TYPE");
  });

  it("#TYPE on a missing argument (defensive, does not throw)", () => {
    expectError(call("NOT", []), "#TYPE");
  });
});

describe("SUM / MIN / MAX / AVG", () => {
  it("SUM adds every argument", () => {
    expect(call("SUM", [1, 2, 3])).toBe(6);
  });

  it("MIN / MAX over several arguments", () => {
    expect(call("MIN", [3, 1, 2])).toBe(1);
    expect(call("MAX", [3, 1, 2])).toBe(3);
  });

  it("AVG divides the sum by the count", () => {
    expect(call("AVG", [2, 4, 6])).toBe(4);
  });

  it("a single argument is legal for all four (arity at-least 1)", () => {
    expect(call("SUM", [5])).toBe(5);
    expect(call("AVG", [5])).toBe(5);
  });

  it("propagates the FIRST upstream error, left to right", () => {
    const err2: ErrorValue = { error: "#TYPE", message: "second" };
    expect(call("SUM", [1, ERR, err2])).toEqual(ERR);
  });

  it("#TYPE on a non-number argument, naming its 1-based position", () => {
    const result = call("SUM", [1, "two", 3]);
    expectError(result, "#TYPE");
    expect((result as ErrorValue).message).toContain("argument 2");
  });

  it("MIN/MAX with ZERO arguments (unreachable for a literal call, but reachable once a range clamps to empty) match Math.min()/Math.max()'s own documented answer — #TYPE, not a crash", () => {
    expectError(call("MIN", []), "#TYPE");
    expectError(call("MAX", []), "#TYPE");
  });

  it("MIN/MAX over a very large argument list do not throw a RangeError, although the spread call they replaced did", () => {
    const many = Array.from({ length: 200_000 }, (_, i) => i);
    expect(() => call("MIN", many)).not.toThrow();
    expect(() => call("MAX", many)).not.toThrow();
    expect(call("MIN", many)).toBe(0);
    expect(call("MAX", many)).toBe(199_999);
  });
});

describe("ABS / FLOOR / CEIL / SQRT", () => {
  it("computes correctly", () => {
    expect(call("ABS", [-5])).toBe(5);
    expect(call("FLOOR", [1.9])).toBe(1);
    expect(call("CEIL", [1.1])).toBe(2);
    expect(call("SQRT", [9])).toBe(3);
  });

  it("CEIL of a small negative number is +0, not an error", () => {
    const result = call("CEIL", [-0.5]);
    expect(result).toBe(0);
    expect(Object.is(result, -0)).toBe(false);
  });

  it("SQRT of a negative number is #TYPE (NaN result), not a thrown exception", () => {
    expectError(call("SQRT", [-1]), "#TYPE");
  });

  it("#TYPE on a non-number argument", () => {
    expectError(call("ABS", ["x"]), "#TYPE");
  });
});

describe("ROUND(n, digits)", () => {
  it("rounds to the given number of decimal places", () => {
    expect(call("ROUND", [3.14159, 2])).toBe(3.14);
    expect(call("ROUND", [3.14159, 0])).toBe(3);
  });

  it("a result of -0 is normalised to +0, NOT reported as an error", () => {
    const result = call("ROUND", [-0.4, 0]);
    expect(result).toBe(0);
    expect(Object.is(result, -0)).toBe(false);
  });

  it("still reports a genuinely unrepresentable result as #TYPE", () => {
    expectError(call("ROUND", [1, 400]), "#TYPE");
  });

  it("propagates an error from either argument", () => {
    expect(call("ROUND", [ERR, 2])).toEqual(ERR);
    expect(call("ROUND", [3.14159, ERR])).toEqual(ERR);
  });
});

describe("POW / ATAN2", () => {
  it("computes correctly", () => {
    expect(call("POW", [2, 10])).toBe(1024);
    expect(call("ATAN2", [1, 1])).toBeCloseTo(Math.PI / 4);
  });

  it("POW(0, -1) overflows to Infinity, caught and reported as #TYPE", () => {
    expectError(call("POW", [0, -1]), "#TYPE");
  });
});

describe("CONCAT / LEN", () => {
  it("CONCAT joins strings", () => {
    expect(call("CONCAT", ["foo", "bar", "baz"])).toBe("foobarbaz");
  });

  it("CONCAT requires every argument to already be a string — no implicit coercion", () => {
    expectError(call("CONCAT", ["foo", 1]), "#TYPE");
  });

  it("LEN returns a string's length", () => {
    expect(call("LEN", ["hello"])).toBe(5);
  });

  it("LEN on a non-string is #TYPE", () => {
    expectError(call("LEN", [42]), "#TYPE");
  });
});

describe("PI / SIN / COS / TAN / DEG / RAD", () => {
  it("PI takes no arguments and returns Math.PI", () => {
    expect(call("PI", [])).toBe(Math.PI);
  });

  it("SIN / COS / TAN compute correctly", () => {
    expect(call("SIN", [0])).toBe(0);
    expect(call("COS", [0])).toBe(1);
    expect(call("TAN", [0])).toBe(0);
  });

  it("DEG and RAD are exact inverses at a well-behaved angle", () => {
    expect(call("DEG", [Math.PI])).toBeCloseTo(180);
    expect(call("RAD", [180])).toBeCloseTo(Math.PI);
  });
});

describe("every eager function never throws, over a small malformed-input battery", () => {
  const malformed: readonly Value[][] = [[], [null], [{ x: 1, y: 2 }], [ERR], ["not a number"]];

  it("survives every entry in the battery without throwing", () => {
    for (const [name, entry] of Object.entries(FUNCTION_REGISTRY)) {
      if (entry.evaluationMode !== "eager") {
        continue;
      }
      for (const args of malformed) {
        expect(() => entry.implementation(args)).not.toThrow();
      }
    }
  });
});
