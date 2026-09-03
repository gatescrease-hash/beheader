# 0160 — markdown-lite drawn and measured, in one cycle

Date: 2026-09-03   Phase: 5   Model: Opus 5 (implementer)
Previous entry: 0159-markdown-parse   Last review: 0157-REVIEW-phase5 (verdict: ACCEPT WITH EDITS)
Batch: cycle 2 of up to 3 since last review; ~1,390 lines / 8 source files changed so far —
**over §6.3's ~800-line cap**, and §6.1 trigger 5 fired as well (see Review point).

## Declared scope

Wire 0159's parser through the whole text pipeline in ONE cycle, so drawn and measured never
disagree: `render/measure.ts` grows a single `layOutText` producing positioned per-font runs,
`renderer.ts`'s `drawText` paints exactly those runs, and the in-place editor's overlay is measured
from RAW SOURCE (Q-025 (a), provisional). Headers of every touched file re-read per D-137.

## Explicitly not in scope

- **The Phase 5 gate test.** Its own cycle, `REVIEW: REQUIRED` (§6.1 trigger 1). This cycle makes
  the gate's `**LARGE**` honest; it does not claim the criterion.
- **The wrap residual (D-138).** `layOutLines` was opened for another reason, which is exactly the
  moment D-138 aims at. No epsilon, no fudge factor, no rounding step, no `letter-spacing`. The one
  rule adopted is a *specified* CSS one, named at its site (see Decision 4).
- **Hanging indentation for a wrapped list item**, and **escaping** (`\*`). Both disclosed in
  `markdown.ts`'s NOT DONE HERE; neither is on §5.6's list.
- **The fallback divergence between `measure.ts` and `renderer.ts`** for a broken `style.*` slot —
  still open, still awaiting a ruling on which file owns one shared set (0139-REVIEW).

## What I did

**`src/render/markdown.ts`** — gained `verbatimLines(text)`: the same hard lines with no markup
honoured. It lives beside `parseMarkdownLite` so "what a hard line is" (`/\r?\n/`) has ONE answer
and a text object's line COUNT can never depend on whether markup was read (D-010).

It also gained **CommonMark's flanking rule, reduced** — `opensEmphasis` / `closesEmphasis` /
`closerIndex`. See Decision 4; this was a real defect my own new renderer test caught.

**`src/render/measure.ts`** — rewritten around one exported `layOutText(request)` returning a
`TextLayout`: `lines`, each with `top`, `width`, `height` and positioned `LaidOutRun`s carrying the
exact `ctx.font` they draw in.

- `layOutLines` is GONE, replaced call-for-call. `request.markup` picks `parseMarkdownLite` or
  `verbatimLines`; everything after that point — chunking, the greedy fill, hanging spaces,
  code-point splitting — is shared, so there is still exactly one implementation of the wrap rules.
