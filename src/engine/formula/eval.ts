/**
 * eval.ts — FormulaAst -> Value (PROJECT_BRIEF §5.3, stage 4 of 4: the evaluator).
 *
 * IMPLEMENTS: §5.3's "eager total dependency extraction vs. lazy short-circuit evaluation"
 * section, the LAZY half (`deps.ts` already built the eager half, cycle 0033): "`evaluate(ast)` is
 * LAZY and SHORT-CIRCUITS. `IF` evaluates only the taken branch. `AND`/`OR` short-circuit. A
 * runtime error... in an *untaken* branch therefore never occurs and never surfaces." Also
 * upholds **D-029** in full (the rider 0035-REVIEW-phase1's carried constraint 1 flagged as "the
 * one that gets violated by accident"): `IF`/`AND`/`OR` are dispatched at the `FunctionCallNode`
 * site, in BOTH syntactic forms, BEFORE any argument is evaluated and before
 * `functions.ts`'s registry is ever asked for an `implementation` — which for these three does not
 * exist to call. `NOT` is D-029's one eager exception. Also upholds **D-028** (an `ErrorNode`
 * evaluates to its `ErrorValue`, never `#PARSE`) and **D-034** (every registry lookup this file
 * makes goes through `getFunctionEntry`, which already guards with `Object.hasOwn` — this file
 * never indexes `FUNCTION_REGISTRY` directly).
 *
 * As of THIS cycle (the range-evaluation wiring **D-036** named as Phase 2's remaining gap):
 * a `RangeNode` reached as a direct argument of an aggregate call (`SUM`/`MIN`/`MAX`/`AVG` —
 * `formula/parser.ts`'s `validateRangePlacement` guarantees this is the ONLY place one can be)
 * is expanded into its bounded list of cell VALUES via a second injected callback, `readRange`
 * (D-036 constraint 1: "`evaluate` expands the range itself, through its own read callback").
 * `evaluateRangeNode`'s OLD disclosed `#PARSE` placeholder is DELETED as the general answer (D-036
 * constraint 3) and now exists only as the honest fallback for a caller that omits `readRange`
 * (see `ReadRange`'s own doc comment) — the real production caller (`graph/eval.ts`) never omits
 * it.
 * LAYER: engine (pure). May import: engine/* only.
 *        NEVER imports: DOM, window, document, canvas, render/*.
 *
 * This is Phase 1's LAST file and its phase gate (0035-REVIEW-phase1's carried constraint 5,
 * itself a restatement of PROCESS_BRIEF §6.1 trigger 1) — a review point on completion regardless
 * of size. Nothing is batched behind it. THIS cycle's range-evaluation wiring is an ordinary
 * extension of an already-reviewed file, not a new subsystem.
 *
 * WHAT THIS IS
 *   One exported function: `evaluate(ast, read, readRange?)`. `read: (address) => Value | undefined`
 *   is the SAME shape `primitives/schema.ts`'s `DerivedSlotCompute` and `graph/eval.ts`'s own
 *   internal `read` closures already use (D-014-style: one shape for "resolve an address to a
 *   value that already exists," reused rather than reinvented) — it resolves a reference to
 *   whatever value an earlier stage already computed for it. `readRange: (start, end) => Value[] |
 *   ErrorValue` is the range-aggregate analogue, added THIS cycle: it resolves a range's two
 *   endpoints to the ordered list of Values every cell WITHIN THE TABLE'S CURRENT EXTENT currently
 *   holds (D-044's bounding), or an `ErrorValue` if the range itself could not be resolved (its
 *   table no longer exists, or a malformed/cross-object AST — defensive only, D-045 rejects the
 *   reachable case at parse time). This file has NO opinion on how either callback's answer was
 *   produced (a live topological pass, a test fixture, anything) — it only calls them, never
 *   anything else external. `readRange` deliberately does NOT hand this file a `GraphObject` or any
 *   table-dimension access of its own: bounding by current extent must use the EXACT SAME
 *   computation `mutation.ts`'s `deriveEdges` already used to decide which cells this formula
 *   depends on (`primitives/table.ts`'s `enumerateRangeCellAddresses`, D-046's `literal`-only
 *   dimension guard) — this file staying blind to that machinery is what makes it structurally
 *   impossible for evaluation and edge derivation to disagree about which cells a range spans,
 *   rather than merely conventionally so. No `EvalContext`/`TextMeasurer` is threaded through
 *   beyond these two callbacks: nothing else in §5.3's v1 grammar needs an injected service
 *   (`TextMeasurer` is Phase 5's concern, for text's own embedding, not this file's).
 *
 *   `readRange` is OPTIONAL. A caller with no range-enumeration capability wired (most of this
 *   file's own test suite, which exercises everything else) may omit it; any `RangeNode` reached
 *   as a direct aggregate argument then evaluates to the SAME disclosed `#PARSE` this file always
 *   returned for one — `evaluateRangeNode`'s fallback body, unchanged. This is not a silent gap: it
 *   is the documented behaviour for a caller that has not wired range support, and the one
 *   production caller (`graph/eval.ts`) always supplies a real one.
 *
 *   Every `FormulaAst` node is evaluated by structural recursion (`evaluateNode`, one exhaustive
 *   `switch` on `.type`, mirroring `deps.ts`'s own `walk` and `parser.ts`'s
 *   `walkForRangePlacement`):
 *   - `literal` -> its own `value` (already a `number | string | boolean`, a subset of `Value`).
 *   - `reference` -> `read(address)`; `undefined` (address never resolved) becomes `#REF`, the
 *     same choice `graph/eval.ts`'s own `evaluateReference` already makes, for the same reason
 *     (`undefined` is not a member of `Value`, §5.1).
 *   - `range` -> `evaluateRangeNode()`'s disclosed `#PARSE` — reachable ONLY through this generic
 *     recursive path, which means a `RangeNode` sitting somewhere `validateRangePlacement` would
 *     have rejected (anywhere but a direct aggregate argument). A correctly-placed range never
 *     reaches `evaluateNode` at all: `evaluateFunctionCall`'s eager argument loop special-cases
 *     `arg.type === "range"` BEFORE calling `evaluateNode` on it — see below. This defensive arm
 *     therefore only fires for a hand-built or loaded AST that bypasses the parser.
 *   - `error` (D-028) -> `{ error: ast.error, message: ... }`. The node's `error` field is always
 *     the literal `"#REF"` (D-028's own type), so this is never `#PARSE` — an `ErrorNode` is a
 *     legitimate, already-repaired AST position, not a parse failure.
 *   - `binaryOp` -> `evaluateBinaryOp`, split three ways by operator: `AND`/`OR` (lazy,
 *     short-circuit — see below), the six comparisons (eager, same-type only), and the six
 *     arithmetic operators (eager, numeric, routed through `functions.ts`'s exported
 *     `finiteResult` — D-033's shared guard, reused rather than re-derived, per that ruling's own
 *     binding text).
 *   - `unaryOp` -> `-` (eager numeric negation, same `finiteResult` guard) or `NOT` (delegates to
 *     `functions.ts`'s own `NOT` registry entry via `evaluateNot` — see below).
 *   - `functionCall` -> `evaluateFunctionCall`, the heart of D-029's dispatch (see next section) AND
 *     of this cycle's range expansion (see below).
 *
 *   **`evaluateFunctionCall` — the ONE place D-029 could be violated by accident, and now also the
 *   ONE place a `RangeNode` is legally expanded.** Order, exactly:
 *   1. `getFunctionEntry(name)` (D-034-safe lookup). `undefined` -> `#TYPE`, "unknown function" —
 *      never a crash, per 0035-REVIEW's carried constraint 2.
 *   2. `checkArity(entry.name, entry.arity, node.args.length)` — BEFORE evaluating anything,
 *      per that same constraint, and against the AST-LEVEL argument count (`SUM(A1:B4)` has
 *      exactly one argument node, whatever it flattens to) — a mismatch is `#TYPE`, naming both
 *      counts (`checkArity`'s own message).
 *   3. **`entry.evaluationMode === "lazy"` is checked NEXT, before a single argument is
 *      evaluated and before `entry.implementation` is so much as considered** (it does not exist
 *      for a `LazyFunctionEntry` — TypeScript enforces this at `functions.ts`'s OWN construction
 *      sites, D-029/D-034; this file additionally never reaches for it because the lazy branch
 *      returns first). `IF`/`AND`/`OR` are hard-dispatched by name here to
 *      `evaluateIf`/`evaluateAndOperands`/`evaluateOrOperands` — the ONLY three places in this
 *      file that decide which of a `FunctionCallNode`'s `args` gets evaluated AT ALL. A `default`
 *      arm exists only as a defensive, never-throwing guard against `LAZY_FUNCTION_NAMES` drifting
 *      out of sync with this dispatch (pinned by a test in this file AND in `functions.test.ts`).
 *      None of `IF`/`AND`/`OR` accepts a range argument (`functions.ts`'s registry never sets
 *      `acceptsRangeArgument` for them, and `parser.ts`'s `RANGE_ACCEPTING_FUNCTION_NAMES` agrees),
 *      so this branch never needs `readRange`.
 *   4. Only past that gate: every argument is evaluated EAGERLY, left to right, STOPPING at the
 *      first `ErrorValue` (§5.1: "errors propagate" — matches `functions.ts`'s own left-to-right
 *      propagation convention, applied one layer earlier so a later argument that would itself
 *      error is never even evaluated). **A `range`-typed argument is special-cased here, before
 *      `evaluateNode` is ever called on it**: `readRange(arg.start, arg.end)` resolves it to the
 *      ordered `Value[]` every cell within the table's current extent holds (or an `ErrorValue`,
 *      propagated immediately, same as any other argument's error); every value in that list is
 *      then pushed onto the SAME flattened `argValues` list an ordinary scalar argument would land
 *      in — so `SUM(A1, B1:B3, 10)` and `SUM(A1, B1, B2, B3, 10)` reach `functions.ts`'s
 *      `implementation` as the identical five-element list, which is the whole point of "expand to
 *      concrete slot dependencies," applied here to VALUES rather than edges. A cell's own value
 *      being an `ErrorValue` propagates the SAME way a scalar argument's would — first one found,
 *      left to right within the range, stops the whole call. The finished `Value[]` is handed to
 *      `entry.implementation` once.
 *
 *   **`AND`/`OR`'s laziness is ONE shared implementation over an operand ARRAY**
 *   (`evaluateAndOperands`/`evaluateOrOperands`), not two — the infix form (`a AND b`, a
 *   `BinaryOpNode`) calls it with `[node.left, node.right]`; the call form (`AND(a, b, c, ...)`, a
 *   `FunctionCallNode`, D-035's `AT_LEAST(1)`) calls it with `node.args` directly. Binary is simply
 *   the N=2 case of the same walk: evaluate operands left to right, stop and return the
 *   short-circuiting value the MOMENT it is determined (`false` for `AND`, `true` for `OR`) —
 *   every operand after that point is never evaluated, never even visited, which is what makes
 *   §5.3's "an error in an untaken branch never surfaces" literally true rather than merely
 *   intended. `IF` has no infix form (§5.3 gives it none), so `evaluateIf` is reached only from
 *   the call-form dispatch, and evaluates ONLY `args[1]` (true branch) or `args[2]` (false
 *   branch) — never both, never the untaken one.
 *
 *   **`NOT` is delegated to `functions.ts`'s own registry entry**, never reimplemented here —
 *   D-029's one eager exception needs no laziness, and duplicating its type-check-and-negate logic
 *   in two files would be exactly the kind of parallel copy this project's own "declare once"
 *   principle (D-009/D-014) exists to prevent. The two syntactic forms reach that ONE registry
 *   entry by two different routes, and it is worth being precise about which (corrected at
 *   0037-REVIEW-phase1, where the original wording claimed a shared helper that does not exist):
 *   the prefix `UnaryOpNode` form goes through `evaluateNot`, while the call `FunctionCallNode`
 *   form is an ordinary eager entry and goes through `evaluateFunctionCall`'s eager path like
 *   `SUM` or `ABS`. Both end at `functions.ts`'s `NOT` implementation with one evaluated operand,
 *   so the two forms agree by construction — pinned by a test asserting exactly that.
 *
 * INVARIANTS UPHELD HERE
 *   - `evaluate` NEVER throws. Every failure mode — an unresolved reference, a wrong-typed
 *     operand, an unknown or mis-called function, a range that failed to resolve, division
 *     or modulo by zero, a non-finite arithmetic result — returns a typed `ErrorValue`,
 *     matching `deps.ts`/`parser.ts`/`lexer.ts`/`functions.ts`'s own "never throw" discipline
 *     (§5.1).
 *   - Argument evaluation for an ordinary (eager) call is left-to-right and stops at the first
 *     error — deterministic, and it never evaluates an argument past one that already failed. A
 *     range argument's own cells are walked in the SAME left-to-right, stop-at-first-error order.
 *   - `AND`/`OR`/`IF` never evaluate more of their operands/branches than §5.3 requires — pinned
 *     directly by tests using a "poison" operand (one that would itself error if ever evaluated)
 *     in the untaken position.
 *   - Every arithmetic result (binary `+ - * / % ^`, unary `-`) is routed through `functions.ts`'s
 *     EXPORTED `finiteResult` — the SAME D-033 guard `functions.ts`'s own registry entries use, not
 *     a second copy. `-0` normalises to `+0`; a genuinely non-finite result is `#TYPE`.
 *   - Comparisons (`= <> < > <= >=`) require BOTH operands to already be the SAME primitive type
 *     (`number`, `string`, or `boolean`); a cross-type comparison is `#TYPE`. This is a disclosed
 *     decision, not a brief requirement — see `evaluateComparison`'s own comment.
 *   - A range never appears anywhere this file's own logic could confuse it with a scalar
 *     `Value`: it is flattened into `argValues` at exactly one point (`evaluateFunctionCall`'s
 *     eager loop) and nowhere else recurses into a `RangeNode` expecting one Value back.
 *
 * NOT DONE HERE
 *   Any change to `deps.ts` — dependency extraction and evaluation are DIFFERENT walks over the
 *   same AST shape and this file does not reuse or alter the other (0035-REVIEW's carried
 *   constraint 3). Building the REAL `readRange` (bounding by current extent, reading dimensions
 *   `literal`-only per D-046) — that lives in `primitives/table.ts`'s
 *   `enumerateRangeCellAddresses` and is wired in by `graph/eval.ts`, which is the one place with
 *   both the object list and the already-evaluated-values map this file is deliberately never
 *   handed.
 */
