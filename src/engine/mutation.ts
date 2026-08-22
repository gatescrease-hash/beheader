/**
 * mutation.ts — THE single transactional channel for state change (PROJECT_BRIEF
 * Rule 2). Three things exist so far: edge derivation (§5.1 mutation-loop step
 * 3, cycle 0013), integrity validation (step 4, §5.1.1, cycle 0015), and — as
 * of this cycle — `deriveValidateAndEvaluate`, which composes those two with
 * the already-built `detectCycle` (step 5, `graph/cycles.ts`) and `evaluate`
 * (step 7, `graph/eval.ts`) into one sequence. All of this is deliberately
 * still short of the full 8-step loop — see WHAT THIS IS and NOT DONE HERE.
 *
 * IMPLEMENTS: PROJECT_BRIEF §5.1 step 3 ("Re-derive ALL edges from stored
 * formula ASTs and schema declarations (static and dynamic). Per Rule 5,
 * rebuild the whole edge set rather than tracking which slots were affected.")
 * and step 4 / §5.1.1 ("Validate integrity. Reject if any formula references a
 * slot that does not exist, or if the mutation would delete a slot that still
 * has inbound dependents without repairing them."), plus **D-017 part 2**,
 * closed at cycle 0015 (see WHAT THIS IS, `validateIntegrity`). This cycle
 * additionally composes step 5 ("Validate acyclicity. Full DFS over the whole
 * graph. Reject on cycle, naming every slot in the cycle.") and step 7
 * ("Evaluate. Topologically sort all slots and evaluate every one...") with
 * the two above, in `deriveValidateAndEvaluate` — see WHAT THIS IS.
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
 * part 2 lands. Takes a candidate post-apply object list and its freshly
 * `deriveEdges`-derived edge set (step 2's "apply" and step 3 are NOT this
 * function's job — see NOT DONE HERE; it is handed the result), and rejects
 * with a human-readable message, or passes, in TWO checks, run in this order:
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
 *   2. **Dangling references** (§5.1.1's stated wording: "any formula
 *      references a slot that does not exist"). For every edge, its
 *      `sourceSlot` must `resolveSlot` (`graph/node.ts`) against `objects`;
 *      `dependentSlot` never needs checking here because `deriveEdges` only
 *      ever builds one from a real, currently-iterated object. This ONE check
 *      is both halves of §5.1.1's step-4 sentence at once: a plain bad
 *      reference (a formula typo'd at an object that never existed) and "the
 *      mutation would delete a slot that still has inbound dependents" are
 *      the SAME failure viewed from opposite ends of the same edge — deleting
 *      a slot that formulas elsewhere still reference makes exactly this
 *      check fail, with no separate before/after diff needed (Rule 5: recheck
 *      the whole graph, don't track what changed). §5.1.1 clause 1's own
 *      wording — "naming every dependent" — is why the message names the
 *      DEPENDENT side via `formatAddress`, never the missing source: the
 *      source's object may be gone, so there is nothing safe to format there,
 *      and D-015 forbids leaking its raw `objectId` into the message anyway.
 *
 *   A genuinely new sub-problem D-017's check hits and D-010/D-015's existing
 *   guidance does not cover: naming an UNDECLARED slot (case 1) needs an
 *   `Address` for `formatAddress`, but by definition no schema declares this
 *   slot's path — there is nothing to look up. `describeUndeclaredSlot` below
 *   is a deliberate, disclosed exception (see its own doc comment) rather than
 *   an application of the "invert `slotKey`" pattern this project has twice
 *   ruled out (D-010; STATUS's "never `key.split(\".\")`"): those rulings
 *   solved "I need a slot's path and something already declares it schema-
 *   side"; this is the one case where nothing does, by construction.
 *
 * INVARIANTS UPHELD HERE (validateIntegrity)
 *   - Never throws, same as every other function in this module.
 *   - Runs both checks over the WHOLE graph from scratch, every call (Rule 5)
 *     — no diffing against a "previous" object list, matching `deriveEdges`,
 *     `detectCycle`, and `evaluate`'s own from-scratch discipline.
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
 *     0014-REVIEW-phase0 requires: validateIntegrity's D-017 check MUST see
 *     the graph before detectCycle does, or a document whose only cycle runs
 *     through an undeclared slot gets a false "no cycle" pass instead of
 *     D-017's rejection (exactly the hazard D-017 exists to close).
 *   - Never mutates `objects`. Every step it calls is pure and returns new
 *     data; a rejection here means the candidate `objects` this function
 *     received are simply never returned as the `ok: true` arm's evaluated
 *     result — there is nothing here for a caller's own prior state to be
 *     corrupted by, because this function was never given write access to it.
 *   - Never throws, matching every function it composes.
 *
 * NOT DONE HERE (the rest of `mutation.ts`, later cycles)
 *   - Stage (clone), apply an operation, commit + journal — §5.1 steps 1, 2,
 *     6, 8. `deriveValidateAndEvaluate` is handed a candidate post-apply
 *     object list; it does not produce one, and its `ok: true` result is not
 *     committed anywhere by this file.
 *   - The batch mutation form (§5.1, required from day one).
 *   - Any operation shape (`setLiteral`, `link`, object creation/deletion) —
 *     this file only derives edges and validates whatever `GraphObject[]` it
 *     is handed; it does not produce or apply one.
 *   - The slot-deletion REPAIR path (§5.1.1's second legal option, rewriting
 *     inbound references to `#REF`) — Phase 0 has no type that uses it (only
 *     table row/column deletion does, Phase 2/4), so `validateIntegrity`'s
 *     dangling check always takes the Reject branch. Nothing here decides
 *     between the two; that belongs to whichever future operation needs it.
 *   - Range expansion (`A1:B4` → concrete cell dependencies, §5.3) and
 *     reference adjustment on table resize (§5.4) — both Phase 2/4 concerns,
 *     irrelevant while `formula/ast.ts` has only `ReferenceNode`.
 */
import { formatAddress, isAddressError, type Address } from "./address.ts";
import { derivedSlotDependencyAddresses, getObjectSchema } from "./primitives/schema.ts";
import { detectCycle } from "./graph/cycles.ts";
import { addressKey, type Edge } from "./graph/edge.ts";
import { evaluate } from "./graph/eval.ts";
import { resolveSlot, slotKey, type GraphObject } from "./graph/node.ts";

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
 * `detectCycle`, already confirmed every edge's `sourceSlot` resolves, and
 * every `dependentSlot` is one `deriveEdges` only ever builds from a real,
 * currently-iterated object. `formatAddress`'s `AddressError` arm is handled
 * anyway rather than assumed away, matching this module's own never-throws
 * discipline.
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
 * §5.1.1: "any formula references a slot that does not exist." Checks every
 * edge's `sourceSlot` against `resolveSlot` (`graph/node.ts`) — `dependentSlot`
 * never needs the same check here, because `deriveEdges` only ever builds one
 * from a real, currently-iterated object (see that function above).
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
