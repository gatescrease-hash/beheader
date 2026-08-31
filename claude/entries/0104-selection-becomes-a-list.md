# 0104 — selection becomes a list
Date: 2026-08-31   Phase: 4   Model: Claude Sonnet 5
Previous entry: 0103-REVIEW-phase4   Last review: 0103-REVIEW-phase4 (verdict: ACCEPT WITH EDITS)
Batch: cycle 1 of up to 3 since last review; ~384 lines / 8 files changed — moot, D-100 clause 9
fires a review point at THIS cycle's own end regardless of the cap.

## Declared scope

**D-100** exactly: `InteractionState.selectedObjectId` becomes `selectedObjectIds: readonly
string[]`; a plain click replaces the selection, a shift-click adds to it or (PROVISIONAL(Q-015))
toggles an already-selected object out; `renderDocument` highlights and suppresses the name of
every selected object, not just one. Not in scope: D-101's N panels, D-102's writable panel, or any
command-line multi-select syntax (D-100 clause 7 keeps `select <name>` a single-object replace).

## Explicitly not in scope

D-101 (one panel per selected object, draggable) and D-102 (the paperclip, writable rows) — both
are next. No change to `command/commands.ts`'s `CommandEffect` shape: `{ kind: "select", objectId
}` already matches D-100 clause 7 as written, so despite being named in D-100's "binding on" list,
`commands.ts` needed no code edit — checked and disclosed rather than silently skipped.

## What I did

- **`src/render/interaction.ts`** — `InteractionState.selectedObjectIds: readonly string[]`
  (`INITIAL_INTERACTION_STATE` now holds `[]`). `pointerDown` is reordered to take `state` first
  (matching `pointerMove`'s own convention) and gains `additive: boolean = false`, the shift-key
  flag: `false` replaces the selection with the hit object or clears it on empty canvas (clause 2);
  `true` adds the hit object or, via the new `toggleSelection` helper, removes it if already
  selected (clause 4, **PROVISIONAL(Q-015)**, tagged at the site as OPEN_QUESTIONS.md's own
  instruction asked); a shift-click on empty canvas returns `state` unchanged (clause 3). A drag
  always arms on the object under THIS press regardless of whether the toggle just added or removed
  it (my own reading of clause 6 — see "Decisions I made" below). `pointerMove`/`pointerUp` carry
  `selectedObjectIds` through unchanged otherwise. File header widened with D-100's click model.
- **`src/render/renderer.ts`** — `renderDocument`'s trailing parameter is now `selectedObjectIds:
  readonly string[] = []`. The selection-highlight pass now loops `objects` once, stroking every
  object whose id is in a `Set` built from `selectedObjectIds` (was a single `.find`), which also
  naturally drops a duplicate or a stale id with no special-casing. The chrome pass's name
  suppression reads the same `Set` instead of `=== selectedObjectId`. File header and the
  function's own doc comment reworded for the list.
- **`src/main.ts`** — `performEffect`'s `"select"` case now builds `{ selectedObjectIds:
  [effect.objectId], drag: undefined }` (D-100 clause 7: `select <name>` replaces with one object).
  `pointerDownAt` gains `additive: boolean = false` and passes it through to `pointerDown` along
  with `state.interaction`; the `pointerdown` DOM listener now passes `event.shiftKey`. `paint()`
  hands `renderDocument` the whole `selectedObjectIds` list. `updatePanel` reads
  `selectedIds.length === 1 ? selectedIds[0] : undefined` — see "Decisions I made" item 3. Two
  header comments corrected (`selectedObjectId` → `selectedObjectIds`; the panel's NOT-DONE-HERE
  note now discloses that N panels are not built this cycle).
- **`src/render/panel.ts`** — one header sentence reworded (no code change): the "is the panel
  shown at all" pointer now says "the selection", not `selectedObjectId`, and notes D-100/D-101's
  single-panel interim.
- **Tests** — `src/render/interaction.test.ts`: every `pointerDown` call site updated to the
  reordered signature; six new tests (shift-click add, shift-click toggle-off, shift-click-on-empty
  no-op, drag-arms-on-toggled-off-object, `pointerUp` preserves a multi-object list, plus the
  reworded `describe` block title). `src/render/renderer.test.ts`: every `renderDocument` selection
  argument converted from a bare string to a one-element array; two new tests (highlights every
  selected object; suppresses every selected name). `src/main.test.ts`: every
  `.selectedObjectId` assertion converted to `.selectedObjectIds` array form; one new end-to-end
  test exercising `pointerDownAt`'s `additive` flag through `AppState`. `src/command/commands.test.ts`:
  its one direct `pointerDown` call updated to the new signature.

## Decisions I made

1. **`pointerDown`'s parameter order puts `state` first.** The shift-click toggle needs the PRIOR
   selection, so "no prior state" (the old doc comment's own claim) stopped being true regardless
   of how the parameter was placed; putting `state` first matches `pointerMove`'s existing
   convention rather than inventing a second argument order in the same file.
2. **A drag arms on the pressed object even when a shift-click just toggled it OUT of the
   selection.** D-100 clause 6 says a drag "targets exactly the object under the press, whatever
   else is selected" — read as: the drag target is decided by the press alone, never by what the
   selection list contains. The alternative (no drag when the toggle just deselected) would need a
   second rule clause 6 does not state, and would make an accidental shift-click on a selected
   object silently swallow the next mouse-move instead of behaving like every other press. Cheap to
   narrow later if the human disagrees — one branch, one test.
3. **The panel stays single-object this cycle: shown only for a selection of exactly one, hidden
   for zero or for two-or-more.** D-101 ("one panel per selected object") is the very next queued
   cycle (D-103's own order), so building any interim multi-panel behaviour here would be thrown
   away in one cycle. Hiding rather than guessing which of several objects to show preserves
   exactly today's visible behaviour for the one case that existed before this ruling (a
   single selection) and adds no new guess for the case that didn't (multiple).
4. **`renderDocument`'s `selectedObjectIds` got a default value of `[]`**, so every existing call
   site that means "nothing selected" needs no change — TypeScript's default-parameter rule also
   lets an explicit `undefined` keep compiling, which is why `renderer.test.ts`'s one
   `renderDocument(..., undefined)` call needed no edit either.
5. **`toggleSelection` is a small top-level function, not inlined into `pointerDown`.** It is the
   one piece of new logic dense enough to deserve its own name and its own one-line doc comment
   pointing at D-100 clause 4 and the open question it is provisional against.

## Verification (real output)

```
$ npx tsc --noEmit
(clean — no output)

