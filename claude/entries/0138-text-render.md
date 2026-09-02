# 0138 — Text rendering: `renderer.ts`'s text pass, `extent.ts` + `hittest.ts` text box
Date: 2026-09-01   Phase: 5   Model: Sonnet 5 (implementer)
Previous entry: 0137-REVIEW-phase5   Last review: 0137-REVIEW-phase5 (verdict: ACCEPT WITH EDITS)
Batch: cycle 1 of up to 3 since last review; ~330 source lines / 4 source files changed so far.

## Declared scope

Draw a `text` object: `renderer.ts`'s `drawText` lays `resolvedContent` out from `origin`
(top-left), wrapping at a numeric `width` slot via the SAME `layOutLines` the measurer uses,
honouring `style.font`/`fontSize`/`lineHeight`/`color`/`align`. Give it a bounding box —
`extent.ts`'s `objectExtent` gains a `text` case (origin + width + `measuredHeight`) and
`hittest.ts` reads that box — so a `text` object is selectable, its chrome/selection highlight
appear, and dragging it works through `interaction.ts`'s existing per-component `origin` path
unchanged.

## Explicitly not in scope

- **Markdown-lite rendering** (`**bold**`, `*italic*`, `` `code` ``, `# heading`, `- list`,
  paragraph breaks). `resolvedContent`'s markup is drawn VERBATIM — exactly as `render/measure.ts`
  still measures it. The next slice, together with making the measurer markup-aware so drawn ≡
  measured.
