# STATUS — as of entry 0019-close-d018-d019-d021

STATE: GREEN (compiles under both configs, 143/143 tests pass, 0 skipped, 0 `.only`). No test in
the suite pins known-broken behaviour right now — the three that did (D-018 ×2, D-019) were
replaced by rejection/fidelity tests this cycle.

Current phase: 0 — Graph core (headless, no pixels)
Phase 0 acceptance criterion (§6): build a graph in a unit test, bind slots, mutate a value and
watch it propagate in topological order including through derived slots; a cycle is rejected with
the offending slots named and prior state provably unchanged; deleting a slot with dependents is
rejected; a document round-trips to JSON identically. — **partial, 2 of 4 clauses closed.**
Last review point: **0018-REVIEW-phase0, verdict REVISE** — fixes 1-4 closed at entry 0019 (this
one); fix 5 (D-020, batch form) is the one item still open from that review.
Cycles since last review: 1/3 · diff since last review: ~559 lines / 3 files (cap 800/10)

## Do this next
1. **D-020** — widen `mutate` to the batch form (list of operations, one clone, one validation,
   one evaluation, **one** journal entry). Its own slice, per 0018-REVIEW-phase0's fix 5. Must land
   before `document.ts` begins (D-018 and D-020 both name it as a precondition).
2. A delete-with-dependents `Operation` variant → Phase 0 clause 3 (`validateIntegrity`'s dangling
   check is already the mechanism; it needs an operation that can actually delete a slot).
3. `document.ts` + round-trip, `nextObjectId` (D-002) → clause 4. New file, so §6.1 trigger 2
   forces its own review point regardless of the batch cap. Answer **Q-006** (is a non-finite
   number legal document state) before writing the round-trip test — D-019 binds the clone to be
   faithful either way, but the round-trip test itself needs Q-006 settled first.

Then Phase 1 — not before Phase 0's criterion passes in full and the gate is reviewed as one unit.

## Built and reviewed
- Scaffold: `package.json`, both tsconfigs (strict + DOM-free, D-006), Vitest. `node_modules` is
  gitignored — run `npm install` if `npm run typecheck`/`npm test` fail on a missing `tsc`.
- `address.ts` (§5.2, 44 tests) — two-layer name/ID scheme, D-005 surface↔stored mapping keyed on
  the A1 form (D-008), exact `parseAddress`/`formatAddress` inverses.
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
  branch pinned directly at cycle 0019 (0014-REVIEW-phase0 constraint 8, closed).
- `mutation.ts` — `deriveEdges` (step 3, 0013/0014-REVIEW); `validateIntegrity` (step 4 / §5.1.1,
  THREE checks: D-017 part 2 [0015], D-018 both directions [0019], dangling-reference [0015]);
  `deriveValidateAndEvaluate` (steps 3-5 + 7 composed, 0016); `mutate(objects, operation, journal)`
  with `cloneObjects` (real recursive clone, D-019, 0019)/`applyOperation`/`Operation`/
  `MutationJournalEntry` (steps 1, 2, 6, 8, 0017; D-021 target-existence rejection added 0019).
  **0018-REVIEW-phase0's fixes 1-4 all closed at 0019** (this entry) — mutation-tested, see its log.
  Fix 5 (D-020, batch form) is the one thing left from that review before this file's surface is
  fully settled for `document.ts`.

## Not started, in order
(1) D-020 (batch form) — see "Do this next" #1. (2) A delete-with-dependents `Operation` variant →
clause 3. (3) `document.ts` + round-trip, `nextObjectId` (D-002) → clause 4; new file, so §6.1
trigger 2 forces its own review point regardless. Then Phase 1 — not before Phase 0's criterion
passes in full and the gate is reviewed as one unit.

## Acceptance criterion, clause by clause
1. Topological propagation including derived slots — **PASSING** (`graph/eval.test.ts`'s
   reverse-declared-order fixture, since 0012-REVIEW-phase0).
2. Cycle rejected, offending slots named, prior state provably unchanged — **PASSING**, closed at
   0017 and accepted at 0018-REVIEW-phase0. Demonstrated through the real `mutate` entry point, with
   a deep-compare against a pre-call snapshot, mutation-tested twice.
3. Deleting a slot with dependents is rejected — **NOT YET**, no delete operation exists.
4. Document round-trips to JSON identically — **NOT YET**, `document.ts` not started; blocked on
   D-020 (batch form) and **Q-006** (non-finite number legality) both.

## Known problems
- **D-020 (open)** — no batch form yet. Required by §5.1 from day one; deferred four cycles running
  (0016, 0017, and now 0019 — this cycle deliberately did fixes 1-4 first, per the review's own
  ordering). Must land before `document.ts`.
- **L-16** — nothing enforces `nonDerivedSlotPaths`/`derivedSlots` paths are disjoint on one type.
  Fix: one registry-wide `slotKey`-compared test (D-010), same shape as L-8's. Open.
- **L-17 / L-18** — `deriveEdges` shares path-array references with the registry (harmless) and
  does not deduplicate (both consumers tolerate it). Unchanged.
- **L-14** — `eval.ts`'s two `ErrorValue` messages name no slot. A real gap for whoever renders
  error badges (§5.9), unfixable there.
- **L-6 – L-15, carried** — cosmetics, written up where found (0006/0008/0010/0012-REVIEW §4).
  Worth folding in when nearby: **L-8** (into L-16's test), **L-10** (`addressKey` assumes D-002
  `obj_<n>` IDs — note it in `document.ts`).
