# 0063 — render/hittest.ts
Date: 2026-08-24   Phase: 3   Model: Claude Sonnet 5 (implementer)
Previous entry: 0062-REVIEW-phase3   Last review: 0062-REVIEW-phase3 (verdict: ACCEPT WITH EDITS)
Batch: cycle 1 of up to 3 since last review; ~400 lines / 3 files changed so far.

## Declared scope

Build `render/hittest.ts`: §5.9's "screen point -> topmost object," dispatched per-type exactly
the way `renderer.ts` dispatches drawing — distance-to-segment (with pixel tolerance, converted
via `camera.zoom`) for `circle`/`polygon`/`rect` via their shared `vertices` slot, and a bounding
box for `table`. Tests only, no wiring into `main.ts` (no `main.ts` exists yet) and no
`render/interaction.ts` (no event handling, no selection).

## Explicitly not in scope

Point-in-polygon for FILLS — nothing can be filled yet (`primitives/geometry.ts` declares no
`style` slots; `renderer.ts` never calls `ctx.fill()`), so building a fill test would test a
property no object can hold. `polyline`'s open-path distance test — no `polyline` schema exists
yet. `text`/`script`/`image` bounding boxes — same reason. Any mouse/keyboard handling or
selection state (`render/interaction.ts`). D-064's still-owed winding pinning test (0060-REVIEW
fix list item 1) — my stroke-distance test does not consume winding at all (distance-to-segment is
direction-agnostic), so this cycle is not actually the "second consumer" 0062-REVIEW anticipated;
said so explicitly in the file header rather than silently claiming it and adding an unrelated test.

## What I did

- **`src/render/hittest.ts` (new).** §5.9. Exports `hitTest(screenPoint, objects, camera)`:
  converts to world space via `render/camera.ts`'s own `screenToWorld` (D-010 — no second copy of
  that formula), then walks `objects` from last to first (z-order = array order, `renderer.ts`'s
  own disclosed reading — the LAST-drawn object is on top, so it is tested first) and returns the
  first object whose own per-type test passes. `circle`/`polygon`/`rect` share one test
  (`hitTestVerticesShape`): §5.5, verbatim, is why circle uses the polygonal `vertices`
  approximation for hit-testing even though the renderer draws it as a true arc — "the derived
  `vertices` slot yields a polygonal approximation used for bounds AND hit-testing." `table` uses a
  plain bounding-box containment test (`hitTestTable`), built from the exact
  `origin`/`TABLE_CELL_WIDTH`/`TABLE_CELL_HEIGHT` values `renderer.ts`'s `drawTable` draws with, so
  the clickable box can never drift from the drawn one. `polyline`/`text`/`script`/`image`/
  `value`/`add` never hit — none has a schema/visual definition yet, mirroring `renderer.ts`'s own
  stance exactly (a click cannot land on something never drawn). Same switch-with-exhaustiveness
  idiom `renderer.ts`'s `drawObject` uses (0062-REVIEW edit 1), so a new `ObjectType` is a compile
  error here too.

  `STROKE_HIT_TOLERANCE_SCREEN_PIXELS` (exported, = 5) is §5.9's own "pixel tolerance," converted to
  world units via `camera.zoom` at the point of use — this is unconditional on §5.9's own words and
  does not depend on Q-012's still-open world-vs-screen question for a drawn stroke WIDTH (a
  different property of a different thing).

- **`src/render/hittest.test.ts` (new).** 15 tests: stroke-distance hits/misses on a square (all
  three vertex-shape types share the test — parameterised over `circle`/`polygon`/`rect`), the
  pixel-tolerance-to-world-units conversion under a non-1 zoom, never-throws on a missing/
  `ErrorValue` `vertices` slot, the table bounding box (default `(0,0)` origin and an explicit one),
  topmost-wins for two overlapping objects, `undefined` for an empty list and for a miss, and that
  every schema-less type never hits regardless of point.

- **`src/render/renderer.ts` (small, additive edit — no logic change).** Exported four things
  `hittest.ts` needed and would otherwise have had to re-derive: `readNumber`, `asPointArray`,
  `TABLE_CELL_WIDTH`, `TABLE_CELL_HEIGHT`. Each kept its exact existing body; only the `export`
  keyword and a one-sentence addition to its doc comment naming the new consumer were added. This
  is D-010's "declare once" principle applied across the file boundary it was always going to cross
  once hit-testing needed the same slot-reading logic the renderer already had — not a refactor of
  logic PROCESS_BRIEF §4 would flag, since nothing about what either function computes changed.
  Checked D-065 while here: the one existing comment naming `render/hittest.ts` (`renderer.ts`'s own
  "Hit-testing (`render/hittest.ts`)... this file only draws") already describes what renderer.ts
  itself does, not what hittest.ts lacks, so it stays true unchanged — nothing to fix.

