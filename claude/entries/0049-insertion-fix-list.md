# 0049 — insertion-fix-list
Date: 2026-08-24   Phase: 2   Model: implementer
Previous entry: 0048-REVIEW-phase2   Last review: 0048-REVIEW-phase2 (verdict: REVISE)
Batch: cycle 1 of up to 3 since last review; ~462 lines / 4 files changed so far.

## Declared scope

The three-item fix list at 0048-REVIEW-phase2 §8, closing the REVISE verdict on entry 0047's
row/column insertion: **D-049** (`insertTableLine` must preserve every slot it does not own),
**D-050** (`findInvalidTableResizes` must simulate the batch left-to-right), and fix 3 (reject an
insert into a table whose targeted dimension is not `literal`, naming D-046). No new design —
every fix's shape was already specified by the reviewer.

## Explicitly not in scope

Row/column **deletion**, its REPAIR path, `#REF` rewriting, and the `force` flag on
`delete <table>` — Phase 2's one remaining acceptance clause, and STATUS.md's own "Then — the
DELETE half" section. That is substantial new design surface (D-052's forward note calls for a
second, node-level `FormulaAst` walk; a new `Operation` variant; the first real use of the
§5.1.1 REPAIR path anywhere in this codebase) and deliberately not started here — see "Review
point" below for why I am stopping at the fix list rather than launching straight into it.

The dimension/cell coherence gap in general, and the `rows`/`cols` upper bound — both still
`STATUS.md` known problems, both explicitly left off the fix list at 0048-REVIEW §8.

## What I did

- **`src/engine/primitives/table.ts`** — fix 1 (D-049): `insertTableLine` now builds its new
  `slots` record by spreading `object.slots` in full, then removing ONLY the in-extent cell keys
  it is about to re-write at their shifted position — every other slot (an unrecognised literal,
  an out-of-extent cell, a future `origin.x`/`origin.y`) survives untouched. Added
  `isTableDimensionResizable(object, axis)` (exported): `true` for an absent or `literal`
  dimension slot, `false` only when the slot is present and NOT `literal` — the primitive fix 3
  needed to let `mutation.ts` reject rather than `insertTableLine` silently reading the dimension
  as a fail-safe `0` and resetting it. Updated the file header (WHAT THIS IS, NOT DONE HERE,
  cycle-history paragraph) and `insertTableLine`'s own doc comment to describe both changes and
  correct the now-stale "regardless of whatever kind they held before" sentence.
- **`src/engine/mutation.ts`** — fix 2 (D-050) and fix 3, both in `findInvalidTableResizes`. New
  `TrackedTableState` record and a lazily-seeded `Map<objectId, TrackedTableState>`
  (`resolveTrackedTableState`): seeds from pre-batch `objects` OR — closing the previously
  disclosed same-batch-`createObject` gap — from an earlier `createObject` operation in the SAME
  batch naming this id (safe to search unconditionally: D-021's existence check, which runs
  before this function, already guarantees the target exists by its position in the batch).
  Every `insertTableLine` is now validated against this per-table state, which is UPDATED (+1 on
  the relevant axis) after each operation this function accepts — closing the verified
  false-reject (`[insert row at 1, insert row at 4]` on a 2-row table). Fix 3 reads
  `isTableDimensionResizable` once per table, at first-seed time, and rejects an insert whose
  targeted axis is not resizable, naming D-046. Deleted the now-obsolete "DISCLOSED GAP" paragraph
  from this function's doc comment and from `InsertTableLineOperation`'s (0048-REVIEW §8 item 2's
  own instruction), replacing both with the new D-050/D-046 shape. Updated the file's running
  cycle-history paragraph.
- **`src/engine/primitives/table.test.ts`** — 7 new tests: `isTableDimensionResizable` (4: literal,
  absent, formula-kind, mixed-axis), and a new `describe` under `insertTableLine` for D-049 (3: an
  unrecognised literal slot, an out-of-extent cell slot, and a stand-in for Phase 3's future
  `origin.x`/`origin.y` all survive a resize).
- **`src/engine/mutation.test.ts`** — 7 new tests, two new `describe` blocks: D-050 (4 — two
  same-table inserts in one batch both commit; a later out-of-range index is still rejected; a
  same-batch-created table's insert is now validated, not skipped; and a same-batch-created
  table's LEGAL insert still commits) and fix 3 (3 — a formula-kind `rows` insert is rejected and
  leaves prior state bit-for-bit unchanged; a formula-kind `cols` insert on a column axis is
  rejected; an ordinary literal-dimensioned table is unaffected).

## Decisions I made

