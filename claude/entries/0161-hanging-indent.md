# 0161 — hanging indents for list items, and the human's on-screen answers

Date: 2026-09-03   Phase: 5   Model: Opus 5 (implementer)
Previous entry: 0160-markdown-render   Last review: 0157-REVIEW-phase5 (verdict: ACCEPT WITH EDITS)
Batch: cycle 3 of up to 3 since last review; ~1,600 lines / 8 source files changed so far.
**The batch cap is exhausted on both counts. This is the last cycle before review.**

## The human ran entries 0155, 0159 and 0160 on screen

Everything they were asked to look at works. Recorded here because three entries had been sitting
"reviewed and green, nobody has looked", and that is now closed:

- **Markdown-lite renders correctly** — heading scaled and bold, `**bold**`, monospace `` `code` ``,
  the bullet. Their screenshot's panel showed `measuredHeight 100` for a four-line box whose first
  line is an `h1`, which is `40 + 20 + 20 + 20` — the box is being measured from the RENDERED text,
  which is the whole point of 0160.
- **Alignment** — "works well and things show up where they should." The mechanism that changed at
  0160 (`ctx.textAlign` → arithmetic) is confirmed to draw the same pixels.
- **Line breaks** — "look good everywhere."
- **Framing / the click box** — "works well."
- **Formula + markdown** — "operates exactly as it feels like it should."
- **Save/load and zoom** — "work as expected."
- **Entry 0155** (the phantom `""`, the ghosted cell, the A1 headers) — "everything works well."
- **Entry 0153** (the eight grabbers, the resize cursor, a dragged height surviving, the
  `autoresize` toggle) — "resizing and grabbers work perfectly."

**Two answers that are rulings, not just confirmations**, and both are recorded below.

## Declared scope

One change the human asked for: **a wrapped list item hangs its continuation lines under its text**
rather than under its bullet. Plus reconciling **Q-025**, which they answered on screen, and the
headers those edits make stale (D-137). Nothing else was touched.

## Explicitly not in scope

- **The Phase 5 gate.** Still its own cycle, after this batch is reviewed.
- **Making object name labels and table headers bigger.** The human raised it and closed it in the
  same sentence — *"it seems to make the object titles and table headers for rows/columns small in
  comparison, but I wouldn't change that for now. Keep as is."* Recorded in STATUS as a DECIDED
  non-change so nobody re-opens it as a defect.
- **The wrap residual (D-138).** `wrapLine` was opened again, again for another reason. No epsilon,
  no fudge, no rounding step.

## What I did

**`src/render/measure.ts`** — the hanging indent, in three parts:

1. **`hangingIndent(line, family, fontSize, wrapWidth, measureRun)`** — zero for anything that is
   not a `list` line, otherwise the measured width of the bullet run **in the bullet's own font**, so
   the indent is exactly as wide as the glyphs drawn above it. Returns zero when the indent would be
   as wide as the box: a continuation limit of zero or less puts one character on every line, which
   is worse than no indent.
2. **`wrapLine` takes it** and narrows every line after the first (`limit()` reads `lines.length`).
   **This is the load-bearing half**: wrapping to the full width and indenting afterwards would push
   the last word of every continuation line out through the side of the box. The indent has to be
   known where the line is FITTED, not where it is drawn.
3. **`layOutText` folds it into the runs' own `x` and into the line's `width`** rather than adding a
   field to `LaidOutLine`. That way it is already inside the number `measuredWidth` reports and
   inside the number `renderer.ts` aligns by — so **`renderer.ts` needed no change at all**, and a
   right-aligned continuation still lands on the box's right edge.

**Q-025 reconciled.** All four `PROVISIONAL(Q-025)` sites now cite the human's answer instead
(`measure.ts`, `editor.ts`, `main.ts` ×2). `grep -rn "PROVISIONAL(Q-025)" src` returns nothing.
`OPEN_QUESTIONS.md`'s Q-025 is marked ANSWERED with their words quoted.

