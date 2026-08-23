/**
 * deps.ts — Eager, total dependency extraction over a `FormulaAst` (PROJECT_BRIEF §5.3/§9).
 *
 * IMPLEMENTS: PROJECT_BRIEF §5.3's "Eager total dependency extraction vs. lazy short-circuit
 * evaluation" section, and D-029's binding rider on it ("`deps.ts` treats both forms IDENTICALLY
 * and remains EAGER and TOTAL over both" — `AND`/`OR`/`NOT`'s infix/prefix form and their call
 * form). Also upholds D-028 (`extractDependencies` yields NOTHING for an `ErrorNode` — "the
 * absence of a dependency, made explicit").
 * LAYER: engine (pure). May import: engine/* only.
 *        NEVER imports: DOM, window, document, canvas, render/*.
 *
 * This is an ORDINARY file inside the already-reviewed `formula/` subsystem (0032-REVIEW signed
 * off `parser.ts`; STATUS.md's own words: "`deps.ts` is UNBLOCKED"), not a new subsystem's first
 * file — §6.1 trigger 2 does not apply.
 *
 * WHAT THIS IS
 *   One exported function, `extractDependencies(ast)`, that walks the ENTIRE `FormulaAst` and
 *   returns every address it *could* read — including BOTH branches of every `IF` and BOTH
 *   syntactic forms of `AND`/`OR`/`NOT` (D-029) — never just the branch that would actually run.
 *   §5.3 is explicit that this is not a bug: "You cannot know which branch is live without
 *   evaluating, and which branch is live changes constantly — so the graph must subscribe to all
 *   of them." Nothing here evaluates anything or knows what a branch's condition currently is;
 *   this file has no notion of "taken" at all, which is exactly what makes it eager and total by
 *   construction rather than by a special case.
 *
 *   D-029's own rider is why this file needs NO special-casing of `IF`/`AND`/`OR`/`NOT` by name,
 *   in either form: the walk below recurses into every `FunctionCallNode`'s `args` and every
 *   `BinaryOpNode`/`UnaryOpNode`'s operands UNCONDITIONALLY. `a.v AND b.v` (a `BinaryOpNode`) and
 *   `AND(a.v, b.v)` (a `FunctionCallNode` named `"AND"`) are walked by two different `switch` arms
 *   that both, unconditionally, recurse into every child — so the two forms produce identical
 *   dependency sets for free, without this file ever needing to know `"AND"` is special. The same
 *   is true of `IF(cond, whenTrue, whenFalse)`: it is an ordinary `FunctionCallNode`, and its
 *   three args are walked exactly like any other function's arguments — both branches, always.
 *   This mirrors `parser.ts`'s own `isFunctionNameToken` note that treating a name generically
 *   until something ELSE needs to distinguish it is the simpler, more correct default.
 *
 *   `RangeNode` (`start:end`, §5.3) is reported as its OWN dependency shape — a `RangeDependency`
 *   holding the two endpoint `Address`es — rather than flattened into a `ReferenceDependency` per
 *   cell the range spans. This is a direct, disclosed reading of §5.3's own words: "Store a range
 *   in the AST as an endpoint pair... **Expand to concrete slot dependencies at edge-derivation
 *   time** (step 3 of the mutation loop)." Edge-derivation time is `mutation.ts`'s `deriveEdges`,
 *   a DIFFERENT file and a DIFFERENT, later moment — not this one — and expanding a range into the
 *   individual cells it spans needs the table's CURRENT dimensions (how many rows/columns exist
 *   right now), which is graph state this file is never handed (`extractDependencies` takes only
 *   an `ast`, per §5.3's own "write it once, use it identically for cell formulas, text formulas,
 *   and bindings" — none of which is a table object). Collapsing a `RangeNode` into two
 *   `ReferenceDependency` entries (just its endpoints) would silently lose every cell BETWEEN
 *   them — exactly the D-017 failure class (an edge silently missing) reached from a new angle.
 *   Reporting it as a distinct, disclosed shape keeps that expansion possible later without this
 *   file guessing at it now. `deriveEdges` does not consume this file yet (see NOT DONE HERE);
 *   this is a genuine, disclosed design decision this cycle makes for whichever future cycle wires
 *   the two together, not a mechanical translation of the brief's one sentence on it.
 *
 *   Dependencies are NOT deduplicated. `a.v + a.v` yields TWO `ReferenceDependency` entries for
 *   `a.v`, not one. This matches the only existing precedent for a dependency list in this
 *   codebase: `mutation.ts`'s `deriveEdges` pushes one `Edge` per resolved address from
 *   `derivedSlotDependencyAddresses` with no dedup step of its own, and a duplicate edge is
 *   harmless to every graph algorithm that consumes `Edge[]` (`detectCycle`, `evaluate`) — both
 *   build their own adjacency and neither cares about a repeated entry. Deduplicating here would
 *   be extra work (Rule 5: the dumbest correct implementation, not the shortest data structure)
 *   for a property nothing downstream currently needs.
 *
 * INVARIANTS UPHELD HERE
 *   - `extractDependencies` NEVER throws and never fails — there is no way for a well-formed
 *     `FormulaAst` (the only input this file's type signature admits) to be "malformed" from this
 *     file's point of view the way source text or a token stream can be; every node either
 *     contributes a dependency or delegates to its children. The `default` arm below exists only
 *     for compile-time exhaustiveness (mirrors `parser.ts`'s own `walkForRangePlacement`) and for
 *     defence against a hand-edited/loaded AST bypassing the type system (`document.ts` casts a
 *     loaded formula slot's `ast` unchecked, per 0032-REVIEW-phase1's own finding about that file)
 *     — it contributes no dependency rather than throwing, consistent with every other stage's
 *     "never throw" discipline even though this file has no error return channel to report through.
 *   - Order is NOT significant — a fresh walk every call (Rule 5), same stance `deriveEdges`
 *     itself documents for its own output.
 *   - An `ErrorNode` (D-028) yields NOTHING — walking into `#REF` where a reference used to be
 *     contributes no address, "the absence of a dependency, made explicit" (D-028's own words).
 *   - `LiteralNode` yields NOTHING — a literal has no address to read.
 *
 * NOT DONE HERE
 *   Wiring this into `mutation.ts`'s `deriveEdges` (which still derives an edge only from the
 *   narrower `ReferenceNode` shape, per its own TEMPORARY `findUnsupportedFormulaAsts` check) or
 *   into `graph/eval.ts` — both are Phase 2's job ("wire the formula engine into cell slots"),
 *   the same cycle that expands a `RangeDependency` into concrete per-cell edges using the target
 *   table's actual current dimensions, and the same cycle that deletes `findUnsupportedFormulaAsts`
 *   (STATUS.md's own carried note, extended by D-031: that same cycle must also extend the
 *   value-legality walk to formula ASTs). `functions.ts` and `formula/eval.ts` — not built.
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
