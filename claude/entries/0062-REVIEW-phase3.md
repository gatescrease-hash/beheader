# 0062 — REVIEW (phase 3)
Date: 2026-08-24   Phase: 3   Model: reviewer
Previous entry: 0061-render-renderer   Reviews: entry 0061 (one cycle, 2 source files, ~660 lines)
Verdict: **ACCEPT WITH EDITS**

Reviewed: `src/render/renderer.ts`, `src/render/renderer.test.ts`, entry 0061, `STATUS.md`,
`OPEN_QUESTIONS.md`. Re-ran both typecheck configs and the full suite rather than reading the
pasted output.

---

## 1. Rule audit

- **Rule 1 (`engine/` is pure)** — upheld, and checked mechanically rather than assumed. Grepped
  all of `src/engine/` for `document.`, `window.`, `canvas`, and `render/` imports: every hit is
  inside a comment (mostly the "NEVER imports:" line of a file header). No `engine/` file imports
  `render/*`, and `renderer.ts` is imported by nothing in `engine/`. The direction of flow is
  intact.
- **Rule 2 (all state change through `mutation.ts`)** — upheld. `renderer.ts` writes no graph
  state at all; every function reads `GraphObject`/`Value` and calls `ctx` methods. The only
  assignments in the file are to `ctx.strokeStyle`/`lineWidth`/`font`/`fillStyle`/`textAlign`/
  `textBaseline`, which are canvas state, not document state.
- **Rule 3 (addressing is load-bearing)** — not touched. `renderer.ts` never builds an address by
  hand: the table cell path goes through `address.ts`'s own `TABLE_CELL_PATH_PREFIX` +
  `formatCellReference`, and every geometry path is an imported constant from `geometry.ts`. No
  `slotKey` is inverted (D-010 holds).
- **Rule 4 (one formula engine)** — not touched.
- **Rule 5 (dumbest correct implementation)** — upheld, conspicuously. No culling, no dirty
  rectangles, no path caching, no retained anything. A 1000-cell table strokes 1000 rectangles.
  That is the correct answer here.
- **Rule 6 (slot set fixed during evaluation)** — not touched; nothing here evaluates.
- **Rule 7 (§8 deferred list)** — not touched.

**The one piece of arithmetic worth checking by hand, checked:** `renderDocument` sets
`setTransform(zoom, 0, 0, zoom, e, f)` where `(e, f) = worldToScreen(camera, {x:0, y:0})` =
`(-camera.x * zoom, -camera.y * zoom)`. Canvas expands that to `x' = zoom*x - camera.x*zoom =
(x - camera.x) * zoom`, which is `worldToScreen` exactly, for every world point — not only for the
origin. Entry 0061 Decision 2's claim is true, and the structural version of D-010 it argues for
(one mapping, not two) genuinely holds: the file contains no second copy of the formula.

## 2. Invariant audit

Slot set fixed during evaluation · derived slots inside the topological pass · eager/total
dependency extraction · lazy evaluation · rejection leaves prior state bit-for-bit unchanged · no
dangling edges · graph state plain and serializable — **none touched.** This cycle adds a pure
reader.

The file's own stated invariant — **never throws, one broken object never takes the frame down** —
holds under inspection. Every read funnels through `readNumber` (typeof-narrowed) or `asPointArray`
(`Array.isArray`-narrowed), `getTableDimensions` already fails safe to `0` (D-046), and
`formatCellValue` is total over `Value`. The residual case is a hand-edited document holding, say,
`[1, 2, 3]` in a `vertices` slot: `vertex.x` is then `undefined` and `ctx.moveTo(undefined, ...)`
is a no-op in a real Canvas2D rather than a throw, so the invariant survives even there. Same
posture `graph/node.ts`'s `hasIllegalNumber` already takes toward the array arm; consistent, and
correctly so.

