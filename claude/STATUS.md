# STATUS — as of entry 0165

**PHASE 6 IS OPEN AND HALF OF IT IS BLOCKED. §5.7's `image` is BUILT (headless). §5.8's `script`
CANNOT BE STARTED until Q-026 is ruled — read Q-026 before anything else.**

STATE: **GREEN**. Both configs compile, **1789/1789** tests pass, 0 skipped, 0 `.only`.
**34 test files.** `npx vite build` clean.

Current phase: 6 — script stub + image
Phase 6 acceptance criterion: *"`script_1.in.factor` is bound to a cell, `polygon_1.radius` is bound
to `script_1.out.result`, and changing the placeholder output value moves the polygon — with no
script-specific code in `eval.ts`"* — **NOT STARTED, BLOCKED on Q-026.**
Last review point: **0164-REVIEW-phase5-gate** (ACCEPT WITH EDITS)
Cycles since last review: **1/3** · diff since last review: **~320 lines / 9 files** (cap 800/10)

**REVIEW IS REQUIRED BEFORE THE NEXT SLICE.** Entry 0165 fired §6.1 trigger 3 twice (one brief
deviation, one load-bearing ambiguity) and trigger 5 once. It also touched `primitives/schema.ts`,
which §6.2 puts on the load-bearing list.

---

## THE ONE THING TO READ FIRST — Q-026 BLOCKS THE SCRIPT NODE

§5.8 makes `script.in.*` and `script.out.*` per-OBJECT slot families whose members are named by the
operator. **This codebase has nowhere to store that list of names**, and the gap is structural, not
an oversight of any past cycle:

- **Not a slot value.** §5.1's `Value` union is `number | string | boolean | Point | Point[] | null |
  ErrorValue`. No list-of-strings arm. So no `literal` slot can hold `["factor", "speed"]` the way
  `table`'s `rows` holds `8`.
- **Not the slot keys.** `graph/node.ts`'s header and `mutation.ts`'s both state D-010's consequence:
  "There is no sanctioned inverse — never `key.split('.')`". A `dynamic` `enumerate(object)` may not
  scan `Object.keys(object.slots)` for `in.*`.
- **Not a count plus positions.** The criterion names `script_1.in.factor`. The NAME is operator data.

And a second gap the same ruling must close: **`ObjectSchema.derivedSlots` is a fixed list per TYPE**,
read at **seven** non-test sites (`mutation.ts` ×3, `document.ts` ×2, `graph/eval.ts`,
`command/commands.ts`, `command/props.ts`), while `out.*` is per OBJECT. D-018 requires a
`derived`-kind slot at every declared derived path, so today a per-object `out.*` cannot be expressed
in either direction.

**Q-026 lays out four options and recommends (a)** — a structural field on `GraphObject` (D-046's own
scope note already left that door open: *"A future `GraphObject`-structural home would preserve Rule 6
by construction and remains open"*), with `derivedSlots` widened to the same `static`/`dynamic` group
shape `nonDerivedSlotPaths` has carried since 0041-REVIEW. **No provisional choice was taken and no
`PROVISIONAL(Q-026)` tag exists** — §7 clause 3 forbids one, because the answer shapes the data model
and the mutation sequence.

## What the last cycle did

**0165** built §5.7's `image` primitive through the engine and command layers, headless, and raised
Q-026. New file `src/engine/primitives/image.ts` (paths only, no compute function). `IMAGE_SCHEMA` in
`primitives/schema.ts`: one `static` group of six non-derived paths, `derivedSlots: []`.
`CreateImageCommand` + registry entry + D-072 one-point prompt sequence in `parser.ts`; `createImage`
+ `DEFAULT_IMAGE_*` in `commands.ts`. `image` left `COMMANDS_SPECIFIED_BUT_NOT_BUILT` in the same
cycle, as that list requires. Five test files updated. **No render file changed** — see below.

---

## Read this first — what a cold reader needs

**0img. AN `image` OBJECT HAS SIX SLOTS AND DRAWS NOTHING.** `origin.x`/`origin.y` (imported from
`primitives/geometry.ts`, NOT re-declared — the same identity D-121 gave `text`, which is what makes
the per-component origin drag reach an image with no image-specific code), `width`, `height`,
`opacity`, `source`. **No derived slots at all.**
- **`source` IS A SIXTH SLOT §5.7's OWN LIST DOES NOT NAME.** §5.7 enumerates five and then says the
  data URL is "stored in the document"; a `GraphObject` is `{ id, name, type, slots }`, so that can
  only mean a slot, and `Value` admits `string`. Disclosed deviation, entry 0165 decision 1, awaiting
  the reviewer.
- **`source` is NOT `literal`-only.** D-122 narrowed `text.content` because a formula-driven
  `content` hides embedded references from edge derivation. Nothing parses a data URL, so no guard
  is needed and none was added. Do not "fix" this into a D-122 clone.
- **`opacity` is DELIBERATELY UNBOUNDED** as document state. D-070 bounds COUNTS (they size slot
  sets); `opacity` sizes nothing, so the renderer clamps what it paints — `style.align`'s posture.
  **There is a test asserting `set image_1.opacity 4` COMMITS.** It is not a missing check.
- **`image x=0 y=0` takes §5.10's two arguments and NO OTHERS.** No `w=`/`h=` — §8's last bullet
  forbids the gold-plating, and `set image_1.width 200` reaches them. A stray `w=` is a parse
  failure, pinned.
- **`DEFAULT_IMAGE_WIDTH`/`_HEIGHT` are `100`, not `"auto"`.** `text`'s `"auto"` works because a
  measurer answers it; §5.7's equivalent is the decoded bitmap's NATURAL size, which no engine slot
  can see. The file-picker cycle is free to write the natural size over these.
- **A CREATED IMAGE IS INVISIBLE AND UNSELECTABLE.** `extent.ts`, `hittest.ts` and `renderer.ts` all
  still return "draws nothing" for `image`, untouched this cycle. **Do not give `image` an extent
  before the renderer draws it** — D-066 makes drawn extent and clickable extent ONE extent.

**0. `TEXT_SCHEMA` HAS ELEVEN NON-DERIVED + THREE DERIVED SLOTS.** Non-derived: `origin.x`/`origin.y`
(D-121) + `content` + `width`/`height`/**`autoresize`** + five `style.*`. **NO `overflow`** — the slot
was REMOVED at 0154 on the human's instruction; `autoresize` took its place in the count. Derived:
`resolvedContent` (dynamic deps), `measuredHeight` and `measuredWidth` (static deps, **the SAME
list** — one measurement answers both). `primitives/text.ts` owns NINE of the eleven paths; the two
`origin.*` come from `geometry.ts`.

**0a. `autoresize` IS NOT A DEPENDENCY OF EITHER MEASURED SLOT, AND THAT IS THE POINT.** It sizes the
BOX, not the TEXT. Two consequences, both wanted: toggling it never re-measures, and **a document
saved before it existed still loads**. D-126's trap avoided by construction. There is a test.
**0157-REVIEW flagged this as a call a future cycle must not "fix".**

**0s. THE LOADER IS HARDENED (0156, REVIEWED 0157). TWO FACTS A COLD READER NEEDS.**
- **A loaded formula AST's SHAPE is validated ONCE, at the boundary** —
  `formula/ast.ts`'s `validateFormulaAstShape`, called from `document.ts`'s `reconstructSlot`
  BEFORE the depth check. **D-108 clause 3 still forbids hardening any individual walker** —
  `exceedsMaxFormulaAstDepth`, `collectIllegalAstLiterals`, `deps.ts`, `eval.ts` all stay guard-free,
  and this boundary is what makes that safe.
- **The SCHEMA says which derived slots an object has, never the file** (`withSchemaDerivedSlots`,
  D-126). **Adding a derived slot is no longer a load-compatibility event.**

### The text pipeline, end to end (READ THIS BEFORE TOUCHING ANY OF IT)

**0t. FOUR FILES, ONE DIRECTION, NO CYCLES.**
`markdown.ts` (parse) → `measure.ts` (lay out + measure) → `renderer.ts` (paint) / `editor.ts` +
`main.ts` (the overlay). `markdown.ts` imports NOTHING. `measure.ts` imports `markdown.ts` and the
engine's interface only.

**0u. `render/markdown.ts` OWNS §5.6's MARKDOWN-LITE LIST AND NOTHING ELSE INTERPRETS IT.**
`parseMarkdownLite(text)` → one `MarkdownLine` per hard line (`paragraph`/`heading`/`list`, `level`
1–3), each holding `MarkdownRun`s: **the text with its markers REMOVED** plus `bold`/`italic`/`code`.
`verbatimLines(text)` is the same hard lines with no markup honoured. Both live here so **"what a
hard line is" (`/\r?\n/`) has ONE answer** and a box's line COUNT never depends on whether markup
was read.
- It is in `render/`, not `engine/`, because markup only decides which FONT a stretch is drawn and
  measured in — glyph work, which Rule 1 and D-120 put behind the measurer. The engine still holds
  `content` as "raw source including markup" (§5.6) and never parses it.
- **Consequence, intended:** markup a `{= }` resolved INTO is markup, and D-116/D-117's `!`-marked
  broken span is parsed like any other text — a `*` in a broken formula can open an italic run.
- **An emphasis marker is subject to CommonMark's FLANKING rule, reduced**: it opens only when
  followed by a non-space and closes only when preceded by one. **This is not decoration — without
  it, `2 * 3 and **bold` silently italicises its own middle.** A defect 0159 shipped and 0160's
  renderer test caught. Code spans are deliberately exempt.
- **A `#### ` is NOT a heading** (§5.6 says levels 1–3), a prefix is read **at position 0 only**
  (no indentation — §5.6 forbids nested lists), and there is **no escaping** (`\*` is a backslash
  next to a marker).
