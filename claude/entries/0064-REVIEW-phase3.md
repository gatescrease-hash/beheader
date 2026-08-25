# 0064 — REVIEW (phase 3)
Date: 2026-08-24   Phase: 3   Model: Claude Opus 5 (reviewer)
Previous entry: 0063-render-hittest   Reviewing: entry 0063 (`render/hittest.ts`)
Trigger: §6.1 item 2 — first file of the hit-testing subsystem.

Diff reviewed: `27c57fb..5050908` — `src/render/hittest.ts` (new, 219 lines),
`src/render/hittest.test.ts` (new, 154), `src/render/renderer.ts` (+28/-8), plus `STATUS.md` and the
log entry. 3 source files, ~400 lines, matching the log's own claim.

## 1. Rule audit

Rules 2, 3, 4, 6, 7 — not touched. `hittest.ts` reads document state and writes none; it stores no
addresses, adds no evaluator, changes no slot set, and creates no edges.

**Rule 1 — upheld, and the layering claim is stronger than it looks.** `hittest.ts` sits in
`render/` and imports `engine/*` one-way; grep for `document.`/`window.`/`canvas` across `engine/`
returns only the header lines that state the prohibition and three prose uses of the word. Nothing
imports `hittest.ts` yet. Worth recording because the file's header makes an unusual and correct
argument: this file touches no canvas at all and is structurally engine-shaped, but it lives in
`render/` because it depends on `CameraState`/`screenToWorld`, which Rule 1 forbids `engine/` from
depending on in the other direction. That is the right call — the alternative (a "pure geometry"
module in `engine/` that hit-testing calls) would have put screen-space tolerance arithmetic one
import away from the layer that must never know about screen space.

**Rule 5 — upheld.** No spatial index, no bounding-box prepass, no early-out beyond the linear
last-to-first scan. A linear walk over every object per click is the dumbest correct implementation
and it is the one that is here.

## 2. Invariant audit

Not touched: slot set fixed during evaluation, derived slots inside the topological pass, eager and
total dependency extraction, rejection leaving prior state unchanged, no dangling edges. This file
participates in none of them.

**Never throws — upheld, and tested from both directions.** Every slot read funnels through
`renderer.ts`'s `readNumber`/`asPointArray`; a missing, wrong-typed, or `ErrorValue` `vertices`
makes that one object never hit without aborting the scan, and `distanceToSegment` falls back to
point-to-point distance for a zero-length segment rather than dividing by zero. Two tests assert
`not.toThrow()` and the `undefined` result together, which is the pairing that actually pins it.

**Graph state plain and serializable — upheld.** `hitTest` returns the `GraphObject` it was handed,
by reference, not a wrapper or an index. The caller (`interaction.ts`) will want the object's `id`
and should take it from the returned object rather than holding the object itself across a
mutation — noted in STATUS Gotchas, not a defect here.

## 3. Spec conformance (§5.9, §5.5)

Checked against the brief's own words rather than the log's paraphrase.

- **"screen point → topmost object"** — correct. Walks last to first; z-order is array order, the
  same reading `renderer.ts` draws under (forward), so the last-drawn object is tested first. The
  two files agree, and a test pins it with two overlapping tables.
- **"distance-to-segment with pixel tolerance for strokes"** — correct, and the tolerance is
  converted from screen pixels to world units at the point of use. The zoom-conversion test
  discriminates in both directions: an un-converted tolerance and a multiplied-instead-of-divided
  one each fail it. The file's refusal to let this depend on Q-012 is right — §5.9 says "pixel
  tolerance" outright, and a hit tolerance is a property of the pointing device, not of the shape.
- **"the derived `vertices` slot yields a polygonal approximation used for bounds AND hit-testing"
  (§5.5)** — quoted verbatim and applied. `circle` hit-tests via its 32-gon while `renderer.ts`
  still draws a true arc. This is exactly the kind of clause §9 of the process brief warns gets
  quietly normalised away ("surely the circle should use a radius test"), and it was not.
- **"bounding box for text/tables/images/scripts"** — correct for `table`, built from the same
  origin and cell-size values `drawTable` draws with. I checked `drawTable`'s own arithmetic: cells
  run `originX + (column-1) * WIDTH` for `column` in `1..cols`, so the drawn extent is exactly
  `cols * WIDTH` by `rows * HEIGHT`. The boxes agree. **One defect inside this clause — §4,
  Finding 1.**
- **"Point-in-polygon for fills"** — deferred; nothing can be filled. Correct, and now ruled once
  and for all as **D-067** so it stops being re-argued every cycle.

