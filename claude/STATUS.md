# STATUS — as of entry 0018-REVIEW-phase0

STATE: GREEN (compiles under both configs, 139/139 tests pass, 0 skipped, 0 `.only`) —
but **3 of those tests deliberately pin BROKEN behaviour** (see *Known problems*). Green is not
clean here.

Current phase: 0 — Graph core (headless, no pixels)
Phase 0 acceptance criterion (§6): build a graph in a unit test, bind slots, mutate a value and
watch it propagate in topological order including through derived slots; a cycle is rejected with
the offending slots named and prior state provably unchanged; deleting a slot with dependents is
rejected; a document round-trips to JSON identically. — **partial, 2 of 4 clauses closed.**
Last review point: **0018-REVIEW-phase0, verdict REVISE** (5 numbered fixes, below).
Cycles since last review: 0/3 · diff since last review: 0 lines / 0 files (cap 800/10)

## Do this next — the REVISE list (0018-REVIEW), in order
1. **D-018 part 1** — `validateIntegrity` rejects an object missing a slot at a schema-declared
   derived path. (Today: accepted, leaving edges that point at a slot that does not exist.)
2. **D-018 part 2** — `validateIntegrity` rejects a slot whose kind disagrees with its schema
   position (non-`derived` at a derived path; `derived` at a `nonDerivedSlotPaths` path). Pin
   `eval.ts`'s L-13 stale-edge branch while here — fix 1's fixture reaches it.
3. **D-019** — replace `cloneObjects`'s JSON round-trip with a real recursive clone; pin fidelity
   over every member of `Value` (`NaN`, `±Infinity`, `null`, `Point`, `Point[]`, `ErrorValue`).
4. **D-021** — `mutate` rejects an operation naming a nonexistent object instead of no-op'ing and
   journalling it. One existing test's expectation changes; D-021 authorises it, say so in the log.
5. **D-020** — widen `mutate` to the batch form (list of operations, one clone, one validation,
   one evaluation, **one** journal entry). Its own slice; end the cycle there.

Fixes 1-4 are inside `mutation.ts`'s reviewed surface and can share a cycle if they fit. Fix 5
changes the only mutation entry point's signature — hand it back after. **`document.ts` does not
start until 1-5 are done** (D-018 and D-020 both name it).

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
- `graph/eval.ts` (§5.1 step 7, 10 tests) — `evaluate(objects, edges)`, one topological pass over
  an edge set ASSUMED acyclic; all three slot kinds; D-013 enforced mechanically.
- `mutation.ts` — `deriveEdges` (step 3, 0013/0014-REVIEW); `validateIntegrity` (step 4 / §5.1.1,
  0015); `deriveValidateAndEvaluate` (steps 3-5 + 7 composed, 0016); `mutate(objects, operation,
  journal)` with `cloneObjects`/`applyOperation`/`Operation`/`MutationJournalEntry` (steps 1, 2,
  6, 8, 0017). **All reviewed at 0018-REVIEW — accepted in shape, REVISE in five specifics.**

## Not started, in order
(1) The REVISE list above. (2) A delete-with-dependents `Operation` variant → clause 3
(`validateIntegrity`'s dangling check is already the mechanism; it needs an operation that can
actually delete a slot). (3) `document.ts` + round-trip, `nextObjectId` (D-002) → clause 4; new
file, so §6.1 trigger 2 forces its own review point regardless. Then Phase 1 — not before Phase 0's
criterion passes in full and the gate is reviewed as one unit.

## Acceptance criterion, clause by clause
1. Topological propagation including derived slots — **PASSING** (`graph/eval.test.ts`'s
   reverse-declared-order fixture, since 0012-REVIEW).
2. Cycle rejected, offending slots named, prior state provably unchanged — **PASSING**, closed at
   0017 and accepted at 0018-REVIEW. Demonstrated through the real `mutate` entry point, with a
   deep-compare against a pre-call snapshot, mutation-tested twice.
3. Deleting a slot with dependents is rejected — **NOT YET**, no delete operation exists.
4. Document round-trips to JSON identically — **NOT YET**, `document.ts` not started. See **Q-006**
   before writing its round-trip test.

## Known problems
- **THE THREE `KNOWN GAPS pinned by 0018-REVIEW` TESTS IN `mutation.test.ts` ASSERT BROKEN
  BEHAVIOUR.** They pass today; that is the point. Each is to be **replaced, not deleted**, by the
  rejection/fidelity test its ruling requires (D-018 ×2, D-019). A green suite does not mean this
  file is correct until they are gone.
