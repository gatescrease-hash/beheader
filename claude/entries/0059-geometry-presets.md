# 0059 — geometry presets: circle, polygon, rect
Date: 2026-08-24   Phase: 3   Model: implementer (Claude Sonnet 5)
Previous entry: 0058-REVIEW-phase3   Last review: 0058-REVIEW-phase3 (verdict: ACCEPT WITH EDITS)
Batch: cycle 1 of up to 3 since last review; ~1,134 changed lines / 5 files so far (cap 800/10) —
moot: this cycle fires §6.1 trigger 2 on its own (first file of `primitives/geometry.ts`), so a
review point is mandatory regardless of the batch cap, the same shape 0057's own cycle was in.

## Declared scope

Build `primitives/geometry.ts` — the geometry primitive's three PARAMETRIC presets (`circle`,
`polygon`, `rect`), §5.5 — with their `vertices` derived slot and the eight shared derived slots
every closed shape exposes (`centroid.x/y`, `area`, `length`, `bounds.*`). Register all three in
`primitives/schema.ts`'s `SCHEMAS` in the same cycle (no new mechanism needed — see "Decisions I
made"). `polyline`, `explode`, `addvertex`/`delvertex`, rendering, and the command line are
explicitly out of scope — see below.

## Explicitly not in scope

- **`polyline` and the editable-path slot shape** (per-vertex literal slots, a dynamic slot
  family) — deferred to the cycle that also builds `explode`/`addvertex`/`delvertex`, the
  mutations that give it a reason to exist. Mirrors `primitives/table.ts`'s own first file (entry
  0040), which deferred insert/delete to later cycles for the same reason.
- **`explode`, `addvertex`, `delvertex`** — new `mutation.ts` operation kinds. `mutation.ts` itself
  is untouched this cycle.
- **`Segment`/`closed`/`style` as slots.** §5.5's general `Path` shape names all three, but no
  preset needs them: fully parametric, always closed, and nothing consumes `style` yet (no
  renderer). Building them now would be building ahead of the phase that needs them.
- **The circle's true arc for rendering.** §5.5: the renderer draws it directly from
  `origin`/`radius`; `vertices` here is explicitly the polygonal approximation for bounds/hit-
  testing only.
- **`render/renderer.ts`, `render/hittest.ts`, `command/parser.ts`** — each its own §6.1 trigger-2
  review point (0058-REVIEW-phase3 §8), not a rider on this one.

## What I did

**`src/engine/primitives/geometry.ts` (new, 555 lines including header/comments).**

- Pure math (no `Value`/`ErrorValue`, directly unit-tested): `computePolygonVertices`,
  `computeCircleVertices` (delegates to the polygon one — §5.5's polygonal approximation, a fixed
  `CIRCLE_VERTEX_COUNT = 32`), `computeRectVertices` (matches `CanvasRenderingContext2D.
  fillRect(x,y,w,h)`'s own corner convention — PROJECT_BRIEF §2 mandates Canvas2D, so this is the
  least-surprising choice), `computeArea` (shoelace), `computeCentroid` (AREA-WEIGHTED, not vertex
  mean — see Decisions), `computePerimeterLength`, `computeBounds`. All total, including on an
  empty `Point[]` — never `NaN`/throwing.
