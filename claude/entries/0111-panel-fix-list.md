# 0111 — 0110-REVIEW's fix list: keyboard, stale cancel, unrounded seed, latch guard
Date: 2026-08-31   Phase: 4   Model: Claude Sonnet 5
Previous entry: 0110-REVIEW-phase4   Last review: 0110-REVIEW-phase4 (verdict: REVISE)
Batch: cycle 1 of up to 3 since last review (the counter reset at 0110-REVIEW); 2 files / 102
insertions, 17 deletions.

## Declared scope

0110-REVIEW's fix list, items 1-6, and nothing else: restore the command bar's keyboard after any
panel press and after any panel edit closes (F1); guard `onCancel` so a stale blur cannot cancel a
different row's editor (F2); seed a row's editor with the value the command line would accept back,
not the D-099-rounded display value (F3); stop the edit-gate latching when a rebuild produces no
input (F4); confirm 1-3 live in a real browser. All in `src/main.ts` plus `src/main.test.ts`.

## Explicitly not in scope

D-102 clause 9 (drag-linking between two panels) — untouched, not asked for. Fix-list items 11 and
12 (STATUS.md's own numbering) — unrelated to this batch, still open, still nobody's yet.

## What I did

**`src/main.ts`**:

- File header: added **D-107** to the `IMPLEMENTS`/binding list and to `INVARIANTS UPHELD HERE`,
  stating the two rules in present tense (D-060).
- `PanelRow` gained `editSeed: string` — the same slot rendered through `describeSlotValue` with NO
  `maxDecimals`, alongside the existing D-099-rounded `value`. `buildPanelModel` computes both from
  one `descriptor.value`, so this is still ONE enumeration (D-094 clause 9) with two formatter calls
  over it, never a third formatter (`STATUS.md`'s standing rule).
- `panelRowElement` seeds the row's `<input>` with `row.editSeed` instead of `row.value` — the one
  line F3's fix actually is. `panelEditInput`'s own doc comment corrected to match.
- `panelEditHandlers`'s `onCommit` and `onCancel` both now call `input.focus()` before returning the
  keyboard to the command bar (F1 item 2). `onCancel` additionally acts ONLY while `openEditor` still
  names the exact row (`objectId` AND `path`) it was built for (F2 item 3) — a stale blur, fired by a
  repaint that already opened a DIFFERENT row's editor, now no-ops instead of clearing that editor.
- `panelsContainer`'s `pointerdown` listener rewritten (F1 item 1): `event.preventDefault()` runs for
  every panel press except one landing inside the currently-open row's own `.panel-row__input` (see
  "Decisions I made" 1 for why that one exception exists and is not in the review's literal wording);
  focus moves to the command bar only when no row editor is open and the press did not land inside
  one. The existing dismiss/header branching is unchanged, now running strictly after both checks.
- `updatePanels` (F4 item 5): when the row `openEditor` names does not produce an `<input>` in the
  freshly-built model (`querySelector` returns `null`), `openEditor` is cleared instead of left
  latched — the guard `alreadyShowingThisEditor` would otherwise keep matching forever.

**`src/main.test.ts`**: widened the one exact-`toEqual` row-shape assertion to include `editSeed`
(D-096 clause 1's disclosure duty), and added one new test pinning F3: a literal seeded with more
than four decimals, committed UNTOUCHED through `commitPanelEdit`, leaves the document's number
bit-for-bit as authored.

## Decisions I made

1. **`preventDefault()` in the panel `pointerdown` listener carves out a press inside the currently
   OPEN row editor's own `<input>` — narrower than the review's literal "unconditionally."** Fix item
   1's exact words are "`event.preventDefault()` unconditionally (so the DOM never moves focus on its
   own)". I implemented that literally first, then verified F1/F2 live (all passed — see
   "Verification" below) and, separately, tested whether clicking WITHIN an already-open row's input
   still repositions the caret to the clicked character, the way a plain text input always does. It
   did not: with the literal unconditional version, clicking anywhere in the input's text moved the
   caret to the END regardless of where the pointer landed (confirmed against the PRE-fix code too,
   where it correctly landed at the click position) — `preventDefault()` on `pointerdown` cancels the
   browser's native mousedown handling for a focused text field, which INCLUDES caret placement, not
   only "moves focus." An already-focused input never suffers the "focus falls to `<body>`" bug this
   fix exists to stop (entry 0091's own bug, and F1's), so preventing its default fixes nothing there
   while breaking ordinary text editing. I narrowed the condition to exclude a press inside
   `.panel-row__input` and re-ran every live check (F1, F2, and the caret probe) — all pass with the
   narrower version; see "Verification". This is a small, reversible, disclosed deviation from the
   fix list's literal code shape, not from D-107's stated RULE (both of D-107's two rules — the
   keyboard is never left homeless, and a handler on transient DOM is identity-checked — hold exactly
   as before); flagging it for the reviewer rather than silently taking either the literal wording or
   my own reading.
2. **`onCommit` did NOT get the same `openEditor` identity guard as `onCancel`.** Fix item 3 names
   `onCancel` specifically. Traced why: `onCommit` fires only from the row input's OWN `keydown`
   listener (Enter), which is bound directly to that one input (D-102 clause 8's live element) and
   can only receive a real keystroke while that exact input still exists, focused, in the DOM — which
   is exactly when `openEditor` still names it, since nothing else reassigns `openEditor` without
   synchronously triggering the repaint that removes the input first (JS's single-threaded run-to-
   completion rules out an interleaving where `openEditor` moves on while this input keeps receiving
   keys). `onCancel` is different because a REPAINT itself can fire a stale blur, with no keystroke
   involved. Left `onCommit` as fix item 2 describes it (focus restored, no added guard) rather than
   adding a defensive check with no reachable failure to guard against.
3. **F4's fix is exactly the one line the review names, no wider.** The row `openEditor` names
   leaving the model while the object stays panelled is unreachable by any command in today's
   registry (0110-REVIEW's own words) — this is a hazard guard, not a bug fix, so it gets the cheap
   guard and nothing more (no test: there is no live path to construct the precondition without a
   command that doesn't exist yet).

## Verification (real output)

```
$ npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.engine.json
(clean, no output)

$ npm test
 Test Files  27 passed (27)
      Tests  1245 passed (1245)

$ npm run build
✓ 32 modules transformed.
✓ built in 313ms
```

Zero skipped, zero `.only`. 1245 = 1244 (entry 0109's count) + 1 new (F3's pinning test); the
`editSeed`-widened assertion is an edit to an EXISTING test, not a new one, per D-096 clause 1.

**Mutation-checked** (D-016): `PanelRow.editSeed`'s formatter call temporarily changed to pass
`{ maxDecimals: 4 }` (the same rounding `value` uses) → the new F3 test failed exactly as expected
(`expected '0.1235' to be '0.123456789'`), 0 others affected. Reverted, confirmed green again.

**Manual verification, live, in a real browser** (fix item 6) — `main.ts`'s DOM half is untested by
construction (D-001), so I drove the actual app in a real Chromium instance via Playwright, installed
transiently outside the project (`npm install --no-save` in the OS scratch directory —
`package.json`/`package-lock.json` unchanged, confirmed by `git status`), against `vite`'s own dev
server:

(a) **F1, item 1+2**: opened `origin.x`'s grey-paperclip editor on a selected circle, typed `42`,
pressed Enter. Immediately (no click) typed `props circle_1` and pressed Enter with the keyboard
alone — it reached the command bar, and the log showed the edit had committed (`origin.x = 42`).
Confirmed the command bar, not the body, held focus straight after the commit.

(b) **F1, item 1**: linked `origin.x` to a table cell, then clicked its now-BLUE paperclip (an
immediate unlink, no input opens). Typed `zoom 1` with no click in between — it reached the command
bar and executed (`zoom is now 1`), confirming focus returns after a press that never opens an
editor at all, the case the previous version handled only for a header press.

(c) **F2, item 3**: opened `radius`'s editor, then — WITHOUT closing it — clicked `origin.x`'s
paperclip (a different row's paperclip, editor still open on `radius`). Confirmed `origin.x`'s
editor opened on this FIRST click, not the second: the stale blur/cancel from `radius`'s own input
being torn out of the DOM by the repaint did not clear `origin.x`'s freshly-opened editor, which is
exactly what the un-guarded `onCancel` would have done.

(d) **The caret probe named in "Decisions I made" 1**: seeded an open row's input with a known
6-character string, clicked near its LEFT edge. With the literal unconditional `preventDefault()`,
the caret landed at position 6 (the end) regardless of click position. With the narrowed version
(and, separately, confirmed again against the PRE-fix code), it landed at position 0, matching where
the pointer actually landed. This is what motivated Decision 1's carve-out.

Zero console errors, zero page errors, across every script and every run.

## Acceptance criteria status

Not a phase-gate cycle. Phase 4's own criterion is unchanged: still owed by a human session binding
two polygons through a table in one document — this cycle removes one of the reasons that session
would have been miserable (0110-REVIEW's own closing words).

## Where I got stuck / what is unfinished

- Decision 1's caret regression never showed up in the F1/F2 live checks the fix list itself asks
  for (item 6) — those never click INSIDE an already-open editor's text, only on paperclips, headers,
  and the dismiss control. I found it by testing one step further than what was asked, the same way
  entry 0109 caught its own near-miss by re-reading rather than by a failing assertion. Recording it
  here because PROCESS_BRIEF §10 wants the unflattering detail: the fix list's literal wording, taken
  at face value and shipped without that extra probe, would have traded one keyboard bug for a text-
  editing one.
- F4's guard has no test and cannot get one without a command this project does not yet have
  (0110-REVIEW's own read, unchanged by this cycle) — it is defensive code, disclosed as such.
- `main.ts`'s DOM half remains outside any automated assertion (D-001's standing gap); this cycle's
  changes are small relative to entry 0109's, but the verification is still several live runs, not a
  re-runnable one.

## Open questions raised

None new. No `PROVISIONAL(Q-NNN)` tag was added or touched. Q-016 (0110-REVIEW) is untouched by this
cycle — nothing here reaches a panel-typed string or boolean.

## Review point

Fired: none of PROCESS_BRIEF §6.1's eight triggers — no phase gate claimed, no first file of a new
subsystem (this extends already-reviewed `main.ts`), no deviation from `PROJECT_BRIEF.md` or
`DECISIONS.md` (D-107's two RULES are followed exactly as ruled; the one place this cycle's code
differs from the review's literal wording is disclosed above as an implementation-level decision,
not a rule change), no hard rule worked around, no test's PRIOR expectation broken (one existing
assertion widened per D-096 clause 1, one new test added), no dependency/build step/config file added
to the project, no repeated failed attempt, nothing from §8 touched.

Cycles since last review: 1/3. Diff: 102 insertions / 17 deletions across 2 files (cap 800/10) — well
under.

**REVIEW: NOT NEEDED.**
Reason: no §6.1 trigger, batch cap not reached.
Questions for reviewer:
  1. Decision 1 above (the caret-preserving carve-out on `preventDefault()`) narrows fix item 1's
     literal "unconditionally." Is the narrower shape the right reading of D-107's own rule, or should
     the review's exact wording stand and the caret regression be accepted as a smaller, separate
     defect for a later fix list?
