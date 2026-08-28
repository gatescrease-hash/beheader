# 0093 — visual feedback + name labels
Date: 2026-08-27   Phase: 4   Model: Claude Sonnet 5 (implementer)
Previous entry: 0092-REVIEW-phase3   Last review: 0092-REVIEW-phase3 (no verdict — a ruling, not a
code review; last code review was 0090-REVIEW-phase3, ACCEPT WITH EDITS)
Batch: cycle 1 of up to 3 since last review; ~534 changed lines / 3 files.

## Declared scope

Widen `renderDocument` to draw §5.9's three feedback pieces (selection highlight, error badge,
formula-driven indicator — **D-068**) and D-092 clause 1's screen-space name label, for the four
object types that currently draw (circle/polygon/rect/table). `main.ts` is touched only to pass
`state.interaction.selectedObjectId` through.

## Explicitly not in scope

**D-090's prompt-sequence preview** — needs `state.pending` reaching this file, which is new
`main.ts`/`AppState` plumbing and a materially different task (per-command preview geometry) from
what this cycle does; 0092-REVIEW §5 explicitly authorized this split. **D-092 clause 4's `props`
command** — a different file (`commands.ts`), queued next. **D-088/D-089** (command input
behaviour) and **§5.11's load boundary** — unrelated files, unrelated rulings.

## What I did

**`src/render/renderer.ts`** — `renderDocument` gained a sixth, optional parameter,
`selectedObjectId?: string`, and now runs three passes instead of two:

1. Clear, apply the camera transform, draw every object (unchanged).
2. **Selection highlight**, in a separate pass after every object (never inline with the per-object
   loop), so it is never occluded by a later object in z-order. Re-strokes the SAME path
   `drawObject` built — `buildCirclePath`/`buildVerticesPath` are `drawCircle`/`drawVerticesShape`'s
   own path-building logic, factored out so the highlight can never disagree with what is actually
   drawn (D-010). A table has no single stroked path, so it is highlighted as its whole grid extent
   instead, read with the same `?? 0` fallback `drawTable` uses.