- **A WRAPPED list item hangs its continuations under its TEXT** (0161). The indent is the measured
  width of `LIST_BULLET` in the bullet's own font, computed in `measure.ts` because only that file
  can measure it — `markdown.ts` just names the bullet.

**0v. `render/measure.ts` HAS ONE LAYOUT FUNCTION AND TWO MEASURERS.** `layOutText(request)` →
`TextLayout` (`lines`, each with `top`/`width`/`height` and positioned `LaidOutRun`s carrying the
exact `ctx.font` they draw in). **`layOutLines` IS GONE.**
- `request.markup` is the ONLY difference between the two readings. Everything after the parse —
  chunking, the greedy fill, hanging spaces, code-point splitting — is shared, so there is still
  exactly one implementation of the wrap rules (D-010).
- **`createCanvas2dTextMeasurer` = markup-aware = the ENGINE's** (`main.ts`'s `EvalContext`), so
  `measuredWidth`/`measuredHeight` measure the RENDERED text. That is what keeps D-123 clause 5 true.
- **`createSourceTextMeasurer` = verbatim = the OVERLAY's** (Q-025 (a), answered on screen 2026-09-03).
- **A line's measured width is the SUM OF THE SAME RUN MEASUREMENTS the renderer positions those
  runs by**, so a line can never be measured wider or narrower than it draws. Adjacent same-font
  pieces are merged and measured as ONE string — which for a plain line is one `measureText` call on
  the whole line, bit-for-bit what the file did before markdown, and why all 29 pre-existing measure
  tests pass untouched.
- **A word may span two runs (`**bo**ld`) and is NOT broken there** — chunks accumulate across runs.
- **THE HANGING INDENT IS APPLIED WHERE THE LINE IS FITTED, NOT WHERE IT IS DRAWN.** `wrapLine`
  narrows every line after the first by it. Wrapping to the full width and indenting afterwards
  pushes the last word of each continuation out through the side of the box — the exact defect
  0154's `break-word` removed. It is folded into each run's `x` and into the line's `width`, so
  `measuredWidth` covers it and `renderer.ts` needed NO change. There is a test that fails if a
  later cycle moves it back to the renderer.
- **Heading scale is CSS 2.1's sample stylesheet** — `2em`/`1.5em`/`1.17em`, bold — adopted under
  D-138 clause 4 (a *specified* rule, named at its site) rather than tuned. The LINE HEIGHT scales
  by the same factor. `` `code` `` is the generic `monospace`.

