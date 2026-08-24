/**
 * functions.ts — The built-in function registry (PROJECT_BRIEF §5.3).
 *
 * IMPLEMENTS: §5.3's built-ins list in full (`IF, AND, OR, NOT, SUM, MIN, MAX, AVG,
 * ABS, ROUND, FLOOR, CEIL, SQRT, POW, CONCAT, LEN, PI, SIN, COS, TAN, ATAN2, DEG,
 * RAD`) as one table-driven registry ("name → arity → implementation... so adding one
 * is a single line"), and **D-029**'s rider on it: `IF`/`AND`/`OR` are registered by
 * NAME and ARITY only and MUST NOT have an implementation computing from
 * pre-evaluated arguments, because §5.3 requires them evaluated LAZILY by
 * `formula/eval.ts` at the call site, in both syntactic forms. `NOT` is D-029's one
 * exception — one argument, no branch to skip — and is an ordinary eager entry.
 * LAYER: engine (pure). May import: engine/* only.
 *        NEVER imports: DOM, window, document, canvas, render/*.
 *
 * WHAT THIS IS
 *   `FUNCTION_REGISTRY` plus:
 *   - `getFunctionEntry(name)` — exact, guarded lookup (D-034); nothing indexes the
 *     registry directly.
 *   - `checkArity(name, arity, argCount)` — a pure, standalone check returning a
 *     human-readable message, deliberately SEPARATE from `implementation` so a caller
 *     checks before calling.
 *   - `RANGE_ACCEPTING_FUNCTION_NAMES` — every name accepting a `RangeNode` argument
 *     (`SUM`, `MIN`, `MAX`, `AVG`). `parser.ts` imports this rather than keeping a
 *     second copy: one source of truth (D-009/D-014).
 *   - `LAZY_FUNCTION_NAMES` — every name D-029 forbids an eager implementation for.
 *     `formula/eval.ts` special-cases exactly this set.
 *   - `finiteResult(name, value)` — exported so `formula/eval.ts`'s own arithmetic
 *     routes through the SAME D-033 guard rather than a second copy.
 *
 *   Every EAGER implementation follows `primitives/schema.ts`'s `add` compute
 *   function's shape — same precedent, not reinvented:
 *   1. Propagate the FIRST already-`ErrorValue` argument, left to right, so a
 *      multiply-erroring call is deterministic (§5.1: "errors propagate").
 *   2. Type-check every remaining argument, one `#TYPE` per bad one, naming its
 *      1-based position.
 *   3. Compute, then route the result through `finiteResult` — the same
 *      `isIllegalNumber` predicate (`graph/node.ts`, D-014) `mutation.ts`'s checks
 *      use, so nothing that cannot survive §5.11's JSON format leaves this file. Its
 *      two halves get DIFFERENT answers per **D-033**: a non-finite result is `#TYPE`,
 *      while a `-0` result NORMALISES to `+0` — `CEIL(-0.5)` has a correct,
 *      representable answer, and erroring would replace it with a lie.
 *
 *   Every FIXED-ARITY implementation is ALSO defensive against too FEW arguments (a
 *   missing `args[i]` reads as `undefined` under `noUncheckedIndexedAccess`) and
 *   returns `#TYPE` rather than crashing. The VARIADIC ones have no fixed position to
 *   miss: called with zero arguments they return their identity or a caught illegal
 *   result (`SUM()` is `0`, `CONCAT()` is `""`, `MIN()`/`MAX()`/`AVG()` are `#TYPE`),
 *   never a crash. This is deliberate belt-and-braces: `checkArity` exists so a real
 *   caller checks first, but this file does not trust that a future one always will —
 *   the same layered posture D-017 establishes elsewhere (a check upstream is
 *   necessary, not a license for the function underneath to assume it ran).
 *
 *   **Names match case-sensitively, uppercase only.** Not a fresh guess: the
 *   range-accepting set was already case-sensitive-uppercase in shipped code, and a
 *   case-insensitive registry here would create an inconsistency where `sum(...)`
 *   recognises as a call but loses its range-placement legality. Also the reversible
 *   direction (Q-004's standing: lowercase acceptance is purely additive later).
 *
 *   **`CONCAT` requires every argument to already be a `string`** — no implicit
 *   coercion. The brief does not specify; §9's tie-breaker picks strict ("whatever is
 *   simplest to delete later"): adding coercion later is a pure widening, removing it
 *   after formulas depend on it is not. Strict is also the uniform posture every other
 *   typed argument here takes.
 *
 * INVARIANTS UPHELD HERE
 *   - No entry ever throws. Every failure — wrong arity, wrong type, a missing
 *     argument, a propagated upstream error, a non-finite or `-0` result — returns a
 *     typed `ErrorValue` (§5.1).
 *   - `implementation` is `(args: readonly Value[]) => Value`: it receives ALREADY-
 *     EVALUATED arguments, never a `FormulaAst`. A range argument is already flattened
 *     into individual values by the time an implementation sees it — that flattening
 *     is `eval.ts`'s job.
 *   - A `LazyFunctionEntry` structurally CANNOT carry an `implementation` field —
 *     TypeScript's excess-property check catches an attempt to add one at this file's
 *     own construction sites. D-029 enforced by the compiler, not only by convention.
 *   - `FUNCTION_REGISTRY` is plain data. Nothing here is ever stored in a `Document`.
 *
 * NOT DONE HERE
 *   Dispatching any of this. `formula/eval.ts` checks arity, special-cases
 *   `LAZY_FUNCTION_NAMES`, and calls `implementation` for everything else.
 */
