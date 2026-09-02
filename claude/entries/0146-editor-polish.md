# 0146 — editor-polish: D-129 + D-130 + D-131

Date: 2026-09-02   Phase: 5   Model: Sonnet 5 (implementer)
Previous entry: 0145-RULINGS-phase5   Last review: 0144-REVIEW-phase5 (verdict: ACCEPT)
Batch: cycle 1 of up to 3 since last review; ~122 source + ~113 test lines / 7 files changed so far
(0145 wrote no code — this cycle opens a fresh batch).

## Declared scope

Discharge the three rulings from the human's on-screen test of entry 0143's in-place editor:
**D-129** (the overlay's font tracks `style.fontSize × camera.zoom`, a cell a fixed base × zoom, and
it never clips its own text), **D-130** (a pan press does not commit the editor), **D-131**
(`formatFormula` gains an optional `relativeToObjectId`; the in-place cell editor shows same-table
references in bare Excel form). Files: `src/engine/formula/format.ts`, `src/render/editor.ts`,
`src/main.ts`, `index.html`, and their tests.

## Explicitly not in scope

**D-124** (`text` placed by pointing, open-editor-on-create) — the next slice, and the reason this
polish comes first. Matching the overlay's font FAMILY, markdown rendering or alignment (D-129 fixes
size + clip only — the rest stays a noted refinement). The properties-panel/overlay overlap. The
load-hardening cycle, markdown-lite, `overflow` clip/ellipsis, the Phase 5 gate.

## What I did

### `src/engine/formula/format.ts` — D-131

- `formatFormula(ast, objects, relativeToObjectId?)` — a third **optional** parameter. Threaded
  through `formatNode` (one added argument on every recursive call) and `formatOneAddress`.
- New `relativeCellReference(address, relativeToObjectId)`: returns the bare cell form (`A1`) when
  `relativeToObjectId` is set AND the address targets a `cells.<A1-form>` slot of exactly that
  object; `undefined` otherwise (a `cells.*` slot of another table, or any non-cell slot, has no
  host context that would let the bare form re-parse). Imports `TABLE_CELL_PATH_PREFIX` and
  `isCellReferenceForm` from `address.ts` rather than re-testing the shape here (D-010).
- `reference` node: prints bare via `formatOneAddress`'s new relative check.
- `range` node: **both endpoints relative or neither** (D-131 clause 1). If both endpoints resolve
  to a relative cell form, print `A1:B4`; otherwise both print fully qualified (the fallback branch
  passes `undefined` explicitly, so the mixed `table_1.A1:B4` form — which does not re-parse — is
  unreachable). D-045 already guarantees both endpoints name the same object, so this is belt-and-
  braces, but it makes "never mixed" a property of the code rather than of a separate invariant.