1. **`isTableDimensionResizable` checks BOTH `rows` and `cols`, not only the axis being resized.**
   0048-REVIEW §4 case 3 demonstrated the bug via the axis being resized, but `insertTableLine`
   unconditionally re-writes BOTH dimension slots as `literal` on every call (it has to: the
   untouched axis's current value still needs to be re-asserted). If the untouched axis were
   `formula`-kind, an insert on the OTHER axis would silently convert it to `literal` the same
   way — the identical defect class, just reached from the other axis. Fix 3's own wording
   ("whose `rows`/`cols` is not `literal`", not "whose resized dimension is not `literal`")
   supports checking both; I read it as intentional rather than tightening the review's own
   phrasing without asking.
2. **Literal-ness is read ONCE per table, at first-seed time, and never re-read for the rest of
   the batch.** `insertTableLine` only ever RE-ASSERTS `literal` (never converts a dimension AWAY
   from it), and this function does not simulate arbitrary `setSlot` effects on a table's
   dimension (see the residual gap below) — so nothing tracked here can make a resizable
   dimension become non-resizable mid-batch. Keeping this simple matches the fix list's own scope
   (D-050 is about the *count*, not table dimension *kind*, changing mid-batch).
3. **A new, narrower, explicitly disclosed residual gap**, replacing the one D-050 closes: a
   `setSlot` EARLIER IN THE SAME BATCH that changes a table's `rows`/`cols` value or kind AFTER
   this function's per-table state is first seeded is not tracked — this function only simulates
   `insertTableLine`'s own effect, not arbitrary `setSlot`s. I considered building a general
   batch-wide dimension-tracking fold that also watched `setSlot`, but that is materially more
   code for a scenario nothing in this codebase currently produces (no caller composes
   `[create table, setSlot table.rows, insertTableLine]` in one batch), and it is the same shape
   as the STATUS.md-carried "dimension write is not checked for COHERENCE" known problem —
   reached through a new door, not a new hole. Disclosed in both the function's own doc comment
   and STATUS.md, not silently introduced.
4. **`describeUndeclaredSlot` was NOT reused for `findInvalidTableResizes`'s messages.** Every
   table this function names has already resolved to a real `GraphObject` (from `objects` or a
   same-batch `createObject`) by the time a message is built, so its `.name` is always available
   directly — matching the ORIGINAL (pre-fix) function's own naming style, which this fix
   preserves rather than changes.

## Verification (real output)

```
$ npm run typecheck
> tsc --noEmit && tsc --noEmit -p tsconfig.engine.json
(clean, no output)

$ npm test -- --run
 Test Files  15 passed (15)
      Tests  589 passed (589)
```

589/589 (up from 575 at 0048-REVIEW), 0 skipped, 0 `.only`/`.skip`/`it.todo` (grepped across
`src/`). Both tsconfigs clean.

## Mutation-test checks (D-016)

Four checks, one per fixed line/behaviour, each: disable → rerun the affected file(s) → confirm
the named test(s) fail and nothing else → revert → confirm `grep -rn "MUTATION-TEST\|MUTATION_TEST"
src/engine` clean.

1. **D-049** — `insertTableLine`'s `newSlots` reverted to `{}` (rebuild from scratch).
   `npx vitest run src/engine/primitives/table.test.ts` → **3 failed**, all and only the three new
   D-049 tests ("a literal slot at an UNRECOGNISED path...", "a cell slot OUTSIDE the table's
   current declared extent...", "stands in for Phase 3's future origin.x/origin.y..."); 42 passed.
2. **D-050, the increment half** — the `state.rows += 1` / `state.cols += 1` update wrapped in
   `if (false as boolean)`. `npx vitest run src/engine/mutation.test.ts` → **1 failed**: "two
   inserts on the SAME table in one batch both commit — the false-reject D-050 closes"; 127
   passed.
3. **D-050, the same-batch-`createObject` half** — `fromCreate` forced to `undefined`.
   `npx vitest run src/engine/mutation.test.ts` → **1 failed**: "an insertTableLine on a table
   created EARLIER IN THE SAME BATCH is now VALIDATED, not skipped"; 127 passed.
4. **Fix 3** — `resizable` forced to `true`. `npx vitest run src/engine/mutation.test.ts` →
   **2 failed**, both and only the two fix-3 rejection tests ("rejects an insert whose ROWS slot
   is formula-kind...", "rejects a COLUMN insert whose COLS slot is formula-kind..."); 126 passed.

All four confirmed genuinely load-bearing. `grep -rn "MUTATION-TEST\|MUTATION_TEST" src/engine`
clean before and after each, and clean now.

## Acceptance criteria status

Phase 2 criterion, clause 4 (row/column delete with `#REF` repair, `delete <table>`
rejected-until-`force`): **NOT YET** — unchanged, out of scope this cycle (see above). Clauses 1–3
remain PASSING, unaffected by this cycle's changes (re-run, not re-derived).

## Where I got stuck / what is unfinished

Nothing got stuck this cycle — the fix list was fully specified by the reviewer and each fix was
a small, contained change. The one place I deliberated (decision 1 above, whether to check both
axes or only the resized one) I resolved by re-reading the review's own wording rather than
guessing, and I disclosed the new residual gap (decision 3) rather than either silently building a
bigger fix or silently leaving it unmentioned.

## Open questions raised

None.

## Review point

**No §6.1 trigger fired.** Checked each against this cycle honestly: no phase gate claimed
complete (clause 4 still NOT YET); no first file of a new subsystem (all four touched files
already existed, all four already load-bearing); no brief deviation or ambiguity (every fix's
shape was dictated by the reviewer, not decided fresh — decision 1 above resolved a phrasing
question by re-reading the ruling, not by taking a position against it); no hard rule left
unsatisfied; no existing test's expectation changed (only new tests added); no new
dependency/build step/config file; no second failed attempt at the same bug (first attempt at
each of these three specific defects). Batch: cycle 1 of 3 since 0048-REVIEW, ~462 lines / 4 files
(cap 800/10) — well under.

**REVIEW: NOT NEEDED.**

I am nonetheless **stopping here** rather than declaring the DELETE slice and continuing in this
same cycle — a judgment call, not a rule requirement (PROCESS_BRIEF §11's step 7 permits
continuing when nothing fires). Row/column deletion is substantially larger and more novel than
this fix list: it is the first real use of the §5.1.1 REPAIR path anywhere in this codebase,
D-052's own forward note calls for designing a second, node-level `FormulaAst` walk before writing
any of it, and the `force` flag widens `Operation` again with a genuinely new precondition shape.
STATUS.md's own instruction ("Read D-052's forward note first... Design that up front") is a sign
this deserves its own explicitly declared slice rather than being folded into a cycle that started
as a mechanical fix-list closure. No open questions block starting it, but I'd rather hand back
the choice of when than assume it.
