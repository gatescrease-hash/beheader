/**
 * mutation.ts — THE single transactional channel for state change (PROJECT_BRIEF
 * Rule 2). Edge derivation (§5.1 step 3, cycle 0013), integrity validation
 * (step 4, §5.1.1, cycle 0015; widened to check schema<->slot reconciliation
 * in BOTH directions, D-018, cycle 0019), their composition with the already-
 * built `detectCycle` (step 5) and `evaluate` (step 7) into
 * `deriveValidateAndEvaluate` (cycle 0016), and `mutate(objects, operations,
 * journal)` wrapping that composition with the remaining steps — stage/clone
 * (step 1, a real recursive clone as of D-019/cycle 0019), apply every
 * operation in the batch to that ONE clone (step 2), discard-on-reject
 * (step 6), and commit + journal (step 8, cycle 0017) — all exist already,
 * making this file's public surface the FULL §5.1 mutation loop. Cycle 0020
 * closed 0018-REVIEW-phase0's last REVISE item, **D-020** (the batch form):
 * `mutate` accepts a LIST of operations, applied to a single clone, validated
 * and evaluated once, committing all-or-nothing, appending exactly one
 * journal entry holding the whole list — never N separate single-operation
 * calls. THIS cycle (0022) adds `Operation`'s SECOND variant,
 * `DeleteObjectOperation` (§5.1.1's `delete <object>`), closing Phase 0
 * acceptance clause 3 ("deleting a slot with dependents is rejected") — no
 * new rejection mechanism needed, `validateIntegrity`'s existing
 * dangling-reference check already IS that mechanism (see
 * `DeleteObjectOperation`'s own doc comment) — and makes the batch's
 * target-existence check (D-021/D-023) fold-aware: 0018-REVIEW-phase0's
 * carried forward-hazard note (0021-REVIEW, constraint 1) warned that ANY
 * operation kind able to add or remove an object invalidates checking
 * targets once, up front, against the pre-batch `objects` — this is the
 * first such kind, so this cycle fixes it (see `mutate`'s doc comment for the
 * simulated-existence walk) rather than deferring it again. See WHAT THIS IS,
 * `mutate`.
 *
 * IMPLEMENTS: PROJECT_BRIEF §5.1 step 3 ("Re-derive ALL edges from stored
 * formula ASTs and schema declarations (static and dynamic). Per Rule 5,
 * rebuild the whole edge set rather than tracking which slots were affected.")
 * and step 4 / §5.1.1 ("Validate integrity. Reject if any formula references a
 * slot that does not exist, or if the mutation would delete a slot that still
 * has inbound dependents without repairing them."), plus **D-017 part 2**
 * (closed cycle 0015) and **D-018** (both directions of the same
 * reconciliation, closed cycle 0019 — see WHAT THIS IS, `validateIntegrity`);
 * step 5 ("Validate acyclicity... reject on cycle, naming every slot in the
 * cycle.") and step 7 ("Evaluate...") composed at cycle 0016 in
 * `deriveValidateAndEvaluate`; step 1 ("Stage. Deep-clone the current
 * document state.") — **D-019**-faithful, closed cycle 0019 — step 2 ("Apply
 * the mutation to the clone."), step 6 ("On rejection: discard the clone
 * entirely... Prior state is untouched."), and step 8 ("Commit. Swap the
 * clone in... append the mutation to the journal"), plus Rule 2's journal
 * requirement ("the mutation API MUST record an append-only journal of
 * committed mutations from day one") and **D-021** (an operation naming a
 * nonexistent object is rejected, not journalled as a no-op, closed cycle
 * 0019) — see WHAT THIS IS, `mutate`. Also §5.1's **"Batch mutations
 * (required)"** subsection ("The API must accept a list of operations
 * applied to a single clone, validated and evaluated once, committing
 * all-or-nothing... Document loading MUST use a batch.") — **D-020**, closed
 * cycle 0020. THIS cycle (0022) implements §5.1.1's own worked example of the
 * REJECT path ("`delete <object>`... where a silent break would go
 * unnoticed") via `DeleteObjectOperation`, closing PROJECT_BRIEF §6 Phase 0
 * acceptance clause 3 ("deleting a slot with dependents is rejected") — see
 * WHAT THIS IS, `DeleteObjectOperation`'s own doc comment. §5.1.1's REPAIR
 * path (table row/column deletion rewriting references to `#REF`) is
 * deliberately NOT implemented here — see NOT DONE HERE.
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
 *   1. Every `formula`-kind slot AT A SCHEMA-DECLARED NON-DERIVED PATH — not,
 *      as §5.1 step 3's own wording ("re-derive ALL edges from stored formula
 *      ASTs") would have it, every formula slot the object actually carries.
 *      Phase 0's `FormulaAst` has exactly one variant (`ReferenceNode`,
 *      PROVISIONAL(Q-005)) — a binding — so "walking the AST" is just reading
 *      its one `address` field. That address becomes an edge's `sourceSlot`;
 *      the formula slot's OWN address becomes `dependentSlot`.
 *
 *      READ THAT NARROWING AS A HAZARD, NOT A DETAIL — see D-017. This
 *      function's domain is the SCHEMA's slot set; `graph/eval.ts`'s domain is
 *      the OBJECT's own `Object.keys(object.slots)`. Where the two disagree —
 *      an object carrying a formula slot its schema does not declare — the
 *      slot still gets evaluated, but it is never ordered and its edges never
 *      exist. Verified by probe at 0014-REVIEW-phase0: a genuine three-slot
 *      cycle running through one undeclared slot produces an edge set that
 *      `detectCycle` reports `{ hasCycle: false }` on, so step 5 ACCEPTS the
 *      document and step 7 then quietly fills all three slots with `#REF`.
 *      Nothing in THIS file can detect that; making it loud is step 4's job
 *      (§5.1.1), and D-017 requires it. Note also that `nonDerivedSlotPaths`
 *      is a fixed list of paths and so cannot express a slot FAMILY (a table's
 *      `cells.A1`…, D-005/D-009): Phase 4 must revisit this mechanism, not
 *      merely add entries to it.
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
 * `validateIntegrity(objects, edges)` — §5.1 step 4 / §5.1.1, and where D-017
 * part 2 AND D-018 both land. Takes a candidate post-apply object list and
 * its freshly `deriveEdges`-derived edge set (step 2's "apply" and step 3 are
 * NOT this function's job — see NOT DONE HERE; it is handed the result), and
 * rejects with a human-readable message, or passes, in THREE checks, run in
 * this order:
 *
 *   1. **D-017 part 2, first** (per 0014-REVIEW-phase0's own constraint: "the
 *      first thing step 4 must do"). For every object THAT HAS a schema entry,
 *      every slot currently `formula` or `derived` kind must have a key
 *      matching one of that schema's declared paths
 *      (`nonDerivedSlotPaths`/`derivedSlots`, both re-derived via `slotKey` —
 *      never compared by inverting the OBJECT's key, same discipline as
 *      `deriveEdges` itself). A mismatch means `deriveEdges` silently dropped
 *      this slot's edges (D-017's own finding) — reject before `detectCycle`
 *      ever runs on a graph that cannot be trusted to be total. An object
 *      whose type has NO schema entry at all is skipped, not flagged — D-017's
 *      one permitted exception, because §6's build order guarantees such a
 *      type carries no formula slots yet.
 *   2. **D-018, the OTHER direction** (`findSchemaSlotKindMismatches`,
 *      0018-REVIEW-phase0 — closed THIS cycle, previously a disclosed KNOWN
 *      GAP). D-017 above rejects a slot the object carries that its schema
 *      does NOT declare; this rejects the reverse two mismatches: (a) a
 *      schema-declared derived path that is missing its `derived`-kind slot
 *      entirely — the exact shape a §5.11 load produces, since
 *      `DerivedSlot.value` is never serialized — which is precisely what
 *      makes `dependentSlot` dangling in check 3 below WITHOUT this check
 *      catching it first; and (b) a slot whose actual kind disagrees with
 *      its schema position at all (`derived` at a `nonDerivedSlotPaths` path,
 *      or non-`derived` at a schema-declared derived path) — §5.1: "`derived`
 *      is fixed by schema and can never be converted." Named via
 *      `formatAddress` directly (`formatSchemaAddress` below): unlike D-017's
 *      case, every path this check inspects comes FROM the schema, so a real
 *      `Address` always exists — no `describeUndeclaredSlot`-style exception
 *      needed here.
 *   3. **Dangling references** (§5.1.1's stated wording: "any formula
 *      references a slot that does not exist"). For every edge, its
 *      `sourceSlot` must `resolveSlot` (`graph/node.ts`) against `objects`.
 *      `dependentSlot` is deliberately NOT checked here — checks 1 and 2
 *      above are what make that safe: an edge's `dependentSlot` can only be
 *      dangling via D-017's or D-018's own failure modes, both already
 *      rejected earlier in this same call. This ONE check is both halves of
 *      §5.1.1's step-4 sentence at once: a plain bad reference (a formula
 *      typo'd at an object that never existed) and "the mutation would
 *      delete a slot that still has inbound dependents" are the SAME failure
 *      viewed from opposite ends of the same edge — deleting a slot that
 *      formulas elsewhere still reference makes exactly this check fail,
 *      with no separate before/after diff needed (Rule 5: recheck the whole
 *      graph, don't track what changed). §5.1.1 clause 1's own wording —
 *      "naming every dependent" — is why the message names the DEPENDENT
 *      side via `formatAddress`, never the missing source: the source's
 *      object may be gone, so there is nothing safe to format there, and
 *      D-015 forbids leaking its raw `objectId` into the message anyway.
 *
 *   A genuinely new sub-problem D-017's check hits and D-010/D-015's existing
 *   guidance does not cover: naming an UNDECLARED slot (check 1) needs an
 *   `Address` for `formatAddress`, but by definition no schema declares this
 *   slot's path — there is nothing to look up. `describeUndeclaredSlot` below
 *   is a deliberate, disclosed exception (see its own doc comment) rather than
 *   an application of the "invert `slotKey`" pattern this project has twice
 *   ruled out (D-010; STATUS's "never `key.split(\".\")`"): those rulings
 *   solved "I need a slot's path and something already declares it schema-
 *   side"; this is the one case where nothing does, by construction. Check 2
 *   has no such exception to make — see its own paragraph above.
 *
 * INVARIANTS UPHELD HERE (validateIntegrity)
 *   - Never throws, same as every other function in this module.
 *   - Runs all three checks over the WHOLE graph from scratch, every call
 *     (Rule 5) — no diffing against a "previous" object list, matching
 *     `deriveEdges`, `detectCycle`, and `evaluate`'s own from-scratch
 *     discipline.
 *   - Does not call `detectCycle` or `evaluate` itself — acyclicity (step 5)
 *     and evaluation (step 7) are separate, already-built steps this function
 *     does not duplicate or anticipate.
 *
 * `deriveValidateAndEvaluate(objects)` — composes all four pieces above
 * (`deriveEdges` → `validateIntegrity` → `detectCycle` → `evaluate`) into the
 * one sequence §5.1 steps 3-5 and 7 describe, in that order. See its own doc
 * comment for why the ORDER is the entire point (0014-REVIEW-phase0's
 * constraint 1) rather than something worth leaving to each future call site.
 * This is the first point where Phase 0 acceptance clause 2's REJECTION half
 * ("a cycle is rejected with the offending slots named") is demonstrable
 * end-to-end — see STATUS.md for why the clause's OTHER half ("prior state
 * provably unchanged", D-016) is NOT claimed by this cycle.
 *
 * INVARIANTS UPHELD HERE (deriveValidateAndEvaluate)
 *   - Runs the four steps in the fixed order §5.1 specifies and
 *     0014-REVIEW-phase0 requires: validateIntegrity's D-017/D-018 checks
 *     MUST see the graph before detectCycle does, or a document whose only
 *     cycle runs through an undeclared or schema-mismatched slot gets a false
 *     "no cycle" pass instead of the rejection those checks exist to give it.
 *   - Never mutates `objects`. Every step it calls is pure and returns new
 *     data; a rejection here means the candidate `objects` this function
 *     received are simply never returned as the `ok: true` arm's evaluated
 *     result — there is nothing here for a caller's own prior state to be
 *     corrupted by, because this function was never given write access to it.
 *   - Never throws, matching every function it composes.
 *
 * `mutate(objects, operations, journal)` — §5.1 steps 1, 2, 6, 8, wrapping
 * `deriveValidateAndEvaluate` (steps 3-5, 7), widened to the BATCH form
 * (D-020, closed THIS cycle). See its own doc comment for the full sequence,
 * INCLUDING the empty-batch and D-021 target-existence checks that now run
 * before step 1 even starts, over every operation in the list. One operation
 * kind exists so far: `SetSlotOperation` (`{ kind: "setSlot", address, slot }`),
 * the minimal primitive underneath what §5.10's `link`/`unlink`/`set` commands
 * will eventually call — building those commands themselves is Phase 3's job
 * (§5.10), not this cycle's.
 *
 * INVARIANTS UPHELD HERE (mutate)
 *   - **D-020, closed THIS cycle**: accepts a LIST of operations, applies all
 *     of them to ONE clone (folded left-to-right, so a later operation in the
 *     batch sees an earlier one's effect), then derives edges / validates /
 *     evaluates exactly ONCE over the fully-applied candidate — never once
 *     per operation. "Committing all-or-nothing" holds structurally: nothing
 *     between the fold and the single `deriveValidateAndEvaluate` call can
 *     partially commit, because nothing is committed until that one call
 *     returns `ok: true`.
 *   - **D-021, closed cycle 0019**: ANY operation in the batch whose
 *     `address.objectId` names no object in `objects` rejects the WHOLE
 *     batch before anything else runs — never applied as a no-op for that one
 *     operation while the rest proceed, and never journalled. An empty batch
 *     (`operations.length === 0`) is rejected the same way, for the same
 *     "no false record in the journal" reason. See `mutate`'s own doc comment
 *     for both messages' D-015-respecting shape.
 *   - Implements Rule 5's staging mechanism literally: `cloneObjects` performs
 *     a real recursive deep clone (D-019, closed cycle 0019 — see its own doc
 *     comment for why a JSON round-trip was not faithful enough) ONCE, before
 *     any operation in the batch is applied, so "applying to the clone" (§5.1
 *     step 2) never touches the caller's original `objects` reference even in
 *     principle, not merely by the accident of every downstream function
 *     already being pure.
 *   - On rejection, returns `deriveValidateAndEvaluate`'s own `{ ok: false,
 *     message }` untouched (step 6: "discard the clone entirely... return a
 *     failure"). `objects` and `journal` are both simply never reassigned —
 *     the caller's references are exactly what they were before the call.
 *   - On success, appends exactly one `MutationJournalEntry` — holding the
 *     WHOLE operation list just committed, not one entry per operation — to
 *     `journal` (Rule 2, "from day one"; D-020: "one committed batch is one
 *     journal entry") and returns the evaluated result as the new state
 *     (step 8's "swap in"). This file does not itself hold "the current
 *     document" between calls — see NOT DONE HERE — so "commit" here means
 *     "return the new state for whichever caller owns it to adopt," not an
 *     internal assignment.
 *   - Never throws, matching every function it composes.
 *
 * NOT DONE HERE (the rest of `mutation.ts`, later cycles)
 *   - Holding "the current document" as persistent state across calls —
 *     Rule 2 forbids exactly that ("no closures... stored inside graph
 *     state"): `mutate` is a pure function of its three arguments, and
 *     whatever calls it (a future `document.ts`, or a command handler) owns
 *     the current `objects`/`journal` pair and decides what to do with a
 *     rejection.
 *   - Any operation kind beyond `SetSlotOperation`/`DeleteObjectOperation`
 *     (object CREATION in particular, `explode`, vertex add/remove, table
 *     resize) — those belong to the phases/slices that introduce the state
 *     they touch (`document.ts` for creation, Phase 2-6 for the rest), same
 *     stance `primitives/schema.ts` already takes on its own per-type
 *     entries. Note for whichever slice adds `CreateObjectOperation`: the
 *     existence check below is already fold-aware and variant-aware (see
 *     `mutate`'s doc comment) — a creation variant needs to ADD an id to the
 *     same simulated `Set`, not invent a second mechanism.
 *   - The slot-deletion REPAIR path (§5.1.1's second legal option, rewriting
 *     inbound references to `#REF`) — Phase 0 has no type that uses it (only
 *     table row/column deletion does, Phase 2/4), so `validateIntegrity`'s
 *     dangling check always takes the Reject branch. Nothing here decides
 *     between the two; that belongs to whichever future operation needs it.
 *   - Range expansion (`A1:B4` → concrete cell dependencies, §5.3) and
 *     reference adjustment on table resize (§5.4) — both Phase 2/4 concerns,
 *     irrelevant while `formula/ast.ts` has only `ReferenceNode`.
 *   - Undo itself (only the journal DATA this stores it for, per Rule 2 and
 *     PROJECT_BRIEF §8's deferred list, which defers the undo/redo UI only).
 */
