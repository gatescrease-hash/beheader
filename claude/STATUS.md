# STATUS — as of entry 0017-mutate

STATE: GREEN — compiles under both tsconfigs, all tests pass (136/136, 0 skipped, 0 `.only`).
**Batch cap reached — REVIEW: REQUIRED before another cycle starts** (see below).

Current phase: 0 — Graph core (headless, no pixels). Acceptance criterion (PROJECT_BRIEF §6):
> you can build a graph in a unit test, bind slots, mutate a value and watch it propagate
> in correct topological order *including through derived slots*; a cycle is rejected with
> the offending slots named **and prior state is provably unchanged**; deleting a slot with
> dependents is rejected; and a document round-trips to JSON and back identically.

Status: **partial — two of four clauses closed.**

1. Propagation in correct topological order, including through derived slots — **PASSING**
   (`graph/eval.test.ts`'s reverse-declared-order fixture, since 0012-REVIEW).
2. Cycle rejected, offending slots named, prior state provably unchanged — **PASSING, closed at
   0017.** `mutation.ts`'s `mutate(objects, operation, journal)` (this cycle) is a real, callable
   mutation entry point: stage (deep-clone), apply one `setSlot` operation, derive/validate/detect/
   evaluate, and on rejection return the failure with the caller's `objects`/`journal` untouched.
   Demonstrated by a rejection test whose message names every cycle slot, AND by a separate test
   that deep-compares a pre-call snapshot against the caller's own references after a rejected
   call — mutation-tested TWICE (0017's entry has both failure transcripts) to confirm the snapshot
   check is real and specifically that the clone step is what makes it hold.
3. Deleting a slot with dependents is rejected — **NOT YET** (no delete operation exists).
   `validateIntegrity`'s dangling-reference check is the mechanism that will reject it once a
   delete `Operation` variant exists.
4. Document round-trips to JSON identically — **NOT YET**, `document.ts` not started.

**This is NOT the Phase 0 gate itself** — per PROCESS_BRIEF §12 the gate is reviewed as one unit
once all four clauses hold, not clause-by-clause. Clauses 3-4 remain open.

Last review point: **0014-REVIEW-phase0, ACCEPT WITH EDITS.** Cycles 0015, 0016, 0017 (this one)
are unreviewed, batching per the 2026-08-22 cadence change (§6). **Both §6.3 caps are now reached:**
3 of the "up to 3" cycles have completed since that review, AND the cumulative diff is ~934 lines
across 2 files (`mutation.ts`, `mutation.test.ts`) — over the ~800-line threshold (file count, 2,
is well under 10; either condition alone is sufficient). **REVIEW: REQUIRED before any further
cycle begins** — do not start a new slice on `mutation.ts` (or anything depending on its current
shape) until this batch (0015-0017) is reviewed. `document.ts` (clause 4) touches none of
`mutation.ts`'s unreviewed surface directly, but still depends on `mutate`'s shape for how it will
apply loaded operations — safer to treat the whole batch as blocking until reviewed.

## Built and reviewed
- Scaffold: `package.json`, both tsconfigs (strict + DOM-free, D-006), Vitest. (`node_modules` is
  gitignored — run `npm install` at the start of a session if `npm run typecheck`/`npm test` fail
  with a missing-`tsc` error; this installs what `package.json` already declares, not a new dep.)
- `address.ts` (§5.2, 44 tests) — two-layer name/ID scheme, D-005 surface↔stored mapping keyed on
  the A1 form (D-008), exact `parseAddress`/`formatAddress` inverses.
- `graph/node.ts` (§5.1, 20 tests) — `Value`/`Point`/`ErrorValue`/`isErrorValue` (D-014),
  `ObjectType`/`TABLE_TYPE` (D-009/D-011), the three slot kinds, `GraphObject`, `slotKey`/
  `getSlot`/`resolveSlot`. Every field `readonly` — in-place mutation is not type-legal here without
  an unjustified cast (relevant to this cycle's mutation-testing, see Gotchas).
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
- **`validateIntegrity(objects, edges)`** (§5.1 step 4 / §5.1.1, cycle 0015) — 16 tests. Two
  checks, in order, short-circuiting on the first with any problems: (1) D-017 part 2 — rejects any
  object whose actual `formula`/`derived` slots disagree with its schema's declared paths, naming
  the offending slot(s) via `describeUndeclaredSlot`; (2) §5.1.1 dangling-reference rejection.
- **`deriveValidateAndEvaluate(objects)`** (§5.1 steps 3-5 and 7 composed, cycle 0016) — 5 tests.
  Wires `deriveEdges → validateIntegrity → detectCycle → evaluate` in that fixed order, returning
  `{ ok: true, objects }` or `{ ok: false, message }`. Mutation-tested twice (D-016): disabling the
  cycle check, and swapping validateIntegrity/detectCycle's order, each broke exactly 1 test.
- **`mutate(objects, operation, journal)`** (§5.1's full loop for one operation, cycle 0017) — 5
  tests. Adds `SetSlotOperation`/`Operation` (one variant), `cloneObjects` (real JSON-round-trip
  deep clone, step 1), `applyOperation` (pure rebuild, step 2), `MutationJournalEntry` (Rule 2's
  day-one journal requirement). Mutation-tested TWICE (see 0017's entry): a buggy in-place
  `applyOperation` with the clone still present left every test green; removing the clone too
  reproduced real, cascading state corruption across 3 tests — confirming the clone is genuinely
  load-bearing, not redundant boilerplate over already-pure code.

## Not started, in order
(1) A delete-with-dependents `Operation` variant, to demonstrate clause 3 (needs a real "the
mutation would delete a slot that still has inbound dependents" test — `validateIntegrity`'s
dangling check is already the mechanism, just needs an operation that can actually delete a slot).
(2) `document.ts` + round-trip (`nextObjectId`, D-002) — clause 4. (3) The batch mutation form
(§5.1, "required from day one" — still only single-operation `mutate` exists). Then Phase 1 — not
before Phase 0's criterion passes in full and is reviewed.

## Next slice (recommended)
**Do not start it until this batch (0015-0017) is reviewed — the cap is reached.** When cleared:
either (a) a delete-with-dependents operation variant to close clause 3, or (b) `document.ts`'s
round-trip to close clause 4. (a) is smaller and stays inside `mutation.ts`'s already-reviewed-by-
then surface; (b) is a new file (§6.1 trigger 2) and would itself force an immediate review point
on its own first cycle regardless of the batch cap.

## Known problems
- **D-017 — CLOSED**, composed end-to-end via `deriveValidateAndEvaluate` (0016) and now reachable
  through the real `mutate` entry point (0017) too.
- **L-16** — nothing enforces `nonDerivedSlotPaths`/`derivedSlots` paths are disjoint on one type.
  Fix: one registry-wide `slotKey`-compared test (D-010), same shape as L-8's. Open.
- **L-17 / L-18** — `deriveEdges` shares path-array references with the registry (harmless), and
  does not deduplicate (both consumers tolerate it). Unchanged.
- **L-13** — `eval.ts`'s stale-edge `continue` branch is still reached by no test. Unchanged.
- **L-14** — `eval.ts`'s two `ErrorValue` messages name no slot. Unfixable there; a real gap for
  whoever renders error badges (§5.9).
- **`describeUndeclaredSlot` is not `formatAddress`.** Deliberate, disclosed (0015's entry). Two
  open questions for the reviewer from that cycle, both still unanswered — see below.
- **`applyOperation`'s no-op on an unknown `objectId`** — disclosed judgment call, flagged for the
  reviewer (0017's entry) rather than settled.
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

Three questions raised for the reviewer, not formal `Q-NNN`s (all reversible, disclosed judgment
calls, not open ambiguity), all still outstanding:
1. (0015) Is `describeUndeclaredSlot`'s raw-key message an acceptable disclosed exception to
   D-017's "via formatAddress" wording?
2. (0015) Is collapsing §5.1.1's two stated clauses into one `resolveSlot`-based check the right
   reading?
3. (0017) Is `applyOperation`'s no-op-on-unknown-`objectId` behavior the right default, or should
   `mutate` validate the target exists before calling `deriveValidateAndEvaluate`?

## Gotchas for the next model
- **`mutate` is the one entry point that runs the FULL §5.1 loop today** — call it rather than
  hand-chaining `cloneObjects`/`applyOperation`/`deriveValidateAndEvaluate` yourself. It only
  applies ONE `Operation` (`setSlot`) per call; the batch form is still NOT built.
- **The clone in `mutate` is not redundant, even though everything downstream is pure — proven by
  mutation-testing, not just asserted.** See 0017's entry: with the clone removed AND
  `applyOperation` made to (hypothetically) mutate in place, real cascading state corruption
  resulted across 3 tests. Do not "simplify away" the clone on the reasoning that pure functions
  make it unnecessary — that reasoning is only as strong as every downstream function staying pure
  forever, and the clone is what makes the guarantee structural instead of accidental.
- **A fixture that LOOKS like it tests "order matters" may not** (0016's own lesson, carried):
  a missing edge can only ever cause a false NEGATIVE in `detectCycle`, never a false positive, so
  swapping step order around a fixture whose problem is a MISSING edge won't distinguish the two
  orders. Need a problem `detectCycle` can genuinely catch on its own to test precedence against.
- **Naming an undeclared slot has no `Address`.** `describeUndeclaredSlot` in `mutation.ts` is
  not trying to be `formatAddress` — read its doc comment before assuming every slot-naming path
  should go through `formatAddress`. This is the one place it structurally cannot.
- **`structuredClone` is a DOM-lib global, not a core-ECMAScript one** — `tsconfig.engine.json`
  excludes the DOM lib (D-006), so `cloneObjects` uses `JSON.parse(JSON.stringify(x))` instead.
  Don't reach for `structuredClone` anywhere under `src/engine/`.
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
- **The schema registry stores FUNCTIONS and that is correct** (0008-REVIEW §2) — same for the
  three modules' function-local scratch `Map`s. Don't "fix" any of them.
- **`derivedSlotDependencyAddresses` runs at edge-derivation time only** (Rule 6) — `eval.ts` and
  `validateIntegrity` never call it.
- Each PowerShell call is a fresh process; the Bash tool's `npm` is not on PATH — use PowerShell.
