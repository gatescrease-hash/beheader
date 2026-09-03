# 0158 — RULINGS (phase 5): the human's answers on the wrap residual and the load round-trip

Date: 2026-09-02   Phase: 5   Model: Opus 5 (reviewer)
Previous entry: 0157-REVIEW-phase5   Last review: 0157-REVIEW-phase5 (verdict: ACCEPT WITH EDITS)

No code written. Both items 0157-REVIEW left owed are now answered, one of them needs a binding
ruling, and one new question is raised for the cycle that follows.

## What the human answered

> *"0154: misbehaving boxes just misbehaved regardless of if they had formula references, but it's
> been mostly fixed. 0156 save/load is fine. Let's move on."*

**Two answers, and they land differently.** The load one closes cleanly. The wrap one closes a
question and opens an obligation, because the answer eliminates the candidate that required nothing
to be done.

## 1. The wrap residual — D-138

0154 ended with one question that separated its two remaining candidates: *do the misbehaving boxes
contain `{= }` references?* If yes, the difference was correct by design — the editor holds RAW
source, the canvas draws `resolvedContent`, and a longer string legitimately wraps to more lines.
The answer is **no**: it happens regardless. So the benign explanation is gone and what remains is
0154's other candidate — canvas `measureText` returning unrounded float advances against a browser
that can quantize DOM glyph advances to whole pixels, accumulating along a line.

**Ruled as D-138.** The residual is accepted as a cosmetic difference between two text-layout
engines, and nothing may compensate for it.

**Why this needed a ruling rather than a STATUS line.** 0151-RULINGS' prohibition was written
*conditionally* — "do NOT add slop to `render/measure.ts` or a compensating `letter-spacing` to the
overlay **without the human seeing the residual first**". That condition has now been satisfied. A
future implementer reading it in good faith would conclude the gate is passed and the prohibition
spent, at exactly the moment the temptation is highest: the answer removed the explanation that
required no action, so the only remaining story is "something is wrong and nobody has fixed it."
That is precisely the D-127 failure shape — a deferral to a trigger that fires without anyone
noticing it fired. D-138 re-issues the prohibition without its condition and states what would
reopen it.

The distinction 0154 drew is preserved and is the useful half of the ruling: **adopting a further
*specified* CSS rule is legitimate; tuning a number is not.** That is what makes 0154's own change
sound and a compensating `letter-spacing` unsound, and it is the test any future edit to
`layOutLines` has to pass. D-138 clause 4 states it, and requires such a change to name the CSS rule
it implements at the site.

**"Mostly fixed" is recorded as the end state, not as a debt.** Two real causes were found and
proved; the remainder has no honest fix from the measurer's side. This comes off the fix list and
off the blocking list, and stays in known problems as a disclosed property.

## 2. The load round-trip — confirmed

**0156 is confirmed on screen.** Save then load works, which is the only observable test D-126 had:
the loader rebuilds derived slots from the SCHEMA rather than the file, so a document saved by an
older build still opens. Everything else 0156 did is refusal behaviour that a correct file never
reaches, and it is pinned by the fifteen malformed shapes in `document.test.ts` plus the two positive
guards.

Entry 0156 is now **built, reviewed (0157) and confirmed on screen**. F5, F23 and F24 are fully
closed with nothing owed.

## 3. Entry 0155 is STILL unseen, and I am not recording it as confirmed

The human's answer named 0154 and 0156. It did not name 0155, and "let's move on" is a direction to
proceed, not an assertion that a test was run. So **0155 remains unconfirmed on screen** — the
phantom `""`, the ghosted cell, and the A1 headers.

It is not blocking anything and I am not holding the next cycle for it. It is reviewed and green,
its three fixes are all in tested pure functions, and the two gestures worth trying take ten
seconds between them (double-click an empty cell and click out, five times, then `props table_1`;
double-click a cell that has a value and watch for ghosting). Recorded here so that if the phantom
cell ever comes back, the log says plainly that nobody looked, rather than implying somebody did.

## 4. Q-025 raised — what the overlay shows once the canvas renders markdown

The next slice is markdown-lite, and it walks straight into the goal the whole text-box rework was
built to serve: *"there is no difference between how the text looks when you're not editing it and
how it looks when you are."* **Markdown-lite breaks that by construction.** The canvas would draw
`**bold**` as bold; a `<textarea>` can only show the six literal characters. Different strings,
different widths, different wrap points.

STATUS has carried "decide deliberately what the overlay shows" for three entries without anyone
having to decide it. The markdown cycle is where it becomes unavoidable, and it is a product
question — which representation the operator sees while editing — so it is the human's, not mine.

Raised as **Q-025** with three options and a recommendation of **(a)**: the overlay shows raw source
and is measured from raw source. Reversible, so the cycle may take it provisionally and tag every
site rather than stopping. Full text in `OPEN_QUESTIONS.md`.

## 5. Where this leaves the project

**Nothing is blocked.** Batch is 0/3, everything through 0156 is reviewed, 0154 and 0156 are
confirmed on screen, 0153 and 0152 were confirmed earlier.

Next slice, unchanged and now unobstructed: **markdown-lite rendering** — §5.6's exact list, in
`renderer.ts`'s `drawText`, with `render/measure.ts` made markup-aware **in the same cycle** so drawn
and measured agree. That cycle inherits three standing constraints and should read them before it
starts: **D-138** (do not touch the wrap residual while you are in `layOutLines` for another reason),
**D-137** (the headers of `measure.ts`, `renderer.ts` and `editor.ts` are all part of your diff —
all three currently say markup is drawn and measured verbatim, and all three stop being true), and
**Q-025** (take (a) provisionally and tag it, or get the human's answer first).

Then the **Phase 5 gate**: one executable test over one document proving §6's criterion,
`REVIEW: REQUIRED`. That is a §6.1 trigger 1 and no batch absorbs it.

## Open questions

**Raised: Q-025.** Answered: none — Q-025 is the human's. Next free: **Q-026**.
