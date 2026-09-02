# 0153 — text-box rework: the editor becomes a Word/PowerPoint text box

Date: 2026-09-02   Phase: 5   Model: Opus 5 (implementer)
Previous entry: 0152-editor-cycle   Last review: 0150-REVIEW-phase5 (verdict: ACCEPT)
Batch: **not batched — the human directed this cycle explicitly** ("Skip the typical review
process and go right to making code changes. Ignore the caps and limits and review your own work
with tests."). ~1220 added / ~180 removed lines across 21 files (17 modified, 4 new).

## The instruction this implements

The human tested entry 0152 on screen. D-136 (empty box auto-deletes; a typed `text` with content
does not open the editor) is confirmed GOOD. But: *"the input process for editing text directly is
proving to be a bit of a beast. I think it may be worth a whole rework of the system."*

Their specification, verbatim in substance:

1. **A text object should work like a text box in Word or PowerPoint**, plus Graphpaper's own
   goodies (properties, formulas, slot references in text). Critically: *"in those editors, there
   is no difference between how the text looks when you're not editing it and how it looks when
   you are. That's the goal."*
2. **"no goddamn scroll bars when editing text! either vertically or horizontally!"** If typing
   grows the box, let it grow. *"the text auto-cropping is honestly an infuriating behavior that we
   should have flagged earlier."*
3. **Resize grabbers in the corners**, like Word/PowerPoint. Overflowing text auto-expands the box.
   An **`autoresize`** property in the props panel toggling what happens when the text gets SMALLER
   than the box: shrink to fit, or stay as it was.
4. **The properties panel should offer a drop-down** where a slot's valid inputs are a small closed
   set (`style.align` was their example) instead of a free text box.

They also said: *"I do not care if this contradicts things you have ruled or written before, or
what's in the brief."* The list of what it contradicts is in "Rulings overruled" below, stated
rather than buried, because the log is the only continuity.

## Declared scope

The four items above, in one cycle, with tests. Not in scope: markdown-lite, `overflow`
clip/ellipsis, the load-hardening cycle (D-126/D-127/D-108), the Phase 5 gate.

## What I did

### New — `src/render/textbox.ts`: ONE box-sizing rule, three readers

`textBoxSize({ fixedWidth, fixedHeight, autoresize, measuredWidth, measuredHeight })`. The rule:

- No set size → the measurement (the box hugs its text).
- Set size, text BIGGER → the measurement. **A text box never crops.** This is item 2.
- Set size, text SMALLER → `autoresize` decides: `true` shrinks to fit, `false` keeps the set size.

**Width is deliberately asymmetric and this is the one judgement call worth arguing with.** A
numeric `width` is also the WRAP width (`measure.ts`'s `maxWidth`), so shrinking the box to the
longest line would leave the operator's dragged edge invisible while still wrapping there. A set
width is therefore a FLOOR, never a ceiling — only the height answers to `autoresize`, exactly as
"resize shape to fit text" works in Word. A set width still grows for a single word longer than the
box, since `measure.ts` breaks between words only.

Read by `extent.ts` (the committed box), `renderer.ts` (the box alignment is measured against) and
`editor.ts`/`main.ts` (the LIVE box while typing). One rule, so the three cannot disagree (D-010).
`extent.ts`'s own `TEXT_AUTO_BOX_*` constants and `editor.ts`'s `EMPTY_TEXT_EDITOR_*` are both gone,
folded into this file's single fallback pair.

### `autoresize` — a twelfth non-derived `text` slot

`TEXT_AUTORESIZE_PATH` (`primitives/text.ts`), in `TEXT_SCHEMA`, defaulted `true` by `createText`.

**Deliberately NOT a dependency of `measuredHeight`/`measuredWidth`.** It sizes the BOX, not the
TEXT, and the measurement is of the text. Two consequences, both wanted: toggling it never
re-measures, and **a document saved before it existed still loads** — nothing derived depends on it,
so there is no dangling edge, and every reader defaults it to `true`. That is D-126's trap avoided
by construction rather than by luck, and there is a test that loads exactly such a document.

### The editor overlay — world units plus one transform (item 1)

This is the structural change, and it is what makes drawn and typed text lay out identically.

**Before:** the overlay's box and font were pre-multiplied into CSS pixels (`fontSize * camera.zoom
/ ratio`), so the browser laid text out at a fractional font size against a fractional width while
`render/measure.ts` measured at the round WORLD size against the round world width. Two different
layout problems. They broke lines in different places — live-look item 6's "2 drawn lines, 3 typed",
which D-135 only partly explained.

**Now:** `EditorPlacement` carries `width`/`height` in WORLD units plus a `scale`, and
`EditorTextStyle` carries `fontSize`/`lineHeight` in WORLD units, unscaled. `main.ts` sets those and
one `transform: scale(camera.zoom / ratio)` with `transform-origin: 0 0`. The browser is handed the
exact numbers the canvas measurer gets; the transform magnifies the finished layout, and a
transform cannot move a line break.

`editorTextStyle` also now carries `color`, read from `style.color` — a box that changes colour the
moment you click into it fails item 1 on sight.

### No scrollbars, because there is nothing to scroll (item 2)

- `index.html`: `.text-editor` is `overflow: hidden`. Not a hidden scrollbar — nothing to scroll.
  Background is now `transparent`.
- `editorTextBoxSize(object, typed, style, measurer)` (new, in `editor.ts`) measures the text
  CURRENTLY IN THE EDITOR through the same `textbox.ts` rule, and `main.ts` re-runs it on every
  `input` event. The box grows under the caret.
- `renderDocument` takes `editingObjectId` and skips drawing that object's text, its selection
  outline and its grabbers. While the editor is open the overlay IS that object's text; drawing
  underneath would double every glyph the moment the two differ — and they differ by design, since
  the overlay holds RAW source and the canvas draws RESOLVED content.
- `CARET_ALLOWANCE` (2 world units) is added to a NON-wrapping box only: its width is otherwise the
  exact end of the text, and with `overflow: hidden` a caret on the boundary is invisible. Not added
  to a wrapping box — there the width is the wrap boundary and widening it would move a break.

### Resize grabbers (item 3)

New `src/render/handles.ts`: eight grabbers (corners + edge midpoints), `hasResizeHandles` (`text`
only — a shape's size is `radius`/`sides`, a different question), `resizeHandleAt` (SCREEN-space hit
test with a pixel tolerance, so a grabber is the same size at every zoom), `resizeBox` (clamped so an
edge can never cross its opposite), `resizeCursor`.

`interaction.ts` gains `ResizeState` on `InteractionState` — a SEPARATE field from `drag`, so every
existing reader of `drag` keeps meaning what it meant. `pointerDown` checks grabbers first, but only
on already-SELECTED objects, so a first click can never be stolen.

**A resize is ABSOLUTE, not incremental**, and this is load-bearing: each step recomputes the box
from the gesture's own `startExtent` plus the total delta since the press. An incremental resize
would read the committed box back in — which `textbox.ts` has already grown to fit the text — and
run away from the pointer. It also means a refused step needs no delta held back.

**A height drag also writes `autoresize: false`.** Without it the box snaps straight back to its
text and the grabber looks broken. This mirrors Word turning "resize shape to fit text" off when you
size a box by hand. A width drag does not touch it (a set width never shrinks anyway).

§5.9's per-component rule applies unchanged: a bound `origin.x` is skipped with a notice and the
rest of the box still resizes.

`renderer.ts` draws the grabbers in the screen-space chrome pass; `main.ts` sets the canvas cursor
from `resizeHandleUnder` on pointer move.

### Properties-panel drop-downs (item 4)

`ObjectSchema` gains `slotOptions: SlotOptionSet[]` — declared on the SCHEMA, because what a slot
accepts is a fact about the type, not about a UI, and `props` reads the same enumeration the panel
does (D-094 clause 9). `TEXT_SCHEMA` declares three: `style.align` (left/center/right),
`overflow` (visible/clip/ellipsis), `autoresize` (true/false, with readable labels —
"shrink to fit text" / "keep the size I set").

`SlotDescriptor.options` → `PanelRow.choices` → a `<select>` that commits on `change` through
`commitPanelChoice` → `runPanelCommand` → `executeCommand`. No second write path.

Three details that are decisions, not mechanics:

1. **The option carries its INDEX, not its label or its stringified value.** An index resolves back
   to the exact `Value` including a `boolean`, which no string round-trip does (`"false"` is a
   non-empty string, and D-102 clause 6's grammar would make it a formula).
2. **A `formula` row gets NO drop-down**, only a `literal` one. It is driven; a choice that silently
   overwrote the formula is what D-040 forbids a gesture from doing. Unlink first.
3. **`selectedIndex` is `-1` when the slot holds something none of the choices names** — a
   hand-typed `set`, or a formula since unlinked. The control shows blank rather than lying.

Also: the panel's `pointerdown` `preventDefault` carve-out now includes `.panel-row__choice`
(without it, `preventDefault` stops a `<select>` opening, and the control would be inert), and a
panel is not rebuilt while one of its selects has focus (`replaceChildren` would tear it out
mid-gesture — the same protection D-102 clause 8 gives an open row input).

## Rulings and spec this overrules — stated, not buried

The human pre-authorised this ("I do not care if this contradicts things you have ruled"). Each is
a real reversal and a future reader needs to know it was deliberate:

- **D-123 clause 3** — "the width slot the operator SET wins over measuredWidth — that is the box,
  whatever the ink does inside it." **Inverted.** A set size is now a floor; the box grows rather
  than cropping. `hittest.test.ts`'s test of the old rule was rewritten (§6.1 trigger 5).
- **D-129 clause 2 / D-135** — `overflow: auto` and zero-layout scrollbars. **Replaced** by
  `overflow: hidden` plus a box that grows, which is what the human asked for. D-135 was built one
  cycle ago and is now superseded by a better answer to the same complaint; F28 stays closed.
- **D-132 clause on colour** — "the overlay keeps one high-contrast ink." **Reversed.** Item 1 makes
  matching colour mandatory. The clause's reasoning (colour cannot move a glyph) was sound and is
  simply no longer the criterion.
- **D-129's scaled type style** — `editorTextStyle` no longer multiplies by `camera.zoom / ratio`.
  The scaling moved to a CSS transform, which is what makes the layout match. Its `PROVISIONAL(Q-012)`
  tag survives with reworded reconciliation.
- **§5.6's `TextBox` slot list** — a twelfth non-derived slot (`autoresize`). §5.6 lists no such
  field. A named deviation, like D-121's `origin.x`/`origin.y` and D-123's `measuredWidth`.
- **§5.10 / D-102 clause 6** — a panel row's grammar was "a bare number is a literal, anything else
  a formula." A drop-down row writes a literal string or boolean directly. **Q-016** asked exactly
  this question and is now partly answered in practice for enum rows; the free-text rows are
  untouched, so Q-016 stays open for them.

## Decisions I made

1. **Eight grabbers, not four.** They asked for corners. A corner cannot set a width without also
   setting a height, and the width is the one that matters (it is the wrap width). Edge grabbers are
   what Word/PowerPoint have too.
2. **`hasResizeHandles` is `text`-only.** A `circle`/`polygon`/`rect` is parametric; dragging its box
   is a different question with a different answer, and guessing one here would bake it in.
3. **A height drag turns `autoresize` off silently** rather than notifying. Argued above; the
   alternative is a notice on every drag step, which is spam.
4. **`autoresize` defaults `true`.** A fresh box then behaves exactly as it did before the slot
   existed, so the default changes nothing and only gives the operator something to turn off.
5. **The canvas cursor is set directly on the element, not through `AppState`.** It is a hover hint;
   routing it through `apply` would repaint the canvas on every mouse move that changed nothing.

## Verification (real output)

```
$ npx tsc --noEmit
(clean, exit 0)
$ npx tsc -p tsconfig.engine.json --noEmit
(clean, exit 0)
$ npx vitest run
 Test Files  33 passed (33)
      Tests  1632 passed (1632)
   (0 skipped, 0 todo)
$ grep -rnE "\.(only|skip|todo)\(" src
(no matches)
$ npx vite build
 ✓ 38 modules transformed.
 ✓ built in 326ms
```

1553 (0152) → **1632** (+79). Two new test files (`textbox.test.ts`, `handles.test.ts`); new
describes in `interaction.test.ts` (the resize gesture, end to end through the real `mutate`),
`editor.test.ts` (the live box), `renderer.test.ts` (grabbers + the edited object stepping aside),
`main.test.ts` (drop-downs, and the pre-`autoresize` document that must still load).

Two existing tests were rewritten because the rulings behind them were overruled, both named above:
`hittest.test.ts`'s D-123 clause 3 test and `schema.test.ts`'s slot-count test.

## Acceptance criteria status

Phase 5 criterion — NOT YET; untouched. This is authoring-surface work.

## Where I got stuck / what is unfinished

- **Nothing here has been seen on screen.** The DOM half is untested by construction (D-001) and
  this cycle changed a lot of it. The pure halves — the sizing rule, the handle geometry, the resize
  gesture, the live box, the drop-down model — are all tested; "does it feel like Word" is not a
  question any test here answers. **The human's on-screen test is the gate, as it has been.**
- **The residual wrap question may or may not be gone.** The world-unit + transform change is a
  principled fix for the root cause (two different layout problems), not a fudge. But canvas
  `measureText` and DOM text layout are still two engines, and they can still disagree on
  sub-pixel rounding or on how a trailing space at a wrap point is treated. If a residual survives,
  0151-RULINGS' "Carried forward" still binds: do NOT add slop to `render/measure.ts`.
- **The `overflow` slot's drop-down offers `clip` and `ellipsis`, which are unbuilt.** The slot was
  always settable, so this is not new — but the drop-down makes it discoverable, so it now looks
  like a feature rather than an unfinished one. Worth either building or removing from the option
  set. Note that "never crop" arguably makes `clip`/`ellipsis` obsolete now.
- **A width grabber dragged narrower than the longest single word snaps back** to that word's
  width, because the box follows its ink. Correct per the rule, possibly surprising in use.
- **A panel with a focused `<select>` stops updating its other rows** until the select is blurred.
  The smaller injury versus tearing the control out mid-gesture; self-heals on blur.

## Open questions raised

None. **Q-016** is narrowed but not closed — a free-text panel row's grammar is unchanged.
Next free: Q-025.

## Review point

The human directed this cycle to skip the review handoff and self-review with tests. Recording what
WOULD have fired, since the triggers are objective and a future reader should see them: §6.1
trigger 2 (two new subsystem files, `textbox.ts` and `handles.ts`), trigger 3 (deviation from §5.6's
slot list), trigger 5 (two changed test expectations), and §6.2 (`primitives/schema.ts` is
load-bearing and was touched). Under the normal process this is `REVIEW: REQUIRED`; under the
human's instruction it goes straight to their on-screen test.
