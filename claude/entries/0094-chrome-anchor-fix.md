# 0094 — chrome anchors to the drawn extent, not to `origin`
Date: 2026-08-27   Phase: 4   Model: Claude Opus 5 (implementer)
Previous entry: 0093-visual-feedback-and-labels   Last review: 0092-REVIEW-phase3 (a ruling; last
code review was 0090-REVIEW-phase3, ACCEPT WITH EDITS)
Batch: cycle 2 of up to 3 since last review; ~700 changed lines / 5 files cumulative.

## Declared scope

Fix the defect the human found by looking at entry 0093 running in a browser: an object's chrome
anchored to `origin.x`/`origin.y`, which means different things per type, so a circle's name label
drew *inside the circle* while a table's drew above its grid. Anchor chrome to the top-centre of the
object's drawn EXTENT instead, and lay the three chrome pieces out on one measured line above the
object so nothing is drawn inside a shape and a long name cannot collide with a badge.

## Explicitly not in scope

Everything queued in STATUS.md: **D-092 clause 4's `props` command**, **D-090's prompt preview**,
**D-088 clauses 2–4** and **D-089**, §5.11's load boundary. **The `render/slots.ts` +
`render/extent.ts` split** this cycle's import cycle argues for — flagged for the reviewer below,
deliberately not taken, because it restructures two reviewed files (§4).

## The defect, and why no test caught it

`chromeAnchorPoint` read `origin.x`/`origin.y` for every type. But `origin` is not one thing
(`primitives/geometry.ts`):

| type | `origin` is | entry 0093's label landed |
| --- | --- | --- |
| circle | the **centre** | inside the shape |
| polygon | the **centre** | inside the shape |
| rect | the top-left **corner** | above-left, outside |
| table | the top-left **corner** | above-left, outside |

Every test asserted "the label is `CHROME_ANCHOR_MARGIN_SCREEN` above the anchor," which was true for
every type and passed for every type. **The defect was in what the anchor MEANT**, which an offset
assertion cannot express. It took a screenshot: `table_1` read as a title above its grid, `circle_1`
read as text stamped through the middle of the circle.

This is the third consecutive finding that needed a human eye, and the first that was not in
`main.ts`'s DOM half — so the standing lesson widens. It is not only *untested code* that is at
risk; it is *code whose tests can only check the thing it was already thinking about*.

## What I did

**`src/render/renderer.ts`**

- `chromeAnchorPoint` is now four lines: it calls `hittest.ts`'s `objectExtent` and returns
  `{ x: (minX + maxX) / 2, y: minY }` — the top-centre of the drawn box. The whole per-type `switch`
  is gone. D-066 already rules that the drawn extent and the clickable extent are ONE extent; this
  is that same extent used a third time, rather than a second reading of the same question (D-010).
- **`drawObjectChrome` now lays out one line above the top edge**: `[•x •y] name [!]`, all sharing a
  baseline. Entry 0093 drew the ticks *below* the anchor, which under the old centre-anchor meant
  inside a circle and under the new top-anchor would mean inside every shape.
- **The horizontal offsets are measured, not assumed.** `ctx.measureText(object.name).width / 2`
  places the badge and the ticks clear of the name, so a long name pushes them outward instead of
  overlapping. Entry 0093's fixed `CHROME_TICK_SPACING_SCREEN = 14` only avoided collision because
  no fixture had a badge *and* a name at once; `circle_1` centred is ~50px wide and would have
  overlapped a tick at −14px the first time both appeared.
- `drawNameLabel`/`drawErrorBadge`/`drawFormulaDrivenTicks` collapse into `drawObjectChrome` plus
  `formulaDrivenTicks(object): string`, which returns `"•x"`, `"•y"`, `"•x •y"` or `""` — the two
  ticks are now ONE right-aligned draw, so they grow leftward away from the name together.
- Removed the now-unused `ScreenPoint` import (`noUnusedLocals` is off, so `tsc` did not flag it).