- `Value`-aware wrappers: `computeCircleVerticesSlot`/`computePolygonVerticesSlot`/
  `computeRectVerticesSlot` (each a `DerivedSlotCompute`, reading parameter slots via a shared
  `readNumericSlots` helper, rejecting a negative radius/width/height and an under-3 or non-integer
  `sides` as `#TYPE`), `finalizeVertices` (D-025 non-finite guard per vertex), `finiteOrTypeError`
  (D-025/D-033 guard per scalar), `verticesDerivedSlots(label)` — the eight shared derived-slot
  declarations, each statically depending on `["vertices"]` (§5.1's own worked example).
- `src/engine/primitives/geometry.test.ts` (new, 457 lines, 41 tests): every pure function
  (including degenerate/empty-input totality), every `Value`-aware wrapper's error propagation
  (`#REF`/upstream-error/`#TYPE`), `verticesDerivedSlots`' propagation and computation, and — see
  Decisions — a genuinely REACHABLE `-0` case for `centroid.x`, plus two tests wiring `circle`/
  `polygon` through the REAL `mutate()` pipeline (creation, a live radius-change re-evaluation, and
  a formula-bound `radius` reading a table cell with no false cycle — Phase 4's own shape, proved
  one phase early, though no acceptance criterion is claimed).

**`src/engine/primitives/schema.ts`.** Imported `geometry.ts`'s exports; added `CIRCLE_SCHEMA`/
`POLYGON_SCHEMA`/`RECT_SCHEMA` (each `vertices` + `verticesDerivedSlots(label)`); registered all
three in `SCHEMAS`. File header's scope/NOT-DONE-HERE sections updated to name the new coverage.

**`src/engine/primitives/schema.test.ts`.** Updated the one test that asserted `circle`/`polygon`
have no schema (now false — see Decisions); added a `describe` block confirming all three real
entries have 9 derived slots and the right non-derived parameter paths.

**`src/engine/mutation.test.ts`.** Two existing fixtures used `type: "circle"` as the standing
example of "a type with no schema entry yet" (D-017's permitted exception, and `deriveEdges`'s own
honest-`undefined` test) — both now false. Switched both to `type: "polyline"` (the current
still-unregistered example), comment-disclosed in place.

## Decisions I made

1. **Centroid is the AREA-WEIGHTED polygon centroid, not the arithmetic mean of vertices.** The two
   formulas coincide for every preset this cycle builds (regular/symmetric shapes), but diverge for
   an irregular polygon — exactly what an exploded-and-dragged path becomes later. Using the
   correct formula now means `verticesDerivedSlots` stays correct unmodified when a future cycle
   reuses it for `polyline`, rather than shipping a formula that is quietly wrong for every shape
   this file does not itself build. Pinned by a test using a deliberately irregular quadrilateral
   where the two formulas give numerically different, hand-derived answers (not merely "close to
   each other").
2. **Registering `circle`/`polygon`/`rect` in `schema.ts`'s `SCHEMAS` happens in the SAME cycle**,
   unlike `table`'s dynamic family (D-017), which needed a genuinely new `schema.ts` mechanism
   before it could be registered (deferred to entry 0042). Nothing here needs one: a preset's
   parameter count never changes at evaluation time (Rule 6), so three more `static`-only entries
   are the identical shape `VALUE_SCHEMA`/`ADD_SCHEMA` already use — mechanically low-risk, and an
   inert, unregistered `geometry.ts` would not be a usable deliverable of "something must exist to
   be drawn" (0058-REVIEW-phase3 §8's own framing of this slice).
3. **`readNumericSlots` is generic over a literal key-set `K`, not a bare `Record<string, ...>`** —
   otherwise `noUncheckedIndexedAccess` types every destructured field `number | undefined` even
   though every key is written before the function returns. `K extends string` inferred from each
   call site's own object-literal keys gives the returned record real (non-optional) properties.
4. **`finalizeVertices` needed no `-0` guard after all — found by mutation-testing my own first
   draft, not planned.** My first version normalised `-0` per-coordinate defensively. Mutation-
   testing it (removing the guard) broke NOTHING, which is the signal something was already dead —
   proved algebraically (see the function's own doc comment, mirroring `render/camera.ts`'s
   `finiteOrFallback` precedent exactly): every vertex is `origin.<axis> + (...)`, and adding a
   nonzero legal number is unaffected by the other operand's sign, while adding to a legal `+0`
   always yields `+0` (IEEE754). Simplified to just the non-finite check. The SAME class of guard
   in `finiteOrTypeError` (used by `centroid.x`/`centroid.y`) is NOT dead — a zero-valued
   cross-product sum divided by a NEGATIVE signed area (clockwise winding) genuinely produces `-0`,
   and I constructed a concrete clockwise-square fixture and hand-verified it by the same formula
   before writing the test, then mutation-tested that guard too (removing it breaks exactly that
   one test). Recording this because it is exactly the "prove it, don't assume it" instinct
   PROCESS_BRIEF's own culture (D-016, D-031) asks for, caught by the process rather than by luck.
5. **`sides < 3`, non-integer `sides`, and negative `radius`/`width`/`height` are `#TYPE`,
   authoring-time-adjacent but enforced at EVALUATION time** (there is no authoring layer yet —
   `createObject` is the only way to build one). Matches `add`'s existing precedent (fail closed
   with a typed error, never throw) rather than inventing a new policy.
6. **`rotation` is radians, and a polygon's vertex 0 sits at angle = `rotation` from the +x axis
   (standard math convention, not "pointing up"), with increasing `i` at increasing angle.** §5.10's
   own `polygon` example has no `rotation` argument and the brief states neither convention.
   Reversible and disclosed — no stored data depends on it, and a future command/UI layer is free
   to present degrees and convert on the way in without touching this file.

## Verification (real output)

```
$ npx tsc --noEmit
(clean, no output)

$ npx tsc --noEmit -p tsconfig.engine.json
(clean, no output)

$ npx vitest run --reporter=dot
 Test Files  17 passed (17)
      Tests  714 passed (714)
```

714 = 670 (0058's count) + 41 new in `geometry.test.ts` + 3 net new in `schema.test.ts` (28 -> 31;
the `it.each` block's 3 new cases, since the two edited existing tests kept their own counts — one
narrowed from 3 assertions to 2 within the same `it`, one unchanged in shape). Confirmed by stashing
this cycle's changes and re-running: `schema.test.ts` alone was 28/28 on the pre-cycle tree.
0 skipped, 0 `.only`/`.skip`/`.todo`/`xit`/`xdescribe` — grepped, not assumed.

**Mutation-checked** (D-016), three separate probes, tree restored and re-verified green after each:

1. Replaced `computeCentroid`'s body with `return computeVertexMean(vertices);` (the wrong,
   simpler formula). Result: exactly 1 test failed — "is the AREA-WEIGHTED centroid... the two
   DIFFER on an irregular quadrilateral" — 39/40 passed in `geometry.test.ts`. Restored.