## 4. Findings and edits

### Finding 1 — a table that draws nothing is clickable. Fixed; ruled as D-066.

`hitTestTable` computes an inclusive-bounds containment test over a box that can be degenerate.
`getTableDimensions` fails safe to `0` for an absent or non-`literal` dimension (D-046), and
inclusive bounds contain the boundary — so a zero-extent box is not empty, it is a line or a point.
Probed:

```
rows: 0, cols: 3   click world (120, 0)  -> HIT   (box is the line y=0, x in [0,240])
rows: 0, cols: 3   click world (120, 1)  -> undefined
slots: {}          click world (0, 0)    -> HIT   (box is the single point (0,0))
```

`drawTable` draws neither: both loops run zero times. So a click on empty canvas selects an
invisible object, silently — no message, no error value, nothing in the journal — and the next drag
moves something the user cannot see. The file's own header states the principle it broke here: "a
click cannot land on something that is never drawn."

The near-miss is worth naming. Entry 0063's test *"returns undefined when nothing is under the
point"* builds the `slots: {}` table — the exact defective fixture — and probes it at `(9999, 9999)`,
where it passes. A degenerate-extent test has to be taken at the ORIGIN of the degenerate box; taken
anywhere else it confirms the bug.

**Edit:** a `width <= 0 || height <= 0` guard in `hitTestTable`, its doc comment corrected (it had
claimed the opposite — "collapses to a zero-area box that no point can ever fall inside"), and two
tests added at the origin of each degenerate case. The inclusive bounds are correct and stay: a real
table's boundary is exactly where its outermost cell rect is stroked. Ruled as **D-066** rather than
only fixed, because `text`/`image`/`script` bounding boxes are all coming and all have the same
degenerate case waiting.

### Finding 2 — at `camera.zoom` of 0, every shape hits everywhere. Recorded, deliberately NOT fixed.

`strokeToleranceWorld` is `5 / camera.zoom`, so an unclamped loaded camera with `zoom: 0` makes the
world tolerance `Infinity`. `distanceToClosedPolyline`'s `Infinity` sentinel — documented as
"never satisfies any real tolerance" — then satisfies it, since `Infinity <= Infinity`. Probed: a
click at any screen point returns the topmost `circle`/`polygon`/`rect`.

This is D-062's known gap, not a new one, and 0062-REVIEW §9 already ruled that the clamp goes at
`main.ts`'s boundary and NOT inside `renderDocument` — which applies identically here. Adding a
guard in `hitTest` would contradict that ruling and split the clamp across two files. So: recorded,
not fixed. What I did change is the two comments that overstated the safety — the sentinel is safe
against any FINITE tolerance, which is a precondition, not a property. The consequence is now stated
in the file header's PRECONDITION block, because it is worse here than in `camera.ts`:
`screenToWorld` degrades to a useless point, `hitTest` degrades to selecting the wrong object on
every click.

### Finding 3 — two comment inaccuracies. Fixed.

- `hittest.test.ts` described the fixture's top edge as `(0,0)-(10,0)`. The square is 20x20; the
  comment survived the widening its own `squareObject` doc explains. Corrected to `(0,0)-(20,0)`.
- The header cited "0060-REVIEW §10 names this file as the next one." 0060-REVIEW §10 names
  `renderer.ts` as the next slice and lists this file among those remaining; 0062-REVIEW §10 is the
  one that names it next. Corrected. Small, but a citation that sends a reader to the wrong entry is
  the cheap kind of legibility debt to fix while it is one line.

### Not a finding — `edgePairs` duplicated rather than imported (implementer question 2)

Correct as built, and the asymmetry with question 1 is principled rather than inconsistent. What
`readNumber`/`asPointArray`/`TABLE_CELL_*` share is a CONTRACT whose drift is silent and behavioural
— a changed cell size would move the picture and leave the click box behind. What `edgePairs` shares
is a two-line closed-loop walk whose "drift" is not observable: both implementations iterate
`i, (i+1) % length` over an arbitrary `Point[]`, and there is no third behaviour to drift into.
Against that, exporting a private helper out of `primitives/geometry.ts` to serve `render/` widens a
load-adjacent engine file's public surface for a render-layer convenience. Keep both as they are.

## 5. Answers to the implementer's questions

**Q1 — reuse `renderer.ts`'s four exports, or duplicate them in `hittest.ts`? Reuse. Right call.**
I verified the edit is what the log claims: four `export` keywords and four doc-comment sentences,
every function body byte-identical, no logic touched. That is not the refactor §4 forbids. D-010's
"declare once" is the governing principle and the drift it prevents here is real and silent.