**`src/render/hittest.ts`** — `objectExtent` is exported (it was private). No logic change.

**Tests** — `renderer.test.ts` is 40 tests (was 34). Both fakes gained `measureText` as a
**fixed-width fake measurer** (7px/char), which is the posture Rule 1 prescribes for the engine's
injected `TextMeasurer`, applied one layer up; it keeps every expected coordinate exact and
hand-checkable. Six existing tests changed — all six because this cycle's fix genuinely changed what
they observe, itemised below.

## Decisions I made

1. **Anchor to the extent, not to a per-type corrected origin.** The alternative — keep the `switch`
   and subtract `radius` for a circle, half-width for a polygon, and so on — re-derives per type
   exactly what `objectExtent` already computes, and would drift from it (D-066's own warning).
2. **Accepted an import cycle rather than restructure two reviewed files.** See the escalation below.
   This is the decision I am least comfortable with and the one I most want ruled on.
3. **Used `ctx.measureText` rather than a wider guessed offset.** It is the correct tool, it is on
   the real context, and faking it costs three lines. A guessed offset is a collision waiting for
   the first long name.
4. **The circle fixture gained a `vertices` slot.** Chrome now needs an extent, and `hittest.ts`
   reads a circle's extent from `vertices` (§5.5: the polygonal approximation is what bounds a
   circle). Four extreme points stand in for the real `CIRCLE_VERTEX_COUNT`-gon, whose extent is the
   same box — commented as such at the fixture.
5. **Chrome now appears exactly when a drawn extent does.** A hand-built shape with an `origin` but
   no `vertices` gets neither body-bounding-box nor label, where entry 0093 gave it a label. For
   anything built through `mutate`, `vertices` is a schema-declared derived slot and always present,
   so this is a fixture-only difference — stated in `chromeAnchorPoint`'s doc and pinned by a test.

## The six existing tests I changed, and why each was genuinely touched

**Never** weakened, skipped, or deleted — every one still asserts at least as much as before.

1. `renderer.test.ts` "strokes moveTo → lineTo → closePath → stroke, in order" — the rect fixture has
   a `vertices` slot, so it now earns a name label. The filter that already excluded `setTransform`
   and `clearRect` now also excludes `fillText`, with a comment: this test is about the world-space
   PATH, and the label has its own describe block.
2–4. Three table tests — the label's x moved from `0` (the origin corner) to `120` (centred over a
   3-column grid), which **is the fix**. One of them also asserts the badge's new measured position.
5. "draws every object's name … centred above its anchor" — rewritten to assert the extent-derived
   position under a non-identity camera, and now also pins that the SCREEN margin does not scale
   with zoom.
6. "labels a circle whose radius is missing at its origin" — retired and **replaced** by "draws no
   label for a shape with no vertices slot," which pins decision 5's stated consequence. The old
   test asserted behaviour this cycle deliberately changed; the new one asserts the new rule and
   still checks that the body draws from `origin`/`radius` independently.

`main.test.ts`'s Phase 3 acceptance test needed **only** `measureText` added to its fake — no
assertion changed. It failed with `TypeError: ctx.measureText is not a function`, which is worth
recording: adding a context member to `renderer.ts` breaks every hand-rolled fake in the repo, and
there are two.

## Verification (real output)

```
$ npx tsc --noEmit
(no output, exit 0)
$ npx tsc --noEmit -p tsconfig.engine.json
(no output, exit 0)
$ npx vitest run
 Test Files  25 passed (25)
      Tests  1148 passed (1148)
$ npm run build
 dist/index.html                 1.73 kB
 dist/assets/index-CvT6s4vw.js  81.92 kB
 ✓ built in 250ms
```

Zero skipped, zero `.only`.

**Mutation check** (three mutants, each seeded alone in `renderer.ts`, reverted after; `diff`
confirmed the file was byte-identical afterwards):