import { formatAddress, isAddressError, type Address } from "./address.ts";
import { derivedSlotDependencyAddresses, getObjectSchema } from "./primitives/schema.ts";
import { detectCycle } from "./graph/cycles.ts";
import { addressKey, type Edge } from "./graph/edge.ts";
import { evaluate } from "./graph/eval.ts";
import { resolveSlot, slotKey, type GraphObject, type Slot } from "./graph/node.ts";

/**
 * Rebuilds the full `Edge[]` for `objects`, from every formula slot at a
 * schema-declared non-derived path — NOT from every stored formula AST; see
 * the header's hazard note and D-017 — and from every schema-declared derived
 * slot's dependencies (§5.1 step 3). See the
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

/**
 * The result of `validateIntegrity` (§5.1 step 4 / §5.1.1). `ok: false` means
 * reject the mutation outright — the caller (a later cycle's full loop)
 * discards the clone entirely (§5.1 step 6) rather than proceeding to step 5.
 */
export type IntegrityCheckResult = { readonly ok: true } | { readonly ok: false; readonly message: string };

/**
 * §5.1 step 4 / §5.1.1 — see the file header's `validateIntegrity` section
 * for the two checks, their order, and why D-017's undeclared-slot check must
 * run before the dangling-reference check. Never throws.
 *
 * `edges` MUST already be `deriveEdges(objects)` for the SAME `objects` — this
 * function does not re-derive them; it only validates what it is handed.
 */
