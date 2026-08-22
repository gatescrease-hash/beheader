# 0016 — wire-mutation-sequence
Date: 2026-08-22   Phase: 0   Model: implementer (Claude Sonnet 5)
Previous entry: 0015-validate-integrity   Last review: 0014-REVIEW-phase0 (verdict: ACCEPT WITH EDITS)
Batch: cycle 2 of up to 3 since last review; ~620 lines / 2 files changed so far (`mutation.ts`,
`mutation.test.ts`; this cycle's own share: 124/8 and 109/1 respectively).

## Declared scope
Per STATUS.md's "Next slice (recommended)": wire the four already-built Phase 0 pieces into one
sequence in `mutation.ts` — `deriveEdges` (step 3) → `validateIntegrity` (step 4, reject/stop) →
`detectCycle` (step 5, reject/stop, format via `formatAddress` per D-015) → `evaluate` (step 7).
Not building stage/clone/apply/commit/journal (§5.1 steps 1, 2, 6, 8) — those remain a later slice.

## Explicitly not in scope
- The clone/stage step (§5.1 step 1) and any real mutation "operation" shape (`setLiteral`,
  `link`, object creation) — this function still only takes a candidate `objects` list, it does not
  produce one.
- Claiming Phase 0 acceptance clause 2 as PASSING. D-016's "prior state provably unchanged" needs a
  pre-mutation snapshot, which needs step 1 to exist first — noted as NOT YET below, same as
  STATUS.md already said before this cycle.

## What I did
- `src/engine/mutation.ts` — added `deriveValidateAndEvaluate(objects)`, exported alongside a new
  `GraphEvaluationResult` type (`{ ok: true, objects }` or `{ ok: false, message }`). Composes the
  four steps in the fixed order above, short-circuiting on the first rejection. Added a private
  `formatCycleRejection(cycle, objects)` helper that turns `detectCycle`'s `Address[]` into a
  human-readable, closed-loop chain via `formatAddress` (never `addressKey`, D-015), handling
  `AddressError` defensively even though it should be unreachable here (every address in a reported
  cycle already passed `validateIntegrity`'s dangling-reference check). Updated the file header's
  top paragraph, `IMPLEMENTS`, `WHAT THIS IS`, and `NOT DONE HERE` sections to describe the new
  function and narrow "NOT DONE HERE" to just steps 1, 2, 6, 8 (previously it also listed
  acyclicity-validation and evaluation as unwired, which is no longer true).
- `src/engine/mutation.test.ts` — added a new describe block, 5 tests:
  1. The §6 fixture's two-hop chain evaluates correctly end-to-end through the composed function.
  2. A genuine self-cycle (`add_1.in.a` reads its own `out.result`) is rejected before `evaluate`
     runs, with both slots named in the message.
  3. A document with BOTH an undeclared slot (D-017) AND an unrelated, fully-derivable genuine
     cycle is rejected with ONLY the D-017 message — proving `validateIntegrity` runs before
     `detectCycle` end-to-end, not just at each function's own unit level.
  4. A dangling reference is rejected before `evaluate` runs.
  5. Never throws, for a well-formed document, a rejected one, and an empty one; empty input
     round-trips to `{ ok: true, objects: [] }`.

## Decisions I made
- **Function name/shape**: `deriveValidateAndEvaluate` / `GraphEvaluationResult`, deliberately NOT
  named anything implying it is "the mutation" or a `recompute()` (PROCESS_BRIEF §9 forbids that
  word for a reason unrelated to this function, but it's still worth avoiding the collision). It
  composes exactly steps 3-5 and 7; steps 1/2/6/8 are absent by name, not just by omission.
- **Cycle-rejection message format**: `cyclic dependency: <slot> → <slot> → ... → <first slot again>`
  — closes the loop explicitly rather than printing an open list, since §5.1's own wording is "the
  offending slots" (plural, implying the cycle itself, not just a set).
- **My first test fixture for "order matters" was wrong, and I caught it before finalizing.** I
  initially reused the existing "KNOWN GAP" 3-slot fixture (`in.c -> in.a -> out.result -> in.c`,
  cycling only through an undeclared slot) to test that `validateIntegrity` runs before
  `detectCycle`. Mutation-testing it (swapping the two steps' order) left ALL tests green — because
  that fixture's missing edge (`out.result -> in.c`, never derived since `in.c` isn't
  schema-declared) means `detectCycle` can **never** see a cycle there, in EITHER order (removing an
  edge cannot manufacture a false-positive cycle elsewhere). The order genuinely doesn't matter for
  that fixture's accept/reject outcome — only for which of two SIMULTANEOUS, INDEPENDENT problems
  gets reported. I replaced it with a fixture that actually has both: an undeclared slot (`in.c`)
  AND a separate, fully-schema-declared self-cycle (`in.a` reads its own `out.result`) on the same
  object — `detectCycle` genuinely CAN see this second one on its own. Re-mutation-tested: swapping
  the order now fails exactly this one test, reporting `"cyclic dependency: ..."` instead of
  `"add_1.in.c"` (pasted below). Kept a note of this in the test's own comment so a future model
  doesn't repeat the mistake or assume the fixture was always right.

## Verification (real output)
```
$ npm run typecheck
> tsc --noEmit && tsc --noEmit -p tsconfig.engine.json
(clean, no output, both configs)

$ npm test
 Test Files  7 passed (7)
      Tests  131 passed (131)
```
(126 prior + 5 new.)

### D-016 mutation checks
1. **detectCycle short-circuited off** (`if (false && cycleCheck.hasCycle)`): exactly 1 test failed
   — "rejects a genuine cycle (in.a reads its own out.result) before evaluate ever runs..." — with
   `expected true to be false` on `result.ok`. All 130 others stayed green. Reverted.
2. **Order swapped** (`detectCycle` called before `validateIntegrity`): exactly 1 test failed —
   "runs validateIntegrity before detectCycle: when a document has BOTH an undeclared slot AND an
   unrelated genuine cycle..." — with:
   ```
   AssertionError: expected 'cyclic dependency: add_1.in.a → add_1…' to contain 'add_1.in.c'
   Expected: "add_1.in.c"
   Received: "cyclic dependency: add_1.in.a → add_1.out.result → add_1.in.a"
   ```
   All 130 others stayed green. Reverted. Both checks confirm the tests actually pin the behaviour
   they claim to, not just their return shape.

## Acceptance criteria status
Phase 0 criterion (§6): "you can build a graph in a unit test, bind slots, mutate a value and watch
it propagate in correct topological order including through derived slots; a cycle is rejected with
the offending slots named and prior state is provably unchanged; deleting a slot with dependents is
rejected; and a document round-trips to JSON and back identically."

- Clause 1 (topological propagation) — PASSING, unchanged from STATUS.md (since 0012-REVIEW).
- Clause 2 (cycle rejected, slots named, prior state unchanged) — **still NOT YET, but now
  partially demonstrable.** The "cycle rejected, offending slots named" half is now shown
  end-to-end by this cycle's tests (2 and 3 above), through the real composed entry point rather
  than by calling `detectCycle` directly. The "prior state provably unchanged" half is still
  undemonstrated: `deriveValidateAndEvaluate` never mutates its input (every function it calls is
  pure and returns new data — true by construction and by TypeScript's `readonly` annotations), but
  per D-016 that is not the same as a mutation-tested snapshot-comparison proving it, and no such
  snapshot can exist meaningfully until step 1 (stage/clone) is built. Do not report this clause as
  PASSING yet.
- Clause 3 (delete-with-dependents rejected) — NOT YET, no delete operation exists.
- Clause 4 (document round-trip) — NOT YET, `document.ts` not started.

## Where I got stuck / what is unfinished
The "order matters" test took two attempts to get right (see Decisions above) — the first fixture
I wrote was plausible-looking but didn't actually exercise the thing its name claimed, and only
the mutation-test check caught it. Recording this because it's exactly the kind of thing D-016
exists to catch, and I nearly shipped it without running the check.

## Open questions raised
None. The two questions 0015 raised for the reviewer (`describeUndeclaredSlot` vs. `formatAddress`;
collapsing §5.1.1's two clauses into one check) are untouched by this cycle — still awaiting the
reviewer, not re-litigated here.

## Review point
Fired: none — no §6.1 trigger. This IS ongoing work on a load-bearing file (`mutation.ts`), which
§6.2 says does not by itself force an immediate stop; no phase gate is being claimed. Batching per
the Manager's 2026-08-22 cadence change: cycle 2 of up to 3 since 0014-REVIEW-phase0, diff since
that review ~620 lines / 2 files (cap 800/10) — under cap on both counts.