- **`overflow: "clip"` / `"ellipsis"`.** Every `text` object draws with `visible` semantics (the
  default, and what Phase 5's "wraps at its set width" needs). Also the next slice.
- **The Phase 5 acceptance criterion / gate.** NOT claimed here (§6.1 trigger 1 would force its own
  review); a later cycle writes the gate test.
- `interaction.ts` — untouched. Text drag falls out of `planOriginDrag` for free (D-121 gave
  `text` `origin.x`/`origin.y` literal slots).
- D-109 clauses 1–2, Q-017 (the render-only alternative).

## What I did

**`src/render/measure.ts`** — exported `layOutLines` and `cssFont` (both were module-private).
`renderer.ts`'s `drawText` now breaks lines and builds its `ctx.font` string through the SAME two
functions the measurement uses, so the text it draws occupies exactly the box `measuredHeight` was
measured from (D-010 — one reading of "how does this text lay out"). Header WHAT THIS IS / NOT DONE
HERE updated. No behaviour change to `measure()`.

**`src/render/renderer.ts`** (§5.6, not §6.2 load-bearing) — `drawText`: reads `resolvedContent`
(draws nothing for unset/non-string/empty), `origin.x`/`origin.y` (`?? 0`, same fallback as
`drawTable`), and a `ResolvedTextStyle` (`resolveTextStyle` — every field defaulted, `align`
clamped to `left`/`center`/`right`). Sets `ctx.font = cssFont(fontSize, family)`, lays out via
`layOutLines` with `ctx.measureText`, wraps only at a positive-finite `width` slot. Alignment: box
width is the numeric `width` or the widest laid-out line; `left` draws at `originX`, `center` at
`originX + boxWidth/2`, `right` at `originX + boxWidth`, via `ctx.textAlign`. Lines drawn at
`originY + i*lineHeight`, `textBaseline: "top"`. `drawObject` and `drawSelectionHighlight` gain a
`text` case (the highlight strokes `objectExtent`'s box — the same one `hittest.ts` clicks). Five
`DEFAULT_TEXT_*` fallback constants (test-fixture-only reach; `createText` always supplies real
values). Header NOT DONE HERE rewritten — `text` moved out of the "draws nothing" list, markdown /
overflow added.

**`src/render/extent.ts`** (render, pure) — `objectExtent` gains a `text` case → `textExtent`:
`undefined` for a `text` object with no resolved content (an empty text box takes no room — matches
`measure.ts`'s zero box); otherwise a box from `origin` + width + height. **width** = the `width`
slot when a positive finite number, else `TEXT_AUTO_BOX_WIDTH` (**PROVISIONAL(Q-024)**). **height**
= the `height` slot when positive finite, else the `measuredHeight` derived slot when positive
finite (the running app threads a real measurer — 0132), else `TEXT_AUTO_BOX_HEIGHT`
(**PROVISIONAL(Q-024)** — reached only under the null measurer, e.g. in a test). Header updated;
imports `TEXT_*_PATH` from `primitives/text.ts`.

**`src/render/hittest.ts`** (render) — `hitTestObject` gains a `text` case → `hitTestBoundingBox`:
an inclusive point-in-box test against `objectExtent(object)` — §5.9's "bounding box for text",
read straight off `extent.ts` so the click box IS the drawn box (D-066/D-010). Imports
`objectExtent` from `./extent.ts` (the DAG edge `extent.ts`'s header already anticipates —
`extent.ts` imports neither `hittest.ts` nor `renderer.ts`). Header NOT DONE HERE updated: `text`
is tested now, `script`/`image` still not.

**Consequence, not new code — a selected `text` object now shows a properties panel.** `main.ts`'s
`panelledObjectIds` shows a panel for any selected object with an `objectExtent`; `text` now has
one, so D-094's read-only panel appears for it, listing its 11 + 2 slots. Falls out of the ruling
as written; no `main.ts` change, no new test needed (the panel machinery is type-agnostic).

**Tests (+23).**
- `renderer.test.ts` — the fake ctx now records every `ctx.font` assignment (a `fonts: string[]`
  in the return, so a test can assert the font `drawText` set before the chrome pass overwrites
  it). New `text` describe: hard-line layout from origin, word-wrap at a numeric width (shares
  `layOutLines`), no-wrap at `"auto"`, centre/right alignment, unknown-align → left, markup drawn
  verbatim, `ctx.font` from style, draws-nothing for unset/non-string/empty `resolvedContent`,
  fallback size for an unusable `style.fontSize`, selection highlight strokes the extent box, and
  one wired-through-`mutate` test drawing a real evaluated `resolvedContent`. Plus a
  polyline/script/image "draws nothing" loop (was value/add only).
- `hittest.test.ts` — removed `"text"` from the "never hits" type loop (text has a definition
  now); new `text` bounding-box describe (inside/outside, inclusive corner, auto-width fallback
  box, no-content never-hits incl. slotless, topmost-wins); `documentExtent` gains a text-box
  bound and a no-content-undefined case.
- `interaction.test.ts` — the `textObject()` fixture in the EvalContext-threading block gained
  `origin.x`/`origin.y` (D-121 — every real `text` object has them) and moved to (500, 500), clear
  of `rectObject(0, 0)`: text is hittable now, so the drag under test must be able to land on the
  rect. Assertions unchanged.
- `measure.test.ts` — direct tests for the newly-exported `layOutLines` / `cssFont`.

## Decisions I made

- **`drawText` measures with the render `ctx` directly; no measurer is threaded into `renderDocument`.**
  The renderer holds a real `CanvasRenderingContext2D` — it can call `measureText` itself. `measuredHeight`
  (engine) still uses the separate offscreen measurer (0132); the two are independent Canvas2D
  `measureText` calls with the same `cssFont` string in the same browser, so their line breaks agree.
- **`extent.ts` trusts the stored `measuredHeight` for box height rather than recomputing.** It has
  no `ctx`. If wrapping in the renderer produces a different line count than `measuredHeight` was
  measured at, `extent.maxY` is off by a line — an edge case, disclosed. Keeping height in ONE
  place (the derived slot) beats a second pure re-derivation that would need its own wrap loop.
- **Auto-width bounding box → fixed fallback, `PROVISIONAL(Q-024)`.** §5.6 declares no
  `measuredWidth` slot and `extent.ts` cannot measure, so an auto-width `text` object's true drawn
  width is not knowable in pure render code. The fallback keeps it hittable/labelled; a line wider
  than the fallback overflows its own click box until Q-024 is ruled. Raised rather than guessed
  silently because §5.9 promises a bounding box for text and this delivers a provisional one; taken
  as a reversible provisional (§7) rather than stopping the cycle because it is render-only, no
  stored state depends on it, and (b)/(c) are escalations a render slice should not make.
- **`style.align` is clamped to `left`/`center`/`right`.** §5.6 lists `align` without enumerating
  it; these are the three a `ctx.textAlign` supports meaningfully here. Anything else → `left`.
- **Markup drawn verbatim.** `measure.ts` still measures `**bold**` etc. verbatim (its own
  disclosed known problem), so drawing it verbatim keeps drawn ≡ measured. The markdown slice will
  move both at once.

## Verification (real output)

```
$ npx tsc --noEmit
(clean, no output)

$ npx tsc --noEmit -p tsconfig.engine.json
(clean, no output)

$ npx vitest run
 Test Files  30 passed (30)
      Tests  1466 passed (1466)
   Duration  1.68s
```

0 skipped, 0 `.only`. 1443 → 1466 (+23). No test weakened: `hittest.test.ts`'s "never hits" loop
dropped `text` because `text` gained a real visual definition (the slotless-text no-hit case is
still pinned, in its own test); `interaction.test.ts`'s fixture change moved a co-resident object
out of the drag target's way and left every assertion intact.

## Acceptance criteria status

Phase 5 criterion ("a text box reading `Radius: {= table_x.A1 }{? table_x.A1 > 50 } —
**LARGE**{:} — small{?}` updates … wraps at its set width … re-renders when a value referenced
only inside the currently non-taken branch changes") — **NOT YET, but close.** Reactivity is all
engine-side and done (`resolvedContent` + total dependency extraction). Text now DRAWS and wraps at
a numeric width, so "wraps at its set width" is observable. Remaining before the gate: markdown-lite
rendering (so `**LARGE**` renders as intended — though the gate tests the branch *swap*, not the
bold), and the gate test itself over one document. The gate is its own cycle (§6.1 trigger 1).

## Where I got stuck / what is unfinished

Nothing stuck. Unfinished, deliberately: markdown-lite, `overflow` clip/ellipsis, and the gate.
Known soft spot: `extent.ts`'s box height can lag the drawn line count by one line if the
renderer's wrap and the offscreen measurer's wrap ever diverge (same font, same browser — they
should not, but it is not enforced). And the auto-width fallback box (Q-024) — a wide auto-width
label draws outside its own click region.

## Open questions raised

**Q-024** — how is a `text` object's bounding box width computed when `width: "auto"`, given no
`measuredWidth` slot and a pure `extent.ts`? Provisional choice (a): a fixed fallback box.
Tagged at: `src/render/extent.ts` (`textExtent`, `TEXT_AUTO_BOX_WIDTH`/`TEXT_AUTO_BOX_HEIGHT`).

## Review point

Fired: **§6.1 trigger 5** — `hittest.test.ts`'s "never hits" type loop dropped `text`, and
`interaction.test.ts`'s `textObject()` fixture changed (both because `text` became hittable; no
assertion weakened). Also **§6.1 trigger 3** — the brief is silent on the auto-width bounding box
(**Q-024**), taken as a reversible tagged provisional rather than a cycle stop (§7). Text
rendering is also new visual territory (no new *file*, so not strictly trigger 2, but the reviewer
should audit it as a fresh subsystem).

Batch: cycle 1/3, diff ~330 source lines / 4 source files (cap 800/10).

REVIEW: REQUIRED
Reason: §6.1 trigger 5 (changed test expectations) + trigger 3 (Q-024, brief silent on the
auto-width text box); first on-canvas text rendering, and the last substantive step before the
Phase 5 gate can be claimed.
Questions for reviewer:
  1. **Q-024** — is the fixed-fallback auto-width box (provisional (a)) acceptable for v1, or
     should `TEXT_SCHEMA` grow a `measuredWidth` derived slot (b) before Phase 5 closes? (b) is
     the escalation this slice declined to make.
  2. `extent.ts` trusts the stored `measuredHeight` for box height while `renderer.ts` re-wraps
     with its own `ctx` — a one-line divergence is possible in principle. Acceptable, or should
     the renderer draw exactly `measuredHeight / lineHeight` lines instead of what it wrapped?
  3. A selected `text` object now shows a D-094 properties panel (falls out of `objectExtent`
     gaining a `text` case). Intended, or should `text` be excluded until a later cycle?
  4. `measure.ts` now exports `layOutLines` / `cssFont` for `renderer.ts` to share. OK, or would
     you rather a dedicated `render/text-layout.ts` leaf module?