import type { Address } from "../address.ts";
import type { BinaryOpNode, FormulaAst, FunctionCallNode, UnaryOpNode } from "./ast.ts";
import { checkArity, finiteResult, getFunctionEntry } from "./functions.ts";
import { isErrorValue, type ErrorValue, type Value } from "../graph/node.ts";

/** Resolves an already-resolved `Address` to the `Value` an earlier stage computed for it, or
 * `undefined` if it never resolved. Same shape as `primitives/schema.ts`'s `DerivedSlotCompute`'s
 * `read` parameter — see the file header. */
export type ReadSlot = (address: Address) => Value | undefined;

/**
 * Resolves a range's two endpoints to the ordered list of Values every cell WITHIN THE TABLE'S
 * CURRENT EXTENT currently holds (D-044's bounding — a cell beyond the extent is simply omitted
 * from the list, never reported), or an `ErrorValue` if the range itself could not be resolved
 * at all (its table no longer exists; a malformed or cross-object endpoint pair — defensive only,
 * D-045 rejects the reachable case at parse time). See the file header's WHAT THIS IS for why this
 * file is deliberately given no other way to reach a table's dimensions. Optional on `evaluate` —
 * see the file header for the documented fallback when it is omitted.
 */
export type ReadRange = (start: Address, end: Address) => readonly Value[] | ErrorValue;