- **D-018 (open)** — schema↔slot reconciliation runs one way only. An object missing its declared
  derived slot is accepted with edges pointing at nothing (§5.1.1's absolute invariant); a
  `setSlot` over a derived slot is accepted (§5.1 says `derived` can never be converted).
- **D-019 (open)** — `cloneObjects`'s JSON round-trip turns `NaN`/`±Infinity` into `null`, so an
  accepted mutation can change a slot its operation never named. Rule 2's promise, on the accept
  path.
- **D-020 (open)** — no batch form. Required by §5.1 from day one; deferred three cycles running.
- **D-021 (open)** — an operation naming a nonexistent object is a journalled no-op.
- **L-13** — `eval.ts`'s stale-edge `continue` branch still reached by no test. D-018 fix 1's
  fixture is what reaches it; fold it in (0014-REVIEW constraint 8, open since 0015).
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
- **Recursion depth** — `detectCycle`/`evaluate` recurse once per slot on the longest chain. Fine
  at brief scale; watch it once `document.ts` can load an arbitrarily long one.
- **`document.ts` forward constraints** — `DerivedSlot.value` is required but never serialized
  (§5.11), so load must place a placeholder before evaluating; that is D-018's exact case, so fix
  it first rather than working around it in the loader. Loading MUST use the batch form (D-020).
- Table/`cells` mapping in `address.ts` still hardcoded; `nonDerivedSlotPaths` cannot express a
  slot family. Both wait on `schema.ts` expressing families (D-005 §4, D-009). **Do not extend
  `nonDerivedSlotPaths` to tables** (D-017's own forward note).
- **SETTLED, do not re-raise:** flat `claude/` layout (0002-REVIEW); shared vocabulary out of
  `graph/node.ts` (0006-REVIEW §6); unifying `isErrorValue`/`isAddressError` (D-014); inverting a
  `GraphObject.slots` key to recover a KNOWN slot's path — never `key.split(".")`;
  `describeUndeclaredSlot`'s raw-key naming (**approved, D-022** — but pin its equivalence claim
  with a test); collapsing §5.1.1's two clauses into one `resolveSlot` check (**approved,
  0018-REVIEW**).

## Live PROVISIONAL tags and open questions
**`PROVISIONAL(Q-005)`** → `formula/ast.ts`, `graph/eval.ts`, `mutation.ts` (both AST-reading
sites). Approved 0006-REVIEW, not a live risk.
**Q-006 — NEW, open**: is a non-finite number legal document state? Answer before `document.ts`'s
round-trip test is written. **Q-001/Q-002** (Phase 3), **Q-004** (Phase 2), **Q-003** ANSWERED →
D-007. Next free: **Q-007**.
All three questions the implementer raised for the reviewer across 0015/0017 are now answered —
D-022, 0018-REVIEW's answered-questions section, and D-021 respectively.

## Gotchas for the next model
- **A green suite is not a correct one right now.** Three tests pin behaviour the brief forbids.
  Read `mutation.test.ts`'s `KNOWN GAPS pinned by 0018-REVIEW` block before touching that file.
- **Mutation-testing proves a mechanism is load-bearing, not that it is correct.** 0017 proved the
  clone was necessary with two excellent experiments and still shipped a lossy clone (D-019). Ask
  both questions of any new mechanism: would removing it break a test, *and* does it do its job for
  every input its types admit?
- **"X never needs checking because Y" is a claim to test, not to comment.** The false
  `dependentSlot` proof (finding 1) sat in three doc comments and read as settled.
- **`mutate` is the one entry point that runs the full §5.1 loop** — call it, don't hand-chain
  `cloneObjects`/`applyOperation`/`deriveValidateAndEvaluate`. It applies ONE operation per call
  until D-020 lands.
- **The clone is load-bearing** — do not "simplify it away" on the reasoning that everything
  downstream is pure. That reasoning is only as strong as every downstream function staying pure
  forever. (Make it faithful per D-019; do not remove it.)
- **A fixture that LOOKS like it tests "order matters" may not** (0016's lesson): a missing edge
  can only cause a false NEGATIVE in `detectCycle`, never a false positive.
- **`structuredClone` is a DOM-lib global** — excluded by `tsconfig.engine.json` (D-006). Write the
  recursive clone by hand.
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
