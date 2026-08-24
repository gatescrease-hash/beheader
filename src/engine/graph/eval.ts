/**
 * eval.ts — Naive full topological evaluation over an already-acyclic edge set.
 *
 * IMPLEMENTS: PROJECT_BRIEF §5.1, mutation-loop step 7 ("Evaluate. Topologically
 * sort all slots and evaluate every one: literals return their stored value,
 * formulas evaluate their AST, derived slots call their schema compute
 * function. Evaluation errors produce ErrorValues; they do not roll back the
 * mutation.") and Rule 5's naive-evaluation directive ("re-evaluate the entire
 * graph in topological order. Do not implement real dirty-flag tracking yet.").
 * As of THIS cycle (the range-evaluation wiring slice STATUS.md named next),
 * also implements the LAST piece of that same step 7 clause — "formulas
 * evaluate their AST" now means EVERY `FormulaAst` shape §5.3 admits, not only
 * a bare reference — by wiring in `formula/eval.ts`'s real evaluator (D-036
 * constraint 1/3: the old `ReferenceNode`-only bridge is deleted, not
 * extended). Load-bearing per Rule 3 (§6 trigger-2 file: graph/*).
 * LAYER: engine (pure). May import: engine/* only.
 *        NEVER imports: DOM, window, document, canvas, render/*.
 *
 * WHAT THIS IS
 *   Given a document's full object list and an edge set already derived from
 *   every stored formula AST and schema declaration (mutation.ts step 3),
 *   evaluate EVERY slot on EVERY object exactly once, in an order that
 *   respects every edge, and return a NEW object list holding the results.
 *
 *   - `literal` slots keep their stored value unchanged — nothing computes a
 *     literal; it IS the source of truth (§5.1's table).
 *   - `formula` slots evaluate their AST via `formula/eval.ts`'s real
 *     `evaluate` (`evaluateFormula` below) — every shape §5.3's grammar
 *     admits, a binding (a bare reference) included, since a binding is
 *     "just the degenerate formula `= other.slot`" (§5.1) under the same
 *     general evaluator. `evaluateFormula`'s own doc comment covers the two
 *     callbacks it builds and hands through: `read` for plain references,
 *     `readRange` for a range reached inside an aggregate call (D-036,
 *     bounded by the table's current extent, D-044).
 *   - `derived` slots call their schema's compute function
 *     (primitives/schema.ts), exactly once, INSIDE this same topological pass
 *     — never in a separate post-pass (§5.1, PROCESS_BRIEF §9).
 *
 *   Topological order is a DFS postorder reversal — the standard construction
 *   for a DAG, and the same traversal FAMILY `graph/cycles.ts` uses (same
 *   direction, sourceSlot -> dependentSlot), but simpler: this file assumes
 *   its input is already acyclic (mutation.ts step 5 runs `detectCycle` before
 *   step 7 calls this), so there is no gray/white/black bookkeeping to detect
 *   a back-edge here — only visited/unvisited.
 *
 * INVARIANTS UPHELD HERE
 *   - Rule 6: the slot SET is never touched. The universe of slots evaluated
 *     is read once, up front, from `objects` — every returned object has
 *     EXACTLY the same slot keys as its input; only a slot's `value` (or, for
 *     `formula`, its cached last-evaluated `value`) changes.
 *   - Derived slots are evaluated INSIDE the topological pass, interleaved
 *     with literal and formula slots in one single order — there is no
 *     separate recompute() call anywhere in this file (PROCESS_BRIEF §9's
 *     forbidden move, and the single most important thing this file must get
 *     right).
 *   - D-013: a derived slot's compute function may read ONLY the addresses
 *     that count as ITS OWN declared dependencies. Enforced mechanically, not
 *     by convention: the `read` callback passed to `compute` is built, per
 *     derived slot, from the subset of `edges` whose `dependentSlot` is that
 *     slot's own address — the very edges mutation.ts already derived via
 *     `derivedSlotDependencyAddresses` at edge-derivation time. This file
 *     never calls that function itself (Rule 6 / primitives/schema.ts's own
 *     header: dynamic dependency resolution happens at edge-derivation time
 *     only, never during evaluation). Reading anything outside that subset
 *     returns a `#REF` ErrorValue, not the real value.
 *   - Never throws. A dangling formula reference, a derived slot with no
 *     matching schema entry, or a compute function's own reported error all
 *     become an `ErrorValue` in the result — never a rejected mutation and
 *     never an unwound exception (§5.1).
 *   - Assumes ACYCLIC input and does not re-check. `mutation.ts` runs
 *     `detectCycle` before ever calling this (step 5 before step 7); adding a
 *     defensive cycle check here would duplicate that work for no reason.
 *     Note how this fails if step 5 is ever skipped, because it is NOT the
 *     loud failure it looks like: `visit` marks a node visited BEFORE it
 *     recurses, so a back-edge returns immediately rather than looping. The
 *     pass therefore COMPLETES on cyclic input and simply emits an order that
 *     violates some edge — the slots in the cycle read values that are not
 *     there yet and quietly become `#REF` (verified by probe at
 *     0012-REVIEW-phase0). That is the same "flaky reactivity" class of bug
 *     D-013 and PROCESS_BRIEF §9 exist to prevent, and it is why step 5 is
 *     load-bearing here rather than merely conventional.
 *
 * NOT DONE HERE
 *   - Deriving the Edge[] (mutation.ts step 3) or detecting cycles
 *     (graph/cycles.ts, already built) — both must already have happened
 *     before this file's `evaluate` is called.
 *   - Any formula-language logic itself (parsing, dependency extraction,
 *     lazy/short-circuit dispatch, arithmetic) — all `formula/eval.ts`'s job
 *     (Rule 4: one evaluator). This file's `evaluateFormula` only builds the
 *     two callbacks that file needs and hands them through.
 *   - Bounding a range by the table's current extent, or reading a table's
 *     dimension slots at all — `primitives/table.ts`'s
 *     `enumerateRangeCellAddresses` (D-044/D-046) is the ONE place that
 *     happens; this file only calls it and resolves the addresses it returns
 *     against this pass's own `evaluatedValues`.
 *   - Cloning/committing/journaling (mutation.ts) — this file only evaluates;
 *     it does not decide what becomes the document's new current state.
 */
