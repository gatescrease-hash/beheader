/**
 * mutation.ts — THE single transactional channel for state change (PROJECT_BRIEF
 * Rule 2). This cycle builds exactly one piece of it: edge derivation (§5.1
 * mutation-loop step 3), deliberately split out from the full 8-step loop —
 * see WHAT THIS IS.
 *
 * IMPLEMENTS: PROJECT_BRIEF §5.1 step 3 ("Re-derive ALL edges from stored
 * formula ASTs and schema declarations (static and dynamic). Per Rule 5,
 * rebuild the whole edge set rather than tracking which slots were affected.").
 * Load-bearing per Rule 3 (§6 trigger-2 file: mutation.ts) and PROCESS_BRIEF §6
 * trigger-3 (new engine file).
 * LAYER: engine (pure). May import: engine/* only.
 *        NEVER imports: DOM, window, document, canvas, render/*.
 *
 * WHAT THIS IS
 *   `deriveEdges(objects)` rebuilds the ENTIRE `Edge[]` for a document from
 *   scratch (Rule 5 — no incremental tracking), by walking two sources for
 *   every object, per §5.1:
 *
 *   1. Every `formula`-kind slot's stored AST. Phase 0's `FormulaAst` has
 *      exactly one variant (`ReferenceNode`, PROVISIONAL(Q-005)) — a binding —
 *      so "walking the AST" is just reading its one `address` field. That
 *      address becomes an edge's `sourceSlot`; the formula slot's OWN address
 *      becomes `dependentSlot`.
 *   2. Every schema-declared derived slot's dependencies, resolved via
 *      `primitives/schema.ts`'s `derivedSlotDependencyAddresses` (which is the
 *      ONLY place a dynamic dependency resolver may run, per that file's own
 *      header — precisely because this IS edge-derivation time). Each resolved
 *      address becomes a `sourceSlot`; the derived slot's own path (already
 *      known from the schema entry) becomes `dependentSlot`.
 *
 *   THE PROBLEM CASE 1 ABOVE ACTUALLY SOLVES: a formula slot's OWN address
 *   needs a real PATH (`readonly string[]`), not just the string key it is
 *   stored under in `GraphObject.slots` (`slotKey(path)`, node.ts). There is no
 *   sanctioned inverse of `slotKey` (STATUS.md's gotchas; 0011's own log
 *   entry hit this exact wall for derived slots and solved it by going through
 *   the schema instead of decomposing a key — see `findDerivedSlotSchemaByKey`
 *   in `graph/eval.ts`). Derived slots already had an escape hatch: their path
 *   is declared directly on `DerivedSlotSchema.path`. Formula slots had no such
 *   declaration anywhere — `primitives/schema.ts` explicitly deferred "an
 *   object type's FULL slot set" as NOT DONE, pending a concrete need.
 *
 *   This cycle IS that concrete need, so `primitives/schema.ts` was widened
 *   (not this file) with `ObjectSchema.nonDerivedSlotPaths`: the full list of
 *   paths a type's `literal`/`formula` slots occupy (PATHS only — not a
 *   default-kind declaration; see that file's header). `deriveEdges` below
 *   walks THAT list, re-derives each path's key via `slotKey` (never inverts
 *   one), looks the slot up, and only emits an edge if what it finds is
 *   currently `formula`-kind (a `literal` slot has no inbound edges — same
 *   table, §5.1). This is the same "re-derive the key you need, never invert
 *   the one you have" discipline D-010 already established, applied to a case
 *   that had no schema-side escape hatch until now.
 *
 * INVARIANTS UPHELD HERE
 *   - Full rebuild from scratch, every call (Rule 5) — no memoization, no
 *     incremental bookkeeping, mirrors `graph/cycles.ts` and `graph/eval.ts`'s
 *     own from-scratch-every-call discipline.
 *   - Dynamic dependency resolution happens HERE and only here (per
 *     `primitives/schema.ts`'s header) — `derivedSlotDependencyAddresses` is
 *     called from this function and nowhere else in this cycle's code.
 *   - An object of a type with no schema entry yet (every `ObjectType` besides
 *     `value`/`add` today) contributes no edges at all — honest, not a
 *     placeholder, same stance `getObjectSchema` itself takes.
 *   - Never throws. A `nonDerivedSlotPaths` entry with nothing (or a
 *     `derived`/malformed slot) at its key is skipped, not indexed into
 *     blindly — a document mutation.ts's own future object-creation step
 *     would never produce, but this function does not trust that.
 *
 * NOT DONE HERE (the rest of `mutation.ts`, later cycles)
 *   - Stage (clone), apply an operation, validate integrity (§5.1.1 —
 *     dangling-edge rejection), validate acyclicity (`graph/cycles.ts`,
 *     already built — reject and format via `address.ts`'s `formatAddress`,
 *     NEVER `addressKey`, per D-015), evaluate (`graph/eval.ts`, already
 *     built), commit + journal. All of §5.1's steps 1-2 and 4-8.
 *   - The batch mutation form (§5.1, required from day one).
 *   - Any operation shape (`setLiteral`, `link`, object creation/deletion) —
 *     this cycle derives edges from whatever `GraphObject[]` it is handed; it
 *     does not produce one.
 *   - Range expansion (`A1:B4` → concrete cell dependencies, §5.3) and
 *     reference adjustment on table resize (§5.4) — both Phase 2/4 concerns,
 *     irrelevant while `formula/ast.ts` has only `ReferenceNode`.
 */