**0w. `renderer.ts`'s `drawText` CHOOSES NO FONT.** It sets `ctx.font` to the string each laid-out
run already carries and calls `fillText`. **`ctx.textAlign` IS NOW ALWAYS `left`** and §5.6's
alignment is arithmetic (`alignmentOffset`, against `textbox.ts`'s box width) — a line made of two
fonts has no single anchor a canvas alignment could measure from.

**0g. LINE-BREAKING LIVES IN `render/measure.ts` (D-120), NEVER IN `src/engine/`. IT IMPLEMENTS
CSS'S RULES ON PURPOSE (0154, reviewed 0157):** `white-space: pre-wrap` + `overflow-wrap:
break-word`, because that is what the editor's `<textarea>` uses and the two must not drift. Spaces
are PRESERVED; trailing spaces HANG; a word too wide for its own line is split between CODE POINTS
after first moving to a line of its own.

**0b. `render/textbox.ts` OWNS THE BOX-SIZING RULE. THREE READERS, NO SECOND COPY.**
`extent.ts` (the committed box), `renderer.ts` (the alignment box), `editor.ts`/`main.ts` (the LIVE
box while typing). No set size → the measurement; set size and the text is BIGGER → the measurement
(**a text box never crops**); set size and the text is SMALLER → `autoresize` decides. **WIDTH IS
ASYMMETRIC ON PURPOSE:** a numeric `width` is also the WRAP width, so it is a FLOOR never a ceiling.

**0c. THE TWO MEASURED SLOTS ARE ONE MEASUREMENT (D-123 clause 2).** `measureTextBox`
(`primitives/text.ts`, private) owns the read set, the failure ladder and the single `measure` call.
Failure order: upstream `ErrorValue` → `#MEASURE` (no real measurer, D-118) → `#TYPE` (unusable
style) → `#TYPE` (non-finite width OR height) → the box.

**0d. A HAND-BUILT `text` FIXTURE PUSHED THROUGH `mutate` NEEDS ALL THREE DERIVED PLACEHOLDERS.**
D-018 refuses a missing `measuredWidth: { kind: "derived", value: null }`. `autoresize` may be
omitted (it reads as `true`). **A hand-built `image` fixture needs NO derived placeholder** — that
schema declares none.

**0e. `DEFAULT_TEXT_*` (`command/commands.ts`)** — `width`/`height` `"auto"`, **`autoresize` `true`**,
font `"sans-serif"`, fontSize `16`, lineHeight `20`, color `"black"`, align `"left"`.
**`DEFAULT_IMAGE_*` (same file)** — width `100`, height `100`, opacity `1`, source `""`.

**0f. THE MEASURER IS BUILT, WIRED, AND REVIEWED (0133).** `main.ts:start` builds `evalContext` over
a SECOND offscreen 2D context and threads it through `executeCommand` / `pointerMove` /
`loadDocument`. **As of 0160 it builds a THIRD measurer object over that same context**
(`sourceMeasurer`), used ONLY by the in-place editor's live box.

**0h. `content` IS `literal`-ONLY (D-122).** The guard is `isTextContentTarget` in
`command/commands.ts`'s `buildSlot`. **`image`'s `source` is NOT** — see 0img.

**0i. THE IN-PLACE EDITOR, AS OF 0153 (0160 changed only what it is MEASURED by).**
`render/editor.ts` is pure geometry: `editorTargetAt` picks the receiver via `hitTest`;
`editorPlacement` returns `left`/`top` in **CSS pixels**, `width`/`height` in **WORLD units**, and a
`scale` `main.ts` applies as one `transform: scale(...)`. **That split is what makes the browser
break lines where the canvas does — do not pre-multiply them again.** `editorTextBoxSize` is the
LIVE box from `textbox.ts`'s rule; `CARET_ALLOWANCE` (2 units) is added only for a NON-wrapping box.

`main.ts`'s pure half: `commitTextContent` (ALWAYS a literal `set`), `commitTableCell`, `editorSeed`,
`abandonCreatedTextBox` (D-136 clause 2), `commitPanelChoice`. All go through `runPanelCommand` →
`executeCommand` — NO second write path (Rule 2, re-verified at 0157).

**0j. `render/handles.ts` — the eight resize grabbers.** `hasResizeHandles` is `text`-ONLY.
`resizeHandleAt` is a SCREEN-space test, so a grabber is one size at every zoom.

**0k. A RESIZE IS ABSOLUTE, NOT INCREMENTAL.** Each step recomputes from `ResizeState.startExtent`
plus the total delta. **A HEIGHT drag also writes `autoresize: false`.** 0157-REVIEW recorded this
as a call not to "fix".

**0l. `InteractionState` HAS THREE FIELDS: `selectedObjectIds`, `drag`, `resize`.**

**0n. `mutation.ts` HAS SEVEN OPERATION KINDS — `clearSlot` JOINED AT 0155.** It REMOVES the slot at
an address (D-047 makes an ABSENT cell slot the empty cell). **Legal ONLY at a table cell.**

**0o. `clear <address>` IS A COMMAND, AND IS NOT IN §5.10.** Added at 0155 under the human's standing
leave. **An already-empty cell SUCCEEDS and mutates nothing.**

**0p. `editorSeed` USES THE AUTHORING FORM, NEVER `describeSlotValue`.** `cellLiteralSeed` is the
deliberate INVERSE of `buildCellCommand`, and **the two must be changed together**.

**0q. `renderDocument` TAKES THE WHOLE `EditorTarget`, NOT AN OBJECT ID.** A `text` receiver is
skipped WHOLE; a `table` keeps everything but the ONE edited cell's value.

**0r. A TABLE'S A1 HEADERS ARE NEVER SUPPRESSED** (`drawTableHeaders`, 0155). Letters come from
`address.ts`'s `indexToColumnLetters` — the SAME function `formatCellReference` uses (D-010).

**0m. A SLOT WITH A CLOSED VALUE SET IS DECLARED ON THE SCHEMA** (`ObjectSchema.slotOptions`) —
`text`'s `style.align` and `autoresize` are the only two today. The option's DOM value is its
**INDEX**. **Only a `literal` row gets a drop-down**; a boolean echoes as `TRUE`/`FALSE`.

**1. PHASE 4'S GATE TEST IS `main.test.ts`'s `describe` "PHASE 4'S ACCEPTANCE CRITERION" (7 tests).**
Do not weaken; do not fold. **PHASE 5'S is `main.test.ts`'s Phase 5 gate `describe` (6 `it`s over one
`gateDocument()`, entry 0163).** Same standing.