export function validateIntegrity(objects: readonly GraphObject[], edges: readonly Edge[]): IntegrityCheckResult {
  const undeclaredSlotProblems = findUndeclaredFormulaOrDerivedSlots(objects);
  if (undeclaredSlotProblems.length > 0) {
    return { ok: false, message: undeclaredSlotProblems.join("; ") };
  }

  // D-018 — the OTHER direction of the same schema<->slot reconciliation:
  // every schema-declared derived slot must actually be present and
  // `derived`-kind, and no schema-declared non-derived path may hold a
  // `derived`-kind slot. Run before the dangling-reference check for the same
  // reason D-017's check does: both are about whether the graph `deriveEdges`
  // produced can be trusted at all, which detectCycle/evaluate assume.
  const schemaKindMismatchProblems = findSchemaSlotKindMismatches(objects);
  if (schemaKindMismatchProblems.length > 0) {
    return { ok: false, message: schemaKindMismatchProblems.join("; ") };
  }

  const danglingReferenceProblems = findDanglingReferences(objects, edges);
  if (danglingReferenceProblems.length > 0) {
    return { ok: false, message: danglingReferenceProblems.join("; ") };
  }

  return { ok: true };
}

/**
 * The result of `deriveValidateAndEvaluate` (§5.1 steps 3-5 and 7, composed).
 * `ok: false` means reject — the candidate `objects` passed in are discarded
 * by the CALLER (§5.1 step 6, "discard the clone entirely"); this function
 * never had write access to whatever prior state that clone came from. `ok:
 * true` carries the FULLY EVALUATED object list (step 7's output), ready for a
 * future step 8 to commit as-is.
 */