- **`detectCycle`'s reported cycle can start at any member** — correct either way.
- **Recursion depth** — `detectCycle`/`evaluate` recurse once per slot on the longest chain, and now
  so does `mutation.ts`'s `deepClone` (one frame per nesting level of a `Point[]`/`ErrorValue`, in
  practice at most 2 deep for any `Value` today). Fine at brief scale; watch it once `document.ts`
  can load an arbitrarily long chain.
- **`document.ts` forward constraints** — `DerivedSlot.value` is required but never serialized
  (§5.11), so load must place a placeholder before evaluating; D-018 (now closed) is what makes
  that loud instead of silent if a loader gets it wrong. Loading MUST use the batch form (D-020,
  still open). `address.ts`'s `formatAddress` itself states a raw `objectId` in its OWN
  `AddressError` message when the id doesn't resolve — `mutation.ts` deliberately does NOT do this
  in its own messages (D-015; see `findDanglingReferences`'s and `mutate`'s D-021 check's own
  stances) — a disclosed, accepted asymmetry, not a bug to fix in `address.ts`.
- Table/`cells` mapping in `address.ts` still hardcoded; `nonDerivedSlotPaths` cannot express a
  slot family. Both wait on `schema.ts` expressing families (D-005 §4, D-009). **Do not extend
  `nonDerivedSlotPaths` to tables** (D-017's own forward note).
- **SETTLED, do not re-raise:** flat `claude/` layout (0002-REVIEW); shared vocabulary out of
  `graph/node.ts` (0006-REVIEW §6); unifying `isErrorValue`/`isAddressError` (D-014); inverting a
  `GraphObject.slots` key to recover a KNOWN slot's path — never `key.split(".")`;
  `describeUndeclaredSlot`'s raw-key naming (D-022); collapsing §5.1.1's two clauses into one
  `resolveSlot` check (0018-REVIEW-phase0); schema<->slot reconciliation being one-directional
  (D-018, closed 0019); the step-1 clone using JSON (D-019, closed 0019); a nonexistent-object
  operation being a no-op (D-021, closed 0019).

## Live PROVISIONAL tags and open questions
**`PROVISIONAL(Q-005)`** → `formula/ast.ts`, `graph/eval.ts`, `mutation.ts` (both AST-reading
sites). Approved 0006-REVIEW, not a live risk.
**Q-006 — OPEN**: is a non-finite number (`NaN`/`±Infinity`) legal document state? Blocks
`document.ts`'s round-trip test — answer before writing it. D-019 (closed) binds the clone to be
faithful regardless of how this lands. **Q-001/Q-002** (Phase 3), **Q-004** (Phase 2) deferred;
**Q-003** ANSWERED → D-007. Next free: **Q-007**.

## Gotchas for the next model
- **Mutation-testing proves a mechanism is load-bearing, not that it is correct.** 0017 proved the
  clone was necessary with two excellent experiments and still shipped a lossy clone (D-019, now
  fixed). Ask both questions of any new mechanism: would removing it break a test, *and* does it do
  its job for every input its types admit? At 0019, `findSchemaSlotKindMismatches`'s two loops and
  `mutate`'s D-021 check were each mutation-tested individually (not just "the function as a whole")
  to confirm each specific test depends on the specific line it claims to.
- **"X never needs checking because Y" is a claim to test, not to comment.** (0018-REVIEW's own
  lesson, re-confirmed here — no new instance found this cycle.)
- **`mutate` is the one entry point that runs the full §5.1 loop** — call it, don't hand-chain
  `cloneObjects`/`applyOperation`/`deriveValidateAndEvaluate`. It applies ONE operation per call
  until D-020 lands. It now also rejects (D-021) before ever staging, if the target object doesn't
  exist — check that first if you're reasoning about its control flow.
- **The clone (`deepClone`/`cloneObjects`) is load-bearing AND now faithful** — do not "simplify it
  away" on the reasoning that everything downstream is pure, and do not reach for
  `JSON.parse(JSON.stringify(...))` as a shortcut if this file ever needs cloning again elsewhere —
  it silently drops `NaN`/`±Infinity` to `null` (D-019's whole finding).
- **`validateIntegrity` now runs THREE checks, in a fixed order**: D-017 (undeclared slot) → D-018
  (schema-declared slot missing or wrong-kind, both directions) → dangling-reference. All three
  run before `detectCycle`/`evaluate` ever see the graph (`deriveValidateAndEvaluate`).
- **A fixture that LOOKS like it tests "order matters" may not** (0016's lesson): a missing edge
  can only cause a false NEGATIVE in `detectCycle`, never a false positive.
- **`structuredClone` is a DOM-lib global** — excluded by `tsconfig.engine.json` (D-006). The
  recursive clone in `mutation.ts` is written by hand for exactly this reason.
- **Cyclic input to `evaluate` fails SILENTLY** — step 5 before step 7 is load-bearing; do not add
  a defensive cycle check inside `eval.ts`.
- **`GraphObject`, not `Object`** — naming-collision workaround; the prose word is still "object."
- **`address.ts` ↔ `graph/node.ts` share TYPES only** (`import type`) — a value import creates a
  real runtime cycle.
- **`Value`/`Point`/`ErrorValue`/`isErrorValue` live in `graph/node.ts`** — never redefine (D-014).
- **Slot keys only from `slotKey()`** (D-010); **document-wide keys only from `addressKey()`**
  (D-015), both internal. User-facing names come from `formatAddress` — one exception, D-022.
- **`ObjectType` includes `value`/`add`** (D-011); **`explode` sets type to `polyline`** (D-012).
- **The schema registry stores FUNCTIONS and that is correct** (0008-REVIEW §2). Don't "fix" it.
- **`derivedSlotDependencyAddresses` runs at edge-derivation time only** (Rule 6).
- Each PowerShell call is a fresh process; the Bash tool's `npm` is not on PATH — use PowerShell.
