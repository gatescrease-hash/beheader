/**
 * ast.ts — Formula AST node types: PROJECT_BRIEF §5.3's v1 grammar, in full.
 *
 * IMPLEMENTS: PROJECT_BRIEF §5.3 ("the AST is the interchange format"). Answers
 * **Q-005**. The shapes here are what every other `formula/` file is built on.
 * LAYER: engine (pure). May import: engine/* only.
 *        NEVER imports: DOM, window, document, canvas, render/*.
 *
 * WHAT THIS IS
 *   Every node §5.3's grammar needs, plus the ONE node that grammar never produces but
 *   §5.1.1/§5.4 require a stored AST to be able to hold — and nothing it does not:
 *
 *   - `LiteralNode` — a number, string, or boolean. ONE node for all three, not three:
 *     §5.3 groups them as one grammar category, and `value`'s type is already a proper
 *     subset of `graph/node.ts`'s `Value`. Rule 5's dumbest correct shape.
 *   - `ReferenceNode` — `{ type: "reference"; address: Address }`. A bare cell ref
 *     (`A1`) gets NO separate node type: by the time an address reaches the AST it is
 *     already resolved (§5.2) into the same `{ objectId, path }` a fully-written
 *     `table_x.A1` produces. `parser.ts` supplies "which table"; this file has no
 *     opinion on that.
 *   - `RangeNode` — an endpoint PAIR, never a pre-expanded cell list (§5.3: "Store a
 *     range in the AST as an endpoint pair... Expand to concrete slot dependencies at
 *     edge-derivation time"). §5.3's placement restriction (aggregate arguments only)
 *     and the same-table rule (§5.4) are PARSER-time rules, not type-level ones:
 *     enforcing them structurally would need a second, narrower union nothing else
 *     benefits from, so a misplaced range becomes `#PARSE` in `parser.ts` instead.
 *   - `BinaryOpNode` — ONE node with one `operator` field spanning §5.3's ENTIRE
 *     precedence chain, not one node type per tier. Precedence is a parser concern
 *     (which operators bind tighter); the AST only records which operation happened.
 *   - `UnaryOpNode` — `-` and `NOT`, the grammar's two prefix operators.
 *   - `FunctionCallNode` — `name` is a bare `string`, not a union of built-in names.
 *     §5.3's registry is "table-driven... so adding one is a single line", an open
 *     vocabulary (unlike D-009's `ObjectType`, which IS closed) — an unrecognised name
 *     is a `#PARSE` (D-038), not a compile-time constraint here.
 *   - `ErrorNode` (**D-028**) — a `#REF` stored IN the AST at one reference's
 *     position. NOT part of §5.3's grammar; no formula the parser sees contains one.
 *     It exists because §5.1.1's REPAIR path "rewrites every inbound reference into a
 *     `#REF` error node in the referring AST", and §5.4 says the same of a reference
 *     to a deleted row/column. Both describe a NODE, not a whole-formula failure:
 *     `= A1 + B1` whose `B1` column was deleted stays a `BinaryOpNode` with an
 *     `ErrorNode` where its right operand was, so the surviving `A1` keeps its edge.
 *
 *   `AND`/`OR`/`NOT` appear in §5.3 BOTH as operators and as callable built-ins.
 *   **D-029** settled that both forms are legal and mean the same thing; this file
 *   needs no special case for it, because `BinaryOpNode`/`UnaryOpNode` and
 *   `FunctionCallNode` are structurally independent variants, so `a AND b` and
 *   `AND(a, b, c)` are both representable without conflict.
 *
 * INVARIANTS UPHELD HERE
 *   - `ReferenceNode`'s shape is fixed and must not be restructured — Q-005's binding
 *     constraint, pinned by `ast.test.ts`.
 *   - Every node is plain, readonly, serializable data (Rule 2/§2) — no behaviour
 *     attached, matching `graph/node.ts`'s `Slot` union.
 *   - `isReferenceNode` is the ONE sanctioned way to narrow `FormulaAst` to a binding
 *     (D-014: a predicate over a union is declared once, beside the union).
 *   - **D-083 clause 4**: `exceedsMaxFormulaAstDepth` is the ONE depth check a loaded
 *     `FormulaAst` passes through, called once by `document.ts` at the load boundary.
 *     No other file grows a depth parameter of its own over this shape.
 *
 * NOT DONE HERE
 *   Lexing, parsing, evaluation, dependency extraction, the function registry — each
 *   is its own file in `formula/`.
 */