import type { Address } from "../address.ts";
import type { FormulaAst } from "../formula/ast.ts";
import { evaluate as evaluateFormulaAst, type ReadRange, type ReadSlot } from "../formula/eval.ts";
import { enumerateRangeCellAddresses, isRangeEnumerationError } from "../primitives/table.ts";
import { getObjectSchema, type DerivedSlotSchema } from "../primitives/schema.ts";
import { addressKey, type Edge } from "./edge.ts";
import { slotKey, type GraphObject, type Slot, type Value } from "./node.ts";

/**
 * Evaluates every slot on every object in `objects`, in an order that respects
 * every edge in `edges`, and returns a NEW object list with each slot's value
 * (or, for `derived` slots, its only value) updated to this pass's result.
 *
 * Preconditions the CALLER (mutation.ts, not yet built) is responsible for:
 * `edges` is already derived from every current formula AST and schema
 * declaration (§5.1 step 3), and `edges` is already known to be acyclic
 * (§5.1 step 5). This function does not re-derive edges and does not
 * re-check for cycles — see the file header's "Assumes ACYCLIC input" note.
 *
 * Never throws (§5.1). Rule 6 is upheld by construction: the returned objects
 * have the exact same slot keys as their inputs — see `nextSlot` below.
 */
export function evaluate(objects: readonly GraphObject[], edges: readonly Edge[]): readonly GraphObject[] {
  // Every slot on every object is a node this pass must evaluate — Rule 6
  // means this is exactly the universe, regardless of whether a given slot
  // happens to appear in any edge (an isolated literal still needs a result).
  // Keyed to match `addressKey`'s format exactly: GraphObject.slots is keyed
  // by `slotKey(path)` (node.ts), and `addressKey` is
  // `${objectId}::${slotKey(path)}` — so `${object.id}::${key}` IS that same
  // string, with no need to reconstruct a path array from `key` to prove it.
  const nodesByKey = new Map<string, { readonly object: GraphObject; readonly key: string }>();
  for (const object of objects) {
    for (const key of Object.keys(object.slots)) {
      nodesByKey.set(`${object.id}::${key}`, { object, key });
    }
  }

  // Adjacency, built fresh from `edges` on every call (Rule 5) — mirrors
  // graph/cycles.ts's own from-scratch-every-call discipline.
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    const sourceKey = addressKey(edge.sourceSlot);
    const arcs = outgoing.get(sourceKey);
    if (arcs === undefined) {
      outgoing.set(sourceKey, [addressKey(edge.dependentSlot)]);
    } else {
      arcs.push(addressKey(edge.dependentSlot));
    }
  }

  // Topological order via DFS postorder reversal: a node lands in `postorder`
  // only after every node reachable FROM it (its dependents) already has —
  // reversing therefore puts every sourceSlot before every dependentSlot it
  // feeds, which is exactly evaluation order. Assumes acyclic input (see file
  // header): a back-edge does not hang here, it returns early and silently
  // leaves an order that violates that edge — mutation.ts step 5 is what
  // guarantees there is none.
  const visited = new Set<string>();
  const postorder: string[] = [];
  function visit(nodeKey: string): void {
    if (visited.has(nodeKey)) {
      return;
    }
    visited.add(nodeKey);
    for (const next of outgoing.get(nodeKey) ?? []) {
      visit(next);
    }
    postorder.push(nodeKey);
  }
  for (const nodeKey of nodesByKey.keys()) {
    visit(nodeKey);
  }
  const topologicalOrder = postorder.slice().reverse();

  // Accumulates this pass's results, keyed the same way as `nodesByKey` /
  // `outgoing` above, so a formula's reference or a derived slot's `read`
  // resolves an upstream address to the value THIS pass already computed for
  // it — never a stale value from before this call, because there is no
  // state retained between calls (Rule 5: full re-evaluation, every time).
  const evaluatedValues = new Map<string, Value>();

  // Per-object accumulator for the rebuilt `slots` records, created lazily —
  // mirrors graph/cycles.ts's `outgoingArcsFor` create-if-missing idiom.
  const updatedSlotsByObjectId = new Map<string, Record<string, Slot>>();
  function slotsFor(objectId: string): Record<string, Slot> {
    const existing = updatedSlotsByObjectId.get(objectId);
    if (existing !== undefined) {
      return existing;
    }
    const created: Record<string, Slot> = {};
    updatedSlotsByObjectId.set(objectId, created);
    return created;
  }

  for (const nodeKey of topologicalOrder) {
    const node = nodesByKey.get(nodeKey);
    if (node === undefined) {
      // An edge referenced an address with no corresponding slot in this
      // pass's universe (e.g. a stale edge left over from a deleted slot).
      // §5.1.1's dangling-edge invariant is mutation.ts's job to prevent
      // before this function is ever called (step 4); nothing to evaluate.
      continue;
    }
    const { object, key } = node;
    // `key` came from `Object.keys(object.slots)` above, so this lookup
    // cannot actually miss — the `undefined` arm exists only because
    // `noUncheckedIndexedAccess` types every index access this way.
    const slot = object.slots[key];
    if (slot === undefined) {
      continue;
    }

    const value = evaluateSlot(object, key, slot, objects, edges, evaluatedValues);
    evaluatedValues.set(nodeKey, value);
    slotsFor(object.id)[key] = nextSlot(slot, value);
  }

  return objects.map((object) => ({
    ...object,
    slots: { ...object.slots, ...slotsFor(object.id) },
  }));
}