import { derivedSlotDependencyAddresses, getObjectSchema } from "./primitives/schema.ts";
import type { Edge } from "./graph/edge.ts";
import { slotKey, type GraphObject } from "./graph/node.ts";

/**
 * Rebuilds the full `Edge[]` for `objects`, from every stored formula AST and
 * every schema-declared derived slot's dependencies (§5.1 step 3). See the
 * file header for why this needs `primitives/schema.ts`'s
 * `nonDerivedSlotPaths` rather than reconstructing a formula slot's own
 * address from its `GraphObject.slots` key.
 *
 * Never throws. An object whose type has no schema entry yet contributes no
 * edges (honest, not an error — most `ObjectType`s have no schema until their
 * phase arrives). Order is not significant — this is a fresh rebuild every
 * call (Rule 5), consumed by `graph/cycles.ts` and `graph/eval.ts`, both of
 * which build their own adjacency and do not care about `edges`' own order.
 */
export function deriveEdges(objects: readonly GraphObject[]): readonly Edge[] {
  const edges: Edge[] = [];

  for (const object of objects) {
    const schema = getObjectSchema(object.type);
    if (schema === undefined) {
      // No schema entry for this type yet (see file header) — nothing to
      // derive. Not an error: most ObjectType members have no entry until
      // their phase lands (primitives/schema.ts's own stance).
      continue;
    }

    // Source 1: every formula-kind slot's stored AST. Phase 0's FormulaAst has
    // exactly one variant, a bare reference (PROVISIONAL(Q-005)) — "walking
    // the AST" is reading its one `address` field.
    for (const path of schema.nonDerivedSlotPaths) {
      const slot = object.slots[slotKey(path)];
      if (slot === undefined || slot.kind !== "formula") {
        // Either this path isn't populated on this particular object (a
        // malformed/incomplete fixture — mutation.ts's future object-creation
        // step should never produce one), or it's currently `literal`, which
        // has no inbound edges (§5.1's slot-kind table). Either way: nothing
        // to derive for this path.
        continue;
      }
      edges.push({
        sourceSlot: slot.ast.address,
        dependentSlot: { objectId: object.id, path },
      });
    }

    // Source 2: every schema-declared derived slot's dependencies, resolved
    // NOW (edge-derivation time) — the only moment a dynamic resolver may run
    // (primitives/schema.ts's header; Rule 6).
    for (const derivedSlotEntry of schema.derivedSlots) {
      const dependencyAddresses = derivedSlotDependencyAddresses(object, derivedSlotEntry.dependencies);
      for (const sourceSlot of dependencyAddresses) {
        edges.push({
          sourceSlot,
          dependentSlot: { objectId: object.id, path: derivedSlotEntry.path },
        });
      }
    }
  }

  return edges;
}
