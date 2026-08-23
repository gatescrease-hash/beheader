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
 * LAYER: engine (pure). May import: engine/* only.
 *        NEVER imports: DOM, window, document, canvas, render/*.
 *
 * This is Phase 1's LAST file and its phase gate (0035-REVIEW-phase1's carried constraint 5,
 * itself a restatement of PROCESS_BRIEF §6.1 trigger 1) — a review point on completion regardless
 * of size. Nothing is batched behind it.
 *
 * WHAT THIS IS
 *   One exported function: `evaluate(ast, read)`. `read: (address) => Value | undefined` is the
 *   SAME shape `primitives/schema.ts`'s `DerivedSlotCompute` and `graph/eval.ts`'s own internal
 *   `read` closures already use (D-014-style: one shape for "resolve an address to a value that
 *   already exists," reused rather than reinvented) — it resolves a reference to whatever value an
 *   earlier stage already computed for it. This file has NO opinion on where that value comes from
 *   (a live topological pass, a test fixture, anything) — it only calls `read`, never anything
 *   else external. No `EvalContext`/`TextMeasurer` is threaded through: nothing in §5.3's v1
 *   grammar needs an injected service beyond `read` (`TextMeasurer` is Phase 5's concern, for
 *   text's own embedding, not this file's).
 *
 *   Every `FormulaAst` node is evaluated by structural recursion (`evaluateNode`, one exhaustive
 *   `switch` on `.type`, mirroring `deps.ts`'s own `walk` and `parser.ts`'s
 *   `walkForRangePlacement`):
 *   - `literal` -> its own `value` (already a `number | string | boolean`, a subset of `Value`).
 *   - `reference` -> `read(address)`; `undefined` (address never resolved) becomes `#REF`, the
 *     same choice `graph/eval.ts`'s own `evaluateReference` already makes, for the same reason
 *     (`undefined` is not a member of `Value`, §5.1).
 *   - `range` -> a disclosed, TEMPORARY `#PARSE` (see `evaluateRangeNode`'s own comment) — a
 *     `RangeNode` is reachable ONLY as a direct argument of an aggregate call
 *     (`parser.ts`'s `validateRangePlacement` guarantees this structurally; nothing else in the
 *     grammar can produce one elsewhere), and expanding it into the individual cell values it
 *     spans needs the target table's actual current structure — 0035-REVIEW-phase1's carried
 *     constraint 4, verbatim: "Phase 2's wiring, not `eval.ts`'s." The SAME cycle that does that
 *     wiring also owns 0035-REVIEW's Finding 4 (`MIN`/`MAX`'s `Math.min(...)` spread throwing on a
 *     very large list), because that is the cycle that makes an aggregate's argument list
 *     arbitrarily long. This mirrors `graph/eval.ts`'s OWN established precedent for a temporary,
 *     not-yet-supported AST shape (`evaluateFormula`'s `#PARSE` branch, deleted only when Phase 2
 *     wires in this very file) — same vocabulary, same disclosure posture, not a new invention.
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
 *   - `functionCall` -> `evaluateFunctionCall`, the heart of D-029's dispatch (see next section).
 *
 *   **`evaluateFunctionCall` — the ONE place D-029 could be violated by accident, and the ONE
 *   function in this file every future reader should re-check first.** Order, exactly:
 *   1. `getFunctionEntry(name)` (D-034-safe lookup). `undefined` -> `#TYPE`, "unknown function" —
 *      never a crash, per 0035-REVIEW's carried constraint 2.
 *   2. `checkArity(entry.name, entry.arity, node.args.length)` — BEFORE evaluating anything,
 *      per that same constraint. A mismatch is `#TYPE`, naming both counts (`checkArity`'s own
 *      message).
 *   3. **`entry.evaluationMode === "lazy"` is checked NEXT, before a single argument is
 *      evaluated and before `entry.implementation` is so much as considered** (it does not exist
 *      for a `LazyFunctionEntry` — TypeScript enforces this at `functions.ts`'s OWN construction
 *      sites, D-029/D-034; this file additionally never reaches for it because the lazy branch
 *      returns first). `IF`/`AND`/`OR` are hard-dispatched by name here to
 *      `evaluateIf`/`evaluateAndOperands`/`evaluateOrOperands` — the ONLY three places in this
 *      file that decide which of a `FunctionCallNode`'s `args` gets evaluated AT ALL. A `default`
 *      arm exists only as a defensive, never-throwing guard against `LAZY_FUNCTION_NAMES` drifting
 *      out of sync with this dispatch (pinned by a test in this file AND in `functions.test.ts`).
 *   4. Only past that gate: every argument is evaluated EAGERLY, left to right, STOPPING at the
 *      first `ErrorValue` (§5.1: "errors propagate" — matches `functions.ts`'s own left-to-right
 *      propagation convention, applied one layer earlier so a later argument that would itself
 *      error is never even evaluated). The finished `Value[]` is handed to
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
 *     operand, an unknown or mis-called function, a range this build cannot expand yet, division
 *     or modulo by zero, a non-finite arithmetic result — returns a typed `ErrorValue`, matching
 *     `deps.ts`/`parser.ts`/`lexer.ts`/`functions.ts`'s own "never throw" discipline (§5.1).
 *   - Argument evaluation for an ordinary (eager) call is left-to-right and stops at the first
 *     error — deterministic, and it never evaluates an argument past one that already failed.
 *   - `AND`/`OR`/`IF` never evaluate more of their operands/branches than §5.3 requires — pinned
 *     directly by tests using a "poison" operand (one that would itself error if ever evaluated)
 *     in the untaken position.
 *   - Every arithmetic result (binary `+ - * / % ^`, unary `-`) is routed through `functions.ts`'s
 *     EXPORTED `finiteResult` — the SAME D-033 guard `functions.ts`'s own registry entries use, not
 *     a second copy. `-0` normalises to `+0`; a genuinely non-finite result is `#TYPE`.
 *   - Comparisons (`= <> < > <= >=`) require BOTH operands to already be the SAME primitive type
 *     (`number`, `string`, or `boolean`); a cross-type comparison is `#TYPE`. This is a disclosed
 *     decision, not a brief requirement — see `evaluateComparison`'s own comment.
 *
 * NOT DONE HERE
 *   Wiring this into `graph/eval.ts` (which still runs its own narrow, temporary
 *   `evaluateFormula` — a `ReferenceNode`-only bridge, per that file's own header) or
 *   `mutation.ts`. Range expansion (see `evaluateRangeNode`'s own comment). Any change to
 *   `deps.ts` — dependency extraction and evaluation are DIFFERENT walks over the same AST shape
 *   and this file does not reuse or alter the other (0035-REVIEW's carried constraint 3).
 */