One shape to watch, not a defect: `readNumber` and `asPointArray` are slot-reading helpers, not
renderer concerns, and `hittest.ts` now imports them from `renderer.ts` — so `render/` has a de
facto utility module that happens to be named after drawing. `interaction.ts` will want the same
reads. **Trigger, so nobody re-litigates it per cycle: at the THIRD consumer, extract them into
`render/slots.ts` and re-export nothing.** At two consumers the extraction is churn; at three it is
overdue. Not owed by this cycle.

**Q2 — should the `edgePairs` non-copy land the same way as Q1?** No. See §4's "Not a finding."

## 6. Fix list item 1 closed at this review — D-064's winding test now exists

Owed since 0060-REVIEW, carried at 0062-REVIEW, and correctly declined by entry 0063 (a
distance-to-segment test does not consume winding — that reasoning is right and I am not overruling
it). It had been carried three reviews on the argument that the next cycle would be its natural
home, and the next cycle keeps not being. Written here instead, as four tests in
`geometry.test.ts`: strictly positive doubled signed area for `polygon` across rotations
`0, 1, -1, 2.5, π` and 3/5/12 sides, for `circle`, and for `rect`, plus exactly zero for the two
degenerate shapes. It asserts the winding of the vertex ORDER every consumer reads rather than
calling `computeSignedAreaDoubled`, which stays private.

All four pass as written — D-064's claim is now pinned, not merely asserted. What the fill cycle
still owes is the point-in-polygon test itself (D-067 part 3), against a winding it can now trust.

## 7. Legibility audit

Headers present, layer and allowed imports stated, brief sections cited. Vocabulary locked
throughout — "object", "slot", "derived", "preset", "camera", "vertices"; no "node", no "property",
no "shape" used as a synonym for object. Zero `any`. Test names are behaviour sentences that name
the clause they defend. D-060/D-063 clean in both new files: no diary comments, no "this cycle",
every header sentence in the present tense. D-065 discharged honestly — I re-ran the sweep the log
claims it ran, and `renderer.ts`'s one sentence naming `hittest.ts` describes what `renderer.ts`
does, so it did not go stale.

**Header budget.** `hittest.ts`'s header is 86 lines against §5.2's 20-40 for an ordinary file, and
this file is correctly NOT self-declared load-bearing. I am not billing this cycle for it, on
0060-REVIEW §4's stated precedent: `renderer.ts` is 104, `geometry.ts` 104, `mutation.ts` 151, all
accepted post-audit. The overrun is codebase-wide and structural, not this cycle's invention, and
every block here is carrying §5.2's keep-regardless material — hazards, deferrals with owners,
invariants, one rejected alternative. But it is now the third consecutive review to say "not this
cycle's bill," which is how a systemic defect becomes permanent. **Recommendation to the human, not
a ruling: a dedicated header-budget audit pass, scoped like entry 0055's, is worth one cycle before
Phase 4.** The one place it would pay for itself immediately is the per-type dispatch block, which
restates in the header what three function doc comments say ten lines below it.

## 8. Honesty audit

The log matches the diff. I re-ran everything rather than reading the pasted output:

```
$ npx tsc --noEmit                              -> exit 0, no output
$ npx tsc --noEmit -p tsconfig.engine.json      -> exit 0, no output
$ npx vitest run                                -> 19 files, 747 passed (747), 0 skipped
```

747 confirmed, 19 files, `hittest.test.ts` contributing 15 — the log's arithmetic (732 + 15) is
right. No `.only`, no `.skip`, no `todo` anywhere in `src/`. Batch accounting (cycle 1/3, ~400
lines, 3 files) is accurate. No scope expansion: the `renderer.ts` edit is disclosed, minimal, and
exactly what it is described as, and nothing outside the declared slice was touched.

Two things I want to credit specifically, because both are the honest move rather than the
flattering one. Entry 0063 declined D-064's winding test and said plainly that its own work is not
the "second consumer" 0062-REVIEW anticipated — that reasoning is correct and the review's
expectation was the thing that was wrong. And Decision 3 was escalated rather than settled quietly,
which is exactly the §7 posture. Neither is padding.

The one thing the log overstates is the `hitTestTable` doc comment's zero-area claim (Finding 1) —
written as a property the code has, when it was the property the code lacked. Stated as an
observation, not a charge: it reads as a genuine mistake about inclusive bounds, not as an
optimistic completion claim.