/** Narrows `ReadRange`'s result to its error arm. `isErrorValue` itself can't
 * (its parameter is `Value`, and `readonly Value[]` is not a member of that
 * union — `Value`'s own array arm is `readonly Point[]`) — same minimal
 * workaround `primitives/table.ts`'s `isRangeEnumerationError` and
 * `functions.ts`'s `isNumberListError` already use for an identical shape. */
function isRangeReadError(result: readonly Value[] | ErrorValue): result is ErrorValue {
  return !Array.isArray(result);
}

type ComparisonOperator = "=" | "<>" | "<" | ">" | "<=" | ">=";
type ArithmeticOperator = "+" | "-" | "*" | "/" | "%" | "^";

/** Explicit type predicates, not a `Set<string>.has` check: a `Set` lookup does not narrow
 * `node.operator`'s literal-union type the way this project's other multi-branch dispatches
 * already work around (`parser.ts`'s `isLexError`, `functions.ts`'s `isNumericError`) — same
 * minimal workaround, applied here. */
function isComparisonOperator(operator: BinaryOpNode["operator"]): operator is ComparisonOperator {
  return operator === "=" || operator === "<>" || operator === "<" || operator === ">" || operator === "<=" || operator === ">=";
}

function isArithmeticOperator(operator: BinaryOpNode["operator"]): operator is ArithmeticOperator {
  return operator === "+" || operator === "-" || operator === "*" || operator === "/" || operator === "%" || operator === "^";
}