/**
 * Produces the slot value this pass records, given a slot's KIND (never
 * throws; exhaustive over the three kinds §5.1 defines).
 */
function evaluateSlot(
  object: GraphObject,
  key: string,
  slot: Slot,
  objects: readonly GraphObject[],
  edges: readonly Edge[],
  evaluatedValues: ReadonlyMap<string, Value>,
): Value {
  switch (slot.kind) {
    case "literal":
      return slot.value;
    case "formula":
      return evaluateFormula(slot.ast, objects, evaluatedValues);
    case "derived":
      return evaluateDerivedSlot(object, key, edges, evaluatedValues);
  }
}

/**
 * Rebuilds a slot with this pass's newly computed `value`, preserving every
 * OTHER field the slot's kind carries (a `formula` slot's `ast`; a `literal`
 * slot has nothing else to preserve and is returned unchanged). This is what
 * keeps Rule 6 true structurally: the returned `Slot` is always the SAME kind,
 * at the SAME key, as the one passed in — nothing here can add or remove a
 * slot, only update the value already stored under an existing key.
 */
function nextSlot(slot: Slot, value: Value): Slot {
  switch (slot.kind) {
    case "literal":
      return slot; // Literals never recompute (§5.1's table) — same reference.
    case "formula":
      return { kind: "formula", ast: slot.ast, value };
    case "derived":
      return { kind: "derived", value };
  }
}