| seeded fault | tests killed |
| --- | --- |
| anchor at the BOTTOM of the extent (`maxY`) instead of the top | 12 |
| anchor at the LEFT edge instead of the centre | 10 |
| badge/tick offsets ignore the measured name width | 5 |

## ESCALATION — an import cycle I created, and the clean alternative

**`renderer.ts` now imports `objectExtent` from `hittest.ts`, while `hittest.ts` imports
`readNumber`, `asPointArray` and the `TABLE_CELL_*` constants from `renderer.ts`.** That is a module
cycle.

It resolves today because every cross-file reference on both sides sits **inside a function body**,
never at module top level, so neither module reads the other's bindings during evaluation. Both
files now carry a HAZARD note saying so, and saying what would break it: **a top-level `const` in
either file that reads the other's export would fail with a TDZ error.**

I did not fix it properly because the fix restructures two files I did not write, which §4 forbids
without a review verdict. The clean end state, for the reviewer to rule on:

- `render/slots.ts` — `readNumber`, `asPointArray`, `TABLE_CELL_WIDTH`, `TABLE_CELL_HEIGHT`.
  0064-REVIEW §5 already anticipated this file "at the THIRD consumer," and this cycle arguably is
  that third site.
- `render/extent.ts` — `WorldExtent`, `objectExtent`, `documentExtent`, importing `slots.ts`.
- `renderer.ts` and `hittest.ts` both import those two. The graph becomes a DAG.

The alternatives I rejected: computing the extent again inside `renderer.ts` (violates D-010 and
D-066 outright — two readings of one question, free to drift), and moving `documentExtent` into
`renderer.ts` (contradicts 0090-REVIEW, which accepted 0089's reasoning for keeping it in
`hittest.ts`, and which STATUS.md records as deliberate).

Rule 9's priority list is some comfort — a cycle inside `render/`, the layer the brief calls
"deliberately throwaway," is cheap to delete later — but it is still a structural wart I would
rather not have shipped silently.

## Where I got stuck / what is unfinished

- **The layout is still unseen.** Measured offsets mean the badge cannot overlap the name; they do
  not mean the result looks good. Two adjacent objects' labels can still overlap each other — there
  is no collision handling between objects and I did not invent one.
- **`CHROME_ANCHOR_MARGIN_SCREEN` and `CHROME_GAP_SCREEN` are still chosen, not measured** (Rule 5),
  like every other constant in `render/`.
- **A label sits above the extent's top edge, which for a wide flat object is a long way from the
  shape's visual "middle."** Fine for the four drawable types today; worth re-checking when
  `polyline` lands.

## Open questions raised

None. Q-012 is untouched: the chrome constants are screen pixels for a stated reason (legibility at
any zoom) that is not an answer to what a stroke WIDTH should be.

## Review point

**Fired: §6.1 trigger 4 — "you could not satisfy a hard rule cleanly and worked around it."** The
import cycle is the workaround; the ESCALATION section above is the disclosure. Also §6.1 trigger 5
in a narrow sense: six existing tests changed expectations, every one itemised above with the reason
this cycle's own change touched it.

§6.3: cycle 2 of 3, ~700 lines / 5 files cumulative since 0090-REVIEW — under the 800/10 cap, but
close on lines.

`REVIEW: REQUIRED.` The import cycle needs a ruling, and the entry-0093 defect this cycle fixes is
evidence that this area wants a reviewer's eye before more accumulates on top of it.

Questions for the reviewer:

1. **Rule on the import cycle** — take the `slots.ts`/`extent.ts` split, accept the cycle as
   documented, or a third option I did not see.
2. **Is the extent's top-centre the right anchor**, or should chrome hang from the top-LEFT of the
   extent (a title over a corner, which is what a table looked like before and the human did not
   object to)?
3. **Should labels collide-avoid between objects**, or is overlapping text acceptable until someone
   complains? I built no mechanism and Rule 5 suggests none.
