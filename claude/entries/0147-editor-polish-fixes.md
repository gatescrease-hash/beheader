# 0147 — editor-polish fixes: the operator's two defects in entry 0146

Date: 2026-09-02   Phase: 5   Model: Opus 5 (implementer)
Previous entry: 0146-editor-polish   Last review: 0144-REVIEW-phase5 (verdict: ACCEPT)
Batch: cycle 2 of up to 3 since last review; 301 source + 200 test lines across 9 files so far
(cap 800/10 — the FILE count is now 9 of 10).

## Declared scope

Fix the two defects the human found running entry 0146 on screen: **(1)** a middle click on the
canvas still commits and closes the in-place editor, drag or no drag; **(2)** the overlay lays its
text out differently from the canvas underneath it — "Hello World!" draws as one line and edits as
two, with a scrollbar. Both are in the in-place editor surface: `render/editor.ts`, `src/main.ts`'s
DOM half, `index.html`, plus the `readText` slot reader those two now share with `renderer.ts`.

## Explicitly not in scope

D-124, the load-hardening cycle, markdown-lite, `overflow` clip/ellipsis, the Phase 5 gate. The
cell editor's 4-world-unit text inset and a number cell's right-alignment (an editor holds the
SOURCE being typed; Excel left-aligns that too). Growing the overlay box as the operator types —
it scrolls, which is the branch D-129 clause 2 left to me and 0146 already chose.

## What I did

### Defect 1 — the pan commit. `src/main.ts`'s canvas `pointerdown`.

**Entry 0146's fix was in the wrong place, and I should have seen it.** I moved `commitInPlace()`
below the pan branch and left `input.focus()` above it. But the overlay commits **on `blur`**, and
`input.focus()` **is** a blur — fired synchronously, before the pan branch is ever reached. So the
commit still happened, one line earlier than the code I moved, and it needed no drag at all: any
middle-button press was enough. That is exactly what the human reported.

The fix is the focus, not the commit: `input.focus()` is now inside the pan branch, guarded by
`inPlaceEditor === undefined`. An open editor **keeps the keyboard through a pan**; with nothing
open the command bar takes it as always (§5.10). The plain-press path focuses the input and then
commits explicitly, as before — explicitly rather than via the blur, because `commitInPlace` is
re-entrant-safe but the ORDER matters: the commit must land before `pointerDownAt` moves the
selection.

`event.preventDefault()` stays at the top of the handler; its comment no longer claims it is what
protects the editor, because it never was.

### Defect 2 — drawn text and typed text lay out differently

Three separate causes, all of which had to go for the symptom to:

- **Font family.** The overlay was `font: inherit` — the page font, `ui-monospace`. A `text`
  object's default family is `sans-serif`. Monospace is materially wider, so text measured to fit
  its box in sans-serif could not fit the same box in monospace. This alone re-wraps almost any
  auto-width box.
- **A `<textarea>` soft-wraps; an auto-width `text` object does not.** §5.6: "auto width + auto
  height means no wrapping", and `drawText` passes no `wrapWidth` in that case.
  `DEFAULT_TEXT_WIDTH` is `"auto"`, so **this is the normal object**, not an edge case. The overlay
  wrapped where the canvas never would.
- **Padding and border ate 6px of the content box.** An auto-width box is fitted to the *exact*
  measured width of the committed text, so any horizontal inset guarantees the text no longer fits
  the box it was measured in.

**`src/render/editor.ts`** — `EditorPlacement` goes back to its 0144-reviewed shape
(`{left, top, width, height}`); entry 0146's `fontSize` field moves out into a new sibling,
`editorTextStyle(target, object, camera, ratio) -> EditorTextStyle`, which is the shape STATUS and
0145 suggested in the first place. It returns `fontSize`, `fontFamily`, `lineHeight`, `textAlign`
and `wraps`, reading every slot the way `renderer.ts` reads it and scaling every length by the same
`camera.zoom / ratio` the box uses (extracted as a shared `usableRatio`, so the box and its text can
never be scaled by different factors). `wraps` is `drawText`'s own condition — a positive numeric
`width` slot — re-read, not re-decided. A cell gets `drawTable`'s single font (14px sans-serif) and
a line box the full cell height, which reproduces its `textBaseline: "middle"` centring.

**`src/render/slots.ts` / `src/render/renderer.ts`** — `readText` (a slot value narrowed to a
non-empty string) moves from `renderer.ts`'s private helper into `slots.ts`, the file that exists
for exactly this (D-010), and `renderer.ts` imports it back. **This is a deliberate edit to a file
outside my batch and I want it seen as such.** The alternative was a second copy in `editor.ts` —
and the specific thing that copy would have to get right is "empty string counts as absent, so the
`?? "sans-serif"` default fires", which is *the bug I am fixing*, one drift away. One definition.

**`src/main.ts`** — `updateEditor` computes the style once per paint and sets `font-size`,
`font-family`, `line-height` and `text-align` inline; it also hands the style to
`buildInPlaceElement`, which sets `textarea.wrap = "off"` for a non-wrapping object. `wrap` is set
once at build rather than per paint because it reads the `width` slot, which no gesture can change
while the element holds the keyboard.