import type { Address } from "../address.ts";

/**
 * A number, string, or boolean literal (§5.3). One node for all three — see
 * the file header for why this is not three node types.
 */
export interface LiteralNode {
  readonly type: "literal";
  readonly value: number | string | boolean;
}

/**
 * A bare reference to another slot — the AST shape of a binding (§5.1), AND
 * of a fully-written `name.path` reference, AND of a resolved bare cell ref
 * (§5.3) — all three parse to exactly this shape; see the file header.
 * UNCHANGED from Phase 0 (Q-005's binding constraint).
 */
export interface ReferenceNode {
  readonly type: "reference";
  readonly address: Address;
}

/**
 * `start:end` — an endpoint pair, never a pre-expanded cell list (§5.3).
 * Legal only as an aggregate function's argument; not enforced at this
 * type's level — see the file header.
 */
export interface RangeNode {
  readonly type: "range";
  readonly start: Address;
  readonly end: Address;
}

/**
 * §5.3's full infix-operator precedence chain, loosest to tightest, minus the two
 * prefix operators (see `UnaryOperator`).
 *
 * Declared as a runtime array with the TYPE derived from it, rather than the other
 * way round, so `validateFormulaAstShape` can test a loaded operator against the
 * real set (**D-108**) without a second hand-copied list that could drift from this
 * one. The derived type is character-identical to the union it replaces.
 */
export const BINARY_OPERATORS = ["OR", "AND", "=", "<>", "<", ">", "<=", ">=", "+", "-", "*", "/", "%", "^"] as const;
export type BinaryOperator = (typeof BINARY_OPERATORS)[number];

/** A binary operation. One node, one `operator` field across the WHOLE precedence chain — see the file header for why. */
export interface BinaryOpNode {
  readonly type: "binaryOp";
  readonly operator: BinaryOperator;
  readonly left: FormulaAst;
  readonly right: FormulaAst;
}

/** §5.3's two prefix operators: numeric negation and boolean negation. Array-first for the same reason `BINARY_OPERATORS` is. */
export const UNARY_OPERATORS = ["-", "NOT"] as const;
export type UnaryOperator = (typeof UNARY_OPERATORS)[number];

/** A unary (prefix) operation. */
export interface UnaryOpNode {
  readonly type: "unaryOp";
  readonly operator: UnaryOperator;
  readonly operand: FormulaAst;
}

/**
 * `NAME(arg, arg, ...)` (§5.3). `name` is a bare `string` — see the file
 * header for why this is not a closed union the way `ObjectType` (D-009) is.
 * `IF` is NOT a separate AST node: §5.3 lists it among the built-in
 * FUNCTIONS, so `IF(cond, trueVal, falseVal)` is simply a `FunctionCallNode`
 * named `"IF"` with exactly three args (D-035) — no `ConditionalNode` here. (Text's
 * OWN `{? }{:}{?}` block-tree conditional, §5.6, is a different, later
 * concern — a block-tree node, not a formula AST node.)
 */
export interface FunctionCallNode {
  readonly type: "functionCall";
  readonly name: string;
  readonly args: readonly FormulaAst[];
}

/**
 * A `#REF` error stored IN the AST at one reference's position (D-028). Never
 * produced by parsing — §5.3 has no syntax for it, and an unresolvable name is
 * a parse-time failure rather than a stored node (§5.3: "An unresolvable
 * reference is a PARSE-time error regardless of branch"). It is written only
 * by §5.1.1's repair path and §5.4's reference-adjustment pass, both Phase 2,
 * and it is what keeps that repair a NODE-level rewrite: the rest of the
 * formula, and every edge the rest of it derives, survives.
 *
 * `error` is the one-member literal `"#REF"`, not `graph/node.ts`'s full
 * `ErrorCode`: `#REF` is the only code the brief ever stores in an AST, and a
 * one-member literal is both the dumbest correct shape (Rule 5) and additively
 * widenable if that ever stops being true. Evaluation turns this node into a
 * full `ErrorValue` (D-028); the node carries no `message` of its own.
 */
