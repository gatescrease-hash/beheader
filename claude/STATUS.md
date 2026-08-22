# STATUS — as of entry 0016-wire-mutation-sequence

STATE: GREEN — compiles under both tsconfigs, all tests pass (131/131, 0 skipped, 0 `.only`).

Current phase: 0 — Graph core (headless, no pixels). Acceptance criterion (PROJECT_BRIEF §6):
> you can build a graph in a unit test, bind slots, mutate a value and watch it propagate
> in correct topological order *including through derived slots*; a cycle is rejected with
> the offending slots named **and prior state is provably unchanged**; deleting a slot with
> dependents is rejected; and a document round-trips to JSON and back identically.

Status: **partial — one of four clauses closed.**

1. Propagation in correct topological order, including through derived slots — **PASSING**
   (`graph/eval.test.ts`'s reverse-declared-order fixture, since 0012-REVIEW).
2. Cycle rejected, offending slots named, prior state provably unchanged — **NOT YET, but the
   "rejected + slots named" half is now demonstrable end-to-end.** `mutation.ts`'s new
   `deriveValidateAndEvaluate(objects)` (this cycle) composes `deriveEdges → validateIntegrity →
   detectCycle → evaluate` in one call, and rejects a genuine cycle with every slot named via
   `formatAddress`. **Still missing:** a stage/clone (step 1) to snapshot against, so "prior state
   provably unchanged" has nothing to compare against yet (D-016) — do not claim this clause until
   that snapshot exists.
3. Deleting a slot with dependents is rejected — **NOT YET** (no delete operation exists).
   `validateIntegrity`'s dangling-reference check is the mechanism that will reject it.
4. Document round-trips to JSON identically — **NOT YET**.

Last review point: **0014-REVIEW-phase0, ACCEPT WITH EDITS.** Cycles 0015 and 0016 (this one) are
**unreviewed, batching per the 2026-08-22 cadence change** (§6): cycle 2 of up to 3 since last
review, diff since that review ~620 lines / 2 files (`mutation.ts`, `mutation.test.ts`; cap
800/10) — under cap on both counts. No §6.1 trigger fired this cycle. **REVIEW: NOT NEEDED**, per
§6.4 — though `mutation.ts` remains load-bearing, so no later phase may begin while it has
unreviewed changes (§6.2), and clause 2's remaining half (stage/clone) is the natural next place a
phase-gate-adjacent review would land.

## Built and reviewed
- Scaffold: `package.json`, both tsconfigs (strict + DOM-free, D-006), Vitest. (`node_modules` was
  missing at the start of cycle 0016 — `npm install` was required before `npm run typecheck`/`npm
  test` would run at all; not a new dependency, just installing what `package.json` already
  declared.)
- `address.ts` (§5.2, 44 tests) — two-layer name/ID scheme, D-005 surface↔stored mapping keyed on
  the A1 form (D-008), exact `parseAddress`/`formatAddress` inverses.
- `graph/node.ts` (§5.1, 20 tests) — `Value`/`Point`/`ErrorValue`/`isErrorValue` (D-014),
  `ObjectType`/`TABLE_TYPE` (D-009/D-011), the three slot kinds, `GraphObject`, `slotKey`/
  `getSlot`/`resolveSlot`.
- `graph/edge.ts` (§5.1, 6 tests) — `Edge` and `addressKey`. **Internal-only, D-015.**
- `formula/ast.ts` — one-variant `FormulaAst`. **`PROVISIONAL(Q-005)`, approved 0006-REVIEW.**
- `primitives/schema.ts` (§5.1, 19 tests) — derived-slot declarations
  (`derivedSlotDependencyAddresses`, `getObjectSchema`, `findDerivedSlotSchema`) plus (0013)
  `ObjectSchema.nonDerivedSlotPaths`. Real entries for `value`/`add` (D-011). Reviewed at 0014.
- `graph/cycles.ts` (§5.1 step 5, 11 tests) — `detectCycle(edges)`: from-scratch DFS, returns the
  first cycle as an ordered `Address[]`. No object list, no message — that's `mutation.ts`'s job.
- `graph/eval.ts` (§5.1 step 7, 10 tests) — `evaluate(objects, edges)`: full topological pass
  (DFS postorder reversal) over an edge set ASSUMED acyclic; all three slot kinds in one pass,
  D-013 enforced mechanically.
- `mutation.ts`'s `deriveEdges` (§5.1 step 3, reviewed at 0014) — rebuilds the whole `Edge[]`
  every call from `nonDerivedSlotPaths` + `derivedSlots`. Narrower than "every stored formula
  AST" (D-017) — closed by `validateIntegrity`; `deriveEdges` itself is UNCHANGED, per D-017's
  own ruling.

## Built this batch, not yet reviewed
- **`mutation.ts`'s `validateIntegrity(objects, edges)`** (§5.1 step 4 / §5.1.1, cycle 0015) — 16
  tests. Two checks, in order, short-circuiting on the first with any problems: (1) D-017 part 2 —
  rejects any object whose actual `formula`/`derived` slots disagree with its schema's declared
  paths, naming the offending slot(s) via `describeUndeclaredSlot` (deliberately NOT
  `formatAddress` — see cycle 0015's entry and the two flagged reviewer questions below); (2)
  §5.1.1 dangling-reference rejection — rejects any edge whose `sourceSlot` doesn't `resolveSlot`,
  naming the DEPENDENT.
- **`mutation.ts`'s `deriveValidateAndEvaluate(objects)`** (§5.1 steps 3-5 and 7 composed, cycle
  0016) — 5 tests. Wires `deriveEdges → validateIntegrity → detectCycle → evaluate` in that fixed
  order into one call, returning `{ ok: true, objects }` or `{ ok: false, message }`. Rejects a
  genuine cycle naming every slot via `formatAddress` (new private helper
  `formatCycleRejection`, D-015-compliant). Mutation-tested twice (D-016): disabling the cycle
  check broke exactly 1 test; swapping validateIntegrity/detectCycle's order broke exactly 1
  (different) test — see 0016's entry for both failure outputs. **Does NOT yet build stage/clone,
  apply, or commit+journal (§5.1 steps 1, 2, 6, 8)** — it takes a candidate `objects` list and does
  not produce one.

## Not started, in order
(1) Stage/clone (step 1) — the next concrete blocker for clause 2's "prior state provably
unchanged" half, plus real operation shapes (`setLiteral`, `link`, object creation/deletion) to
apply to the clone, reject-and-discard-on-cycle (step 6) as an actual caller of
`deriveValidateAndEvaluate`, commit + journal (step 8), and the batch form. (2) `document.ts` +
round-trip (`nextObjectId`, D-002). Then Phase 1 — not before Phase 0's criterion passes and is
reviewed.

## Next slice (recommended)
Build the stage/clone step (§5.1 step 1: deep-clone the current document state) and a minimal
operation shape it can apply before calling `deriveValidateAndEvaluate` — even just enough to
construct a real "mutate, cycle rejected, snapshot of prior state proven byte-for-bit unchanged"
test. That test is the thing D-016 has been withholding clause 2 on since 0012-REVIEW; landing it
is what finally lets clause 2 be claimed. Do not claim it before that snapshot-comparison test
exists and its own mutation check names a failing test (D-016).

## Known problems
- **D-017 — CLOSED.** `deriveEdges` still walks the SCHEMA's slot set (correct per its own
  ruling); `validateIntegrity` check 1 makes schema/object disagreement LOUD instead of silent;
  `deriveValidateAndEvaluate` (0016) confirms by composition that this ordering holds end-to-end,
  not just at each function's own unit-test level.
