/**
 * edge.ts — Dependency edges between slots.
 *
 * IMPLEMENTS: PROJECT_BRIEF §5.1 ("Edges"). Load-bearing (§6.2).
 * LAYER: engine (pure). May import: engine/* only.
 *        NEVER imports: DOM, window, document, canvas, render/*.
 *
 * WHAT THIS IS
 *   "An Edge is `sourceSlot → dependentSlot`" (§5.1): the dependent slot's value
 *   depends on the source slot's value. Field names match that sentence exactly, per
 *   PROCESS_BRIEF §5.1's vocabulary lock. Plus `addressKey`, the document-wide
 *   canonical key the graph traversals use.
 *
 * INVARIANTS UPHELD HERE
 *   - Edges are DATA, not relationships hand-maintained by callers. §5.1: "Users
 *     never create edges by hand; edges are always *derived* from a formula AST
 *     or a schema declaration. Re-derive them; never hand-maintain them." This
 *     file defines only the shape an edge takes once derived.
 *
 * NOT DONE HERE
 *   - Deriving edges (`mutation.ts`'s `deriveEdges`, step 3 of the mutation loop).
 *   - Cycle detection (`graph/cycles.ts`) and topological order (`graph/eval.ts`) —
 *     both consume `addressKey`, but the traversals live there.
 */
import { slotKey } from "./node.ts";
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

/**
 * Canonicalizes a full `Address` into one string, so the traversals over `Edge[]`
 * (`graph/cycles.ts`'s DFS, `graph/eval.ts`'s topological sort) can use it as a
 * `Map`/`Set` key instead of comparing `Address`es structurally on every lookup.
 *
 * The document-wide counterpart to `node.ts`'s `slotKey`, which canonicalizes a path
 * WITHIN one already-known object. `addressKey` adds the `objectId`, because a
 * traversal over the whole document must distinguish two different tables' `cells.A1`.
 * Declared once here, beside `Edge`, rather than reimplemented in each traversal
 * (D-014's principle).
 *
 * Collision-safe for the same reason `slotKey` is: object IDs are `obj_<n>` (D-002)
 * and cannot contain "::", and `slotKey`'s output cannot either (its segments come
 * from `address.ts`'s `PATH_SEGMENT_PATTERN`).
 */
export function addressKey(address: Address): string {
  return `${address.objectId}::${slotKey(address.path)}`;
}