## Decisions I made

1. **Circle hit-tests via its polygonal `vertices`, never a true-circle distance formula.** §5.5
   says this explicitly for hit-testing (unlike drawing, where it says the opposite) — not a
   judgement call, a direct instruction. Keeping `circle`/`polygon`/`rect` on one code path is also
   what lets a new `ObjectType`'s exhaustiveness check catch a forgotten case here the same way it
   does in `renderer.ts`.
2. **Table hit-testing is a bare containment check, no tolerance.** §5.9 assigns "pixel tolerance"
   to strokes/open paths and "bounding box" to tables/text/images/scripts as two different
   categories in the same sentence; a table's box either contains the point or it doesn't.
3. **Reused `renderer.ts`'s `readNumber`/`asPointArray`/cell-size constants rather than
   re-declaring them.** Considered writing a local copy of the `Point[]`-narrowing check instead
   (avoids touching an already-reviewed file at all), but D-010's "declare once" principle and this
   project's repeated "widen the existing mechanism, never add a parallel one" stance (D-020/D-026/
   D-027/D-031) argue the other way once a second file needs the identical narrowing logic. Chose
   reuse; disclosed the edit's shape above so it's checkable as non-refactoring.
4. **Did not write a local copy of `geometry.ts`'s private `edgePairs` wraparound.** It is a two-line
   loop; re-deriving it locally (rather than exporting a helper from a load-adjacent engine file
   just for this) is the smaller cross-file footprint, and the two implementations cannot drift out
   of sync in a way that matters (both walk the same closed-loop invariant over an arbitrary
   `Point[]`). Named as a deliberate NON-copy in the file's own doc comment so a future reviewer
   doesn't mistake it for an oversight.
5. **Did not add D-064's winding pinning test.** See "Explicitly not in scope" above — my code does
   not consume winding, so adding an unrelated test here would be scope creep dressed as diligence.
   Fix list item 1 (0060-REVIEW, carried at 0062-REVIEW) stays open.

## Verification (real output)

```
$ npx tsc --noEmit
(exit 0, no output)
$ npx tsc --noEmit -p tsconfig.engine.json
(exit 0, no output)
$ npx vitest run
 Test Files  19 passed (19)
      Tests  747 passed (747)
```

732 (prior) + 15 (new `hittest.test.ts`) = 747. Zero skipped, zero `.only`.

## Acceptance criteria status

Phase 3's own criterion ("create a polygon and a table by command, see both drawn, pan/zoom,
select, and drag the polygon") is NOT claimed — no command line, no `main.ts`, no drag exist yet.
This slice's own scope (§5.9's hit-testing sentence) is demonstrated by `hittest.test.ts`'s 15
tests, each named for the specific clause it pins (stroke tolerance, its zoom conversion, the
table bounding box, topmost-wins, never-throws, no-schema-no-hit).

## Where I got stuck / what is unfinished

Nothing got stuck. One thing deliberately left for the reviewer to weigh rather than deciding
myself: whether reusing `renderer.ts`'s four exports (Decision 3) is the right call versus a
reviewer who'd rather `hittest.ts` have zero edits to already-reviewed files, even at the cost of
duplicating a five-line narrowing function. I judged the cross-file duplication worse; said so
above rather than picking silently.

## Open questions raised

None. Q-012 (world-vs-screen for a drawn stroke width) is untouched by this cycle — the hit-test
tolerance it might have looked related to is unconditionally screen-space per §5.9's own words, so
no ambiguity to raise.

## Review point

Fired: §6.1 trigger 2 — `render/hittest.ts` is the first file building hit-testing, a subsystem
with no prior reviewed code of its own to extend (0062-REVIEW §10 named this file as exactly that,
the same posture `renderer.ts` itself was reviewed under). Cycle 1/3 since last review; diff ~400
lines / 3 files (cap 800/10) — well under the cap, but the trigger fires regardless of the cap.

REVIEW: REQUIRED
Reason: §6.1 trigger 2 (first file of a new subsystem).
Questions for reviewer:
  1. Decision 3 (exporting `renderer.ts`'s `readNumber`/`asPointArray`/`TABLE_CELL_WIDTH`/
     `TABLE_CELL_HEIGHT` rather than duplicating them in `hittest.ts`) — right call, or should
     `hittest.ts` stand alone with its own copies?
  2. Decision 4 (NOT exporting `geometry.ts`'s private `edgePairs` and instead writing a local
     closed-loop walk in `hittest.ts`) — consistent with Decision 3, or should both cross-file
     reuses land the same way?
