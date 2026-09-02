# 0143 — in-place editing: D-125's editor surface

Date: 2026-09-02   Phase: 5   Model: Sonnet 5 (implementer)
Previous entry: 0142-REVIEW-phase5   Last review: 0142-REVIEW-phase5 (verdict: ACCEPT)
Batch: cycle 1 of up to 3 since last review; ~350 source + ~284 test lines / 5 files changed so far.

## Declared scope

Build **D-125** (in-place text entry, the human's ABSOLUTE PRIORITY): a new `render/editor.ts`
holding the geometry (which receiver a double-click names, where the DOM overlay floats), plus
`main.ts`'s pure-half commit functions (`commitTextContent`, `commitTableCell`, `editorSeed`) and the
DOM-half wiring in `start` — a double-click opens a `<textarea>` over a `text` object's `content` or
an `<input>` over a table cell, committing through the existing `runPanelCommand` → `executeCommand`
seam (Rule 2), `content` always a literal `set` and a cell Excel-style.

## Explicitly not in scope

**D-124** (`text` placed by pointing) and its "open the editor on creation" wiring — D-125 clause 4's
double-click is the only open path this cycle. Markdown-lite, `overflow`, the load-hardening cycle
(D-126/D-127/D-108), the Phase 5 gate. Matching the overlay's font to `style.fontSize`/zoom, and
keeping the overlay clear of an overlapping properties panel — both left as plain defaults.

## What I did

### `src/render/editor.ts` (NEW — first file of the in-place-editor subsystem)

The geometry half of D-125, pure, render-layer, no DOM. Two exported functions:

- `editorTargetAt(screenPoint, objects, camera)` → `EditorTarget | undefined`. Uses `hitTest` (same
  z-order a click uses) to find the topmost object; a `text` object → `{ kind: "text", objectId }`;
  a `table` → the cell the point falls in, resolved to its A1 reference through `address.ts`'s
  `formatCellReference` (never a string join), → `{ kind: "cell", objectId, cell }`; anything else →
  `undefined`. A `text` object with no drawn extent is not hittable, so returns `undefined` — that
  case (D-125 clause 6) is only reachable through D-124's creation path, which hands the target in
  directly.
- `editorPlacement(target, object, camera, ratioBackingPerCss)` → `{ left, top, width, height }` in
  CSS pixels. From the receiver's world box — `extent.ts`'s `objectExtent` for a `text` object, the
  cell's `origin + TABLE_CELL_*` rectangle for a cell — through `camera.ts`'s `worldToScreen`, then
  divided by the backing/CSS ratio the way `panel.ts` does (D-086 clause 3). An empty `text` object
  (no extent) gets a fixed fallback box anchored at `origin` — the EDITOR's own affordance, D-125
  clause 6; `extent.ts` still returns `undefined` for it and is NOT loosened (D-066).

### `src/main.ts`

Pure half — new "In-place editing (D-125)" section:

- `editorSeed(state, target)` — the text the editor opens showing. A `text` object's raw `content`
  literal, verbatim (§5.6). A cell Excel-style: `=<formatFormula source>` for a formula, or
  `describeSlotValue(value)` for a literal (the same formatter `props`/the panel use). `""` for a
  stale id or an unwritten cell.
- `commitTextContent(state, objectId, raw, context)` — **always** `{ kind: "set", target:
  "<name>.content", value: raw }`, run through `runPanelCommand`. The text is never sniffed for a
  leading `=`; `buildPanelSetCommand` is deliberately not reused (D-125 clause 3, the trap — it would
  route `Hello world` to `set-formula` and D-122 would refuse it). Stale id → no-op.
- `commitTableCell(state, objectId, cell, raw, context)` — `buildCellCommand` does the Excel-style
  split: leading `=` → `set-formula` (source kept verbatim, `=` included — `setFormula` slices it);
  `parseCommandNumber` succeeds → literal number; else → literal string. Stale id → no-op.

DOM half in `start`: `inPlaceEditor`/`inPlaceElement` closure `let`s (not `AppState` — opening writes
no document state, and a DOM handle is not serializable, D-101 clause 7's reasoning). `editorLayer`
is `canvas.parentElement` (`#stage` — a sibling of `#panels` with no delegated listeners, so a click
in the overlay needs no carve-out). `updateEditor()` (called from `paint`) builds the element once,
focuses+selects it, and re-places it every paint so it tracks its receiver through pan/zoom/resize;
a receiver deleted mid-edit closes the editor. `commitInPlace`/`cancelInPlace`/`closeInPlaceEditor`
handle the element lifecycle, re-entrant-safe (the handle is nulled before the focused element is
removed, so the `blur` its removal fires is a no-op). New `dblclick` listener on the canvas opens the
editor; the canvas `pointerdown` handler now commits an open editor first (a press is "a click
outside", D-125 clause 5, and its own `preventDefault` would otherwise suppress the committing blur).
Header updated: D-125 added to the binding list; the stale "no `text` command / nothing paints it"
NOT DONE HERE note corrected (0136/0138 built both; main.ts's header had not been reopened since).

### `index.html`

`.text-editor` CSS — `position: absolute`, a blue border, `font: inherit`, `resize: none`. Comment
added.

### Tests

- `src/render/editor.test.ts` (NEW, 13): `editorTargetAt` names a text object / the right cell
  (B3, A1) / `undefined` for a shape, empty canvas, an empty text object / topmost wins.
  `editorPlacement` covers a text box and a cell rect, applies pan+zoom, divides by the ratio, falls
  back to a positive box for an empty text object and to ratio 1 for a bad ratio.
- `src/main.test.ts` (+15): `commitTextContent` writes a literal, does NOT sniff a leading `=`
  (`=Hello world` → literal `"=Hello world"`), stores markup+newlines verbatim, echoes the command,
  no-ops a stale id. `commitTableCell` — `=` → formula (value 3), number → literal number, else →
  literal string, a broken formula is echoed not thrown, stale id no-op. `editorSeed` — raw content,
  cell literal, cell formula (`=1 + 2`), empty cell, stale id.

## Decisions I made

1. **D-125 clause 5 is internally contradictory** — "Escape cancels, and cancelling writes nothing"
   vs "commit is Escape or a click outside". I read it as the coherent version: **Escape cancels**
   (writes nothing), **a click outside / blur commits**, and **Enter commits in a cell only** (a
   `<textarea>` inserts a newline, per the clause's own "Enter inserts a newline" for a text box).
   Clause 5 is flagged in D-125 as a reviewer-chosen default the human may overrule on sight — this
   is a question for the reviewer.
2. **The overlay is mounted in `#stage`, not `#panels`.** `#panels` has delegated `pointerdown`/
   `click` listeners with `preventDefault`; mounting there would need the editor's input carved out
   of every one. `#stage` (the canvas's parent) has none. `canvas.parentElement ?? panelsContainer`
   — the fallback only fires if the DOM shape changes.
3. **The overlay is a plain input**, `font: inherit` (14px), not scaled to `style.fontSize` or the
   camera zoom. D-125 does not ask for WYSIWYG; the point is an input at the receiver's position. A
   real font match is a refinement, noted in the header's NOT DONE HERE.
4. **`editorPlacement` does not clamp to the viewport** (unlike `placePropertiesPanel`). The operator
   double-clicked something visible, so the overlay is on screen; clamping would only detach it from
   its receiver during a pan.
5. **`editorSeed` for a formula-driven `content`** (only reachable via a loaded illegal document —
   D-122 blocks the command path) returns the last-computed string value; committing then replaces
   the formula with a literal (D-040), which "fixes" the illegal state. Acceptable, arguably good.

## Verification (real output)

```
$ npx tsc --noEmit
<clean, exit 0>
$ npx tsc -p tsconfig.engine.json --noEmit
<clean, exit 0>
$ npx vitest run
 Test Files  31 passed (31)
      Tests  1510 passed (1510)
$ grep -rnE "\.(only|skip|todo)\(" src
<no matches>
```

Baseline 1482 (0142-REVIEW) → 1510 (+28): `render/editor.test.ts` +13, `main.test.ts` +15.

## Acceptance criteria status

Phase 5 criterion (a text box updating number + branch + wrap + non-taken-branch reactivity) — NOT
YET; unaffected by this cycle (in-place editing is an authoring surface, not an evaluation change).
The gate remains after markdown-lite and `overflow`.

## Where I got stuck / what is unfinished

- **Nobody has seen the overlay on screen.** `start` is untested by construction; every assertion
  here is on the pure geometry or the pure commit path. A human double-clicking a label and typing
  into it is the check neither model can perform — and it now matters more, because D-124 (next) will
  hand a freshly-created empty box straight to this editor. Worth a live look before D-124.
- **The log echo of a multi-line `content` commit** is `> set text_1.content <the text with its
  newlines>` — one array entry, several visual lines, and not a re-typeable line (no quoting). This
  is `describePanelCommand`'s existing behaviour for any string `set`, not new here; left alone.
- **D-125 clause 5's contradiction** (see Decisions 1) — resolved provisionally, needs the human or
  reviewer to confirm Escape=cancel / blur=commit / Enter=commit-in-cell.
- **The properties panel and the editor can overlap** when a selected object is double-clicked. Both
  anchor to the object's box. No remedy this cycle; noted in the header.
- The overlay does not visually match the drawn text (font size, markdown, alignment). It is a plain
  box the right size and place. Deliberate for v1.

## Open questions raised

None. D-125 clause 5's ambiguity is a reviewer/human confirmation, not a new `Q-NNN` (the ruling
already marks clause 5 as overrulable-on-sight).

## Review point

Fired: **§6.1 trigger 2** — `render/editor.ts` is the first file of a new subsystem (the in-place
editor). Also **§6.1 trigger 3** — D-125 extends §5.4/§5.6 with a new authoring surface (a human
ruling, but the surface is new). `REVIEW: REQUIRED`.
