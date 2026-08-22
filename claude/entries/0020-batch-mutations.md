# 0020 — batch-mutations
Date: 2026-08-22   Phase: 0   Model: implementer (Claude Sonnet 5)
Previous entry: 0019-close-d018-d019-d021
Last review: 0018-REVIEW-phase0 (verdict: REVISE — fixes 1-4 closed at 0019, fix 5 this entry)
Batch: cycle 2 of up to 3 since 0018-REVIEW-phase0; cumulative diff since that review, measured
directly (`git diff --numstat 9392a97`, not summed per-cycle) over `mutation.ts`/`mutation.test.ts`/
`graph/eval.test.ts`: 769 changed lines / 3 files — under the 800/10 cap, but see Review point below
for why this cycle ends here regardless.

## Declared scope
0018-REVIEW-phase0's REVISE fix 5 (the last item on that list): **D-020**, the batch mutation form.
Widen `mutate` to accept a **list** of `Operation`s, applied to a single clone, validated and
evaluated once, committing all-or-nothing, appending exactly **one** `MutationJournalEntry` holding
the whole list — per §5.1's "Batch mutations (required)" subsection and D-020's own ruling. Widen
the existing entry point; do not add a second one (Q-005's precedent).

## Explicitly not in scope
- `document.ts` / clause 4 — the very next slice, but 0018-REVIEW-phase0 was explicit: "end that
  cycle and hand it back" after fix 5, since it changes the only mutation entry point's signature.
  Not starting it here.
- Any operation kind beyond `SetSlotOperation` (object creation, in particular) — still out of
  Phase 0's scope; the batch form widens HOW MANY operations `mutate` takes, not WHAT KINDS exist.
- Re-answering Q-006 — untouched by this cycle.

## What I did
- `src/engine/mutation.ts`:
  - `MutationJournalEntry.operation: Operation` → `MutationJournalEntry.operations: readonly
    Operation[]` — one journal entry now holds the WHOLE committed batch, per D-020's own wording
    ("one committed batch is one journal entry").
  - `mutate(objects, operation, journal)` → `mutate(objects, operations, journal)`. New signature,
    same function (no second entry point). New checks, both run before staging, over the ORIGINAL
    `objects`:
    - **Empty batch** (`operations.length === 0`) is rejected outright — same "no false record in
      the journal" reasoning D-021 already established for a no-op single operation.
    - **D-021, widened**: every operation in the list is checked for a missing target; if ANY are
      missing, the WHOLE batch is rejected (all-or-nothing), naming EVERY offending operation (not
      just the first) via the same "; "-joined multi-problem style `validateIntegrity`'s checks
      already use.
  - Apply step: `operations.reduce((current, operation) => applyOperation(current, operation),
    staged)` — folds every operation over the SAME staged clone, left to right, so a later
    operation sees an earlier one's effect. `deriveValidateAndEvaluate` is still called exactly
    ONCE, over the fully-folded candidate.
  - Updated the file header throughout (top paragraph, IMPLEMENTS — added §5.1's "Batch mutations
    (required)" subsection, `mutate`'s WHAT THIS IS/INVARIANTS, `applyOperation`'s doc comment, NOT
    DONE HERE — removed the now-closed "batch mutation form" bullet) to describe the widened
    signature and D-020's closure.
- `src/engine/mutation.test.ts`:
  - Updated every existing `mutate(...)` call site (10 of them) to pass a one-element array instead
    of a bare `Operation`, and both `journal`-shape assertions to `{ operations: [operation] }`.
  - Added a `mutate — D-020` describe block, 5 tests: (1) two operations on two different slots
    both take effect in ONE evaluation pass, with exactly one journal entry holding both; (2) two
    operations on the SAME slot — last write wins (see Decisions below for what this test does and
    does NOT prove); (3) all-or-nothing: one fine operation plus one cycle-introducing operation in
    the same batch rejects the WHOLE batch, prior state unchanged; (4) an empty batch is rejected
    outright; (5) D-021 across a batch — multiple operations with missing targets are ALL named in
    one rejection message, not just the first.

## Decisions I made
- **The apply step folds with a plain `Array.reduce`, not a hand-rolled loop.** Rule 5 asks for the
  dumbest correct implementation; `reduce` over `operations` accumulating the evolving `GraphObject[]`
  IS that, and it's the same idiom this file already uses nowhere else only because there was never
  more than one operation to fold before now — no new abstraction introduced.
- **D-021's check gathers EVERY offending operation's message, not just the first.** Consistent with
  `validateIntegrity`'s own checks (which join multiple problems with `"; "`), and more useful for
  a batch specifically: a document load with several bad references benefits from seeing all of them
  at once rather than fixing one, reloading, hitting the next.
- **Empty-batch rejection uses the same reasoning as D-021's no-op rejection, not a new principle.**
  A committed batch that changed nothing is, like a no-op single operation, a false record if
  journalled — so it gets the same treatment (reject before staging) rather than silently accepting
  and appending an empty-operations journal entry.
- **The "last write wins" test does NOT, on its own, prove the shared-clone-fold claim** — caught
  this via mutation-testing (see below) after writing it with a comment that overclaimed what it
  showed. Rewrote its comment once the neutralization confirmed which test actually carries that
  weight (the two-different-slots test), rather than leaving a claim in a test's own comment that
  isn't backed by what the test can actually distinguish — precisely the "plausible but untested
  claim" shape 0018-REVIEW-phase0's finding 1 (the `dependentSlot` doc comment) already flagged as
  this project's own recurring failure mode. Caught here before it shipped, not after.

## Verification (real output)
```
$ npm run typecheck
> tsc --noEmit && tsc --noEmit -p tsconfig.engine.json
(clean, no output, both configs)

$ npm test
 Test Files  7 passed (7)
      Tests  148 passed (148)
```
(143 prior + 5 new D-020 tests = 148. Matches.)

### D-016 mutation checks — three, one per new mechanism
Each experiment: neutralize exactly one mechanism, confirm the specific test(s) that depend on it
fail and nothing else does, revert, confirm 148/148 again. All three reverted; confirmed via
`grep -rn "MUTATION-TEST" src/engine/` → no matches.

1. **Empty-batch check** (`operations.length === 0` short-circuited off via `if (false && ...)`):
   exactly 1 test failed — "rejects an empty batch outright..."
2. **Cross-batch D-021 check** (the `.filter` predicate short-circuited to never match): exactly 2
   tests failed — the pre-existing single-operation D-021 test (now calling `mutate` with a
   one-element array) AND the new "rejects the whole batch, naming EVERY operation with a
   nonexistent target" test. Both, and only both, depend on this line.
3. **Shared-clone fold** (each operation applied to a FRESH `cloneObjects(objects)` instead of the
   accumulator, simulating N independent clones): exactly 1 test failed — "applies every operation
   in the batch to the SAME clone... (30 = 10 + 20)" — with `value: 23` instead of `value: 30` (only
   the LAST operation's effect on a pristine clone, confirming the accumulator was genuinely
   discarded). Notably, the "last write wins" test (both operations targeting the SAME slot) stayed
   GREEN under this same neutralization — because collapsing to "only the last operation's effect
   survives" is indistinguishable from correct fold behaviour when every operation targets the same
   address. This is real, useful evidence about what that test does and doesn't prove (see
   Decisions above): it was mutation-tested BEFOREHAND, specifically to check the claim its own
   comment made, and the claim was found wrong before commit — comment corrected in place.

## Acceptance criteria status
No clause changes (unchanged from 0019: clauses 1-2 PASSING, clauses 3-4 NOT YET). This cycle closes
D-020, the last of 0018-REVIEW-phase0's five fixes — a precondition for `document.ts` (clause 4),
not itself a clause claim.

## Where I got stuck / what is unfinished
Nothing left in this cycle's declared scope. Caught and fixed one test-comment overclaim before
finalizing (see Decisions) — worth flagging explicitly since it's the same failure shape this
project's last review found, caught this time by the process working as intended.

## Open questions raised
None.

## Review point
**REVIEW: REQUIRED** — not because a numeric cap fired (cumulative diff since 0018-REVIEW-phase0 is
769 lines / 3 files, both under the 800/10 threshold), but because 0018-REVIEW-phase0 gave an
EXPLICIT instruction for this specific fix: "Item 5 changes the signature of the project's only
mutation entry point; end that cycle and hand it back." Honoring that instruction over the numeric
caps, which have not yet forced a stop on their own. `document.ts` (clause 4) does not start until
this lands — D-018 (closed) and D-020 (closed here) were both named as its preconditions.

## Questions for reviewer
None new.
