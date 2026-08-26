# 0089 — main.ts: the application, and every effect performed
Date: 2026-08-26   Phase: 3   Model: Claude Opus 5 (implementer)
Previous entry: 0088-REVIEW-phase3   Last review: 0088-REVIEW-phase3 (verdict: ACCEPT WITH EDITS)
Batch: cycle 1 of up to 3 since last review; ~1438 changed lines / 7 files — **over the §6.3
cap**, and a §6.1 trigger fires anyway (see Review point).

## Declared scope

Build `main.ts`: one clamped camera into the renderer, the hit test and the drag machine; the five
`CommandEffect`s performed through an exhaustive switch; `prompt.ts` wired so a canvas click during
a live sequence is a `picked` world point; save/load through the DOM; and the input bar, log and
canvas `index.html` needs for any of it to exist. Two supporting additions the file could not be
written without: `clampCamera`/`clampZoom` in `render/camera.ts` (D-062's boundary) and
`documentExtent` in `render/hittest.ts` (what `fit` fits to).

## Explicitly not in scope

§5.9's visual-feedback trio (**D-068** keeps all three in one cycle, in `renderer.ts`) — so a
selection is real state and draws nothing. The fix list, all of it, including item 5's ~200 KB echo,
which I looked at and left alone (below). `document.ts`'s owed load-boundary work (**D-081**,
**D-083** clause 4). Any throttling of drag mutations. `polyline`/`text`/`script`/`image` still draw
nothing and still hit nothing.

## What I did

**`src/main.ts`** — rewritten from the stub, in two halves.

The **pure half** is `AppState` (`document`, `interaction`, `pending`, `log`) and every transition
over it: `submitLine`, `respondToPrompt`, `escape`, `performEffect`, `pointerDownAt`,
`pointerMoveTo`, `pointerUpNow`, `wheelZoomAt`, `panByScreen`, `replaceDocument`, `initialAppState`.
Every one takes plain numbers and a `Viewport` and touches no DOM, which is what makes them
testable — D-082 calls `main.ts` "the one file no test reaches", and this split is my answer to
that: the part that could be reached is, and the part that cannot is as small as I could make it.

The **DOM half** is `start` plus two file helpers. It holds one `AppState` in one variable, replaces
it wholesale, and repaints. It is guarded at the bottom (`typeof document !== "undefined"`) so
importing the module under `vitest`'s `node` environment reaches the pure half without a browser —
that guard is the only reason a test file for this module can exist without adding jsdom (§4: never
add a dependency).

Effects, per **D-082** clause 3, in a `switch` on `kind` with the `never` default:

- `select` — takes the ID it was handed (clause 4: no name is resolved here), clears any drag.
- `zoom` — `camera.zoom * factor` through `zoomAtScreenPoint` about the VIEWPORT CENTRE, because a
  typed `zoom 2` has no cursor. Reports the CLAMPED result, which is the half `commands.ts` could
  not predict (clause 5).
- `fit` — `documentExtent` over the objects, then a camera placed so the extent's centre sits at the
  screen's centre (D-061's top-left convention, arithmetic done here). D-066's own guard: a
  DEGENERATE extent (zero width AND height — one zero-radius circle, or coincident objects) centres
  at the CURRENT zoom rather than dividing the viewport by zero. `commands.ts`'s refusal of the
  empty document does not discharge this, and there is a third case neither covers — objects that
  exist and draw nothing — which reports and moves nothing.
- `save`/`load` — returned as a `fileRequest` on the transition rather than performed in the pure
  half, so the shape is the same one D-075 gives `commands.ts`: describe it, let the layer that can
  do it do it.

`camera` is written directly and never through `mutate` (D-027 clause 2, D-075 clause 5) — through
ONE function, `withCamera`, so that exception has one site. Every camera entering the file goes
through `clampCamera` first (D-062), which is what lets `renderDocument`, `hitTest` and
`interaction.ts` keep their "the caller clamped this" precondition.

