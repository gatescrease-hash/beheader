/**
 * deps.ts — Total walks over a `FormulaAst`: dependency extraction, and the two
 * address-adjustment passes table resize needs (PROJECT_BRIEF §5.3/§5.4/§9).
 *
 * IMPLEMENTS: §5.3's "eager total dependency extraction vs. lazy short-circuit
 * evaluation" section — the EAGER half — plus **D-029**'s rider ("`deps.ts` treats
 * both forms IDENTICALLY and remains EAGER and TOTAL over both") and **D-028**
 * (`extractDependencies` yields NOTHING for an `ErrorNode`: "the absence of a
 * dependency, made explicit").
 * LAYER: engine (pure). May import: engine/* only.
 *        NEVER imports: DOM, window, document, canvas, render/*.
 *
 * WHAT THIS IS
 *   `extractDependencies(ast)` walks the ENTIRE AST and returns every address it
 *   *could* read — BOTH branches of every `IF`, BOTH syntactic forms of `AND`/`OR`/
 *   `NOT` — never just the branch that would run. §5.3 is explicit this is not a bug:
 *   "You cannot know which branch is live without evaluating, and which branch is live
 *   changes constantly — so the graph must subscribe to all of them." Nothing here
 *   evaluates anything or has any notion of "taken", which is what makes it eager and
 *   total BY CONSTRUCTION rather than by a special case: the walk recurses into every
 *   child unconditionally, so `a AND b` and `AND(a, b)` produce identical dependency
 *   sets without this file ever knowing `"AND"` is special.
 *
 *   `RangeNode` is reported as its OWN shape — a `RangeDependency` holding the two
 *   endpoint addresses — never flattened per cell. §5.3: "Store a range in the AST as
 *   an endpoint pair... **Expand to concrete slot dependencies at edge-derivation
 *   time**." That is `mutation.ts`, a different and later moment, and expanding needs
 *   the table's CURRENT dimensions — graph state this file is never handed
 *   (`extractDependencies` takes only an `ast`, so the same walk serves cell formulas,
 *   text formulas, and bindings alike). Collapsing a range to just its two endpoints
 *   would silently lose every cell BETWEEN them — the D-017 failure class (an edge
 *   silently missing) reached from a new angle.
 *
 *   Dependencies are NOT deduplicated: `a.v + a.v` yields two entries. A duplicate
 *   edge is harmless to every consumer (`detectCycle` and `evaluate` both build their
 *   own adjacency), and deduplicating would be extra work for a property nothing
 *   needs (Rule 5).
 *
 *   `rewriteAddressesInAst` and `repairAddressesInAst` are two more total walks over
 *   the same shapes, for §5.4's reference adjustment. They are SIBLINGS of
 *   `extractDependencies` (same shapes, same totality) — the reused thing is the
 *   "walk every `FormulaAst` shape" switch, not any dependency-specific logic — and
 *   they are two, not one, for a reason (**D-052**): `rewriteAddressesInAst` is
 *   ADDRESS-level, `(Address) => Address`, which is all INSERTION needs; DELETION
 *   cannot be expressed that way, because turning a `ReferenceNode` into an
 *   `ErrorNode` is a NODE-level replacement and a range endpoint's clamped value
 *   depends on BOTH endpoints at once. So `repairAddressesInAst` is node-level: its
 *   callbacks may report `"deleted"`, which the WALK — not the caller — turns into a
 *   fresh `ErrorNode` at exactly that position (D-028: "its OWN AST node, never a
 *   widened `LiteralNode`").
 *
 * INVARIANTS UPHELD HERE
 *   - Never throws and never fails. Every node either contributes a dependency or
 *     delegates to its children. The `default` arm exists for compile-time
 *     exhaustiveness and as defence against a hand-edited or loaded AST bypassing the
 *     type system (`document.ts` casts a loaded formula slot's `ast` unchecked) — it
 *     contributes nothing rather than throwing, consistent with every other stage.
 *   - Order is not significant — a fresh walk every call (Rule 5).
 *   - An `ErrorNode` yields NOTHING (D-028); a `LiteralNode` yields nothing (it has no
 *     address to read).
 *
 * NOT DONE HERE
 *   Turning a `RangeDependency` into concrete per-cell edges. Four concerns stay
 *   separate and must not be collapsed here: EDGE expansion is `mutation.ts`'s
 *   `deriveEdges`; VALUE expansion is `graph/eval.ts`'s `readRange` feeding
 *   `formula/eval.ts`; the bounded enumeration both share is `primitives/table.ts`'s
 *   `enumerateRangeCellAddresses`; range PLACEMENT is `parser.ts`'s (D-045).
 */