export interface ErrorNode {
  readonly type: "error";
  readonly error: "#REF";
}

/**
 * The formula AST's root type: the full §5.3 grammar (Q-005). `ReferenceNode`'s
 * shape is fixed by Q-005's binding constraint — a binding stays representable
 * as a bare reference under the full grammar.
 */
export type FormulaAst =
  | LiteralNode
  | ReferenceNode
  | RangeNode
  | BinaryOpNode
  | UnaryOpNode
  | FunctionCallNode
  | ErrorNode;

/**
 * Narrows `FormulaAst` to its `ReferenceNode` arm — the ONE sanctioned way to
 * make this check (D-014). `slot.ast.address` must never be reached without it:
 * `FormulaAst` is a seven-member union, and only this arm carries an address.
 */
export function isReferenceNode(ast: FormulaAst): ast is ReferenceNode {
  return ast.type === "reference";
}

/**
 * The deepest a stored `FormulaAst` may nest, and the bound every recursive walk over
 * one is written against (**D-079**).
 *
 * Why a constant and not a measurement: entry 0079 saw a `RangeError` at ~5,000 nested
 * levels, entry 0081 at ~3,000, and 0082-REVIEW saw the SAME formula commit and throw
 * in one process depending only on what had been compiled before it — the depth a V8
 * frame costs is a property of the runtime's state, not of the input. So no observed
 * number is a bound. This is a fixed value chosen well below the smallest depth any
 * walk over this shape has ever been seen to fail at (the smallest observed here is
 * ~6,000 levels, in `parser.ts`'s own post-parse walk), and it is pinned by a test on
 * the constant itself rather than on where a throw happens.
 *
 * `parser.ts` REFUSES a formula whose AST would nest deeper than this with a `#PARSE`,
 * so nothing this deep is ever stored by anything a user can type; `format.ts` guards
 * its own recursion anyway, because §5.11's load path casts a saved AST unchecked and
 * a hand-edited file is a real way for a deeper one to arrive.
 */
export const MAX_FORMULA_AST_DEPTH = 1000;

/**
 * Either the well-formed `FormulaAst` `raw` turned out to be, or why it is not one.
 * Carries the value back rather than being a type predicate so a caller narrows by
 * USING the result — a predicate would let `raw` be used unchecked by mistake.
 */
export type FormulaAstShapeResult = { readonly ok: true; readonly ast: FormulaAst } | { readonly ok: false; readonly reason: string };

/**
 * **D-108 clause 2 / D-127**: validates that arbitrary loaded JSON really is a
 * `FormulaAst`, ONCE, at the boundary — never a guard threaded through every
 * downstream walk (clause 3, which explicitly forbids hardening
 * `exceedsMaxFormulaAstDepth` or `collectIllegalAstLiterals` individually).
 *
 * Lives here rather than in `document.ts` because it is knowledge about
 * `FormulaAst`'s OWN variants: a new node type must be added to this walk in the
 * same edit that adds it to the union above, and putting them side by side is the
 * only thing that makes that obvious. `exceedsMaxFormulaAstDepth` sits here for the
 * same reason.
 *
 * **What it was:** `document.ts` cast `raw.ast as FormulaAst` unchecked, so a loaded
 * `ast` of `null`, a `binaryOp` with absent or `null` children, or a `functionCall`
 * whose `args` was not an array threw a `TypeError` out of `loadDocument` — and,
 * because `main.ts`'s `openDocument` called it inside a `.then()`, that surfaced as
 * an unhandled promise rejection: no message, no log line, the program simply did
 * nothing (D-127 clause 2).
 *
 * **Stack safety, and why this can run before the depth check.** It descends at most
 * `MAX_FORMULA_AST_DEPTH` levels and then stops, reporting `ok` for the subtree it
 * did not look at. That is not a hole: `exceedsMaxFormulaAstDepth` runs immediately
 * after and refuses any document nesting that deep, so nothing below the bound is
 * ever reached by anything else. The alternative — an unbounded recursive validator —
 * would trade a `TypeError` for a `RangeError`, which is the same defect wearing
 * D-083's hat. The depth VERDICT stays that function's alone, so the operator gets
 * D-083's own message rather than two rulings' messages for one condition.
 */