/**
 * Evaluates `ast` to a single `Value`, lazily and with short-circuiting where §5.3 requires it.
 * Never throws — see the file header's INVARIANTS UPHELD HERE. `readRange` is optional — see the
 * file header's WHAT THIS IS for the documented fallback when it is omitted.
 */
export function evaluate(ast: FormulaAst, read: ReadSlot, readRange?: ReadRange): Value {
  return evaluateNode(ast, read, readRange);
}

function evaluateNode(ast: FormulaAst, read: ReadSlot, readRange: ReadRange | undefined): Value {
  switch (ast.type) {
    case "literal":
      return ast.value;
    case "reference":
      return evaluateReference(ast.address, read);
    case "range":
      // Reachable only via a hand-built or loaded AST that bypasses the
      // parser's placement check — see the file header. A correctly-placed
      // range is expanded by evaluateFunctionCall directly, before this
      // function is ever called on it.
      return evaluateRangeNode();
    case "error":
      // D-028: an ErrorNode is a legitimate, already-repaired AST position. Its own `error` field
      // is always the literal "#REF" — this is never `#PARSE`.
      return { error: ast.error, message: "this reference was invalidated by a repair pass (#REF)" };
    case "binaryOp":
      return evaluateBinaryOp(ast, read, readRange);
    case "unaryOp":
      return evaluateUnaryOp(ast, read, readRange);
    case "functionCall":
      return evaluateFunctionCall(ast, read, readRange);
    default: {
      // Compile-time exhaustiveness, WITHOUT a throw — same defensive stance `parser.ts`'s
      // `walkForRangePlacement` and `deps.ts`'s `walk` already take against a hand-edited or
      // loaded AST reaching a shape the compiler believes impossible.
      const exhaustive: never = ast;
      return { error: "#PARSE", message: `unrecognised formula AST node: ${JSON.stringify(exhaustive)}` };
    }
  }
}