3. **Screen-space chrome**, after a second identity reset: a name label (D-092 clause 1, centred
   above the object's anchor point), an error badge (any slot holding an `ErrorValue` — `#!`), and a
   formula-driven indicator (`•x`/`•y`, when `origin.x`/`origin.y`'s slot kind is `"formula"`). The
   anchor point (`chromeAnchorPoint`) is the SAME point the object is drawn at — circle/polygon/rect
   need `origin.x`/`origin.y` to draw at all, so their chrome anchor is exactly as present as their
   body; table's anchor uses the same fallback its grid does. A type with no schema (`polyline`,
   `text`, `script`, `image`, `value`, `add`) gets no anchor and no chrome, same as it gets no body.

The formula-driven indicator is read narrowly — `origin.x`/`origin.y` only, the two component slots
`render/interaction.ts`'s per-component drag actually moves. Documented explicitly in NOT DONE HERE:
a future per-vertex drag path or a `style` slot bound to a formula gets no indicator yet.

The file header's former HAZARD note ("ctx is left holding the camera transform on return... owned
by whichever cycle first draws screen-space chrome") is corrected — that cycle is this one, and
`ctx` is now left at identity, which the header states as a plain invariant rather than a hazard.

**`src/main.ts`** — one line: `renderDocument`'s call in `paint()` now passes
`state.interaction.selectedObjectId`. This file resolves no name and draws no chrome — the same
D-082 clause 4 discipline every other effect in this file already keeps.

**Tests** — `src/render/renderer.test.ts`: 16 new tests across four new `describe` blocks (name
label, selection highlight, error badge, formula-driven indicator), plus three EXISTING table tests
updated to reflect the label/badge fillText calls a table now genuinely produces (see Decisions
below). `src/main.test.ts` untouched — the one-line wiring in `paint()` is inside `start`, the
half of `main.ts` no test reaches (STATUS.md's standing note), same as every other DOM listener in
that function.

## Decisions I made

1. **The highlight re-strokes the object's own path rather than computing an independent outline.**
   `buildCirclePath`/`buildVerticesPath` are factored OUT of `drawCircle`/`drawVerticesShape` for
   this reason (D-010) — a bounding-box highlight risked disagreeing with the true arc a circle
   draws (§5.5's own deliberate distinction between `vertices`' polygonal approximation and the real
   shape).
2. **A table selected highlights as one box around the whole grid, not per-cell.** Simplest reading
   of "this object is selected" for something with no single path; consistent with `hittest.ts`'s
   own `documentExtent` treating a table as one box.
3. **The three EXISTING table tests I updated were genuinely touched by this change**, not a silent
   refactor: a table with no origin now legitimately draws a name-label `fillText` call (at the same
   `(0,0)` fallback `drawTable` already used), and one of the three tables in question also holds an
   `ErrorValue` cell, which now genuinely earns a badge (`objectHasError` scans every slot, per
   §5.9's own wording — "objects holding `ErrorValue`s," not "cells this file already draws"). I
   updated the expected arrays to the new true behaviour rather than filtering my new calls out of
   the assertion, because the alternative would leave three tests silently blind to a real feature.
4. **Chrome constants are screen pixels, not world units** — the opposite of every existing stroke
   constant in this file (PROVISIONAL(Q-012) reads those as world units). Chrome text must stay one
   legible size at any zoom; a world-unit label would vanish at low zoom and swamp the canvas at
   high zoom, which defeats D-092's whole purpose.
5. **The formula-driven indicator's glyphs are literal `"•x"`/`"•y"`, not an icon.** Considered a
   single generic marker at the origin point, but a bare dot cannot say WHICH axis is driven, and
   §5.9's own "per-component" philosophy (constrained-axis dragging) is exactly the distinction that
   matters here. Legible beats subtle when nothing else exists yet (Rule 5).
6. **All chrome offset constants (6px margin, 14px tick spacing) are chosen, not measured** — the
   same disclosed-untuned posture every other constant in this file takes (`FIT_VIEWPORT_FRACTION`,
   `DEFAULT_SHAPE_STROKE_WIDTH`, `TABLE_CELL_WIDTH`, …). Nobody has seen these in a browser yet.

## Verification (real output)

```
$ npx tsc --noEmit
(no output, exit 0)
$ npx tsc --noEmit -p tsconfig.engine.json
(no output, exit 0)
$ npx vitest run
 Test Files  25 passed (25)
      Tests  1142 passed (1142)
$ npm run build
 dist/index.html                 1.73 kB
 dist/assets/index-DFbqKyNq.js  82.22 kB
 ✓ built in 249ms
```

Zero skipped, zero `.only`.

**Mutation check** (two mutants, each seeded alone in `renderer.ts`, reverted after):

| seeded fault | tests killed |
| --- | --- |
| selection highlight always draws (ignores `selectedObjectId` match) | 8 |
| `objectHasError` always returns `false` | 2 |

A third attempted mutant (dropping the `table` case from `chromeAnchorPoint`) did not apply — a
multi-line `sed` pattern failed to match and the file was verifiably unchanged (`diff` confirmed);
not reported as a kill.

## Acceptance criteria status

Not a phase-gate cycle. This is additive work inside Phase 4 (already open per 0091-REVIEW), closing
part of the gap **D-092** named: object → name is now visible on screen (clause 1), and §5.9's three
feedback pieces (D-068) are built for the first time. **Nobody has seen any of this in a browser.**
That qualification is now a standing one for this codebase (0090-REVIEW, 0091-REVIEW) and applies in
full here — the exact pixel offsets, whether `•x`/`•y` reads as intended, and whether the label
collides with the badge on a long name are all things only a human session can actually judge.

## Where I got stuck / what is unfinished

- **Nothing.** The scope held to what was declared; no dead end, no abandoned approach.
- **The chrome layout is unvalidated by eye.** Label centred above anchor, badge to its right at the
  same height, ticks below — chosen for non-overlap under `circleObject`'s default fixture, not
  measured against a real name or a real crowded canvas.

## Open questions raised

None. Q-012 (world vs screen units) is untouched by this cycle — chrome deliberately does NOT take
a side in it (chrome text is screen-space by a different, stated reason: legibility at any zoom, not
an answer to what a stroke WIDTH should be).

## Review point

**Fired: none — batching.** No §6.1 trigger: not a phase gate, not the first file of a new
subsystem (`renderer.ts` and `main.ts` both have prior reviewed code), no brief deviation, no hard
rule left unclean, no test's expectations changed except where this cycle's own feature genuinely
touched them, no new dependency. §6.3: cycle 1 of up to 3, ~534 lines / 3 files — well under the
800/10 cap.

`REVIEW: NOT NEEDED` for this cycle alone. Recommend batching with the next cycle (D-092 clause 4's
`props` command, queued in STATUS.md) before requesting review, per §3's batching allowance —
unless the human wants to see this rendered before more accumulates, given how much of the last two
reviews came from things only a running browser revealed.
