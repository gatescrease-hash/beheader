# STATUS — as of entry 0023-answer-q006

STATE: GREEN (compiles under both configs, 169/169 tests pass, 0 skipped, 0 `.only`). No test in
the suite pins known-broken behaviour.

Current phase: 0 — Graph core (headless, no pixels)
Phase 0 acceptance criterion (§6): build a graph in a unit test, bind slots, mutate a value and
watch it propagate in topological order including through derived slots; a cycle is rejected with
the offending slots named and prior state provably unchanged; deleting a slot with dependents is
rejected; a document round-trips to JSON identically. — **partial, 3 of 4 clauses closed.**
Last review point: **0021-REVIEW-phase0, verdict ACCEPT WITH EDITS.** Since then: Q-006 was answered
directly by the human (**D-025**, cycle 0023) — `document.ts` is now fully unblocked.
Cycles since last review: 2/3 · diff since last review: 730 lines / 6 files (cap 800/10)

## Next slice
**`document.ts` + the JSON round-trip** (clause 4) — the last clause, and no longer blocked on
anything. Needs: `formatVersion` from the first commit, object list, the mutation journal, camera
state; derived slot values never serialized (§5.11); `nextObjectId` (D-002) round-tripped, not
recomputed; a placeholder for `DerivedSlot.value` before evaluating on load (D-018 catches a wrong
placeholder loudly); loading applies objects via `mutate`'s BATCH form (D-020) — a zero-object
document is NOT routed through `mutate` at all (an empty batch is rejected, by design); a
NON-FINITE literal or journal payload found while loading is illegal per **D-025** — a loader that
naively passes one to `mutate` gets D-025's own rejection, which is the correct behaviour, not a bug
to route around; `L-10` (`addressKey` assumes D-002 `obj_<n>` ids) wants a note. New file, so §6.1
trigger 2 forces its own review point at the end of that cycle regardless of the cap (which, at
730/800 lines and 2/3 cycles already, is close regardless).

Then Phase 1 — not before all four clauses pass and the gate is reviewed as one unit (§6.1 trigger
1: a phase gate is never batchable).

## Built and reviewed
- Scaffold: `package.json`, both tsconfigs (strict + DOM-free, D-006), Vitest. `node_modules` is
  gitignored — run `npm install` if `npm run typecheck`/`npm test` fail on a missing `tsc`.
- `address.ts` (§5.2, 44 tests) — two-layer name/ID scheme, D-005 surface↔stored mapping keyed on
  the A1 form (D-008), exact `parseAddress`/`formatAddress` inverses, `findObjectById`.
- `graph/node.ts` (§5.1, 20 tests) — `Value`/`Point`/`ErrorValue`/`isErrorValue` (D-014),
  `ObjectType`/`TABLE_TYPE` (D-009/D-011), the three slot kinds, `GraphObject`, `slotKey`/
  `getSlot`/`resolveSlot`. Every field `readonly`.
- `graph/edge.ts` (§5.1, 6 tests) — `Edge`, `addressKey`. **Internal-only, D-015.**
- `formula/ast.ts` — one-variant `FormulaAst`. **`PROVISIONAL(Q-005)`**, approved 0006-REVIEW.
- `primitives/schema.ts` (§5.1, 19 tests) — `derivedSlotDependencyAddresses`, `getObjectSchema`,
  `findDerivedSlotSchema`, `ObjectSchema.nonDerivedSlotPaths`. Real entries for `value`/`add`.
- `graph/cycles.ts` (§5.1 step 5, 11 tests) — `detectCycle(edges)`, from-scratch DFS.
- `graph/eval.ts` (§5.1 step 7, 11 tests) — `evaluate(objects, edges)`, one topological pass over
  an edge set ASSUMED acyclic; all three slot kinds; D-013 enforced mechanically. L-13's stale-edge
  branch pinned at 0019 (0014-REVIEW constraint 8, closed).
- `mutation.ts` (§5.1's full loop, 51 tests) — `deriveEdges` (step 3); `validateIntegrity` (step 4 /
  §5.1.1) running **four** checks in a fixed order: D-017 undeclared slot → D-018 both directions of
  schema↔slot reconciliation → dangling reference → D-025 non-finite value (cycle 0023, last —
  independent of the other three); `deriveValidateAndEvaluate` (steps 3-5 + 7);
  `mutate(objects, operations, journal)` — **batch form** (D-020): rejects an empty batch and any
  operation with an unresolvable target (D-021/D-023) before staging, via a fold-aware existence
  simulation (cycle 0022 — see Gotchas), then ONE real recursive clone (D-019), every operation
  folded over it in order, ONE validation/evaluation pass, ONE journal entry holding the whole list
  (payloads cloned, D-024). **Two operation kinds**: `SetSlotOperation` (rewrites one slot) and
  `DeleteObjectOperation` (cycle 0022 — removes a whole object; §5.1.1's dangling-reference check,
  unchanged, is what rejects one with live dependents).