**2. D-110's DISCLOSED CONSEQUENCE — `refs` HAS TWO FORMS (D-112).** Neither may be "fixed".

**3. THE PANEL IS BUILT AND REVIEWED — DO NOT RE-BUILD IT.** D-094/D-100/D-101/D-106/D-102/D-107.

**4. `main.ts`'s DOM half (`start`) IS UNTESTED BY CONSTRUCTION (D-001) AND KEEPS GROWING.** Every
DECISION behind it is in an exported pure function that is tested.

**6. D-104 IS OWED BY A CYCLE THAT HAS NOT BEEN SCHEDULED.** `insertTableLine`/`deleteTableLine` not
bounded by `MIN`/`MAX_TABLE_LINES`. Not command-reachable. Fix in `findInvalidTableResizes`.

**8. THE TEXT BLOCK TREE IS DERIVED STATE, RE-PARSED FROM `content` ON DEMAND, NEVER CACHED (D-114
clause 4).** A broken span becomes an `error`-kind `Block` (D-115); its parsed branches live in
`orphaned`. **This is a DIFFERENT parse from `markdown.ts`'s and they must not be merged** — one
resolves values, the other chooses fonts.

**9. `evaluateDerivedSlot`'s `read` RUNS THE D-110 COERCION BEFORE THE D-013 MEMBERSHIP CHECK
(D-114 clause 3).** Do not swap them.

**10. `resolveTextDependencyAddresses` and `deriveEdges` Source 1 are a hand-maintained PAIR with no
compiler link (D-119).** Change one → change both, same cycle, log names both.

**11. A broken embedded span is marked `!` in place (D-116 parse / D-117 runtime), never blanks the
box; `evaluateBlockTree` always returns a `string`.**

**12. `EvalContext` IS THREADED PER CALL, NOT STORED (0132, reviewed 0133).**

**13. `TEXT_TYPE` (`graph/node.ts`) joins `TABLE_TYPE`.** Import it, never a bare `"text"` literal in
an equality check (D-009). **`image` needed no such constant** — nothing compares an object's type to
`"image"` outside the render switches that already existed.

**14. D-137: A FILE'S HEADER IS PART OF THE DIFF THAT CHANGES ITS BEHAVIOUR.** `NOT DONE HERE` is
the likeliest to be wrong — it goes stale by the file getting BETTER. **NEVER insert a declaration
between a doc comment and what it documents.** 0165 obeyed it at `schema.ts` (two places),
`parser.ts` (two) and `commands.ts` (three, two of which were stale COUNTS — "all four handlers",
"the four types below").

## Next slice (recommended)

**STOP AND GET 0165 REVIEWED FIRST.** After that, in order:

1. **Q-026's ruling, then §5.8's script node.** This is the phase's whole acceptance criterion and
   nothing else in Phase 6 unblocks it. Expect the ruling to touch `graph/node.ts`,
   `primitives/schema.ts`, `mutation.ts` and `document.ts` — every one of them on §6.2's load-bearing
   list, so plan it as its own reviewed batch, not as a tail on something else.
2. **`image` rendering + §5.7's file picker**, needs no ruling and can proceed in parallel: a
   `renderer.ts` arm, an `extent.ts` arm and a `hittest.ts` arm (all three TOGETHER — D-066 makes
   drawn extent and clickable extent one extent, so shipping the extent without the drawing is
   forbidden), a decoded-`HTMLImageElement` cache with a repaint on load, and a `CommandEffect` for
   the picker. **The cache and the async repaint are the real design question there** — where live
   render state lives and what re-triggers a paint — and it deserves its own scope statement.

Cheap adds, still owed, not blocking: a direct `link text_1.origin.y <cell>` test (0137-REVIEW
§honesty). **D-109 clauses 1–2** (cell decimal precision + no cell-text clipping,
`render/renderer.ts` only) still need no ruling. **Q-017** headers remain the human's.

**Read D-016 before writing Phase 6's gate entry.** 0163 omitted its mutation check; 0164-REVIEW paid
it instead and said plainly this will not be extended a second time. Any `REVIEW: REQUIRED`
phase-gate entry from here on carries its own neutralise/re-run/red-test table beside the claim, or
it comes back `REVISE`. (0165 carries one voluntarily, for a cycle that claims no criterion at all.)

## Built and reviewed

Phase 0 (0027-REVIEW) · formula engine (0037) · table primitive through row/column insert/delete and
`delete <table> force` (0054) · `render/camera.ts` (0058) · `primitives/geometry.ts` (0060) ·
`render/renderer.ts`'s body/table drawing (0062, widened by 0093/0094/0107) · `render/hittest.ts`
(0064) · `render/interaction.ts` (0067) · `command/parser.ts` (0069) · `command/prompt.ts` (0071) ·
`command/commands.ts`'s seam + four creation handlers (0078) · four slot commands +
`engine/formula/format.ts` (0080) · `commands.ts`'s `delete`/`refs`/`list` (0082) · `mutation.ts`'s
`RenameObjectOperation` + `commands.ts`'s `rename` (0084) · `CommandEffect` + five effect handlers
(0086) · two formula depth limits (0088) · `main.ts` rewritten, `render/camera.ts`'s clamps,
`render/extent.ts`, `index.html` (0089, reviewed 0090/0091, widened 0107/0109/0117) · entry 0093's
selection highlight / error badge / formula-driven indicator + D-092 clause 1's name label, 0094's
chrome-anchor fix (0095) · `render/slots.ts` + `render/extent.ts` split, `command/props.ts` + `props`
command (0098, D-096) · `render/panel.ts` + panel DOM (0100) · selection-list widening (0105, D-105)
· N panels, drag, dismiss, panel editing (0110-REVIEW) · F1–F4 + D-107, D-081 + D-083 clause 4
(0113-REVIEW) · Phase 4 gate test (0116-REVIEW) · D-109 clause 3 + D-110 in full (0119-REVIEW; D-112,
D-113) · `primitives/text.ts` block-tree engine (0121-REVIEW; D-114, D-115, Q-019) · D-116 + D-117 ·
`src/engine/eval-context.ts` + `context` threading (0125-REVIEW; D-118) · `!`-marked broken-span
rendering + `text` schema entry, `resolvedContent` (0128-REVIEW; D-119) · `measuredHeight` +
`#MEASURE` + `TextMeasurer.measure`'s `maxWidth` + `hasRealMeasurer` (0130-REVIEW; D-120) ·
`render/measure.ts` + a real `EvalContext` threaded from `main.ts` (0133-REVIEW; F22) · **0135-REVIEW**
D-121 + D-122 · **0137-REVIEW** the `text` command; Q-022/Q-023 CLOSED · **0139-REVIEW** text
rendering; D-123, Q-024 answered · **0142-REVIEW** `measuredWidth`; Q-024 CLOSED; D-126 + D-127 ·
**0144-REVIEW** the in-place editor (D-125); D-128 · **0145-RULINGS** D-129 + D-130 + D-131 ·
**0148-REVIEW** editor-polish; D-132 + D-133 · **0150-REVIEW** `text`-by-pointing (D-124); D-134 ·
**0151-RULINGS** D-135 + D-136 · **0157-REVIEW** the whole 0152–0156 batch; **D-137** ·
**0158-RULINGS** D-138 (the wrap residual, accepted); Q-025 raised · `src/render/markdown.ts` (0159)
· the wiring — `layOutText` replacing `layOutLines`, `renderer.ts`'s `drawText` painting runs and
aligning by arithmetic, `main.ts`'s `sourceMeasurer` (0160) · hanging indents for wrapped list items
(0161) · **0162-REVIEW** the 0159–0161 batch; **D-139** (Q-025 closed) · Phase 5 gate test (0163) ·
**0164-REVIEW** the Phase 5 gate — CLOSED, ACCEPT WITH EDITS.

