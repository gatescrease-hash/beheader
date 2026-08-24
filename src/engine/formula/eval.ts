/**
 * eval.ts — FormulaAst -> Value (PROJECT_BRIEF §5.3, stage 4 of 4: the evaluator).
 *
 * IMPLEMENTS: §5.3's "eager total dependency extraction vs. lazy short-circuit
 * evaluation" section — the LAZY half (`deps.ts` is the eager half): "`evaluate(ast)`
 * is LAZY and SHORT-CIRCUITS. `IF` evaluates only the taken branch. `AND`/`OR`
 * short-circuit. A runtime error... in an *untaken* branch therefore never occurs and
 * never surfaces." Upholds **D-029** (`IF`/`AND`/`OR` dispatched lazily at the
 * `FunctionCallNode` site, in BOTH syntactic forms, before any argument is evaluated;
 * `NOT` is the one eager exception), **D-028** (an `ErrorNode` evaluates to its
 * `ErrorValue`, never `#PARSE`), **D-033** (every arithmetic result routes through
 * `functions.ts`'s `finiteResult`), and **D-034** (every registry lookup goes through
 * `getFunctionEntry`; this file never indexes `FUNCTION_REGISTRY` directly).
 * LAYER: engine (pure). May import: engine/* only.
 *        NEVER imports: DOM, window, document, canvas, render/*.
 *
 * WHAT THIS IS
 *   One exported function: `evaluate(ast, read, readRange?)`.
 *
 *   `read: (address) => Value | undefined` resolves a reference to whatever value an
 *   earlier stage already computed — the same shape `primitives/schema.ts`'s
 *   `DerivedSlotCompute` and `graph/eval.ts`'s own closures use (D-014: one shape,
 *   reused). `readRange: (start, end) => Value[] | ErrorValue` is the range analogue.
 *   This file has NO opinion on how either answer was produced.
 *
 *   `readRange` deliberately does NOT hand this file a `GraphObject` or any
 *   table-dimension access of its own. Bounding by current extent must use the EXACT
 *   SAME computation `mutation.ts`'s `deriveEdges` used to decide which cells this
 *   formula depends on (`primitives/table.ts`'s `enumerateRangeCellAddresses`, D-046's
 *   `literal`-only guard). Staying blind to that machinery is what makes it
 *   STRUCTURALLY impossible for evaluation and edge derivation to disagree about which
 *   cells a range spans, rather than merely conventionally so.
 *
 *   `readRange` is OPTIONAL. A caller with no range support wired (most of this file's
 *   own test suite) may omit it; a `RangeNode` then evaluates to a disclosed `#PARSE`.
 *   The one production caller (`graph/eval.ts`) always supplies a real one.
 *
 *   Every node is evaluated by structural recursion (`evaluateNode`, one exhaustive
 *   `switch`, mirroring `deps.ts`'s `walk` and `parser.ts`'s `walkForRangePlacement`):
 *   `literal` -> its own value; `reference` -> `read(address)`, `undefined` becoming
 *   `#REF` (`undefined` is not a member of `Value`); `error` -> its stored
 *   `ErrorValue`; `binaryOp` -> `AND`/`OR` lazily, comparisons and arithmetic eagerly;
 *   `unaryOp` -> negation, or `NOT` delegated to the registry; `functionCall` ->
 *   `evaluateFunctionCall`. A `range` reached through this generic path is a
 *   MISPLACED one (`validateRangePlacement` would have rejected it) and yields the
 *   disclosed `#PARSE` — a correctly-placed range never gets here, because
 *   `evaluateFunctionCall` special-cases it first.
 *
 *   **`evaluateFunctionCall` is the ONE place D-029 could be violated by accident, and
 *   the ONE place a `RangeNode` is legally expanded.** Order, exactly:
 *   1. `getFunctionEntry(name)` (D-034-safe). `undefined` -> `#TYPE`, never a crash.
 *   2. `checkArity` — BEFORE evaluating anything, against the AST-LEVEL argument count
 *      (`SUM(A1:B4)` has exactly one argument node, whatever it flattens to).
 *   3. **The lazy check, before a single argument is evaluated** and before
 *      `entry.implementation` is so much as considered (it does not exist for a
 *      `LazyFunctionEntry` — TypeScript enforces that at `functions.ts`'s own
 *      construction sites). `IF`/`AND`/`OR` hard-dispatch here to the only three
 *      places in this file that decide which args get evaluated AT ALL. The `default`
 *      arm is a never-throwing guard against `LAZY_FUNCTION_NAMES` drifting out of
 *      sync with this dispatch, pinned by tests in both files.
 *   4. Only past that gate: arguments evaluated EAGERLY, left to right, STOPPING at
 *      the first `ErrorValue`. A `range`-typed argument is resolved via `readRange`
 *      and its values pushed onto the SAME flattened list a scalar argument lands in,
 *      so `SUM(A1, B1:B3, 10)` and `SUM(A1, B1, B2, B3, 10)` reach the registry as the
 *      identical five-element list — "expand to concrete dependencies" applied to
 *      VALUES rather than edges.
 *
 *   **`AND`/`OR`'s laziness is ONE shared implementation over an operand ARRAY**, not
 *   two. The infix form calls it with `[left, right]`; the call form with `args`.
 *   Binary is simply the N=2 case: stop and return the moment the result is determined,
 *   so every later operand is never even visited — which is what makes "an error in an
 *   untaken branch never surfaces" literally true rather than merely intended. `IF`
 *   has no infix form and evaluates only the taken branch.
 *
 *   **`NOT` is delegated to `functions.ts`'s registry entry**, never reimplemented —
 *   duplicating its type-check-and-negate logic would be exactly the parallel copy
 *   D-009/D-014 exist to prevent. The prefix form reaches it via `evaluateNot`; the
 *   call form via `evaluateFunctionCall`'s ordinary eager path. Both end at the same
 *   entry with one evaluated operand, so the two forms agree by construction — pinned
 *   by a test.
 *
 * INVARIANTS UPHELD HERE
 *   - `evaluate` NEVER throws. Every failure — unresolved reference, wrong-typed
 *     operand, unknown or mis-called function, unresolvable range, division by zero,
 *     a non-finite result — returns a typed `ErrorValue` (§5.1).
 *   - Eager argument evaluation is left-to-right and stops at the first error; a
 *     range's own cells are walked in that same order.
 *   - `AND`/`OR`/`IF` never evaluate more than §5.3 requires — pinned by tests using a
 *     "poison" operand in the untaken position.
 *   - Every arithmetic result routes through `functions.ts`'s EXPORTED `finiteResult`,
 *     the same D-033 guard the registry entries use, not a second copy: `-0`
 *     normalises to `+0`, a genuinely non-finite result is `#TYPE`.
 *   - Comparisons require BOTH operands to be the SAME primitive type; cross-type is
 *     `#TYPE`. A disclosed decision, not a brief requirement — see
 *     `evaluateComparison`'s own comment.
 *   - A range is flattened at exactly one point and nowhere else recurses expecting
 *     one `Value` back.
 *
 * NOT DONE HERE
 *   Any change to `deps.ts` — dependency extraction and evaluation are DIFFERENT walks
 *   over the same shapes, and neither reuses or alters the other. Building the real
 *   `readRange` — that is `primitives/table.ts`'s `enumerateRangeCellAddresses`, wired
 *   in by `graph/eval.ts`, the one place holding both the object list and the
 *   already-evaluated-values map this file is deliberately never handed.
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
