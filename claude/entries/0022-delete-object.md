# 0022 — delete-object
Date: 2026-08-22   Phase: 0   Model: implementer (Claude Sonnet 5)
Previous entry: 0021-REVIEW-phase0 (verdict: ACCEPT WITH EDITS — `document.ts` may begin)
Batch: cycle 1 of up to 3 since 0021-REVIEW-phase0; cumulative diff, measured directly
(`git diff --numstat 1c7c621 -- src/`): 338 changed lines / 2 files (`mutation.ts`, `mutation.test.ts`)
— under the 800/10 cap.

## Declared scope
0021-REVIEW-phase0 named two ways to spend the next cycle: `document.ts` (clause 4) or a
delete-with-dependents `Operation` variant (clause 3), "either order works; clause 3's is the
cheaper cycle." I chose clause 3, for one additional reason beyond cost: `document.ts`'s round-trip
test cannot be written honestly until Q-006 is answered, and Q-006 is explicitly **not mine to
settle** — OPEN_QUESTIONS.md's own recommendation says it "wants the human's product call, not an
implementer's." Clause 3 has no such block.

Scope: add `DeleteObjectOperation` (§5.1.1's `delete <object>`) to `mutate`'s operation union, close
Phase 0 acceptance clause 3 ("deleting a slot with dependents is rejected"), and — per 0021-REVIEW's
carried constraint 1 — fix the target-existence check's pre-batch-only assumption, since deletion is
the first operation kind able to shrink the object set mid-batch.

## Explicitly not in scope
- `document.ts` / clause 4 — blocked on Q-006, not this cycle's call to make.
- Any OTHER new operation kind (object creation in particular, `explode`, vertex add/remove, table
  resize) — this cycle adds exactly one variant.
- The §5.1.1 REPAIR path (rewriting inbound references to `#REF`) — Phase 0 has no type that needs
  it (only table row/column deletion does, Phase 2/4); the dangling-reference check's existing
  Reject branch is Phase 0's only path, unchanged.
- Re-answering Q-006 — untouched by this cycle.

## What I did
- `src/engine/mutation.ts`:
  - Added `DeleteObjectOperation { kind: "deleteObject"; objectId: string }`. `Operation` widened to
    `SetSlotOperation | DeleteObjectOperation` — the same "widen the union, never restructure" stance
    Q-005/D-020 already established.
  - `applyOperation` now branches on `operation.kind`: `deleteObject` uses `.filter` to remove the
    named object from the candidate array (shrinking it, unlike `setSlot`'s `.map`, which always
    keeps the same length).
  - **The carried forward-hazard fix (0021-REVIEW's constraint 1).** The pre-batch existence check
    (D-021/D-023) used to test each operation's target against the ORIGINAL `objects` once, up
    front — sound only because `SetSlotOperation` alone could never add or remove an object. That
    stopped being true the moment `DeleteObjectOperation` existed: a later operation in a batch can
    now target an object an EARLIER operation in the SAME batch already deleted, and the original
    `objects` array can't show that. Fixed by simulating the fold's effect on object EXISTENCE ONLY
    — a plain `Set<id>` seeded from `objects`, walked in operation order, with `deleteObject`
    removing an id the moment a VALID deletion for it is seen — rather than checking once against a
    static snapshot. This still gathers EVERY offending operation in one pass (0020's own multi-
    problem-in-one-message design, preserved), because tracking existence doesn't require actually
    knowing whether an earlier operation was itself valid — only whether its target id was in the
    set at that point.
  - Both operation kinds' missing-target messages are now built by kind: `setSlot` keeps 0021-
    REVIEW's D-023 wording (names the slot path); `deleteObject` has no slot path to name, so it
    says plainly it "attempts to delete object id ..., which does not exist."
  - Removed the now-unused `findObjectById` import (the existence check no longer calls it directly
    — the `Set` simulation subsumes it).
  - Updated the file header throughout (top paragraph, IMPLEMENTS, `mutate`'s WHAT THIS IS/
    INVARIANTS, `applyOperation`'s doc comment, NOT DONE HERE) to describe both changes and note,
    for whichever slice adds `CreateObjectOperation` next, that the existence check is already
    fold-aware — a creation variant needs to ADD an id to the same simulated `Set`, not invent a
    second mechanism.
- `src/engine/mutation.test.ts`: added one `describe` block, 7 tests:
  1. Deletes an object with no dependents; removed from the result; one journal entry.
  2. **Clause 3 itself**: rejects deleting an object a formula elsewhere still depends on, naming
     the dependent via the EXISTING dangling-reference check (no new rejection mechanism — see
     Decisions below), prior state unchanged (D-016).
  3. Accepts deleting an object and its only dependent TOGETHER in one batch (no dangling edge
     results, since the dependent is gone too).
  4. Rejects deleting an object that does not exist, naming the id as an id (D-021/D-023's style,
     `deleteObject` variant).
  5. **The fold-aware check's own test**: rejects a batch where an earlier `deleteObject` removes an
     object a LATER operation in the SAME batch still targets — the exact scenario the pre-batch-only
     check would have missed.
  6. Rejects a batch that deletes the SAME object twice, blaming only the second occurrence.
  7. Accepts a batch that deletes one object and mutates an unrelated one together, one journal entry.

## Decisions I made
- **No new rejection mechanism for clause 3.** `validateIntegrity`'s existing dangling-reference
  check (§5.1.1, unchanged since cycle 0015) already does the job: `deriveEdges`/`validateIntegrity`
  run over the POST-delete candidate, so an edge whose `sourceSlot` pointed at the now-gone object's
  slot simply fails to resolve — the same check that already rejects a typo'd formula reference.
  STATUS.md said as much going in ("validateIntegrity's dangling check is already the mechanism");
  this cycle's job was purely to give `mutate` an operation that can PRODUCE that shape, not to add
  a new check. Test 2 above is what confirms this — it asserts the message names `add_1.in.a`,
  the dangling-reference check's own naming style, not just "some rejection happened."
- **The existence check simulates a `Set<id>`, not a real fold.** Considered actually running
  `applyOperation` speculatively per operation and checking length/membership after each step, but
  that would mean doing real (wasted, discarded) work before knowing the batch is even valid, and
  `applyOperation`'s `setSlot` branch has no failure mode to check anyway (only `deleteObject`
  changes object EXISTENCE, which is all this check is about). A `Set<id>` mutated only by
  `deleteObject` is Rule 5's dumbest correct implementation of "track which ids exist as the batch
  would actually apply them," cheaper than the real thing and provably equivalent for the one
  question this check asks.
- **Kept collecting EVERY offending operation, not stopping at the first.** The simulation makes
  this free — unlike a real fold, tracking existence doesn't need to know whether an earlier
  operation in the batch was itself accepted, so there was no correctness reason to change 0020's
  "name every offending operation" design when fixing the fold-awareness gap. Confirmed by test 6
  (double-delete): only the SECOND occurrence is blamed, since the first one legitimately shrinks
  the simulated set before the second is checked.

## Verification (real output)
```
$ npm run typecheck
> tsc --noEmit && tsc --noEmit -p tsconfig.engine.json
(clean, no output, both configs)

$ npm test
 Test Files  7 passed (7)
      Tests  157 passed (157)
```
(150 prior + 7 new tests = 157. Matches.)

### D-016 mutation checks — three, one per new mechanism
Each experiment: neutralize exactly one mechanism, confirm the specific test(s) that depend on it
fail and nothing else does, revert, confirm 157/157 again. All three reverted; confirmed via
`grep -rn "MUTATION-TEST" src/engine/` → no matches.

1. **`applyOperation`'s `deleteObject` filter** (replaced with `objects.filter(() => true)`, a no-op):
   exactly 4 tests failed — "deletes an object with no dependents..." (no longer removed), "rejects
   deleting an object a formula elsewhere still depends on..." (no longer rejected, since the object
   was never actually removed — confirms this test genuinely needs the deletion to happen, not just
   validateIntegrity's pre-existing check to exist), "accepts deleting an object whose ONLY
   dependent is being deleted..." (neither object removed), and "accepts a batch that deletes one
   and mutates an unrelated one..." (the deleted object still present). The other three new tests
   (which only exercise the pre-staging existence check, never reaching the real fold) stayed green
   — precise, not coincidental.
2. **The fold-aware `Set` decrement** (`survivingIds.delete(targetId)` gated behind `if (false && ...)`,
   so a `deleteObject` never shrinks the simulated set): exactly 2 tests failed — "rejects the WHOLE
   batch when an EARLIER operation deletes an object a LATER operation... still targets" and
   "rejects a batch that deletes the SAME object twice..." — both `ok:true` instead of `false`. Both,
   and only both, exercise the id actually leaving the simulated set mid-batch.
3. **The `deleteObject`-branch message text** (gated its condition behind `if (false && ...)`, forcing
   every missing-target message through the `setSlot`-style wording regardless of variant): exactly 1
   test failed — "rejects deleting an object that does not exist, naming the id as an id" — message
   read `targets slot "??" on object id "obj_404"...` instead of `attempts to delete object id
   "obj_404"...`.

## Acceptance criteria status
**Clause 3 now PASSING** — "deleting a slot with dependents is rejected," demonstrated end-to-end
through the real `mutate` entry point (test 2 above), mutation-tested (experiment 1, which shows the
rejection depends on the deletion actually happening, not on some unrelated coincidence). Clauses
1-2 unchanged (PASSING since 0017/0018-REVIEW). Clause 4 unchanged (NOT YET — blocked on Q-006).
**3 of 4 clauses now closed.**

## Where I got stuck / what is unfinished
Nothing in this cycle's own declared scope. The natural next slice, `document.ts` (clause 4), remains
blocked on Q-006, which OPEN_QUESTIONS.md itself says is not an implementer's call. I am stopping
here rather than guessing at Q-006 to unblock it myself.

## Open questions raised
None new. Q-006 remains open, unchanged by this cycle — deleting an object has nothing to do with
non-finite numbers.

## Review point
Fired: none — no §6.1 trigger (no new file, clause 3 alone is not the phase gate — STATUS.md is
explicit the gate is reviewed as one unit once all four clauses close — no brief deviation, no
changed test expectation, no new dependency, no repeated bug). Batching: cycle 1 of up to 3 since
0021-REVIEW-phase0, diff 338 lines / 2 files (cap 800/10) — well under cap on both counts.
**REVIEW: NOT NEEDED** for this cycle's own work. However, the project is now stopped on something a
review point wouldn't fix: **Q-006 needs the reviewer's/human's answer before `document.ts` can
begin** — this is the one remaining thing blocking Phase 0's last clause, and it is explicitly not
an implementer's call per OPEN_QUESTIONS.md's own text.

## Questions for reviewer
- **Q-006** (carried, not new): is a non-finite number (`NaN`/`±Infinity`) legal document state?
  Recommendation on file is (b) — illegal, reject non-finite literals, map non-finite compute
  results to `#TYPE`. Answering this (or explicitly declining to and authorizing a provisional
  choice) is what unblocks `document.ts`.