One deliberate NON-copy worth naming so nobody "fixes" it: `readNumber` honours a slot of ANY kind,
where `table.ts`'s `readTableDimension` is `literal`-only (D-046). That asymmetry is right. D-046
is a **Rule 6** guard — a dimension read decides the SLOT SET, so letting evaluation drive it lets
evaluation create slots. Reading a value in order to DRAW it decides nothing and creates nothing,
and §5.9 positively requires a formula-driven `origin.x` to render at its evaluated position.
Copying D-046 into the renderer would have been the plausible wrong move; entry 0061 did not make
it.

## 3. Spec conformance

- **§5.9's sequence** — "clear, apply camera transform, draw every visible object in z-order. No
  retained scene graph, no diffing." All four clauses present, in order, and `renderDocument` is a
  pure function of its arguments with no module-level state. `clearScreen` resetting to identity
  BEFORE clearing is not a nicety: `clearRect` is itself subject to the current transform, so
  clearing under the camera matrix would miss the corners at any zoom but 1. Correctly reasoned in
  the code comment.
- **§5.5's circle clause** — "the renderer still draws a true arc." `drawCircle` reads
  `origin.x`/`origin.y`/`radius` and calls `ctx.arc`; it never touches `vertices`. Pinned by a
  test asserting **zero** `lineTo` calls, which is the assertion that actually defends the clause
  (a weaker "an arc was drawn" test would pass a renderer that drew both). This is the exact kind
  of brief "deliberate" note §8.3 warns gets quietly normalised away, and it did not.
- **§5.5's "consumers always read `vertices`"** — `polygon` and `rect` share one drawer reading one
  slot. Correct, and the uniformity is the payoff §5.5 promises.
- **§5.4's rendering clause** — fixed-size cells, grid lines, numbers right-aligned, strings
  left-aligned. All present. Extending "everything not a number" to left-aligned (booleans,
  errors, points) rather than inventing a third rule is the right reading of an under-specified
  sentence.
- **Z-order** — the brief names z-order and gives objects no z field. Array order, disclosed in
  the header and in the log, reversible. Correct under Rule 5 and PROCESS_BRIEF §13.
- **What is NOT claimed** — Phase 3's criterion is correctly not claimed, and no clause of it is.
  The log says so plainly and STATUS repeats it. Good.

## 4. Findings and edits

Five edits, all small, all explained. Nothing here is structural; the file's shape is right.

**Edit 1 — `drawObject`'s switch had no exhaustiveness arm.** The switch over `object.type` lists
all ten `ObjectType` members and then stops. Because the function returns `void`, a missing case is
NOT a compile error — it just falls through and returns. Every other discriminated-union switch in
this codebase closes with `const exhaustive: never = x; void exhaustive;` (`formula/deps.ts` ×3,
`formula/eval.ts`, `formula/parser.ts`, `mutation.ts`); this one was the sole exception. That
matters more here than anywhere else the idiom is used, because `renderer.ts` is the file where
"handled" and "draws nothing" are the same source line: a new `ObjectType` would silently render as
an invisible object with no compile error and no test failure, and §5.5's `polyline` and §5.6's
`text` are both already promised. Added the arm, matching the existing idiom including the
no-throw `void`. Probed: deleting `case "image":` now produces `TS2322: Type '"image"' is not
assignable to type 'never'`.

**Edit 2 — every shape test ran at an identity camera, leaving entry 0061's central design
decision unpinned.** The transform test (`{x:10, y:20, zoom:2}`) draws an **empty** object list;
every test that actually draws a circle, polygon, or table uses `CAMERA_IDENTITY`. At identity,
"world coordinates passed raw" and "coordinates put through `worldToScreen` first" are
indistinguishable — so a future cycle that helpfully added a per-vertex `worldToScreen` call would
double-transform every shape and the whole suite would stay green. Added one test: a circle at
world `(3,4) r=10` under `{x:10, y:20, zoom:2}` must reach `ctx.arc` as `(3,4) r=10`, **not** as
`(-14,-32) r=20`. That is Decision 2's actual contract, and it now has a test that fails if it is
broken.