**PHASES 0–5 ARE DONE.** Do not reopen the text pipeline to "add more" to it — anything new belongs
to a fresh slice with its own scope statement.

## Built this batch, not yet reviewed

- **§5.7's `image` primitive, engine + command layers, headless** (entry 0165):
  `src/engine/primitives/image.ts` (NEW), `IMAGE_SCHEMA`, `CreateImageCommand` + registry entry +
  prompt sequence, `createImage` + `DEFAULT_IMAGE_*`, and tests across five files.
- **Q-026 raised** (no code, no tag).

## Reviewed but NOT yet seen on screen

Nothing — and nothing this batch is SEEABLE either: `image` draws no pixels yet, by design. Entry
0161's hanging indent, the last visual item, was confirmed on screen 2026-09-03.

## Not started

§5.8's script node (BLOCKED — Q-026) · `image` rendering, hit-testing and the §5.7 file picker ·
D-090's prompt-sequence preview · §5.9's per-vertex drag path ·
`polyline`/`explode`/`addvertex`/`delvertex` · `style` slots as authorable · point-in-polygon fill
hit-testing (D-067) · §5.4's formula bar · D-088 clauses 2–4 · D-089 · D-102 clause 9 ·
**D-109 clauses 1–2** · Phase 7.

## Open fix list — read 0090-REVIEW §9, 0091-REVIEW §5 and 0100-REVIEW §9 for the full text

Numbering follows 0090-REVIEW §9. Items 2–13, 16–21, 23–24 unchanged and open unless noted.

1. **DONE at entry 0112**, reviewed 0113.
2. **Give the missing-slot refusal a remedy.** Message only; narrowed by D-110 to clause 6's cases.
3. **`findDanglingReferences` names one dependent once per MISSING SOURCE.**
4. **`zoom`'s refusal names `Infinity`.** Message only.
5. **Carried from 0074-REVIEW §9, all six unchanged.**
6. **A middle-drag pan started outside the canvas is untested.** Owned by D-088's cycle.
7. **`TABLE_GRID_STROKE_STYLE` has no comment** (D-091). Owned by the `style`-slots cycle.
8. **The screen-space chrome constants are untuned** (Rule 5). `handles.ts`'s
   `RESIZE_HANDLE_SIZE_SCREEN` / `_TOLERANCE_SCREEN` / `MIN_TEXT_BOX_SIZE`, `editor.ts`'s
   `CARET_ALLOWANCE`, and `renderer.ts`'s `TABLE_HEADER_*` all join this list. **`measure.ts`'s
   heading scale does NOT** — it is CSS's own, not a tuned number (D-138 clause 4). **0165's
   `DEFAULT_IMAGE_WIDTH`/`_HEIGHT` (100) ARE untuned picks and DO join it.**
9. **The chrome pass leaves `ctx.font`/`textAlign`/`textBaseline` set on return.** Harmless —
   `drawObjectChrome` sets all three explicitly. **`drawText` now also leaves `ctx.font` on the last
   run it drew**, which is the same harmless shape.
10. **The formula-driven indicator's narrowness (`origin.x`/`origin.y` only) should be RE-DECIDED.**
11. **A display-only panel's `overflow: auto` scroll resets on every paint.**
12. **A right-flipped panel that hits the right clamp overlaps its own object.** Correct per D-094.
13. **`insertTableLine`/`deleteTableLine` are not bounded by `MIN`/`MAX_TABLE_LINES`** — **D-104**.
14. **0110-REVIEW's F1–F4 — BUILT (0111), REVIEWED (0113).** Closed. **Q-016** carries F3's tail.
15. **F5 — CLOSED at 0156, reviewed 0157.**
16. **F6 — a panel row's text can no longer be mouse-selected.** D-095 governs.
17. **F7/F8 — ruled D-109. F8 BUILT (0117), REVIEWED (0119); F7 (clauses 1–2) NOT BUILT.**
18. **F9 — CLOSED in the same review.**
19. **F10 — CLOSED, ruled D-112.**
20. **F11 — open, no owner.** Shrinking a table's extent under a formula reading an empty in-extent
    cell is REFUSED. Correct per D-110 clause 6.
21. **F12 — open, DO NOT RE-LITIGATE.** `MIN(B1, B2)` vs `MIN(B1:B2)` on empty in-extent cells.
22. **F13 — RULED D-122, BUILT (0136), REVIEWED (0137). CLOSED.**
23. **F21 — CLOSED**, WIDENED at 0141 (D-123 clause 2).
24. **F22 — CLOSED in the same review.**
25. **F23 — CLOSED at 0156, reviewed 0157.**
26. **F24 — CLOSED at 0156, reviewed 0157.** **D-127's lesson stands: a ruling deferred work to a
    trigger that had already fired 24 entries earlier.**