export function validateFormulaAstShape(raw: unknown, depth = 1): FormulaAstShapeResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: `a formula node must be an object, not ${raw === null ? "null" : Array.isArray(raw) ? "an array" : typeof raw}` };
  }
  const node = raw as Record<string, unknown>;
  if (depth > MAX_FORMULA_AST_DEPTH) {
    // Below the bound this walk stops looking; the depth check that runs next is
    // what refuses the document. See the doc comment above.
    return { ok: true, ast: node as unknown as FormulaAst };
  }
  switch (node["type"]) {
    case "literal": {
      const value = node["value"];
      if (typeof value !== "number" && typeof value !== "string" && typeof value !== "boolean") {
        return { ok: false, reason: `a literal node's value must be a number, string, or boolean, not ${describeRaw(value)}` };
      }
      return { ok: true, ast: { type: "literal", value } };
    }
    case "reference": {
      const address = readAddress(node["address"]);
      return address === undefined
        ? { ok: false, reason: "a reference node's address must be { objectId: string, path: string[] }" }
        : { ok: true, ast: { type: "reference", address } };
    }
    case "range": {
      const start = readAddress(node["start"]);
      const end = readAddress(node["end"]);
      return start === undefined || end === undefined
        ? { ok: false, reason: "a range node's start and end must each be { objectId: string, path: string[] }" }
        : { ok: true, ast: { type: "range", start, end } };
    }
    case "binaryOp": {
      const operator = node["operator"];
      if (!isBinaryOperator(operator)) {
        return { ok: false, reason: `${describeRaw(operator)} is not one of §5.3's binary operators` };
      }
      const left = validateFormulaAstShape(node["left"], depth + 1);
      if (!left.ok) {
        return left;
      }
      const right = validateFormulaAstShape(node["right"], depth + 1);
      if (!right.ok) {
        return right;
      }
      return { ok: true, ast: { type: "binaryOp", operator, left: left.ast, right: right.ast } };
    }
    case "unaryOp": {
      const operator = node["operator"];
      if (!isUnaryOperator(operator)) {
        return { ok: false, reason: `${describeRaw(operator)} is not one of §5.3's prefix operators` };
      }
      const operand = validateFormulaAstShape(node["operand"], depth + 1);
      return operand.ok ? { ok: true, ast: { type: "unaryOp", operator, operand: operand.ast } } : operand;
    }
    case "functionCall": {
      const name = node["name"];
      const rawArgs = node["args"];
      if (typeof name !== "string") {
        return { ok: false, reason: `a function call's name must be a string, not ${describeRaw(name)}` };
      }
      if (!Array.isArray(rawArgs)) {
        return { ok: false, reason: `${name}'s args must be an array, not ${describeRaw(rawArgs)}` };
      }
      // One at a time, never `map`+spread: `args` comes from a file and its length
      // is not this program's to bound (D-077 clause 1's reasoning, applied to a
      // loaded array instead of a generated one).
      const args: FormulaAst[] = [];
      for (const rawArg of rawArgs) {
        const arg = validateFormulaAstShape(rawArg, depth + 1);
        if (!arg.ok) {
          return arg;
        }
        args.push(arg.ast);
      }
      return { ok: true, ast: { type: "functionCall", name, args } };
    }
    case "error": {
      // D-028's stored `#REF`. The only `error` value the union admits, so a file
      // naming another one is malformed rather than a new error code.
      return node["error"] === "#REF"
        ? { ok: true, ast: { type: "error", error: "#REF" } }
        : { ok: false, reason: `an error node's error must be "#REF", not ${describeRaw(node["error"])}` };
    }
    default:
      return { ok: false, reason: `${describeRaw(node["type"])} is not a formula node type` };
  }
}