export type GraphEvaluationResult =
  | { readonly ok: true; readonly objects: readonly GraphObject[] }
  | { readonly ok: false; readonly message: string };

/**
 * Wires the four already-built pieces of §5.1's mutation loop into one fixed
 * sequence: `deriveEdges` (step 3) → `validateIntegrity` (step 4) →
 * `detectCycle` (step 5) → `evaluate` (step 7). Steps 1-2 (stage/clone, apply
 * an operation) and 6, 8 (discard-on-reject, commit + journal) are NOT this
 * function's job — see the file header's NOT DONE HERE. `objects` is a
 * candidate post-apply object list; this function does not produce one.
 *
 * Why compose rather than leave callers to chain the four calls in order
 * themselves: the ORDER is load-bearing, not a convenience.
 * 0014-REVIEW-phase0's own constraint 1 requires `validateIntegrity` to run
 * BEFORE `detectCycle` — a document whose only cycle runs through a slot its
 * schema doesn't declare must get D-017's rejection, never a false "no cycle"
 * pass from `detectCycle` seeing an incomplete edge set (D-017's own finding).
 * Repeating that order correctly at every future call site is exactly the
 * class of gap this project's history shows gets silently dropped — D-017
 * itself was one layer of that same mistake. One function makes the order
 * impossible to get wrong by omission.
 *
 * This is the first place Phase 0 acceptance clause 2's REJECTION half (§6:
 * "a cycle is rejected with the offending slots named") is demonstrable
 * end-to-end. The clause's OTHER half ("prior state provably unchanged",
 * D-016) is deliberately NOT claimed here: it needs step 1's clone to exist
 * before a snapshot comparison means anything, and that clone is not built yet
 * — see STATUS.md.
 *
 * Never throws, matching every function it composes. Never mutates `objects`
 * — every step here is pure and returns new data.
 */
export function deriveValidateAndEvaluate(objects: readonly GraphObject[]): GraphEvaluationResult {
  const edges = deriveEdges(objects);

  const integrity = validateIntegrity(objects, edges);
  if (!integrity.ok) {
    return integrity;
  }

  const cycleCheck = detectCycle(edges);
  if (cycleCheck.hasCycle) {
    return { ok: false, message: formatCycleRejection(cycleCheck.cycle, objects) };
  }

  return { ok: true, objects: evaluate(objects, edges) };
}

/**
 * §5.1 step 5's rejection message: "reject on cycle, naming every slot in the
 * cycle." Formats every `Address` `detectCycle` reported via `address.ts`'s
 * `formatAddress` — NEVER `addressKey`, which would leak the internal
 * id/slot-key layer into a user-facing string (D-015) — in cycle order, and
 * closes the loop back to the first slot so the message shows the actual
 * closed chain rather than an open list ending nowhere.
 *
 * `detectCycle`'s contract guarantees every address in `cycle` already
 * resolves: `validateIntegrity`'s dangling-reference check, which
 * `deriveValidateAndEvaluate` runs immediately before ever calling
 * `detectCycle`, already confirmed every edge's `sourceSlot` resolves.
 * `dependentSlot` carries no such guarantee (D-018), so `formatAddress`'s
 * `AddressError` arm is handled here for real rather than assumed away —
 * matching this module's own never-throws discipline either way.
 */
function formatCycleRejection(cycle: readonly Address[], objects: readonly GraphObject[]): string {
  const names = cycle.map((address) => {
    const formatted = formatAddress(address, objects);
    return isAddressError(formatted) ? formatted.message : formatted;
  });
  const first = names[0];
  const chain = first === undefined ? names.join(" → ") : [...names, first].join(" → ");
  return `cyclic dependency: ${chain}`;
}

