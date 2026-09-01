# 0107 — N panels, drag and dismiss (D-101 + D-106)
Date: 2026-08-31   Phase: 4   Model: Claude Sonnet 5
Previous entry: 0106-RULINGS   Last review: 0105-REVIEW-phase4 (verdict: ACCEPT WITH EDITS)
Batch: cycle 1 of up to 3 since last review; 6 files / 510 insertions, 86 deletions changed so far.

## Declared scope

Build entry 0107 — **D-101** (one properties panel per selected object, dragged by its header,
detaching until deselected, no collision avoidance) together with **D-106** (every selected
object's panel shows by default, each panel carries a dismiss control that hides it without
deselecting, and a dismissed object's canvas name label comes back) — in `main.ts`, `render/
renderer.ts` (the `panelledObjectIds` parameter D-106 clause 5 asks for), and `index.html`. This
is ONE slice per `STATUS.md`'s own instruction, not two: D-106 clause 1 requires entry 0104's
interim "hide the panel on a multi-selection" reading to be gone at the end of it.

## Explicitly not in scope

**D-102** (the paperclip, editing a slot from the panel, `pointer-events` lifted off the panel
BODY) — queued as its own cycle per D-103 clause 4, and gets its own review point regardless of
the batch cap. Nothing in `command/`, `engine/`, or the mutation path was touched. Fix-list items
11 (panel scroll position resets on every paint) and 12 (a right-flipped panel overlapping its
object) are unchanged — both are D-102's or the human's to revisit.

## What I did

**`src/main.ts`** (§4, §5.9, §5.10; D-101, D-106):

- Added `PanelUiState` (`dismissed`, `manualPosition`) and `PanelUiRegistry` (`Record<string,
  PanelUiState>`), and a `panels` field on `AppState` — APPLICATION state, never `document` state
  (D-101 clause 7, D-106 clause 6): it is never touched by `mutate`, never saved.
- `withInteraction(state, interaction)` is now the ONE place `AppState.interaction` is assigned.
  It prunes `panels` down to the current `selectedObjectIds` via `prunePanelsToSelection` — D-101
  clause 6 and D-106 clause 6's shared rule ("discarded when the object leaves the selection"),
  stated once rather than at every call site that could change the selection. `pointerDownAt`,
  `escape`, and `performEffect`'s `"select"` case now go through it; `pointerMoveTo`/`pointerUpNow`
  do not, because neither ever changes `selectedObjectIds` (only `drag`), so routing them through a
  prune that is always a no-op would cost a call for nothing.
- `dismissPanel(state, objectId)` and `movePanel(state, objectId, position)`: both are no-ops
  (return `state` unchanged) for an object that is not currently selected — there is nothing to
  write that `withInteraction` would not discard on the very next selection change anyway.
- The DOM half (`start`): `panel: HTMLElement` became `panelsContainer: HTMLElement`. A
  `panelElements: Map<string, HTMLElement>` holds one DOM node per panelled object id, created on
  first use and removed the moment its id leaves `panelledObjectIds()` (computed once per paint and
  handed to BOTH `renderDocument` and `updatePanels`, so the two can never disagree about which
  objects have a panel — D-010's shape). `placePanelElement` calls `placePropertiesPanel` (D-094
  clause 11, unchanged) unless the panel has a manual position, in which case that wins outright and
  the pure function is not even called (D-101 clause 5, taken literally: "no longer consulted").
- The header-drag and dismiss-click listeners are delegated on `panelsContainer` (`pointerdown` for
  the drag, `click` for `.panel-dismiss`), not attached per header element, because `updatePanels`
  rebuilds every panel's DOM whole on every paint (immediate-mode, same posture as the log and the
  canvas) and a listener or `setPointerCapture` bound to a header would be torn down mid-gesture the
  moment the first `pointermove` triggered a repaint. The drag gesture's own continuation
  (`pointermove`/`pointerup`/`pointercancel`) is on `window`, tracked in a closure variable
  (`panelDrag`), for the same reason — it never depends on a specific DOM element surviving the
  gesture. D-101 clause 8 ("a panel drag must not reach the canvas") holds structurally: the
  listener is on a sibling of `canvas`, so a press there never fires on `canvas` in the first place.
- `writePanel` now builds a header with a name span AND a `.panel-dismiss` button (`×`), and the
  pointerdown delegate excludes `.panel-dismiss` FIRST so pressing it does not also arm a drag.

**`src/render/renderer.ts`** (§5.9; D-106 clause 5): `renderDocument` gained a seventh parameter,
`panelledObjectIds: readonly string[] = selectedObjectIds` — the default is exactly what D-106
clause 5 asks for, so every pre-existing call site (every test, and any future one with no reason to
dismiss a panel) keeps meaning "the panel follows the selection" without an edit. The name-suppression
pass in the screen-space chrome loop now reads a `panelledIds` set built from this new parameter,
kept deliberately separate from `selectedIds` (the highlight pass's own set): a selected-but-dismissed
object keeps its highlight (still being worked with) but its canvas name label comes back (nothing
else is showing it).

**`src/render/panel.ts`**: header comment only — updated the `NOT DONE HERE` section to state
D-101/D-106's current division of labour (whether a panel shows and where a dragged one goes are
`main.ts`'s job) rather than the stale "since D-100 a selection of more than one shows no panel
until D-101 builds N of them," which D-060 flags as a present-tense violation once D-101 lands.
`placePropertiesPanel` itself is UNCHANGED, per D-101 clause 2.

**`index.html`**: `<div id="panel" hidden>` became `<div id="panels">`, an empty container `main.ts`
fills. CSS: `#panels` takes no clicks itself (`pointer-events: none`, so empty area falls through to
the canvas); `.panel` (was `#panel`) keeps `pointer-events: none` on its body (D-094 clause 10 stands
until D-102); `.panel-header` gets `pointer-events: auto` and `cursor: move` (the drag handle, D-101
clause 4); `.panel-dismiss` gets `pointer-events: auto` (D-106 clause 2). The header comment is
rewritten to describe the container/child relationship rather than the single element it used to be.