2. Disabled the `sides` validation (`if (false) { ... }`) AND stripped `finalizeVertices`' guard
   down to a bare passthrough, in the same pass. Result: exactly 2 tests failed — both `sides`
   tests ("below MIN_POLYGON_SIDES", "a non-integer sides") — 38/40 passed. The `-0` claim in my
   FIRST draft of `finalizeVertices` had NO test that could fail here, which is what led to
   Decision 4 above rather than shipping an untested claim.
3. After rewriting `finiteOrTypeError`'s call site to skip the `-0` check (`return value;`
   unconditionally): exactly 1 test failed — the new "normalises a computed -0 centroid.x to +0...
   a REAL -0, not a hypothetical one" test — 40/41 passed. Restored; full suite re-confirmed
   714/714, both typechecks clean.

## Acceptance criteria status

Phase 3's criterion is NOT claimed. This cycle builds one more piece (the geometry primitive's
three parametric presets) with no pixels yet.

## Where I got stuck / what is unfinished

- **My own first-draft `finalizeVertices` shipped an untested, and ultimately WRONG, claim** (that
  it needed a `-0` guard) before mutation-testing caught it had no failing test to defend it.
  Fixed in the same cycle rather than carried forward — see Decision 4 — but flagging the process
  point: I wrote the defensive code AND a test asserting "no `-0`" before checking whether the test
  could ever actually observe the guard doing something, and only the mutation-check (not writing
  the test itself) surfaced that it couldn't. The corrected version constructs a genuinely reachable
  `-0` case by hand instead.
- **`readNumericSlots`'s generic-over-`K` shape is more machinery than `add`'s two-field precedent
  needed.** Justified in Decisions #3, but it is new pattern in this codebase (nothing else uses a
  generic literal-key-inferred `Record` for this purpose) — worth a second look from whoever reviews
  this, since a simpler alternative (explicit destructuring per preset, no shared helper) was
  available at the cost of ~15 more lines of near-duplicate code across the three presets.
- **The rotation-convention and winding-order choices (Decision 6) are genuinely untested against
  the brief**, because the brief is silent on both. Reversible, disclosed, but a command-line
  `polygon` implementation later may want to reconsider whether `rotation` should be authored in
  degrees at the command layer (converting to radians on creation) rather than radians throughout.

## Open questions raised

None. No brief ambiguity rose to the level of a `Q-NNN` — every genuinely open choice (rotation
units/winding, centroid formula, `sides`/`radius` domain validation) was reversible, narrow, and
disclosed above rather than blocking.

## Review point

**Fired: §6.1 trigger 2 — first file of a new subsystem** (`primitives/geometry.ts`, first file of
the geometry primitive). Per 0058-REVIEW-phase3 §8 clause 2, this stops immediately rather than
batching. §6.1 trigger 5 also fired narrowly and is disclosed above: two existing `mutation.test.ts`
fixtures and one `schema.test.ts` fixture had their "no schema yet" example type changed from
`circle`/`polygon` to `polyline`, a necessary consequence of registering real schemas for the
former — not a silent behavioural change.

```
CYCLE 0059 COMPLETE
Slice: primitives/geometry.ts (circle/polygon/rect presets + their derived slots) + tests;
  registered in primitives/schema.ts
Files: 5 changed (src/engine/primitives/geometry.ts [new], geometry.test.ts [new], schema.ts,
  schema.test.ts, mutation.test.ts)
Tests: 714/714, 0 skipped   Typecheck: clean (both configs)
Phase 3 criterion: NOT claimed — partial progress only
Review point: §6.1 trigger 2 (first file of primitives/geometry.ts's subsystem); trigger 5 also
  fired narrowly (two changed test fixtures, disclosed above)
Open questions: none
REVIEW: REQUIRED
Reason: trigger 2 — the design choices in a subsystem's first file are the expensive ones to get
  wrong (PROCESS_BRIEF's own words)
Questions for reviewer:
  1. Is registering circle/polygon/rect in schema.ts's SCHEMAS in the SAME cycle as geometry.ts's
     own first file the right call (Decision 2), or should it have waited for a separate cycle the
     way table's registration did — even though, unlike table, no new schema.ts mechanism was
     needed here?
  2. Is the area-weighted centroid formula (Decision 1) over-engineering for what this cycle
     strictly needs (the three presets built are all symmetric, so a vertex mean would have looked
     identical in every test I could write against THEM specifically), or is building the formula
     that will still be correct once polyline exists the right call?
  3. Is readNumericSlots's generic-over-K shape (Decision 3, flagged above) worth its complexity, or
     would three separate explicit-destructuring call sites have been the better, more boring
     choice?
```