/**
 * Replaces the slot at `address` with `slot`, leaving every other slot on
 * every other object untouched (§5.10's future `link`/`unlink`/`set`
 * commands are all, at bottom, "put a new Slot at this address" — this is
 * that one primitive, not any of those commands themselves).
 *
 * One variant today (mirroring `formula/ast.ts`'s `FormulaAst`, Q-005: a
 * single-variant union Phase 3 WIDENS with more operation kinds, never
 * restructures) — see the file header's NOT DONE HERE for what is
 * deliberately absent.
 */
export interface SetSlotOperation {
  readonly kind: "setSlot";
  readonly address: Address;
  readonly slot: Slot;
}

/**
 * Removes the whole object named by `objectId` — §5.1.1's `delete <object>`,
 * the general slot-deletion rule's primary example (this cycle's fixture has
 * no per-slot deletion below the whole-object level; `value`/`add` each
 * disappear entirely or not at all). Carries no `Address`/slot path: deleting
 * an object removes every slot it has at once, so there is no single slot to
 * name — see `applyOperation`'s doc comment for how the removal itself is
 * applied, and `mutate`'s for how §5.1.1's REJECT path (a slot elsewhere still
 * depends on one of THIS object's slots) is enforced — not here, but by
 * `validateIntegrity`'s existing dangling-reference check (§5.1.1 clause 1),
 * unchanged by this operation kind: deleting an object simply removes it from
 * `objects` before `deriveEdges`/`validateIntegrity` ever run over the
 * candidate, so an edge some OTHER object still has pointing at one of this
 * object's slots dangles exactly the way a typo'd formula reference already
 * does — no new mechanism, the existing one closes Phase 0 acceptance clause 3
 * for free. The REPAIR path (§5.1.1's other legal option, rewriting inbound
 * references to `#REF`) is explicitly NOT implemented here — see the file
 * header's NOT DONE HERE; Phase 0 has no type that needs it.
 */
export interface DeleteObjectOperation {
  readonly kind: "deleteObject";
  readonly objectId: string;
}

/**
 * The full set of operations `mutate` can apply. Two variants now
 * (`SetSlotOperation`, `DeleteObjectOperation`) — widened, per Q-005/D-020's
 * "widen the union, never restructure" stance, not a second entry point.
 */
export type Operation = SetSlotOperation | DeleteObjectOperation;

/** The object id an operation targets, whichever variant it is — shared by the existence check and the message-building below. */
function operationTargetId(operation: Operation): string {
  return operation.kind === "deleteObject" ? operation.objectId : operation.address.objectId;
}

/**
 * §5.1 step 1: "Stage. Deep-clone the current document state." A REAL
 * recursive clone, not a JSON round-trip (D-019, 0018-REVIEW-phase0): JSON
 * cannot represent `NaN`/`Infinity`/`-Infinity`, all three legal members of
 * `graph/node.ts`'s `Value` union (its `number` arm) — the previous
 * `JSON.parse(JSON.stringify(x))` clone silently turned every one of them
 * into `null`, so an accepted mutation could commit a change to a slot its
 * own operation never named (Rule 2's central promise, broken on the ACCEPT
 * path — see D-019's own probe). Whether a non-finite number OUGHT to be
 * legal document state at all is separate and unsettled — see Q-006 — but
 * this function's job is narrower and binds regardless of how that lands:
 * whatever `Value` a slot legally holds today, the clone MUST preserve it
 * exactly. `structuredClone` remains unavailable (D-006: it is a DOM-lib
 * global, excluded by `tsconfig.engine.json`). `deepClone` below is Rule 5's
 * "dumbest correct implementation" written out by hand: walk arrays and
 * plain objects, and return every other value completely unchanged — every
 * `Value` member that is not a `Point`/`Point[]`/`ErrorValue` is a JS
 * primitive already copied by value wherever it is read, so there is
 * nothing to "clone" about a `number` (finite or not), `string`, `boolean`,
 * or `null`; only the two composite shapes (`Point`, `ErrorValue`, and
 * arrays of either) need real recursion. Never mutates `objects`; the clone
 * shares no reference with anything the caller holds.
 */
function deepClone<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => deepClone(item)) as unknown as T;
  }
  if (value !== null && typeof value === "object") {
    const clone: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>)) {
      clone[key] = deepClone((value as Record<string, unknown>)[key]);
    }
    return clone as T;
  }
  // Primitives are copied by value already: numbers (including NaN/+Infinity/
  // -Infinity), strings, booleans, null, undefined. Nothing to do.
  return value;
}

function cloneObjects(objects: readonly GraphObject[]): GraphObject[] {
  return deepClone(objects as GraphObject[]);
}

/**
 * §5.1 step 2: "Apply the mutation to the clone." Takes an ALREADY-CLONED
 * `objects` (see `cloneObjects`) and returns a NEW array reflecting
 * `operation`'s effect — every object this project's other engine files
 * apply the same "return new data, never mutate a field in place" discipline
 * to (Rule 2; every field on `GraphObject`/`Slot` is `readonly`, so in-place
 * mutation is not even type-legal here without an unjustified cast).
 *
 * `setSlot`: replaces whatever is at `operation.address` with
 * `operation.slot` wholesale — no merge, no partial update. A dangling
 * `operation.slot` (e.g. a formula whose reference does not exist) is exactly
 * what `validateIntegrity`'s dangling-reference check (already composed into
 * `deriveValidateAndEvaluate`, called once after the WHOLE batch has been
 * applied) exists to catch — this function does not duplicate that check.
 *
 * `deleteObject`: removes the whole object named by `operation.objectId` —
 * `.filter`, not `.map`, since this variant shrinks the array rather than
 * rewriting one entry in place. Nothing checks here whether some OTHER
 * object's formula still points at one of the removed object's slots — that
 * is `validateIntegrity`'s dangling-reference check again, unchanged: an edge
 * whose `sourceSlot` no longer resolves is exactly what that check already
 * looks for, and it runs over the candidate AFTER this whole batch has been
 * folded, so it sees the object genuinely gone (§5.1.1 clause 1's REJECT path,
 * closing Phase 0 acceptance clause 3).
 *
 * PRECONDITION, enforced by `mutate` before this is EVER called, once per
 * operation in the WHOLE batch: `operationTargetId(operation)` names an
 * object that still exists at the moment THIS operation is folded — not
 * merely at the start of the batch. `DeleteObjectOperation` is the reason that
 * distinction now matters: unlike `SetSlotOperation` alone (0019/0020's
 * invariant, no longer sufficient on its own now that a batch can shrink the
 * object set mid-fold), an object present before the first fold step may be
 * GONE by a later one, if an earlier operation in the same batch deleted it.
 * `mutate`'s existence check simulates exactly this — walking the batch
 * against an evolving `Set<id>`, removing an id the moment a valid
 * `deleteObject` for it is seen — so this function itself can still simply
 * ASSUME a match exists; see `mutate`'s own doc comment for the simulation.
 */
