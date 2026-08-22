# 0017 — mutate
Date: 2026-08-22   Phase: 0   Model: implementer (Claude Sonnet 5)
Previous entry: 0016-wire-mutation-sequence   Last review: 0014-REVIEW-phase0 (verdict: ACCEPT WITH EDITS)
Batch: cycle 3 of up to 3 since last review; ~934 lines / 2 files changed so far (`mutation.ts`,
`mutation.test.ts`) — **both the cycle-count and diff-size caps are now reached.**

## Declared scope
Build `mutation.ts`'s `mutate(objects, operation, journal)` — the first real entry point covering
the rest of §5.1's loop (stage/clone step 1, apply one minimal `setSlot` operation step 2, the
already-composed steps 3-5/7, discard-on-reject step 6, commit+journal step 8 per Rule 2's "journal
from day one"). Use this to close Phase 0 acceptance clause 2 in full, including "prior state
provably unchanged," via a mutation-tested snapshot-comparison test.

## Explicitly not in scope
- Any operation kind besides `setSlot` (`link`/`unlink`/`set`/`delete`/`explode`/object creation) —
  those are §5.10's command layer, Phase 3.
- Clause 3 (deleting a slot with dependents is rejected) — no delete operation exists yet.
- `document.ts` / clause 4 (JSON round-trip).
- The batch mutation form (§5.1, "required from day one") — `mutate` here still applies exactly
  one `Operation` per call. Noted explicitly in the file's NOT DONE HERE as still outstanding.

## What I did
- `src/engine/mutation.ts`:
  - `SetSlotOperation` / `Operation` — one operation kind, "replace the slot at this address with
    this new slot wholesale." Mirrors `formula/ast.ts`'s Q-005 precedent (a single-variant union
    later phases widen, never restructure).
  - `cloneObjects(objects)` — a real deep clone via JSON round-trip (§5.1 step 1, Rule 5's literal
    wording: "implement staging by deep-cloning the document state"). Legitimate specifically
    because graph state is required to be plain/JSON-serializable (PROJECT_BRIEF §2) — the same
    property `document.ts` will lean on later.
  - `applyOperation(objects, operation)` — pure; returns a NEW array with `setSlot`'s effect applied
    (§5.1 step 2). An address naming no object is a no-op, not a throw — trusted input from whatever
    future command layer builds an `Operation` (this file only applies one, per its own long-standing
    NOT DONE HERE).
  - `MutationJournalEntry` / `MutationResult` / `mutate(objects, operation, journal)` — wires
    stage → apply → `deriveValidateAndEvaluate` (cycle 0016) → discard-on-reject (step 6) →
    append-to-journal-and-return (step 8). Rejection returns `deriveValidateAndEvaluate`'s own
    result untouched; `objects`/`journal` are never reassigned on that path.
  - Updated the file header's top paragraph, `IMPLEMENTS`, `WHAT THIS IS` (new `mutate` section),
    and `NOT DONE HERE` (narrowed to: holding document state across calls, the batch form, other
    operation kinds, the repair path, range/reference-adjustment, and the undo/redo UI itself).
