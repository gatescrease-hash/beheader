# 0110 — REVIEW (phase 4)
Date: 2026-08-31   Phase: 4   Model: reviewer
Reviews: entries 0107 (N panels, drag and dismiss), 0108 (verdict correction, no code), 0109 (panel
editing — D-102)   Previous review: 0105-REVIEW-phase4
Verdict: **REVISE** — three reachable defects, all in the DOM half, all in the feature this batch
built. Everything else in the batch is accepted as written.

Scope of this review: the diff since 0105-REVIEW — 960 insertions / 102 deletions across 10 files
(`git diff --stat 052f156 -- . ':!claude'`), three cycles. Review forced by D-103 clause 4 (D-102's
own mandatory point) and independently by the §6.3 cap. Both fired; the batch's own accounting says
so and is correct.

## Honesty audit — one line, because it matches

Re-ran everything the entries claim. `npx tsc --noEmit -p tsconfig.json` and `-p
tsconfig.engine.json` both clean; `npx vitest run` → **27 files, 1244 passed, 0 skipped, 0 `.only`**
— exactly as entry 0109 logged, and 1238 is what entry 0107 logged for its own point in the batch.
The file-by-file accounts match the diff: entry 0107's 6 files / 510+ / 86-, entry 0109's 5 files /
469+ / 35- (the tenth file in the cumulative diff, `render/interaction.ts`, is 0106-RULINGS' own
comment edit, and `STATUS.md` says so). No silent scope expansion; `engine/` is untouched by every
commit in this batch. Entry 0109's three mutation checks are the right three and are described
concretely enough to re-run.

Entry 0108 is correct and its correction is the one this reviewer would have made: nothing in entry
0107's diff fires a §6.1 trigger, and `NOT NEEDED` was the honest verdict for that diff. The unease
it recorded was, however, *pointing at something real* — F1 below is in entry 0107's half of the
batch, not entry 0109's. That is not an argument for `RECOMMENDED`; it is an argument for the batch
review that D-103 clause 4 already guaranteed, which is what caught it.

## Rule and invariant audit

Rules 1, 4, 6, 7 — not touched. No `engine/` file changed (grepped: no `document.`/`window.`/canvas
/`render/` import anywhere under `src/engine/`); no second evaluator; no slot-set change; nothing
from §8.

**Rule 2 — upheld, and this is the batch's best decision.** Every panel write is a synthesised
`Command` through `executeCommand` (`runPanelCommand`); there is no `mutate` and no `writeSlot` call
anywhere in `main.ts`. D-102 clause 5's whole payoff — inheriting D-097's refusal for free — is real
and is pinned by the "a refusal (a derived slot) reaches the log and changes the document not at
all" test, which asserts `after.document` is the *same object*.

**Rule 3 / plain serializable state — upheld.** `PanelUiState`/`PanelUiRegistry` are plain records
keyed by object id; DOM handles live in `panelElements`, a closure `Map` in `start`, never in
`AppState`. `withInteraction` as the single assignment point for `interaction` is exactly the shape
D-105's finding argued for, applied one cycle later without being asked. Good.

**Rule 5 — upheld.** No optimisation was smuggled in under D-102 clause 8: the skip is narrow, it is
the correctness fix the clause demands, and its default is REBUILD (see the ratified decisions
below).

Clause-by-clause: **D-101** 1 ✓, 2 ✓ (`placePropertiesPanel` unchanged), 3 ✓ (nothing built), 4 ✓,
5 ✓ (manual position wins outright; the pure function is not called), 6 ✓ (`prunePanelsToSelection`),
7 ✓, 8 ✓ (structural — a sibling of `canvas`). **D-106** 1 ✓, 2 ✓, 3 ✓, 4 ✓, 5 ✓ (two lists, defaulted,
with two divergent-list tests that would have caught a collapse — the mutation check proves it),
6 ✓, 7 ✓, 8 ✓. **D-102** 1 ✓, 2 ✓ (`synthetic` added and read), 3 ✓, 4 ✓, 5 ✓, 6 ✓, 7 ✓ *except the
focus consequence in F1*, 8 ✓, 9 ✓ (not built).

## Findings

The three below are read off the code, not off a browser — this reviewer did not drive the app.
Each names the exact sequence, so fix item 5 asks the implementer to confirm each live the way
entries 0107 and 0109 already know how to.

**F1 — the command bar loses the keyboard on any panel press outside the header, and nothing gives
it back.** `canvas`'s own `pointerdown` calls `event.preventDefault(); input.focus()` precisely
because a press otherwise moves focus to the body — the comment at that listener says so and names
entry 0091. `panelsContainer`'s `pointerdown` does the same **only for a header press**: it returns
early for `.panel-dismiss` (entry 0107) and for every body target (entry 0109) *before* reaching
those two lines. So a press on the dismiss button, on a blue paperclip, or on empty panel body
leaves focus on the button or the body. Worse, the same holds at the *end* of every panel write:
committing a row repaints, the repaint removes the focused input, and focus lands on the body. The
operator types a value into a row, presses Enter, and the next thing they type goes nowhere.

