/**
 * mutation.ts — THE single transactional channel for state change (PROJECT_BRIEF
 * Rule 2). Nothing else in this codebase mutates document state.
 *
 * IMPLEMENTS: PROJECT_BRIEF §5.1's mutation loop in full — step 1 (stage/deep-clone),
 * step 2 (apply to the clone), step 3 (re-derive ALL edges), step 4/§5.1.1 (validate
 * integrity), step 5 (validate acyclicity), step 6 (discard on reject), step 7
 * (evaluate), step 8 (commit + journal) — plus §5.1's "Batch mutations (required)"
 * subsection and Rule 2's append-only journal.
 * LAYER: engine (pure). May import: engine/* only.
 *        NEVER imports: DOM, window, document, canvas, render/*.
 * Load-bearing (§6.2).
 *
 * WHAT THIS IS
 *
 * `deriveEdges(objects)` — step 3. Rebuilds the ENTIRE `Edge[]` from scratch every
 * call (Rule 5 — no incremental tracking), from two sources per object:
 *
 *   1. Every `formula`-kind slot AT A SCHEMA-DECLARED NON-DERIVED PATH — not, as
 *      §5.1 step 3's wording ("re-derive ALL edges from stored formula ASTs") would
 *      have it, every formula slot the object actually carries. Paths come from
 *      `primitives/schema.ts`'s `resolveNonDerivedSlotPaths(object, ...)`, which
 *      resolves PER OBJECT (a `dynamic` group like `table`'s `cells.*` is a function
 *      of that object's own current `rows`/`cols`), never from `nonDerivedSlotPaths`
 *      directly. Each slot's AST is walked by `formula/deps.ts`'s
 *      `extractDependencies`: a `ReferenceDependency` becomes one edge; a
 *      `RangeDependency` becomes one edge per cell currently within the named table's
 *      extent (D-044) that HAS a slot (D-047 — an in-bounds cell with no slot is
 *      ordinary empty state, not a dangling reference), via `primitives/table.ts`'s
 *      `enumerateRangeCellAddresses`, re-resolved from CURRENT dimensions on every
 *      call (D-036: never a cached expansion) and reading them `literal`-only (D-046).
 *      An unresolvable table falls back to ONE edge from the range's start address so
 *      the dangling-reference check below still catches and names it.
 *
 *      READ THAT NARROWING AS A HAZARD, NOT A DETAIL — D-017. This function's domain
 *      is the SCHEMA's slot set; `graph/eval.ts`'s is the OBJECT's own
 *      `Object.keys(object.slots)`. Where they disagree — an object carrying a formula
 *      slot its schema does not declare — the slot is still evaluated, but it is never
 *      ordered and its edges never exist. Verified by probe (0014-REVIEW): a genuine
 *      three-slot cycle running through one undeclared slot yields an edge set
 *      `detectCycle` reports `{ hasCycle: false }` on, so step 5 ACCEPTS and step 7
 *      quietly fills all three slots with `#REF`. Nothing here can detect that; making
 *      it loud is step 4's job (check 1 below). Calling the SAME resolver at all three
 *      sites (here, check 1, check 2) is what keeps edge derivation and both integrity
 *      checks in agreement for a dynamic family — resolving `dynamic` groups
 *      independently per site would reopen D-017 through a new door.
 *
 *      WHY THE SCHEMA IS CONSULTED AT ALL: a formula slot's own address needs a real
 *      PATH, not just the string key it is stored under in `GraphObject.slots`. There
 *      is no sanctioned inverse of `slotKey` (D-010). Derived slots have an escape
 *      hatch (`DerivedSlotSchema.path`); formula slots had none until
 *      `ObjectSchema.nonDerivedSlotPaths` was added for exactly this. Re-derive the
 *      key you need; never invert the one you have.
 *
 *   2. Every schema-declared derived slot's dependencies, via
 *      `primitives/schema.ts`'s `derivedSlotDependencyAddresses` — the ONLY place a
 *      dynamic dependency resolver may run, precisely because this IS edge-derivation
 *      time (Rule 6).
 *
 * `validateIntegrity(objects, edges)` — step 4 / §5.1.1. Takes a candidate post-apply
 * object list and its freshly derived edge set, and rejects with a human-readable
 * message, in FOUR checks, in this order:
 *
 *   1. **D-017 part 2** (`findUndeclaredFormulaOrDerivedSlots`). For every object that
 *      HAS a schema entry, every `formula`/`derived` slot must sit at a
 *      schema-declared path. A mismatch means `deriveEdges` silently dropped its edges
 *      — reject before `detectCycle` runs on a graph that cannot be trusted to be
 *      total. This must run FIRST (0014-REVIEW). An object whose type has no schema
 *      entry is skipped, not flagged — D-017's one permitted exception.
 *   2. **D-018, the other direction** (`findSchemaSlotKindMismatches`): a
 *      schema-declared derived path missing its `derived`-kind slot (exactly what a
 *      §5.11 load produces, since `DerivedSlot.value` is never serialized), or a slot
 *      whose kind disagrees with its schema position (§5.1: "`derived` is fixed by
 *      schema and can never be converted").
 *   3. **Dangling references** (`findDanglingReferences`): every edge's `sourceSlot`
 *      must resolve. `dependentSlot` is deliberately NOT checked — checks 1 and 2 are
 *      what make that safe. This one check is both halves of §5.1.1's sentence at
 *      once: a typo'd reference and "the mutation would delete a slot that still has
 *      inbound dependents" are the same failure from opposite ends of one edge. The
 *      message names the DEPENDENT side (§5.1.1 clause 1's "naming every dependent") —
 *      the source's object may be gone, and D-015 forbids leaking a raw `objectId`.
 *   4. **Illegal slot values** (`findIllegalSlotValues`, D-025/Q-006, widened by Q-008
 *      and D-031). Every slot's `value` is checked via `graph/node.ts`'s
 *      `hasIllegalNumber` (`NaN`/`±Infinity`/`-0`, bare or nested in a `Point`), and
 *      every `formula` slot's stored AST is walked for a `LiteralNode` failing the
 *      same predicate (D-031 — a stored literal is document state the same way a
 *      slot's `value` is). Orthogonal to checks 1-3, so it runs last. It is NOT a
 *      backstop for a freshly-computed `derived` value (this runs BEFORE `evaluate`;
 *      an illegal result is the compute function's own responsibility, see
 *      `primitives/schema.ts`) nor for an illegal OPERATION PAYLOAD (this only ever
 *      sees the post-fold graph — `mutate`'s `findIllegalOperationPayloads` closes
 *      that, D-048).
 *
 *   Naming an UNDECLARED slot (check 1) needs an `Address`, but by definition no
 *   schema declares its path. `describeUndeclaredSlot` is a deliberate, disclosed
 *   exception to D-010's "never invert a `slotKey`" — that ruling solved "I need a
 *   path and something declares it schema-side"; this is the one case where nothing
 *   does, by construction. Check 4 reuses it for the same reason.
 *
 * `deriveValidateAndEvaluate(objects)` — composes steps 3, 4, 5, 7 in that fixed
 * order. The ORDER is the entire point (0014-REVIEW): D-017/D-018 must see the graph
 * before `detectCycle` does, or a document whose only cycle runs through an undeclared
 * slot gets a false "no cycle" pass instead of the rejection those checks exist to give.
 *
 * `mutate(objects, operations, journal)` — steps 1, 2, 6, 8 around the above. FIVE
 * operation kinds: `setSlot`, `deleteObject`, `createObject`, `insertTableLine`,
 * `deleteTableLine`. Four PRECONDITIONS run over the whole batch before staging even
 * starts — an empty batch, a target that does not resolve (D-021; simulated
 * LEFT-TO-RIGHT so a batch that creates or deletes objects mid-fold is checked against
 * each operation's own position, not pre-batch state alone), an illegal payload value
 * or stored AST literal (D-048), and an invalid table resize (D-050/D-046/D-053,
 * simulated in that same left-to-right walk). Then: deep-clone once (D-019 — a real
 * recursive clone, not a JSON round-trip), fold every operation onto that ONE clone,
 * validate and evaluate ONCE, commit all-or-nothing with exactly one journal entry
 * holding the whole list (D-020).
 *
 * §5.1.1's two paths both live here. REJECT is the default for `delete <object>` —
 * check 3 above IS that mechanism, no separate machinery. REPAIR is taken by
 * `deleteTableLine` unconditionally (§5.4 states it so) and by `deleteObject` when
 * `force: true` (D-056), both through the SAME `repairObjectFormulaAddresses` with
 * different callbacks, running BEFORE the object is removed and BEFORE
 * `validateIntegrity` sees the candidate — so no dangling edge is ever produced rather
 * than produced and then excused. Every slot a repair broke is reported through ONE
 * channel, `MutationResult`'s `brokenSlots` (D-057), fed by both repair sites.
 *
 * INVARIANTS UPHELD HERE
 *   - Never throws — any function in this file, any input.
 *   - Full rebuild from scratch every call (Rule 5): no memoization, no diffing
 *     against a previous object list, no incremental edge bookkeeping.
 *   - Dynamic dependency resolution happens HERE and only here (Rule 6,
 *     `primitives/schema.ts`'s header) — never during evaluation.
 *   - An object of a type with no schema entry contributes no edges and is skipped by
 *     check 1 — honest, not a placeholder.
 *   - Rejection cannot touch prior state: `objects` and `journal` are never reassigned
 *     on the `ok: false` path, and the clone is simply dropped (step 6).
 *   - Every schema-declared path this file compares is re-derived via `slotKey`; no
 *     `GraphObject.slots` key is ever decomposed back into a path (D-010), with
 *     `describeUndeclaredSlot`'s one disclosed exception above.
 *
 * NOT DONE HERE
 *   - Holding "the current document" across calls — Rule 2 forbids it. `mutate` is a
 *     pure function of its three arguments; the caller owns the `objects`/`journal`
 *     pair and decides what to do with a rejection.
 *   - Operation kinds beyond the five above (`explode`, vertex add/remove) — they
 *     belong to the phases that introduce the state they touch.
 *   - A user-facing "add a new circle" COMMAND (§5.10): choosing a fresh id from
 *     `nextObjectId` and a type's starting slot values is `command/commands.ts`'s,
 *     layered ON TOP of `CreateObjectOperation`, not the same thing as it.
 *   - Undo/redo (PROJECT_BRIEF §8) — this stores the journal data undo will need, and
 *     nothing replays it.
 */