function applyOperation(objects: readonly GraphObject[], operation: Operation): readonly GraphObject[] {
  if (operation.kind === "deleteObject") {
    return objects.filter((object) => object.id !== operation.objectId);
  }
  return objects.map((object) => {
    if (object.id !== operation.address.objectId) {
      return object;
    }
    return {
      ...object,
      // D-024: the caller's own `Slot` object never enters committed state by
      // reference. Cloning here is what makes "nothing outside mutation.ts
      // mutates graph state" (Rule 2) structural rather than dependent on
      // every caller leaving its payload alone after the call.
      slots: { ...object.slots, [slotKey(operation.address.path)]: deepClone(operation.slot) },
    };
  });
}

/**
 * One committed mutation — a BATCH, per D-020 (0018-REVIEW-phase0, fix 5):
 * "The API must accept a list of operations applied to a single clone,
 * validated and evaluated once, committing all-or-nothing" (§5.1). Records
 * the WHOLE operation list that was committed together, not one entry per
 * operation — a batch is one transaction, so one journal entry is what an
 * eventual undo must invert as a unit (Rule 2: "the mutation API MUST record
 * an append-only journal of committed mutations from day one"). PROJECT_BRIEF
 * §8 defers only the undo/redo UI, not this data. No timestamp or other
 * metadata yet: add it when something concrete needs it (same stance
 * `primitives/schema.ts` takes on widening its own declarations).
 */
export interface MutationJournalEntry {
  readonly operations: readonly Operation[];
}

/**
 * The result of `mutate` (§5.1's full loop for one batch). `ok: false`
 * mirrors `deriveValidateAndEvaluate`'s own rejection shape exactly — see
 * `mutate`'s doc comment for why `objects`/`journal` need no separate
 * "unchanged" field: the caller's own references already are unchanged.
 * `ok: true` carries the new committed `objects` (step 7's evaluated result)
 * and `journal` (with exactly one new entry appended, step 8, holding every
 * operation in the batch that was just committed).
 */
export type MutationResult =
  | { readonly ok: true; readonly objects: readonly GraphObject[]; readonly journal: readonly MutationJournalEntry[] }
  | { readonly ok: false; readonly message: string };

/**
 * §5.1's full mutation loop, widened to the BATCH form D-020 requires
 * (0018-REVIEW-phase0, fix 5 — "widen the existing entry point, never add a
 * second one," the same stance Q-005 set for `FormulaAst`): reject an empty
 * batch, or one containing an operation whose target does not exist (D-021,
 * before anything else runs) → stage ONE clone (step 1, `cloneObjects`) →
 * apply EVERY operation to that SAME clone, in order (step 2, `applyOperation`,
 * folded left-to-right — later operations see earlier ones' effects, matching
 * "applied to a single clone" rather than N independent clones) → derive
 * edges, validate integrity, validate acyclicity, evaluate ONCE over the
 * fully-batch-applied candidate (steps 3-5 and 7, `deriveValidateAndEvaluate`)
 * → on rejection, discard the clone and return the failure untouched (step 6:
 * the WHOLE batch fails together, "committing all-or-nothing") → on success,
 * append exactly ONE journal entry holding every operation in the batch, and
 * return the new state (step 8).
 *
 * Two checks run before staging, both over a SIMULATION of the batch's effect
 * on object EXISTENCE only (no clone needed yet — see below):
 *
 * - **Empty batch.** `operations.length === 0` is rejected outright — same
 *   reasoning as D-021 below: a committed batch that applied nothing would
 *   still append a journal entry recording a "mutation" that changed nothing,
 *   which is a false record of history (Rule 2's journal exists to be
 *   replayed/inverted, and an empty entry is nothing to invert).
 * - **D-021** (0018-REVIEW-phase0, answering cycle 0017's own question 2),
 *   made variant-aware THIS cycle for `DeleteObjectOperation`: ANY operation
 *   in the batch whose target does not exist AT THE MOMENT it would be folded
 *   rejects the WHOLE batch — never a silent no-op for that one operation
 *   while the rest proceed, matching "committing all-or-nothing." A single
 *   `objects.find`/`findObjectById` against the ORIGINAL, pre-batch `objects`
 *   (0019/0020's version) is no longer sufficient on its own: a
 *   `DeleteObjectOperation` can remove an id mid-batch, so a LATER operation
 *   naming that same id must be rejected even though the id was present when
 *   the batch started. The check below walks the operations in order against
 *   one evolving `Set<id>` (seeded from `objects`, `deleteObject` removing an
 *   id the moment a VALID deletion for it is seen) — a plain existence
 *   simulation, not a real fold (no slot data touched, no clone made) — so
 *   each operation's target is checked against exactly the id set it would
 *   actually see once `applyOperation` really folds over it. Every offending
 *   operation is still named, not just the first, gathered in the SAME pass
 *   as the simulation itself — matching 0020's own reasoning (a document load
 *   with several bad references benefits from seeing all of them at once) and
 *   `validateIntegrity`'s own multi-problem-in-one-message style. Both
 *   variants' messages deliberately avoid `formatAddress` (there is no object
 *   to resolve a name from) and deliberately avoid printing the raw
 *   `objectId` as anything OTHER than an id (D-023) — `setSlot` names the
 *   slot PATH it would have touched; `deleteObject` has no path to name, so it
 *   says plainly that it attempted a deletion.
 *
 * Why staging matters even though every function downstream is already pure
 * (so `objects` was never going to be mutated regardless): Rule 5 asks for
 * this literally ("implement staging by deep-cloning the document state"),
 * and doing it for real — rather than relying on "nothing downstream
 * mutates anything" holding by convention forever — is what makes "prior
 * state provably unchanged" (§6, D-016) a structural guarantee of THIS
 * function's own shape, not an accident of every other file's discipline.
 *
 * Never throws. Never mutates `objects` or `journal` — a rejection returns
 * without ever assigning either back to anything; both are exactly the
 * references the caller passed in.
 */