function evaluateReference(address: Address, read: ReadSlot): Value {
  const value = read(address);
  if (value === undefined) {
    return { error: "#REF", message: "formula reference did not resolve to a value" };
  }
  return value;
}

/**
 * The disclosed fallback for a `RangeNode` reached with no `readRange` wired, OR (defensively)
 * reached anywhere `validateRangePlacement` would have rejected. See the file header's WHAT THIS
 * IS for both cases.
 */
function evaluateRangeNode(): Value {
  return {
    error: "#PARSE",
    message: "range evaluation is not wired in for this caller — no readRange callback was supplied",
  };
}

function evaluateBinaryOp(node: BinaryOpNode, read: ReadSlot, readRange: ReadRange | undefined): Value {
  if (node.operator === "AND") {
    return evaluateAndOperands([node.left, node.right], read, readRange);
  }
  if (node.operator === "OR") {
    return evaluateOrOperands([node.left, node.right], read, readRange);
  }
  if (isComparisonOperator(node.operator)) {
    return evaluateComparison(node.operator, node.left, node.right, read, readRange);
  }
  if (isArithmeticOperator(node.operator)) {
    return evaluateArithmetic(node.operator, node.left, node.right, read, readRange);
  }
  // Defensive: BinaryOperator (ast.ts) has exactly 14 members, all handled above (2 + 6 + 6).
  // Unreachable while that stays true; never throws if it ever drifts.
  return { error: "#PARSE", message: `unrecognised binary operator: ${JSON.stringify(node.operator)}` };
}

function evaluateUnaryOp(node: UnaryOpNode, read: ReadSlot, readRange: ReadRange | undefined): Value {
  if (node.operator === "NOT") {
    return evaluateNot([node.operand], read, readRange);
  }
  // node.operator === "-" — UnaryOperator (ast.ts) has exactly these two members.
  const operandValue = evaluateNode(node.operand, read, readRange);
  if (isErrorValue(operandValue)) {
    return operandValue;
  }
  if (typeof operandValue !== "number") {
    return { error: "#TYPE", message: `unary "-": operand must be a number, got ${describeValueType(operandValue)}` };
  }
  return finiteResult("-", -operandValue);
}