This is a §5.10 violation ("always focused when the user is not editing text or a cell"), and after
a commit the operator is by definition no longer editing. It is also the one regression D-102 clause
1's disclosed cost does not cover: lifting `pointer-events` was ruled and accepted, but the
keyboard's home was not re-established for the clicks that lifting it made possible. Half of this
(the dismiss button) is entry 0107's and half is entry 0109's; both are in this batch.

**F2 — with a row's editor open, the first click anywhere on any panel is swallowed.** Sequence: an
input is open on row A; the operator presses row B's paperclip. Nothing prevents the press's default,
so focus leaves the input → `blur` → `cancel()` → `openEditor = undefined` → `paint()` →
`updatePanels` rebuilds **every** panel whole (`editing === undefined` now, so no skip anywhere) →
the paperclip the pointer is on is detached from the document. The `click` that follows therefore
reaches a delegated listener whose `clip.closest(".panel")` is `null`, and returns. Same for the
dismiss button, same across two panels. The operator must click twice, with no feedback explaining
why the first click did nothing.

Note the interaction with F1's fix: simply calling `input.focus()` on every panel press would
*cause* this blur rather than avoid it. The correct shape is (a) `preventDefault()` the press so the
DOM's own focus move never happens, and (b) move focus deliberately — to the command bar when no row
editor is open, and nowhere when one is (the row input already owns the keyboard, §5.10's own
"editing text or a cell" carve-out). With (a) in place the blur-cancel-rebuild never runs and the
click lands on a live node.

**F3 — the editor is seeded with the DISPLAY value, so committing an untouched row can silently
lose precision.** `panelRowElement` passes `row.value`, which `buildPanelModel` produced through
`describeSlotValue(..., { maxDecimals: 4 })` (D-099). Reachable today: `set circle_1.origin.x
0.123456789` — the panel shows `0.1235`; open that row's input and press Enter without typing, and
`buildPanelSetCommand` writes the literal `0.1235`. D-102 clause 4's "seeded with the current value"
cannot have meant a value the seed is not equal to. Two adjacent cases fall out of the same cause and
are *not* separately reachable today, but the fix must not make them worse:

- a literal small enough to render in D-099 clause 3's exponential form (`1e-10`) seeds text that
  `parseCommandNumber` does not accept, so committing it unchanged turns a number into a formula
  that fails to parse;
- a literal STRING seeds `"hello"` — quoted, by `describeSlotValue` — which commits as a *formula*
  holding that string, silently changing the slot's kind. No schema in today's registry gives the
  panel a string row, which is why this is a hazard and not a fourth finding. It is also the honest
  form of entry 0109's own first question; see Q-016 below rather than widening the grammar now.

**F4 — a hazard, not reachable today, worth one line of code while you are in here.** The skip gate
keys on `element.dataset.editingPath === editing.path`. If the row named by `openEditor` ever stops
appearing in the model while its object stays panelled, the gate still matches (the dataset was
written from the same string), no input exists to blur or press Escape in, and that panel freezes for
as long as the object stays selected. Nothing in today's schemas removes a non-derived path from a
live object, so this is latent — but the guard is cheap and belongs next to the one entry 0109
already added for the object leaving `panelledIds`.

## Fix list (REVISE)

1. **Restore the keyboard on every panel press** (F1). In `panelsContainer`'s `pointerdown`:
   `event.preventDefault()` unconditionally (so the DOM never moves focus on its own), then focus the
   command input **only when `openEditor === undefined`** and the press is not inside
   `.panel-row__input`. Keep the existing dismiss/header branching after that, not before it.
2. **Restore it again when an editor closes** (F1). `panelEditHandlers`' `onCommit` and `onCancel`
   both end with the row's input gone; the command bar must have the keyboard when they return.
