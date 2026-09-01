# 0118 — D-110: a bare reference to an empty in-extent table cell reads as 0
Date: 2026-09-01   Phase: 5 (pre-Phase-5 slice; D-110)   Model: Claude Sonnet 5
Previous entry: 0117-refused-line-stays-in-the-input   Last review: 0116-REVIEW-phase4-gate (verdict: ACCEPT WITH EDITS)
Batch: cycle 2 of up to 3 since last review; this slice alone is 277 insertions / 12 deletions across
5 files — 0117 added a separate 82/2, so the batch total since 0116-REVIEW is ~359 lines / 6 files.

## Declared scope

**D-110 in full, all six clauses, plus D-111 clause 3's pin** — the human's Q-018 ruling: a bare
`ReferenceNode` naming an empty cell inside an EXISTING table's current extent evaluates to the
number `0` and gets no edge, instead of being a dangling reference `validateIntegrity` rejects.
Touches `mutation.ts`'s `deriveEdges` and `graph/eval.ts`'s `read` closure, plus a new shared
extent-test helper in `primitives/table.ts`. Not in scope: D-109 clauses 1-2 (cell decimals/clipping),
Q-017's headers, or any Phase 5 (text primitive) work.

## Explicitly not in scope

Ranges are untouched by design (D-110's own text: "Everything D-047 says about RANGES is untouched
and still stands") — `readRange` in `graph/eval.ts` and the range loop in `deriveEdges` are
unmodified. `command/commands.ts` needed no change: nothing there duplicates the dangling-reference
check for a cell specifically. Fix-list item 2 ("give the missing-slot refusal a remedy") is narrowed
by this ruling, not resolved by it — the message for what D-110 clause 6 still refuses is unchanged
and untouched here.

## What I did

**`src/engine/primitives/table.ts`** — new exported function `isInExtentTableCellAddress(address,
objects)`: true iff `address` is a well-formed cell address (`cellAddressToCoordinates`), names an
object that exists and is a `table`, and its coordinates fall within that table's current
`rows`/`cols` (via the same `getTableDimensions`/D-046 guard `enumerateRangeCellAddresses` already
uses — so a bare reference and a range can never disagree about a table's extent). Says nothing about
whether the cell has a slot; each caller asks that separately, against its own state. Imported
`TABLE_TYPE` from `graph/node.ts` for the type check. One line added to the file's IMPLEMENTS header
pointing at the function's own doc comment, rather than growing the (already over the 15-line prose
cap, pre-existing, not swept) `WHAT THIS IS` section.

**`src/engine/mutation.ts`** — `deriveEdges`'s reference-dependency branch: before pushing an edge for
a `ReferenceDependency`, checks `resolveSlot(dependency.address, objects) === undefined &&
isInExtentTableCellAddress(dependency.address, objects)`; if both hold, `continue`s (no edge) instead
of pushing one — the bare-reference mirror of the range loop's existing D-047 clause 1 check two
paragraphs below it. A cell that EXISTS (holding `null` included) still gets its edge unconditionally,
same as before — D-110 clause 2's "empty" reading is `graph/eval.ts`'s question at evaluation time,
not a question about whether the edge should exist. Updated the file header's paragraph describing
`ReferenceDependency` handling to state the new UNLESS clause, since the old wording ("becomes one
edge directly") was now false for this one case.

**`src/engine/graph/eval.ts`** — `evaluateFormula`'s `read: ReadSlot` closure: now reads
`evaluatedValues.get(...)` into a local, and if that value is `undefined` OR `null` AND the address is
an in-extent table cell (`isInExtentTableCellAddress(address, objects)`), returns `0` instead;
otherwise returns the value unchanged. This is the ONE place both "no slot" and "slot holding null"
converge before `formula/eval.ts` ever sees the address, which is what makes `= A2 + 1` and
`SUM(A2, 1)` on an empty `A2` both read the coerced `0` with no per-function special case (D-110
clause 3). Corrected the file header's own claim that "a plain `read` miss is unaffected and still
becomes `#REF`" — that was the accurate D-047-era statement and is now false for this one case.

**`src/engine/mutation.test.ts`** — replaced the one test D-110 flips (`D-047 item 4's boundary...`,
which asserted the REFUSAL) with a corrected D-047-boundary test naming an unknown OBJECT instead of
an in-extent empty cell (D-047's own boundary is still real, just no longer illustrated by a case
D-110 now legalises), and added a new describe block, `mutate — D-110: ...`, with eight tests: clause
1 (no slot at all, accepted, reads 0), clause 2 (existing `null` cell, reads 0), clause 3 twice
(arithmetic `A2 + 1` and the explicit-scalar-argument `SUM(A2, 1)`, both `1`), clause 4 (`deriveEdges`
emits no edge — asserted directly, mutation-checked), clause 6's extent boundary (a cell OUTSIDE the
extent still refuses), and clause 5 — the D-111 clause 3 pin: create a table where `A2` reads `A1`
(A1 empty, accepted, no false cycle), then `set A1 = A2` in a SECOND mutation, asserting REFUSAL
naming both `table_x.A1` and `table_x.A2`, and that the committed state from the first mutation is
`toEqual` its own pre-second-call snapshot (prior state bit-for-bit unchanged).

**`src/command/commands.test.ts`** — flipped the one failing command-layer test (`refuses a reference
to a cell that HAS no slot...`) to assert acceptance and `0`, kept its companion range assertion
unchanged, and added a sibling test pinning D-110 clause 6's boundary at the command layer (a
reference past the table's extent still refuses). Added a further test in the `refs` describe block
pinning D-110's own disclosed consequence: `refs table_1.D4` reports nothing while a formula
elsewhere reads the still-empty `D4`, and reports the dependent once `D4` is populated — demonstrating
that the edge (and therefore the report) appears on its own at the populating mutation, with no code
anywhere that "remembers" to add it.

## Decisions I made

1. **The shared extent-test lives in `primitives/table.ts`, not duplicated in `mutation.ts` and
   `graph/eval.ts`.** Both call sites need "is this an in-extent table cell," and the file's own
   header already states the principle for the range case ("the SAME computation... structurally
   impossible for evaluation and edge derivation to disagree") — extending it to the single-cell case
   was the only reading consistent with that stance.
2. **The "no slot" and "holds null" checks stay split across two files.** `deriveEdges` only asks "no
   slot" (existence is a `mutation.ts`-time, object-list question); `graph/eval.ts`'s `read` closure
   asks "undefined or null" (both are evaluation-time answers about what a pass actually resolved). A
   cell holding `null` gets a real edge and is evaluated normally to `null`; only the READ of that
   value is coerced to `0`. Tried keeping both checks in one place first and it did not fit either
   file's existing responsibility split — `deriveEdges` has no `evaluatedValues` map to ask "is the
   resolved value null," and `graph/eval.ts`'s `read` closure has no reason to also decide whether an
   edge should exist, since edges are already fixed by the time evaluation runs.
3. **`isInExtentTableCellAddress` checks `tableObject.type === TABLE_TYPE`**, even though only `table`
   currently declares a `cells.*` path family and the check is therefore not yet load-bearing against
   any reachable input. Matches D-110's own wording ("a cell of an EXISTING table") literally, and
   costs one comparison against an already-resolved object.

## Verification (real output)

```
$ npx tsc --noEmit -p tsconfig.json
(clean, no output)
$ npx tsc --noEmit -p tsconfig.engine.json
(clean, no output)
```

```
$ npx vitest run
 Test Files  27 passed (27)
      Tests  1285 passed (1285)
```

`grep -rnE "\.(only|skip|todo)\(" src/` → nothing.

**Mutation check, both engine changes, independently:**

1. Neutralised `deriveEdges`'s new guard (`if (false && ...)`) — 6 of the 8 new D-110 tests in
   `mutation.test.ts` went red (the two clause-6 "still refused" tests correctly stayed green, since
   they never depended on the guard): `expected true to be false` on every acceptance assertion, and
   `deriveEdges`'s own edge-set assertion showed the edge reappearing. Reverted; suite green after.
2. Neutralised `graph/eval.ts`'s `read` closure's `0`-substitution the same way — the same 6 tests
   went red again, this time showing the VALUE was wrong (`#REF`/`null` instead of `0`/`1`) rather
   than the mutation being refused, confirming this is a genuinely separate load-bearing line from
   check 1's. Reverted; suite green after (output above is post-revert, final state).

## Acceptance criteria status

Not a phase acceptance criterion — a `DECISIONS.md` ruling (D-110) with its own `REVIEW: REQUIRED`
instruction, and D-111 clause 3's pin on top of it. Demonstrated by the tests above; D-111 clause 3's
specific requirement (accept-while-empty, reject-once-populated, prior state unchanged) is the last
test in the new `mutation.test.ts` describe block, named for exactly that.

## Where I got stuck / what is unfinished

Nothing got stuck. `STATUS.md`'s fix-list item 2 narrows exactly as D-110's own text says it would —
no code change needed there, just the disclosure below. D-109 clauses 1-2 remain the next thing after
this, per 0116-REVIEW's own ordering.

## Open questions raised

None. Q-018 was already answered → D-110 before this cycle; nothing here reopens it.

## Review point

Fired: **§6.1 trigger 3-adjacent — this is a ruling (D-110) whose own text says "this is a
`REVIEW: REQUIRED` slice... it MUST NOT be taken as a provisional guess or folded into an unrelated
cycle," and D-111 clause 3 binds this same cycle to pin clause 5 executably (done, see above).**
`mutation.ts` and `graph/eval.ts` are both explicitly load-bearing (§6.2). Cycles since last review:
2/3. Diff since last review (0117 + 0118 combined): ~359 lines / 6 files (cap 800/10) — under the cap,
but the trigger here is the ruling's own instruction, not the batch cap.

REVIEW: REQUIRED
Reason: D-110's own ruling text mandates review before this cycle's changes are treated as settled,
independent of whether §6.1's numbered triggers or the §6.3 cap would otherwise have forced one; and
per 0116-REVIEW §10, no later phase (Phase 5's text primitive, which will become a second consumer of
what a reference means) may begin while this load-bearing change sits unreviewed.
Questions for reviewer:
  1. Is `isInExtentTableCellAddress`'s `tableObject.type === TABLE_TYPE` check the right call, or
     should it be dropped as unreachable dead weight until a second `cells.*`-shaped type exists?
  2. Does D-110 clause 5's pin (the last test in the new mutation.test.ts block) actually demonstrate
     what D-111 clause 3 asked for, or does it want a command-line-level version too (via `submitLine`
     in `main.test.ts`, mirroring the Phase 4 gate's own style) rather than a `mutate`-level one?