/**
 * `=`/`<>`/`<`/`>`/`<=`/`>=` — eager (comparisons are not lazy; only `IF`/`AND`/`OR` are, D-029).
 *
 * **Both operands must already be the SAME primitive type** (`number`, `string`, or `boolean`); a
 * cross-type comparison is `#TYPE`. This is a disclosed decision, not stated by §5.3: the brief
 * lists the six comparison operators without defining cross-type semantics. Strict, same-type-only
 * is this file's uniform posture (matches `functions.ts`'s own `CONCAT` decision and every typed
 * argument elsewhere in `formula/*`) and is the additively-widenable direction — a future cross-type
 * ordering (Excel defines one) can be added later without invalidating any formula this build
 * already accepts, since every one already requires same-type operands.
 */
function evaluateComparison(
  operator: ComparisonOperator,
  left: FormulaAst,
  right: FormulaAst,
  read: ReadSlot,
  readRange: ReadRange | undefined,
): Value {
  const leftValue = evaluateNode(left, read, readRange);
  if (isErrorValue(leftValue)) {
    return leftValue;
  }
  const rightValue = evaluateNode(right, read, readRange);
  if (isErrorValue(rightValue)) {
    return rightValue;
  }
  if (typeof leftValue === "number" && typeof rightValue === "number") {
    return compareOrdered(operator, leftValue, rightValue);
  }
  if (typeof leftValue === "string" && typeof rightValue === "string") {
    return compareOrdered(operator, leftValue, rightValue);
  }
  if (typeof leftValue === "boolean" && typeof rightValue === "boolean") {
    return compareOrdered(operator, leftValue, rightValue);
  }
  return {
    error: "#TYPE",
    message: `cannot compare ${describeValueType(leftValue)} to ${describeValueType(rightValue)}`,
  };
}

function compareOrdered<T extends number | string | boolean>(
  operator: ComparisonOperator,
  left: T,
  right: T,
): boolean {
  switch (operator) {
    case "=":
      return left === right;
    case "<>":
      return left !== right;
    case "<":
      return left < right;
    case ">":
      return left > right;
    case "<=":
      return left <= right;
    case ">=":
      return left >= right;
  }
}

/**
 * `+ - * / % ^` — eager, numeric-only, left operand checked before right (deterministic, matches
 * `functions.ts`'s own "check a first" convention). `/` and `%` by zero are `#DIV0` (§5.1's own
 * `ErrorCode`), checked before the JS operator would produce `Infinity`/`NaN` itself — a
 * `#DIV0` is more specific and more useful to a user than the `#TYPE` `finiteResult` would
 * otherwise report for the same non-finite `Infinity`/`NaN` result. Every other result routes
 * through `finiteResult` (D-033): `-0` normalises to `+0`, a genuinely non-finite result is
 * `#TYPE`.
 *
 * `%` takes the DIVISOR's sign (Excel's `MOD`), not JavaScript's remainder — see the operator's
 * own comment below and D-037.
 */
function evaluateArithmetic(
  operator: ArithmeticOperator,
  left: FormulaAst,
  right: FormulaAst,
  read: ReadSlot,
  readRange: ReadRange | undefined,
): Value {
  const leftValue = evaluateNode(left, read, readRange);
  if (isErrorValue(leftValue)) {
    return leftValue;
  }
  if (typeof leftValue !== "number") {
    return { error: "#TYPE", message: `"${operator}": left operand must be a number, got ${describeValueType(leftValue)}` };
  }
  const rightValue = evaluateNode(right, read, readRange);
  if (isErrorValue(rightValue)) {
    return rightValue;
  }
  if (typeof rightValue !== "number") {
    return { error: "#TYPE", message: `"${operator}": right operand must be a number, got ${describeValueType(rightValue)}` };
  }
  switch (operator) {
    case "+":
      return finiteResult("+", leftValue + rightValue);
    case "-":
      return finiteResult("-", leftValue - rightValue);
    case "*":
      return finiteResult("*", leftValue * rightValue);
    case "/":
      if (rightValue === 0) {
        return { error: "#DIV0", message: "division by zero" };
      }
      return finiteResult("/", leftValue / rightValue);
    case "%":
      if (rightValue === 0) {
        return { error: "#DIV0", message: "modulo by zero" };
      }
      // D-037: the RESULT TAKES THE DIVISOR'S SIGN (Excel's `MOD`), not JavaScript's `%`, whose
      // remainder takes the dividend's: `-5 % 3` is `1` here, where the bare JS operator gives
      // `-2`. D-030's standing tie-breaker — a formula-language gap §5.3 leaves open is settled by
      // Excel — and the useful behaviour for the wrapping cases a canvas actually has (an angle,
      // a grid index, a colour cycle). `((l % r) + r) % r` is the floored modulo, exactly Excel's
      // `MOD` including a negative divisor (`5 % -3` is `-1`).
      return finiteResult("%", ((leftValue % rightValue) + rightValue) % rightValue);
    case "^":
      return finiteResult("^", Math.pow(leftValue, rightValue));
  }
}

