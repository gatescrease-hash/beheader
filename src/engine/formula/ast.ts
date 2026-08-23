/**
 * ast.ts — Formula AST node types (PROJECT_BRIEF §5.3's grammar, v1, in full).
 *
 * IMPLEMENTS: PROJECT_BRIEF §5.3 ("the AST is the interchange format") and
 * answers **Q-005**: Phase 0's `FormulaAst` was a one-variant stand-in
 * (`ReferenceNode` only); this cycle WIDENS it to every node the v1 grammar
 * needs, per Q-005's own binding constraint — `ReferenceNode` is unchanged,
 * not restructured, so a binding (Phase 0's only formula shape) still parses
 * to exactly the same AST it always did. **Q-005 is ANSWERED as of this
 * cycle** — see `claude/OPEN_QUESTIONS.md`.
 * LAYER: engine (pure). May import: engine/* only.
 *        NEVER imports: DOM, window, document, canvas, render/*.
 *
 * This is `formula/`'s first REAL file — the Phase 0 `ast.ts` was a narrow
 * stand-in, not a grammar. §6.1 trigger 2 (first file of a subsystem): stop
 * here, do not batch `lexer.ts`/`parser.ts`/`eval.ts`/`deps.ts`/`functions.ts`
 * behind it. The design choices here (node shapes) are the expensive ones to
 * get wrong — every later formula file is built ON these shapes.
 *
 * WHAT THIS IS
 *   Every `FormulaAst` node §5.3's grammar needs, plus the ONE node that
 *   grammar never produces but §5.1.1/§5.4 require a stored AST to be able to
 *   hold (`ErrorNode`) — and nothing it does not:
 *
 *   - `LiteralNode` — a number, string, or boolean literal (`3`, `"hello"`,
 *     `TRUE`). One node for all three, not three node types: §5.3 groups them
 *     as one grammar category ("Literals: numbers, strings, booleans"), and
 *     `LiteralNode.value`'s type (`number | string | boolean`) is already a
 *     proper subset of `graph/node.ts`'s `Value` — Rule 5's dumbest correct
 *     shape, not three near-identical interfaces.
 *   - `ReferenceNode` — UNCHANGED from Phase 0 (`{ type: "reference"; address:
 *     Address }`). §5.3: "References: `name.path.path` ... plus bare cell
 *     refs (`A1`), legal only inside a table cell formula, meaning 'this
 *     table, that cell.'" A bare cell ref does NOT get its own node type: by
 *     the time an address reaches the AST it is already resolved (§5.2 — names
 *     resolve to IDs, and a bare ref resolves against "the table this formula
 *     lives in") into the exact same `{ objectId, path }` shape a fully
 *     written `table_x.A1` produces. `parser.ts` (a later cycle) is what
 *     supplies "which table" as context; this file has no opinion on that.
 *   - `RangeNode` — an endpoint pair (`start`, `end`, both `Address`), NEVER a
 *     pre-expanded cell list (§5.3: "Store a range in the AST as an endpoint
 *     pair... Expand to concrete slot dependencies at edge-derivation time").
 *     §5.3 also restricts WHERE a range may appear ("only as an argument to
 *     an aggregate function") — that is a PARSER-time placement rule, not a
 *     type-level one; enforcing it in the type system would need a second,
 *     narrower "aggregate-call-argument" union that nothing else benefits
 *     from, so `RangeNode` is simply one more `FormulaAst` variant and
 *     `parser.ts` is where a misplaced range becomes `#PARSE`. Likewise, a
 *     range's two endpoints belong to the SAME table in every legal formula
 *     (§5.4: a table is a self-contained grid) — not enforced structurally
 *     here for the same reason; whoever builds range validation checks it.
 *   - `BinaryOpNode` — one node, one `operator` field spanning §5.3's ENTIRE
 *     precedence chain (`OR`, `AND`, comparison, `+ -`, `* / %`, `^`) rather
 *     than one node type per precedence tier. Precedence is a PARSER concern
 *     (which operators bind tighter), not an AST-shape concern — the AST only
 *     needs to record which operation happened, at whatever tier the parser
 *     already resolved it to.
 *   - `UnaryOpNode` — `-` (negation) and `NOT`, the grammar's two prefix
 *     operators.
 *   - `FunctionCallNode` — `NAME(arg, arg, ...)`. `name` is a bare `string`,
 *     not a union of built-in names: §5.3 says the function registry is
 *     "table-driven... so adding one is a single line," an open, registry-
 *     driven vocabulary (unlike D-009's `ObjectType`, which IS closed) — an
 *     unrecognised name is a `functions.ts`/`parser.ts`-time `#PARSE`, not a
 *     compile-time constraint here.
 *
 *   - `ErrorNode` — a `#REF` stored IN the AST at one reference's position.
 *     NOT part of §5.3's grammar: no formula the parser ever sees contains
 *     one. It exists because §5.1.1's REPAIR path "rewrites every inbound
 *     reference into a `#REF` error node in the referring AST", and §5.4 says
 *     the same of a reference to a deleted row/column ("becomes a `#REF`
 *     error stored in the AST at that position"). Both are the brief's own
 *     words, and both describe a NODE, not a whole-formula failure: `= A1 +
 *     B1` whose `B1` column was deleted stays a `BinaryOpNode` with an
 *     `ErrorNode` where its right operand was, so the surviving `A1`
 *     reference keeps its edge. Added at 0029-REVIEW-phase1 — see D-028.
 *
 * A GENUINE AMBIGUITY, noted here rather than silently resolved (raised as
 * **Q-009**): §5.3 lists `AND`/`OR`/`NOT` BOTH as infix/prefix OPERATORS
 * (in the precedence chain) AND as callable BUILT-IN FUNCTIONS (in the
 * built-ins list, alongside `SUM`/`MIN`/etc.). This file takes no position —
 * `BinaryOpNode`/`UnaryOpNode` and `FunctionCallNode` are structurally
 * independent variants, so BOTH `a AND b` (binaryOp) and `AND(a, b, c)`
 * (functionCall, N-ary) are already representable without conflict. Whether
 * `parser.ts`/`functions.ts` actually wire up both forms, and whether the
 * function form's semantics (arity, short-circuiting) match the operator
 * form, is exactly the kind of load-bearing-but-reversible call `parser.ts`'s
 * own cycle should make and tag, not this one.
 *
 * INVARIANTS UPHELD HERE
 *   - `ReferenceNode` is byte-for-byte what Phase 0 shipped — Q-005's binding
 *     constraint, checked by `ast.test.ts`.
 *   - Every node is plain, readonly, serializable data (Rule 2/§2) — no
 *     behaviour attached, matching every other AST-shaped type in this
 *     codebase (`graph/node.ts`'s `Slot` union).
 *   - `isReferenceNode` is the ONE sanctioned way to narrow `FormulaAst` down
 *     to a binding (D-014's principle: a predicate over a union is declared
 *     once, beside the union, and imported everywhere) — `mutation.ts` and
 *     `graph/eval.ts` both need this narrowing this cycle, now that
 *     `FormulaAst` is a real union instead of a single type.
 *
 * NOT DONE HERE
 *   Lexer, parser, evaluator, `extractDependencies`, the function registry —
 *   all of `formula/lexer.ts`, `formula/parser.ts`, `formula/eval.ts`,
 *   `formula/deps.ts`, `formula/functions.ts`. Each is its own later cycle;
 *   none is batched behind this one (§6.1 trigger 2).
 *
 *   Also NOT done here, but a direct, disclosed CONSEQUENCE of widening this
 *   union: `mutation.ts`'s `deriveEdges` and `graph/eval.ts`'s formula-slot
 *   evaluation were BOTH written when `FormulaAst` had exactly one variant,
 *   so both read `slot.ast.address` unconditionally — a type error the moment
 *   this union grows a second member. Both are updated in THIS cycle (not a
 *   Phase 2 concern) purely to stay correctly typed and to fail CLOSED rather
 *   than silently mis-handle a formula slot whose AST is not yet a shape this
 *   build's evaluator understands — see their own files' cycle-0028 notes.
 *   Actually EVALUATING a general formula (the real `formula/eval.ts`,
 *   wired into `graph/eval.ts`) is still Phase 2's job ("wire the formula
 *   engine into cell slots").
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
 * The formula AST's root type — WIDENED this cycle (Q-005, ANSWERED) from
 * Phase 0's one-variant stand-in to the full §5.3 grammar. `ReferenceNode`
 * is preserved exactly, per Q-005's own binding constraint: a binding stays
 * representable as a bare reference under the full grammar too.
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
 * make this check (D-014). Needed THIS cycle by `mutation.ts` (`deriveEdges`)
 * and `graph/eval.ts` (formula-slot evaluation), both of which assumed, while
 * `FormulaAst` had one variant, that `slot.ast.address` always exists — no
 * longer true now that it doesn't.
 */
export function isReferenceNode(ast: FormulaAst): ast is ReferenceNode {
  return ast.type === "reference";
}