27. **F25 — RULED D-129, BUILT (0146/0147), REVIEWED (0148) → D-132. CLOSED.**
28. **F26 — RULED D-130, FIXED (0147), REVIEWED (0148) → D-133. CLOSED**, confirmed on screen.
29. **F27 — RULED D-131, BUILT (0146), REVIEWED (0148). CLOSED.**
30. **F28 — RULED D-135, BUILT (0152). CLOSED, and SUPERSEDED at 0153.**
31. **F29 — RULED D-136, BUILT (0152). CLOSED and CONFIRMED ON SCREEN 2026-09-02.**

## Known problems (detail lives where the pointer says)

- **AN `image` OBJECT IS INVISIBLE AND UNSELECTABLE.** Six correct slots, round-trips, renameable,
  `props`-able, `link`-able, `delete`-able — and it draws nothing. Deliberate and disclosed (0165);
  the render arm, the extent and the picker are one cycle, not three footnotes. **Do not add the
  extent alone** (D-066).
- **A TEXT BOX THAT USES MARKUP CHANGES SIZE WHEN THE EDITOR CLOSES** — the overlay is measured
  from raw source, the canvas from the rendered text. A box with NO markup is unaffected. **The
  human answered this on screen (Q-025 (a), 2026-09-03): the shrink-on-open is WANTED — "ideal and
  works well as implemented"** (D-139). A PROPERTY, not a problem. Do not try to remove it.
- **A CENTRED OR RIGHT-ALIGNED LIST ITEM'S CONTINUATION IS ALIGNED *INCLUDING* ITS INDENT.** The
  hanging indent (0161) lives inside the line's own width, which is what makes `measuredWidth`
  cover it. Consistent and harmless; §5.6 does not say what a centred list should look like.
- **A CODE SPAN CAN SWALLOW AN EMPHASIS CLOSER** (`` *a `b* ` c* ``), leaving the rest of that ONE
  line italic. Bounded to a line; not chased.
- **THE X-vs-X+1 WRAP RESIDUAL IS CLOSED AS "ACCEPTED" — D-138. DO NOT TRY TO FIX IT.** No epsilon,
  no fudge factor, no rounding step in `layOutText`/`measure`, no `letter-spacing`/`word-spacing`/
  `font-kerning` on `.text-editor`, no per-platform branch. **Adopting a further *specified* CSS rule
  is the one legitimate move** — 0154's CSS wrap rules, 0160's flanking rule and heading scale are
  the three precedents — and it must name the rule at the site. Reopen only on D-138 clause 5.
- **OBJECT NAME LABELS AND TABLE ROW/COLUMN HEADERS READ SMALL BESIDE RENDERED MARKDOWN.** The
  human saw this on 2026-09-03 and **decided against changing it** — *"I wouldn't change that for
  now. Keep as is."* A DECIDED NON-CHANGE, not an open defect: do not "fix" it.
- **THE A1 HEADERS ARE GREY (`#6b7280`), NOT THE TITLE'S NEAR-BLACK.** One constant to revert.
- **THE HEADERS ARE NOT CLICKABLE.** Deliberately not invented.
- **A string cell holding `"42"` seeds `42` and commits back as the NUMBER 42.** Excel's own
  behaviour under D-125 clause 3.
- **A panel with a focused `<select>` stops updating its other rows** until it is blurred.
- **A freshly-created `text` object opens its editor UNSELECTED** (D-136 clause 4 leaves it).
- **`text 30,40` (unquoted, comma) places a box at (30,40) with empty content** (entry 0149).
  **`image 30,40` does the same for an image** — the identical point-shorthand path.
- **THE EDITOR SHOWS RAW SOURCE; THE CANVAS DRAWS `resolvedContent`, NOW WITH MARKUP RENDERED.**
  Two deliberate differences, not one.
- **The cell editor does not reproduce `TABLE_CELL_TEXT_PADDING`'s 4-unit inset, and left-aligns a
  number cell** — deliberate. `editor.ts`'s NOT DONE HERE.
- **The properties panel and the in-place editor can overlap** at small window sizes. No remedy.
- **A raw `setSlot` LOWERING `rows`/`cols` still strands any now-out-of-bounds cell slot** —
  `primitives/table.ts`'s header.
- **The JOURNAL's `Operation` payloads are still unvalidated beyond `Array.isArray` + a raw
  illegal-number walk.** Nothing replays the journal. Named in `document.ts`'s own header.
- **A loaded document can carry a `formula`/`derived` `content` slot on a `text` object** (D-122
  blocks the command path, not the loader).
- **BOTH measured slots are `#MEASURE` for a `text` object created in a test** (default
  `NULL_EVAL_CONTEXT`), so its box falls back to `textbox.ts`'s 240×20 there.
- **`measure.ts` and `renderer.ts` fall back DIFFERENTLY for an unusable `style.*` slot.** Disclosed
  in both headers; unfixed — one shared set of fallbacks needs a ruling on which file owns them.
  **D-123 clause 5 forbids fixing it from the renderer's side.** `render/editor.ts` is a THIRD
  reader of that set (mirrors by value: 16 / 20 / "sans-serif" / 14).
- **`extent.ts` trusts the stored measurement; `renderer.ts` re-lays-out with its own `ctx`.**
  D-123 clause 5: the box follows the text, never the reverse.
- **An empty-`content` `text` object is invisible AND unselectable** (D-066). D-136 clause 2 removes
  an abandoned one.
