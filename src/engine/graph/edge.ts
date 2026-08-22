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
 *   - Detecting cycles over a set of edges (graph/cycles.ts) or computing a
 *     topological evaluation order from one (graph/eval.ts) — both consume
 *     `addressKey` below, but the traversal algorithms themselves live there.
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
 * Canonicalizes a full `Address` (an object id plus a stored path) into a
 * single string, so the graph-traversal algorithms built over `Edge[]`
 * (`graph/cycles.ts`'s DFS, `graph/eval.ts`'s topological sort) can use it as a
 * `Map`/`Set` key instead of comparing `Address` objects by structural
 * equality on every lookup.
 *
 * This is the document-wide counterpart to `node.ts`'s `slotKey`, which only
 * canonicalizes a path WITHIN one already-known object (for `GraphObject.slots`
 * lookups). `addressKey` adds the `objectId`, because a graph algorithm walking
 * the whole document must distinguish, say, two different tables' `cells.A1`.
 * Declared once, here, beside `Edge` — the type both traversal modules consume
 * — rather than being reimplemented in each of them (same reasoning as D-014's
 * `isErrorValue`: the second copy is not hypothetical, `eval.ts` needs this
 * exact key next).
 *
 * Safe for the same reason `slotKey` is: object IDs are `obj_<n>` (D-002) and
 * cannot contain "::", and `slotKey`'s own output cannot either (its segments
 * come from `address.ts`'s `PATH_SEGMENT_PATTERN`), so no two distinct
 * Addresses can collide on this key.
 */
export function addressKey(address: Address): string {
  return `${address.objectId}::${slotKey(address.path)}`;
}