**Edit 3 — `ctx` is left holding the camera transform on return; the header did not say so.**
Harmless frame-to-frame, since `clearScreen` resets to identity first thing next frame. It is a
live trap for the very next cycle: `render/interaction.ts` and any selection highlight, error
badge, or HUD drawn AFTER `renderDocument` in the same frame is screen-space chrome, and it will be
drawn camera-warped unless the caller resets the transform itself. Added one bullet to INVARIANTS
UPHELD HERE stating the exit condition. Contract note only, no behaviour change — and deliberately
NOT "reset to identity at the end," which would just move the surprise somewhere less visible.

**Edit 4 — a dead guard with a rationale comment that was factually wrong.** `asPointArray` read
`if (value === undefined || isErrorValue(value) || !Array.isArray(value))`, documented as "checked
first: `isErrorValue` before `Array.isArray`, since neither test alone excludes the other member."
That is backwards: an `ErrorValue` is not an array, so `!Array.isArray(value)` already returns
`undefined` for it, and `readonly Point[]` is the only array arm of `Value` — `Array.isArray` alone
excludes every other member, `ErrorValue` included. The check was unreachable-by-effect and the
comment asserted a constraint that does not exist. Per PROCESS_BRIEF §5.4 a wrong why-comment is
worse than none, because it reads as precise. Dropped the redundant call and rewrote the comment to
state the real reason the one test suffices. The ErrorValue test still passes, unchanged — which is
the point.

**Edit 5 (four sites) — headers falsified by this cycle, and two carried ones of the same class.**
Entry 0061 created `render/renderer.ts` and left two existing comments asserting it does not exist:
`main.ts` ("there is no renderer or `command/` yet" — the file the NEXT cycle opens in order to
wire the renderer up) and `primitives/geometry.ts` ("nothing consumes `style` yet (no renderer)").
While fixing those I closed the two structurally identical ones 0058-REVIEW Finding 2 has been
carrying: `graph/cycles.test.ts` and `graph/eval.test.ts`, both still claiming "`mutation.ts` does
not exist yet." All four rewritten to say what the code does and why, in terms that cannot expire.
**Ruled as D-065** — see §6.

**Not edited, reported instead:**

- **The renderer does not clip cell text to its cell.** A long string overflows into the
  neighbouring cell. Unspecified by §5.4, and the spreadsheet idiom is itself split between
  overflow and clip. Rule 5 says leave it. Recorded in STATUS.
- **No table goes through `mutate()` in the tests** — the one integration test builds a pentagon.
  Every table assertion runs against a hand-built fixture, which is exactly where entry 0061's own
  disclosed mistake happened (`A1` vs the stored `cells.A1`). The paths are built from imported
  constants so a divergence is close to structurally impossible, and no table-creation command
  exists to make the end-to-end test natural yet. Fix-list item, not an edit.
- **`drawVerticesShape`'s `if (vertex === undefined) continue;`** is a `noUncheckedIndexedAccess`
  artifact, correctly identified as such in its own comment. Left alone: correct, honest, and
  churning it buys nothing.

## 5. Legibility audit

Headers present on both new files, layer and allowed imports stated, brief sections cited. Locked
vocabulary held throughout — "object", "slot", "derived", "preset", "camera"; no "property", no
"node", no "computed". Zero `any` in either file (the six grep hits are the English word). Test
names are behaviour sentences. `renderer.ts`'s header runs long for an ordinary file but is
carrying four real hazard/deferral notes, which PROCESS_BRIEF §5.2 says to keep regardless of
budget — sequencing, the expensive-to-keep-honest part, is absent. Correct call.

Both new files are D-060/D-063-clean in themselves. The failure was the *cross-file* claim, which
neither ruling covered until now.

## 6. Ruling: D-065

Four sites in one review, all the same shape: a comment asserting that a file which now exists does
not. D-060 governs diary comments; D-063 governs a header describing its own file. Neither says who
owns a header's claim about SOMEONE ELSE's file once that claim goes false. **D-065**: the cycle
that falsifies a cross-file existence claim owns fixing it — grep for the name of what you just
created before you log — and, preventively, prefer a sentence that cannot expire (say what this
code does and why, not what elsewhere lacks).