- `cssFont` gained an optional trailing `emphasis` (D-120's own widening move): `font-style` before
  `font-weight` before the size, the CSS shorthand's required order. Both flags false produces no
  prefix, so a plain run's font string is byte-identical to what it was before markdown existed.
- Wrapping now works over `Piece`s rather than one string. A candidate line's width is measured by
  merging adjacent same-font pieces and measuring each group once — which for a plain line is one
  `measureText` call on the whole line, bit-for-bit the old behaviour, and is why all 29 pre-existing
  measure tests pass unchanged.
- A chunk accumulates ACROSS runs, so `**bo**ld` is one word with no break opportunity in it.
- `createCanvas2dTextMeasurer` (markup-aware, the engine's) and `createSourceTextMeasurer`
  (verbatim, the overlay's) are two thin wrappers over one `createMeasurer`.

**`src/render/renderer.ts`** — `drawText` calls `layOutText` with `markup: true` and paints run by
run: `ctx.font = run.font`, then `fillText(lineLeft + run.x, originY + line.top)`. `ctx.textAlign`
is now always `left` and §5.6's alignment is arithmetic in a new `alignmentOffset` — a line made of
two fonts has no single anchor a canvas alignment could measure from. `ResolvedTextStyle.align`
narrowed from `CanvasTextAlign` to the three values it was already clamped to.

**`src/main.ts`** — builds a second measurer, `sourceMeasurer`, over the SAME offscreen context
(safe: both set `ctx.font` before every read), and hands it to `editorTextBoxSize`. Everything else
still gets `evalContext.measurer`.

**Tests.** `markdown.test.ts` 30 → 38 (flanking, `verbatimLines`). `measure.test.ts` 29 → 44 (the
markup/verbatim split, fonts per flag, heading scale and stacking, run positions, the run-boundary
word, and the source measurer). `renderer.test.ts` +5 markdown drawing tests.

**Headers re-read per D-137**, all five touched source files: `measure.ts` (rewritten), `renderer.ts`
(NOT DONE HERE now says markup IS honoured and that this file chooses no font), `markdown.ts`,
`editor.ts` (TWO sites — its NOT DONE HERE, and the INVARIANT claiming drawn and typed text lay out
the same, which is now true only for text with no markup in it), `main.ts` (the second measurer).

## Decisions I made

**1. The markup-aware measurer is the ENGINE's, so no engine file changed.** `measuredWidth` /
`measuredHeight` come from `TextMeasurer.measure`, so making the Canvas2D implementation
markup-aware makes the derived slots markup-aware with no change to `primitives/text.ts`,
`schema.ts` or anything on §6.2's load-bearing list. This is D-120's framing followed to its end,
and it is what keeps D-123 clause 5 true: the box follows the text.

**2. `layOutLines` deleted rather than kept as an adapter.** Keeping it would have left an exported
function whose only callers were its own tests. Its seven tests were ported to `layOutText` through
a `plainLines` helper — **the expectations are unchanged character-for-character; only the shape of
the call moved.** That is still a test file this cycle edited, and I count it under trigger 5 rather
than arguing it away.

**3. Heading sizes are CSS 2.1's sample stylesheet, not my taste.** `2em` / `1.5em` / `1.17em` and
`font-weight: bold` for `h1`/`h2`/`h3`, with the line height scaled by the same factor so a 32px
heading does not overlap its neighbours. §5.6 asks for headings and says nothing about their size;
D-138 clause 4 draws the line between adopting a *specified* rule and tuning a number, so the rule
is named in the constant's own comment. `` `code` `` takes the generic `monospace`, never a named
typeface.

**4. A defect my own test caught, and the rule that fixed it.** The new renderer test
`"2 * 3 and **bold"` failed: the lone `*` paired with the FIRST `*` of the `**` and silently
italicised ` 3 and `. 0159's "a marker opens when a closer exists later" was not enough. The fix is
**CommonMark's left/right-flanking rule, reduced to §5.6's markers**: an emphasis marker opens only
when followed by a non-space, and closes only when preceded by one. `2 * 3` stays arithmetic even on
a line that also holds a `**`; `a ** b ** c` is literal; `**a ** b**` closes at the last marker
rather than the space-preceded one. Again a specified rule, named at its site. Code spans are
deliberately NOT subject to it — backticks pair with any later backtick, as markdown does.

**5. The bullet is `"• "`, emitted as an ordinary run.** §5.6 asks for a list item and says nothing
about its marker. Making it a run rather than a line property means wrapping, alignment and
measurement need no list case at all.

**6. Q-025 (a) taken provisionally**, per STATUS's instruction to this cycle. The overlay shows raw
source and is measured from raw source. Tagged at three sites: `render/measure.ts`
(`createSourceTextMeasurer`), `src/main.ts` (`sourceMeasurer`), `render/editor.ts` (NOT DONE HERE).

## Verification (real output)

```
$ npm run typecheck
> tsc --noEmit && tsc --noEmit -p tsconfig.engine.json
(clean — no output, both configs)

$ npm test
 Test Files  34 passed (34)
      Tests  1767 passed (1767)

$ npx vite build
dist/index.html                 10.56 kB │ gzip:  3.89 kB
dist/assets/index-BVyoWl9B.js  122.70 kB │ gzip: 36.52 kB
✓ built in 347ms
```

0 skipped, 0 `.only`. Baseline at the start of the session was 1710/1710 in 33 files.

A throwaway smoke test (written, run, deleted — not committed) printed the layout of a realistic
block at wrap width 200 against a fake fixed-width measurer, and it is what it should be:

```
    0 | [Report]{bold 32px sans-serif}
   40 |
   60 | [Radius: 60 — ]{16px sans-serif}[LARGE]{bold 16px sans-serif}
   80 |
  100 | [• one ]{16px sans-serif}[two]{italic 16px sans-serif}[ three]{16px sans-serif}
  120 | [• ]{16px sans-serif}[code]{16px monospace}[ item]{16px sans-serif}
  140 |
  160 | [A long paragraph that]{16px sans-serif}
  ...
  box 192 240
```

## Acceptance criteria status

Phase 5 criterion — **NOT CLAIMED.** Every ingredient is now present (`**LARGE**` draws bold, the
box measures the bold text, the branch and the number have worked since 0128), but §12 requires the
criterion be expressed as an executable test over ONE document before it is claimed, and that is the
next cycle's declared slice. Nothing here should be read as the gate passing.

## Where I got stuck / what is unfinished

**The flanking defect (Decision 4) is the honest headline of this cycle.** 0159 shipped a parser I
believed was right, with 30 passing tests, and the bug survived every one of them because each test
used ONE kind of marker per line. It took wiring the parser to a renderer and writing a test about a
half-typed `**` on a line that also had arithmetic on it. That is an argument against the way I split
these two cycles: an inert module's tests agree with its author.

**Nobody has seen any of this on screen.** The layout is proved by unit tests and one printed smoke
run against a fake fixed-width measurer. Whether real bold/italic/monospace faces at real metrics
look right — and whether the CSS heading scale reads as a heading on this canvas — is exactly the
class of thing STATUS's last gotcha says to ask for eyes on. **Entry 0155 is also still unseen.**

**A known consequence I chose and did not hide (Q-025 (a)):** a text box that uses markup CHANGES
SIZE when the editor closes, because the overlay is measured from raw source and the canvas from the
rendered text. For a box with no markup nothing changes at all. (b) would trade that visible
difference for an invisible one — a box that mis-fits its own text while typing — which is the
defect the 2026-09-02 rework existed to remove. If the human prefers (b), the change is deleting
`createSourceTextMeasurer` and one identifier in `main.ts`.

**A wrapped list item has no hanging indent** — its continuation lines start level with the bullet,
not with the text. §5.6 specifies no indentation; it will still look wrong to anyone who expects
markdown.

**Two smaller things I did not chase.** A code span can swallow an emphasis closer
(`` *a `b* ` c* ``) and leave the rest of that ONE line italic. And `measure.ts`'s candidate-width
loop is O(line²) measure calls, as it always was (Rule 5).

## Open questions raised

None new. **Q-025 taken provisionally as (a)** and tagged at three sites — it remains the human's,
and answering it is cheap in either direction.

## Review point

**Fired — REVIEW: REQUIRED**, on three independent grounds:

- **§6.1 trigger 5 — test expectations changed.** Two in `renderer.test.ts`: the alignment test (the
  mechanism moved from `ctx.textAlign` to arithmetic; same pixels, different recorded call) and
  `"draws markdown-lite markup verbatim"`, which asserted the behaviour §5.6 requires this cycle to
  reverse. Plus `measure.test.ts`'s `layOutLines` block, ported call-for-call.
- **§6.1 trigger 3 — the brief is silent on three operator-visible things** this cycle had to
  decide: heading size, the list marker, and what an ambiguous emphasis marker means. Each was
  answered by adopting a specified rule rather than a preference, and each is named at its site.
- **§6.3 — the cap.** ~1,390 changed lines / 8 source files across two cycles, against 800/10.

Cycles since last review 2/3.

## Questions for the reviewer

1. **Q-025 is still the human's**, and this cycle is the one that makes it visible. Worth putting in
   front of them with the consequence stated plainly: a markup box resizes on commit.
2. Is CSS's heading scale (`2em`/`1.5em`/`1.17em`) the right adoption, or should a heading's size
   become a `style` slot later? I took the specified rule because D-138 clause 4 says to; I cannot
   tell whether 32px in world units reads as a heading on this canvas without eyes on it.
3. `markdown.ts` is a new FILE in an already-reviewed layer, not a new subsystem — the same footing
   as `textbox.ts`/`handles.ts` at 0153. If you read §6.1 trigger 2 as firing there, 0159 should
   have stopped and it did not; I would rather be told than assume.
