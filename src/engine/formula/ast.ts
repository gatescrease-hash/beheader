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

/** §5.3's full infix-operator precedence chain, loosest to tightest, minus the two prefix operators (see `UnaryOperator`). */
export type BinaryOperator = "OR" | "AND" | "=" | "<>" | "<" | ">" | "<=" | ">=" | "+" | "-" | "*" | "/" | "%" | "^";

/** A binary operation. One node, one `operator` field across the WHOLE precedence chain — see the file header for why. */
export interface BinaryOpNode {
  readonly type: "binaryOp";
  readonly operator: BinaryOperator;
  readonly left: FormulaAst;
  readonly right: FormulaAst;
}

/** §5.3's two prefix operators: numeric negation and boolean negation. */
export type UnaryOperator = "-" | "NOT";

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
