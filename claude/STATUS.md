# STATUS — as of entry 0145-RULINGS-phase5

**READ THIS FIRST — D-125 IS BUILT (0143) AND REVIEWED (0144, ACCEPT). THE HUMAN THEN TESTED IT ON
SCREEN (0145) → THREE RULINGS (D-129/D-130/D-131). THE NEXT WORK IS A SHORT EDITOR-POLISH CYCLE
DISCHARGING THOSE THREE, *THEN* D-124.**

- **D-125 — in-place text entry. BUILT at entry 0143, REVIEWED AND ACCEPTED at 0144.** A DOM input is
  overlaid on the canvas by a DOUBLE-CLICK, over a `text` object's `content` (a `<textarea>`) or a
  table cell (an `<input>`). It commits through the EXISTING `runPanelCommand` → `executeCommand`
  seam (Rule 2) — `content` as a LITERAL always (never sniffed for `=`; `buildPanelSetCommand`
  deliberately NOT reused, D-125 clause 3's trap), a table cell Excel-style (`=` means formula). New
  file `render/editor.ts` (geometry: which receiver, where the overlay). **D-128 confirmed the
  clause-5 reading: Escape cancels, blur/click-outside commits, Enter commits only in a cell.**
- **EDITOR-POLISH CYCLE — D-129 + D-130 + D-131. NOT BUILT — this is the NEXT slice.** From the
  human's on-screen test of entry 0143:
  - **D-129** — the overlay must scale its font with `style.fontSize × camera.zoom` (a cell: fixed
    base × zoom) and must NOT clip its own text (`overflow: hidden` → `auto`/grow). Today it is a
    fixed 14px clipped box, unusable at many zoom levels. **The serious one.**
  - **D-130** — a pan gesture (`event.button === 1 || spaceHeld`) must NOT commit the editor. Move
    the `commitInPlace()` call below the pan branch in `pointerdown`. One conditional.
  - **D-131** — the cell editor shows a same-table reference in relative Excel form (`=A1 * 2`, not
    `=table_1.A1 * 2`). `formatFormula` gains an optional `relativeToObjectId`; `editorSeed` passes
    the cell's host table id; both range endpoints relative or neither; every other caller unchanged.
- **D-124 — `text` is placed by POINTING**, like `circle`/`rect`/`table`: type `text`, then click.
  A one-step `point` prompt sequence, NO content step — the pick completes the command and D-125's
  editor opens on the new box. **NOT BUILT — build it AFTER the editor-polish cycle** (D-124 opens
  this editor on creation, so it should ride a polished one).
- **Standing:** the human's direct instruction outranks `PROJECT_BRIEF.md`. *"If the brief conflicts
  with what I say, ignore the brief. I wrote it."* Never "correct" a ruling back toward the brief.

Order from here: **editor-polish (D-129 + D-130 + D-131)**, then **D-124**, then the **load-hardening
cycle** (D-126 + D-127 + D-108, one `document.ts` diff), then markdown-lite, then `overflow`, then
the Phase 5 gate.

---

## Where the code actually is — as of entry 0145-RULINGS-phase5

STATE: **GREEN** (compiles, all tests pass). Both configs compile, **1510/1510** tests pass,
0 skipped, 0 `.only`. **31 test files.** **PHASE 5 IS OPEN.** Entry 0145 wrote no code.

Last review point: **0144-REVIEW-phase5** (**ACCEPT** — entry 0143 / D-125; no source edits; D-128
issued).
Cycles since last review: **0/3**. Diff since last review: **0 / 0 files** (cap 800/10). The batch
is empty — the editor-polish cycle (D-129 + D-130 + D-131) starts a fresh one and will report
`REVIEW: REQUIRED` (three fresh rulings + a `formatFormula` parameter).

## Read this first — what a cold reader needs

**0. `TEXT_SCHEMA` HAS ELEVEN NON-DERIVED + THREE DERIVED SLOTS.** Non-derived: `origin.x`/`origin.y`
(D-121, front of the list) + `content` + `width`/`height`/`overflow` + five `style.*`. `content` +
`width` + `style.font`/`fontSize`/`lineHeight` are **effectively-required** (dangling-edge refusal if
absent — 0129). Derived: `resolvedContent` (dynamic deps), `measuredHeight` and `measuredWidth`
(static deps, **the SAME list** — one measurement answers both).

**0a. THE TWO MEASURED SLOTS ARE ONE MEASUREMENT (D-123 clause 2).** `measureTextBox`
(`primitives/text.ts`, private) owns the read set, the failure ladder and the single `measure` call.
Do not split them. Failure order: upstream `ErrorValue` → `#MEASURE` (no real measurer, D-118) →
`#TYPE` (unusable style) → `#TYPE` (non-finite width OR height) → the box.

**0b. `extent.ts`'s `text` box, both axes:** the fixed slot when positive-finite → the measurement
when positive-finite → a fixed fallback (240 / 20, reached ONLY for `#MEASURE`). `undefined` for a
`text` object with no `resolvedContent`. `hittest.ts`, the selection highlight, the chrome anchor and
`fit` all read this ONE box (D-066/D-010).

**0c. A HAND-BUILT `text` FIXTURE PUSHED THROUGH `mutate` NEEDS ALL THREE DERIVED PLACEHOLDERS.**
D-018 refuses one missing `measuredWidth: { kind: "derived", value: null }`. A fixture that only goes
through `evaluate`/`objectExtent` does not.

**0d. `DEFAULT_TEXT_*` (`command/commands.ts`)** — `width`/`height` `"auto"`, `overflow` `"visible"`,
font `"sans-serif"`, fontSize `16`, lineHeight `20`, color `"black"`, align `"left"`. §5.6 gives no
defaults. Not `PROVISIONAL`-tagged. **`DEFAULT_TEXT_WIDTH` `"auto"` is why `measuredWidth` is the
normal path.**

**0e. THE MEASURER IS BUILT, WIRED, AND REVIEWED (0133).** `main.ts:start` builds `evalContext` from
`createCanvas2dTextMeasurer` over a SECOND offscreen 2D context and threads it through
`executeCommand` / `pointerMove` / `loadDocument` and the pure transitions via an optional trailing
`context` param (default `NULL_EVAL_CONTEXT`).

**0f. `render/measure.ts` — line-breaking lives HERE (D-120), never in `src/engine/`.**

**0g. `content` IS `literal`-ONLY (D-122).** The guard is `isTextContentTarget` in
`command/commands.ts`'s `buildSlot`. A loaded `formula` `content` slot commits with its inner
references untracked — the disclosed loaded-file gap.

**0h. ADDING A DERIVED SLOT BREAKS PREVIOUSLY SAVED DOCUMENTS, TODAY (D-126).** A `derived` slot's
KEY serializes even though its VALUE does not, and the loader treats the file's key set as
authoritative → D-018 refuses a pre-extension document. Ruled D-126 (loader reconstructs derived
slots from the schema). Until it lands, **any cycle adding a derived slot states the load
consequence in its entry.** Entry 0143 added NO derived slot.

**0i. D-125's IN-PLACE EDITOR IS AN AUTHORING SURFACE OVER THE EXISTING SEAM (entry 0143, reviewed 0144).**
`render/editor.ts` (pure geometry: `editorTargetAt` picks the receiver via `hitTest`,
`editorPlacement` puts the overlay on its world box through `worldToScreen`). `main.ts`'s pure half:
`commitTextContent` (ALWAYS a literal `set` — the D-125 clause 3 trap), `commitTableCell`
(Excel-style via `buildCellCommand`), `editorSeed`. Both commits run through `runPanelCommand` →
`executeCommand` — NO second write path (Rule 2). DOM half in `start`: `dblclick` opens, blur/click-
outside commits, Escape cancels, Enter commits in a cell (newline in a text box). The overlay is
mounted in `#stage` (no delegated listeners), NOT `#panels`.

**1. PHASE 4'S GATE TEST IS `main.test.ts`'s `describe` "PHASE 4'S ACCEPTANCE CRITERION" (7 tests).**
Do not weaken; do not fold.

**2. D-110's DISCLOSED CONSEQUENCE — `refs` HAS TWO FORMS (D-112).** Neither may be "fixed" to match
the other.

**3. THE PANEL IS FULLY BUILT AND FULLY REVIEWED — DO NOT RE-BUILD ANY OF IT.** D-094/D-100/D-101/
D-106/D-102/D-107. **Q-014 is CLOSED in code.** D-125's in-place editor ADDS a surface, replaces none
of the panel (D-125 clause 8).

**4. A panel-typed STRING reaches a FORMULA slot, never a literal one** (D-102 clause 6). **Q-016**
carries the grammar question. **D-125's `commitTextContent` is the opposite rule on purpose** — a
`text` box's whole string is one literal, never a formula.

**5. `main.ts`'s DOM half (`start`) IS UNTESTED BY CONSTRUCTION (D-001) AND KEEPS GROWING.** D-125
clause 7 was honoured: the commit logic (`commitTextContent`/`commitTableCell`) is in the EXPORTED
pure half; only element lifecycle and listeners are in `start`.

**6. THE VANISHING-TABLE DEFECT IS FIXED (entry 0101) — D-097/D-098/D-099 are CLOSED.**

**7. D-104 IS OWED BY A CYCLE THAT HAS NOT BEEN SCHEDULED.** `insertTableLine`/`deleteTableLine` not
bounded by `MIN`/`MAX_TABLE_LINES`. Not command-reachable. Fix in `findInvalidTableResizes`.

**8. D-108 NOW HAS AN OWNER (D-127).** All four of D-108 clause 1's AST shapes throw a `TypeError` out
of `loadDocument`, surfacing as an unhandled promise rejection from `openDocument` — the operator
picks a file and the program silently does nothing. D-108 clauses 1/2/4 stand; the load-hardening
cycle owns the fix.

**9. D-081 AND D-083 CLAUSE 4 ARE BUILT (0112) AND REVIEWED (0113).**

**10. THE TEXT BLOCK TREE IS DERIVED STATE, RE-PARSED FROM `content` ON DEMAND, NEVER CACHED (D-114
clause 4).** A broken span becomes an `error`-kind `Block` (D-115); its parsed branches live in
`orphaned`.

**11. THE PAPERCLIP CANNOT REACH A TABLE CELL — but D-125's in-place editor now can (entry 0143).**
Double-click a cell. §5.4's formula bar stays unbuilt and is NOT part of D-125.

**12. `evaluateDerivedSlot`'s `read` RUNS THE D-110 COERCION BEFORE THE D-013 MEMBERSHIP CHECK
(D-114 clause 3).** Do not swap them.

**13. `resolveTextDependencyAddresses` and `deriveEdges` Source 1 are a hand-maintained PAIR with no
compiler link (D-119).** Change one → change both, same cycle, log names both.

**14. A broken embedded span is marked `!` in place (D-116 parse / D-117 runtime), never blanks the
box; `evaluateBlockTree` always returns a `string`.**

**15. `EvalContext` IS THREADED PER CALL, NOT STORED (0132, reviewed 0133).** Public entry points
default it to `NULL_EVAL_CONTEXT`; internal handlers take it REQUIRED.

**16. `TEXT_TYPE` (`graph/node.ts`) joins `TABLE_TYPE`.** Import it, never a bare `"text"` literal in
an equality check (D-009). `render/editor.ts` imports both.

## Next slice (recommended)

**THE EDITOR-POLISH CYCLE — D-129 + D-130 + D-131, one cycle.** Files: `render/editor.ts` +
`src/main.ts` (DOM half + `editorSeed`) + `index.html` (`.text-editor` CSS) + `src/engine/formula/
format.ts` (the new optional `relativeToObjectId`) + tests.
- **D-129** — `editor.ts` (or a sibling of `editorPlacement`) also returns a font size:
  `readNumber(object, TEXT_STYLE_FONT_SIZE_PATH) × camera.zoom` for a `text` object, a fixed base ×
  `camera.zoom` for a cell. `updateEditor` sets it as an inline style. `.text-editor` loses
  `overflow: hidden` — a `<textarea>` grows/scrolls rather than clips, a cell `<input>` scrolls
  horizontally. Box anchoring unchanged (D-125 clause 1).
- **D-130** — in `main.ts`'s canvas `pointerdown`, move `commitInPlace()` below the
  `event.button === 1 || spaceHeld` pan branch so a pan does not commit.
- **D-131** — `formatFormula(ast, objects, relativeToObjectId?)`: a `reference`/`range`-endpoint
  whose address is a `cells.*` slot of `relativeToObjectId` prints bare (`A1`), both range endpoints
  or neither. `editorSeed`'s cell-formula branch passes the cell's host table id. Every other
  `formatFormula` caller passes nothing and is unaffected — assert that in `format.test.ts`.
- Round-trip test: seed a cell formula → commit unchanged → AST is bit-identical.
- **`REVIEW: REQUIRED`** — three fresh rulings and a signature change to a core engine formatter.

**Then D-124 — `text` placed by pointing.** A `prompts` entry on `parser.ts`'s `text` spec: one `point`
step (message "specify text position"), no content step; `buildFromPrompts` producing the same
`TextCommand` with `content` `""`. Then wire `start` so D-125's editor opens on the new object
immediately (D-125 clause 4: "placing and typing are one gesture"). `createText` /
`createObjectFromCommand` do not return the new object's id today — the pointing cycle needs it (a
`CommandEffect`, or a widened `CommandOutcome`, reviewer's call). `PromptStep.accepts` does NOT
widen (D-124 clause 4). Read `prompt.ts`'s `usesNamedForm` hazard note first — it is what keeps
`text "hi"` and `text x=0 y=0 "hi"` working. §6.1 trigger: `parser.ts` extension + the effect/outcome
question → `REVIEW: REQUIRED` likely.

**Then the LOAD-HARDENING CYCLE — one `document.ts` diff** discharging D-126 (loader reconstructs
declared derived slots), D-127/D-108 (one `FormulaAst` shape validation at the load boundary +
`openDocument`'s promise chain given a rejection path), and D-108 clause 1's owed doc corrections +
`document.test.ts` extension. `document.ts` is §6.2 load-bearing — `REVIEW: REQUIRED`.

Then, in order: **markdown-lite rendering** (§5.6's exact list, in `renderer.ts`'s `drawText`, and
`render/measure.ts` made markup-aware in the SAME cycle so drawn and measured agree — a markup-aware
measurer moves the BOX). Then `overflow: "clip"`/`"ellipsis"` (small — read **D-123 clause 5**
first). Then the **Phase 5 gate**: an executable test over one document proving the §6 criterion,
`REVIEW: REQUIRED` (§6.1 trigger 1).

Cheap adds while in there: a direct `link text_1.origin.y <cell>` test (0137-REVIEW §honesty).

**The render-only alternative, still needs no ruling:** **D-109 clauses 1–2** (cell decimal precision
+ no cell-text clipping, `render/renderer.ts` only). **Q-017** headers remain the human's.

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
D-121 + D-122 issued · **0137-REVIEW** entry 0136's `text` command; Q-022/Q-023 CLOSED · **0139-REVIEW**
entry 0138's text rendering; D-123 issued, Q-024 answered · **0142-REVIEW** entry 0141's
`measuredWidth`; Q-024 CLOSED; D-126 + D-127 issued · **0144-REVIEW** entry 0143's in-place editor
(D-125 — `render/editor.ts` + `main.ts` commit seam); D-128 issued; no source edits · **0145-RULINGS**
the human's on-screen test of the editor; D-129 + D-130 + D-131 issued; no code.

## Built this batch, not yet reviewed

**Nothing.** Entry 0143 (D-125 — in-place text entry) was reviewed and ACCEPTED at 0144 (no source
edits, D-128 issued), then tested on screen by the human at 0145 (D-129/D-130/D-131 issued, no
code). The editor-polish cycle starts the next batch.

## Not started

D-090's prompt-sequence preview · §5.9's per-vertex drag path ·
`polyline`/`explode`/`addvertex`/`delvertex` · `style` slots as authorable · point-in-polygon fill
hit-testing (D-067) · §5.4's formula bar · **the editor-polish cycle (D-129 + D-130 + D-131) — NEXT**
· **D-124's `text` prompt sequence + open-editor-on-create**
· **the load-hardening cycle (D-126 + D-127 + D-108)** · D-088 clauses 2–4 · D-089 · D-102 clause 9 ·
**D-109 clauses 1–2** · markdown-lite text rendering + a markup-aware measurer · `text` `overflow`
clip/ellipsis · the Phase 5 gate test · Phases 6–7.

## Open fix list — read 0090-REVIEW §9, 0091-REVIEW §5 and 0100-REVIEW §9 for the full text

Numbering follows 0090-REVIEW §9. Items 2–13, 15–21, 23–24 unchanged and open unless noted.

1. **DONE at entry 0112**, reviewed 0113.
2. **Give the missing-slot refusal a remedy.** Message only; narrowed by D-110 to clause 6's cases.
3. **`findDanglingReferences` names one dependent once per MISSING SOURCE.**
4. **`zoom`'s refusal names `Infinity`.** Message only.
5. **Carried from 0074-REVIEW §9, all six unchanged.**
6. **A middle-drag pan started outside the canvas is untested.** Owned by D-088's cycle.
7. **`TABLE_GRID_STROKE_STYLE` has no comment** (D-091). Owned by the `style`-slots cycle.
8. **The screen-space chrome constants + `PANEL_OBJECT_GAP_CSS` are untuned** (Rule 5). `editor.ts`'s
   `EMPTY_TEXT_EDITOR_*` fallbacks join this list — untuned world constants.
9. **The chrome pass leaves `ctx.font`/`textAlign`/`textBaseline` set on return.** Harmless.
10. **The formula-driven indicator's narrowness (`origin.x`/`origin.y` only) should be RE-DECIDED.**
11. **A display-only panel's `overflow: auto` scroll resets on every paint.**
12. **A right-flipped panel that hits the right clamp overlaps its own object.** Correct per D-094.
13. **`insertTableLine`/`deleteTableLine` are not bounded by `MIN`/`MAX_TABLE_LINES`** — **D-104**.
14. **0110-REVIEW's F1–F4 — BUILT (0111), REVIEWED (0113).** Closed. **Q-016** carries F3's tail.
15. **F5 — `deserializeDocument`'s "never throws" is FALSE for a malformed loaded `ast`.** Ruled
    **D-108**; re-owned by **D-127**. Clause 3 still forbids piecemeal hardening meanwhile.
16. **F6 — a panel row's text can no longer be mouse-selected.** D-095 governs.
17. **F7/F8 — ruled D-109. F8 BUILT (0117), REVIEWED (0119); F7 (clauses 1–2) NOT BUILT.**
18. **F9 — CLOSED in the same review.**
19. **F10 — CLOSED, ruled D-112.**
20. **F11 — open, no owner.** Shrinking a table's extent under a formula reading an empty in-extent
    cell is REFUSED. Correct per D-110 clause 6.
21. **F12 — open, DO NOT RE-LITIGATE.** `MIN(B1, B2)` vs `MIN(B1:B2)` on empty in-extent cells.
22. **F13 — RULED D-122, BUILT (0136), REVIEWED (0137). CLOSED.**
23. **F21 — CLOSED**, WIDENED at 0141 (non-finite guard now covers width too, D-123 clause 2).
24. **F22 — CLOSED in the same review.**
25. **F23 — RULED D-126, NOT BUILT.** Adding a derived slot invalidates every previously saved
    document carrying that object type. Owned by the load-hardening cycle.
26. **F24 — RULED D-127, NOT BUILT.** D-108's deferral condition could never fire; the malformed-AST
    throw is operator-reachable and surfaces as a silent no-op. Same cycle as F23.
27. **F25 — RULED D-129, NOT BUILT.** The in-place editor overlay does not scale its font with zoom
    and clips its own text (`overflow: hidden`) — unusable at many zoom levels. Editor-polish cycle.
28. **F26 — RULED D-130, NOT BUILT.** A pan gesture commits and closes the in-place editor; zoom
    does not. Editor-polish cycle — one conditional in `pointerdown`.
29. **F27 — RULED D-131, NOT BUILT.** The cell editor redisplays a same-table formula fully-qualified
    (`=table_1.A1 * 2` for what was typed as `=A1 * 2`). Editor-polish cycle — a `formatFormula`
    parameter.

## Known problems (detail lives where the pointer says)

- **D-125 clause 5's contradiction is RESOLVED by D-128** — Escape = cancel, blur/click-outside =
  commit, Enter = commit in a cell only (newline in a `text` box). Confirmed as built on screen; the
  human may still overrule clauses 4–5 on sight.
- **THE IN-PLACE EDITOR HAS BEEN TESTED ON SCREEN (0145).** The clause-3 trap holds; opening,
  pre-fill, focus, Escape, Enter, cell commit, deletion-closes-it, panel-click-commits, no console
  errors — all confirmed. Three defects → D-129 (font/zoom + clip), D-130 (pan commits), D-131
  (qualified cell ref). All owned by the editor-polish cycle, the next slice.
- **the in-place editor overlay does not match font family, markdown rendering, or text alignment** —
  a noted refinement, explicitly OUT of D-129's scope (D-129 fixes size + clip only).
- **the properties panel and the in-place editor can overlap** only when a small window forces them
  into the same space (0145 confirmed they stay clear at normal sizes). No remedy scheduled.
- **A raw `setSlot` LOWERING `rows`/`cols` still strands any now-out-of-bounds cell slot** —
  `primitives/table.ts`'s header.
- **A saved document does not survive a derived-slot addition** — **D-126**, fix-list 25.
- **A malformed loaded `ast` throws out of `loadDocument`, swallowed by `openDocument`** — **D-108 +
  D-127**, fix-list 26.
- **A loaded document can carry a `formula`/`derived` `content` slot on a `text` object** (D-122
  blocks the command path, not the loader). `editorSeed` shows its last string value; committing
  replaces it with a literal (D-040) — which happens to repair the illegal state.
- **BOTH measured slots are `#MEASURE` for a `text` object created in a test** (default
  `NULL_EVAL_CONTEXT`), so its extent falls back to 240×20 there. Through the running app `main.ts`
  threads a real measurer.
- **`measure.ts` and `renderer.ts` fall back DIFFERENTLY for an unusable `style.*` slot, and that
  also moves the BOX's width.** Disclosed in both headers; unfixed — one shared set of fallbacks
  needs a ruling on which file owns them. **D-123 clause 5 forbids fixing it from the renderer's
  side.**
- **`extent.ts`'s `text` box trusts the stored measurement; `renderer.ts` re-wraps with its own
  `ctx`.** 0139-REVIEW ruled this stays (D-123 clause 5): the box follows the text, never the reverse.
- **An empty-`content` `text` object is invisible AND unselectable** — no ink, no extent, no hit box.
  Correct per D-066. **D-124 creates exactly this and hands it to D-125's editor** — the editor's own
  overlay (`editorPlacement`'s fallback box) is what makes it real on screen (D-125 clause 6);
  `extent.ts` is NOT loosened.
- **`x`/`y` are OPTIONAL for the `text` command (default `0`, per D-121 clause 3)** but REQUIRED for
  `circle`/`polygon`/`rect`/`table`. 0137-REVIEW confirmed it is intended. D-124 makes the pointing
  path the normal one.
- **`DEFAULT_TEXT_*` style values are the handler's provisional pick** — no ruling, no `PROVISIONAL`
  tag (render config, `set`-changeable).
- **`resolveTextDependencyAddresses` and `deriveEdges` Source 1 are a hand-maintained PAIR (D-119).**
- **`main.ts`'s `start` is untested code and keeps growing.** Verified live, not by assertion.
- **The properties panel positions an off-screen selected object's panel clamped to a canvas edge.**
- **The chrome layout is UNSEEN beyond entry 0094's anchor fix.** **D-095** / D-101 clause 3.
- **A prompt sequence still shows nothing where you clicked** — ruled **D-090**, queued.
- **The formula-driven indicator is read NARROWLY** — `origin.x`/`origin.y` only.
- **A printable keystroke does not reach the command input unless it is focused** — D-088 clauses 2–4
  not built. **No command history** (**D-089**, queued).
- **Every pointer move repaints the canvas and rewrites the whole log's `textContent`.** Rule 5. The
  in-place editor's `updateEditor` re-places the overlay every paint too (it must track its object).
- **`escape` is bound to the window.** Innermost-first order is STRUCTURAL. The in-place editor's own
  keydown `stopPropagation`s, so a focused editor's Escape never reaches the window handler.
- **`zoom`'s echoed line names the REQUEST; `main.ts` adds a second line with the RESULT** — D-082 c5.
- **`format.ts`'s elision does not re-parse** — a disclosed round-trip exception.
- **A `delete` refusal can name the same dependent twice** — fix-list item 3.
- **`refs` names a range's START cell as the source** when the range's table is being removed.
- **Two sites ask the schema whether it declares a path** — `declaresSlotPath` and
  `resolveWritableSlot`'s inline check. A THIRD is forbidden.
- **`refs <address>` REFUSES for a cell of a table whose `rows` is a formula** (D-046) — unreachable
  by command (D-097), reachable via a loaded file.
- **SETTLED at 0118, REVIEWED 0119 — do not re-raise.** A bare reference to an EMPTY in-extent cell
  reads `0`, gets no edge (**D-110**).
- **`text.test.ts`'s `expectError` helper is unused** — kept deliberately.
- **`schema.test.ts`'s derived-slot assertion compares `derivedSlots[2]` to `[1]` by index** — fine
  today.
- **`render/measure.ts` measures markdown markup verbatim AND `renderer.ts` draws it verbatim** —
  deliberately consistent for now. The markdown-lite cycle moves both.
- **Seven §5.10 commands have no registry entry** — `polyline`/`script`/`image`/`explode`/
  `addvertex`/`delvertex` wait on a schema or an `Operation` kind; **`pan` waits on Q-012**.
- **`createObjectFromCommand`'s "type has no schema" branch is uncovered**, as are `describeSlotValue`'s
  `Point`/`Point[]` arms.
- **A 1000×1000 table is legal and costs ~1.5 s per MUTATION.** Rule 5's accepted trade (D-077 c3).
- **`renderer.ts`'s `formatCellValue`, `props.ts`'s `describeSlotValue`, and `mutation.ts`'s
  `describeDimensionSlotValue` are three separate `Value`-to-text formatters** — deliberate.
  `main.ts`'s `editorSeed` reuses `describeSlotValue` and `formatFormula` — no fourth formatter.
- **`primitives/text.ts` imports `primitives/table.ts`** and `import type`s `DerivedSlotComputeDeps`
  from `primitives/schema.ts`, plus `hasRealMeasurer` + `TextStyle` from `eval-context.ts`. It
  CANNOT import `mutation.ts` (D-119).
- **`render/editor.ts` imports `render/hittest.ts` + `render/extent.ts` + `render/camera.ts` +
  `render/slots.ts` + engine leaves.** No cycle — nothing imports `editor.ts` except `main.ts`.
- **Carried unchanged, each with its pointer:** `set-formula` is a `kind` not a registry name · comment
  debt in TEST files only · mixed line endings in the WORKING TREE only (`core.autocrlf=true`) ·
  dangling-reference messages name the DEPENDENT not the missing SOURCE · D-022's bounded-correctness
  claim fails for `table` · `describeValueType` duplicated in `functions.ts`/`eval.ts` ·
  `rewrite`/`repairObjectFormulaAddresses` walk `formula` slots only · journal structure unvalidated
  beyond `Array.isArray` · `lexer.ts`'s two edge cases · §5.11's `style` field · `noUnusedLocals` off ·
  `.gitattributes` still owed.

## Settled — do not re-raise

Every ruling in `DECISIONS.md` (D-001 through **D-131**) binds without restatement here.

**D-114 / D-115 / D-116 / D-117 ARE BUILT IN FULL AND REVIEWED (0126/0127, cleared 0128).**

**D-118 — BUILT (0129), REVIEWED (0130), WIRED (0132), WIRING REVIEWED (0133).**

**D-119 — RULED, RECONCILED.** The `resolveTextDependencyAddresses` / `deriveEdges` Source 1 pair.

**D-120 — RULED, answers Q-021. BUILT + WIRED + REVIEWED (0133).** Note: its rationale's claim about
the slot KEY is WRONG — see D-126.

**D-121 / D-122 — RULED (0135-REVIEW), BUILT (0136), REVIEWED (0137).**

**D-123 — RULED (0139-REVIEW), BUILT (0141), REVIEWED AND ACCEPTED (0142).** Clause 5 binds every
render cycle: the box follows the text, the text NEVER follows the box.

**D-124 — RULED BY THE HUMAN (0140-RULINGS). NOT BUILT — NEXT.** `text` is placed by pointing.
Clause 5 generalises it — EVERY creation command arrives with a `prompts` entry.

**D-125 — RULED BY THE HUMAN (0140-RULINGS), ABSOLUTE PRIORITY. BUILT (0143), REVIEWED + ACCEPTED
(0144).** Clause 3 is the trap (`content` literal ALWAYS; a cell is Excel-style). Clauses 4–5 are
reviewer-chosen defaults the human may overrule on sight — **clause 5's contradiction is settled by
D-128** (Escape cancels, blur/click-outside commits, Enter commits only in a cell).

**D-128 — RULED (0144-REVIEW).** The coherent reading of D-125 clause 5, as built at entry 0143.
Binds D-124's open-editor-on-create wiring. Reversible; the human may overrule.

**D-129 / D-130 / D-131 — RULED (0145-RULINGS), NOT BUILT.** From the human's on-screen test of the
in-place editor. D-129: the overlay scales its font with zoom and does not clip. D-130: a pan
gesture does not commit the editor. D-131: the cell editor shows a same-table reference in relative
Excel form (`formatFormula` gains an optional `relativeToObjectId`). **All three are the
editor-polish cycle — the NEXT slice, before D-124.**

**D-126 — RULED (0142-REVIEW), NOT BUILT.** The loader reconstructs a schema's declared derived
slots and never trusts the file to list them. `formatVersion` is NOT bumped.

**D-127 — RULED (0142-REVIEW), NOT BUILT.** D-108's deferral condition already fired at entry 0089.
Owner is the load-hardening cycle, after the editor-polish cycle and D-124.

**THE HUMAN'S DIRECT INSTRUCTION OUTRANKS `PROJECT_BRIEF.md` (0140).**

**Implemented AND reviewed, do not re-build:** D-097/D-098/D-099 · D-100 · D-101/D-106/D-102 · D-107 ·
D-081 + D-083 c4 · Phase 4's gate test · D-109 clause 3 · D-110 in full · D-114/D-115/D-116/D-117 ·
D-118 · D-120 · D-121 / D-122 + the `text` command · text rendering + the text bounding box · D-123 +
`measuredWidth` · **D-125 + D-128** (in-place text entry — entry 0143, reviewed 0144).

**NOT implemented, each owned by a named future cycle:** **D-129 + D-130 + D-131** (editor-polish —
NEXT) · **D-124** (`text` placed by pointing — after editor-polish) · **D-126** + **D-127** +
**D-108** (one load-hardening cycle, after D-124) · **D-104** (§5.10's row/column commands) ·
**D-109 clauses 1–2** (cell decimals + clipping, `render/` only).

**Q-014 and Q-018 are CLOSED.** **Q-013 is NOT mooted.** **Q-016 and Q-017 remain OPEN**, both the
human's, neither blocking. **Q-019 → D-116**, **Q-020 → D-117** — BUILT and REVIEWED (0128).
**Q-021 → D-120** — BUILT + WIRED + REVIEWED (0133). **Q-022 → D-121**, **Q-023 → D-122** — CLOSED.
**Q-024 → D-123 — CLOSED.** Next free: **Q-025**.

**D-046 STANDS AND DOES NOT MOVE.** A dimension slot is read `literal`-only and fails closed to `0`.
`content` inherits the same posture.

**D-094's fourteen clauses stand** · **D-096's four clauses stand** (0129's `TEXT_*_PATH` move is a
named divergence).

**From 0091-REVIEW:** **D-088** (clause 1 built, 2–4 queued) · **D-089** (queued) · **D-090** (queued) ·
**D-091**. **From 0090-REVIEW:** D-084–D-087 implemented. Still owed, unchanged: **D-074**.

## Live PROVISIONAL tags and open questions

**`PROVISIONAL(Q-012)` → `src/render/renderer.ts`** (×3) and **`src/render/slots.ts`** (×1): world
units or screen pixels for stroke width / cell size / font? Provisional (a) world units. Due with the
`style`-slots cycle.

**`PROVISIONAL(Q-008)` → `src/engine/graph/node.ts`** (×2, `-0`): open, deferred, blocking nothing.

**No other `PROVISIONAL` tags exist.** Q-016/Q-017 have none. Entry 0143 added none.

## Gotchas for the next model

- **THE NEXT SLICE IS THE EDITOR-POLISH CYCLE (D-129 + D-130 + D-131), NOT D-124.** D-125 is BUILT
  (0143), REVIEWED (0144), and TESTED ON SCREEN (0145). The human's three defects come first because
  D-124 opens this editor on creation and would inherit them. The batch is empty — polish opens a
  fresh one, `REVIEW: REQUIRED`.
- **D-128 settled D-125 clause 5** — Escape cancels, blur/click-outside commits, Enter commits only
  in a cell. D-124's open-editor-on-create wiring inherits this.
- **D-129/D-130/D-131 are small and local** — `editor.ts` + `main.ts` DOM half + `.text-editor` CSS
  + one optional `formatFormula` param. Do NOT let this cycle grow into D-124's work.
- **D-131 touches `format.ts`, a core engine formatter.** The new `relativeToObjectId` is OPT-IN:
  every existing caller passes nothing and must be unaffected — pin that with a `format.test.ts`
  assertion. Ranges print both endpoints relative or neither (a mixed form does not re-parse).
- **D-125's IN-PLACE EDITOR IS A SURFACE OVER THE EXISTING SEAM.** `commitTextContent` /
  `commitTableCell` build a `Command` and call `runPanelCommand` → `executeCommand`. There is NO
  second write path. Do not add one for D-124.
- **`commitTextContent` NEVER sniffs for `=`** — the whole string is one literal `set` (D-125 clause
  3, D-122). `buildPanelSetCommand` is the WRONG helper for a `text` box. `buildCellCommand` is the
  Excel-style one for a cell.
- **The in-place editor is mounted in `#stage`** (`canvas.parentElement`), not `#panels` — `#panels`
  has delegated listeners with `preventDefault` that would break the input's caret.
- **`editorTargetAt` uses `hitTest`** — a `text` object with no drawn extent is not hittable, so the
  double-click path can't reach an empty box. D-124 hands the target in directly.
- **D-124 needs the new object's id** to open the editor on creation. `createText` /
  `createObjectFromCommand` do not return it today — decide how (a `CommandEffect`? a widened
  `CommandOutcome`?) and get it reviewed.
- **`measuredHeight` and `measuredWidth` ARE ONE MEASUREMENT (D-123 clause 2).**
- **A hand-built `text` fixture pushed through `mutate` needs THREE derived placeholders.**
- **D-123 clause 5 — the box follows the text; the text never follows the box.**
- **A DERIVED-SLOT ADDITION BREAKS SAVED DOCUMENTS UNTIL D-126 IS BUILT.** Entry 0143 added none.
- **DO NOT TRUST A RULING'S CLAIM ABOUT REACHABILITY — GREP FOR THE CALLER** (D-127's lesson).
- **`commitPanelEdit` / `runPanelCommand` (`main.ts`) is the seam** — a UI gesture synthesises a
  `Command` and runs `executeCommand`.
- **`main.ts`'s `pointerDownAt` already routes a canvas click to `respondToPrompt` when
  `state.pending` is set** — D-124 needs no new plumbing there, only a registry entry + the
  open-editor-on-create wiring.
- **`EvalContext` is threaded PER CALL, not on `AppState`.** The in-place commits take the trailing
  `context` param like every other transition.
- **`#MEASURE` is a real `ErrorCode`** (`graph/node.ts`), sixth after `#SCRIPT`.
- **The operator cannot see what you can see.** Entry 0143's editor WAS put on screen by the human
  at 0145 — that is how D-129/D-130/D-131 were found. The editor-polish cycle should ask for another
  live look before it reports done.