- `graph/node.ts` also has `hasNonFiniteNumber` (cycle 0023, D-025) beside `Value` (D-014's
  shared-predicate principle) — checked by both `mutation.ts`'s D-025 check and `add`'s own compute.
- `primitives/schema.ts`'s `add` compute maps a non-finite sum to `#TYPE` (D-025, cycle 0023) — the
  ONLY guard against a non-finite `derived` value; `validateIntegrity` runs BEFORE `evaluate` and
  never re-checks its output (see Gotchas — a real overclaim about this was caught and fixed cycle
  0023, before commit).

## Acceptance criterion, clause by clause
1. Topological propagation including derived slots — **PASSING** (`graph/eval.test.ts`'s
   reverse-declared-order fixture, since 0012-REVIEW).
2. Cycle rejected, offending slots named, prior state provably unchanged — **PASSING** (0017,
   accepted 0018-REVIEW). Through the real `mutate` entry point, deep-compared against a pre-call
   snapshot, mutation-tested twice.
3. Deleting a slot with dependents is rejected — **PASSING** (0022). `DeleteObjectOperation` +
   `validateIntegrity`'s pre-existing dangling-reference check (no new mechanism), through the real
   `mutate` entry point, prior state deep-compared, mutation-tested.
4. Document round-trips to JSON identically — **NOT YET**, `document.ts` not started. No longer
   blocked on anything (Q-006 answered → D-025, cycle 0023) — see *Next slice* above.

## Known problems
- **L-16** — nothing enforces `nonDerivedSlotPaths`/`derivedSlots` paths are disjoint on one type.
  Fix: one registry-wide `slotKey`-compared test (D-010), same shape as L-8's. Open.
- **L-17 / L-18** — `deriveEdges` shares path-array references with the registry (harmless) and
  does not deduplicate (both consumers tolerate it). Unchanged.
- **L-14** — `eval.ts`'s two `ErrorValue` messages name no slot. A real gap for whoever renders
  error badges (§5.9), unfixable there.