- Every other `formatFormula` caller (`props.ts`, `commands.ts` ×3, §5.4's future formula bar)
  passes no third argument and is byte-for-byte unaffected — pinned by a new `format.test.ts`
  assertion.
- Header: the round-trip invariant and `formatFormula`'s doc comment now state the relative mode and
  its "both or neither" range rule; the `range` case comment updated to match. Present-tense (D-060).

### `src/render/editor.ts` — D-129

- `EditorPlacement` gains `readonly fontSize: number` — CSS pixels, the drawn text's world size
  scaled by the SAME `camera.zoom` and backing/CSS `ratio` as the box (`(fontWorld * camera.zoom) /
  ratio`), so a glyph and the box around it stay in proportion at every zoom.
- `fontWorld` is the `text` object's own `style.fontSize` slot (`textEditorFontSize`, read through
  `render/slots.ts`'s `readNumber` — same path/fallback shape as `renderer.ts`'s `resolveTextStyle`,
  D-010) or, for a cell, `CELL_EDITOR_FONT_SIZE` (14, mirroring `renderer.ts`'s `TABLE_CELL_FONT`
  "14px" — a cell has no per-object style slot). `TEXT_EDITOR_FALLBACK_FONT_SIZE` (16, matching
  `renderer.ts`'s `DEFAULT_TEXT_FONT_SIZE`) stands in for a missing/unusable `style.fontSize`.
- Box anchoring and initial size are untouched (D-129 clause 3) — the empty-`text` fallback box,
  the ratio guard, `worldToScreen` — all as entry 0143 left them.
- Both new constants are round and untuned (Rule 5); noted on the open constant-tuning list
  (STATUS, fix-list item 8) beside `EMPTY_TEXT_EDITOR_*`.

### `src/main.ts` — D-129, D-130, D-131

- **D-129**: `updateEditor` sets `inPlaceElement.style.fontSize` from `placement.fontSize` every
  paint, alongside the existing left/top/width/height.
- **D-130**: the canvas `pointerdown` handler's `commitInPlace()` call moved **below** the
  `event.button === 1 || spaceHeld` pan branch. A pan press now returns before it — the editor
  stays open and its overlay tracks the receiver through the pan (it re-places every paint). A
  plain canvas press still commits ("a click outside", D-128). `event.preventDefault()` stays at
  the top of the handler, so it suppresses the committing blur for BOTH gestures and the decision
  is made explicitly in code. Comments rewritten to say which branch does what and why.
- **D-131**: `editorSeed`'s cell-formula branch passes `object.id` as `formatFormula`'s
  `relativeToObjectId` — the same host-table context `commitTableCell` → `parseFormula` reads the
  seed back with, so an untouched commit is a no-op.
- Header `NOT DONE HERE`: the "font not matched to style/zoom" note narrowed to family/markdown/
  alignment (size is done now).

### `index.html` — D-129

- `.text-editor` CSS: `overflow: hidden` → `overflow: auto` (clause 2 — a `<textarea>` scrolls
  rather than clips, a cell `<input>` scrolls horizontally). Comment updated: the inline
  `font-size` main.ts now sets overrides the `font: inherit` family.

### Tests

- `src/engine/formula/format.test.ts` (+7): a same-table ref prints bare with `relativeToObjectId`;
  stays qualified with NO third arg (the "every caller unaffected" pin); a different-object ref stays
  qualified even with a relative object; a same-table ref stays qualified when the relative object is
  something else; a same-table range prints both endpoints bare; a range stays qualified when its
  table is not the relative object; a seed → format → re-parse round trip with the host table yields
  an identical AST.
- `src/render/editor.test.ts` (+1, 4 updated): the existing `editorPlacement` `.toEqual`s gained
  `fontSize`; new cases — font scales with `style.fontSize × zoom`, divides by the ratio, falls back
  to a default for an unusable slot, positive for the empty-`text` fallback, a cell uses the fixed
  base. `textObject` fixture gained an optional `styleFontSize` param.
- `src/main.test.ts` (+3): `editorSeed` shows a same-table ref bare; a cross-table ref stays
  qualified in the cell editor (D-131 clause 3); a `=SUM(A2:A5) + B1` seed round-trips to the same
  stored slot when committed unchanged.

## Decisions I made

1. **`fontSize` is a field on `EditorPlacement`, not a separate function.** STATUS floated "a sibling
   of `editorPlacement`"; one function already computes the box from the same camera/ratio, and the
   font needs exactly those inputs, so a second entry point would duplicate the plumbing for one
   number. One call site in `updateEditor` either way.
2. **A `<textarea>` scrolls; it does not grow.** D-129 clause 2 left this to the implementer.
   `updateEditor` re-places the overlay (height included) every paint to keep it on its receiver's
   box; a growing textarea would fight that re-placement. `overflow: auto` keeps the caret visible
   (browsers scroll a textarea to its caret as you type) without a second layout mode.
3. **The cell base font size is a local constant (14), not an import.** `renderer.ts`'s
   `TABLE_CELL_FONT` is the string `"14px sans-serif"` — not a number to import. A local constant
   with a comment naming the renderer constant it mirrors is the D-010-consistent move here (same as
   `EMPTY_TEXT_EDITOR_*` mirroring `extent.ts`'s fallback by value + comment, which 0144-REVIEW
   accepted).
4. **`range` prints both-or-neither explicitly** rather than relying on per-endpoint resolution +
   D-045. Costs three lines; buys "never mixed" as a code property.

## Verification (real output)

```
$ npx tsc --noEmit
<clean, exit 0>
$ npx tsc -p tsconfig.engine.json --noEmit
<clean, exit 0>
$ npx vitest run
 Test Files  31 passed (31)
      Tests  1521 passed (1521)
$ grep -rnE "\.(only|skip|todo)\(" src
<no matches — exit 1>
```

Baseline 1510 (0143/0144) → 1521 (+11): `format.test.ts` +7, `editor.test.ts` +1, `main.test.ts` +3.

## Acceptance criteria status

Phase 5 criterion (a text box updating number + branch + wrap + non-taken-branch reactivity) — NOT
YET; untouched by this cycle (the in-place editor is an authoring surface, not an evaluation
change). The gate still sits after markdown-lite and `overflow`.

## Where I got stuck / what is unfinished

- **Nobody has seen D-129/D-130 on screen.** They live in `main.ts`'s DOM half and `index.html`,
  both untested by construction. Every assertion here is on the pure geometry (`editorPlacement`'s
  `fontSize`) or the pure seed (`editorSeed`'s relative form). Whether the scaled font actually
  reads well at extreme zoom, whether the textarea scroll keeps the caret comfortably in view, and
  whether a space-drag pan really leaves the editor untouched — all need a human. 0144-REVIEW and
  0145 both asked for a live look before D-124; it matters the same amount here.
- **D-130 has no automated test.** It is one conditional moved in an untested listener. The pure
  `pointerDownAt` never knew about the in-place editor (that is DOM-half state), so there is nothing
  to assert against. Described above; needs the same live look.
- **`overflow: auto` on the cell `<input>`** does nothing a plain text input does not already do
  (single-line inputs scroll horizontally by default). It is set for the `<textarea>` and harmless
  on the `<input>`; I did not split the CSS class for one property.
- The overlay still does not match font family, markdown, or alignment — explicitly out of D-129's
  scope, still true.

## Open questions raised

None. Next free: **Q-025**.

## Review point

Fired: **§6.1 trigger 3** — three fresh binding rulings (D-129/D-130/D-131) implemented, and a new
parameter added to `formatFormula`, an engine formatter with five existing call sites. Not the
first file of a subsystem (the editor was reviewed at 0144), and the batch cap is nowhere near
(cycle 1/3, ~122 source lines / 7 files). `REVIEW: REQUIRED`.
