# 0052 — fix-list-both-axis-resize
Date: 2026-08-24   Phase: 2   Model: implementer
Previous entry: 0051-REVIEW-phase2   Last review: 0051-REVIEW-phase2 (verdict: REVISE)
Batch: cycle 1 of up to 3 since last review; ~180 lines / 2 files changed so far (STATUS.md and
this entry are not counted against the code cap, per prior entries' own convention).

## Declared scope

0051-REVIEW-phase2 §8's five-item fix list, and nothing else — not the `force` flag, not the
coherence gap itself. Items 1 (D-053 code fix + tests), 2 (pin the deletion-rejection route), 3
(record D-057 in `DeleteTableLineOperation`'s doc comment) touch `mutation.ts` and
`mutation.test.ts` only. Items 4 and 5 touch only `STATUS.md`.

## Explicitly not in scope

The `force` flag on `delete <table>` (D-056/D-057's build target) — STATUS.md's "Next slice" says
so explicitly and the fix list agrees (§8, closing text: "not on the fix list, deliberately... the
dimension/cell coherence gap in general"). The coherence gap itself (fix 2 pins it; closing it is
its own slice). `describeValueType`'s duplication. Collapsing
`rewriteObjectFormulaAddresses`/`repairObjectFormulaAddresses` (D-056 already settled: they stay a
pair). The ~25 older bare "this cycle" comment sites outside this batch's diff (D-058 binds new
comments only).

## What I did

**`src/engine/mutation.ts`** (fix list item 1, **D-053**):

- `findInvalidTableResizes`'s per-operation check used to consult only `operation.axis`'s own
  `*Resizable` flag. Widened to check BOTH `state.rowsResizable` and `state.colsResizable` and
  reject when either is false, naming every offending dimension (`"rows"`, `"cols"`, or both) —
  never only the axis this operation targets. `TrackedTableState` already carried both flags; this
  is the one-line-condition-becomes-several-lines change the fix list called for, no restructuring.
- Updated that function's own doc comment (precondition description) and `DeleteTableLineOperation`'s
  precondition doc comment to say "whole extent," not "targeted dimension," and cite D-053.
- Added a paragraph to the file header's cycle-history section for entry 0052, naming D-053 and
  D-057, per **D-058** (every cycle-history paragraph names its entry number).
- Added a KNOWN GAP paragraph to `DeleteTableLineOperation`'s own doc comment (fix list item 3,
  **D-057**): the repair path does not report which slots it broke (§5.1.1/§5.4), nothing here has
  a channel for one, and building it is the `force`-flag slice's job — not built here.
- Added a second KNOWN GAP paragraph to the same doc comment (fix list item 2) disclosing the
  deletion-can-still-reject route in the code itself, not only in `STATUS.md`, pointing at
  0051-REVIEW-phase2 §5 and D-053's companion ruling (why it is not patched on this side alone).

**`src/engine/mutation.test.ts`**:

- Two new tests for D-053's cross-axis case, one per operation kind: a ROW insert / ROW delete on a
  table whose UNTOUCHED `cols` slot is `formula`-kind. Both assert rejection, a message naming
  `"cols"` and D-046, and that prior state is bit-for-bit unchanged (`toEqual` against a
  `JSON.parse(JSON.stringify(...))` snapshot taken before the call, matching the existing D-046
  tests' own pattern). Named to say why one-axis checking was wrong, per the fix list's own
  instruction.
- One new pinning test for fix list item 2: a 3-row table with an out-of-extent `cells.A5` slot
  (row 5, unreachable through any sanctioned command — extent-bounded address resolution would
  refuse to write it, so the fixture constructs the `GraphObject` directly, the same way
  0051-REVIEW's own probe did) referenced by an external formula. Deleting row 1 rejects: the
  address-repair pass shifts the reference to `cells.A4` (unbounded), but the cell-slot walk never
  moved `cells.A5` in the first place (extent-bounded, D-049), so `"cells.A4"` names no slot and the
  dangling-reference check rejects the whole batch. The test's own name and a doc comment above the
  `describe` block state plainly that this is a KNOWN INCOHERENCE being pinned, not a desired
  outcome, and forbid patching it on the delete side alone (D-053's companion ruling) — matching the
  fix list's exact instruction.

**`STATUS.md`** (fix list items 4 and 5):

- Rewrote in full. Confirmed the "Next slice" `force`-flag guidance already matched D-056 (reuse
  `repairObjectFormulaAddresses` unchanged, different callbacks, no third helper) — nothing to
  correct there beyond re-stating it plainly in the shorter file. Cut from 253 lines to under 150 by
  compressing the "settled" list to a pointer at `DECISIONS.md` (removing items that are just a
  `D-NNN` restated) and trimming "Gotchas" to what is not already carried by a binding decision, per
  the fix list's own instruction — no known problem was deleted to make room.

## Decisions I made

None load-bearing — this cycle applies six already-ruled decisions (D-053 through D-058) rather
than making new ones. One implementation-level choice: where BOTH dimensions are non-literal, the
rejection message names both ("rows and cols slots are not..."), rather than only the first found —
matches D-053's own "naming every offending dimension" wording (plural), and costs nothing extra
since `TrackedTableState` already exposes both flags.

## Verification (real output)

```
$ npx tsc --noEmit
(clean, no output)
$ npx tsc --noEmit -p tsconfig.engine.json
(clean, no output)
$ npx vitest run --reporter=dot
 Test Files  15 passed (15)
      Tests  646 passed (646)
```

Mutation-checked (D-016) the two new D-053 tests specifically: temporarily reverted
`findInvalidTableResizes`'s fixed condition back to consulting only `operation.axis`'s own flag
(same shape as the pre-fix code) and re-ran just those two tests —

```
$ npx vitest run -t "D-053" --reporter=verbose
 Tests  2 failed | 643 skipped (645)
 AssertionError: expected true to be false  (both — insert and delete)
```

— confirming both are load-bearing against the exact defect D-053 names, then restored the real
fix and re-ran the full suite (clean, 646/646, shown above).

## Acceptance criteria status

Phase 2's clause 4 status is unchanged by this cycle: DELETE half still PASSING (entry 0050,
re-confirmed by the full suite above); `delete <table>`-until-`force` half still NOT YET. This cycle
does not touch the acceptance criterion — it closes a REVISE fix list, not a slice toward the gate.

## Where I got stuck / what is unfinished

Nothing stuck. The fix itself was exactly as small as D-053 predicted (a one-line condition widened
to check two flags instead of one) — the bulk of this cycle's diff is doc comments and tests, which
is the right shape for a fix this narrow. Unfinished, deliberately: everything the fix list itself
puts out of scope (see "Explicitly not in scope" above) — the `force` flag is next.

## Open questions raised

None. Nothing in this cycle surfaced a new ambiguity — every choice was already settled by
D-053–D-058.

## Review point

Fired: none — no §6.1 trigger. Not a phase gate (Phase 2 unchanged), not a new subsystem, no brief
deviation, no hard rule worked around, no test expectation changed for anything that was previously
passing (the two new tests are new, not retargeted), no dependency/build/config added, no repeated
bug. Cycles since last review: 1/3. Diff since last review: ~180 lines / 2 files (code) — well under
cap; `STATUS.md` and this entry are process artifacts, not counted, per the convention prior entries
(e.g. 0049, 0050) already used.