export function mutate(
  objects: readonly GraphObject[],
  operations: readonly Operation[],
  journal: readonly MutationJournalEntry[],
): MutationResult {
  if (operations.length === 0) {
    return { ok: false, message: "a mutation batch must contain at least one operation" };
  }

  // D-021 across the WHOLE batch, made variant-aware now that a batch can
  // shrink the object set mid-fold (`DeleteObjectOperation`): a plain
  // "does operationTargetId(operation) exist in the ORIGINAL objects" check
  // (0019/0020's version) is no longer sound on its own — an operation later
  // in the batch may target an object an EARLIER operation in the SAME batch
  // already deleted, which the original `objects` array alone cannot show.
  // Simulate the fold's effect on OBJECT EXISTENCE ONLY (a plain `Set<id>`,
  // no slot data) walking the batch in order, so each operation's target is
  // checked against exactly the id set it would actually see once folded —
  // while still gathering EVERY offending operation in one pass, not stopping
  // at the first, matching 0020's own reasoning (a document load with several
  // bad references benefits from seeing all of them at once).
  const survivingIds = new Set(objects.map((object) => object.id));
  const missingTargetMessages: string[] = [];
  operations.forEach((operation, index) => {
    const targetId = operationTargetId(operation);
    if (!survivingIds.has(targetId)) {
      // D-023: the object id appears here, LABELLED as an id, because no
      // name exists to print — the whole rejection is that nothing resolves.
      const prefix = `operation ${index + 1} of ${operations.length}`;
      missingTargetMessages.push(
        operation.kind === "deleteObject"
          ? `${prefix} attempts to delete object id "${targetId}", which does not exist in this document (D-021)`
          : `${prefix} targets slot "${slotKey(operation.address.path)}" on object id "${targetId}", ` +
              `which does not exist in this document (D-021)`,
      );
      return; // Nothing to remove from the simulation — this id was never in it.
    }
    if (operation.kind === "deleteObject") {
      survivingIds.delete(targetId); // A later operation targeting the SAME id must see it gone.
    }
  });
  if (missingTargetMessages.length > 0) {
    return { ok: false, message: missingTargetMessages.join("; ") };
  }

  const staged = cloneObjects(objects);
  // Fold left-to-right over the SAME clone (§5.1: "applied to a single
  // clone") — each operation sees every earlier operation's effect, unlike N
  // independent single-operation mutate() calls, which would each re-derive
  // edges, re-validate, and re-evaluate the whole graph from scratch.
  const candidate = operations.reduce<readonly GraphObject[]>((current, operation) => applyOperation(current, operation), staged);

  const result = deriveValidateAndEvaluate(candidate);
  if (!result.ok) {
    return result; // step 6: `objects`/`journal` were never touched.
  }

  return {
    ok: true,
    objects: result.objects,
    // D-024: the journal is append-only history, so it stores its OWN copy —
    // a caller who reuses or edits the array it passed in must not be able to
    // rewrite what this call recorded.
    journal: [...journal, { operations: deepClone([...operations]) }],
  };
}

/**
 * D-017 part 2: every `formula`/`derived`-kind slot an object ACTUALLY carries
 * must match one of its schema's declared paths. A type with no schema entry
 * at all is skipped, not flagged — see the file header's "one permitted
 * exception" note. `literal`-kind slots are not checked: an undeclared literal
 * has no inbound edges either way (§5.1's slot-kind table), so it cannot cause
 * the silent edge-derivation gap D-017 is about.
 */
function findUndeclaredFormulaOrDerivedSlots(objects: readonly GraphObject[]): readonly string[] {
  const problems: string[] = [];

  for (const object of objects) {
    const schema = getObjectSchema(object.type);
    if (schema === undefined) {
      continue; // D-017's one permitted exception — see file header.
    }

    // Re-derive the declared KEY set from the schema's declared PATHS via
    // slotKey — never the reverse (D-010) — mirroring exactly how
    // `deriveEdges` above already re-derives `slotKey(path)` from each
    // `nonDerivedSlotPaths` entry rather than inverting anything.
    const declaredKeys = new Set<string>([
      ...schema.nonDerivedSlotPaths.map((path) => slotKey(path)),
      ...schema.derivedSlots.map((entry) => slotKey(entry.path)),
    ]);

    for (const key of Object.keys(object.slots)) {
      const slot = object.slots[key];
      if (slot === undefined) {
        continue; // noUncheckedIndexedAccess artifact only — key came from Object.keys of this same record.
      }
      if ((slot.kind === "formula" || slot.kind === "derived") && !declaredKeys.has(key)) {
        problems.push(
          `${describeUndeclaredSlot(object, key)} is a "${slot.kind}" slot that object type ` +
            `"${object.type}"'s schema does not declare (D-017) — its edges were silently omitted`,
        );
      }
    }
  }

  return problems;
}