/**
 * `AND` — lazy over an operand ARRAY (the file header explains why one shared function serves
 * both the infix `BinaryOpNode` form, called with `[left, right]`, and the N-ary call form). Left
 * to right: the first operand that evaluates to `false` short-circuits the WHOLE result to
 * `false` — every operand after it is never evaluated. The first error (from evaluation or a
 * non-boolean operand) short-circuits too. Only if every operand evaluates to `true` does this
 * return `true`. A vacuous, defensive `true` for zero operands (D-035's own `AT_LEAST(1)` means a
 * real call never reaches this with none, but this function never crashes either way).
 */
function evaluateAndOperands(operands: readonly FormulaAst[], read: ReadSlot, readRange: ReadRange | undefined): Value {
  for (const operand of operands) {
    const value = evaluateNode(operand, read, readRange);
    if (isErrorValue(value)) {
      return value;
    }
    if (typeof value !== "boolean") {
      return { error: "#TYPE", message: `AND: operand must be a boolean, got ${describeValueType(value)}` };
    }
    if (value === false) {
      return false;
    }
  }
  return true;
}

/** `OR` — the exact mirror of `evaluateAndOperands`: the first `true` short-circuits to `true`; only if every operand is `false` does this return `false`. */
function evaluateOrOperands(operands: readonly FormulaAst[], read: ReadSlot, readRange: ReadRange | undefined): Value {
  for (const operand of operands) {
    const value = evaluateNode(operand, read, readRange);
    if (isErrorValue(value)) {
      return value;
    }
    if (typeof value !== "boolean") {
      return { error: "#TYPE", message: `OR: operand must be a boolean, got ${describeValueType(value)}` };
    }
    if (value === true) {
      return true;
    }
  }
  return false;
}

/**
 * `IF` — reachable only via the call form (§5.3 gives it no infix production). Evaluates the
 * condition eagerly (there is no "untaken" condition to protect), then evaluates ONLY the taken
 * branch — `args[1]` if the condition is `true`, `args[2]` if `false` — never both, and never the
 * untaken one. `args` is assumed to already have length 3 (`evaluateFunctionCall` checks arity via
 * D-035's `EXACTLY(3)` before this is ever called); the `undefined` arms below exist only as a
 * defensive, never-crashing fallback if that invariant is ever violated by a future caller.
 */
function evaluateIf(args: readonly FormulaAst[], read: ReadSlot, readRange: ReadRange | undefined): Value {
  const condition = args[0];
  if (condition === undefined) {
    return { error: "#TYPE", message: "IF: missing condition" };
  }
  const conditionValue = evaluateNode(condition, read, readRange);
  if (isErrorValue(conditionValue)) {
    return conditionValue;
  }
  if (typeof conditionValue !== "boolean") {
    return { error: "#TYPE", message: `IF: condition must be a boolean, got ${describeValueType(conditionValue)}` };
  }
  const branch = conditionValue ? args[1] : args[2];
  if (branch === undefined) {
    return { error: "#TYPE", message: `IF: missing ${conditionValue ? "true" : "false"} branch` };
  }
  return evaluateNode(branch, read, readRange);
}

/**
 * `NOT` — D-029's one eager exception. Evaluates its one operand, then delegates the
 * type-check-and-negate logic to `functions.ts`'s OWN `NOT` registry entry rather than
 * reimplementing it here (D-009/D-014's "declare once" principle).
 *
 * Reached ONLY from `evaluateUnaryOp` (the prefix `NOT x` form). The call form `NOT(x)` is an
 * ordinary `EagerFunctionEntry` and takes `evaluateFunctionCall`'s eager path instead, ending at
 * the same registry implementation — which is why the two forms agree. (Corrected at
 * 0037-REVIEW-phase1: this comment previously claimed both forms route through here.)
 */