import { isErrorValue, isIllegalNumber, type ErrorValue, type Value } from "../graph/node.ts";

/**
 * How many arguments a function accepts. `"exact"` for a fixed count (`NOT`, `ROUND`, `PI`...);
 * `"atLeast"` for a variadic built-in (`SUM`/`MIN`/`MAX`/`AVG`/`CONCAT`/`AND`/`OR`) — §5.3 never
 * states an upper bound on any of these ("No loops... no recursion" bounds a FORMULA's total size
 * naturally; it does not bound one call's own argument count), so `"atLeast"` has deliberately no
 * `max` field rather than an arbitrary one invented here.
 */
export type Arity = { readonly kind: "exact"; readonly count: number } | { readonly kind: "atLeast"; readonly count: number };

/** The result of `checkArity` — same shape as `address.ts`'s `NameCheckResult`, not imported from
 * it: a different domain (argument counts, not names) deserves its own local type rather than a
 * cross-domain reuse that would couple two unrelated files for a shape they merely happen to share. */
export type ArityCheckResult = { readonly ok: true } | { readonly ok: false; readonly message: string };

/**
 * A built-in that computes eagerly from already-evaluated arguments — every entry except `IF`/
 * `AND`/`OR` (D-029). `acceptsRangeArgument` is `RANGE_ACCEPTING_FUNCTION_NAMES`'s underlying data
 * (see file header); `evaluationMode` is the discriminant `LazyFunctionEntry` shares.
 */
export interface EagerFunctionEntry {
  readonly name: string;
  readonly evaluationMode: "eager";
  readonly arity: Arity;
  readonly acceptsRangeArgument: boolean;
  readonly implementation: (args: readonly Value[]) => Value;
}

/**
 * `IF`/`AND`/`OR` (D-029): registered for name/arity purposes only. Deliberately has NO
 * `implementation` field — see the file header's INVARIANTS UPHELD HERE for why that omission is
 * itself the enforcement mechanism, not merely a convention.
 */
export interface LazyFunctionEntry {
  readonly name: string;
  readonly evaluationMode: "lazy";
  readonly arity: Arity;
  readonly acceptsRangeArgument: boolean;
}

export type FunctionEntry = EagerFunctionEntry | LazyFunctionEntry;

// ---------------------------------------------------------------------------
// Argument coercion helpers — shared by every eager implementation below.
// Each returns the typed value on success, or a typed ErrorValue on failure;
// never throws. `argIndex` is 0-based internally, reported 1-based (user-facing).
// ---------------------------------------------------------------------------

function describeValueType(value: Value): string {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "a point array";
  }
  if (typeof value === "object") {
    return "a point"; // ErrorValue is handled by isErrorValue before this ever runs.
  }
  return typeof value; // "number" | "string" | "boolean"
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

/** Narrows `number | ErrorValue` — `isErrorValue` itself can't (its parameter is `Value`, and a
 * bare `number` argument is fine there, but TypeScript needs a predicate over THIS union to
 * narrow a `const` declared with it). Same minimal-workaround shape as `parser.ts`'s `isLexError`. */
function isNumericError(value: number | ErrorValue): value is ErrorValue {
  return typeof value !== "number";
}

function isStringError(value: string | ErrorValue): value is ErrorValue {
  return typeof value !== "string";
}

/** Narrows `readonly number[] | ErrorValue`, the return shape of `asNumberList` below. */
function isNumberListError(value: readonly number[] | ErrorValue): value is ErrorValue {
  return !Array.isArray(value);
}

function isStringListError(value: readonly string[] | ErrorValue): value is ErrorValue {
  return !Array.isArray(value);
}

/** Every argument, type-checked as a number, in order — the shared body behind `SUM`/`MIN`/`MAX`/`AVG`. */
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

/** Every argument, type-checked as a string, in order — `CONCAT`'s body. */
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

