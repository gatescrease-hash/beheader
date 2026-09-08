/**
 * functions.ts
 *
 * Layer: engine. Pure logic. It imports from engine only. It must never
 * touch the DOM, a window, a document, a canvas or the render layer.
 *
 * The registry of built in functions. A table from name to arity to body.
 *
 * One line adds a function. Two entries are lazy, because IF must not evaluate
 * the branch it does not take.
 */

import { isErrorValue, isIllegalNumber, type ErrorValue, type Value } from "../graph/node.ts";

export type Arity = { readonly kind: "exact"; readonly count: number } | { readonly kind: "atLeast"; readonly count: number };

export type ArityCheckResult = { readonly ok: true } | { readonly ok: false; readonly message: string };

export interface EagerFunctionEntry {
  readonly name: string;
  readonly evaluationMode: "eager";
  readonly arity: Arity;
  readonly acceptsRangeArgument: boolean;
  readonly implementation: (args: readonly Value[]) => Value;
}

export interface LazyFunctionEntry {
  readonly name: string;
  readonly evaluationMode: "lazy";
  readonly arity: Arity;
  readonly acceptsRangeArgument: boolean;
}

export type FunctionEntry = EagerFunctionEntry | LazyFunctionEntry;

function describeValueType(value: Value): string {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "a point array";
  }
  if (typeof value === "object") {
    return "a point";
  }
  return typeof value;
}

function asNumber(name: string, argIndex: number, value: Value | undefined): number | ErrorValue {
  if (value === undefined) {
    return { error: "#TYPE", message: `${name}: missing argument ${argIndex + 1}` };
  }
  if (isErrorValue(value)) {
    return value;
  }
  if (typeof value !== "number") {
    return { error: "#TYPE", message: `${name}: argument ${argIndex + 1} must be a number, got ${describeValueType(value)}` };
  }
  return value;
}

function asString(name: string, argIndex: number, value: Value | undefined): string | ErrorValue {
  if (value === undefined) {
    return { error: "#TYPE", message: `${name}: missing argument ${argIndex + 1}` };
  }
  if (isErrorValue(value)) {
    return value;
  }
  if (typeof value !== "string") {
    return { error: "#TYPE", message: `${name}: argument ${argIndex + 1} must be a string, got ${describeValueType(value)}` };
  }
  return value;
}

function asBoolean(name: string, argIndex: number, value: Value | undefined): boolean | ErrorValue {
  if (value === undefined) {
    return { error: "#TYPE", message: `${name}: missing argument ${argIndex + 1}` };
  }
  if (isErrorValue(value)) {
    return value;
  }
  if (typeof value !== "boolean") {
    return { error: "#TYPE", message: `${name}: argument ${argIndex + 1} must be a boolean, got ${describeValueType(value)}` };
  }
  return value;
}

function isNumericError(value: number | ErrorValue): value is ErrorValue {
  return typeof value !== "number";
}

function isStringError(value: string | ErrorValue): value is ErrorValue {
  return typeof value !== "string";
}

function isNumberListError(value: readonly number[] | ErrorValue): value is ErrorValue {
  return !Array.isArray(value);
}

function isStringListError(value: readonly string[] | ErrorValue): value is ErrorValue {
  return !Array.isArray(value);
}

function asNumberList(name: string, args: readonly Value[]): readonly number[] | ErrorValue {
  const numbers: number[] = [];
  for (const [index, value] of args.entries()) {
    const n = asNumber(name, index, value);
    if (isNumericError(n)) {
      return n;
    }
    numbers.push(n);
  }
  return numbers;
}

function asStringList(name: string, args: readonly Value[]): readonly string[] | ErrorValue {
  const strings: string[] = [];
  for (const [index, value] of args.entries()) {
    const s = asString(name, index, value);
    if (isStringError(s)) {
      return s;
    }
    strings.push(s);
  }
  return strings;
}

export function finiteResult(name: string, value: number): Value {
  if (isIllegalNumber(value)) {
    if (Object.is(value, -0)) {
      return 0;
    }
    return { error: "#TYPE", message: `${name}: result is not a legal number (${value})` };
  }
  return value;
}

function eager(
  name: string,
  arity: Arity,
  implementation: (args: readonly Value[]) => Value,
  acceptsRangeArgument = false,
): EagerFunctionEntry {
  return { name, evaluationMode: "eager", arity, acceptsRangeArgument, implementation };
}

function lazy(name: string, arity: Arity): LazyFunctionEntry {
  return { name, evaluationMode: "lazy", arity, acceptsRangeArgument: false };
}

const EXACTLY = (count: number): Arity => ({ kind: "exact", count });
const AT_LEAST = (count: number): Arity => ({ kind: "atLeast", count });