## Decisions I made

1. **Panel DOM elements are reused across paints, keyed by object id, rather than rebuilt from
   scratch every time** — cheaper churn, but the actual reason is that the delegated-listener design
   above does not need element identity to survive a paint at all, so reuse is a convenience, not a
   correctness requirement (unlike D-102 clause 8's own no-rebuild rule, which IS about correctness —
   an open text input losing focus). I disclose this distinction in `updatePanels`'s own comment so
   the next model does not read this cycle's design as having already solved D-102 clause 8's problem.
2. **The panel-drag gesture is tracked on `window`, not on the canvas or the header element**, for
   the reason stated above (rebuild-during-drag would drop a capture bound to the header). This is a
   new pattern in this file — `pan` (the canvas's own drag-panning) is tracked in a closure variable
   too, but its continuation listens on `canvas`, which is never rebuilt. I judged the deviation
   necessary rather than working around it, and it is the only place in `start` that listens on
   `window` for a pointer gesture.
3. **`dismissPanel`/`movePanel` are no-ops for an object that is not selected**, rather than writing
   to `panels` unconditionally and relying on `withInteraction` to prune it away later. Both are
   equivalent in every REACHABLE case (the DOM only ever calls these with an id that IS currently
   panelled, hence selected) — I chose the guard anyway so the pure functions are correct on their
   own terms, independent of how the DOM half happens to call them, and so a test could assert the
   no-op directly rather than through an indirect consequence.
4. **I kept `dismissPanel`/`movePanel` as two separate exported functions rather than one generic
   `updatePanelUiState(state, objectId, patch)`.** Two call sites, two distinct meanings (D-106
   clause 2 vs. D-101 clause 5), and PROCESS_BRIEF §5.5's "one function, one job" reads a merged
   version as needing "and" to name honestly.

## Verification (real output)

```
$ npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.engine.json
(clean, no output)

$ npm test
 Test Files  27 passed (27)
      Tests  1238 passed (1238)

$ npm run build
✓ 32 modules transformed.
✓ built in 542ms
```

Zero skipped, zero `.only`. 1238 = the 1225 from the last STATUS.md plus 13 new: 4 in
`renderer.test.ts` (the `panelledObjectIds` describe block) and 9 in `main.test.ts` (the "panel UI
state" describe block).

**Mutation-checked** (D-016), each broken-then-reverted with the affected test(s) confirmed red and
then green again:

- `prunePanelsToSelection` short-circuited to always return `panels` unchanged → 3 of the 9 new
  `main.test.ts` tests failed (the ones asserting pruning on plain-click-replace, escape, and
  `select <name>`), 0 pre-existing tests failed. Reverted, all green.
- `renderer.ts`'s `panelledIds` collapsed back to `selectedIds` (undoing the D-106 clause 5 split) →
  2 of the 4 new `renderer.test.ts` tests failed (the ones that pass a DIFFERENT `panelledObjectIds`
  than `selectedObjectIds`), 0 pre-existing tests failed — confirming the default-parameter tests
  alone would NOT have caught this regression, which is why the two divergent-list tests exist.
- Both `dismissPanel`'s and `movePanel`'s `if (!selected) return state` guards replaced with `if
  (false)` → both "no-op for an unselected object" tests failed with a real diff (the returned state
  carried a `panels` entry the guard should have suppressed), 0 pre-existing tests failed.

## Manual verification (real browser, not described secondhand)

`main.ts`'s DOM half (`start`) is untested by design (file header, D-001) — this project adds no
test-environment dependency to reach it. Given this cycle changes exactly that half in a load-bearing
way (a new interaction pattern: delegated listeners plus a `window`-level drag gesture, deliberately
NOT the per-element pattern the canvas itself uses), I ran the actual app in a real Chromium instance
via Playwright, launched transiently for this check only (installed in the OS scratchpad directory,
`npm install --no-save`; **nothing was added to this project's `package.json`/`package-lock.json` —
git status confirms only the six files listed above changed**), driving it exactly as an operator
would: typed commands into the real input bar, real mouse clicks/drags dispatched through Chromium's
own input pipeline, not through calling `main.ts`'s exported functions directly.

Sequence and result, each confirmed by screenshot:

1. `circle x=0 y=0 r=50`, `circle x=200 y=0 r=30`, `fit` — both objects drawn correctly.
2. `select circle_1` — ONE panel appears: header "circle_1" with a working `×`, modifiable rows
   (`origin.x`, `origin.y`, `radius`) above a thick rule, derived rows (`vertices`, `centroid.x/y`,
   `area`, `length`, `bounds.*`) in italics below it. Confirms D-094's whole panel is intact.
3. A real mouse click on `circle_1`'s STROKE (found by scanning the canvas's own pixel data for dark
   pixels — point-in-fill hit-testing is not built, D-067, so a click inside the circle's interior
   correctly selects nothing) selects it; a SHIFT-click (via `page.keyboard.down("Shift")` around a
   plain click — `mouse.click(..., { modifiers })` does not set `shiftKey` on the resulting
   `pointerdown` in this Playwright/Chromium build, confirmed by a separate diagnostic script before
   trusting the result) on `circle_2`'s stroke ADDS it: **TWO panels now show simultaneously**,
   confirming D-101 clause 1 and D-106 clause 1 (no cap, no collapse) against real events.
4. A real mouse drag on one panel's header (`pointerdown` → `pointermove` × 10 steps → `pointerup`)
   moved that panel's `getBoundingClientRect()` to a new position while the underlying shape did not
   move — confirms D-101 clause 5's detach, and the `window`-level gesture tracking decision above
   surviving real repaints triggered by the drag's own `apply()` calls (not merely surviving in a
   unit test's synchronous world).
5. Clicking the dismissed... clicking the dragged panel's `×` hid exactly that panel; the OTHER
   object's panel and highlight were untouched; the dismissed object's canvas name label
   ("circle_1") reappeared and its selection highlight (blue ring) REMAINED — confirms D-106 clauses
   2-4 exactly, including the "dismiss ≠ deselect" distinction, against real events.
6. A plain click back on the dismissed object's own stroke REPLACED the selection with just that
   object (the other lost its highlight, as `pointerDown`'s D-100 clause 2 requires) — and its panel
   stayed HIDDEN, because it never left the selection between steps 5 and 6, so `withInteraction`
   never pruned its `dismissed` flag. This surprised me until I re-read D-106 clause 6's own words:
   "shift-click it out and back in, **or escape and reselect**" is the stated re-show gesture — a
   plain click that merely narrows an already-selected multi-selection down to the dismissed object
   is neither, and I had assumed it would be. The live behaviour matches the ruling exactly; my own
   test script's assumption was wrong, not the code. (The `main.test.ts` unit test for the real
   re-show gesture — dismiss, `escape`, reselect — was already written correctly and passes; this
   finding only concerns the browser script's OWN extra step, which I removed after understanding it.)

Zero console errors, zero page errors (`page.on("pageerror")`) across the whole sequence. The
Chromium binary and the scratch `node_modules` used to drive it live entirely under the OS temp
scratchpad directory and were not added to the repository.

## Acceptance criteria status

Not a phase-gate cycle. Phase 4's own criterion is unchanged from `STATUS.md`: still owed by a human
session binding two polygons through a table in one document.

## Where I got stuck / what is unfinished

- The `mouse.click(..., { modifiers: ["Shift"] })` quirk above cost real time to diagnose — the
  first full run of the Playwright script showed shift-click REPLACING the selection instead of
  adding to it, which looked exactly like a real regression in `pointerDown`'s `additive` handling
  until an isolated diagnostic script proved the `shiftKey` flag itself was never set on the
  synthesized event. Recording it here because it is exactly the kind of false-positive-shaped result
  D-016 asks to be suspicious of, just arriving from browser tooling instead of a test fixture.
- Fix-list items 11 and 12 (panel scroll resets on repaint; a right-flipped panel overlapping its own
  object) are unchanged and remain D-102's or the human's — neither is this cycle's to fix, and I did
  not touch either code path.
- `main.ts`'s `start` function is now larger and still carries zero automated coverage of its own
  (D-001's standing gap) — the manual/Playwright verification above is real but disclosed as what it
  is: one run, by me, not a re-runnable assertion. `STATUS.md`'s known-problems list already names
  this file's untested-growth pattern; this cycle grows it further in the same disclosed way.

## Open questions raised

None. No `PROVISIONAL(Q-NNN)` tag was added or touched.

## Review point

Fired: none of PROCESS_BRIEF §6.1's eight triggers — no phase gate claimed, no first file of a new
subsystem (this extends `main.ts`/`renderer.ts`/`index.html`, all already reviewed structures), no
deviation from the brief or DECISIONS.md (D-101/D-106 are followed as written, and every divergence
from a ruling's exact wording is named above per D-096 clause 1), no hard rule worked around, no
test's PRIOR expectation changed (only new tests added; every pre-existing test still passes
unmodified), no dependency/build step/config file added to the project, no repeated failed attempt,
nothing from the brief's §8 list touched.

If none: cycles since last review 1/3, diff 510 insertions / 86 deletions across 6 files (cap 800/10)
— both well under the batch cap.

**REVIEW: RECOMMENDED** (not required by any trigger, but see reason).
Reason: this cycle's DOM-half design (delegated listeners plus a `window`-level drag gesture,
deliberately unlike the canvas's own per-element pattern) is untested by construction and a human has
not yet seen it — D-103's own rationale for forcing D-102's review ("the first code that writes state
from a mouse gesture") arguably already applies in spirit to this cycle's panel-drag/dismiss, even
though D-103's literal text reserves that language for D-102's DOCUMENT-state writes. I verified it
live in a real browser (see above) rather than only by hand-reading, which lowers but does not
eliminate the case for a human's own look before D-102 builds further mouse-driven writes on top of
this cycle's pattern.
Questions for reviewer:
  1. Is the delegated-listener / `window`-drag design (Decisions 1-2 above) the right shape for
     D-102's OWN drag-free interactions (typing into a row), or should D-102 reconsider it once row
     inputs exist and `updatePanels`'s whole-rebuild-per-paint meets clause 8's requirement head-on?
  2. Does D-106 clause 6's re-show gesture ("shift-click it out and back in, or escape and reselect")
     mean to EXCLUDE "narrow a multi-selection down to the dismissed object with a plain click," as
     built and confirmed live above — or was that combination simply not considered and worth a
     ruling of its own?