- **`x`/`y` are OPTIONAL for the `text` command (default `0`, D-121 clause 3)** but REQUIRED for
  `circle`/`polygon`/`rect`/`table`/**`image`**.
- **`DEFAULT_TEXT_*` and `DEFAULT_IMAGE_*` style/size values are the handler's provisional pick** —
  no ruling, no tag.
- **`resolveTextDependencyAddresses` and `deriveEdges` Source 1 are a hand-maintained PAIR (D-119).**
- **`main.ts`'s `start` is untested code and keeps growing.** Verified live, not by assertion.
- **`findIllegalSlotClears`'s doc says "a `createObject` EARLIER in the same batch" while the code
  scans the whole operations array.** Left alone at 0157 on purpose (§4).
- **The properties panel positions an off-screen selected object's panel clamped to a canvas edge.**
- **A prompt sequence still shows nothing where you clicked** — ruled **D-090**, queued.
- **The formula-driven indicator is read NARROWLY** — `origin.x`/`origin.y` only.
- **A printable keystroke does not reach the command input unless it is focused** — D-088 clauses 2–4
  not built. **No command history** (**D-089**, queued).
- **Every pointer move repaints the canvas, and every EDITOR keystroke does too.** Rule 5's accepted
  trade — it is what grows the box.
- **`measure.ts`'s candidate-width loop is O(line²) measure calls**, as it always was (Rule 5), and
  markdown adds a parse per layout. Nothing is cached (D-114 clause 4's posture).
- **`escape` is bound to the window.** The in-place editor's own keydown `stopPropagation`s.
- **`zoom`'s echoed line names the REQUEST; `main.ts` adds a second line with the RESULT** — D-082 c5.
- **`format.ts`'s elision does not re-parse** — a disclosed round-trip exception.
- **A `delete` refusal can name the same dependent twice** — fix-list item 3.
- **`refs` names a range's START cell as the source** when the range's table is being removed.
- **Two sites ask the schema whether it declares a path** — `declaresSlotPath` and
  `resolveWritableSlot`'s inline check. A THIRD is forbidden.
- **`refs <address>` REFUSES for a cell of a table whose `rows` is a formula** (D-046).
- **SETTLED at 0118 — do not re-raise.** A bare reference to an EMPTY in-extent cell reads `0`, gets
  no edge (**D-110**).
- **`text.test.ts`'s `expectError` helper is unused** — kept deliberately.
- **SIX §5.10 commands have no registry entry** — `polyline`/`script`/`explode`/`addvertex`/
  `delvertex` wait on a schema or an `Operation` kind; **`pan` waits on Q-012**. (`image` LEFT this
  list at 0165.)
- **`createObjectFromCommand`'s "type has no schema" branch is uncovered**, as are
  `describeSlotValue`'s `Point`/`Point[]` arms.
- **A 1000×1000 table is legal and costs ~1.5 s per MUTATION.** Rule 5's accepted trade (D-077 c3).
- **`renderer.ts`'s `formatCellValue`, `props.ts`'s `describeSlotValue`, and `mutation.ts`'s
  `describeDimensionSlotValue` are three separate `Value`-to-text formatters** — deliberate.
  `main.ts`'s `cellLiteralSeed` is a FOURTH, and deliberately so.
- **`primitives/text.ts` CANNOT import `mutation.ts`** (D-119).
- **Render-layer imports:** `markdown.ts` imports NOTHING. `measure.ts` imports `markdown.ts` +
  engine leaves. `textbox.ts` imports NOTHING. `renderer.ts` imports `measure.ts` and `editor.ts`
  TYPE-ONLY, one direction. `editor.ts` imports `hittest.ts` + `extent.ts` + `camera.ts` +
  `slots.ts` + `textbox.ts` + engine leaves. No cycles.
- **Carried unchanged:** `set-formula` is a `kind` not a registry name · comment debt in TEST files ·
  mixed line endings in the WORKING TREE only (`core.autocrlf=true`) · dangling-reference messages
  name the DEPENDENT not the missing SOURCE · D-022's bounded-correctness claim fails for `table` ·
  `describeValueType` duplicated in `functions.ts`/`eval.ts` · `rewrite`/
  `repairObjectFormulaAddresses` walk `formula` slots only · journal structure unvalidated beyond
  `Array.isArray` · `lexer.ts`'s two edge cases · §5.11's `style` field · `noUnusedLocals` off ·
  `.gitattributes` still owed.

## Settled — do not re-raise

Every ruling in `DECISIONS.md` (D-001 through **D-139**) binds **except where entries 0153/0154/0155
overruled one on the human's explicit instruction.** Those, in full:

- **D-123 clause 3 — INVERTED.** A set `width`/`height` no longer crops the text; the box grows.
  Clause 2 (one measurement, two slots) and clause 5 (the box follows the text) both STAND.
- **D-129 clause 2 / D-135 — SUPERSEDED.** `overflow: auto` and zero-layout scrollbars replaced by
  `overflow: hidden` plus a box that grows.
- **D-132's colour clause — REVERSED.** The overlay matches `style.color`. **D-132 clause 2's
  "markdown-lite does not move a glyph, so it stays unmatched" is now the LOAD-BEARING half** — it
  is exactly what 0160 relies on, and Q-025 (a) confirmed it survives.
- **D-129's zoom-scaled type style — MOVED.** `editorTextStyle` reports WORLD lengths; the scaling is
  one CSS transform.
- **§5.6's `TextBox` slot list — DEVIATED, TWICE.** `autoresize` ADDED (0153); **`overflow` REMOVED
  (0154)**. Net: eleven.
- **D-102 clause 6's panel grammar — NARROWED.** A drop-down row writes a literal directly. **Q-016
  stays OPEN** for free-text rows.
- **D-120's "no mid-word breaking" — REVERSED (0154).** `layOutText` implements CSS's `pre-wrap` +
  `break-word`. D-120's actual ruling — line-breaking lives in `render/measure.ts`, never in
  `src/engine/` — STANDS untouched, and 0160 extended it to markup for the same reason.
- **§5.10's command list — EXTENDED (0155).** `clear <address>`. **D-047 itself is RELIED ON.**

**AWAITING A VERDICT, NOT SETTLED: §5.7's slot list — DEVIATED (0165).** `source` ADDED, a sixth slot
§5.7 does not name. See 0img above and entry 0165 decision 1.

**D-046 STANDS.** A dimension slot is read `literal`-only and fails closed to `0`. `content`
inherits the same posture. **`image.source` does NOT** — nothing parses it, so nothing needs it to.

**D-094's fourteen clauses stand** · **D-096's four clauses stand.**

**From 0091-REVIEW:** **D-088** (clause 1 built, 2–4 queued) · **D-089** (queued) · **D-090**
(queued) · **D-091**. **From 0090-REVIEW:** D-084–D-087 implemented. Still owed: **D-074**.

**Q-014 and Q-018 are CLOSED.** **Q-013 is NOT mooted.** **Q-016 and Q-017 remain OPEN**, both the
human's, neither blocking. **Q-019 → D-116**, **Q-020 → D-117**, **Q-021 → D-120**, **Q-022 →
D-121**, **Q-023 → D-122**, **Q-024 → D-123**, **Q-025 → D-139** — all CLOSED. **Q-026 is OPEN and
BLOCKING.** Next free: **Q-027**.

## Live PROVISIONAL tags and open questions

**Q-026 HAS NO TAGS AND MUST NOT GET ONE.** Not reversible (§7 clause 3), so no provisional choice
was taken. `primitives/schema.ts`'s NOT DONE HERE and `command/parser.ts`'s
`COMMANDS_SPECIFIED_BUT_NOT_BUILT` name the question instead of a guess.

**`PROVISIONAL(Q-012)` → `src/render/renderer.ts`** (×3), **`src/render/slots.ts`** (×1) and
**`src/render/editor.ts`** (×1): world units or screen pixels for stroke width / cell size / font?
Provisional (a) world units. Due with the `style`-slots cycle. **`markdown.ts` and `measure.ts`'s
heading scale add NO new site** — a scale is a ratio. **`image`'s `width`/`height` add no new site
either**: they are the same world units `rect`'s already are, and no cycle has questioned those.

**`PROVISIONAL(Q-008)` → `src/engine/graph/node.ts`** (×2, `-0`): open, deferred, blocking nothing.

**No other `PROVISIONAL` tags exist.** `grep -rn "PROVISIONAL(" src` confirms it.

## Gotchas for the next model

- **DO NOT START THE SCRIPT NODE. READ Q-026.** The blocker is not "this is hard" — it is that
  `Value` has no list arm and slot keys have no inverse, so there is literally nowhere to put a port
  name. Two hours of cleverness will land you on option (b) or (c) and both are worse than waiting.
- **`ObjectSchema.derivedSlots` IS PER TYPE, `nonDerivedSlotPaths` IS PER OBJECT.** That asymmetry is
  invisible until you need a per-object derived slot, and then it is the whole problem. Seven
  non-test sites read the former directly.
- **AN INERT MODULE'S TESTS AGREE WITH ITS AUTHOR.** 0159's parser passed everything and was wrong.
  0165's `image` is inert BY DESIGN, which is why it carries mutation checks it did not owe — if you
  add to it, wire it to a consumer in the same cycle.
- **D-066: DRAWN EXTENT AND CLICKABLE EXTENT ARE ONE EXTENT.** Giving `image` an `objectExtent` arm
  without a `renderer.ts` arm creates a click target for an invisible object. Ship them together.
- **THE MARKDOWN PARSER'S FLANKING RULE IS LOAD-BEARING, NOT POLISH.** If you simplify
  `opensEmphasis`/`closesEmphasis`, you reintroduce a shipped bug that 30 green tests missed.
- **`measure.ts` AND `renderer.ts` MUST MOVE TOGETHER, ALWAYS.** One `layOutText`, two readers.
- **D-138 — THE WRAP RESIDUAL IS SETTLED AND ACCEPTED. DO NOT COMPENSATE FOR IT.** Adopting a
  further *specified* rule is the legitimate move and must be named at the site.
- **D-137 IS ABOUT YOU.** When your cycle changes what a file does, its HEADER is part of your diff.
  Check `NOT DONE HERE` hardest — and check stale COUNTS in prose ("all four handlers"), which 0165
  hit twice in one file. Never insert a declaration between a doc comment and what it documents.
- **A REGISTRY-COMPLETENESS TEST GOING RED IS THE SYSTEM WORKING.** Adding one command word turned
  four of them red (parser examples, prompt forms, command sweep, unregistered types). Update them
  and NAME the §6.1 trigger 5 in your entry; do not treat it as noise.
- **THE 2026-09-02 TEXT-BOX WORK (0153 + 0154) OVERRULED EIGHT PRIOR RULINGS ON THE HUMAN'S EXPLICIT
  INSTRUCTION.** Never "correct" the code back toward one. A text box never crops, the measurer
  breaks words, and there is no `overflow` slot.
- **`render/textbox.ts` IS THE ONE BOX-SIZING RULE.** Three readers. Do not add a fourth reading.
- **THE OVERLAY IS LAID OUT IN WORLD UNITS AND SCALED BY ONE TRANSFORM.** Do not pre-multiply
  `camera.zoom / ratio` into its width or its font size again.
- **THERE ARE TWO MEASURERS AND THEY ARE NOT INTERCHANGEABLE.** The engine's honours markup; the
  overlay's does not. Handing the wrong one to `editorTextBoxSize` is a silent size defect.
- **`ctx.textAlign` IS ALWAYS `left` IN `drawText` NOW.** Alignment is arithmetic.
- **A RESIZE IS ABSOLUTE, NOT INCREMENTAL** (from `ResizeState.startExtent`), and a HEIGHT drag
  writes `autoresize: false`.
- **`InteractionState` HAS THREE FIELDS** — a hand-built one in a test needs `resize` too.
- **A DROP-DOWN OPTION CARRIES ITS INDEX, NOT ITS LABEL.** A boolean ECHOES as `TRUE`/`FALSE`.
- **A `formula` ROW NEVER GETS A DROP-DOWN** (D-040).
- **`autoresize` IS NOT A MEASURED-SLOT DEPENDENCY**, which is what keeps old saved documents
  loading. **ADDING A DERIVED SLOT IS SAFE FOR SAVED DOCUMENTS AS OF 0156** (D-126).
- **`cellLiteralSeed` AND `buildCellCommand` ARE INVERSES AND MUST CHANGE TOGETHER.**
- **A `<textarea>` soft-wraps unless you set `wrap="off"`.** **Do NOT add `white-space` to
  `.text-editor`.** `overflow-wrap: break-word` IS set there deliberately, and `measure.ts`
  implements the same rule — **that pair must be changed together or not at all.**
- **`.text-editor` may not set a font, a padding or a border** — `index.html`'s comment says why.
- **`commitTextContent` NEVER sniffs for `=`** — the whole string is one literal `set`.
- **The in-place editor is mounted in `#stage`**, not `#panels`.
- **DO NOT TRUST A RULING'S CLAIM ABOUT REACHABILITY — GREP FOR THE CALLER** (D-127's lesson).
- **`#MEASURE` is a real `ErrorCode`** (`graph/node.ts`), sixth after `#SCRIPT`.
- **The operator cannot see what you can see.** Ask for a live look before treating an authoring
  surface as done — the deciding step in six cycles running (0152–0161). Nothing is queued unseen as
  of 2026-09-03; `image` is unseen only because it is unseeable. Keep it that way.