/**
 * Evaluates a `formula`-kind slot's stored AST for real, THIS cycle's range-
 * evaluation wiring — `FormulaAst` is the full §5.3 union (Q-005, cycle 0028)
 * and `formula/eval.ts`'s `evaluate` now handles every shape it admits, so
 * the old narrow `ReferenceNode`-only bridge (D-036 constraint 3: "delete,
 * never extend") is gone. Builds the two callbacks `formula/eval.ts` needs
 * and hands them straight through — this file has no evaluation logic of its
 * own beyond building those closures, matching Rule 4 (one evaluator).
 *
 * `read` resolves a plain reference from THIS SAME pass's `evaluatedValues` —
 * guaranteed already evaluated, because whatever derived `edges`
 * (mutation.ts step 3) must have produced a sourceSlot=referenced/
 * dependentSlot=this-formula-slot edge for the topological order above to
 * have placed the reference first. `undefined` (never evaluated in this
 * pass — a dangling reference, or edges that do not actually encode the
 * dependency) is `formula/eval.ts`'s own job to turn into `#REF`, not this
 * function's.
 *
 * `readRange` resolves a range's two endpoints to the ordered list of Values
 * every cell WITHIN THE TABLE'S CURRENT EXTENT currently holds (D-044),
 * bounded by the SAME `enumerateRangeCellAddresses` (`primitives/table.ts`,
 * D-046's `literal`-only dimension guard) that `mutation.ts`'s `deriveEdges`
 * already used to decide this formula's edges — calling that SAME function
 * here, rather than re-deriving the bound independently, is what makes
 * evaluation and edge derivation structurally unable to disagree about which
 * cells a range spans (the exact D-017-shaped hazard a second, parallel
 * bounding computation would risk). `objects` (this pass's full, PRE-
 * evaluation object list) is what lets this file resolve "which object does
 * the range's table id name" — `formula/eval.ts` is deliberately never given
 * that access itself (see its own file header).
 */
