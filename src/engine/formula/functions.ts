/**
 * functions.ts — The built-in function registry (PROJECT_BRIEF §5.3).
 *
 * IMPLEMENTS: §5.3's built-ins list in full ("IF, AND, OR, NOT, SUM, MIN, MAX, AVG, ABS,
 * ROUND(n, digits), FLOOR, CEIL, SQRT, POW, CONCAT, LEN, PI(), SIN, COS, TAN, ATAN2, DEG, RAD")
 * as one table-driven registry ("name → arity → implementation... so adding one is a single
 * line"), and **D-029**'s binding rider on it: `IF`/`AND`/`OR` are registered by NAME and ARITY
 * only — this file MUST NOT give them an implementation that computes from pre-evaluated
 * arguments, because §5.3 requires them to be evaluated LAZILY (`IF` evaluates only the taken
 * branch; `AND`/`OR` short-circuit) by `formula/eval.ts` itself, at the call site, in BOTH
 * syntactic forms (operator and call). `NOT` is D-029's one exception — one argument, no branch
 * to skip — and gets an ordinary eager implementation like every other entry here.
 * LAYER: engine (pure). May import: engine/* only.
 *        NEVER imports: DOM, window, document, canvas, render/*.
 *
 * This is an ORDINARY file inside the already-reviewed `formula/` subsystem (STATUS.md, as of
 * entry 0033: "`functions.ts` is UNBLOCKED") — §6.1 trigger 2 does not apply. It DOES touch
 * `parser.ts`, an already-reviewed file, in one small, disclosed way — see WHAT THIS IS.
 *
 * WHAT THIS IS
 *   `FUNCTION_REGISTRY`, a `Record<string, FunctionEntry>` covering all 23 built-in names, plus:
 *   - `getFunctionEntry(name)` — exact lookup (case-sensitive; see the case-sensitivity note
 *     below).
 *   - `checkArity(name, arity, argCount)` — a pure, standalone arity check returning a
 *     human-readable message on mismatch, same "report which rule failed" shape
 *     `address.ts`'s `checkNameAvailable` already establishes.
 *   - `RANGE_ACCEPTING_FUNCTION_NAMES` — every name whose entry accepts a `RangeNode` argument
 *     (today: `SUM`, `MIN`, `MAX`, `AVG`). `parser.ts`'s `validateRangePlacement` used to keep its
 *     OWN small `AGGREGATE_FUNCTION_NAMES` set for exactly this, with its own header note that it
 *     was "a disclosed, minimal duplication expected to fold into `functions.ts`'s registry once
 *     it exists." That moment is now: `parser.ts` imports this constant instead of hardcoding a
 *     second copy — same behaviour, one source of truth, D-009/D-014's "declare vocabulary once"
 *     principle applied to a new case. This is the one place this file changes an already-reviewed
 *     file, and it is a pure refactor: no parser test's expectations changed, because the set of
 *     names it recognises is identical before and after.
 *   - `LAZY_FUNCTION_NAMES` — every name D-029 forbids an eager implementation for (today: `IF`,
 *     `AND`, `OR`). Consumed as of cycle 0036 by `formula/eval.ts`, which special-cases exactly
 *     this set at the `FunctionCallNode` site rather than dispatching
 *     into this registry's `implementation`.
 *   - `finiteResult(name, value)` — exported as of cycle 0036 so `formula/eval.ts`'s own
 *     arithmetic operators route through the SAME D-033 guard rather than a second copy. See its
 *     own doc comment.
 *
 *   Every EAGER implementation follows `primitives/schema.ts`'s `add` compute function's own
 *   established shape (same file, same precedent, same rationale — not reinvented here):
 *   1. Propagate the FIRST argument that is already an `ErrorValue`, left to right, so a
 *      multiply-erroring call is deterministic (§5.1: "errors propagate").
 *   2. Type-check every remaining argument against what the function actually needs, one #TYPE
 *      message per bad argument, naming its 1-based position.
 *   3. Compute, then run the result through `finiteResult` — the SAME `isIllegalNumber` predicate
 *      (`graph/node.ts`, D-014) `mutation.ts`'s D-025/Q-008 checks already use, so no result that
 *      cannot survive §5.11's JSON format ever leaves this file. Its two halves get DIFFERENT
 *      answers, per **D-033**: a non-finite result becomes `#TYPE` (as `add`'s compute already
 *      does, D-025), while a `-0` result is normalised to `+0` — `CEIL(-0.5)` and `ROUND(-0.4, 0)`
 *      have a correct, representable answer, and erroring would replace it with a lie. See
 *      `finiteResult`'s own comment; see `add`'s header for why `+` alone can never reach either.
 *
 *   Every FIXED-ARITY implementation is ALSO defensive against being called with too FEW arguments
 *   (a missing `args[index]` reads as `undefined`, `noUncheckedIndexedAccess`) — it returns a
 *   `#TYPE` naming the missing argument rather than crashing. The VARIADIC ones have no fixed
 *   position to miss: called with zero arguments they return their own identity or a caught
 *   illegal result (`SUM()` is `0`, `CONCAT()` is `""`, `MIN()`/`MAX()`/`AVG()` are `#TYPE` via
 *   `finiteResult`), never a crash — their `atLeast(1)` minimum is enforced by `checkArity`, not
 *   by the implementation. This is deliberate belt-and-braces: `checkArity` exists precisely so a
 *   real caller (`eval.ts`, later) checks BEFORE calling `implementation`, but this file does not
 *   trust that a future caller always will (the same layered-validation posture `address.ts`/
 *   `mutation.ts` already establish, D-017's precedent: a check upstream is necessary, not a
 *   license for the function underneath to assume it ran).
 *
 *   **Function names are matched case-sensitively, uppercase only** (`getFunctionEntry("sum")` is
 *   `undefined`; only `"SUM"` resolves). This is not a fresh guess: `parser.ts`'s own
 *   `AGGREGATE_FUNCTION_NAMES` (now `RANGE_ACCEPTING_FUNCTION_NAMES`, folded in here) was ALREADY
 *   case-sensitive-uppercase in already-reviewed, shipped code — a case-insensitive registry here
 *   would silently create an inconsistency where `sum(...)` recognises as a function call but
 *   loses its range-placement legality. Matching the existing precedent is the only choice that
 *   does not introduce that inconsistency; it is also the safe, reversible direction (Q-004's own
 *   standing: uppercase-only today, lowercase-acceptance is purely additive later).
 *
 *   **`CONCAT` requires every argument to already be a `string`** — no implicit
 *   number/boolean-to-string coercion. The brief does not specify either way; PROJECT_BRIEF §9's
 *   own tie-breaker order picks strict-typing here: "(4) whatever is simplest to delete later."
 *   Adding coercion later is a pure widening (Q-005/D-020's own "widen, never restructure" stance);
 *   removing coercion after formulas exist that depend on it would not be. Strict is also the
 *   uniform posture every other typed argument here already takes (`NOT`'s boolean, every numeric
 *   function's number) — CONCAT is not a special case.
 *
 * INVARIANTS UPHELD HERE
 *   - No entry here ever throws. Every failure mode — wrong arity (checked by the SEPARATE
 *     `checkArity`, never inside `implementation`), wrong argument type, a missing argument, a
 *     propagated upstream error, a non-finite or `-0` result — returns a typed `ErrorValue`
 *     (§5.1: "errors must never throw across the evaluation loop").
 *   - `implementation` is `(args: readonly Value[]) => Value` for every eager entry — it receives
 *     ALREADY-EVALUATED arguments (§5.3's own words: "table-driven... receives arguments that have
 *     already been evaluated"), never a `FormulaAst`. A `RangeNode` argument (legal only for
 *     `RANGE_ACCEPTING_FUNCTION_NAMES`, enforced by `parser.ts`, not here) is therefore ALREADY
 *     flattened into individual evaluated numbers by the time an implementation here ever sees
 *     it — that flattening is `eval.ts`'s job (not yet built), not this file's.
 *   - A `LazyFunctionEntry` structurally CANNOT carry an `implementation` field (TypeScript's
 *     excess-property check on the discriminated union catches an attempt to add one at this
 *     file's own construction sites) — D-029 enforced by the compiler, not only by convention,
 *     the same stance D-006 already takes for Rule 1.
 *   - `FUNCTION_REGISTRY` is a plain `Record<string, FunctionEntry>` — data, not behaviour beyond
 *     the one pure function per entry (Rule 2/§2: plain, serializable graph state stays clean of
 *     this registry entirely; nothing here is ever stored in a `Document`).
 *
 * NOT DONE HERE
 *   Actually CALLING any of this from a live evaluator — `formula/eval.ts` (checks arity via
 *   `checkArity`, dispatches `LAZY_FUNCTION_NAMES` specially, calls `implementation` for
 *   everything else) does not exist yet and is the next cycle. Nothing in `mutation.ts` or
 *   `graph/eval.ts` is wired to this file this cycle — the same "standalone, heavily unit-tested"
 *   posture every `formula/*` file before this one has taken (PROJECT_BRIEF §6's own words for
 *   this phase).
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
 * EXPORTED (cycle 0036) so `formula/eval.ts`'s own arithmetic operators (`+ - * / % ^` and unary
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
