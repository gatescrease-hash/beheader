# 0101 — the vanishing table: a dimension write is bounded, not only a resize
Date: 2026-08-28   Phase: 4   Model: Claude Sonnet 5
Previous entry: 0100-REVIEW-phase4   Last review: 0100-REVIEW-phase4 (verdict: ACCEPT)
Batch: cycle 1 of up to 3 since last review; 353 insertions / 33 deletions across 5 files so far.

## Declared scope

Build D-097 exactly as ruled: `mutation.ts` gains `findInvalidDimensionWrites`, rejecting any
`setSlot` that would leave `table`'s `rows`/`cols` in a state `readTableDimension` cannot read
(non-`literal`, non-number, non-integer, or outside `MIN_TABLE_LINES..MAX_TABLE_LINES`).
`MIN_TABLE_LINES`/`MAX_TABLE_LINES` move from `command/commands.ts` to
`engine/primitives/table.ts` per clause 3, and `commands.ts` imports them from there. Not in
scope: D-098, D-099, D-100–D-103, or anything else on STATUS.md's queue.

## Explicitly not in scope

D-102's future panel write path (the ruling only requires this gate live in `mutation.ts` so that
path inherits it for free later — nothing to build now). The known "coherence" gap where a raw
`setSlot` lowering `rows`/`cols` strands an out-of-bounds cell slot rather than removing it —
D-097 does not ask for that and I did not add it (disclosed in `table.ts`'s header instead).

## What I did

- **`src/engine/primitives/table.ts`** — added `export const MIN_TABLE_LINES = 1` and
  `MAX_TABLE_LINES = 1000`, moved verbatim from `command/commands.ts` (D-097 clause 3: `engine/`
  may not import `command/`, and `mutation.ts`'s new check needs them beside the primitive they
  describe). Updated the file header's `NOT DONE HERE` bullet: the old "a raw `setSlot` writing an
  incoherent literal count is unguarded" is now narrower — the KIND/RANGE half is closed by D-097,
  only the "stranded cell beyond a lowered extent" half remains, and it's disclosed as ordinary
  D-047 empty state, not a defect. §5.4/§5.10, D-097.
- **`src/engine/mutation.ts`** — implements PROJECT_BRIEF §5.1's rejection contract for D-097:
  - `findInvalidDimensionWrites(operations, objects)`: a sixth pre-staging precondition,
    simulated left-to-right exactly like `findInvalidTableResizes`/`findInvalidRenames` (a
    `createObject` earlier in the same batch can mint the table a later `setSlot` then targets).
    Tracks only object TYPE per id (not a running row/col count — this check bounds one write's
    own payload, nothing cumulative). Checks only an address that is EXACTLY
    `TABLE_ROWS_PATH`/`TABLE_COLS_PATH` on an object already known to be `"table"`-typed, so an
    unrelated object's own undeclared literal slot named `rows` is left alone (D-017's "literal
    slots are not checked" stance).
  - `dimensionPathName`, `describeDimensionWriteProblem`, `describeDimensionSlotValue` — small
    helpers; the last one is deliberately NOT a reuse of the existing `describeIllegalValue`
    (scoped by its own doc comment to values `hasIllegalNumber` already flagged — a dimension
    write is far more often an ordinary out-of-range number, a string, or a boolean).
  - Wired into `mutate` right after `findInvalidTableResizes`, before `findInvalidRenames`.
  - Updated the file header's precondition count (FIVE → SIX) and the "FOURTH and FIFTH check"
    paragraph (→ FOURTH/FIFTH/SIXTH) to name the new check in its fixed place, per §5's present-
    tense header rule.
- **`src/command/commands.ts`** — imports `MAX_TABLE_LINES`/`MIN_TABLE_LINES` from
  `../engine/primitives/table.ts` instead of declaring them; `createTable`'s creation-time bound
  is otherwise untouched. Updated the module header's D-070 bullet and the section comment above
  the (now single) `MAX_POLYGON_SIDES` constant to say where the table bounds live and why.
- **`src/command/commands.test.ts`** — moved its `MAX_TABLE_LINES` import to
  `../engine/primitives/table.ts` (mechanical, following the constant); added a new describe
  block reproducing 0100-REVIEW's own four-row repro table end to end through the real `set`
  command (`set table_1.rows = 5` / `0` / `-2` / `2.5`, each refused, each leaving the table
  untouched), plus the symmetric `cols` case and a legal `set table_1.rows 5` that commits and
  grows the table's addressable extent (a previously-out-of-range cell becomes writable).
- **`src/engine/mutation.test.ts`** — one test per row of D-097's ruling table against `mutate`
  directly (bit-for-bit-unchanged assertions per Rule 2's rejection invariant), the symmetric
  `cols` case, the legal-write-grows-the-family case, the same-batch-`createObject` case, and a
  case proving a non-table object's own `rows`-named literal slot is untouched by this check.

## Decisions I made

- **Message shape**: one unified template for all four rejected shapes (`"<name>.<axis> must be a
  whole number from N to M held as a literal — a formula there would let evaluation resize the
  table (Rule 6). Got: <what>"`), following the ruling's suggested text closely rather than
  splitting the "wrong kind" and "wrong value" cases into two different messages. A `formula`/
  `derived` kind reports `Got: a formula` / `Got: a "derived" slot`; everything else reports the
  actual value.
- **`describeDimensionSlotValue` is new, not a reuse of `describeIllegalValue`**: that function's
  own doc comment scopes it to a value `hasIllegalNumber` already flagged, and this check's most
  common rejection (a plain out-of-range or fractional number) isn't that. Reusing it against its
  documented contract felt like exactly the kind of drift D-010 warns about, so I wrote four lines
  instead.
- **Tracked state is `{name, type}` only**, not `findInvalidTableResizes`'s fuller
  `TrackedTableState` (which also carries a running row/col count and resizability flags) — this
  check has nothing cumulative to track across operations; each `setSlot`'s own payload is judged
  on its own.
- Wrote BOTH an engine-level test (`mutation.test.ts`, hand-built `Operation`s, bit-for-bit
  snapshots) and a command-level end-to-end test (`commands.test.ts`, real typed `set` lines) for
  the four rejected rows — the ruling's "pinning required" language reads as engine-level, but the
  bug the human actually hit was end-to-end through the command line, and I wanted a test that
  fails the exact way they described.

## Verification (real output)

```
$ npx tsc --noEmit
(clean, no output)
$ npx tsc --noEmit -p tsconfig.engine.json
(clean, no output)
$ npm test
 Test Files  27 passed (27)
      Tests  1205 passed (1205)
$ npm run build
✓ 32 modules transformed.
✓ built in 340ms
```

Mutation-checked the new tests before calling this done: temporarily replaced the call to
`findInvalidDimensionWrites` in `mutate` with an empty result and re-ran
`mutation.test.ts`/`commands.test.ts` — **11 of the 14 new tests failed** (the two engine-level and
the five command-level rejection assertions correctly flipped to "expected false, got true"; the
same-batch-`createObject` case failed too). The three that did not fail are the two "legal write
still commits" tests and the "non-table object is untouched" test, which are correctly
UNAFFECTED by removing the check — they assert `ok: true` either way. Restored the real call,
re-ran the full suite: back to 1205/1205.

## Acceptance criteria status

Not a phase-gate cycle — Phase 4's own gate (STATUS.md: "a human session... two polygons bound
through a table, in one document") is untouched by this slice. D-097's own pinning requirement —
"one test per row of the table above, each asserting the refusal AND that the document is
bit-for-bit unchanged... plus one asserting a legal `set table_1.rows 5` still commits and grows
the extent" — PASSING, demonstrated by `mutation.test.ts`'s new
`findInvalidDimensionWrites` describe block and mirrored end to end in `commands.test.ts`.

## Where I got stuck / what is unfinished

Nothing. The ruling was specific enough (four rejected shapes, a stated file split, a suggested
message, an exact pinning requirement) that there was no ambiguity to raise. The one judgment call
— writing a new small value-describer instead of reusing `describeIllegalValue` — is recorded
above rather than left implicit.

## Open questions raised

None.

## Review point

Fired: none — batching. Cycles since last review: 1/3, diff 353 insertions / 33 deletions across
5 files (cap ~800/10). `mutation.ts` is load-bearing (§6.2): no later PHASE may begin while it
carries unreviewed changes, but nothing here claims a phase gate, so no immediate stop is forced.
Stopping here anyway rather than continuing into D-098/D-099 (STATUS.md's own next two cycles) —
this slice closes a real, human-hit correctness defect in a load-bearing file, and I'd rather the
human/reviewer see it land before more work piles on top of the same file in this batch.