- `src/engine/mutation.test.ts`:
  - Updated the stale file-level header (previously said "stage, apply, validate, evaluate, commit
    does not exist yet" — no longer true).
  - New describe block, 6 tests: (1) mutating a value's literal propagates through a derived slot,
    appending one journal entry — PROJECT_BRIEF §6's own wording. (2) A mutation that would
    introduce a genuine self-cycle is rejected, naming every slot. (3) **The D-016 test**: the same
    rejected mutation leaves the caller's `objects` AND `journal` deep-equal to a pre-call snapshot.
    (4) A mutation creating a dangling reference is rejected, prior state unchanged. (5) Never
    throws across accepted/rejected/no-op operations; an operation naming a nonexistent object is a
    genuine no-op (still returns `ok: true`, appends to the journal, `objects` unchanged in value).

## Decisions I made
- **Clone via JSON round-trip, not `structuredClone`.** `structuredClone` is declared in
  `lib.dom.d.ts` in current TypeScript, and `tsconfig.engine.json` deliberately excludes the DOM lib
  (D-006, Rule 1) — using it risked either a type error under the engine config or, worse, an
  accidental DOM-lib dependency creeping into `engine/`. `JSON.parse(JSON.stringify(x))` needs
  nothing beyond core ECMAScript and is exactly the operation `document.ts` will need anyway for
  save/load (§5.11) — the SAME property (plain, JSON-safe graph state, PROJECT_BRIEF §2) justifies
  both uses.
- **A real clone, even though every downstream function is already pure.** Before writing this I
  reasoned that since `applyOperation`/`deriveEdges`/`validateIntegrity`/`detectCycle`/`evaluate`
  never mutate anything, an explicit clone might be redundant — the original `objects` was "never
  going to be touched" regardless. I mutation-tested this directly rather than trusting the
  reasoning (see Verification): with the clone in place, deliberately making `applyOperation`
  mutate in place left every test green (the clone already isolated the damage). Removing the
  clone too then reproduced exactly the corruption D-016 exists to catch. Conclusion: the clone is
  NOT redundant — it is the thing that makes "prior state provably unchanged" a structural property
  of `mutate` itself, rather than an accident that would silently stop holding the day some future
  function stopped being pure. Kept the clone; documented this reasoning in the file header rather
  than leaving it implicit.
- **`applyOperation` is a no-op for an unknown `objectId`, not a rejection.** `mutate` doesn't
  validate the operation's target before applying it — `deriveValidateAndEvaluate`'s own dangling-
  reference check (already composed) is positioned to catch a bad reference if one matters to the
  graph; an operation naming an object that plain doesn't exist at all has nothing to validate
  against structurally, so it is trusted input for now (documented explicitly; no command layer
  exists yet to be the thing constructing a bad `Operation`).
- **`journal` is threaded through as a parameter/return, not held internally.** Rule 2 forbids
  closures/mutable state inside anything holding graph state; `mutate` is a pure function of exactly
  three arguments, matching every other function in this file. A future `document.ts` (or command
  layer) owns the actual current `(objects, journal)` pair between calls.
- **`MutationJournalEntry` holds only the applied `Operation`, no timestamp.** Nothing concrete
  needs more yet — same "add it when needed" stance `primitives/schema.ts` already takes on its own
  declarations.

## Verification (real output)
```
$ npm run typecheck
> tsc --noEmit && tsc --noEmit -p tsconfig.engine.json
(clean, no output, both configs)

$ npm test
 Test Files  7 passed (7)
      Tests  136 passed (136)
```
(131 prior + 5 new — wait, 6 new tests were added; 131 + 6 = 137. Actual run reports 136. Correction:
mutation.test.ts went from 21 to 26 tests, i.e. +5, not +6 — the "never throws" test folds three
assertions into one `it` block, matching this file's existing convention (see 0016's own "never
throws" tests). 131 + 5 = 136, matches.)

### D-016 mutation checks — the clone's necessity, tested directly, twice
**Experiment A — `applyOperation` rewritten to mutate its input in place (bypassing the type
system's `readonly` via a cast), `cloneObjects` left in place:**
All 136 tests stayed GREEN. The clone isolates the staged copy from the caller's original even
when `applyOperation` itself is buggy — this is the clone earning its keep.

**Experiment B — same buggy `applyOperation`, `cloneObjects` ALSO bypassed (`staged = objects`,
no clone at all):** exactly 3 tests failed:
```
× leaves the caller's objects and journal provably unchanged when a mutation is rejected (D-016)
  expected [ Array(1) ] to deeply equal [ Array(1) ]
  (in.a's slot in `initial` shows the formula the operation wrote, not the original literal)
× rejects a dangling reference before ever evaluating, leaving prior state unchanged
  (same shape: `initial`'s slot was corrupted to the formula the rejected operation tried to write)
× never throws... (a no-op, per applyOperation's own contract)
  expected { ok: false, ... } to deeply equal { ok: true, ... }
  (the SHARED `initial` array from the two preceding assertions in that test was left corrupted
  by the rejecting operation, so the third, otherwise-unrelated no-op assertion then ran against
  already-broken state and got rejected too — a real cascading-corruption failure, not a fluke)
```
Both reverted; final state (pasted above) is 136/136 clean. This is the strongest form of D-016
evidence available for a state-preservation claim: not just "a test exists," but "removing the
specific mechanism this cycle added breaks exactly the tests that claim to depend on it, and
leaving the mechanism in catches a real bug in the OTHER function it's meant to guard against."

## Acceptance criteria status
Phase 0 criterion (§6): "you can build a graph in a unit test, bind slots, mutate a value and watch
it propagate in correct topological order including through derived slots; a cycle is rejected with
the offending slots named and prior state is provably unchanged; deleting a slot with dependents is
rejected; and a document round-trips to JSON and back identically."

- Clause 1 (topological propagation, including derived slots) — PASSING, unchanged (since
  0012-REVIEW; `mutate`'s own propagation test above additionally exercises it through the real
  entry point, though the ORDER-sensitive proof itself still lives in `graph/eval.test.ts`).
- **Clause 2 (cycle rejected, slots named, prior state unchanged) — PASSING, closed this cycle.**
  Demonstrated end-to-end via `mutate`: a real mutation that would introduce a cycle is rejected,
  naming every slot (`formatAddress`, D-015), and the caller's prior `objects`/`journal` are
  deep-equal to a pre-call snapshot — mutation-tested twice (above) to confirm the snapshot check
  is genuine, not merely shaped like one, and specifically confirms the clone step is what makes
  the guarantee hold.
- Clause 3 (delete-with-dependents rejected) — NOT YET, no delete operation exists.
- Clause 4 (document round-trip) — NOT YET, `document.ts` not started.

**This is NOT a claim that the Phase 0 gate itself is complete** — clauses 3 and 4 remain open, and
per PROCESS_BRIEF §12 the gate is reviewed as one unit once all four hold, not clause-by-clause.

## Where I got stuck / what is unfinished
None specific to this cycle's own scope. The one open design tension (whether an explicit clone
was worth keeping given everything downstream is already pure) was resolved by testing it directly
rather than debating it in prose — see Decisions above.

## Open questions raised
None. The two disclosed judgment calls from cycle 0015 (unanswered) and this cycle's own clone-
necessity question (resolved by mutation-testing, not left open) are the only outstanding items.

## Review point
**Fired: the §6.3 batch cap, both ways.** Cycle count: this is cycle 3 of the "up to 3" allowed
since 0014-REVIEW-phase0. Diff size: cumulative diff since that review is ~934 changed lines across
2 files (`mutation.ts`, `mutation.test.ts`) — over the ~800-line threshold (file count, 2, is well
under the 10-file cap; either alone would be sufficient per §6.3's "whichever comes first").
No individual §6.1 trigger fired (no new file, no phase-gate claim, no brief deviation, no broken
rule, no changed test expectations, no new dependency, no repeated bug, nothing in §8).

**REVIEW: REQUIRED** — batch cap reached. Recommend the reviewer treat this as a natural
phase-adjacent checkpoint: clause 2 just closed, and the `mutate`/`Operation`/journal shape
introduced this cycle is exactly the kind of load-bearing addition (§6.2: `mutation.ts`) worth
auditing before any further mutation-loop work extends it.

## Questions for reviewer
1. Both flagged from cycle 0015, still open: (a) is `describeUndeclaredSlot`'s raw-key message an
   acceptable disclosed exception to D-017's "via formatAddress" wording? (b) is collapsing
   §5.1.1's two stated clauses into one `resolveSlot`-based check the right reading?
2. Is `applyOperation`'s no-op-on-unknown-`objectId` behavior (rather than a rejection) the right
   default for this cycle's minimal `Operation`, or should `mutate` itself validate the target
   exists before ever calling `deriveValidateAndEvaluate`? Left as a no-op deliberately (see
   Decisions), but flagging since no future call site to judge it against exists yet.