/** `{ objectId, path }` from raw JSON, or `undefined` if it is not one. `path` must be an array of STRINGS — `slotKey` joins it, and a number in there would key a slot no schema declares. */
function readAddress(raw: unknown): Address | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return undefined;
  }
  const candidate = raw as Record<string, unknown>;
  const objectId = candidate["objectId"];
  const path = candidate["path"];
  if (typeof objectId !== "string" || !Array.isArray(path) || !path.every((segment) => typeof segment === "string")) {
    return undefined;
  }
  return { objectId, path: path as readonly string[] };
}

/** Whether `raw` is one of §5.3's binary operators — tested against `BINARY_OPERATORS`, the array the TYPE is derived from, so the two can never disagree. */
function isBinaryOperator(raw: unknown): raw is BinaryOperator {
  return typeof raw === "string" && (BINARY_OPERATORS as readonly string[]).includes(raw);
}

/** Whether `raw` is one of §5.3's prefix operators. Same shape as `isBinaryOperator`. */
function isUnaryOperator(raw: unknown): raw is UnaryOperator {
  return typeof raw === "string" && (UNARY_OPERATORS as readonly string[]).includes(raw);
}

/** A short description of an unexpected loaded value, for a refusal message. Quotes a string so `"+"` and `+` are distinguishable; never throws. */
function describeRaw(raw: unknown): string {
  if (raw === null) {
    return "null";
  }
  if (typeof raw === "string") {
    return JSON.stringify(raw);
  }
  if (Array.isArray(raw)) {
    return "an array";
  }
  return typeof raw === "object" ? "an object" : String(raw);
}

/**
 * Whether `ast` nests deeper than `MAX_FORMULA_AST_DEPTH` — **D-083 clause 4**'s
 * load-boundary check. `document.ts`'s loader is the ONE caller: depth is checked
 * ONCE, at the moment a `FormulaAst` first enters the program from outside a parse,
 * never by a guard threaded through every walk downstream. `formula/deps.ts` and
 * `formula/eval.ts` do NOT carry a depth parameter of their own (D-083 clause 3 — "a
 * recursion's limit lives at the recursion, not at its callers"); this function is
 * what makes that safe, by refusing the document before either ever sees the AST.
 *
 * Runs immediately AFTER `validateFormulaAstShape` on the same loaded AST, and that
 * order is load-bearing in both directions: this walk reads `ast.type` and a node's
 * children, so it needs the shape settled first — and it is what refuses everything
 * below the bound that the shape walk deliberately stopped looking at.
 *
 * Counts the SAME way `parser.ts`'s own post-parse walk and `format.ts`'s own display
 * guard do — the root is depth 1, each child one deeper — so a `FormulaAst` this
 * function accepts is exactly one `parser.ts` could have built, and one this function
 * refuses can only have arrived through a hand-edited or foreign saved file (nothing
 * typed through `parser.ts` can produce one, since it refuses first).
 *
 * Never throws for a legal `FormulaAst`, however deep: the depth check runs BEFORE
 * this function recurses into a node's children, so the call stack never grows past
 * `MAX_FORMULA_AST_DEPTH` frames even for an adversarially deep input — the same
 * "check first, recurse second" shape `format.ts`'s `formatNode` and `parser.ts`'s
 * `walkForRangePlacement` already use for the identical reason.
 */
export function exceedsMaxFormulaAstDepth(ast: FormulaAst, depth = 1): boolean {
  if (depth > MAX_FORMULA_AST_DEPTH) {
    return true;
  }
  switch (ast.type) {
    case "literal":
    case "reference":
    case "range":
    case "error":
      return false;
    case "binaryOp":
      return exceedsMaxFormulaAstDepth(ast.left, depth + 1) || exceedsMaxFormulaAstDepth(ast.right, depth + 1);
    case "unaryOp":
      return exceedsMaxFormulaAstDepth(ast.operand, depth + 1);
    case "functionCall":
      return ast.args.some((arg) => exceedsMaxFormulaAstDepth(arg, depth + 1));
    default: {
      const exhaustive: never = ast;
      void exhaustive;
      return false;
    }
  }
}
