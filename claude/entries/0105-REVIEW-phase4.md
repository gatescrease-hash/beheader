# 0105 — REVIEW (phase 4)
Date: 2026-08-31   Phase: 4   Model: reviewer
Reviews: entry 0104 (selection-becomes-a-list)   Previous review: 0103-REVIEW-phase4
Verdict: **ACCEPT WITH EDITS**

Scope of this review: the diff since 0103-REVIEW — one cycle, entry 0104, ~384 lines across 8 files.
Review forced by D-100 clause 9, not the batch cap (1/3).

## Honesty audit — one line, because it matches

Re-ran everything the entry claims. `npx tsc --noEmit` clean, `npx tsc --noEmit -p
tsconfig.engine.json` clean, `npm test -- --run` → **27 files, 1223 passed, 0 skipped, 0 `.only`** —
exactly as logged. The log's file-by-file account matches the diff with no silent scope expansion:
`commands.ts` really did need no edit and the entry says so unprompted (D-096 clause 1's disclosure
duty, discharged correctly), and the one change it did NOT flag is finding F2 below.

## Rule and invariant audit

Rules 1, 2, 4, 6, 7 — not touched. No `engine/` file changed; nothing in the diff writes state
outside `mutate` (the drag path is unaltered); no second evaluator, no schema or evaluation change.
Rule 3 (plain, serializable, IDs not references) — **upheld and strengthened**: `selectedObjectIds`
is a `readonly string[]` of ids, and `renderer.ts`'s `Set` is built per call and never stored.
Rule 5 (dumbest correct implementation) — upheld, and it is the reason entry 0104's item 3 is right:
no interim multi-panel machinery was invented.

D-100 clause by clause: 1 ✓ (list, click order), 2 ✓, 3 ✓ *with F2's correction*, 4 ✓
(PROVISIONAL(Q-015) tagged at `toggleSelection`, as OPEN_QUESTIONS said it would be), 5 ✓
(`deselect` returns the empty list), 6 ✓, 7 ✓ (`CommandEffect` unchanged; `performEffect` replaces
with one), 8 ✓ (highlight and suppression both over the list; a stale id draws and suppresses
nothing, pinned), 9 ✓ (this review).

## Findings

**F1 — ACCEPTED WITH A BOUND, not fixed: two selected objects have their names nowhere on screen.**
D-100 clause 8 suppresses every selected object's canvas label; entry 0104's own item 3 hides the
panel for a selection of two-or-more. The two together mean a shift-click on a second object removes
both names from the display and offers nothing in their place. Entry 0104 disclosed each half and
not the consequence. The right call is still the one it made — an interim panel scheme that D-101
deletes in one cycle is Rule 5's exact failure mode, and the state is reached only deliberately and
undone by a plain click or escape. So it stands, **bounded by D-105 clause 2**: if D-101 does not
land next cycle, the cycle after it narrows suppression to objects that actually have a panel. Now
carried in `STATUS.md`'s known problems.

**F2 — FIXED (reviewer edit): a shift-click on empty canvas inherited a drag armed before it.**
`pointerDown`'s additive/empty-canvas branch returned prior `state` verbatim, drag included, while
the plain-click branch returns `INITIAL_INTERACTION_STATE` and clears it. The file header asserted
"nothing here should ever leave a drag running from BEFORE this press" — the code did not enforce
it. It is reachable: `main.ts` binds `pointerup`/`pointercancel` to the CANVAS, so a release outside
the canvas leaves `drag` armed, and the next `pointerMove` after such a shift-click moves an object
nobody is holding. Ruled generally as **D-105 clause 1**.

## Edits made

1. `src/render/interaction.ts` — `pointerDown`'s empty-canvas additive branch now returns
   `state.drag === undefined ? state : { selectedObjectIds: state.selectedObjectIds, drag: undefined }`,
   with a `// why` comment naming the canvas-scoped `pointerup` that makes it reachable. The
   function doc and the file header's D-100 paragraph corrected: clause 3 preserves the SELECTION,
   not the gesture.
2. `src/render/interaction.test.ts` — the existing "changes nothing at all" test asserted
   `toBe(selected)` against a state that *had a drag armed*, so it pinned the defect. Renamed to
   "leaves the SELECTION alone" and narrowed to the selection (a changed test expectation, §6.1
   trigger 5, made deliberately and named here). Two tests added: a drag armed before the press is
   ended, and the no-drag case still returns the prior state object identically.
3. `claude/DECISIONS.md` — **D-105** appended (F2's general form, and F1's bound).
4. `claude/STATUS.md` — rewritten head, known problems, and gotchas for this verdict.

After the edits: both configs clean, **1225/1225 passed**, 0 skipped, 0 `.only`.

## The implementer's five decisions — all ratified

1. **`state` first in `pointerDown`.** Correct. The toggle needs prior state, so the old "no prior
   state" claim died on its own; matching `pointerMove`'s order beats a second convention in one file.
2. **A drag arms on the object under the press even when the shift-click just toggled it OUT.**
   Correct, and it is what clause 6 says — the drag target is decided by the press alone. The
   alternative needs a clause that does not exist, and would make a shift-click swallow the next
   mouse-move. **Ratified; it is no longer "not yet human-confirmed" as a reviewer question, though
   the human may of course overrule it as product behaviour.**
3. **Panel hidden for a selection of two-or-more.** Correct — see F1. Hiding is the honest
   placeholder; showing an arbitrary one of N would be a guess presented as an answer.
4. **`renderDocument`'s `[]` default.** Fine. It keeps "nothing selected" call sites untouched and
   the parameter is still explicit at every site that means something by it.
5. **`toggleSelection` as a named top-level function.** Fine, and the right size — it carries the
   PROVISIONAL tag where a reader looking for Q-015 will find it.

## Open questions

**Q-015 (does a shift-click toggle an already-selected object out) — DEFERRED to the human, not
answered here, and it is not blocking.** It is product behaviour and D-042 makes the operator the
arbiter of exactly that. The provisional (a) stands, built and tagged; it costs one branch and one
test to reverse, and the human will meet it in their next session, which is the cheapest possible
place to rule on it. Nothing else is open against this diff. No new question raised.

## What happens next

**Entry 0106 — D-101, N panels, draggable**, per D-103's order. The cycle counter resets to 0/3.
D-105 clause 2 puts a one-cycle clock on F1's gap, so D-101 is not merely next by preference now.