**`index.html`** — `.text-editor` loses `font: inherit` (nothing here may set a font now), loses
`padding` and `border`, and takes `outline: 1px solid #1a56db` for the focus ring: an outline is
painted outside the box and takes no layout, so the content box is exactly the box `main.ts` placed.

### Tests

`src/render/editor.test.ts`: the `editorPlacement` assertions revert to their 0144 form (the
`fontSize` field is gone from that struct); the `textObject` fixture takes an options object so a
test can set or omit each `style.*` slot and choose the `width` slot independently of the box width.
New `editorTextStyle` describe (13): size/family/line-height from the object's slots; both lengths
scale with zoom and divide by the ratio; missing slots fall back to `renderer.ts`'s own
`DEFAULT_TEXT_*` values; an empty `style.font` is absent, not a typeface; **`wraps` is false for an
auto-width object and true for a positive numeric `width`** (the defect, pinned); zero/negative
width does not wrap; align passes `center`/`right` and clamps the rest to `left`; a cell's font,
line box and no-wrap; a cell scales with zoom; the ratio guard; an empty `text` object gets a
positive, non-wrapping style (D-124's case).

## Decisions I made

1. **Split `editorTextStyle` out rather than growing `EditorPlacement` to nine fields.** A struct
   named "placement" carrying `wraps` and `fontFamily` is a lying name. This also shrinks 0146's
   unreviewed diff — the placement tests return to exactly what 0144 accepted.
2. **`wrap="off"` (the attribute) over CSS `white-space`.** The attribute is the documented
   mechanism for a `<textarea>` and works at build time with certainty. `white-space` on a textarea
   is widely supported but I am writing untestable DOM code and just got burned assuming a DOM
   behaviour; I took the one I am sure of.
3. **Matching the font FAMILY exceeds D-129 clause 1**, which said family "need not match". The
   human's report is that the mismatch is the defect, and their instruction outranks a reviewer
   ruling (STATUS's standing note). I read this as D-129 widened, not overruled — flagged below for
   the reviewer to record.
4. **`textAlign` is matched too**, though the human named only wrapping. It is the same class of
   defect (drawn and typed text disagreeing), three lines, and leaving one known member of the
   class unfixed invites another round-trip through the human, which is the expensive resource.
5. **Cell padding and number right-alignment are NOT matched.** The editor holds the source being
   typed, not the formatted value; Excel left-aligns while editing. Disclosed in `editor.ts`'s
   header.

## Verification (real output)

```
$ npx tsc --noEmit
<clean, exit 0>
$ npx tsc -p tsconfig.engine.json --noEmit
<clean, exit 0>
$ npx vitest run
 Test Files  31 passed (31)
      Tests  1533 passed (1533)
$ grep -rnE "\.(only|skip|todo)\(" src
<no matches — exit 1>
```

1521 (0146) → 1533 (+12): `editor.test.ts` +13 new, −1 (the `fontSize`-on-placement test, whose
field no longer exists there).

## Acceptance criteria status

Phase 5 criterion — NOT YET; untouched. This is authoring-surface work.

## Where I got stuck / what is unfinished

- **Neither fix is covered by a test, and neither can be.** Both live in `main.ts`'s `start`,
  `index.html`, and DOM behaviour (`blur` ordering, `wrap`, `outline` layout). `editorTextStyle` is
  tested hard, but "does the overlay now look like the text" is a question only the human can
  answer. **This is the second time in two cycles that an untested DOM change I believed was
  correct was not.** The honest status is: the reasoning is sound and specific, and it is unverified.
- **Defect 1's root cause was visible in the code I wrote at 0146.** `commitInPlace` is registered
  as the `blur` handler four lines above the handler I edited. I moved the explicit call and did not
  ask what else could fire the same commit. The lesson is not "test the DOM" — it is that moving a
  call is not the same as establishing that it is the only caller.
- **Vertical alignment inside the line box is approximate.** The canvas draws with
  `textBaseline: "top"`; CSS centres the glyphs in a `line-height` box, so with `lineHeight >
  fontSize` the overlay's first line sits a fraction low. Sub-pixel at the default 16/20 and not
  worth a layout hack; named here rather than discovered later.
- **`readText` moving to `slots.ts` touches `renderer.ts`,** which is outside this batch (§4).
  Deliberate, argued above, and `renderer.test.ts`'s 62 tests cover the behaviour unchanged.
- The batch is now **9 files** against §6.3's cap of 10. The next cycle should assume it must stop.

## Open questions raised

None. Next free: **Q-025**.

## Review point

Fired: **§6.1 trigger 3** — this widens **D-129 clause 1** (font family and alignment now match,
which the ruling said need not) on the human's direct instruction, and **corrects D-130's
implementation**, which entry 0146 got wrong. Also §6.1 trigger 5 in spirit: `EditorPlacement` lost
a field added last cycle and its tests changed back. `REVIEW: REQUIRED`, and the reviewer should
record the D-129 widening as a ruling so D-124 inherits it.