**Headers (D-137).** `markdown.ts`'s NOT DONE HERE said a continuation line "starts at the box's
left edge, level with the bullet" — false as of this cycle; it now says the indent exists and why it
is computed in `measure.ts` (only that file knows the bullet's width). `measure.ts`'s header was
restructured: `WHAT THIS IS` now points at `layOutText`, and the line-breaking rules — the CSS
`pre-wrap` / `break-word` pair, both consequences, Rule 5's limits and D-138's prohibition — moved
onto `layOutText`'s own doc comment, where the code they describe actually is. The
fallback-divergence disclosure moved to `NOT DONE HERE` as a list item; nothing was dropped.

**Tests.** `measure.test.ts` 44 → 51: the first line starts at zero and continuations at the
bullet's width; continuations wrap at the NARROWER width; the indent counts toward the line width
and so toward `measuredWidth`; an unwrapped item is not indented; a wrapped paragraph and a wrapped
heading are not indented; the indent is given up rather than the text when the bullet is as wide as
the box; the indent follows the BULLET's font even when the item's text is monospace.
`renderer.test.ts` 94 → 95: the drawn second line starts at `x = 14`, the bullet's width in the
fake, not at `x = 0`.

## Decisions I made

**1. The indent is the bullet's measured width, not a constant.** A tuned indent would be a number
with no source (D-138 clause 4's distinction, applied to a different question). The bullet's own
width is the one value that makes the continuation line up with the text above it at any font size.

**2. It is folded into `run.x`, not exposed as a `LaidOutLine.left`.** Smaller diff (PROCESS §13),
`renderer.ts` untouched, and it makes the indent automatically part of `measuredWidth` — which it
must be, or a box could be measured too narrow to hold its own indented text.

**3. I did NOT write a `D-NNN` for Q-025.** §2 is explicit that `DECISIONS.md` is the reviewer's and
that implementers MUST NEVER write to it. The human's answer is recorded verbatim in
`OPEN_QUESTIONS.md`, in this entry, in STATUS, and at each of the four code sites. **The reviewer
owes it a number.** Flagging rather than doing it.

## Verification (real output)

```
$ npm run typecheck
> tsc --noEmit && tsc --noEmit -p tsconfig.engine.json
(clean — no output, both configs)

$ npm test
 Test Files  34 passed (34)
      Tests  1775 passed (1775)

$ npx vite build
dist/assets/index-DDMIGFqc.js  123.01 kB │ gzip: 36.63 kB
✓ built in 327ms
```

0 skipped, 0 `.only`. A throwaway smoke test (run, then deleted) printed a wrapped list at width 220
with the indent shown as leading space:

```
  60 |• milk, eggs, bread and a
  80 |  very long item that has
 100 |  to wrap
 120 |• short
 140 |
 160 |A plain paragraph that also
 180 |wraps around the same width
```

The second bullet restarts at zero and the plain paragraph is unindented — the two things most
likely to have been broken by getting the "continuation" flag wrong.

## Acceptance criteria status

Phase 5 criterion — **NOT CLAIMED**, unchanged from 0160. Every ingredient is present and now
confirmed on screen, but §12 requires an executable test over one document before the claim, and
that is the next slice.

## Where I got stuck / what is unfinished

**Nothing was hard, and the risky part was the part I nearly got wrong for free.** My first instinct
was to indent at draw time, which would have wrapped every continuation line to the full box width
and then pushed it right — text out through the side of the box, which is the exact defect
`overflow-wrap: break-word` was added at 0154 to remove. It only became obvious when I asked where
the wrap limit is computed. The test `"wraps the continuation at the NARROWER width"` is there to
fail if a later cycle moves the indent back to the renderer.

**Still nobody has seen the hanging indent itself on screen** — it is proved by unit tests and a
printed smoke run against a fake fixed-width measurer, exactly like 0160 was before the human ran
it. One wrapped bullet is enough to check it.

**A centred or right-aligned list item is untested by eye and is arguably meaningless.** The indent
is inside the line's width, so a centred continuation is centred *including* its indent. That is
consistent and harmless, but nobody has decided it is what a centred list should look like, and
§5.6 does not say.

## Open questions raised

None. **Q-025 is answered and reconciled** — closed on substance, awaiting only a `D-NNN`.

## Review point

**Fired — REVIEW: REQUIRED.** The batch is at **3/3 cycles** (§6.3's first limit) and **~1,600 lines
/ 8 source files** against the 800/10 cap, and 0160's §6.1 trigger 5 and trigger 3 both still stand
unreviewed. This cycle adds no new trigger of its own — no test expectation changed, no brief
deviation, nothing load-bearing touched — but it cannot extend a batch that is already over.

## Questions for the reviewer

1. **Q-025 needs a `D-NNN`.** The human answered option (a) on screen, in their own words, and I have
   quoted them in four code sites plus `OPEN_QUESTIONS.md`. It is closed in substance and unrecorded
   in form.
2. The human's "keep as is" on name-label and table-header size is a **decided non-change**, not an
   open defect. Worth a line in the ruling so a future legibility pass does not "fix" it.
3. A centred list item's continuation is centred including its indent (see above). Does that want a
   rule, or is it correctly beneath notice?