A canvas press during a live prompt sequence is a `picked` answer, not a selection (**D-072**), and
the screen→world conversion happens here, via `camera.ts`, so `command/` still never sees a screen
point or imports `render/` (D-069).

**`src/render/camera.ts`** — `clampCamera` (new, exported): D-062's boundary in one function.
`clampZoom` changed from `(camera, requested)` to `(requested, fallback)` and exported: `fit` must
know the clamped zoom BEFORE it can place the camera, and `zoomAtScreenPoint` cannot give it that
without a finished camera. `IDENTITY_ZOOM` exported as the fallback for a zoom no bound can correct.
One call site updated; the header's "the only two functions that PRODUCE a `CameraState`" and
`screenToWorld`'s "D-062 puts that guard in `render/`" are both now false-as-written and are
corrected (**D-065**).

**`src/render/hittest.ts`** — `documentExtent(objects)` (new, exported) plus private `objectExtent`,
`verticesExtent`, `tableExtent`. It lives here rather than in a new file because D-066 makes drawn
extent and clickable extent the SAME extent, and these are the reads `hitTestVerticesShape` and
`hitTestTable` already make. Degenerate extents are skipped exactly as they are un-hittable.

**`index.html`** — a canvas, a log, an input bar, and the minimum CSS to stack them (§5.10: "minimal
UI chrome, no panels, no toolbars"). No behaviour: `main.ts` finds the three by id.

**Tests** — `src/main.test.ts` (new, 35 tests) and additions to `camera.test.ts` (+8) and
`hittest.test.ts` (+8).

## Decisions I made

1. **`main.ts` is split rather than kept thin.** The alternative — a thin `main.ts` over a new
   `src/app/` module — invents project structure the brief's §4 does not have, and putting the
   effect switch in `render/` contradicts D-075 clause 3 outright. Splitting inside the one file the
   brief names costs nothing structurally and buys 35 tests over the part that has the rules in it.
2. **`zoom` is about the viewport centre; the wheel is about the cursor.** §5.9 says "zoom to
   cursor (wheel)" and says nothing about a typed factor, which has no cursor. The centre is the
   only point that does not depend on where the mouse happens to be sitting.
3. **`fit` leaves a margin** (`FIT_VIEWPORT_FRACTION = 0.9`, untuned): fitting to the exact edges
   half-clips the outermost strokes, because a stroke straddles its own path.
4. **A `load` that is refused reports and changes nothing.** `deserializeDocument` is the boundary
   that decides; this file neither re-checks nor repairs, which keeps D-083 clause 4's future work
   in one place.
5. **Space-drag and middle-drag pan; everything else is a select/drag.** §5.9 names both and gives
   no third gesture.
6. **Fix-list item 5 (a ~200 KB echoed line) is answered by doing nothing**, which 0088-REVIEW
   allowed for. The log is a `textContent` write of joined lines; a 200 KB one is ugly and slow to
   paint, and it is also the true echo of what the operator typed. Truncating it would be the first
   place in this codebase where a message is silently shortened, and I would rather a reviewer rule
   on that than have me invent an ellipsis policy.

## Verification (real output)

```
$ npx tsc --noEmit
(no output, exit 0)
$ npx tsc --noEmit -p tsconfig.engine.json
(no output, exit 0)
$ npx vitest run
 Test Files  25 passed (25)
      Tests  1125 passed (1125)
$ npm run build
 ✓ 28 modules transformed.
 dist/index.html                 1.73 kB
 dist/assets/index-dx_t5mFq.js  80.21 kB
 ✓ built in 323ms
```

Zero skipped, zero `.only` (grepped, not assumed).

**Mutation check** — the suite passed first try, so five faults were seeded in `main.ts`, one at a
time:

| seeded fault | tests killed |
| --- | --- |
| `select` keeps the drag instead of clearing it | 1 |
| `fit`'s degenerate guard always true | 1 |
| `pointerDownAt` ignores a live sequence | 6 |
| `describeZoom` always reports the request | 1 |
| `submitLine` never routes to the live sequence | 3 |

Each was reverted before the next. The two single-kill mutants are the two narrowest claims in the
file, and both are claims D-082/D-066 make in words.

## Acceptance criteria status

Phase 3 criterion: *"you can create a polygon and a table by command, see both drawn, pan/zoom,
select, and drag the polygon."* — **demonstrated by an executable test, NOT verified by eye.**

`main.test.ts`'s "Phase 3's acceptance criterion, end to end" runs the criterion's own order against
ONE state: two creation lines, a `renderDocument` pass whose recorded calls contain the polygon's
stroked path and the table's nine stroked cell rects, a pan by screen delta, a wheel zoom, a typed
`zoom 2`, a click on the polygon's stroke (through the non-identity camera) that selects it, and a
drag that moves `origin.x` by the world-space delta and grows the journal.

Three honest qualifications:

1. **I have not run the app in a browser.** There is no browser in this environment. The draw calls
   are asserted; the picture is not. `npm run build` succeeding says the entry point bundles, not
   that anything looks right. PROCESS_BRIEF §12 asks the manual check to be described separately:
   it is *open the dev server, type the two creation lines, scroll-wheel, middle-drag, click the
   polygon's outline, drag it* — and nobody has done it.
2. **Selection is invisible.** D-068 defers the highlight to the cycle that builds all three
   feedback pieces. A `select` is real state; on screen nothing changes. Whether "select" in the
   criterion means the state or the highlight is the reviewer's call, and I have not assumed the
   generous reading.
3. **Interior clicks miss** (stroke-only hit-testing). **D-067** clause 2 rules this does not block
   the gate; noted so nobody re-litigates it.

## Where I got stuck / what is unfinished

- **The `start` function is untested and I could not make it otherwise without a dependency.** Every
  listener, the canvas sizing, the two file helpers, and the log rendering are unasserted code. I
  minimised it rather than solved it. If one of those listeners is wired to the wrong element or the
  wrong event, no test in this repo will say so.
- **Wiring `load` makes an exposure reachable that was theoretical yesterday.** D-083 clause 4 says
  a loaded AST's depth is checked once at §5.11's boundary, and that check is not built; before this
  cycle nothing could load a file at all. A hand-edited document whose formula nests deeper than
  `MAX_FORMULA_AST_DEPTH` now reaches `deserializeDocument` from a button and throws a `RangeError`
  out of the file-read promise. Nothing this build SAVES can contain one. I did not fix it because
  the fix is in `document.ts` — load-bearing (§6.2), a second slice, and D-081's name gate belongs
  in the same cycle. It is fix-list item 6 and it is now user-reachable; that is a change in
  severity, not in ownership.
- **`escape` is bound to the window, not the canvas.** A stray Escape while typing a formula into
  the input bar cancels the sequence. That is AutoCAD's behaviour and I believe it is right, but I
  did not test it in use and there is no in-place cell editor yet to conflict with it.
- **I did not measure repaint cost.** Every pointer move repaints the whole canvas and rewrites the
  whole log's `textContent`. §5.9 already accepts one `mutate` per move; the log rewrite is new and
  is mine. At a few hundred lines it is nothing; I have not probed a large one, and fix-list item 5
  is exactly where it would bite.
- **`fit`'s margin is a number I chose, not one anything measured.**

## Open questions raised

None. Q-012 (world vs screen units) is still live and still blocks `pan`'s argument grammar — the
gesture is wired here, the COMMAND is not.

## Review point

**Fired: §6.1 trigger 1** — a phase acceptance criterion is claimed (with the three qualifications
above). Also §6.3: ~1438 changed lines / 7 files, over the 800/10 cap in one cycle. `render/camera.ts`
and `render/hittest.ts` are not on §6.2's load-bearing list, but they are reviewed files that this
cycle changed and their diff is included.