function evaluateFormula(ast: FormulaAst, objects: readonly GraphObject[], evaluatedValues: ReadonlyMap<string, Value>): Value {
  const read: ReadSlot = (address) => evaluatedValues.get(addressKey(address));
  const readRange: ReadRange = (start, end) => {
    const tableObject = objects.find((candidate) => candidate.id === start.objectId);
    if (tableObject === undefined) {
      return { error: "#REF", message: "a range references an object that does not exist" };
    }
    const cellAddresses = enumerateRangeCellAddresses(start, end, tableObject);
    if (isRangeEnumerationError(cellAddresses)) {
      return cellAddresses; // Already an ErrorValue-shaped { error: "#REF", message }.
    }
    const values: Value[] = [];
    for (const cellAddress of cellAddresses) {
      const value = evaluatedValues.get(addressKey(cellAddress));
      if (value === undefined) {
        return { error: "#REF", message: "a cell within this range did not resolve to a value" };
      }
      values.push(value);
    }
    return values;
  };
  return evaluateFormulaAst(ast, read, readRange);
}

/**
 * Calls a derived slot's schema compute function (primitives/schema.ts),
 * building a `read` callback that enforces D-013.
 *
 * Why: `compute` may read ONLY the addresses `edges` already declares as
 * dependencies of THIS slot — every edge whose `dependentSlot` is this
 * derived slot's own address. That set is exactly what mutation.ts already
 * built via `derivedSlotDependencyAddresses` at edge-derivation time; this
 * function never calls that resolver itself (Rule 6 / primitives/schema.ts's
 * own header: dynamic dependency resolution happens at edge-derivation time
 * only, never during evaluation). Reading anything outside that subset
 * returns `#REF`, not the real value, so a schema entry that reads an
 * undeclared address fails LOUDLY as graph state rather than silently
 * returning a stale or wrong result (D-013's rationale: an out-of-band read
 * consumes whichever pass's value happens to be sitting there, which is
 * exactly the "flaky reactivity" a recompute() pass would also cause).
 *
 * Rejects (never throws): a derived-kind slot whose (type, key) has no
 * matching schema entry gets `#REF` — this should not happen for a
 * document mutation.ts actually built, but this function does not trust
 * that and fails closed rather than indexing into `undefined`.
 */
function evaluateDerivedSlot(
  object: GraphObject,
  key: string,
  edges: readonly Edge[],
  evaluatedValues: ReadonlyMap<string, Value>,
): Value {
  const schemaEntry = findDerivedSlotSchemaByKey(getObjectSchema(object.type)?.derivedSlots, key);
  if (schemaEntry === undefined) {
    return {
      error: "#REF",
      message: `no schema entry declares a derived slot "${key}" on type "${object.type}"`,
    };
  }

  const ownKey = addressKey({ objectId: object.id, path: schemaEntry.path });
  const declaredDependencyKeys = new Set(
    edges.filter((edge) => addressKey(edge.dependentSlot) === ownKey).map((edge) => addressKey(edge.sourceSlot)),
  );

  const read = (address: Address): Value | undefined => {
    const key = addressKey(address);
    if (!declaredDependencyKeys.has(key)) {
      // D-013 violation: this address was never declared as a dependency of
      // this derived slot, so the edge set never ordered it before this slot
      // and it may not even be evaluated yet. Fail closed rather than return
      // whatever value happens to already be sitting in the map.
      return {
        error: "#REF",
        message: "derived slot's compute function read an address outside its declared dependencies (D-013)",
      };
    }
    return evaluatedValues.get(key);
  };

  return schemaEntry.compute(object, read);
}

/**
 * Finds the derived-slot schema entry stored under `key` — a map key
 * (`slotKey(path)`), not a path array. Compares by re-deriving each
 * candidate entry's OWN key from its declared `path` (D-010: a key is only
 * ever produced by `slotKey()`), rather than decomposing `key` back into a
 * path array — there is no sanctioned inverse of `slotKey`, and this
 * function does not need one to answer "does this key match this entry."
 */
function findDerivedSlotSchemaByKey(
  derivedSlots: readonly DerivedSlotSchema[] | undefined,
  key: string,
): DerivedSlotSchema | undefined {
  return derivedSlots?.find((entry) => slotKey(entry.path) === key);
}