- **Two functions can reject a mutation** — `validateIntegrity` (about the graph) and `mutate`
  itself (about an operation's preconditions). Correct, but a reader will look in only one; the
  file header says so. Noted, not a defect.
- **L-6 – L-15, carried** — cosmetics, written up where found (0006/0008/0010/0012-REVIEW §4).
  Fold in when nearby: **L-8** (into L-16's test), **L-10** (see *Next slice*, `document.ts`).
- **`detectCycle`'s reported cycle can start at any member** — correct either way.
- **Recursion depth** — `detectCycle`/`evaluate` recurse once per slot on the longest chain; so
  does `deepClone`, one frame per nesting level (at most ~2 for any `Value` today). Fine at brief
  scale; watch it once `document.ts` can load an arbitrarily long chain.
- Table/`cells` mapping in `address.ts` still hardcoded; `nonDerivedSlotPaths` cannot express a
  slot family. Both wait on `schema.ts` expressing families (D-005 §4, D-009). **Do not extend
  `nonDerivedSlotPaths` to tables** (D-017's forward note).
- **SETTLED, do not re-raise:** flat `claude/` layout (0002-REVIEW); shared vocabulary out of
  `graph/node.ts` (0006-REVIEW §6); unifying `isErrorValue`/`isAddressError` (D-014); inverting a
  `slots` key to recover a KNOWN slot's path — never `key.split(".")`; `describeUndeclaredSlot`'s
  raw-key naming (D-022); collapsing §5.1.1's two clauses into one `resolveSlot` check
  (0018-REVIEW); one-directional schema↔slot reconciliation (D-018, closed 0019); the JSON-based
  clone (D-019, closed 0019); a nonexistent-object operation as a no-op (D-021, closed 0019);
  single-operation `mutate` (D-020, closed 0020); suppressing an unresolvable object's id from a
  failure message (D-023, closed 0021-REVIEW); a payload/journal entering committed state by
  reference (D-024, closed 0021-REVIEW); checking a batch's operation targets ONLY against the
  pre-batch `objects` (closed 0022 — see Gotchas, fold-aware existence simulation); no operation
  that can close Phase 0 acceptance clause 3 (closed 0022, `DeleteObjectOperation`); Q-006 unanswered
  (closed 0023, D-025 — non-finite numbers are illegal document state).

## Live PROVISIONAL tags and open questions
**`PROVISIONAL(Q-005)`** → `formula/ast.ts`, `graph/eval.ts`, `mutation.ts` (both AST-reading
sites). Approved 0006-REVIEW, not a live risk.
**No open question currently blocks anything.** **Q-006** ANSWERED → **D-025** (ruled by the human
directly, cycle 0023: non-finite numbers are illegal document state, governing both the object list
and the serialized journal). **Q-001/Q-002** (Phase 3), **Q-004** (Phase 2) deferred; **Q-003**
ANSWERED → D-007. Next free: **Q-007**.

## Gotchas for the next model
- **Non-finite numbers (`NaN`/`±Infinity`) are illegal document state** (D-025, cycle 0023,
  ruled by the human directly — Q-006 answered). `validateIntegrity`'s 4th check rejects a
  non-finite LITERAL (freshly written or already sitting in `objects`); `add`'s own compute maps a
  non-finite SUM to `#TYPE` itself. **These are NOT redundant with each other** —
  `validateIntegrity` runs BEFORE `evaluate` and never re-checks what `evaluate` just produced, so a
  compute function's own guard is the ONLY protection for a freshly-computed non-finite `derived`
  value. Any FUTURE compute function that does arithmetic must map overflow to `#TYPE` itself; do
  not assume `validateIntegrity` is a backstop for it (a real doc-comment overclaim to this effect
  was caught and fixed at cycle 0023, before commit — see that entry's Decisions).
- **A batch's target-existence check is a `Set<id>` SIMULATION of the fold, not a static pre-check
  against the original `objects`** (cycle 0022, fixing 0021-REVIEW's carried constraint 1) —
  `DeleteObjectOperation` can shrink the object set mid-batch, so checking once up front against
  the pre-batch snapshot would miss a LATER operation targeting an object an EARLIER one in the
  SAME batch just deleted. The check walks operations in order over one `Set<id>` seeded from
  `objects`, removing an id the moment a valid `deleteObject` for it is seen — still gathering
  EVERY offending operation in one pass, not just the first. **The next operation kind that can ADD
  an object (object creation, for `document.ts`'s loader) must ADD to this same `Set`, not build a
  second mechanism.**
- **Deleting an object needed NO new rejection check.** `validateIntegrity`'s existing dangling-
  reference check already rejects it when something else still depends on the deleted object's
  slots — the same check that already catches a typo'd formula reference. Phase 0 acceptance
  clause 3 closed by giving `mutate` an operation that can produce that shape, not by adding a check.
- **Mutation-testing proves a mechanism is load-bearing, not that it is correct.** Ask both: would
  removing it break a named test, *and* does it do its job for every input its types admit? D-019
  (a lossy clone) and D-024 (an un-cloned payload) both passed the first question and failed the
  second.
- **A plausible claim written as a proof is this project's recurring defect** — in a doc comment
  (0018-REVIEW finding 1), in a test's own comment (caught by 0020 before commit), and in a
  ruling's edge case (D-023). If a comment says "X never needs checking because Y", test Y.
- **Following a ruling past the edge of its rationale is its own failure mode** (D-023): D-015
  governs naming a slot that *exists*; it does not require suppressing an id when the rejection is
  precisely that nothing resolves.
- **`mutate(objects, operations, journal)` takes a BATCH** — `readonly Operation[]`. One clone, one
  validation/evaluation pass, one journal entry. It rejects an empty batch and any unresolvable
  target *before* staging (fold-aware since 0022 — see above). Call it; don't hand-chain
  `cloneObjects`/`applyOperation`/`deriveValidateAndEvaluate`.
- **The clone is load-bearing AND faithful** — never `JSON.parse(JSON.stringify(...))` for graph
  state (D-019), and never `structuredClone` (D-006: DOM-lib global, excluded).
- **`validateIntegrity` runs THREE checks in a fixed order**: D-017 → D-018 → dangling reference,
  all before `detectCycle`/`evaluate` see the graph.
- **A fixture that LOOKS like it tests "order matters" may not** (0016's lesson): a missing edge can
  only cause a false NEGATIVE in `detectCycle`, never a false positive. Likewise a batch fixture
  whose operations all target the same address cannot distinguish a shared clone from N independent
  ones (0020's lesson).
- **Cyclic input to `evaluate` fails SILENTLY** — step 5 before step 7 is load-bearing; do not add a
  defensive cycle check inside `eval.ts`.
- **`GraphObject`, not `Object`** — naming-collision workaround; the prose word is still "object."
- **`address.ts` ↔ `graph/node.ts` share TYPES only** (`import type`) — a value import creates a
  real runtime cycle.
- **`Value`/`Point`/`ErrorValue`/`isErrorValue` live in `graph/node.ts`** — never redefine (D-014).
- **Slot keys only from `slotKey()`** (D-010); **document-wide keys only from `addressKey()`**
  (D-015), both internal. User-facing slot names come from `formatAddress` — exceptions: D-022
  (undeclared slot), D-023 (unresolvable object id).
- **`ObjectType` includes `value`/`add`** (D-011); **`explode` sets type to `polyline`** (D-012).
- **The schema registry stores FUNCTIONS and that is correct** (0008-REVIEW §2). Don't "fix" it.
- **`derivedSlotDependencyAddresses` runs at edge-derivation time only** (Rule 6).
- Each PowerShell call is a fresh process; the Bash tool's `npm` is not on PATH — use PowerShell.