/**
 * Guards a computed numeric result through the SAME `isIllegalNumber` predicate (`graph/node.ts`,
 * D-014) `mutation.ts` and `primitives/schema.ts`'s `add` already use — but answers its two halves
 * DIFFERENTLY, per **D-033** (ruled at 0035-REVIEW-phase1):
 *
 *   - Non-finite (`NaN`, `Infinity`, `-Infinity`) becomes `#TYPE`. The computation has no answer
 *     this project can represent (`SQRT(-1)`, `POW(0, -1)`), so reporting a number would be a lie.
 *     Same treatment `add`'s compute already gives it (D-025).
 *   - `-0` is normalised to `+0`. The computation DOES have an answer and it is zero: `CEIL(-0.5)`
 *     and `ROUND(-0.4, 0)` are ordinary arithmetic whose only defect is IEEE 754's sign bit on a
 *     zero — which JSON cannot carry (Q-008) and which no reader of a `Value` can distinguish.
 *     Erroring there turns a correct answer into `#TYPE`.
 *
 * This is NOT Q-008's rejected option (c): that rejection is about `mutate` silently rewriting a
 * value an OPERATION asked to store (the D-019 defect). Nothing here was asked for by an operation
 * — a compute function is choosing which legal `Value` its own arithmetic yields — and `mutate`
 * still rejects an authored `-0` literal exactly as before. Every eager arithmetic implementation
 * below routes its result through this rather than returning a raw `number` directly.
 *
 * EXPORTED so `formula/eval.ts`'s own arithmetic operators (`+ - * / % ^` and unary
 * `-`) route through the SAME guard rather than a second copy — D-033's own binding text: "A future
 * compute path that can produce `-0` MUST route through a guard of THAT SHAPE rather than deciding
 * for itself." Reusing the literal function, not merely its shape, is the stronger reading and
 * keeps D-014's "one leaf predicate, one place it is applied" property intact as this project's
 * third caller (`add`'s narrower non-finite-only check is unaffected — see that file's own header
 * for why `+` alone can never reach the `-0` half).
 */
export function finiteResult(name: string, value: number): Value {
  if (isIllegalNumber(value)) {
    // D-033: `-0` is the one illegal number whose correct answer IS representable — normalise
    // rather than error. Everything else this predicate catches is genuinely unrepresentable.
    if (Object.is(value, -0)) {
      return 0;
    }
    return { error: "#TYPE", message: `${name}: result is not a legal number (${value})` };
  }
  return value;
}

// ---------------------------------------------------------------------------
// The registry (§5.3's full built-ins list)
// ---------------------------------------------------------------------------

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
  // D-029: registered for name/arity only — NO implementation. See file header.
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
      // `Math.min(...numbers)` spreads its whole argument list onto the call
      // stack — a `RangeError` risk once a range expands into a long list
      // (D-036 constraint 5, 0035-REVIEW Finding 4; reachable as of the cycle
      // that wires range evaluation in, since that is the first thing able to
      // make this list arbitrarily long). `.reduce` visits one element at a
      // time instead. The seed `Infinity` reproduces `Math.min()`'s own
      // documented answer for zero arguments EXACTLY — D-044 point 2's
      // "functions.ts's existing zero-argument behaviour" this ruling asks to
      // keep, reachable when a range clamps to empty (`SUM`-family arity is
      // checked against the AST's one range ARGUMENT, not its flattened cell
      // count, so `MIN` over an empty clamped range still reaches here with
      // zero numbers) — `finiteResult` then correctly reports `#TYPE` for the
      // non-finite result, unchanged from before this fix.
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
      // See MIN's own comment: same spread hazard, same `.reduce` fix, same
      // zero-argument answer preserved via the `-Infinity` seed (`Math.max()`'s
      // own documented answer for zero arguments).
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

/**
 * Exact, case-sensitive lookup. See the file header for why case-sensitivity is not a fresh guess.
 *
 * `Object.hasOwn` first, never a bare index (**D-034**, 0035-REVIEW-phase1): `FUNCTION_REGISTRY`
 * is an object literal, so `FUNCTION_REGISTRY["toString"]` walks up the prototype chain and hands
 * back `Object.prototype.toString` — a truthy value the type system believes is a `FunctionEntry`,
 * whose first field read (`entry.arity`, inside `checkArity`) then throws a `TypeError` inside
 * `src/engine/`. `toString(1)` is a formula `parser.ts` accepts today (it validates no function
 * name), so the bad lookup is reachable from ordinary user text, not theoretical.
 */
export function getFunctionEntry(name: string): FunctionEntry | undefined {
  if (!Object.hasOwn(FUNCTION_REGISTRY, name)) {
    return undefined;
  }
  return FUNCTION_REGISTRY[name];
}

/**
 * Every registered name whose entry accepts a `RangeNode` argument — folded in from `parser.ts`'s
 * former `AGGREGATE_FUNCTION_NAMES` (see file header). Today: `SUM`, `MIN`, `MAX`, `AVG`.
 */
export const RANGE_ACCEPTING_FUNCTION_NAMES: ReadonlySet<string> = new Set(
  Object.values(FUNCTION_REGISTRY)
    .filter((entry) => entry.acceptsRangeArgument)
    .map((entry) => entry.name),
);

/**
 * Every registered name D-029 forbids an eager implementation for. Today: `IF`, `AND`, `OR`.
 * `NOT` is deliberately absent — D-029's one exception, an ordinary `EagerFunctionEntry` above.
 */
export const LAZY_FUNCTION_NAMES: ReadonlySet<string> = new Set(
  Object.values(FUNCTION_REGISTRY)
    .filter((entry) => entry.evaluationMode === "lazy")
    .map((entry) => entry.name),
);

/**
 * Checks an actual argument count against a declared `Arity`, human-readable on mismatch — same
 * "report which rule failed" shape `address.ts`'s `checkNameAvailable` already establishes. Pure;
 * never throws.
 */
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