Why this earned a ruling rather than a fourth round of hand-fixes: the previous two were found by
hand, this one was found by hand, and the recurrence rate is once per cycle. It is also the most
harmful tier — not a dated comment, but a false one, sitting in the file a reader opens
specifically to learn what exists. A model orienting off `main.ts` next cycle would have been told
the renderer it is about to wire does not exist.

## 7. Honesty audit

The log matches the diff. Re-ran everything rather than reading it:

```
$ npx tsc --noEmit                              -> exit 0, no output
$ npx tsc --noEmit -p tsconfig.engine.json      -> exit 0, no output
$ npx vitest run                                -> 18 files, 731 passed (731)
```

731/731 as claimed, `renderer.test.ts` contributes 17 as claimed, zero `.only`/`.skip`/`.todo`
anywhere in `src/`. No silent scope expansion: the diff is exactly the two new files plus the log
and STATUS, and every declared out-of-scope item really is absent — no hit-testing, no interaction,
no selection, no `main.ts` wiring, no `style` slots.

Two claims spot-checked rather than taken on trust, both of which held:

- **Decision 5** (the `as Point` cast is forced, not decorative). Reproduced directly: replacing
  `value as Point` with `const point: Point = value` yields `TS2322: Type 'Point | readonly
  Point[]' is not assignable to type 'Point'`. `Array.isArray`'s `arg is any[]` guard genuinely
  fails to narrow the negative branch past `readonly Point[]`. The cast is correct and its comment
  is accurate.