import type { Address } from "../address.ts";
import type { FormulaAst } from "./ast.ts";

/** A single resolved-address dependency — one `ReferenceNode` in the walked AST. */
export interface ReferenceDependency {
  readonly kind: "reference";
  readonly address: Address;
}

/**
 * A range dependency — one `RangeNode` in the walked AST, reported as its own endpoint pair
 * rather than flattened into individual cells. See the file header for why: expansion into
 * concrete per-cell dependencies needs the target table's current dimensions, which happens at
 * edge-derivation time (`mutation.ts`), not here.
 */
export interface RangeDependency {
  readonly kind: "range";
  readonly start: Address;
  readonly end: Address;
}

/** Everything `extractDependencies` can report. See each variant's own doc comment. */
export type Dependency = ReferenceDependency | RangeDependency;

/**
 * Walks the entire `ast`, eagerly and totally (§5.3, D-029), and returns every dependency it
 * contains — never just the branch a caller might guess is "live." See the file header for the
 * full rationale, including why `IF`/`AND`/`OR`/`NOT` need no special-casing here in either
 * syntactic form, why a `RangeNode` is reported as its own shape rather than expanded, and why the
 * result is not deduplicated. Never throws.
 */
export function extractDependencies(ast: FormulaAst): readonly Dependency[] {
  const dependencies: Dependency[] = [];
  walk(ast, dependencies);
  return dependencies;
}

/**
 * Rebuilds `ast` with every `ReferenceNode.address` and `RangeNode.start`/`end` passed through
 * `rewrite`, recursing into every operand/argument the same way `walk` above does — the SAME
 * total switch over `FormulaAst`'s shapes, doing a REBUILD instead of an EXTRACT. Used by §5.4's
 * reference-adjustment pass: `rewrite` is typically "shift this address if it names the resized
 * table and its row/column is at-or-after the insertion point; otherwise return it unchanged" —
 * `formula/deps.ts` has no notion of tables, rows, or insertion points itself, matching the same
 * separation of concerns the file header already draws between range PLACEMENT/DEPENDENCY/
 * EVALUATION/ENUMERATION: this is a fifth, distinct concern (address REWRITING) and stays generic
 * over `rewrite` rather than growing table-specific logic here.
 *
 * A `LiteralNode`/`ErrorNode` has no address and is returned AS-IS (not even shallow-copied —
 * nothing about it can change). Never throws, matching `walk`'s own discipline; the `default` arm
 * exists for the identical reason (compile-time exhaustiveness, defensive against a hand-edited or
 * loaded AST).
 */
export function rewriteAddressesInAst(ast: FormulaAst, rewrite: (address: Address) => Address): FormulaAst {
  switch (ast.type) {
    case "literal":
    case "error":
      return ast;
    case "reference":
      return { ...ast, address: rewrite(ast.address) };
    case "range":
      return { ...ast, start: rewrite(ast.start), end: rewrite(ast.end) };
    case "binaryOp":
      return { ...ast, left: rewriteAddressesInAst(ast.left, rewrite), right: rewriteAddressesInAst(ast.right, rewrite) };
    case "unaryOp":
      return { ...ast, operand: rewriteAddressesInAst(ast.operand, rewrite) };
    case "functionCall":
      return { ...ast, args: ast.args.map((arg) => rewriteAddressesInAst(arg, rewrite)) };
    default: {
      const exhaustive: never = ast;
      return exhaustive;
    }
  }
}