- **L-16** — nothing enforces `nonDerivedSlotPaths`/`derivedSlots` paths are disjoint on one type.
  Fix: one registry-wide `slotKey`-compared test (D-010), same shape as L-8's. Open.
- **L-17 / L-18** — `deriveEdges` shares path-array references with the registry (harmless), and
  does not deduplicate (both consumers tolerate it). Unchanged.
- **L-13** — `eval.ts`'s stale-edge `continue` branch is still reached by no test. Unchanged this
  cycle.
- **L-14** — `eval.ts`'s two `ErrorValue` messages name no slot (no object list to `formatAddress`
  with). Unfixable there; a real gap for whoever renders error badges (§5.9).
- **`describeUndeclaredSlot` is not `formatAddress`.** Deliberate, disclosed (0015's entry). Two
  open questions for the reviewer from that cycle, both still unanswered — see below.
- **L-6 – L-15, carried** — cosmetics, written up where found (0006/0008/0010/0012-REVIEW §4).
  Worth folding in when nearby: **L-8** (into L-16's test) and **L-10** (`addressKey` assumes
  D-002 `obj_<n>` IDs — note in `document.ts`).
- **`detectCycle`'s reported cycle can start at any member** — correct either way.
- **Recursion depth** — `detectCycle`/`evaluate` recurse once per slot on the longest chain. Fine
  at brief scale; watch it once `document.ts` can load an arbitrarily long one.
- **`document.ts` forward constraint** — `DerivedSlot.value` is required but never serialized
  (§5.11); load must place a `null` placeholder before evaluating.
- Table/`cells` mapping in `address.ts` still hardcoded; `nonDerivedSlotPaths` cannot express a
  slot family either (D-017's Phase 4 note — do not extend it for tables). Both wait on
  `schema.ts` expressing families (D-005 §4, D-009).
- **SETTLED, do not re-raise:** flat `claude/` layout (0002-REVIEW); shared vocabulary out of
  `graph/node.ts` (0006-REVIEW §6); unifying `isErrorValue`/`isAddressError` (D-014); inverting a
  `GraphObject.slots` key to recover a KNOWN slot's path — solved twice by declaring it
  schema-side (0011, 0013); never `key.split(".")`. `describeUndeclaredSlot` is NOT a fourth
  instance of that solved problem — see above.

## Live PROVISIONAL tags and open questions
**`PROVISIONAL(Q-005)`** → `formula/ast.ts`, `graph/eval.ts`, `mutation.ts` (both AST-reading
sites). Approved 0006-REVIEW, not a live risk. **Q-001/Q-002** (Phase 3), **Q-004** (Phase 2),
**Q-005** (approved), **Q-003** ANSWERED → D-007. Next free: **Q-006**.

Two questions raised for the reviewer at cycle 0015 (not formal `Q-NNN`s — reversible, disclosed
judgment calls, not open ambiguity), both still outstanding:
1. Is `describeUndeclaredSlot`'s raw-key message (not `formatAddress`) an acceptable disclosed
   exception to D-017's "via formatAddress" wording?
2. Is collapsing §5.1.1's two stated clauses into one `resolveSlot`-based check the right reading?

## Gotchas for the next model
- **D-017 is CLOSED**, and now composed end-to-end via `deriveValidateAndEvaluate` — call that
  function rather than re-chaining `deriveEdges`/`validateIntegrity`/`detectCycle`/`evaluate`
  yourself from anywhere new; the order is load-bearing (see its doc comment) and this function is
  the one place that order can't be gotten wrong by omission.
- **A fixture that LOOKS like it tests "order matters" may not.** Cycle 0016 initially reused the
  0015 "KNOWN GAP" 3-slot fixture (a cycle running only through an undeclared slot) to test that
  `validateIntegrity` must run before `detectCycle` — but that fixture's missing edge means
  `detectCycle` can never see a cycle there in EITHER order (a missing edge cannot manufacture a
  false-positive cycle elsewhere), so swapping the order left every test green. Caught only by
  actually running the D-016 mutation check. If you need an "order matters" fixture, it needs a
  problem `detectCycle` really CAN find on its own (e.g. a genuine, fully-declared self-cycle)
  alongside the separate problem you're testing precedence against.
- **Naming an undeclared slot has no `Address`.** `describeUndeclaredSlot` in `mutation.ts` is
  not trying to be `formatAddress` — read its doc comment before assuming every slot-naming path
  should go through `formatAddress`. This is the one place it structurally cannot.
- **D-016** — a test can cover a behaviour, pass, and still not *demonstrate* it. Always
  mutation-test a new composed/ordering claim, not just a new value claim — see the gotcha above.
- **Cyclic input to `evaluate` fails SILENTLY** — `visit` marks visited before recursing, so a
  back-edge returns early and the pass completes, quietly emitting `#REF`s. Step 5 before step 7
  is load-bearing; do not add a defensive cycle check inside `eval.ts`.
- **`GraphObject`, not `Object`** — naming-collision workaround; the prose word is still "object."
- **`address.ts` ↔ `graph/node.ts` share TYPES only** (`import type`) — a value import between
  them creates a real runtime cycle.
- **`Value`/`Point`/`ErrorValue`/`isErrorValue` live in `graph/node.ts`** — never redefine (D-014).
- **Slot keys come only from `slotKey()`** (D-010), **document-wide keys only from
  `addressKey()`** (D-015); both stay internal. User-facing names come from `formatAddress`
  (exception: `describeUndeclaredSlot`, above).
- **`ObjectType` includes `value`/`add`** (D-011); **`explode` sets type to `polyline`** (D-012).
  `resolveSlot`/`getObjectSchema`/`findDerivedSlotSchema` return `undefined` on a miss, not an
  `ErrorValue` — turning that into `#REF` is the caller's job, as `eval.ts` does.
- **The schema registry stores FUNCTIONS and that is correct** (0008-REVIEW §2) — same for the
  three modules' function-local scratch `Map`s. Don't "fix" any of them.
- **`derivedSlotDependencyAddresses` runs at edge-derivation time only** (Rule 6) — `eval.ts` and
  `validateIntegrity` never call it.
- **`node_modules` is not checked in.** Run `npm install` at the start of a session if
  `npm run typecheck`/`npm test` fail with a missing-`tsc` error — it's installing what
  `package.json` already declares, not adding a dependency.
- Each PowerShell call is a fresh process; the Bash tool's `npm` is not on PATH — use PowerShell.
