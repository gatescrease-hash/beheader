/**
 * edge.ts — Dependency edges between slots.
 *
 * IMPLEMENTS: PROJECT_BRIEF §5.1 ("Edges"). Load-bearing per Rule 3 (§6 trigger-2 file).
 * LAYER: engine (pure). May import: engine/* only.
 *        NEVER imports: DOM, window, document, canvas, render/*.
 *
 * WHAT THIS IS
 *   "An Edge is `sourceSlot → dependentSlot`" (§5.1): the dependent slot's value
 *   depends on the source slot's value. Field names below match that sentence
 *   exactly, per PROCESS_BRIEF §5.1's vocabulary lock.
 *
 * INVARIANTS UPHELD HERE
 *   - Edges are DATA, not relationships hand-maintained by callers. §5.1: "Users
 *     never create edges by hand; edges are always *derived* from a formula AST
 *     or a schema declaration. Re-derive them; never hand-maintain them." This
 *     file defines only the shape an edge takes once derived — deriving the edge
 *     set from stored ASTs/schema declarations is mutation.ts's job (step 3 of
 *     the mutation loop, §5.1), not built yet.
 *
 * NOT DONE HERE
 *   - Deriving edges from formula ASTs (formula/deps.ts's extractDependencies) or
 *     from a schema's declared derived-slot dependencies (primitives/schema.ts).
 *   - Detecting cycles over a set of edges (graph/cycles.ts).
 *   - Topological evaluation order from a set of edges (graph/eval.ts).
 */
import type { Address } from "../address.ts";

/**
 * A single dependency: `dependentSlot`'s value depends on `sourceSlot`'s value.
 * Plain data — Edges are rebuilt wholesale on every mutation (Rule 5) from
 * whatever formula ASTs and schema declarations currently exist, never patched
 * incrementally and never constructed by anything outside that re-derivation.
 */
export interface Edge {
  readonly sourceSlot: Address;
  readonly dependentSlot: Address;
}