import { formatAddress, isAddressError, type Address } from "./address.ts";
import type { FormulaAst } from "./formula/ast.ts";
import { extractDependencies, repairAddressesInAst, rewriteAddressesInAst } from "./formula/deps.ts";
import { derivedSlotDependencyAddresses, getObjectSchema, resolveNonDerivedSlotPaths } from "./primitives/schema.ts";
import {
  deleteTableLine,
  enumerateRangeCellAddresses,
  getTableDimensions,
  insertTableLine,
  isRangeEnumerationError,
  isTableDimensionResizable,
  repairCellAddressForDelete,
  repairRangeEndpointsForDelete,
  shiftCellAddressForInsert,
} from "./primitives/table.ts";
import { detectCycle } from "./graph/cycles.ts";
import { addressKey, type Edge } from "./graph/edge.ts";
import { evaluate } from "./graph/eval.ts";
import { hasIllegalNumber, isIllegalNumber, resolveSlot, slotKey, type GraphObject, type Point, type Slot, type Value } from "./graph/node.ts";

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

    // Source 1: every formula-kind slot's stored AST, walked via
    // `formula/deps.ts`'s `extractDependencies` over EVERY `FormulaAst`
    // shape. Each `ReferenceDependency` becomes one edge directly; each
    // `RangeDependency` expands into one edge PER CELL currently within the
    // table's extent (D-044), via `primitives/table.ts`'s
    // `enumerateRangeCellAddresses` — re-resolved from CURRENT `rows`/`cols`
    // on every call, never cached (D-036 constraint 2), and reading those
    // dimensions `literal`-only (D-046) inside that one function, not
    // duplicated here.
    for (const path of resolveNonDerivedSlotPaths(object, schema.nonDerivedSlotPaths)) {
      const slot = object.slots[slotKey(path)];
      if (slot === undefined || slot.kind !== "formula") {
        // Either this path is DECLARED but not populated on this object —
        // ordinary state, not a defect: a created table declares one cell path
        // per rows x cols and carries a slot only where something was written
        // (D-047's absent spelling of an empty cell, `command/commands.ts`) —
        // or it's currently `literal`, which has no inbound edges (§5.1's
        // slot-kind table). Either way: nothing to derive for this path.
        continue;
      }
      const dependentSlot = { objectId: object.id, path };
      for (const dependency of extractDependencies(slot.ast)) {
        if (dependency.kind === "reference") {
          edges.push({ sourceSlot: dependency.address, dependentSlot });
          continue;
        }
        // dependency.kind === "range": expand to one edge per cell currently
        // within the named table's extent. If the table cannot be resolved
        // at all (deleted, or a defensive-only enumeration failure — D-045
        // already rejects the reachable cross-object case at PARSE time),
        // fall back to ONE edge from the range's own start address, so
        // `validateIntegrity`'s dangling-reference check still catches and
        // names it — the SAME treatment a broken plain reference already
        // gets. Silently dropping the dependency here instead would let
        // `delete <table>` succeed while a range elsewhere still names it,
        // exactly the §5.1.1 hazard that check exists to prevent.
        const tableObject = objects.find((candidate) => candidate.id === dependency.start.objectId);
        if (tableObject === undefined) {
          edges.push({ sourceSlot: dependency.start, dependentSlot });
          continue;
        }
        const cellAddresses = enumerateRangeCellAddresses(dependency.start, dependency.end, tableObject);
        if (isRangeEnumerationError(cellAddresses)) {
          edges.push({ sourceSlot: dependency.start, dependentSlot });
          continue;
        }
        for (const cellAddress of cellAddresses) {
          // D-047 item 1: a cell within the range's bound that has no slot on
          // the table object is ordinary, expected empty state — not a
          // dangling reference — so it gets no edge at all. This is
          // different from the unresolvable-TABLE fallback just above: here
          // the table exists and the address is in-bounds, only the specific
          // cell is unpopulated.
          if (tableObject.slots[slotKey(cellAddress.path)] === undefined) {
            continue;
          }
          edges.push({ sourceSlot: cellAddress, dependentSlot });
        }
      }
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
 * reject the mutation outright — the caller discards the clone entirely
 * (§5.1 step 6) rather than proceeding to step 5.
 */
export type IntegrityCheckResult = { readonly ok: true } | { readonly ok: false; readonly message: string };

/**
 * §5.1 step 4 / §5.1.1 — see the file header's `validateIntegrity` section
 * for all FOUR checks, their order, and why D-017's undeclared-slot check
 * must run before the dangling-reference check. Never throws.
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

  // D-025 (Q-006, cycle 0023), widened by Q-008 (cycle 0026): non-finite
  // numbers and -0 are not legal document state. Runs last — it is orthogonal
  // to the three checks above (schema/edge structure vs. raw value legality),
  // so there is no ordering hazard the way D-017-before-D-018-before-dangling
  // has; it is simply appended.
  const illegalValueProblems = findIllegalSlotValues(objects);
  if (illegalValueProblems.length > 0) {
    return { ok: false, message: illegalValueProblems.join("; ") };
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
 * This function does NOT stage, clone, commit, or journal — it is steps 3-5
 * and 7 only. "Prior state provably unchanged" (D-016) is `mutate`'s
 * guarantee, not this one's; there is nothing here for a caller's prior state
 * to be corrupted by, because this function is never given write access to it.
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
 * every other object untouched (§5.10's `link`/`unlink`/`set` commands are
 * all, at bottom, "put a new Slot at this address" — this is that one
 * primitive, not any of those commands themselves; `command/commands.ts`'s
 * `writeSlot` is the one caller that builds all three).
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
 * Removes the whole object named by `objectId` — §5.1.1's `delete <object>`.
 * Carries no `Address`/slot path: deleting an object removes every slot it
 * has at once, so there is no single slot to name — see `applyOperation`'s
 * doc comment for how the removal itself is applied.
 *
 * **Two paths, chosen by `force`:**
 *
 * - **`force` absent/false (default) — REJECT.**
 *   `validateIntegrity`'s existing dangling-reference check (§5.1.1 clause 1)
 *   is what rejects it — deleting an object simply removes it from `objects`
 *   before `deriveEdges`/`validateIntegrity` ever run over the candidate, so
 *   an edge some OTHER object still has pointing at one of this object's
 *   slots dangles exactly the way a typo'd formula reference already does —
 *   no new mechanism.
 * - **`force: true` — REPAIR**, §5.1.1's other legal option: every inbound
 *   reference to ANY slot on the deleted object is rewritten to `#REF`
 *   (D-028), the SAME `ErrorNode` shape row/column deletion already uses.
 *   **D-056: reuses `repairObjectFormulaAddresses` AS IT STANDS**, called
 *   with whole-object callbacks (`repairReferenceForDeletedObject`/
 *   `repairRangeForDeletedObject`, below `applyOperation`) instead of
 *   `primitives/table.ts`'s cell-shifting ones — no third
 *   `*ObjectFormulaAddresses` helper, no per-object-type primitive file
 *   involved (there is nothing table-specific about "does this address name
 *   a slot on the object being deleted"). Unlike row/column deletion, there
 *   is no shifting: an address either names a slot on the deleted object, or
 *   it does not — no partial adjustment exists for a whole object going away.
 *   `applyOperation`'s `deleteObject` branch runs this repair pass over
 *   EVERY object (document-wide, unconditional, no relevance pre-filter —
 *   the same posture `insertTableLine`/`deleteTableLine` already take)
 *   BEFORE filtering the deleted object out, so `validateIntegrity`'s
 *   dangling-reference check never sees a dangling edge in the first place —
 *   the edge was already rewritten to a self-contained `#REF`, not removed.
 *
 * **D-057: the broken-slot REPORT is now built**, ONE channel serving THIS
 * repair site and row/column deletion's, never two — see `MutationResult`'s
 * `brokenSlots` field. Both repair sites route through the SAME widened
 * `repairObjectFormulaAddresses`, which is what makes one channel possible.
 */
export interface DeleteObjectOperation {
  readonly kind: "deleteObject";
  readonly objectId: string;
  readonly force?: boolean;
}

/**
 * Adds a WHOLE, already-fully-formed object to the graph — carrying the
 * complete `GraphObject` (id, name, type, every slot) rather than "create a
 * default object of this type." That distinction matters: this is
 * `document.ts`'s loader primitive (§5.11: "Loading applies objects through
 * the mutation API"), which needs to reconstruct EXACT prior state. §5.10's
 * user-facing creation commands are layered ON TOP of this same primitive, in
 * `command/commands.ts`: choosing a fresh id from `nextObjectId` and a type's
 * starting slot values is that file's work, and this operation stays the one
 * primitive both routes commit through.
 *
 * PRECONDITION, enforced by `mutate` before this is ever called: `object.id`
 * must NOT already name an object at the moment THIS operation is folded —
 * the reverse of `setSlot`/`deleteObject`'s precondition, since creation is
 * the one operation kind that ADDS to the id set the existence simulation
 * tracks (see `mutate`'s own doc comment). Everything else about whether the
 * created object is well-formed (its slots matching its schema, no dangling
 * references, no non-finite values) is `validateIntegrity`'s job, run once
 * over the whole post-fold candidate — this operation does not duplicate any
 * of those checks.
 */
export interface CreateObjectOperation {
  readonly kind: "createObject";
  readonly object: GraphObject;
}

/**
 * §5.4's row/column INSERTION (entry 0047) — the first half of "rows and
 * columns can be added or removed." `index` is 1-based: the NEW line
 * occupies this position; every EXISTING row/column at or after it shifts by
 * one (`primitives/table.ts`'s `insertTableLine`/`shiftCoordinates`). Carries
 * no payload beyond WHERE to insert — unlike `SetSlotOperation`/
 * `CreateObjectOperation`, there is no slot content to supply: the new
 * line's cells are simply absent (D-047-legal empty state), and every
 * EXISTING cell's own content moves with it unchanged.
 *
 * Deletion is a DIFFERENT operation kind, not the same one with a negative
 * `index` or a `remove: true` flag — deletion can ORPHAN a reference (the
 * §5.1.1 REPAIR path) in a way insertion structurally cannot, so the two
 * do not share a validation or apply story. See STATUS.md's next slice for
 * why deletion is deliberately not built alongside this.
 *
 * PRECONDITION, enforced by `mutate` before this is ever folded (mirroring
 * every other variant's own precondition doc comment): `objectId` names an
 * EXISTING object of type `"table"` whose `rows`/`cols` can be coherently
 * resized (D-046, `isTableDimensionResizable`), and `index` is in range for
 * the table's state AS OF THIS OPERATION'S OWN POSITION in the batch —
 * `findInvalidTableResizes` (**D-050**, 0048-REVIEW-phase2 fix 2) is the
 * primary check, simulating the whole batch left-to-right, the same way the
 * existence check above already does; `insertTableLine`'s own CLAMPING of an
 * out-of-range `index` remains the defensive arm, now purely a backstop
 * against a bug in this check rather than a documented gap in it.
 */
export interface InsertTableLineOperation {
  readonly kind: "insertTableLine";
  readonly objectId: string;
  readonly axis: "row" | "column";
  readonly index: number;
}

/**
 * §5.4's row/column DELETION (entry 0050) — the other half of "rows and
 * columns can be added or removed," and the FIRST operation kind in this
 * codebase to take §5.1.1's REPAIR path. `index` is 1-based and names the
 * EXISTING row/column to remove; every row/column after it shifts back by one
 * (`primitives/table.ts`'s `deleteTableLine`/`shiftCoordinatesForDelete`).
 *
 * Carries no `force` flag and takes the repair path UNCONDITIONALLY — §5.4's
 * own words: "Row/column deletion... proceeds even when other objects depend
 * on the deleted cells, rewriting each inbound reference to `#REF`." This is
 * deliberately DIFFERENT from `DeleteObjectOperation` (`delete <table>`),
 * which rejects by default and takes the repair path only under its own
 * `force` flag. The two operations do not share a mechanism because they
 * answer different questions: this one always repairs (§5.4 states it as the ONLY
 * behaviour for a row/column), while whole-object deletion's default is still
 * to protect a formula elsewhere by refusing (§5.1.1's REJECT-by-default
 * stance for `delete <object>`).
 *
 * PRECONDITION, enforced by `mutate` before this is ever folded (mirroring
 * `InsertTableLineOperation`'s own precondition doc comment): `objectId`
 * names an EXISTING object of type `"table"` whose WHOLE extent — BOTH
 * `rows` AND `cols`, not only the axis this operation targets — can be
 * coherently read (D-046/**D-053**, `isTableDimensionResizable`), and `index`
 * names an EXISTING row/column AS OF THIS OPERATION'S OWN POSITION in the
 * batch — `findInvalidTableResizes` (which simulates insertion and deletion
 * together, in ONE left-to-right walk, per D-050's binding text, and checks
 * both dimensions per D-053) is the primary check. Unlike insertion,
 * `deleteTableLine` (the
 * primitive) does NOT clamp an out-of-range index — there is no "nearest
 * line" to delete instead of a nonexistent one — so this precondition is the
 * ONLY thing standing between a malformed operation and a malformed table;
 * see that primitive's own doc comment.
 *
 * **D-057**: §5.1.1/§5.4's "report every slot it broke" is `MutationResult`'s
 * `brokenSlots` — ONE channel, shared with `DeleteObjectOperation`'s `force`
 * repair site. This operation reports through the same
 * `repairObjectFormulaAddresses` every other repair site uses; nothing
 * deletion-specific.
 *
 * KNOWN GAP (0051-REVIEW-phase2 §5, NOT patched here — see D-053's companion
 * ruling): this operation's repair pass is unbounded (any inbound reference
 * to a cell on this table is repaired, in-extent or not) while its cell-slot
 * walk is extent-bounded (D-049), so a reference to an out-of-extent cell
 * slot shifts to an empty position and dangles, rejecting the WHOLE batch —
 * contradicting §5.4's "it proceeds even when other objects depend on the
 * deleted cells." Reachable only through the carried dimension/cell coherence
 * gap (an out-of-extent cell slot, creatable only by a raw `setSlot`). Fixing
 * this on the delete side alone would leave insertion's identical divergence
 * (accepted at 0048-REVIEW as case 4) disagreeing with it — forbidden by
 * D-053's companion ruling. Pinned by a test in `mutation.test.ts`, not
 * patched; closes only when the coherence gap closes for both operations at
 * once, in its own slice.
 */
export interface DeleteTableLineOperation {
  readonly kind: "deleteTableLine";
  readonly objectId: string;
  readonly axis: "row" | "column";
  readonly index: number;
}

/**
 * The full set of operations `mutate` can apply. A new kind WIDENS this union,
 * per Q-005/D-020's "widen the union, never restructure" stance — never a
 * second entry point.
 */
export type Operation = SetSlotOperation | DeleteObjectOperation | CreateObjectOperation | InsertTableLineOperation | DeleteTableLineOperation;

/** The object id an operation targets, whichever variant it is — shared by the existence check and the message-building below. */
function operationTargetId(operation: Operation): string {
  if (operation.kind === "deleteObject") {
    return operation.objectId;
  }
  if (operation.kind === "createObject") {
    return operation.object.id;
  }
  if (operation.kind === "insertTableLine" || operation.kind === "deleteTableLine") {
    return operation.objectId;
  }
  return operation.address.objectId;
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
 * legal document state at all was a separate question (Q-006) at the time
 * D-019 was ruled — now ANSWERED (D-025, cycle 0023: no, it is not) — but
 * this function's job was always narrower and binds regardless of how that
 * landed: whatever `Value` a slot legally holds, the clone MUST preserve it
 * exactly. That fidelity is what makes D-025's own rejection check
 * trustworthy in the first place — a lossy clone would hide an illegal value
 * from it (see `findNonFiniteSlotValues`'s own doc comment).
 * `structuredClone` remains unavailable (D-006: it is a DOM-lib
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
 * `deleteObject`, `operation.force` absent/false (default, unchanged since
 * cycle 0022): removes the whole object named by `operation.objectId` —
 * `.filter`, not `.map`, since this variant shrinks the array rather than
 * rewriting one entry in place. Nothing checks here whether some OTHER
 * object's formula still points at one of the removed object's slots — that
 * is `validateIntegrity`'s dangling-reference check again, unchanged: an edge
 * whose `sourceSlot` no longer resolves is exactly what that check already
 * looks for, and it runs over the candidate AFTER this whole batch has been
 * folded, so it sees the object genuinely gone (§5.1.1 clause 1's REJECT path,
 * closing Phase 0 acceptance clause 3).
 *
 * `deleteObject`, `operation.force: true` (entry 0053, D-056): takes §5.1.1's
 * REPAIR path instead. Touches every object in `objects`, the same posture
 * `insertTableLine`/`deleteTableLine` already take, for the same reason —
 * §5.1.1's repair contract is document-wide, not scoped to the object being
 * deleted. `repairObjectFormulaAddresses` runs with
 * `repairReferenceForDeletedObject`/`repairRangeForDeletedObject` (below) —
 * NOT `primitives/table.ts`'s cell-shifting callbacks — over EVERY object
 * INCLUDING the one about to be deleted (repairing its own self-references is
 * harmless busywork, discarded a line later; the alternative, a
 * relevance pre-filter, is exactly what the established posture forbids).
 * THEN the deleted object is filtered out of the repaired result, and its own
 * `brokenSlots` entries (if it had any formula naming its own other slots)
 * are dropped from the report — reporting a broken slot on an object that no
 * longer exists is not useful to anyone.
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
 * `deleteObject` for it is seen (ADDING one for a valid `createObject`,
 * cycle 0024) — so this function itself can still simply ASSUME a match
 * exists (or, for `createObject`, ASSUME no match exists yet); see `mutate`'s
 * own doc comment for the simulation.
 *
 * `createObject`: appends `operation.object` to the array — the one variant
 * that GROWS it rather than rewriting or removing an entry. `document.ts`'s
 * loader (cycle 0024, §5.11) is the reason this exists: reconstructing a
 * saved document means creating every one of its objects, from nothing, via
 * this exact mechanism (never a separate, parallel "just assign the array"
 * path — Rule 2).
 *
 * `insertTableLine` (entry 0047, §5.4): the ONE variant that touches every
 * object in `objects`, not just its own target — because §5.4's reference-
 * adjustment pass is explicit that a row/column insertion must rewrite
 * affected addresses "over every stored AST in the document... other tables
 * and text boxes may point into it." Two DIFFERENT things move here, and
 * they are computed from ONE shared `clampedIndex` so they cannot disagree:
 * (1) the target table's OWN cell slots shift position
 * (`primitives/table.ts`'s `insertTableLine`); (2) EVERY object's formula
 * slots (the target table's own included — a cell can reference a sibling
 * cell in the SAME table) get their stored ASTs rewritten via
 * `rewriteObjectFormulaAddresses` below, which is entirely blind to WHICH
 * object it is walking — it rewrites whatever `ReferenceNode`/`RangeNode`
 * addresses happen to name the resized table, on every object, uniformly.
 * `target === undefined` is defensive-only (the existence check already
 * guarantees `operation.objectId` resolves by the time this runs); returning
 * `objects` unchanged rather than throwing matches this file's "never
 * throws" discipline everywhere else.
 *
 * `deleteTableLine` (entry 0050, §5.4): the DELETE-side sibling of
 * `insertTableLine` above, and the FIRST branch in this file to take §5.1.1's
 * REPAIR path. Also touches every object in `objects`, for the same reason:
 * (1) the target table's OWN cell slots shift/drop (`primitives/table.ts`'s
 * `deleteTableLine`); (2) EVERY object's formula slots get their stored ASTs
 * REPAIRED via `repairObjectFormulaAddresses` below — an address naming the
 * removed line becomes `#REF` (D-028), one entirely after it shifts back, one
 * entirely before it is untouched. Unlike insertion, there is no shared
 * "clampedIndex" to compute here: `findInvalidTableResizes` already
 * guarantees `operation.index` names a real row/column at this operation's
 * position in the batch, and `deleteTableLine`/`repairCellAddressForDelete`/
 * `repairRangeEndpointsForDelete` all read `operation.index` directly.
 *
 * RETURN SHAPE (D-057): every branch returns
 * `brokenSlots` alongside `objects` — the `Address` of every slot a
 * REPAIR (never a plain shift) rewrote at least one reference inside, empty
 * for every branch that cannot break anything (`setSlot`, `deleteObject`
 * without `force`, `createObject`, `insertTableLine` — insertion only ever
 * shifts, per D-051/D-052). `mutate` accumulates this across the whole
 * batch's fold — see its own doc comment.
 */
function applyOperation(
  objects: readonly GraphObject[],
  operation: Operation,
): { readonly objects: readonly GraphObject[]; readonly brokenSlots: readonly Address[] } {
  if (operation.kind === "deleteObject") {
    if (operation.force !== true) {
      return { objects: objects.filter((object) => object.id !== operation.objectId), brokenSlots: [] };
    }
    const repairReference = (address: Address): Address | "deleted" => repairReferenceForDeletedObject(address, operation.objectId);
    const repairRange = (start: Address, end: Address) => repairRangeForDeletedObject(start, end, operation.objectId);
    const repaired = objects
      .map((object) => repairObjectFormulaAddresses(object, repairReference, repairRange))
      .filter((entry) => entry.object.id !== operation.objectId); // The deleted object itself, and any report about ITS OWN slots, leave together.
    return { objects: repaired.map((entry) => entry.object), brokenSlots: repaired.flatMap((entry) => entry.brokenSlots) };
  }
  if (operation.kind === "createObject") {
    // D-024: the caller's own GraphObject never enters committed state by
    // reference — same reasoning as setSlot's payload below.
    return { objects: [...objects, deepClone(operation.object)], brokenSlots: [] };
  }
  if (operation.kind === "insertTableLine") {
    const target = objects.find((object) => object.id === operation.objectId);
    if (target === undefined) {
      return { objects, brokenSlots: [] }; // Defensive only — see doc comment above.
    }
    const { rows, cols } = getTableDimensions(target);
    const bound = operation.axis === "row" ? rows : cols;
    const clampedIndex = Math.max(1, Math.min(operation.index, bound + 1));
    const shiftAddress = (address: Address): Address => shiftCellAddressForInsert(address, operation.objectId, operation.axis, clampedIndex);
    return {
      objects: objects.map((object) => {
        const resized = object.id === operation.objectId ? insertTableLine(object, operation.axis, clampedIndex) : object;
        return rewriteObjectFormulaAddresses(resized, shiftAddress);
      }),
      brokenSlots: [], // Insertion only ever shifts an address — it never breaks one (D-051/D-052).
    };
  }
  if (operation.kind === "deleteTableLine") {
    const target = objects.find((object) => object.id === operation.objectId);
    if (target === undefined) {
      return { objects, brokenSlots: [] }; // Defensive only — the existence check already guarantees this resolves.
    }
    // §5.1.1 REPAIR path, unconditional (DeleteTableLineOperation's own doc
    // comment) — no clamping the way insertion does: `findInvalidTableResizes`
    // is what guarantees `operation.index` names a real row/column before this
    // ever runs.
    const repairReference = (address: Address): Address | "deleted" =>
      repairCellAddressForDelete(address, operation.objectId, operation.axis, operation.index);
    const repairRange = (start: Address, end: Address) => repairRangeEndpointsForDelete(start, end, operation.objectId, operation.axis, operation.index);
    const repaired = objects.map((object) => {
      const resized = object.id === operation.objectId ? deleteTableLine(object, operation.axis, operation.index) : object;
      return repairObjectFormulaAddresses(resized, repairReference, repairRange);
    });
    return { objects: repaired.map((entry) => entry.object), brokenSlots: repaired.flatMap((entry) => entry.brokenSlots) };
  }
  return {
    objects: objects.map((object) => {
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
    }),
    brokenSlots: [],
  };
}

/**
 * Whole-object repair callbacks for `DeleteObjectOperation`'s `force` flag
 * (entry 0053, **D-056**: reuse `repairObjectFormulaAddresses` AS IT STANDS,
 * different callbacks — no third `*ObjectFormulaAddresses` helper). Unlike
 * row/column deletion's callbacks (`primitives/table.ts`), these have NO
 * notion of shifting: an address either names a slot on the deleted object,
 * or it does not — there is no partial adjustment for a whole object going
 * away, so both callbacks are a single equality check.
 */
function repairReferenceForDeletedObject(address: Address, deletedObjectId: string): Address | "deleted" {
  return address.objectId === deletedObjectId ? "deleted" : address;
}

/**
 * D-056 / 0051-REVIEW-phase2 §9 answer 3: a `RangeNode` with EITHER endpoint
 * naming the deleted object reports `"deleted"` ENTIRELY — no remaining
 * extent to clamp to, unlike `primitives/table.ts`'s
 * `repairRangeEndpointsForDelete`, which clamps a range within a table that
 * still exists. D-045 already guarantees a range's two endpoints always name
 * the SAME object, so checking either is equivalent to checking both — this
 * checks both anyway, matching the ruling's own literal wording rather than
 * relying on a guarantee this function itself has no way to verify.
 */
function repairRangeForDeletedObject(
  start: Address,
  end: Address,
  deletedObjectId: string,
): { readonly start: Address; readonly end: Address } | "deleted" {
  return start.objectId === deletedObjectId || end.objectId === deletedObjectId ? "deleted" : { start, end };
}

/**
 * Rebuilds `object`'s `slots`, passing every `formula`-kind slot's AST
 * through `formula/deps.ts`'s `rewriteAddressesInAst` with `shiftAddress` —
 * `literal`/`derived` slots are returned completely unchanged (neither has
 * an AST to rewrite). Called once per object, for EVERY object, by
 * `applyOperation`'s `insertTableLine` branch above — `shiftAddress` itself
 * already knows to leave any address alone that does not name the resized
 * table, so this function needs no notion of "is this object even
 * relevant."
 */
function rewriteObjectFormulaAddresses(object: GraphObject, shiftAddress: (address: Address) => Address): GraphObject {
  const newSlots: Record<string, Slot> = {};
  for (const key of Object.keys(object.slots)) {
    const slot = object.slots[key];
    if (slot === undefined) {
      continue; // noUncheckedIndexedAccess artifact only.
    }
    newSlots[key] = slot.kind === "formula" ? { ...slot, ast: rewriteAddressesInAst(slot.ast, shiftAddress) } : slot;
  }
  return { ...object, slots: newSlots };
}

/**
 * The DELETE-side sibling of `rewriteObjectFormulaAddresses` above: rebuilds
 * `object`'s `slots`, passing every `formula`-kind slot's AST through
 * `formula/deps.ts`'s node-level `repairAddressesInAst` with
 * `repairReference`/`repairRange` — `literal`/`derived` slots are returned
 * completely unchanged (neither has an AST to repair). Called once per
 * object, for EVERY object, by `applyOperation`'s `deleteTableLine` branch
 * AND its `deleteObject`-with-`force` branch —
 * `repairReference`/`repairRange` already know to leave any address alone
 * that does not name the deleted table/object, so this function needs no
 * notion of "is this object even relevant," the same posture
 * `rewriteObjectFormulaAddresses` already takes. The two call sites differ
 * ONLY in which callbacks they pass (table-cell-shifting vs.
 * whole-object-equality, D-056) — this function itself stays blind to which.
 *
 * **D-057: also returns `brokenSlots`**, the `Address`
 * of every formula slot that had at least one reference/range turned into
 * `"deleted"` during ITS OWN walk — tracked by wrapping `repairReference`/
 * `repairRange` in a per-slot closure flag, rather than changing
 * `repairAddressesInAst`'s own signature (which would make it a DIFFERENT
 * shape from `rewriteAddressesInAst`'s, breaking the pair D-052/D-056 keep
 * deliberately parallel). A slot's Address is recovered via
 * `resolveSlotPathForKey` — never by inverting the stored key (D-010).
 */
function repairObjectFormulaAddresses(
  object: GraphObject,
  repairReference: (address: Address) => Address | "deleted",
  repairRange: (start: Address, end: Address) => { readonly start: Address; readonly end: Address } | "deleted",
): { readonly object: GraphObject; readonly brokenSlots: readonly Address[] } {
  const newSlots: Record<string, Slot> = {};
  const brokenSlots: Address[] = [];
  for (const key of Object.keys(object.slots)) {
    const slot = object.slots[key];
    if (slot === undefined) {
      continue; // noUncheckedIndexedAccess artifact only.
    }
    if (slot.kind !== "formula") {
      newSlots[key] = slot;
      continue;
    }
    let broke = false;
    const trackedReference = (address: Address): Address | "deleted" => {
      const repaired = repairReference(address);
      if (repaired === "deleted") {
        broke = true;
      }
      return repaired;
    };
    const trackedRange = (start: Address, end: Address): { readonly start: Address; readonly end: Address } | "deleted" => {
      const repaired = repairRange(start, end);
      if (repaired === "deleted") {
        broke = true;
      }
      return repaired;
    };
    newSlots[key] = { ...slot, ast: repairAddressesInAst(slot.ast, trackedReference, trackedRange) };
    if (broke) {
      const path = resolveSlotPathForKey(object, key);
      // `path === undefined` is defensive-only: cannot happen for a real
      // formula slot on a schema-registered type, which every product
      // primitive is (D-011). Silently omitting rather than throwing matches
      // this file's "never throws" discipline; there is nothing better to do
      // with an address that cannot be named.
      if (path !== undefined) {
        brokenSlots.push({ objectId: object.id, path });
      }
    }
  }
  return { object: { ...object, slots: newSlots }, brokenSlots };
}

/**
 * Recovers a `formula`-kind slot's declared PATH from its stored KEY, so a
 * repair report (D-057) can name a real `Address` — never by inverting
 * `slotKey` (D-010: no module builds a path by splitting a key string), but
 * by resolving the object's schema-declared paths FORWARD (the same
 * `resolveNonDerivedSlotPaths` call `findUndeclaredFormulaOrDerivedSlots`
 * already makes, D-017) and finding the one whose OWN `slotKey` matches —
 * D-022's own "declare it schema-side" escape hatch, taken structurally
 * rather than by string surgery. Returns `undefined` only if `object`'s type
 * has no schema, or the schema does not declare this key — cannot happen in
 * practice for a real product primitive (D-011: every registered type has a
 * real schema entry), but repair runs during step 2, before step 4 ever
 * re-validates D-017, so this stays defensive rather than assumed.
 */
function resolveSlotPathForKey(object: GraphObject, key: string): readonly string[] | undefined {
  const schema = getObjectSchema(object.type);
  if (schema === undefined) {
    return undefined;
  }
  return resolveNonDerivedSlotPaths(object, schema.nonDerivedSlotPaths).find((path) => slotKey(path) === key);
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
 * `ok: true` carries the new committed `objects` (step 7's evaluated result),
 * `journal` (with exactly one new entry appended, step 8, holding every
 * operation in the batch that was just committed), and (**D-057**)
 * `brokenSlots`: every slot ANY repair in this batch turned at
 * least one reference/range inside into `#REF` — §5.1.1's "the command must
 * report which slots were broken" / §5.4's "the command reports every slot
 * it broke," ONE field serving BOTH repair sites (row/column deletion,
 * `delete <table> force`), deduplicated by address (a batch that breaks TWO
 * DIFFERENT references inside the SAME slot, via two different operations,
 * reports that slot once — see `mutate`'s own doc comment). Empty for a batch
 * that repaired nothing, which is the common case (most operations cannot
 * break anything at all).
 */
export type MutationResult =
  | {
      readonly ok: true;
      readonly objects: readonly GraphObject[];
      readonly journal: readonly MutationJournalEntry[];
      readonly brokenSlots: readonly Address[];
    }
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
 *   made variant-aware for every kind that can add or remove one: ANY operation
 *   in the batch whose target does not exist AT THE MOMENT it would be folded
 *   rejects the WHOLE batch — never a silent no-op for that one operation
 *   while the rest proceed, matching "committing all-or-nothing." A single
 *   `objects.find` against the ORIGINAL, pre-batch `objects` is not
 *   sufficient on its own: a
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
 * A THIRD check, also before staging, also over the RAW `operations` (cycle
 * 0026, closing 0025-REVIEW-phase0 finding 1's write side):
 *
 * - **D-025/Q-008 on the PAYLOAD** (`findIllegalOperationPayloads`). Checks
 *   1-2 above simulate object EXISTENCE only; neither looks at what an
 *   operation would actually WRITE. `findIllegalSlotValues` (validateIntegrity
 *   check 4) does look at values, but only over the POST-FOLD graph — so an
 *   operation carrying an illegal value that a LATER operation in the SAME
 *   batch overwrites (`[setSlot v=Infinity, setSlot v=5]`) or that belongs to
 *   an object a LATER operation in the SAME batch deletes
 *   (`[createObject {v: NaN}, deleteObject]`) never reaches check 4 at all —
 *   the illegal payload still lands in the JOURNAL, which records every
 *   operation in the batch, not just the graph's final shape. This check
 *   closes that hole at its source: it inspects `setSlot`'s `slot.value` and
 *   every slot of `createObject`'s whole `object`, and rejects the WHOLE
 *   batch if ANY operation's payload is illegal — regardless of whether that
 *   operation's effect would have been overwritten or deleted later in the
 *   SAME batch. `deleteObject` carries no value payload and is skipped.
 *   Gathers every offending operation in one pass, same style as the other
 *   two checks. Named via `formatAddress` where the target already resolves
 *   (a `setSlot` almost always names an existing object) or the object's own
 *   `name` field where it does not yet exist in `objects` at all (a
 *   `createObject` payload carries its own name, so `describeUndeclaredSlot`
 *   applies directly — see that function's own doc comment for why reusing it
 *   here is its third sanctioned call site's shape, not a new exception).
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
  // both shrink AND grow the object set mid-fold (`DeleteObjectOperation`,
  // `CreateObjectOperation`): a plain "does operationTargetId(operation)
  // exist in the ORIGINAL objects" check (0019/0020's version) is no longer
  // sound on its own — an operation later in the batch may target an object
  // an EARLIER operation in the SAME batch already deleted OR just created,
  // which the original `objects` array alone cannot show. Simulate the
  // fold's effect on OBJECT EXISTENCE ONLY (a plain `Set<id>`, no slot data)
  // walking the batch in order, so each operation's target is checked
  // against exactly the id set it would actually see once folded — while
  // still gathering EVERY offending operation in one pass, not stopping at
  // the first, matching 0020's own reasoning (a document load with several
  // bad references benefits from seeing all of them at once — the exact
  // shape a corrupted saved document's object list could produce).
  //
  // `createObject`'s precondition is the MIRROR of the other two: it must
  // name an id that does NOT yet exist (creating a DUPLICATE id would either
  // silently coexist as two objects sharing one id — meaningless, since every
  // lookup in this codebase finds only the first — or, if allowed to
  // proceed, produce exactly that ambiguity; D-002 already requires ids to be
  // unique and never reused, so a batch that would violate that is rejected
  // outright, the same "no silently-wrong result" stance every other check
  // in this file takes).
  const survivingIds = new Set(objects.map((object) => object.id));
  const missingTargetMessages: string[] = [];
  operations.forEach((operation, index) => {
    const targetId = operationTargetId(operation);
    const prefix = `operation ${index + 1} of ${operations.length}`;
    if (operation.kind === "createObject") {
      if (survivingIds.has(targetId)) {
        missingTargetMessages.push(
          `${prefix} attempts to create object id "${targetId}", which ALREADY exists in this document (D-002/D-021)`,
        );
        return; // Nothing to add — this id was already taken, duplicate creation refused.
      }
      survivingIds.add(targetId); // A later operation targeting this SAME id must see it as existing.
      return;
    }
    if (!survivingIds.has(targetId)) {
      // D-023: the object id appears here, LABELLED as an id, because no
      // name exists to print — the whole rejection is that nothing resolves.
      let detail: string;
      if (operation.kind === "deleteObject") {
        detail = `attempts to delete object id "${targetId}"`;
      } else if (operation.kind === "insertTableLine") {
        detail = `attempts to insert a ${operation.axis} into object id "${targetId}"`;
      } else if (operation.kind === "deleteTableLine") {
        detail = `attempts to delete a ${operation.axis} from object id "${targetId}"`;
      } else {
        detail = `targets slot "${slotKey(operation.address.path)}" on object id "${targetId}"`;
      }
      missingTargetMessages.push(`${prefix} ${detail}, which does not exist in this document (D-021)`);
      return; // Nothing to remove from the simulation — this id was never in it.
    }
    if (operation.kind === "deleteObject") {
      survivingIds.delete(targetId); // A later operation targeting the SAME id must see it gone.
    }
  });
  if (missingTargetMessages.length > 0) {
    return { ok: false, message: missingTargetMessages.join("; ") };
  }

  // D-025/Q-008 on the WRITE side (cycle 0026, 0025-REVIEW-phase0 finding 1):
  // an operation's own PAYLOAD is rejected here, before staging, if it is
  // illegal — regardless of whether a LATER operation in this SAME batch
  // would overwrite it or delete the object it belongs to. See
  // `findIllegalOperationPayloads`'s own doc comment for why this cannot be
  // folded into `findIllegalSlotValues` (validateIntegrity check 4), which
  // only ever sees the POST-FOLD graph.
  const illegalPayloadMessages = findIllegalOperationPayloads(operations, objects);
  if (illegalPayloadMessages.length > 0) {
    return { ok: false, message: illegalPayloadMessages.join("; ") };
  }

  // Entry 0047/0048-REVIEW-phase2/0050, §5.4: an `insertTableLine` or
  // `deleteTableLine` naming a non-table object, a non-resizable dimension
  // (D-046), or an out-of-range index — both validated TOGETHER against the
  // batch as simulated LEFT-TO-RIGHT (D-050) — is rejected here with a
  // message naming the problem.
  const invalidResizeMessages = findInvalidTableResizes(operations, objects);
  if (invalidResizeMessages.length > 0) {
    return { ok: false, message: invalidResizeMessages.join("; ") };
  }

  const staged = cloneObjects(objects);
  // Fold left-to-right over the SAME clone (§5.1: "applied to a single
  // clone") — each operation sees every earlier operation's effect, unlike N
  // independent single-operation mutate() calls, which would each re-derive
  // edges, re-validate, and re-evaluate the whole graph from scratch.
  //
  // D-057 (entry 0053): `brokenSlots` accumulates alongside `objects` in the
  // SAME fold, for the SAME reason `objects` itself does — a later
  // operation's repair pass must be able to add to what earlier operations in
  // this batch already broke, not start a parallel, disconnected report.
  const folded = operations.reduce<{ readonly objects: readonly GraphObject[]; readonly brokenSlots: readonly Address[] }>(
    (current, operation) => {
      const applied = applyOperation(current.objects, operation);
      return { objects: applied.objects, brokenSlots: [...current.brokenSlots, ...applied.brokenSlots] };
    },
    { objects: staged, brokenSlots: [] },
  );

  const result = deriveValidateAndEvaluate(folded.objects);
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
    // D-057: deduplicated by address (`addressKey`, D-015: internal keying
    // only, never printed) — the SAME slot broken by two DIFFERENT
    // references/operations in one batch is reported once, not twice. An
    // already-`#REF` reference is never re-broken by a later repair pass
    // (`repairAddressesInAst`'s own `"error"` case returns it as-is), so this
    // can only fire for two DIFFERENT references inside the SAME slot's
    // formula, broken by two DIFFERENT operations in the SAME batch.
    //
    // **D-059** (0054-REVIEW-phase2, reviewer edit): the report is then
    // filtered against the COMMITTED state — a broken slot that no longer
    // exists once the WHOLE batch has been applied is dropped, never
    // reported. `applyOperation`'s own `deleteObject` branch already drops
    // reports about the object THAT operation deletes, but it cannot see a
    // LATER operation in the same batch deleting the object whose slot an
    // EARLIER one broke (`[deleteObject A force, deleteObject B force]`
    // where B read A; `[deleteTableLine table_x …, deleteObject table_x
    // force]`). Such an address names nothing the user can repair, and
    // `formatAddress` cannot even render it — it resolves no object, so it
    // returns an `AddressError` and the report would print as `#REF`.
    brokenSlots: dedupeAddresses(folded.brokenSlots).filter((address) => {
      const object = result.objects.find((candidate) => candidate.id === address.objectId);
      return object !== undefined && object.slots[slotKey(address.path)] !== undefined;
    }),
  };
}

/**
 * Dedupes a list of `Address`es by identity (`objectId` + `path`), keeping
 * the first occurrence — `mutate`'s own doc comment explains why `brokenSlots`
 * needs this. Uses `graph/edge.ts`'s `addressKey` purely as an internal
 * `Set` key (D-015's sanctioned use — never printed, never returned).
 */
function dedupeAddresses(addresses: readonly Address[]): readonly Address[] {
  const seen = new Set<string>();
  const deduped: Address[] = [];
  for (const address of addresses) {
    const key = addressKey(address);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(address);
  }
  return deduped;
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
    // resolved `nonDerivedSlotPaths` path rather than inverting anything.
    // `resolveNonDerivedSlotPaths` resolves per-OBJECT (not per-type), because
    // a `dynamic` group (table's `cells.*`) depends on THIS object's own
    // current `rows`/`cols` — see `primitives/schema.ts`'s own doc comment for
    // why this must be the one place that resolution happens.
    const declaredKeys = new Set<string>([
      ...resolveNonDerivedSlotPaths(object, schema.nonDerivedSlotPaths).map((path) => slotKey(path)),
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
 * Names a slot WITHOUT assuming it has a schema-declared path — see the file
 * header's discussion of why this is a deliberate, disclosed exception rather
 * than the "invert `slotKey`" pattern D-010/STATUS rule out elsewhere.
 * Produces the EXACT SAME string `formatAddress` would for every
 * schema-registered type today (`value`/`add`): neither is a table, and
 * `address.ts`'s `toSurfacePath` is the identity for every non-table type, so
 * `formatAddress`'s `[name, ...path].join(".")` collapses to exactly
 * `name + "." + slotKey(path)` — i.e. `name + "." + key`. This stops being
 * exact only for a type using D-005's surface/stored mapping (a table); D-017
 * already forbids extending `nonDerivedSlotPaths` to tables for the same
 * underlying reason, so that combination cannot arise before Phase 4 revisits
 * the whole mechanism.
 *
 * THREE call sites (D-022 confines this raw-key naming style to THIS
 * function — every other site reuses it, never reimplements
 * it): `findUndeclaredFormulaOrDerivedSlots`, where the slot
 * genuinely has no schema-declared path by definition; `findIllegalSlotValues`
 * (D-025, cycle 0023), where it might or might not be declared — an extra
 * literal slot is legal regardless of the schema (`validateIntegrity` never
 * restricts those), so that check cannot assume a real `Address` is
 * recoverable via the schema the way check 2 (`findSchemaSlotKindMismatches`)
 * can; and `findIllegalOperationPayloads`'s `createObject` branch (cycle
 * 0026), naming a slot on an object that may not even exist in `objects` YET
 * (it is only being proposed by this very operation) — there is no `objects`
 * list to resolve a schema lookup against at all in that case, only the
 * payload's own `object.name`. The bounded correctness claim above (identical
 * to `formatAddress` for every non-table type) is exactly what makes reusing
 * it safe in all three cases, not only the definitely-undeclared one it was
 * built for.
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

    for (const path of resolveNonDerivedSlotPaths(object, schema.nonDerivedSlotPaths)) {
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

/**
 * D-025 (Q-006, cycle 0023), widened by Q-008 (cycle 0026): non-finite
 * numbers and `-0` are not legal document state. Checks every slot's `value`
 * field — `LiteralSlot`, `FormulaSlot`, and `DerivedSlot` all carry one
 * (`graph/node.ts`) — via `hasIllegalNumber` (D-014's shared-predicate
 * principle), regardless of the object's type or whether it has a schema
 * entry at all: unlike D-017/D-018, this check needs no schema knowledge, so
 * there is no "type with no schema yet" exemption.
 *
 * WIDENED by **D-031**: a `formula`-kind slot's stored AST is ALSO
 * walked (`collectIllegalAstLiterals` below) for any `LiteralNode` whose
 * number value fails the SAME `isIllegalNumber` leaf predicate — a number
 * `slot.value` never happened to reach the cached `formula`/`derived` result
 * itself, but §5.11 serializes the stored AST as part of the document, so a
 * `LiteralNode` inside it is document state exactly the same way a slot's
 * `value` is (D-027's own generalisation: "every number reachable from a
 * `Document`").
 *
 * Named via `describeUndeclaredSlot` — REUSING the same function
 * `findUndeclaredFormulaOrDerivedSlots` already calls, not a new copy of its
 * raw-key naming (D-022 confines that naming style to this one function; the
 * fix is to call it, not to reimplement it a second time). It is the right
 * tool here for the same reason it is there: a LITERAL slot's key need not
 * correspond to any schema-declared path at all (extra literal slots are
 * legal — `validateIntegrity` never restricts them against a schema, only
 * `formula`/`derived`-kind slots), so this check cannot assume a real
 * `Address` is always recoverable via the schema the way check 2 above can.
 * `describeUndeclaredSlot`'s own bounded correctness claim (D-022: identical
 * to `formatAddress` for every registered, non-table type) makes this exact
 * for Phase 0's fixtures regardless of whether the slot happens to BE
 * schema-declared or not.
 *
 * Checks only the POST-FOLD graph — see `mutate`'s doc comment and
 * `findIllegalOperationPayloads` below for the companion check this one does
 * NOT make: an operation's own payload, before it is folded at all. As of
 * D-048, that companion check ALSO walks a payload's stored AST the same
 * D-031 way, via the same `collectIllegalAstLiterals` this function calls.
 */
function findIllegalSlotValues(objects: readonly GraphObject[]): readonly string[] {
  const problems: string[] = [];

  for (const object of objects) {
    for (const key of Object.keys(object.slots)) {
      const slot = object.slots[key];
      if (slot === undefined) {
        continue; // noUncheckedIndexedAccess artifact only — key came from Object.keys of this same record.
      }
      if (hasIllegalNumber(slot.value)) {
        problems.push(`${describeUndeclaredSlot(object, key)} holds an illegal value (${describeIllegalValue(slot.value)}), which is not legal document state (D-025/Q-008)`);
      }
      if (slot.kind === "formula") {
        // D-031: the stored AST is document state too (§5.11) — walked
        // separately from `slot.value` above, which is only ever this
        // formula's last CACHED evaluation result, not what the user wrote.
        const illegalLiterals = collectIllegalAstLiterals(slot.ast);
        if (illegalLiterals.length > 0) {
          problems.push(
            `${describeUndeclaredSlot(object, key)}'s stored formula holds illegal number literal(s) ` +
              `(${illegalLiterals.map(formatIllegalNumber).join(", ")}), which is not legal document state (D-025/D-031)`,
          );
        }
      }
    }
  }

  return problems;
}

/**
 * D-031: walks every `LiteralNode` in a formula's stored AST (structural
 * recursion, mirroring `deps.ts`'s own `walk` and `formula/eval.ts`'s
 * `evaluateNode` — one exhaustive `switch` on `.type`), collecting the
 * NUMBER value of any that fails `isIllegalNumber` (`graph/node.ts`'s leaf
 * predicate — the raw number check, not `hasIllegalNumber`'s `Value`-shaped
 * wrapper: a `LiteralNode.value` is `number | string | boolean`, ast.ts, so
 * only the number arm can ever be illegal). Never throws — matches every
 * other AST walk in this codebase.
 */
function collectIllegalAstLiterals(ast: FormulaAst, out: number[] = []): number[] {
  switch (ast.type) {
    case "literal":
      if (typeof ast.value === "number" && isIllegalNumber(ast.value)) {
        out.push(ast.value);
      }
      return out;
    case "reference":
    case "range":
    case "error":
      return out; // No LiteralNode anywhere in these shapes.
    case "binaryOp":
      collectIllegalAstLiterals(ast.left, out);
      collectIllegalAstLiterals(ast.right, out);
      return out;
    case "unaryOp":
      collectIllegalAstLiterals(ast.operand, out);
      return out;
    case "functionCall":
      for (const arg of ast.args) {
        collectIllegalAstLiterals(arg, out);
      }
      return out;
    default: {
      // Compile-time exhaustiveness, WITHOUT a throw — same defensive stance
      // every other AST walk in this codebase takes against a hand-edited or
      // loaded AST reaching a shape the compiler believes impossible.
      const exhaustive: never = ast;
      void exhaustive;
      return out;
    }
  }
}

/**
 * §5.1's own operation-payload precondition for D-025/Q-008 (cycle 0026,
 * closing 0025-REVIEW-phase0 finding 1's write side) — see `mutate`'s doc
 * comment for WHY this is a separate check from `findIllegalSlotValues`
 * above, not a duplicate of it: this one inspects RAW `operations`, before
 * any fold, so it catches a payload the fold would otherwise hide (overwritten
 * by a later operation in the same batch, or attached to an object a later
 * operation in the same batch deletes).
 *
 * `setSlot`: checks `operation.slot.value`. Named via `formatAddress` against
 * the PRE-BATCH `objects` — almost always resolves, since a `setSlot` nearly
 * always targets an object that already exists; on the one edge case it does
 * not (a batch that creates an object and then, in the same batch, writes an
 * illegal value to one of ITS slots via a separate `setSlot`), `formatAddress`
 * itself already falls back to naming the raw id as an id (D-023) — the same
 * defensive handling this file's other `formatAddress` call sites use. As of
 * D-048 (0045-REVIEW), a `formula`-kind `operation.slot` is ALSO walked via
 * `collectIllegalAstLiterals` — the same check `findIllegalSlotValues` runs
 * post-fold, run here too so a payload a LATER operation in the SAME batch
 * overwrites never slips past both checks.
 *
 * `createObject`: checks EVERY slot of `operation.object`, gathering every
 * illegal one, not just the first — same "one problem per bad thing found"
 * style as `validateIntegrity`'s own checks. Named via `describeUndeclaredSlot`
 * (this function's third sanctioned call site — see its own doc comment):
 * the object being created is not yet in `objects` at all, so there is
 * nothing to `formatAddress` against; only the payload's own `object.name` is
 * available, exactly the situation that function already exists for. Each
 * `formula`-kind slot gets the same D-048 AST walk as the `setSlot` arm.
 *
 * `deleteObject`: no value payload — skipped entirely.
 */
function findIllegalOperationPayloads(operations: readonly Operation[], objects: readonly GraphObject[]): readonly string[] {
  const problems: string[] = [];

  operations.forEach((operation, index) => {
    const prefix = `operation ${index + 1} of ${operations.length}`;

    if (operation.kind === "setSlot") {
      const formatted = formatAddress(operation.address, objects);
      const name = isAddressError(formatted) ? formatted.message : formatted;
      if (hasIllegalNumber(operation.slot.value)) {
        problems.push(
          `${prefix}: ${name} would hold an illegal value (${describeIllegalValue(operation.slot.value)}), which is not legal document state (D-025/Q-008)`,
        );
      }
      if (operation.slot.kind === "formula") {
        // D-048: the SAME walk `findIllegalSlotValues` runs post-fold, run
        // here too — otherwise a payload a LATER operation in this same
        // batch overwrites or deletes never reaches that check at all, even
        // though the journal records every operation in the batch.
        const illegalLiterals = collectIllegalAstLiterals(operation.slot.ast);
        if (illegalLiterals.length > 0) {
          problems.push(
            `${prefix}: ${name}'s formula would hold illegal number literal(s) ` +
              `(${illegalLiterals.map(formatIllegalNumber).join(", ")}), which is not legal document state (D-025/D-031/D-048)`,
          );
        }
      }
      return;
    }

    if (operation.kind === "createObject") {
      for (const key of Object.keys(operation.object.slots)) {
        const slot = operation.object.slots[key];
        if (slot === undefined) {
          continue; // noUncheckedIndexedAccess artifact only.
        }
        if (hasIllegalNumber(slot.value)) {
          problems.push(
            `${prefix}: ${describeUndeclaredSlot(operation.object, key)} would hold an illegal value ` +
              `(${describeIllegalValue(slot.value)}), which is not legal document state (D-025/Q-008)`,
          );
        }
        if (slot.kind === "formula") {
          // D-048, same reasoning as the setSlot arm above.
          const illegalLiterals = collectIllegalAstLiterals(slot.ast);
          if (illegalLiterals.length > 0) {
            problems.push(
              `${prefix}: ${describeUndeclaredSlot(operation.object, key)}'s formula would hold illegal number literal(s) ` +
                `(${illegalLiterals.map(formatIllegalNumber).join(", ")}), which is not legal document state (D-025/D-031/D-048)`,
            );
          }
        }
      }
      return;
    }

    // deleteObject / insertTableLine / deleteTableLine: none carry a
    // Slot/Value payload to check — insertTableLine's and deleteTableLine's
    // own preconditions (a valid target/index) are `findInvalidTableResizes`'s
    // job, below, not this function's.
  });

  return problems;
}

/**
 * One table's state AS SIMULATED THROUGH THE BATCH so far —
 * `findInvalidTableResizes` below's per-object tracking record, shared by
 * `insertTableLine` AND `deleteTableLine`. `rows`/`cols`
 * and the two `*Resizable` flags are read ONCE, when a table is FIRST
 * encountered (from `objects` or from a same-batch `createObject` payload —
 * see `resolveTrackedTableState`), then only `rows`/`cols` change — by +1
 * after each subsequent VALID `insertTableLine` targeting it, by -1 after
 * each subsequent VALID `deleteTableLine`. Literal-ness is never re-read:
 * both primitives only ever RE-ASSERT `literal` on both dimensions (never
 * convert one away from it), so nothing this function tracks can turn a
 * resizable dimension non-resizable mid-batch — see this function's own doc
 * comment for the one thing that CAN, and is deliberately not tracked here.
 */
interface TrackedTableState {
  readonly name: string;
  readonly isTable: boolean;
  readonly rowsResizable: boolean;
  readonly colsResizable: boolean;
  rows: number;
  cols: number;
}

/**
 * Entry 0047/0048-REVIEW-phase2/0050/0052's row/column resize precondition:
 * rejects an `insertTableLine` OR `deleteTableLine` operation whose
 * `objectId` does not name a `"table"`-type object, whose WHOLE extent cannot
 * be coherently read — EITHER `rows` OR `cols` not `literal` (**D-053**, fix
 * 3/D-046 — see `isTableDimensionResizable`), never only the dimension named
 * by `operation.axis` — or whose `index` is out of range for its OWN kind
 * (insertion: `1..count+1`;
 * deletion: `1..count`, since it must name a row/column that actually
 * exists) — with a message naming the operation and the problem, the same
 * style every other precondition check in this file uses. Runs BEFORE
 * staging (mirroring `findIllegalOperationPayloads`'s own placement).
 *
 * **D-050 (0048-REVIEW-phase2 fix 2), WIDENED entry 0050 to cover deletion
 * too.** Every `insertTableLine`/`deleteTableLine` is validated against the
 * table's state AS OF THIS OPERATION'S OWN POSITION in the batch — pre-batch
 * `objects` PLUS every earlier resize operation in the SAME batch that
 * targeted the SAME table, insert OR delete, walked in ONE left-to-right
 * pass — via one `Map<objectId, TrackedTableState>`, seeded lazily
 * (`resolveTrackedTableState`) and updated after each operation this
 * function accepts. D-050's own binding text requires this: "every future
 * operation kind that changes [table dimension count] MUST extend that same
 * simulation" — a SEPARATE simulation pass per operation kind would silently
 * mis-validate an INTERLEAVED batch (`[insert row at 1, delete row at 2]`),
 * since each pass would be blind to the other kind's effect on the same
 * table's count.
 *
 * Residual, narrower gap, NOT closed here and not previously reachable at all
 * (so not a regression): a `setSlot` EARLIER IN THE SAME BATCH that changes a
 * table's `rows`/`cols` VALUE or KIND after this function's per-table state
 * was seeded is not tracked — this function only simulates the effect of
 * `insertTableLine`/`deleteTableLine` operations, not arbitrary `setSlot`s.
 * That is the same "a dimension write is not checked for COHERENCE" known
 * problem `STATUS.md` already carries (a raw `setSlot` on a table's dimension
 * is generally unguarded against the cells that actually exist), reached
 * through the same door as before, not a new one.
 */
function findInvalidTableResizes(operations: readonly Operation[], objects: readonly GraphObject[]): readonly string[] {
  const problems: string[] = [];
  const tracked = new Map<string, TrackedTableState>();

  const resolveTrackedTableState = (objectId: string): TrackedTableState | undefined => {
    const existing = tracked.get(objectId);
    if (existing !== undefined) {
      return existing;
    }
    // Seed from pre-batch `objects`, or — closing D-050's other half — from
    // an earlier `createObject` operation in this SAME batch naming this id
    // (D-021's own existence check, which runs before this function, already
    // guarantees any `insertTableLine` reaching here targets an id that
    // exists by its position in the batch — either already in `objects`, or
    // validly `createObject`d earlier).
    const fromObjects = objects.find((candidate) => candidate.id === objectId);
    const fromCreate = fromObjects === undefined
      ? operations.find((candidate): candidate is CreateObjectOperation => candidate.kind === "createObject" && candidate.object.id === objectId)?.object
      : undefined;
    const source = fromObjects ?? fromCreate;
    if (source === undefined) {
      return undefined; // Genuinely does not exist anywhere in the batch — D-021 rejects this separately.
    }
    const { rows, cols } = getTableDimensions(source);
    const state: TrackedTableState = {
      name: source.name,
      isTable: source.type === "table",
      rowsResizable: isTableDimensionResizable(source, "row"),
      colsResizable: isTableDimensionResizable(source, "column"),
      rows,
      cols,
    };
    tracked.set(objectId, state);
    return state;
  };

  operations.forEach((operation, index) => {
    if (operation.kind !== "insertTableLine" && operation.kind !== "deleteTableLine") {
      return;
    }
    const isInsert = operation.kind === "insertTableLine";
    const verb = isInsert ? "insertion" : "deletion";
    const prefix = `operation ${index + 1} of ${operations.length}`;
    const state = resolveTrackedTableState(operation.objectId);
    if (state === undefined) {
      return; // D-021's existence check rejects the whole batch for this operation separately.
    }
    if (!state.isTable) {
      problems.push(`${prefix}: object "${state.name}" is not a table, so its ${operation.axis}s cannot be resized`);
      return;
    }
    // D-053: the WHOLE extent must be readable, not just the axis this
    // operation targets — both primitives re-assert `literal` on BOTH
    // dimensions on every call (the untouched axis's count still has to be
    // written back), so checking only `operation.axis`'s flag let a resize on
    // one axis silently destroy a `formula`-kind slot on the OTHER axis (its
    // AST, cached value, and inbound edge), reached from the axis nobody was
    // looking at. Name every offending dimension, not just one.
    const badDimensions: string[] = [];
    if (!state.rowsResizable) badDimensions.push("rows");
    if (!state.colsResizable) badDimensions.push("cols");
    if (badDimensions.length > 0) {
      const verbAgreement = badDimensions.length > 1 ? "slots are" : "slot is";
      problems.push(
        `${prefix}: "${state.name}"'s ${badDimensions.join(" and ")} ${verbAgreement} not "literal" (D-046) — ` +
          "its extent cannot be coherently resized on any axis",
      );
      return;
    }
    const bound = operation.axis === "row" ? state.rows : state.cols;
    // Insertion's new line may occupy any position 1..count+1 (including
    // "after the last line"); deletion's index must name an EXISTING line,
    // 1..count — there is nothing to delete at count+1, and a bound of 0
    // correctly makes every index invalid (D-050's own reasoning: this
    // simulation is what makes "existing" mean "as of THIS operation's own
    // position in the batch," not merely at the batch's start).
    const maxValidIndex = isInsert ? bound + 1 : bound;
    if (!Number.isInteger(operation.index) || operation.index < 1 || operation.index > maxValidIndex) {
      problems.push(
        `${prefix}: ${operation.axis} ${verb} index ${operation.index} is out of range for "${state.name}" ` +
          `(currently ${bound} ${operation.axis}s; must be an integer from 1 to ${maxValidIndex})`,
      );
      return;
    }
    // Accepted — the next operation in this batch targeting the same table
    // (if any) must see this table's extent as already one line bigger or
    // smaller (D-050, widened to cover both directions entry 0050).
    const delta = isInsert ? 1 : -1;
    if (operation.axis === "row") {
      state.rows += delta;
    } else {
      state.cols += delta;
    }
  });

  return problems;
}

/**
 * Renders a value that `hasIllegalNumber` has already flagged, for check 4's
 * (and `findIllegalOperationPayloads`'s own) message. Reviewer edit at
 * 0025-REVIEW-phase0: the message interpolated the value directly, so every
 * non-finite number nested inside a `Point`/`Point[]` printed as `[object
 * Object]` — a rejection that cannot say what it rejected, the same defect
 * D-023 fixed for the D-021 message and the same §5.1 step 6 requirement ("a
 * human-readable failure") behind it. `JSON.stringify` is NOT usable here for
 * exactly the reason this check exists: it renders every one of `NaN`/
 * `Infinity`/`-Infinity` as `null`, AND renders `-0` as `"0"` — indistinguishable
 * from legal `0` (Q-008's own defect), so `formatIllegalNumber` below handles
 * the sign explicitly rather than delegating to `String`.
 *
 * Only ever called on a value `hasIllegalNumber` returned `true` for, so the
 * remaining arms of `Value` (string, boolean, null, ErrorValue) are unreachable
 * — `String(value)` is the honest fallback rather than a thrown error, since
 * nothing in this file throws.
 */
function describeIllegalValue(value: Value): string {
  if (typeof value === "number") {
    return formatIllegalNumber(value);
  }
  if (Array.isArray(value)) {
    return `[${(value as readonly Point[]).map(describePoint).join(", ")}]`;
  }
  if (typeof value === "object" && value !== null && "x" in value && "y" in value) {
    return describePoint(value as Point);
  }
  return String(value);
}

function describePoint(point: Point): string {
  return `{ x: ${formatIllegalNumber(point.x)}, y: ${formatIllegalNumber(point.y)} }`;
}

/**
 * `String(-0)` is `"0"` — indistinguishable from legal `0` in a rejection
 * message that exists specifically to say what was found (Q-008). Every
 * other number this function is ever called on (`NaN`/`Infinity`/`-Infinity`,
 * or any ordinary finite number appearing beside an illegal one inside a
 * `Point`) prints exactly as `String` already renders it.
 */
function formatIllegalNumber(n: number): string {
  return Object.is(n, -0) ? "-0" : String(n);
}