## 9. Open questions

- **Q-012** (world vs screen for stroke width / cell size / font size) — remains OPEN, deferred,
  unchanged by this cycle. Entry 0063 is right that the hit tolerance does not touch it: §5.9 says
  "pixel tolerance" outright. Still comes due with the `style`-slots cycle.
- **Q-008** (`-0` as legal document state) — remains OPEN, deferred, blocking nothing. Untouched.
- **Q-001 / Q-002** — still come due at `command/parser.ts`, which is now two slices away.
- Q-003 through Q-007, Q-009 through Q-011 — answered or deferred at earlier reviews; nothing in
  this diff reopens any of them.

No new questions raised by this cycle, and none needed. Next free: **Q-013**.

## 10. Where Phase 3 stands, and the next slice

One of the four §6.1-trigger-2 files remains before the gate: `render/interaction.ts`, then
`command/parser.ts`. `interaction.ts` is the right next slice — hit-testing now answers "what is
under this point," and interaction is what decides what to do with the answer.

Four things that cycle carries in from here.

1. **Dragging calls the mutation API, per component (§5.9)** — a `literal` component writes, a
   `formula` or `derived` component skips with non-blocking feedback. Only when every component is
   driven does the drag do nothing. This is the single clause in §5.9 most likely to be normalised
   into all-or-nothing dragging; it is deliberate, and it is the whole of the "constrained-axis
   dragging falls out for free" payoff.
2. **`renderDocument` returns with `ctx` holding the camera transform, not identity.** Selection
   handles drawn after it in the same frame come out camera-warped unless you reset first.
3. **Hold the object's `id`, not the `GraphObject`** `hitTest` hands back. `mutate` returns new
   objects; a held reference is a stale snapshot the moment the first drag lands.
4. **Copy `renderer.test.ts`'s hand-built context fake** — adding jsdom is a §6.1 trigger-6
   escalation. `hittest.ts` needed no fake at all; `interaction.ts` will.

Phase 3's criterion is correctly NOT claimed. D-067 part 2 settles that stroke-only hit-testing does
not block it when it is claimed.

## 11. Fix list (none blocking)

1. **`sides`/`rows`/`cols` have no upper bound** — carried from 0060-REVIEW item 2 and 0062-REVIEW
   item 2. Unchanged stance: record it, do not fix it in isolation; one ruling covers all three or
   none does.
2. **Give the table an end-to-end test through `mutate()`** when the table-creation command lands —
   carried from 0062-REVIEW item 3. Both the renderer's and now the hit test's table paths are
   pinned only against hand-built fixtures.
3. **The thirteen bare "this cycle" sites in test files** (0058-REVIEW Finding 2 / D-063) and the
   two stale "does not exist yet" claims in `primitives/schema.test.ts` — a sweep, still blocking
   nothing. The `schema.test.ts` pair is D-065's class but predates the ruling; it belongs to
   whoever's slice next touches that file.
4. **`render/slots.ts` at the third consumer of `readNumber`/`asPointArray`** — §5's trigger, new
   here.
5. **`.gitattributes`** — carried; one `* text=auto eol=lf` line whenever someone is annoyed enough.
   Adding a config file is a §6.1 trigger-6 escalation, so not a drive-by.

*(0060-REVIEW's fix list item 1 — D-064's winding test — is closed at this review, §6.)*

## 12. Verdict

**ACCEPT WITH EDITS.** `render/hittest.ts` is the right shape for the first file of a subsystem:
one exported entry point, arguments narrow enough that the whole file is testable without a canvas,
per-type dispatch that mirrors the renderer's so the two cannot diverge in structure, and honest
about the one §5.9 clause it does not implement. It gets the two clauses most likely to be quietly
normalised away exactly right — the circle's polygonal approximation and the screen-space tolerance
— and the reuse question it escalated was worth escalating.

One real defect (an invisible object was clickable), fixed and ruled as D-066. One known gap
confirmed and deliberately left where its ruling put it. Three comment corrections. Two rulings
(D-066, D-067), one carried fix-list item closed (D-064's pinning test), one recommendation to the
human (a header-budget audit pass before Phase 4). Phase 3 continues; `render/interaction.ts` is
open for the next cycle.

Post-edit verification, re-run:

```
$ npx tsc --noEmit                              -> exit 0, no output
$ npx tsc --noEmit -p tsconfig.engine.json      -> exit 0, no output
$ npx vitest run                                -> 19 files, 753 passed (753), 0 skipped
```
