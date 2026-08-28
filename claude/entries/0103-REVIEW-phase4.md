# 0103 — REVIEW (phase 4): entries 0101 and 0102
Date: 2026-08-28   Phase: 4   Model: reviewer (Claude Opus 5)
Previous entry: 0102-drag-notice-dedup-and-panel-rounding   Last review: 0100-REVIEW-phase4
Reviewing: the batch since 0100-REVIEW — entries 0101 (D-097) and 0102 (D-098 + D-099).

## Verdict

**ACCEPT WITH EDITS.** Both cycles build their rulings as written, the tests are real and
mutation-checked, and the logs match the diff. Two reviewer edits, both documentation, and one new
ruling (**D-104**) for a gap in D-097's *stated invariant* that entry 0101 did not create and could
not have closed inside its slice.

Entry 0104 is D-100 (the selection becomes a list). The batch counter resets to 0/3.

## 1. Rule audit

- **Rule 1 (no DOM in `engine/`)** — upheld. Grepped `document.`/`window.`/`canvas`/`render/`
  across `src/engine/`: every hit is a comment or a file header, none an import or an expression.
  The D-097 clause 3 constant move is what this rule *forced*, and it went the right direction —
  `engine/primitives/table.ts` declares `MIN_TABLE_LINES`/`MAX_TABLE_LINES`, `command/` imports
  them, never the reverse.
- **Rule 2 (all state change through `mutation.ts`)** — upheld, and strengthened. D-097's gate sits
  in `mutate` rather than in the `set` handler, which is the whole point: `writeSlot`, a raw
  `Operation`, and D-102's future panel edit all inherit it. `interaction.ts` still writes nothing —
  it plans operations and hands them to `mutate`; `emittedNotices` lives in `DragState`, which is
  interaction state, not document state.
- **Rule 3 (two-layer naming)** — not touched.
- **Rule 4 (one evaluator)** — not touched. `formatDisplayNumber` formats an already-evaluated
  `Value`; it parses nothing.
- **Rule 5 (dumbest correct implementation)** — upheld. `emittedNotices` is a plain array with an
  `includes` scan, explicitly argued against a `Set`; `formatDisplayNumber` is `toFixed` → `Number`
  → `String` with no string surgery. Both are the boring choice and both say why.
- **Rule 6 (dynamic dependencies resolved at mutation time, never during evaluation)** — upheld,
  and this is the rule D-097 exists to protect. `findInvalidDimensionWrites` refuses a `formula`
  dimension at write time; `readTableDimension`'s fail-closed read (D-046) is untouched beside it,
  exactly as D-097 required. The refusal message names Rule 6 to the operator.
- **Rule 7** — not touched.

## 2. Invariant audit

Rejection leaves prior state bit-for-bit unchanged: pinned per row of D-097's table in
`mutation.test.ts`, and the new check is a PRE-STAGING precondition — it returns before
`cloneObjects`, so no path exists by which a refused dimension write touches the staged graph.

Left-to-right simulation: correct in effect. `resolveTracked` searches the whole `operations` array
rather than only the prefix, which reads looser than the doc comment claims. It is not, because
`mutate`'s existence check runs earlier and returns first, rejecting any batch that targets an id
before its `createObject`. Noted, not a finding — the comment is accurate about behaviour a caller
can observe.

Slot set fixed during evaluation, derived slots inside the topological pass, eager/total dependency
extraction, no dangling edges, graph state plain and serializable — none touched by this diff.

## 3. Spec conformance

**D-097** — clauses 1–6 all built. Clause 1's four rejected shapes are each a test; clause 2's
placement is correct and argued on the function itself; clause 3's move happened and was named in
the log per D-096 clause 1; clause 4's message follows the suggested text and reports the actual
value; clause 5 (`unlink` stays the escape hatch) needed no code; clause 6's future duty is recorded
where the next implementer will read it. The pinning requirement is met and then exceeded — the
implementer wrote the end-to-end `commands.ts` version as well, because the bug the human hit was a
typed line. That was the right call, and it is the test that would actually have caught this.

**D-098** — built as ruled. Dedup is by TEXT, reset by `pointerDown`, discarded by `pointerUp`, and
the rejection MESSAGE is correctly left undeduplicated while the skipped-component notices beside it
still widen the set. Preserving the pre-existing `toBe` identity on the nothing-fresh rejection path
is a good instinct: it keeps a pinned guarantee D-098 gave no reason to break, and it is disclosed
rather than silent.

**D-099** — built as ruled, including clause 3, which is the clause that mattered.
`Number(x.toFixed(n))` then `String` for round-and-trim is correct and needs no regex; the
`rounded === 0 && value !== 0` guard reproduces the ruling's own `1.2246e-16` worked example
exactly; `-0` falls through to `"0"`, which is Q-008's territory and not this cycle's to settle.
Splitting `boolean` out of the `number` arm was forced by the change and disclosed per D-096
clause 1. `props`'s output is byte-identical, and that is pinned rather than asserted.

One thing the ruling did not anticipate and the code got right anyway: `formatDisplayNumber` guards
a non-finite value even though D-025 makes it unreachable, because `toFixed` throws. That is this
file's never-throws posture applied without being told.

## 4. Legibility audit