- **Decision 4** (the table origin fallback is below §7's escalation bar). Agreed. It is
  render-time only, touches no document state, and reuses `geometry.ts`'s own path constants rather
  than inventing a second position convention — so when `TABLE_SCHEMA` gains an origin, this file
  needs no change. Taking it and disclosing it was the right branch of §7.

**One inaccuracy, in STATUS rather than in the code.** STATUS.md's line-endings entry says entry
0061's two new files are CRLF like the rest of the repo. They are LF (0 CR bytes in either), and
the split is not 0059-versus-everything: every `.test.ts` under `formula/`, plus `address.test.ts`,
`document.test.ts`, and both `geometry.*`, is also LF. The real cause is `core.autocrlf=true` — git
stores LF and converts on checkout, so a file written by a tool and never re-checked-out stays LF
in the working tree while the committed content is uniform. That makes the known problem smaller
than recorded, not larger. Corrected in STATUS. Flagging it because STATUS is the orientation
document, and a carried-forward line nobody re-checks is how a small wrong fact becomes a
load-bearing one.

## 8. Open questions

- **Q-012 raised (new), and explicitly deferred.** Because the camera is applied as a canvas
  transform, `ctx.lineWidth` and `ctx.font` are in WORLD units and scale with zoom — a 1-unit
  stroke is 0.01 screen px at `MIN_ZOOM` and 100 px at `MAX_ZOOM`. §5.5 puts `strokeWidth` inside
  the shape's own `style` and never says which space it is in; §5.9 attaches the brief's only
  pixel-denominated measurement to something else (hit-testing's "pixel tolerance"). Deferred, not
  ruled: "do outlines get thinner as you zoom out" is a product-visual call, and PROCESS_BRIEF §1
  makes the human the arbiter of those. It blocks nothing — `geometry.ts` declares no `style`
  slots, so nothing can author a width yet. Recommendation recorded as (a) world units, which is
  what the tree does; provisional, tagged `PROVISIONAL(Q-012)` at both constant groups in
  `renderer.ts`. Comes due with the `style`-slots cycle.
- **Q-008** — remains OPEN, deferred, blocking nothing. Unchanged.
- **Q-001 / Q-002** — still come due at `command/parser.ts`. Unchanged.
- No `PROVISIONAL` tag anywhere in the tree belongs to an already-answered question.

## 9. D-062 — where the zoom clamp goes, and where it must NOT go

Entry 0061's claim that this cycle "neither closes nor worsens" the D-062 gap is correct:
`renderer.ts` multiplies by `camera.zoom` and never divides by it, so it cannot produce an
`Infinity` the way `screenToWorld` can. At `zoom: 0` it collapses everything to a point and draws
nothing visible; at a negative zoom it mirrors. Neither throws.

Stated once here because `hittest.ts`/`interaction.ts` is the next slice and the wrong fix is the
attractive one: **the clamp does not go inside `renderDocument`.** D-062 already says "clamped
once, in `render/`, at the boundary where it enters the render layer," and this is why *once* is
load-bearing — `renderDocument` and `hittest`'s `screenToWorld` must be handed the SAME camera. A
clamp applied on the drawing side only would put the picture and the click in different coordinate
systems, and the symptom is clicks landing off-target with nothing logged anywhere. The boundary is
where a loaded document meets a live canvas, which is `main.ts`'s wiring cycle.

## 10. Where Phase 3 stands, and the next slice

Two of the four §6.1-trigger-2 files remain: `render/hittest.ts` / `render/interaction.ts`, then
`command/parser.ts`. `hittest.ts` is the right next slice and 0060-REVIEW §10's ordering stands.

Three things that cycle should carry in from here. **Winding is now load-bearing for you** — D-064
says all three presets wind counterclockwise, a winding-number hit test inherits that, and the
pinning test is *still* owed (fix list item 1, open since 0060-REVIEW; `renderer.ts` did not add it
because it does not fill shapes). **§5.9 says "pixel tolerance"** for stroke hit-testing, which
means `hittest.ts` needs `camera.zoom` to convert a pixel tolerance into world units — read Q-012
before deciding how, since it is the same world-versus-screen question from the other side. And
**copy `renderer.test.ts`'s hand-built context fake** rather than reaching for jsdom; adding jsdom
is a §6.1 trigger-6 escalation.

## 11. Fix list (none blocking; may ride along with any slice)

1. **Pin the winding invariant with a test** (D-064) — carried from 0060-REVIEW item 1, still open,
   and it now has a second consumer coming in `hittest.ts`. One test, strictly positive doubled
   signed area for all three presets.
2. **`sides`/`rows`/`cols` have no upper bound** — carried from 0060-REVIEW item 2. Unchanged
   stance: record it, **do not fix it in isolation**; one ruling covers all three or none does.
3. **Give the table an end-to-end test through `mutate()`** when the table-creation command lands —
   the renderer's table path is currently pinned only against hand-built fixtures.
4. **The thirteen bare "this cycle" sites in test files** (0058-REVIEW Finding 2 / D-063) remain.
   A sweep, not a surgical edit; still blocking nothing. Its *other* half — the two stale
   "`mutation.ts` does not exist yet" headers — is closed at this review under D-065.
5. **`.gitattributes`** — carried from 0060-REVIEW item 4, and smaller than recorded (see §7). The
   real fix is one `* text=auto eol=lf` line whenever someone is annoyed enough; adding a config
   file is a §6.1 trigger-6 escalation, so it is not a drive-by.

## 12. Verdict

**ACCEPT WITH EDITS.** `render/renderer.ts` is the right shape: pure, narrow in its arguments,
honest about what it cannot draw, and it gets the two clauses most likely to be quietly normalised
away — the true arc and the single camera transform — exactly right. Five small edits applied (one
compile-safety gap, one test gap, three legibility/contract fixes), one ruling (D-065), one
question raised and deferred (Q-012). Phase 3 continues; `render/hittest.ts` is open for the next
cycle.

Post-edit verification, re-run:

```
$ npx tsc --noEmit                              -> exit 0, no output
$ npx tsc --noEmit -p tsconfig.engine.json      -> exit 0, no output
$ npx vitest run                                -> 18 files, 732 passed (732), 0 skipped
```