/**
 * The DELETE-side sibling of `rewriteAddressesInAst` (see the file header) —
 * repairs `ast` for §5.4's reference-adjustment pass on a row/column deletion,
 * where an address must sometimes be REPLACED, not merely shifted:
 *
 *   - `repairReference` is called with a `ReferenceNode`'s address and returns
 *     either a repaired `Address` (unchanged or shifted) or the literal string
 *     `"deleted"`. This function turns `"deleted"` into a fresh `ErrorNode`
 *     (`{ type: "error", error: "#REF" }`, D-028) at exactly that position —
 *     never a widened `LiteralNode`, never a whole-formula replacement — so
 *     the rest of the formula, and every edge it derives, survives untouched.
 *   - `repairRange` is called with BOTH of a `RangeNode`'s endpoints AT ONCE,
 *     because which new value an endpoint takes (§5.4's "clamps to the
 *     remaining extent") depends on where the OTHER endpoint sits, not on
 *     either endpoint alone — an address-at-a-time callback cannot express
 *     this (D-052's forward note). It returns a repaired `{ start, end }`
 *     pair, or `"deleted"` for a range that named only the removed line
 *     (§5.4: "a range deleted entirely becomes `#REF`"), turned into the same
 *     kind of `ErrorNode`.
 *
 * Like `rewriteAddressesInAst`, this file has no notion of tables, rows, or
 * deletion indices — `repairReference`/`repairRange` carry all of that (see
 * `primitives/table.ts`'s `repairCellAddressForDelete`/
 * `repairRangeEndpointsForDelete`); this function only knows how to walk
 * `FormulaAst`'s seven shapes and where to place an `ErrorNode`. A
 * `LiteralNode`/`ErrorNode` has nothing to repair and is returned AS-IS.
 * Never throws, matching every other walk in this file.
 */
export function repairAddressesInAst(
  ast: FormulaAst,
  repairReference: (address: Address) => Address | "deleted",
  repairRange: (start: Address, end: Address) => { readonly start: Address; readonly end: Address } | "deleted",
): FormulaAst {
  switch (ast.type) {
    case "literal":
    case "error":
      return ast;
    case "reference": {
      const repaired = repairReference(ast.address);
      return repaired === "deleted" ? { type: "error", error: "#REF" } : { ...ast, address: repaired };
    }
    case "range": {
      const repaired = repairRange(ast.start, ast.end);
      return repaired === "deleted" ? { type: "error", error: "#REF" } : { ...ast, start: repaired.start, end: repaired.end };
    }
    case "binaryOp":
      return {
        ...ast,
        left: repairAddressesInAst(ast.left, repairReference, repairRange),
        right: repairAddressesInAst(ast.right, repairReference, repairRange),
      };
    case "unaryOp":
      return { ...ast, operand: repairAddressesInAst(ast.operand, repairReference, repairRange) };
    case "functionCall":
      return { ...ast, args: ast.args.map((arg) => repairAddressesInAst(arg, repairReference, repairRange)) };
    default: {
      const exhaustive: never = ast;
      return exhaustive;
    }
  }
}

function walk(node: FormulaAst, out: Dependency[]): void {
  switch (node.type) {
    case "literal":
      return;
    case "reference":
      out.push({ kind: "reference", address: node.address });
      return;
    case "range":
      out.push({ kind: "range", start: node.start, end: node.end });
      return;
    case "binaryOp":
      walk(node.left, out);
      walk(node.right, out);
      return;
    case "unaryOp":
      walk(node.operand, out);
      return;
    case "functionCall":
      // Unconditional over EVERY argument, regardless of `node.name` — this is what makes both
      // `IF` branches and both `AND`/`OR` syntactic forms eager and total for free (D-029). No
      // function name is ever inspected here.
      for (const arg of node.args) {
        walk(arg, out);
      }
      return;
    case "error":
      // D-028: an ErrorNode yields no dependency — the absence of one, made explicit.
      return;
    default: {
      // Compile-time exhaustiveness (a `tsc` error the moment `FormulaAst` grows a variant),
      // WITHOUT a throw — see the file header's INVARIANTS UPHELD HERE. A hand-edited or loaded
      // AST reaching a shape the compiler believes impossible simply contributes no dependency,
      // the same defensive stance `parser.ts`'s `walkForRangePlacement` takes (0032-REVIEW-phase1).
      const exhaustive: never = node;
      void exhaustive;
      return;
    }
  }
}