Headers present and present-tense; `mutation.ts`'s FIVE→SIX precondition count and its
FOURTH/FIFTH/SIXTH paragraph were both updated rather than left to rot, which is the failure mode
§5.2 exists to prevent. Vocabulary locked throughout — slot, literal, formula, derived, mutation,
address, notice. Comments explain why and cite a ruling as a supplement to a stated reason, never as
a substitute (D-060). No `any` in the diff. Test names are behaviour sentences and each names the
rule or ruling it defends.

## 5. Honesty audit

Re-ran everything rather than reading it:

```
$ npx tsc --noEmit                          (clean)
$ npx tsc --noEmit -p tsconfig.engine.json  (clean)
$ npm test
 Test Files  27 passed (27)
      Tests  1215 passed (1215)
```

Matches entry 0102's claim exactly. Zero `.only`, zero `skip`, zero `todo` across `src/`. The
file-count arithmetic is right: 11 `src/` files, over §6.3's ~10 cap, under the 800-line half. The
implementer read "whichever comes first" correctly and stopped, which is what §6.3 wants and is the
harder of the two available calls. No silent scope expansion in either cycle — both "explicitly not
in scope" sections match what the diff does not contain.

Entry 0102's disclosed near-miss — a dedup test that moved the pointer along Y only, so a zero-delta
component was skipped before it could emit, leaving the test green with or without the fix — is the
most valuable paragraph in this batch. It was found only by mutation-checking a first-try-green
suite. Report it again if it happens again.

## 6. The finding — D-097's invariant is wider than the clause entry 0101 implemented

D-097 clause 1 says `mutation.ts` rejects **any batch** that would leave a sizing slot unreadable.
Entry 0101 built that for `setSlot`. Two other operations write those same two slots:
`insertTableLine` and `deleteTableLine`, both of which re-assert `rows` AND `cols` as literals on
every call. `findInvalidTableResizes` bounds their INDEX (1..count for a delete, 1..count+1 for an
insert) but not the resulting COUNT — so `deleteTableLine` on a one-row table is accepted and lands
`rows` on `0`, which is precisely the vanishing state D-097 closes for a write, and repeated
`insertTableLine` carries a count past `MAX_TABLE_LINES`.

**This is not a defect in entry 0101.** The gap predates D-097 (the bounds were creation-only before
it), nothing in the ruling's file list points at `findInvalidTableResizes`, and — decisively — **no
command reaches either operation**: §5.10's row/column commands are unbuilt, so this is engine-level
`Operation` construction only, not operator-reachable. Widening the slice to chase it would have
been the scope creep §4 warns about. What the cycle owed was noticing that the ruling's stated
invariant is wider than the clause implementing it, and saying so. It did not.

Ruled **D-104**: the floor and ceiling bind `insertTableLine`/`deleteTableLine` too; the check that
owns them is `findInvalidTableResizes` (it already carries the running count the bound is about, so
a second pass would be a second source of truth for one number, D-010); `findInvalidDimensionWrites`
is NOT widened; and the duty falls on the cycle that builds §5.10's row/column commands — the first
cycle that can reach this from a typed line. Two pinned tests named in the ruling.

## 7. Edits made

Both documentation, no behaviour changed, tree still green:

1. **`src/engine/primitives/table.ts`** — one `NOT DONE HERE` bullet: the bounds do not cover
   `insertTableLine`/`deleteTableLine`, deleting the last line still lands `0`, it is not reachable
   by command today, and D-104 owns it.
2. **`src/engine/mutation.ts`** — one paragraph on `findInvalidDimensionWrites`'s doc comment saying
   the same thing where a reader of that function is already standing, and pointing at
   `findInvalidTableResizes` as the owner rather than inviting a second bound here.

Re-ran after the edits: both configs clean, 1215/1215.

## 8. Open questions

- **Q-008 (`-0` as document state)** — DEFERRED again, explicitly. This batch touched it twice
  without needing it settled: `describeDimensionSlotValue` routes through `formatIllegalNumber`, so
  a rejected `-0` dimension reports honestly as `-0`, and `formatDisplayNumber` renders `-0` as
  `"0"` because `-0 !== 0` is false. Neither is a decision about legality. Blocking nothing.
- **Q-012 (world units or screen pixels)** — DEFERRED, unchanged. Due with the `style`-slots cycle;
  nothing in this batch takes a side.
- **Q-015 (does shift-click deselect an already-selected object)** — DEFERRED to the human, as
  D-100 clause 4 already provides. Entry 0104 carries the `PROVISIONAL(Q-015)` tag. Blocking
  nothing.

No new questions raised by this review. Next free: **Q-016**.

## 9. Fix list

Items 1–12 from 0090-REVIEW §9 / 0100-REVIEW §9 stand unchanged and open. One added:

13. **`insertTableLine`/`deleteTableLine` are not bounded by `MIN_TABLE_LINES`/`MAX_TABLE_LINES`** —
    **D-104**, owed by the cycle that builds §5.10's row/column commands. Disclosed in two file
    headers today; not operator-reachable until that cycle lands, and that cycle must not land
    without it.

## 10. For the next cycle

Entry **0104 is D-100** — the selection becomes a list. Batch counter resets to **0/3**. D-100
clause 9 already puts a review point at its end, so that cycle is one slice and stops. D-103's order
is otherwise unchanged, and Phase 4's own gate — two polygons bound through a table, in one
document, driven by a human — is still owed and is still not any of these.
