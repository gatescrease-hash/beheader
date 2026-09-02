# 0154 — wrap agreement: the measurer adopts CSS's line-breaking rules, and `overflow` is removed

Date: 2026-09-02   Phase: 5   Model: Opus 5 (implementer)
Previous entry: 0153-text-box-rework   Last review: 0150-REVIEW-phase5 (verdict: ACCEPT)
Batch: **not batched — the same standing instruction as 0153** ("Skip the typical review process and
go right to making code changes... review your own work with tests"). Small cycle: ~120 added / ~40
removed across 11 files, no new files.

## The instruction this implements

The human tested entry 0153 on screen. The verdict on the rework: *"OK, much better overall... Good
how you've implemented it."* Three notes, two of them defects:

2. **"Remove overflow options — always default to a standard overflow (see below)."** This answers
   the question 0153's STATUS left open in their name.
3. **"There is still a disagreement: The text wrapping seems to work when text has spaces, but
   refuses to break up continuous streams of text without spaces, which also sort of breaks the box
   boundaries — the text without space still respects the box limits as they get dragged, but the
   long line of text stays unaffected."** Plus: *"still having some edge cases where the text shows
   as X lines in the rendered mode but pops to X+1 lines in the editor mode."*

## Declared scope

Those two. Not in scope: markdown-lite, the load-hardening cycle (D-126/D-127/D-108), the Phase 5
gate. No new files.

## What I did

### `render/measure.ts` — the measurer now implements CSS's line-breaking rules, deliberately

This is the whole cycle. Both halves of the human's item 3 are the same defect wearing two hats:
**`layOutLines` and the editor's `<textarea>` were breaking lines by different rules.** 0153 made
them solve the same layout problem — same font size, same wrap width, same units — and that was the
big one. But the *rules applied to* that problem still differed in two places, and both are visible.

A soft-wrapping `<textarea>` lays out under `white-space: pre-wrap` + `overflow-wrap: break-word`.
`layOutLines` did neither:

1. **It never broke inside a word.** A word wider than `maxWidth` sat alone on its line and
   overflowed — stated as a deliberate choice in the old file header ("no mid-word breaking, no
   hyphenation (Rule 5; §5.6 asks for none)"). The `<textarea>` broke it between characters. So a
   URL, or a keyboard mash, drew as one long line straight out through the side of its own box on
   the canvas and as a neat block in the editor. That is the human's "refuses to break up continuous
   streams of text" AND their "sort of breaks the box boundaries" — the box grew to
   `measuredWidth`, which for such a line exceeds the width the operator dragged.
2. **It collapsed a run of spaces.** `pre-wrap` preserves every one. So `"a  b"` measured narrower
   on the canvas than it laid out in the editor, and near a wrap boundary that is exactly one extra
   line in the editor and not on the canvas — the human's "X lines rendered, X+1 lines editing".
   It also meant the canvas *drew* `"a  b"` as `"a b"`: the text visibly changed the instant the
   editor closed, which is the one thing the rework exists to prevent.

Both are now CSS's rules, to the letter:

- **`wrapChunks`** splits a hard line into `[word + the spaces that FOLLOW it]` chunks, because CSS
  puts the break opportunity *after* a space run. Every chunk concatenated is the input back
  verbatim, which is what makes the spacing survive.
- **`withoutHangingSpaces`** trims an emitted line's trailing spaces. CSS Text 3 *hangs* them: they
  take no width, cannot force a break, and are invisible. Every measurement here is of a line that
  has been through it, so trailing spaces neither widen the box nor push a word onto the next line.
- **A word that does not fit even on a line of its own is split between characters** — `break-word`,
  not `break-all`: the word first moves to a fresh line whole, and only if it *still* does not fit
  is it broken. `for..of` walks code points, so a split never halves an emoji into lone surrogates.
  A single character wider than the whole line goes on the line and overflows, which is what a
  browser does and what stops the loop from being infinite.

**This is not the "slop" 0151-RULINGS forbade, and the distinction matters.** That carry-forward
said: do not add fudge to `render/measure.ts`, or a compensating `letter-spacing` to the overlay, to
chase a DOM quirk — because `measure.ts` feeds the *drawn* box and a measurer fudge moves the canvas
to chase the overlay, backwards. Nothing here is a fudge or a tuned constant. The measurer adopts the
browser's *stated, specified* rule, so the two agree on purpose rather than by coincidence — the
same D-010 move ("one reading, shared, never two that can drift") that `layOutLines` being shared by
`renderer.ts` and the measurer already is. It also required the human seeing the residual first,
which is what that carry-forward asked for and what has now happened.

`index.html` states `overflow-wrap: break-word` and `word-break: normal` on `.text-editor` rather
than leaving it to the UA stylesheet, so the pair can never drift because a browser defaults
differently. It still does **not** set `white-space`: the `wrap` attribute (from
`editorTextStyle.wraps`) is what decides whether the box wraps at all, and an author rule would
override the `white-space: pre` that `wrap="off"` relies on — re-breaking exactly the auto-width
lines that must stay whole.

### `overflow` is removed from the `text` schema — the slot, not just its drop-down

0153 gave `overflow` a drop-down offering §5.6's `visible` / `clip` / `ellipsis`. Two of those were
never built, and 0153's own rule — a text box grows to hold its text and **never crops** — leaves
them with nothing to mean. STATUS carried the question in the human's name; they answered it:
remove.

So the slot is gone, not merely its options: `TEXT_OVERFLOW_PATH`, its `TEXT_SCHEMA` entry, its
`slotOptions` entry, and `createText`'s `DEFAULT_TEXT_OVERFLOW` write. A slot no reader consults and
no value can change is a lie in the properties panel; keeping it as decoration would be worse than
either building it or deleting it.

**A document saved while it existed still loads.** An undeclared *literal* slot is legal —
`mutation.ts`'s `findSchemaSlotKindMismatches` restricts only DERIVED positions, and its own comment
says so ("an extra literal slot is legal regardless of the schema") — so the old value rides along
untouched and simply stops being enumerated, which is what keeps a dead row out of the panel. This
is the mirror of 0153's `autoresize` migration risk and it is pinned by the same test fixture, which
happens to carry an `overflow` slot: `main.test.ts`'s "still loads a document carrying the REMOVED
`overflow` slot, keeps it inert, and shows no panel row for it".

`TEXT_SCHEMA` is back to **eleven** non-derived slots: `autoresize` took the departing slot's place.

## Consequences worth naming

- **A width grabber dragged narrower than the longest word no longer snaps back.** That was on
  STATUS's known-problems list as "the box follows its ink"; the ink now re-flows, so the box goes
  where it is dragged. The asymmetric-width rule (a set width is a FLOOR, never a ceiling) is
  unchanged and still correct — it just has far less to do.
- **0153's entry says "a set width still grows for a single word longer than the box, since
  `measure.ts` breaks between words only."** That sentence is now false. Superseded here rather than
  edited there: the log is append-only continuity.
- **`measuredWidth` can no longer exceed a numeric `width`** except in the degenerate case of a box
  narrower than one glyph. That is what keeps the drawn text inside its own box.

## Verification

- `npx tsc --noEmit` and `npx tsc -p tsconfig.engine.json --noEmit` — both clean.
- `npx vitest run` — **1641 passed / 1641**, 33 files, 0 skipped, 0 `.only`.
- `npx vite build` — clean.
- Five pre-existing tests asserted the rules this cycle deliberately reverses (no mid-word breaking,
  space collapsing, `overflow`'s twelve-path schema / creation default / drop-down). Each was
  rewritten to state the NEW rule and why, never deleted quietly.
- New: three tests for character-breaking (including the `break-word`-not-`break-all` distinction
  and the one-character-wider-than-the-line loop guard), three for whitespace (preserved, hanging,
  verbatim), one for code-point safety, two in `renderer.test.ts` proving the DRAWN text gets both
  fixes through the shared `layOutLines`, and two for the `overflow` removal.

## Where I got stuck

**The X+1 residual may not be fully closed, and I cannot see the screen.** Two causes are fixed and
proved. Two candidates remain, and they are different in kind:

1. **Platform glyph quantization.** Canvas `measureText` returns unrounded float advances; Chrome on
   Windows quantizes DOM glyph advances to whole pixels in some font/size configurations. That makes
   the DOM's line *wider* than the measurer's for the same string — always in the reported direction
   (editor wraps earlier), and cumulative over a line, so no fixed epsilon can absorb it. There is no
   honest fix from the measurer's side: matching it means guessing the platform's rounding, which is
   the fudge 0151-RULINGS forbids and which would break wherever the guess is wrong.
2. **The editor shows RAW SOURCE; the canvas draws `resolvedContent`.** A box containing
   `{= table_x.A1 }` is a *longer string* in the editor than on the canvas, so it legitimately wraps
   to more lines. This is by design — you cannot edit a reference you cannot see — but it looks
   exactly like the defect. If the human's remaining cases all contain `{= }` blocks, this is the
   answer and there is nothing to fix; `editor.ts`'s header and STATUS both already flag it as the
   markdown-lite cycle's problem to decide deliberately.

Which of the two it is, is one question to the operator: **do the misbehaving boxes contain `{= }`
references?** I have not guessed, and I have added no compensation for either.

**Nothing in this cycle has been seen on screen.** The DOM half stays untested by construction
(D-001). Every rule changed here is in a pure function that is tested; whether the browser agrees
with those rules on the human's machine is the on-screen test's question, as always.