import type { Address } from "../address.ts";
import type { BinaryOpNode, FormulaAst, FunctionCallNode, UnaryOpNode } from "./ast.ts";
import { checkArity, finiteResult, getFunctionEntry } from "./functions.ts";
import { isErrorValue, type Value } from "../graph/node.ts";

/** Resolves an already-resolved `Address` to the `Value` an earlier stage computed for it, or
 * `undefined` if it never resolved. Same shape as `primitives/schema.ts`'s `DerivedSlotCompute`'s
 * `read` parameter — see the file header. */
export type ReadSlot = (address: Address) => Value | undefined;

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
 * Never throws — see the file header's INVARIANTS UPHELD HERE.
 */
export function evaluate(ast: FormulaAst, read: ReadSlot): Value {
  return evaluateNode(ast, read);
}

function evaluateNode(ast: FormulaAst, read: ReadSlot): Value {
  switch (ast.type) {
    case "literal":
      return ast.value;
    case "reference":
      return evaluateReference(ast.address, read);
    case "range":
      return evaluateRangeNode();
    case "error":
      // D-028: an ErrorNode is a legitimate, already-repaired AST position. Its own `error` field
      // is always the literal "#REF" — this is never `#PARSE`.
      return { error: ast.error, message: "this reference was invalidated by a repair pass (#REF)" };
    case "binaryOp":
      return evaluateBinaryOp(ast, read);
    case "unaryOp":
      return evaluateUnaryOp(ast, read);
    case "functionCall":
      return evaluateFunctionCall(ast, read);
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
 * A `RangeNode` is reachable ONLY as a direct argument of an aggregate call — see the file
 * header's WHAT THIS IS for the full rationale (0035-REVIEW-phase1's carried constraint 4: range
 * expansion is Phase 2's wiring, not this file's). TEMPORARY, same posture as `graph/eval.ts`'s
 * own `evaluateFormula` `#PARSE` bridge: deleted, not extended, the moment a later cycle wires in
 * real range expansion.
 */
function evaluateRangeNode(): Value {
  return {
    error: "#PARSE",
    message: "range evaluation is not implemented in this build — SUM/MIN/MAX/AVG over a range need a later cycle's table-aware expansion",
  };
}

function evaluateBinaryOp(node: BinaryOpNode, read: ReadSlot): Value {
  if (node.operator === "AND") {
    return evaluateAndOperands([node.left, node.right], read);
  }
  if (node.operator === "OR") {
    return evaluateOrOperands([node.left, node.right], read);
  }
  if (isComparisonOperator(node.operator)) {
    return evaluateComparison(node.operator, node.left, node.right, read);
  }
  if (isArithmeticOperator(node.operator)) {
    return evaluateArithmetic(node.operator, node.left, node.right, read);
  }
  // Defensive: BinaryOperator (ast.ts) has exactly 14 members, all handled above (2 + 6 + 6).
  // Unreachable while that stays true; never throws if it ever drifts.
  return { error: "#PARSE", message: `unrecognised binary operator: ${JSON.stringify(node.operator)}` };
}

function evaluateUnaryOp(node: UnaryOpNode, read: ReadSlot): Value {
  if (node.operator === "NOT") {
    return evaluateNot([node.operand], read);
  }
  // node.operator === "-" — UnaryOperator (ast.ts) has exactly these two members.
  const operandValue = evaluateNode(node.operand, read);
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
): Value {
  const leftValue = evaluateNode(left, read);
  if (isErrorValue(leftValue)) {
    return leftValue;
  }
  const rightValue = evaluateNode(right, read);
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
): Value {
  const leftValue = evaluateNode(left, read);
  if (isErrorValue(leftValue)) {
    return leftValue;
  }
  if (typeof leftValue !== "number") {
    return { error: "#TYPE", message: `"${operator}": left operand must be a number, got ${describeValueType(leftValue)}` };
  }
  const rightValue = evaluateNode(right, read);
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
function evaluateAndOperands(operands: readonly FormulaAst[], read: ReadSlot): Value {
  for (const operand of operands) {
    const value = evaluateNode(operand, read);
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
function evaluateOrOperands(operands: readonly FormulaAst[], read: ReadSlot): Value {
  for (const operand of operands) {
    const value = evaluateNode(operand, read);
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
function evaluateIf(args: readonly FormulaAst[], read: ReadSlot): Value {
  const condition = args[0];
  if (condition === undefined) {
    return { error: "#TYPE", message: "IF: missing condition" };
  }
  const conditionValue = evaluateNode(condition, read);
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
  return evaluateNode(branch, read);
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
function evaluateNot(args: readonly FormulaAst[], read: ReadSlot): Value {
  const operand = args[0];
  if (operand === undefined) {
    return { error: "#TYPE", message: "NOT: missing argument 1" };
  }
  const operandValue = evaluateNode(operand, read);
  const entry = getFunctionEntry("NOT");
  if (entry === undefined || entry.evaluationMode !== "eager") {
    // Defensive: NOT is always a registered eager entry (functions.ts). Unreachable in practice;
    // never throws if it ever drifts.
    return { error: "#TYPE", message: 'NOT: registry entry is missing or not eager (internal error)' };
  }
  return entry.implementation([operandValue]);
}

/**
 * `FunctionCallNode` evaluation — the ONE place D-029 could be violated by accident. See the file
 * header's WHAT THIS IS for the exact, ordered rationale; this function's structure IS that order.
 */
function evaluateFunctionCall(node: FunctionCallNode, read: ReadSlot): Value {
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
  // a LazyFunctionEntry (functions.ts, TypeScript-enforced).
  if (entry.evaluationMode === "lazy") {
    switch (node.name) {
      case "IF":
        return evaluateIf(node.args, read);
      case "AND":
        return evaluateAndOperands(node.args, read);
      case "OR":
        return evaluateOrOperands(node.args, read);
      default:
        // Defensive: unreachable while LAZY_FUNCTION_NAMES is exactly {IF, AND, OR} — pinned by
        // a test in this file and in functions.test.ts. Never throws if that ever drifts.
        return {
          error: "#TYPE",
          message: `"${node.name}" is registered lazy but has no evaluator wired in formula/eval.ts (internal error)`,
        };
    }
  }

  // Eager path: evaluate every argument, left to right, stopping at the first error.
  const argValues: Value[] = [];
  for (const arg of node.args) {
    const value = evaluateNode(arg, read);
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