export const FUNCTION_REGISTRY: Readonly<Record<string, FunctionEntry>> = {
  IF: lazy("IF", EXACTLY(3)),
  AND: lazy("AND", AT_LEAST(1)),
  OR: lazy("OR", AT_LEAST(1)),

  NOT: eager("NOT", EXACTLY(1), (args) => {
    const x = asBoolean("NOT", 0, args[0]);
    return isErrorValue(x) ? x : !x;
  }),

  SUM: eager(
    "SUM",
    AT_LEAST(1),
    (args) => {
      const numbers = asNumberList("SUM", args);
      if (isNumberListError(numbers)) {
        return numbers;
      }
      return finiteResult("SUM", numbers.reduce((total, n) => total + n, 0));
    },
    true,
  ),
  MIN: eager(
    "MIN",
    AT_LEAST(1),
    (args) => {
      const numbers = asNumberList("MIN", args);
      if (isNumberListError(numbers)) {
        return numbers;
      }
      return finiteResult("MIN", numbers.reduce((min, n) => Math.min(min, n), Infinity));
    },
    true,
  ),
  MAX: eager(
    "MAX",
    AT_LEAST(1),
    (args) => {
      const numbers = asNumberList("MAX", args);
      if (isNumberListError(numbers)) {
        return numbers;
      }
      return finiteResult("MAX", numbers.reduce((max, n) => Math.max(max, n), -Infinity));
    },
    true,
  ),
  AVG: eager(
    "AVG",
    AT_LEAST(1),
    (args) => {
      const numbers = asNumberList("AVG", args);
      if (isNumberListError(numbers)) {
        return numbers;
      }
      const sum = numbers.reduce((total, n) => total + n, 0);
      return finiteResult("AVG", sum / numbers.length);
    },
    true,
  ),

  ABS: eager("ABS", EXACTLY(1), (args) => {
    const x = asNumber("ABS", 0, args[0]);
    return isNumericError(x) ? x : finiteResult("ABS", Math.abs(x));
  }),
  ROUND: eager("ROUND", EXACTLY(2), (args) => {
    const n = asNumber("ROUND", 0, args[0]);
    if (isNumericError(n)) {
      return n;
    }
    const digits = asNumber("ROUND", 1, args[1]);
    if (isNumericError(digits)) {
      return digits;
    }
    const factor = 10 ** digits;
    return finiteResult("ROUND", Math.round(n * factor) / factor);
  }),
  FLOOR: eager("FLOOR", EXACTLY(1), (args) => {
    const x = asNumber("FLOOR", 0, args[0]);
    return isNumericError(x) ? x : finiteResult("FLOOR", Math.floor(x));
  }),
  CEIL: eager("CEIL", EXACTLY(1), (args) => {
    const x = asNumber("CEIL", 0, args[0]);
    return isNumericError(x) ? x : finiteResult("CEIL", Math.ceil(x));
  }),
  SQRT: eager("SQRT", EXACTLY(1), (args) => {
    const x = asNumber("SQRT", 0, args[0]);
    return isNumericError(x) ? x : finiteResult("SQRT", Math.sqrt(x));
  }),
  POW: eager("POW", EXACTLY(2), (args) => {
    const base = asNumber("POW", 0, args[0]);
    if (isNumericError(base)) {
      return base;
    }
    const exponent = asNumber("POW", 1, args[1]);
    if (isNumericError(exponent)) {
      return exponent;
    }
    return finiteResult("POW", Math.pow(base, exponent));
  }),

  CONCAT: eager("CONCAT", AT_LEAST(1), (args) => {
    const strings = asStringList("CONCAT", args);
    return isStringListError(strings) ? strings : strings.join("");
  }),
  LEN: eager("LEN", EXACTLY(1), (args) => {
    const s = asString("LEN", 0, args[0]);
    return isStringError(s) ? s : finiteResult("LEN", s.length);
  }),

  PI: eager("PI", EXACTLY(0), () => Math.PI),

  SIN: eager("SIN", EXACTLY(1), (args) => {
    const x = asNumber("SIN", 0, args[0]);
    return isNumericError(x) ? x : finiteResult("SIN", Math.sin(x));
  }),
  COS: eager("COS", EXACTLY(1), (args) => {
    const x = asNumber("COS", 0, args[0]);
    return isNumericError(x) ? x : finiteResult("COS", Math.cos(x));
  }),
  TAN: eager("TAN", EXACTLY(1), (args) => {
    const x = asNumber("TAN", 0, args[0]);
    return isNumericError(x) ? x : finiteResult("TAN", Math.tan(x));
  }),
  ATAN2: eager("ATAN2", EXACTLY(2), (args) => {
    const y = asNumber("ATAN2", 0, args[0]);
    if (isNumericError(y)) {
      return y;
    }
    const x = asNumber("ATAN2", 1, args[1]);
    if (isNumericError(x)) {
      return x;
    }
    return finiteResult("ATAN2", Math.atan2(y, x));
  }),
  DEG: eager("DEG", EXACTLY(1), (args) => {
    const radians = asNumber("DEG", 0, args[0]);
    return isNumericError(radians) ? radians : finiteResult("DEG", (radians * 180) / Math.PI);
  }),
  RAD: eager("RAD", EXACTLY(1), (args) => {
    const degrees = asNumber("RAD", 0, args[0]);
    return isNumericError(degrees) ? degrees : finiteResult("RAD", (degrees * Math.PI) / 180);
  }),
};

export function getFunctionEntry(name: string): FunctionEntry | undefined {
  if (!Object.hasOwn(FUNCTION_REGISTRY, name)) {
    return undefined;
  }
  return FUNCTION_REGISTRY[name];
}

export const RANGE_ACCEPTING_FUNCTION_NAMES: ReadonlySet<string> = new Set(
  Object.values(FUNCTION_REGISTRY)
    .filter((entry) => entry.acceptsRangeArgument)
    .map((entry) => entry.name),
);

export const LAZY_FUNCTION_NAMES: ReadonlySet<string> = new Set(
  Object.values(FUNCTION_REGISTRY)
    .filter((entry) => entry.evaluationMode === "lazy")
    .map((entry) => entry.name),
);

/** Tests the argument count for a function against its declared arity. */
export function checkArity(name: string, arity: Arity, argCount: number): ArityCheckResult {
  if (arity.kind === "exact") {
    if (argCount !== arity.count) {
      return {
        ok: false,
        message: `${name} expects exactly ${arity.count} argument${arity.count === 1 ? "" : "s"}, got ${argCount}`,
      };
    }
    return { ok: true };
  }
  if (argCount < arity.count) {
    return {
      ok: false,
      message: `${name} expects at least ${arity.count} argument${arity.count === 1 ? "" : "s"}, got ${argCount}`,
    };
  }
  return { ok: true };
}
