# 0151 — RULINGS (phase 5): the human's on-screen test of entry 0149 (text-by-pointing + the in-place editor)

Date: 2026-09-02   Phase: 5   Model: Sonnet 5 (reviewer)
Previous entry: 0150-REVIEW-phase5   Last review: 0150-REVIEW-phase5 (verdict: ACCEPT)

No code written this entry. Two binding rulings — **D-135** (the editor's scrollbars take no layout;
closes F28) and **D-136** (the editor opens on creation only when no content was given, and an
abandoned empty box is removed; closes F29, **overrules entry 0149's Decision 2**). Sequenced as
**one short editor cycle, BEFORE the load-hardening cycle.** The owed live look that 0150-REVIEW made
the gate is now done — this is what it found.

## What the human tested (0150-REVIEW's "For the human to test" script)

1. **`text`, click — empty focused box at the click point.** ✅ Works.
2. **Type past the box width — scrollbar behaviour.** ❌ The horizontal scrollbar appears *over the
   text*. Zoomed out, the operator cannot see what they are typing. → **D-135.**
3. **`text`, click, Escape without typing.** ❌ Leaves an invisible, un-interactable `text` object —
   a "mystery text object with no visual presence". → **D-136 clause 2.**
4. **`text`, click, middle-drag to pan — editor keeps focus.** ✅ Works (D-130 / D-133 hold on this
   new trigger).
5. **`text x=0 y=0 "hello"` typed whole.** ❌ Two defects: the editor opens but seeds BLANK (not
   "hello"), and Escape then leaves a `text_3` with a visible empty text-space rectangle,
   interactable but contentless — a *different* zombie shape from item 3. The human's instruction: a
   command-line `text` WITH content should just create the box and not open the editor at all. →
   **D-136 clause 1** (and the seed defect is expected to dissolve with it).
6. **`set text_1.width 200`, then edit — drawn vs typed wrap points.** ❌ Partial. The canvas
   re-wraps correctly on the `set`, but the overlay wraps a 2-line paragraph onto 3 lines — "very
   nearly, but not quite the same height or width". The scrollbar-steals-width cascade (item 2's
   root, vertical this time) is the leading suspect. → **D-135** addresses that component; see
   "Carried forward" for the residual.

Items 1 and 4 confirm the parts of D-124 / D-129 / D-130 / D-133 that were only ever tested in the
pure half. Items 2, 3, 5, 6 are the four defects.

## D-135 — the in-place editor's scrollbars take no layout

`.text-editor` is `overflow: auto` with a border-box, zero-border, zero-padding box sized to the
receiver's exact drawn extent. On Windows a real scrollbar takes ~15px of that box: horizontally it
lands on top of a one-line overlay's text (item 2), vertically it steals width from a wrapping box
and forces the re-wrap in item 6. Ruled: add `scrollbar-width: none` and the
`::-webkit-scrollbar { display: none }` twin; keep `overflow: auto` so the caret still scrolls into
view (D-129 clause 2). This is the exact remedy 0148-REVIEW's finding 1 pre-authorised as **F28** —
the on-screen test is its confirmation. Two CSS lines in `index.html`. F28 closes.

The human's own sketch — "position the scroll bar beneath the lowest point of the text" — is not
taken: a visible scrollbar needs a reserved strip, which grows the overlay past the receiver's drawn
box, the size disagreement D-129 exists to kill. Zero-layout scrollbars give the operator what they
asked for (always able to see what they type) at no such cost.

## D-136 — the editor opens on creation only when no content was given; an abandoned empty box is removed

**Overrules entry 0149's Decision 2**, which opened the editor on *every* form of `text` creation
and which 0150-REVIEW accepted-as-built while flagging it for exactly this on-screen call.

- **Clause 1:** `advance` opens the editor after a `text` creation only when
  `session.command.content === ""` — the pointing / prompt path (and an explicit `text ""`). A
  content-bearing typed command (`text "hi"`, `text x=0 y=0 "hi"`, `text hi`) creates the box and
  leaves the command bar focused. The discriminant is the command's own `content` field; no
  response-kind plumbing into `advance`.
- **Clause 2:** when the editor was opened by clause 1's path and the operator ends the edit with
  the content still empty (Escape, or a blur with an empty field), the object is deleted — through
  `executeCommand` as a `delete`, no second write path. A box that got text is kept.
- **Clause 3:** the `delete` is the whole cleanup; `nextObjectId` does not roll back.
- **Clause 4:** Decision 4 (opens UNSELECTED) is untouched — the human's "auto[-open]" is about the
  editor appearing, not selection, and no selection problem was reported.

Item 5's blank-seed bug is expected to dissolve with clause 1. The implementer MUST reproduce item 5
and confirm it is gone rather than assume it; if a blank seed survives on the double-click path,
root-cause it (0148-REVIEW recorded that path as seeding correctly).

## The editor cycle (next slice)

One cycle discharging **D-135** (`index.html`) + **D-136** (`main.ts`'s `advance` branch + the
editor's cancel/commit paths in `start`, plus a `start`-local "opened on create, still empty" flag)
+ tests. `advance` is exported and tested; the `start` half is untested by construction (D-001) and
the `delete`-on-abandon logic should sit in a pure helper `main.test.ts` can drive, the same shape
`commitTextContent` has. **Expect `REVIEW: REQUIRED`** (§6.1 trigger 3 — two fresh rulings, one of
them overruling an accepted decision). Then the human re-tests items 2, 3, 5, 6 on screen before the
load-hardening cycle starts — the gate 0150-REVIEW set still stands until the editor surface is
actually clean on screen.

Order otherwise unchanged: editor cycle → live re-test → load-hardening (D-126 + D-127 + D-108) →
markdown-lite + markup-aware measurer → `overflow` → Phase 5 gate.

## Open questions

None raised, none answered. Next free: **Q-025**.

## Carried forward — not a ruling

- **Item 6's residual.** If drawn and typed wrap points still disagree after D-135 removes the
  scrollbar's width theft, the cause is finer — canvas `measureText` vs the browser's own text
  layout at the same width, or sub-pixel `font-size` from `camera.zoom / ratio` rounding. Do NOT
  add slop to `render/measure.ts` or a compensating `letter-spacing` to the overlay without the
  human seeing the residual first: `measure.ts` feeds the *drawn* box (D-123 clause 5 — the box
  follows the text), and a measurer fudge to match a DOM quirk would move the canvas to chase the
  overlay, backwards.
- **Item 5's second zombie shape** (`text_3`, visible empty rectangle, interactable) vs item 3's
  (invisible, un-interactable) — the difference is just whether the box has a measured extent, which
  depends on whether `content` ended up `""` or `"hello"`. Both are the same F29 defect; D-136 clause
  2 removes both by removing the box.
- The properties panel / editor overlap at small window sizes — still no remedy, still not urgent.