$ npx tsc --noEmit -p tsconfig.engine.json
(clean — no output)

$ npm test -- --run
 Test Files  27 passed (27)
      Tests  1223 passed (1223)
```

`npm run build` also succeeds (`vite build`, 32 modules transformed, no errors).

**Mutation-checked** (D-016's own lesson, restated in STATUS.md's gotchas — a test passing on its
first run is not yet trusted): three deliberate breaks, each restored after confirming red.
1. `toggleSelection` changed to always-add (never remove) → the toggle-off test, the
   drag-arms-on-toggle-off test, and the end-to-end shift-click test in `main.test.ts` all failed
   red, correctly.
2. `pointerDown`'s empty-canvas branch changed to always return `INITIAL_INTERACTION_STATE`
   (dropping the `additive` check) → the "shift-click on empty canvas changes nothing" test failed
   red.
3. `renderDocument`'s `selectedIds` set narrowed to `selectedObjectIds.slice(0, 1)` (only ever the
   first id) → both new multi-selection tests (highlight, name suppression) failed red.
All three were reverted and the suite re-confirmed green (1223/1223) before this entry was written.

## Acceptance criteria status

No Phase 4 criterion is claimed this cycle. D-100 is an interaction-model ruling from the human's
own session at entry 0100, not itself Phase 4's acceptance criterion (§6: "two separate polygons
bound through a table, in one document") — that session is still owed, per STATUS.md's own
standing note, and nothing here substitutes for it.

## Where I got stuck / what is unfinished

Nothing was abandoned mid-slice. Two things are genuinely open, both by design:
- **Q-015** (does a shift-click toggle an already-selected object out) is the human's own open
  question. I took the provisional "yes" D-100 clause 4 already named, tagged
  `PROVISIONAL(Q-015)` at `toggleSelection`, and it is reversible in one branch if the human rules
  otherwise.
- **The panel's behaviour under a multi-selection is a placeholder** (hide, per "Decisions I made"
  item 3), not a real answer — D-101 is what actually answers "what does the operator see when two
  objects are selected."

## Open questions raised

None new. Q-015 is unchanged in status (OPEN, the human's) but its `PROVISIONAL` tag is now
actually placed in code, where OPEN_QUESTIONS.md said D-100's cycle would put it.

## Review point

**Fired — D-100 clause 9.** "This is a review point. It changes a shared state shape across three
files and every test that constructs an `InteractionState`. Stop at the end of it." All three named
files (`interaction.ts`, `renderer.ts`, `main.ts`) changed; `commands.ts`, the fourth file D-100
names, needed no edit (see "Explicitly not in scope"). Cycle count resets to 0/3 after this review,
whatever its verdict.