3. **Guard the stale cancel** (F2). `onCancel` must act only while `openEditor` still names *this*
   row (`objectId` and `path`), so a blur fired by the repaint that replaced this input — or by
   opening a different row — cannot clear an editor it does not own. With item 1 this should become
   unreachable rather than merely harmless; make it correct anyway, the way `dismissPanel`'s own
   no-op guard is correct independent of how the DOM calls it (entry 0107's ratified decision 3).
4. **Seed the editor with the unrounded literal** (F3). The display value stays rounded (D-099 is not
   weakened); the *seed* must be the value as the command line would accept it back —
   `describeSlotValue` with no `maxDecimals` for a number is the existing formatter, so no fourth
   formatter is created (`STATUS.md`'s standing rule). Carry it as a separate field on `PanelRow`
   rather than making `value` ambiguous, and pin it with a test: a literal with more than four
   decimals, committed untouched, leaves the document bit-for-bit unchanged in the number it holds.
5. **Clear `openEditor` when the rebuild produced no input** (F4) — `updatePanels` already looks the
   element up with `querySelector` to focus it; `null` there means the editor cannot exist and the
   gate must not latch.
6. **Confirm 1–3 live in the browser**, the way entries 0107 and 0109 both did, and say so in the
   log: type into a row, press Enter, then type a command without touching the mouse; click a blue
   paperclip, then type a command; with an editor open, click a second row's paperclip and confirm
   it opens on the FIRST click.

Items 1–3 and 6 are the verdict. Items 4 and 5 are small, land in the same file, and this reviewer
would rather they went in with the same browser check than became fix-list debt.

## Ruling

**D-107** is appended to `DECISIONS.md`: a panel gesture may not leave the keyboard homeless, and a
handler bound to DOM that a repaint will destroy must be idempotent and identity-checked. It is the
general form of F1 and F2 together, and it binds every future control the panel grows (D-102 clause
9's drag-linking first of all).

## The implementers' decisions

Entry 0107's four — **all ratified.** Delegated listeners plus a `window`-level drag continuation is
the right shape for a surface that is rebuilt every paint, and decision 2's disclosure of it as a
new pattern in this file is exactly the right amount of noise. Decision 3's "correct on its own
terms" guard is the posture item 3 above asks you to extend. Decision 4 (two functions, not one
`patch`) is right.

Entry 0109's five — **four ratified, one narrowed.**

- **Decision 2 (the skip gate defaults to REBUILD) is the most important thing in the batch and is
  correct.** The near-miss is recorded honestly and the resulting comment at the gate is the kind
  that earns its space. F4 is the remaining sliver of it, not a contradiction of it.
- **Decision 3 (`stopPropagation` at the row input, no change at the window listener) — ratified.**
  Entry 0109's second question asks whether that reasoning is sound or a coincidence: it is sound.
  Bubbling gives innermost-first for free, and stopping at the input is the narrowest place that
  gets D-102 clause 7, §5.10's space-drag carve-out, and D-100 clause 5's order all at once. The
  same answer covers the first question: a per-row DIRECT listener is correct **because** clause 8
  keeps that one element alive, and the reasoning is load-bearing rather than lucky — which is
  precisely why F2 matters, since it is the case where the element is *not* kept alive.
- **Decisions 4 and 5 — ratified.** The `settled` flag is necessary for the reason given, and
  rebuilding a throwaway handler pair is Rule 5's correct trade.
- **Decision 1 (a panel-typed string reaches a formula slot, never a literal) — narrowed to "not
  this cycle's to widen", not endorsed.** Read as "do not invent a second grammar," it is right and
  it stands. Read as "this is the intended end state," it is not something a reviewer may settle: it
  decides what an operator can type into a box, which is product behaviour and the human's (D-042).
  Raised as **Q-016**, non-blocking, nothing tagged — no slot reachable from a panel row holds a
  string today.

## Open questions

- **Q-016 — NEW, raised here**: may a panel row write a literal string or boolean, and if so how is
  it spelled with no quoting affordance? Non-blocking, no provisional tag, nothing in today's
  schemas reaches it. It is the human's, and it will cost one branch in `buildPanelSetCommand`
  whenever they rule.
- **Q-014 — remains CLOSED.** Every ruling that answers it is built. This verdict does not reopen
  it; F1–F3 are defects in the build, not gaps in the ruling.
- **Q-008 (`-0`) and Q-012 (world units vs screen pixels) — DEFERRED again**, unchanged and blocking
  nothing. Neither is touched by this diff.
- Entry 0107's second question (does D-106 clause 6's re-show gesture exclude "narrow a
  multi-selection down to the dismissed object with a plain click"?) — **as built matches the ruling
  as written**, and this reviewer will not extend a ruling the human wrote in their own words. Left
  for the human's next session, where they will meet it in five seconds of use; noted in `STATUS.md`
  rather than ruled here.

## What happens next

**Entry 0111 — the fix list above, and nothing else.** It is one cycle in one file plus its tests;
the counter resets to 0/3 and this fix cycle is 1/3. It needs no review point of its own beyond the
usual triggers — D-103 clause 4 is discharged by *this* review, and the fixes extend the structure
it just examined.

After that, the standing next step is unchanged and is not code: **Phase 4's own gate needs a human
session** binding two polygons through a table in one document. Entry 0109 makes the linking half
doable with the mouse; F1 is exactly the kind of thing that would have made that session miserable,
which is the argument for fixing it before the session rather than after.
