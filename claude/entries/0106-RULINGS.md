# 0106 — RULINGS (the human, at the 0105 review)
Date: 2026-08-31   Phase: 4   Model: reviewer (recording the human's decisions)
Previous entry: 0105-REVIEW-phase4   Last review: 0105-REVIEW-phase4 (verdict: ACCEPT WITH EDITS)

No code slice was built here. The human read 0105-REVIEW and ruled on the two things it put to
them. Both are now binding. This entry exists because `entries/` is append-only and 0105 is
already written: a ruling that arrives after a review gets its own entry rather than an edit.

## What the human said, verbatim

> 1. shift-clicking on an already selected object removes it from the selection set.
> 2. multi-select should default to showing panels for each selected object. There should be a way
>    to 'hide' panels, but the default behavior should be to show them all.

## 1 — Q-015 is CLOSED, and nothing was built wrong

Point 1 confirms **D-100 clause 4** exactly as entry 0104 built it: the conventional toggle. The
provisional was right, so there is no reconciliation to do beyond the tags themselves.

`OPEN_QUESTIONS.md`'s Q-015 is marked `ANSWERED → D-100 clause 4`. §7.4's grep was run: four sites
carried `PROVISIONAL(Q-015)` and all four are now reconciled — `render/interaction.ts`'s file
header, `pointerDown`'s doc comment, `toggleSelection`'s one-liner, and the toggle test's name.
Comment text only; no behaviour changed and the suite is unmoved.

**No `PROVISIONAL(Q-NNN)` tag remains anywhere in `src/`.**

## 2 — D-106, and it discharges D-105 clause 2 early

Point 2 confirms **D-101 clause 1**'s default (show a panel per selected object) and adds a thing
D-101 did not have: a way to hide one. Ruled as **D-106**. Its two load-bearing clauses:

- **Dismissal is per panel, and does not deselect.** The object stays selected and highlighted;
  hiding is about screen space, not about what the operator is working on. Application state, keyed
  by object id, discarded when the object leaves the selection — the same lifetime and the same
  reasoning as D-101 clause 5's manual panel positions. Re-selecting is the way back, so no panel
  manager is built (D-106 clauses 6–7).
- **A dismissed panel's object gets its canvas name label back**, and therefore `renderDocument`
  grows a second list: the highlight reads the selection, the name suppression reads the panelled
  ids (D-106 clauses 4–5). This is the general rule 0105-REVIEW's F1 was holding open — *a name is
  suppressed only where something else is showing it* — and settling it here means **D-105 clause
  2's one-cycle clock never has to run**: the next cycle removes entry 0104's interim
  "hide the panel on multi-select" and the name gap goes with it.

The one thing to say to the next implementer that the rulings do not: clause 5's second parameter
**defaults to the first**, so no existing `renderDocument` call site or test changes. Do not take
that as licence to let one list serve both passes — the two passes now answer different questions,
and the default is a statement of the normal case, not a shortcut.

## Verification

Comment-only edits. Both configs clean, **1225/1225** passed, 0 skipped, 0 `.only`.

## Next

**Entry 0107 — D-101 + D-106 together, N panels with a dismiss control.** They are one slice now:
building N panels without the dismiss control would ship the screen-space problem the human is
already anticipating, and D-106 clause 1's deadline for entry 0104's interim lands in the same
cycle. D-102 (the paperclip) still follows it, per D-103's order.