function evaluateNot(args: readonly FormulaAst[], read: ReadSlot, readRange: ReadRange | undefined): Value {
  const operand = args[0];
  if (operand === undefined) {
    return { error: "#TYPE", message: "NOT: missing argument 1" };
  }
  const operandValue = evaluateNode(operand, read, readRange);
  const entry = getFunctionEntry("NOT");
  if (entry === undefined || entry.evaluationMode !== "eager") {
    // Defensive: NOT is always a registered eager entry (functions.ts). Unreachable in practice;
    // never throws if it ever drifts.
    return { error: "#TYPE", message: 'NOT: registry entry is missing or not eager (internal error)' };
  }
  return entry.implementation([operandValue]);
}

/**
 * `FunctionCallNode` evaluation — the ONE place D-029 could be violated by accident, and the ONE
 * place a `RangeNode` argument is legally expanded (D-036). See the file header's WHAT THIS IS for
 * the exact, ordered rationale; this function's structure IS that order.
 */
function evaluateFunctionCall(node: FunctionCallNode, read: ReadSlot, readRange: ReadRange | undefined): Value {
  const entry = getFunctionEntry(node.name);
  if (entry === undefined) {
    return { error: "#TYPE", message: `unknown function "${node.name}"` };
  }

  const arityCheck = checkArity(entry.name, entry.arity, node.args.length);
  if (!arityCheck.ok) {
    return { error: "#TYPE", message: arityCheck.message };
  }

  // D-029 / 0035-REVIEW's carried constraint 1: dispatched HERE, before any argument is
  // evaluated and before `entry.implementation` is so much as considered — it does not exist for
  // a LazyFunctionEntry (functions.ts, TypeScript-enforced). None of IF/AND/OR accepts a range
  // argument, so this branch never touches readRange.
  if (entry.evaluationMode === "lazy") {
    switch (node.name) {
      case "IF":
        return evaluateIf(node.args, read, readRange);
      case "AND":
        return evaluateAndOperands(node.args, read, readRange);
      case "OR":
        return evaluateOrOperands(node.args, read, readRange);
      default:
        // Defensive: unreachable while LAZY_FUNCTION_NAMES is exactly {IF, AND, OR} — pinned by
        // a test in this file and in functions.test.ts. Never throws if that ever drifts.
        return {
          error: "#TYPE",
          message: `"${node.name}" is registered lazy but has no evaluator wired in formula/eval.ts (internal error)`,
        };
    }
  }

  // Eager path: evaluate every argument, left to right, stopping at the first error. A
  // `range`-typed argument is expanded here — D-036 — into every value it spans (bounded to the
  // table's current extent, D-044) rather than evaluated to one Value via evaluateNode; see the
  // file header's WHAT THIS IS for the full rationale.
  const argValues: Value[] = [];
  for (const arg of node.args) {
    if (arg.type === "range") {
      if (readRange === undefined) {
        return evaluateRangeNode();
      }
      const rangeValues = readRange(arg.start, arg.end);
      if (isRangeReadError(rangeValues)) {
        return rangeValues;
      }
      let firstRangeError: Value | undefined;
      for (const cellValue of rangeValues) {
        if (isErrorValue(cellValue)) {
          firstRangeError = cellValue;
          break;
        }
        argValues.push(cellValue);
      }
      if (firstRangeError !== undefined) {
        return firstRangeError;
      }
      continue;
    }
    const value = evaluateNode(arg, read, readRange);
    if (isErrorValue(value)) {
      return value;
    }
    argValues.push(value);
  }
  return entry.implementation(argValues);
}

/** Same small, defensive value-describer `functions.ts` keeps privately — duplicated rather than
 * imported because it is not part of that file's exported surface and this file's own error
 * messages are a distinct concern from that file's argument-checking ones. Not a `Value`
 * predicate (D-014 governs those); this is user-facing text formatting only. */
function describeValueType(value: Value): string {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "a point array";
  }
  if (typeof value === "object") {
    return "a point"; // isErrorValue already handled ErrorValue before this ever runs.
  }
  return typeof value;
}
