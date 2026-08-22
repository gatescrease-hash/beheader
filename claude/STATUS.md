# STATUS — as of entry 0015-validate-integrity

STATE: GREEN — compiles under both tsconfigs, all tests pass (126/126, 0 skipped, 0 `.only`).

Current phase: 0 — Graph core (headless, no pixels). Acceptance criterion (PROJECT_BRIEF §6):
> you can build a graph in a unit test, bind slots, mutate a value and watch it propagate
> in correct topological order *including through derived slots*; a cycle is rejected with
> the offending slots named **and prior state is provably unchanged**; deleting a slot with
> dependents is rejected; and a document round-trips to JSON and back identically.

Status: **partial — one of four clauses closed.**

1. Propagation in correct topological order, including through derived slots — **PASSING**
   (`graph/eval.test.ts`'s reverse-declared-order fixture, since 0012-REVIEW).
2. Cycle rejected, offending slots named, prior state provably unchanged — **NOT YET.**
   `validateIntegrity` (this cycle) makes the graph handed to `detectCycle` trustworthy (closes
   D-017), but nothing wires the four pieces together yet, and there is no stage/clone to compare
   against for "prior state provably unchanged."
3. Deleting a slot with dependents is rejected — **NOT YET** (no delete operation exists).
   `validateIntegrity`'s dangling-reference check is the mechanism that will reject it.
4. Document round-trips to JSON identically — **NOT YET**.

Last review point: **0014-REVIEW-phase0, ACCEPT WITH EDITS.** Cycle 0015 (this one) is
**unreviewed — REVIEW: REQUIRED** (§6.1 trigger 2: modified `mutation.ts`).

Note: 0001–0015 predate the batching cadence in `PROCESS_BRIEF.md` §6 (Manager cleanup,
2026-08-22) and were each reviewed individually. Going forward, up to 3 cycles or ~800 changed
lines may complete before a review point is mandatory, unless a §6.1 trigger fires sooner.

## Built and reviewed
- Scaffold: `package.json`, both tsconfigs (strict + DOM-free, D-006), Vitest.
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
  AST" (D-017) — **closed as of this cycle by `validateIntegrity`; `deriveEdges` itself is
  UNCHANGED, per D-017's own ruling.**

## Built this cycle, not yet reviewed
- **`mutation.ts`'s `validateIntegrity(objects, edges)` (§5.1 step 4 / §5.1.1)** — 16 tests in
  `mutation.test.ts` (9 new, 2 removed — 0014's "KNOWN GAP" tests, replaced with real rejection
  tests per that review's instruction). Two checks, in order, short-circuiting on the first with
  any problems:
  1. **D-017 part 2** — rejects any object whose actual `formula`/`derived` slots disagree with
     its schema's declared paths, naming the offending slot(s). No-schema types are skipped.
  2. **§5.1.1 dangling-reference rejection** — rejects any edge whose `sourceSlot` doesn't
     `resolveSlot`, naming the DEPENDENT (never the missing source — see Gotchas).
  Read 0015's log entry before touching check 1's messaging: it names an undeclared slot as
  `${object.name}.${key}` via `describeUndeclaredSlot`, deliberately NOT `formatAddress` (an
  undeclared slot has no schema-declared path to format). Flagged as a question for the reviewer,
  not settled.

## Not started, in order
(1) Wire `deriveEdges → validateIntegrity → detectCycle → evaluate` into one sequence (still no
clone/journal); then stage/clone (step 1), apply (step 2), reject-and-discard-on-cycle (step 6),
commit + journal (step 8), and the batch form. (2) `document.ts` + round-trip (`nextObjectId`,
D-002). Then Phase 1 — not before Phase 0's criterion passes and is reviewed.

## Next slice (recommended)
Wire the four built pieces into one sequence: `deriveEdges` → `validateIntegrity` (reject, stop)
→ `detectCycle` (reject, stop, format every cycle slot via `formatAddress`, D-015) → `evaluate`.
Still not the full 8-step loop (no clone/apply/journal), but the first point where clause 2's
cycle-rejection becomes demonstrable end-to-end.

**D-016 binds hardest here still.** "Prior state provably unchanged" needs step 1 (stage/clone)
to exist before it means anything — a rejection test that only checks the return shape proves
nothing about state; it needs a deep compare against a pre-call snapshot. Do not claim clause 2
until that snapshot test exists and its own mutation check names a failing test.

## Known problems
- **D-017 — CLOSED as of this cycle.** `deriveEdges` still walks the SCHEMA's slot set (still
  correct per its own ruling); `validateIntegrity` check 1 now makes schema/object disagreement
  LOUD instead of silent.
- **L-16** — nothing enforces `nonDerivedSlotPaths`/`derivedSlots` paths are disjoint on one type.
  Fix: one registry-wide `slotKey`-compared test (D-010), same shape as L-8's. Open.
- **L-17 / L-18** — `deriveEdges` shares path-array references with the registry (harmless), and
  does not deduplicate (both consumers tolerate it). Unchanged.
- **L-13** — `eval.ts`'s stale-edge `continue` branch is still reached by no test. Closer to
  pinnable now that `validateIntegrity` exists, but not pinned — don't call it covered yet.
- **L-14** — `eval.ts`'s two `ErrorValue` messages name no slot (no object list to `formatAddress`
  with). Unfixable there; a real gap for whoever renders error badges (§5.9).
- **`describeUndeclaredSlot` is not `formatAddress`.** Deliberate, disclosed (0015's entry).
  Produces the identical string `formatAddress` would for every schema-registered type today
  (neither `value` nor `add` is a table), but stops being exact if a table ever gains an
  undeclared slot — already forbidden territory per D-017's Phase 4 note. Reviewer judgment
  requested, not settled.
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
  instance of that solved problem — it names a slot nothing declares at all — see above.

## Live PROVISIONAL tags and open questions
**`PROVISIONAL(Q-005)`** → `formula/ast.ts`, `graph/eval.ts`, `mutation.ts` (both AST-reading
sites). Approved 0006-REVIEW, not a live risk. **Q-001/Q-002** (Phase 3), **Q-004** (Phase 2),
**Q-005** (approved), **Q-003** ANSWERED → D-007. Next free: **Q-006**.

## Gotchas for the next model
- **D-017 is CLOSED, but `deriveEdges` itself did not change.** If you call
  `deriveEdges`/`detectCycle`/`evaluate` from anywhere new, call `validateIntegrity` between the
  first two, or you've reopened D-017's hole locally.
- **Naming an undeclared slot has no `Address`.** `describeUndeclaredSlot` in `mutation.ts` is
  not trying to be `formatAddress` — read its doc comment before assuming every slot-naming path
  should go through `formatAddress`. This is the one place it structurally cannot.
- **D-016** — a test can cover a behaviour, pass, and still not *demonstrate* it. An ORDER claim
  needs a wrong-order fixture; "state unchanged" needs a pre-call snapshot, which doesn't exist
  anywhere in this codebase yet (step 1 isn't built).
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
- Each PowerShell call is a fresh process; the Bash tool's `npm` is not on PATH — use PowerShell.
