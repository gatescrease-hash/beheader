/**
 * ast.ts — Formula AST node types.
 *
 * IMPLEMENTS: PROJECT_BRIEF §5.3 ("the AST is the interchange format"), narrowly.
 * LAYER: engine (pure). May import: engine/* only.
 *        NEVER imports: DOM, window, document, canvas, render/*.
 *
 * WHAT THIS IS RIGHT NOW — PROVISIONAL(Q-005)
 *   This is a Phase 0 stand-in, not the real formula grammar. `formula/lexer.ts`,
 *   `formula/parser.ts`, `formula/eval.ts`, and `formula/deps.ts` are all Phase 1
 *   (PROJECT_BRIEF §6's build order puts `formula/*` after `graph/*`, `mutation.ts`,
 *   `document.ts`). Phase 0 only needs a `FormulaSlot` (graph/node.ts) to hold
 *   *something* as its AST, and the only formula shape Phase 0's own test fixture
 *   requires is a **binding** — §5.1: "a binding is just the degenerate formula
 *   `= other.slot`". So `FormulaAst` has exactly one variant: a bare reference.
 *
 *   Phase 1 EXTENDS this union (adds `BinaryOp`, `Literal`, `FunctionCall`,
 *   `Conditional`, `Range`, ... per §5.3's grammar). It must not restructure or
 *   remove `ReferenceNode` — a binding stays representable as a bare reference
 *   under the full grammar too, so nothing built against `FormulaAst` in Phase 0
 *   should need to change shape when Phase 1 lands.
 *
 * NOT DONE HERE
 *   Lexer, parser, evaluator, extractDependencies (all of `formula/lexer.ts`,
 *   `formula/parser.ts`, `formula/eval.ts`, `formula/deps.ts` — Phase 1).
 */
import type { Address } from "../address.ts";

/**
 * A bare reference to another slot — the AST shape of a binding (§5.1). The only
 * `FormulaAst` variant that exists before Phase 1 builds the real grammar.
 * PROVISIONAL(Q-005).
 */
export interface ReferenceNode {
  readonly type: "reference";
  readonly address: Address;
}

/**
 * The formula AST's root type. PROVISIONAL(Q-005): only `ReferenceNode` exists yet;
 * Phase 1 widens this union rather than replacing it.
 */
export type FormulaAst = ReferenceNode;