/**
 * Names a slot that has NO schema-declared path — see the file header's
 * discussion of why this is a deliberate, disclosed exception rather than the
 * "invert `slotKey`" pattern D-010/STATUS rule out elsewhere. Produces the
 * EXACT SAME string `formatAddress` would for every schema-registered type
 * today (`value`/`add`): neither is a table, and `address.ts`'s
 * `toSurfacePath` is the identity for every non-table type, so
 * `formatAddress`'s `[name, ...path].join(".")` collapses to exactly
 * `name + "." + slotKey(path)` — i.e. `name + "." + key`. This stops being
 * exact only for a type using D-005's surface/stored mapping (a table); D-017
 * already forbids extending `nonDerivedSlotPaths` to tables for the same
 * underlying reason, so that combination cannot arise before Phase 4 revisits
 * the whole mechanism.
 */
function describeUndeclaredSlot(object: GraphObject, key: string): string {
  return `${object.name}.${key}`;
}

/**
 * D-018 (0018-REVIEW-phase0): the schema<->slot reconciliation D-017 started
 * is only complete in one direction there. This closes the other two:
 *
 *   1. Every schema-declared derived path MUST carry a slot that is present
 *      AND `derived`-kind. An object missing its own declared derived slot
 *      makes `deriveEdges` emit edges whose `dependentSlot` names nothing —
 *      a dangling edge, §5.1.1's absolute invariant, and exactly the shape a
 *      §5.11 load produces today (`DerivedSlot.value` is never serialized).
 *   2. A slot at a schema-declared derived path that IS present but is not
 *      `derived`-kind, or a slot at a `nonDerivedSlotPaths` path that IS
 *      `derived`-kind, both violate §5.1's "`derived` is fixed by schema and
 *      can never be converted."
 *
 * Named via `formatAddress` (D-015) — unlike `describeUndeclaredSlot` above,
 * every path checked here comes directly from the SCHEMA itself, so a real
 * `Address` always exists to format; there is no "nothing to look up" case
 * the way there is for an undeclared slot.
 */
function findSchemaSlotKindMismatches(objects: readonly GraphObject[]): readonly string[] {
  const problems: string[] = [];

  for (const object of objects) {
    const schema = getObjectSchema(object.type);
    if (schema === undefined) {
      continue; // Same permitted exception as D-017 — see file header.
    }

    for (const derivedSlotEntry of schema.derivedSlots) {
      const slot = object.slots[slotKey(derivedSlotEntry.path)];
      if (slot !== undefined && slot.kind === "derived") {
        continue; // Correctly present and correctly kinded.
      }
      const name = formatSchemaAddress({ objectId: object.id, path: derivedSlotEntry.path }, objects);
      const reason =
        slot === undefined
          ? "is missing — deriveEdges still emits an edge into it, pointing at a slot that does not exist (D-018)"
          : `is a "${slot.kind}" slot where its schema declares "derived" (D-018) — derived slots can never be converted (§5.1)`;
      problems.push(`${name} ${reason}`);
    }

    for (const path of schema.nonDerivedSlotPaths) {
      const slot = object.slots[slotKey(path)];
      if (slot === undefined || slot.kind !== "derived") {
        continue; // Absent (a separate, tolerated gap — see deriveEdges's header) or correctly non-derived.
      }
      const name = formatSchemaAddress({ objectId: object.id, path }, objects);
      problems.push(`${name} is a "derived" slot at a path its schema declares non-derived (D-018) — derived slots can never be converted (§5.1)`);
    }
  }

  return problems;
}

/**
 * Shared by `findSchemaSlotKindMismatches`'s two checks: formats a schema-
 * declared `Address` via `formatAddress` (D-015 — never `addressKey`),
 * falling back to the `AddressError`'s own message in the one case that
 * cannot actually arise here (the object came from `objects` itself, so it
 * always resolves) — matching this module's other formatting call sites'
 * defensive handling rather than assuming it away.
 */
function formatSchemaAddress(address: Address, objects: readonly GraphObject[]): string {
  const formatted = formatAddress(address, objects);
  return isAddressError(formatted) ? formatted.message : formatted;
}

/**
 * §5.1.1: "any formula references a slot that does not exist." Checks every
 * edge's `sourceSlot` against `resolveSlot` (`graph/node.ts`). `dependentSlot`
 * is deliberately NOT checked here — but the reason this file recorded until
 * 0018-REVIEW ("deriveEdges only ever builds one from a real,
 * currently-iterated object") was WRONG, and is exactly what hid D-018: true
 * of `deriveEdges`'s source 1, false of its source 2, whose `dependentSlot`
 * path comes from the schema and is never checked against the object.
 * Closing that is D-018's job, in the check above — not here.
 *
 * Also covers §5.1.1's other clause ("the mutation would delete a slot that
 * still has inbound dependents without repairing them") for free: deleting a
 * slot that some formula elsewhere still references makes that formula's edge
 * fail this exact check, with no separate before/after diff needed (Rule 5).
 *
 * Groups by the missing source so an object with several formulas dangling at
 * the SAME missing slot gets one problem naming every dependent, not one line
 * per edge repeating the same missing target.
 */
function findDanglingReferences(objects: readonly GraphObject[], edges: readonly Edge[]): readonly string[] {
  const dependentsByMissingSource = new Map<string, Address[]>();

  for (const edge of edges) {
    if (resolveSlot(edge.sourceSlot, objects) !== undefined) {
      continue; // resolves fine — nothing wrong with this edge.
    }
    const key = addressKey(edge.sourceSlot);
    const existing = dependentsByMissingSource.get(key);
    if (existing === undefined) {
      dependentsByMissingSource.set(key, [edge.dependentSlot]);
    } else {
      existing.push(edge.dependentSlot);
    }
  }

  const problems: string[] = [];
  for (const dependents of dependentsByMissingSource.values()) {
    // §5.1.1 clause 1's own wording: "naming every dependent" — never the
    // missing source itself. The source's object may not exist at all (D-015
    // forbids leaking its raw objectId into a message, and there is nothing
    // else safe to format), whereas every dependentSlot here names a slot on
    // an object that, by construction, still exists.
    const names = dependents.map((address) => {
      const formatted = formatAddress(address, objects);
      return isAddressError(formatted) ? formatted.message : formatted;
    });
    const verb = names.length === 1 ? "references" : "reference";
    problems.push(`${names.join(", ")} ${verb} a slot that does not exist`);
  }
  return problems;
}
