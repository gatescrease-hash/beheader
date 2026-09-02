# STATUS — as of entry 0141-measured-width

**READ THIS FIRST — THE HUMAN RULED TWICE AT ENTRY 0140, AND IT IS THE NEXT WORK.**

- **D-125 — in-place text entry. ABSOLUTE PRIORITY, the human's word. NOT BUILT — build it next.**
  Text is typed INTO its receiver: a `text` object's `content` and a table cell, both edited by a DOM
  input overlaid on the canvas. `set text_1.content "…"` is fine for a machine and unusable for a
  person. It commits through the EXISTING `commitPanelEdit` → `runPanelCommand` → `executeCommand`
  seam — a new surface, never a second write path (Rule 2). **The trap: `buildPanelSetCommand` MUST
  NOT be reused for a `text` box** — it sends every non-numeric string to `set-formula`, which D-122
  refuses. `content` commits as a LITERAL always; a table cell commits Excel-style (`=` means formula).
- **D-124 — `text` is placed by POINTING**, like `circle`/`rect`/`table`: type `text`, then click.
  It gains a one-step `point` prompt sequence and NO content step — the pick completes the command
  and D-125's editor opens on the new box. Both typed forms keep working untouched.
- **Standing:** the human's direct instruction outranks `PROJECT_BRIEF.md`. *"If the brief conflicts
  with what I say, ignore the brief. I wrote it."* Never "correct" a ruling back toward the brief.

**0140's prerequisite is DONE.** `measuredWidth` (D-123) landed at entry 0141, so D-125's overlay can
be positioned from a box that is the real size of the text. Order from here: **D-125**, then **D-124**
(small once the editor exists), then markdown-lite, then `overflow`, then the Phase 5 gate.

---

## Where the code actually is — as of entry 0141

STATE: **GREEN** (compiles, all tests pass). Both configs compile, **1482/1482** tests pass,
0 skipped, 0 `.only`. **30 test files**. **PHASE 5 IS OPEN.**

Last review point: **0139-REVIEW-phase5** (ACCEPT WITH EDITS). Cycles since last review: **1/3**.
Diff since last review: **~429 lines added / 118 removed, 14 files** (cap 800/10 — **the FILE cap is
exceeded, so a review is due on that ground too**).

**ENTRY 0141 REPORTS `REVIEW: REQUIRED`** — §6.1 trigger 3 (a ruled extension of §5.6's derived-slot
list), §6.2 (`primitives/schema.ts` is load-bearing), and trigger 5 (a changed test expectation,
forced by the schema change).

**D-123 IS BUILT AND Q-024 IS FULLY RECONCILED (entry 0141).** `TEXT_SCHEMA` now has **THREE** derived
slots: `resolvedContent`, `measuredHeight`, `measuredWidth`. The last two are computed from ONE shared
private helper in `primitives/text.ts` — `measureTextBox` — which does all the reading, all the
failure checks, and the single `context.measurer.measure` call; each compute takes its own component
off the result. That is how D-123 clause 2 ("never one of the pair succeeding while the other fails")
holds by construction rather than by two hand-maintained ladders. `render/extent.ts`'s `textExtent`
reads `width` slot → `measuredWidth` → fallback, mirroring the height. **All three
`PROVISIONAL(Q-024)` tags are gone** (`extent.ts` ×2 in code, `hittest.ts` ×1 in a header).

**ONE DISCLOSED BEHAVIOUR CHANGE TO A REVIEWED FUNCTION, made under D-123 clause 2:**
`computeMeasuredHeight`'s non-finite guard now checks BOTH components, so a measurer returning
`{ width: NaN, height: 20 }` makes `measuredHeight` `#TYPE` where it previously returned `20`. The
alternative was `measuredWidth` erroring while `measuredHeight` reported a good number off the same
broken measurement, which clause 2 forbids. Pinned by test. **Reviewer: this is the one thing in
entry 0141 that is not purely additive.**

**TEXT DRAWS (entry 0138, reviewed 0139).** `renderer.ts`'s `drawText` lays `resolvedContent` out from
`origin` (top-left), wraps at a numeric `width` slot via the SAME `layOutLines` the measurer uses
(exported from `render/measure.ts`), and honours `style.font`/`fontSize`/`lineHeight`/`color`/`align`.
A `text` object is selectable, draggable (via `interaction.ts`'s existing per-component `origin` path
— UNCHANGED), and shows its chrome / a D-094 properties panel. **Markdown-lite rendering and
`overflow` clip/ellipsis are NOT built** — markup draws verbatim (as `measure.ts` still measures it),
every box is `overflow: "visible"`.

**THE `text` COMMAND EXISTS (entry 0136, reviewed 0137).** `text [x=<number>] [y=<number>]
"<content>"` — positional `content`, `x`/`y` optional defaulting to `0` per **D-121** clause 3. A
created `text` object carries eleven non-derived slots + **three** derived placeholders (filled
mechanically from the schema by `createObjectFromCommand`, so D-123 needed no change there).

**STILL UNBUILT IN PHASE 5:**
- **D-125's in-place editor** and **D-124's `text` prompt sequence** — the human's priority, next.
- **Markdown-lite rendering** (`**bold**`, `*italic*`, `` `code` ``, `# heading` 1–3, `- list`,
  paragraph breaks) — §5.6's exact list. `resolvedContent`'s markup currently draws verbatim.
  `render/measure.ts` must become markup-aware in the SAME cycle so drawn ≡ measured.
- **`overflow: "clip"` / `"ellipsis"`** — every `text` box draws `visible` today. Read **D-123 clause
  5** first: `overflow` is the ONLY mechanism allowed to reduce what is drawn, and never to make a
  stored measurement true.
- **The Phase 5 acceptance criterion / gate test** — its own cycle (§6.1 trigger 1).

**PHASE 4 IS PASSED AND ITS GATE IS CLOSED.** 0116-REVIEW closed the gate; 0119-REVIEW cleared
0117/0118. §6.2's block on starting a later phase was lifted there and has not been re-armed.

**Separately owed and unchanged: D-109 clauses 1–2** (cell decimals + clipping, `render/` only) ·
**Q-017** (table headers, the human's) · **D-108** (loader AST shape validation) · **D-104** (table
resize bounds).

---

## Read this first — what a cold reader needs

**0. `TEXT_SCHEMA` HAS ELEVEN NON-DERIVED + THREE DERIVED SLOTS (entry 0141).** Non-derived:
`origin.x`/`origin.y` (D-121, front of the list) + `content` + `width`/`height`/`overflow` + five
`style.*`. `content` + `width` + `style.font`/`fontSize`/`lineHeight` are **effectively-required**
(dangling-edge refusal if absent — 0129). Derived: `resolvedContent` (dynamic deps),
`measuredHeight` and `measuredWidth` (static deps, **the SAME list** — one measurement answers both).

**0a. THE TWO MEASURED SLOTS ARE ONE MEASUREMENT (D-123 clause 2).** `measureTextBox`
(`primitives/text.ts`, private) owns the read set, the failure ladder and the single `measure` call.
`computeMeasuredHeight`/`computeMeasuredWidth` are pass-throughs picking `.height`/`.width`. **Do not
split them, do not give either its own reads, and do not add a failure case to one alone.** Failure
order: upstream `ErrorValue` → `#MEASURE` (no real measurer, D-118) → `#TYPE` (unusable style) →
`#TYPE` (non-finite width OR height) → the box. `hasRealMeasurer(context)` (`eval-context.ts`) checks
the *measurer* is not `NULL_TEXT_MEASURER`.

**0b. `extent.ts`'s `text` box, both axes, since 0141:** the fixed slot when positive-finite → the
measurement (`measuredWidth`/`measuredHeight`) when positive-finite → a fixed fallback (240 / 20).
The fallback is reached ONLY when nothing could measure (`#MEASURE`, D-118 — a test, or `main.ts`
failing to get an offscreen context). `undefined` for a `text` object with no `resolvedContent`.
`hittest.ts`, the selection highlight, the chrome anchor and `fit` all read this ONE box
(D-066/D-010) — one wrong box is four wrong behaviours, which is why D-123 fixed one function.

**0c. A HAND-BUILT `text` FIXTURE NEEDS ALL THREE DERIVED PLACEHOLDERS.** D-018 refuses an object
missing one, so every test that pushes a hand-built `text` object through `mutate` carries
`measuredWidth: { kind: "derived", value: null }`. Six test files do (0141). A fixture that only goes
through `evaluate`/`objectExtent` does not need it.

**0d. `DEFAULT_TEXT_*` (`command/commands.ts`) are the handler's provisional pick** — `width`/`height`
`"auto"` (§5.6's "no wrapping" layout), `overflow` `"visible"`, font `"sans-serif"`, fontSize `16`,
lineHeight `20` (absolute, not a ratio — `render/measure.ts`), color `"black"`, align `"left"`. §5.6
gives no defaults; §5.10's grammar has no argument for any of them. Not `PROVISIONAL`-tagged (render
config, `set`-changeable, no open question covers them). **`DEFAULT_TEXT_WIDTH` being `"auto"` is why
`measuredWidth` is the normal path, not an edge case** — that is what tipped Q-024 to D-123.

**0e. THE MEASURER IS BUILT, WIRED, AND REVIEWED (0133).** `main.ts:start` builds `evalContext` from
`createCanvas2dTextMeasurer` over a SECOND offscreen 2D context (never the renderer's — `measure`
sets `ctx.font` per line) and threads it through `executeCommand` / `pointerMove` / `loadDocument` /
`deserializeDocument` and `main.ts`'s six pure transitions, all via an optional trailing `context`
param (default `NULL_EVAL_CONTEXT`). A `text` object created through the running app measures for
real; one created in a test with the default context reports `#MEASURE` on BOTH measured slots
(legitimate state, not a refusal).

**0f. `render/measure.ts` — line-breaking lives HERE (D-120), never in `src/engine/`.** Its
`MeasurementContext` type (`{ font: string; measureText(t): { width } }`) a real
`CanvasRenderingContext2D` satisfies with no cast. `layOutLines` splits on hard newlines, then
greedily word-wraps each line only when `maxWidth` is a positive finite number. A run of spaces is
collapsed for wrap fitting (Rule 5, within D-120's grant); a word wider than `maxWidth` overflows
alone. `measure().width` is the WIDEST laid-out line — that is what `measuredWidth` holds.

**0g. `content` IS `literal`-ONLY (D-122).** The guard is in `command/commands.ts`'s `buildSlot`, not
in the engine. `primitives/text.ts`'s `resolveTextDependencyAddresses` still reads `content`
`literal`-only at edge-derivation time regardless (Rule 6 timing), so a loaded `formula` `content`
slot commits with its inner references untracked — the disclosed loaded-file gap, mirroring D-046's.

**1. PHASE 4'S GATE TEST IS `main.test.ts`'s LAST-BUT-ONE `describe` OVER ONE DOCUMENT.** Seven
tests ("PHASE 4'S ACCEPTANCE CRITERION"). Do not weaken; do not fold. (0132 added a further
`describe` after it.)

**2. D-110's DISCLOSED CONSEQUENCE — `refs` HAS TWO FORMS (D-112).** `refs <cell>` reports the
CURRENT edge set; `refs <object>` derives its blocking half without the target. **Neither may be
"fixed" to match the other.**

**3. THE PANEL IS FULLY BUILT AND FULLY REVIEWED — DO NOT RE-BUILD ANY OF IT.** D-094/D-100/D-101/
D-106/D-102/D-107 all implemented and reviewed. **Q-014 is CLOSED in code.** A selected `text`
object's panel now lists three derived slots, mechanically (`props.ts` reads the schema).

**4. A panel-typed STRING reaches a FORMULA slot, never a literal one.** Correct per D-102 clause 6;
**Q-016** carries the grammar question.

**5. `main.ts`'s DOM half (`start`) IS UNTESTED BY CONSTRUCTION (D-001) AND KEEPS GROWING.** As of
0132 it also builds `evalContext` (incl. the offscreen-canvas `null` fallback) and passes it into
every DOM listener — checked by hand and by the pure-half tests, not by any assertion over `start`.
**D-125 clause 7 binds the next cycle here:** the in-place editor's commit logic goes in the exported
pure half, NOT in `start`'s closure.

**6. THE VANISHING-TABLE DEFECT IS FIXED (entry 0101) — D-097/D-098/D-099 are CLOSED.**

**7. D-104 IS OWED BY A CYCLE THAT HAS NOT BEEN SCHEDULED.** `insertTableLine`/`deleteTableLine` are
not bounded by `MIN`/`MAX_TABLE_LINES`. Not command-reachable today. Fix in `findInvalidTableResizes`.

**8. D-108 IS OWED BY §5.11's LOAD CYCLE, AND ITS CLAUSE 3 BINDS EVERY CYCLE BEFORE IT.**
`deserializeDocument`'s "never throws" is FALSE for a malformed loaded `ast`. **Do not "fix" it by
guarding a single walker.**

**9. D-081 AND D-083 CLAUSE 4 ARE BUILT (0112) AND REVIEWED (0113).**

**10. THE TEXT BLOCK TREE IS DERIVED STATE, RE-PARSED FROM `content` ON DEMAND, NEVER CACHED (D-114
clause 4).** Re-parsed in TWO places every mutation — `resolveTextDependencyAddresses`
(edge-derivation) and `computeResolvedContent` (evaluation). A broken span becomes an `error`-kind
`Block` (**D-115**); its parsed branches live in `orphaned`.

**11. THE PAPERCLIP CANNOT REACH A TABLE CELL.** Cell values must be TYPED today. **RULED D-125
(entry 0140, the human, ABSOLUTE PRIORITY): in-place cell editing IS built next**, together with
in-place editing of a `text` object's `content`. §5.4's formula bar stays unbuilt and is NOT part of
D-125.

**12. `evaluateDerivedSlot`'s `read` RUNS THE D-110 COERCION BEFORE THE D-013 MEMBERSHIP CHECK
(D-114 clause 3).** Do not swap them. `isEmptyInExtentCell` and `buildRangeReader` (`graph/eval.ts`)
are shared by `evaluateFormula` AND `evaluateDerivedSlot` (D-114 clause 2).

**13. `resolveTextDependencyAddresses` and `deriveEdges` Source 1 are a hand-maintained PAIR with no
compiler link (D-119).** Change one → change both, same cycle, log names both.

**14. A broken embedded span is marked `!` in place (D-116 parse / D-117 runtime), never blanks the
box; `evaluateBlockTree` always returns a `string`.**

**15. `EvalContext` IS THREADED PER CALL, NOT STORED (0132, reviewed 0133).**
`executeCommand(cmd, doc, context?)`, `pointerMove(..., context?)`, `loadDocument(json, context?)`,
`deserializeDocument(raw, context?)`, and `main.ts`'s six pure transitions all take an optional
trailing `context`. The internal `commands.ts` handlers and `main.ts`'s `advance`/`runPanelCommand`
take it as a REQUIRED param; only the public entry points default it to `NULL_EVAL_CONTEXT`.

**16. `TEXT_TYPE` (`graph/node.ts`) joins `TABLE_TYPE` (entry 0136).** Import it, never a bare
`"text"` literal in an equality check (D-009). `commands.ts`'s D-122 guard is the first user.

## Next slice (recommended)

**D-125 — in-place text entry. The human's ABSOLUTE PRIORITY, and its prerequisite is now built.**
A DOM input overlaid on the canvas at the receiver's world position (`worldToScreen`, like the
properties panel), for a `text` object's `content` and for a table cell. Commits by synthesising a
`Command` and running `executeCommand` — copy `commitPanelEdit`/`runPanelCommand`, do not invent a
write path (Rule 2, D-069, D-102 c5). **Do not reuse `buildPanelSetCommand` for a `text` box** (it
would produce `=Hello world`, which D-122 refuses): `content` is always a literal `set`; a table cell
is Excel-style, `=` meaning formula. Commit logic goes in `main.ts`'s exported pure half, not in
`start` (D-125 c7 — `start` is untested by construction). An empty text box must be visible and
clickable while its editor is open, via the editor's OWN overlay — do not loosen `extent.ts` to fake
it (c6). §6.1 trigger 2 (first file of a new subsystem) + trigger 3: report `REVIEW: REQUIRED`.
**The overlay is now positioned from a correct box** — an auto-width `text` object's extent is its
real measured ink since 0141.

**Then D-124 — `text` placed by pointing.** A `prompts` entry on `parser.ts`'s `text` spec: one
`point` step, no content step, `buildFromPrompts` producing the same `TextCommand` with `content`
`""`; then D-125's editor opens on the new object. `PromptStep.accepts` does NOT widen. Read
`prompt.ts`'s `usesNamedForm` hazard note first — it is what keeps `text "hi"` and
`text x=0 y=0 "hi"` working.

Then, in order: **markdown-lite rendering** — §5.6's exact list (`**bold**`, `*italic*`,
`` `code` ``, `# heading` 1–3, `- list item`, blank-line paragraph breaks), nothing more, in
`renderer.ts`'s `drawText`, and in the SAME cycle make `render/measure.ts` markup-aware (strip the
markers before measuring) so drawn and measured agree — D-120's framing allows it, and since 0141 a
markup-aware measurer moves the BOX as well as the height, which is the point. Then
`overflow: "clip"`/`"ellipsis"` (small — read **D-123 clause 5** first). Then the **Phase 5 gate**:
an executable test over one document proving the §6 criterion, `REVIEW: REQUIRED` (§6.1 trigger 1).

Cheap adds while in there: a direct `link text_1.origin.y <cell>` test (0137-REVIEW §honesty — 0136
tested the equivalent on `style.fontSize`).

**The render-only alternative, still needs no ruling:** **D-109 clauses 1–2** (cell decimal
precision + no cell-text clipping, `render/renderer.ts` only). **Q-017** headers remain the human's.

## Built and reviewed

Phase 0 (0027-REVIEW) · formula engine (0037) · table primitive through row/column insert/delete and
`delete <table> force` (0054) · `render/camera.ts` (0058) · `primitives/geometry.ts` (0060) ·
`render/renderer.ts`'s body/table drawing (0062, widened by 0093/0094/0107) · `render/hittest.ts`
(0064) · `render/interaction.ts` (0067, D-098 widening reviewed 0103) · `command/parser.ts` (0069) ·
`command/prompt.ts` (0071) · `command/commands.ts`'s seam + four creation handlers (0078) · four slot
commands + `engine/formula/format.ts` (0080) · `commands.ts`'s `delete`/`refs`/`list` (0082) ·
`mutation.ts`'s `RenameObjectOperation` + `commands.ts`'s `rename` (0084, D-081 widening reviewed
0113) · `CommandEffect` + five effect handlers (0086) · two formula depth limits (0088) · `main.ts`
rewritten, `render/camera.ts`'s clamps, `render/extent.ts`, `index.html` (0089, reviewed 0090/0091,
widened 0107/0109/0117) · entry 0093's selection highlight / error badge / formula-driven indicator +
D-092 clause 1's name label, 0094's chrome-anchor fix (0095) · `render/slots.ts` + `render/extent.ts`
split, `command/props.ts` + `props` command (0098, D-096) · `render/panel.ts` + panel DOM (0100) ·
selection-list widening (0105, D-105) · N panels, drag, dismiss, panel editing (0110-REVIEW) · F1–F4
+ D-107, D-081 + D-083 clause 4 (0113-REVIEW) · Phase 4 gate test (0116-REVIEW) · D-109 clause 3 +
D-110 in full (0119-REVIEW; D-112, D-113) · `primitives/text.ts` block-tree engine (0121-REVIEW;
D-114, D-115, Q-019) · D-116 data-shape + D-117 (rulings) · `src/engine/eval-context.ts` + `context`
threading through `mutate` (0125-REVIEW; D-118) · `!`-marked broken-span rendering + `text` schema
entry, `resolvedContent`, D-114's `evaluateDerivedSlot` widening (0128-REVIEW: ACCEPT WITH EDITS;
D-119) · `measuredHeight` + `#MEASURE` `ErrorCode` + `TextMeasurer.measure`'s `maxWidth` +
`hasRealMeasurer` (0130-REVIEW: ACCEPT WITH EDITS; F21 fixed; D-120 answers Q-021) ·
`render/measure.ts` (the Canvas2D `TextMeasurer`) + a real `EvalContext` threaded from `main.ts`
(0133-REVIEW: ACCEPT WITH EDITS; F22) · **0135-REVIEW: ACCEPT (no code)** — entry 0134's
`text`-command escalation cleared; **D-121** (Q-022) and **D-122** (Q-023/F13) issued ·
**0137-REVIEW: ACCEPT WITH EDITS** — entry 0136's `text` command + D-121/D-122 reconciliation
cleared; 4 stale test comments fixed; no new ruling. **Q-022 and Q-023 are now fully closed.** ·
**0139-REVIEW: ACCEPT WITH EDITS** — entry 0138's text rendering (`renderer.ts` `drawText` + `text`
cases in `drawObject`/`drawSelectionHighlight`; `extent.ts` `textExtent`; `hittest.ts`
`hitTestBoundingBox`; `measure.ts` exporting `layOutLines`/`cssFont`) cleared; two header/doc
qualifications edited in; **D-123** issued, answering **Q-024**.

## Built this batch, not yet reviewed

**Entry 0141 — D-123's `measuredWidth`.** `primitives/text.ts`'s `measureTextBox` +
`computeMeasuredWidth` + `TEXT_MEASURED_WIDTH_PATH`; `primitives/schema.ts`'s third `TEXT_SCHEMA`
derived slot; `render/extent.ts`'s `textExtent` reading `measuredWidth`; the `PROVISIONAL(Q-024)`
tags removed from `extent.ts` and `hittest.ts`; doc corrections in `graph/node.ts` and
`command/commands.ts`; six test files' `text` fixtures gaining the third derived placeholder; 13 new
tests. **The one non-additive change: `computeMeasuredHeight` now `#TYPE`s on a non-finite WIDTH too**
(D-123 clause 2 — the pair must fail together).

## Not started

D-090's prompt-sequence preview · §5.9's per-vertex drag path ·
`polyline`/`explode`/`addvertex`/`delvertex` · `style` slots as authorable · point-in-polygon fill
hit-testing (D-067) · §5.4's formula bar (in-place cell editing is now **D-125**, next) ·
**D-125's in-place editor + D-124's `text` prompt sequence** · D-088 clauses 2–4 · D-089 · D-102
clause 9 · **D-109 clauses 1–2** · markdown-lite text rendering + a markup-aware measurer · `text`
`overflow` clip/ellipsis · the Phase 5 gate test · Phases 6–7.

## Open fix list — read 0090-REVIEW §9, 0091-REVIEW §5 and 0100-REVIEW §9 for the full text

Numbering follows 0090-REVIEW §9. Items 2–13, 15–21, 23–24 unchanged and open unless noted.

1. **DONE at entry 0112**, reviewed 0113.
2. **Give the missing-slot refusal a remedy.** Message only; narrowed by D-110 to D-110 clause 6's cases.
3. **`findDanglingReferences` names one dependent once per MISSING SOURCE.**
4. **`zoom`'s refusal names `Infinity`.** Message only.
5. **Carried from 0074-REVIEW §9, all six unchanged.**
6. **A middle-drag pan started outside the canvas is untested.** Owned by D-088's cycle.
7. **`TABLE_GRID_STROKE_STYLE` has no comment** (D-091). Owned by the `style`-slots cycle.
8. **The screen-space chrome constants + `PANEL_OBJECT_GAP_CSS` are untuned** (Rule 5).
9. **The chrome pass leaves `ctx.font`/`textAlign`/`textBaseline` set on return.** Harmless.
10. **The formula-driven indicator's narrowness (`origin.x`/`origin.y` only) should be RE-DECIDED.**
11. **A display-only panel's `overflow: auto` scroll resets on every paint.**
12. **A right-flipped panel that hits the right clamp overlaps its own object.** Correct per D-094 c11.
13. **`insertTableLine`/`deleteTableLine` are not bounded by `MIN`/`MAX_TABLE_LINES`** — **D-104**.
14. **0110-REVIEW's F1–F4 — BUILT (0111), REVIEWED (0113).** Closed. **Q-016** carries F3's tail.
15. **F5 (0113-REVIEW) — `deserializeDocument`'s "never throws" is FALSE for a malformed loaded
    `ast`.** Ruled **D-108**; clause 3 forbids hardening any single walker meanwhile.
16. **F6 (0113-REVIEW) — a panel row's text can no longer be mouse-selected.** D-095 governs.
17. **F7/F8 (0114-REVIEW) — ruled D-109. F8 BUILT (0117), REVIEWED (0119); F7 (clauses 1–2) NOT
    BUILT.** Cell number precision + no cell-text clipping, both in `render/renderer.ts`.
18. **F9 (0116-REVIEW) — CLOSED in the same review.**
19. **F10 (0119-REVIEW) — CLOSED, ruled D-112.**
20. **F11 (0119-REVIEW) — open, no owner.** Shrinking a table's extent under a formula reading an
    empty in-extent cell is REFUSED. Correct per D-110 clause 6.
21. **F12 (0119-REVIEW) — open, DO NOT RE-LITIGATE.** `MIN(B1, B2)` vs `MIN(B1:B2)` on empty
    in-extent cells; compliant per D-110 clause 3.
22. **F13 (0127) — RULED D-122 (0135-REVIEW), BUILT (0136), REVIEWED (0137). CLOSED.**
23. **F21 (0130-REVIEW) — CLOSED in the same review**, and WIDENED at 0141: the non-finite guard now
    covers the measured WIDTH as well as the height (D-123 clause 2).
24. **F22 (0133-REVIEW) — CLOSED in the same review.** `render/measure.ts`'s `WHAT THIS IS` trim.

## Known problems (detail lives where the pointer says)

- **A raw `setSlot` LOWERING `rows`/`cols` still strands any now-out-of-bounds cell slot** —
  `primitives/table.ts`'s header.
- **A loaded document can carry a `formula`/`derived` `content` slot on a `text` object** — the
  `text` command refuses to create one (D-122), but the loader has no such guard, and
  `resolveTextDependencyAddresses` reads `content` `literal`-only, so its embedded references go
  untracked. Exactly D-046's loaded-file posture for `rows`/`cols`. Disclosed in `primitives/text.ts`.
- **BOTH measured slots are `#MEASURE` for a `text` object created in a test** (default
  `NULL_EVAL_CONTEXT`), so its extent falls back to 240×20 there. Through the running app `main.ts`
  threads a real measurer (0132), so a command-created `text` object measures for real. D-118 working
  as ruled.
- **`measure.ts` and `renderer.ts` fall back DIFFERENTLY for an unusable `style.*` slot, and since
  0141 that also moves the BOX's width.** The measurer takes an unusable `lineHeight` as `fontSize`
  and returns a ZERO box for an unusable `fontSize`; `resolveTextStyle` substitutes
  `DEFAULT_TEXT_LINE_HEIGHT` (20) / `DEFAULT_TEXT_FONT_SIZE` (16) and draws anyway. So for a LOADED
  document carrying a `#TYPE` style on a multi-line `text` object, `measuredWidth`/`measuredHeight`
  are both `0`, the extent falls back to 240×20, and the ink is N real lines. Disclosed in both
  headers (0139-REVIEW edits); unfixed — one shared set of fallbacks needs a ruling on which file
  owns them. **D-123 clause 5 forbids fixing it from the renderer's side.**
- **`extent.ts`'s `text` box trusts the stored measurement; `renderer.ts` re-wraps with its own
  `ctx`.** If the two wrap loops ever diverge (same font, same browser — they should not), the box
  lags the drawn ink. **0139-REVIEW ruled this stays as it is** (D-123 clause 5): the box follows the
  text, never the reverse.
- **An empty-`content` `text` object is invisible AND unselectable** — no ink, no extent, so no hit
  box, no chrome, no name label, no panel. `text 0 0 ""` and `set text_1.content ""` both reach it.
  Correct per D-066. **This is load-bearing for the NEXT cycle:** D-124 creates exactly this object
  and hands it to D-125's editor. **D-125 clause 6 rules the fix — the EDITOR's own overlay draws the
  box and caret; `extent.ts` is NOT loosened to give empty text a degenerate extent.**
- **`x`/`y` are OPTIONAL for the `text` command (default `0`, per D-121 clause 3)** but REQUIRED for
  `circle`/`polygon`/`rect`/`table`. A visible inconsistency across the creation commands;
  **0137-REVIEW confirmed it is intended.** Do not revisit absent a human ruling. (D-124 makes the
  pointing path the normal one, which is the real answer.)
- **`DEFAULT_TEXT_*` style values (`command/commands.ts`) are the handler's provisional pick** — no
  ruling, no `PROVISIONAL` tag (render config, `set`-changeable).
- **`resolveTextDependencyAddresses` and `deriveEdges` Source 1 are a hand-maintained PAIR (D-119).**
  (The `measuredHeight`/`measuredWidth` pair is NOT one of these — 0141 gave them a single shared
  helper precisely so the compiler enforces their agreement.)
- **`main.ts`'s `start` is untested code and keeps growing.** Verified live, not by assertion.
- **The properties panel positions an off-screen selected object's panel clamped to a canvas edge.**
- **The chrome layout is UNSEEN beyond entry 0094's anchor fix.** **D-095** / D-101 clause 3.
- **A prompt sequence still shows nothing where you clicked** — ruled **D-090**, queued.
- **The formula-driven indicator is read NARROWLY** — `origin.x`/`origin.y` only.
- **A printable keystroke does not reach the command input unless it is focused** — D-088 clauses
  2–4 not built. **No command history** (**D-089**, queued).
- **Every pointer move repaints the canvas and rewrites the whole log's `textContent`.** Rule 5.
- **`escape` is bound to the window.** Innermost-first order is STRUCTURAL.
- **`zoom`'s echoed line names the REQUEST; `main.ts` adds a second line with the RESULT** — D-082 c5.
- **`format.ts`'s elision does not re-parse** — a disclosed round-trip exception.
- **A `delete` refusal can name the same dependent twice** — fix-list item 3.
- **`refs` names a range's START cell as the source** when the range's table is being removed.
- **Two sites ask the schema whether it declares a path** — `declaresSlotPath` and
  `resolveWritableSlot`'s inline check. A THIRD is forbidden.
- **`refs <address>` REFUSES for a cell of a table whose `rows` is a formula** (D-046) — unreachable
  by command (D-097), reachable via a loaded file.
- **SETTLED at 0118, REVIEWED 0119 — do not re-raise.** A bare reference to an EMPTY in-extent cell
  reads `0`, gets no edge (**D-110**). Since 0127 the same coercion applies to an embedded `{= }` in
  a `text` object (D-114).
- **`text.test.ts`'s `expectError` helper is unused** — kept deliberately.
- **`render/measure.ts` measures markdown markup verbatim AND `renderer.ts` draws it verbatim**
  (`**bold**`/`# heading` shown as typed) — deliberately consistent for now. The markdown-lite
  cycle moves both: strip the markers before measuring, render them as formatting. §5.6's exact
  list only. Flagged in `measure.ts` and `renderer.ts`.
- **Seven §5.10 commands have no registry entry** — `polyline`/`script`/`image`/`explode`/
  `addvertex`/`delvertex` wait on a schema or an `Operation` kind; **`pan` waits on Q-012**.
- **`createObjectFromCommand`'s "type has no schema" branch is uncovered**, as are
  `describeSlotValue`'s `Point`/`Point[]` arms.
- **A 1000×1000 table is legal and costs ~1.5 s per MUTATION.** Rule 5's accepted trade (D-077 c3).
- **`renderer.ts`'s `formatCellValue`, `props.ts`'s `describeSlotValue`, and `mutation.ts`'s
  `describeDimensionSlotValue` are three separate `Value`-to-text formatters** — deliberate.
- **`primitives/text.ts` imports `primitives/table.ts`** and `import type`s `DerivedSlotComputeDeps`
  from `primitives/schema.ts`. It also imports `hasRealMeasurer` + `TextStyle` from
  `eval-context.ts` (a leaf — no cycle). `text.ts` CANNOT import `mutation.ts` (D-119).
- **Carried unchanged, each with its pointer:** `set-formula` is a `kind` not a registry name ·
  comment debt in TEST files only · mixed line endings in the WORKING TREE only (`core.autocrlf=true`)
  · dangling-reference messages name the DEPENDENT not the missing SOURCE · D-022's bounded-correctness
  claim fails for `table` · `describeValueType` duplicated in `functions.ts`/`eval.ts` ·
  `rewrite`/`repairObjectFormulaAddresses` walk `formula` slots only · journal structure unvalidated
  beyond `Array.isArray` · `lexer.ts`'s two edge cases · §5.11's `style` field · `noUnusedLocals` off
  · `.gitattributes` still owed.

## Settled — do not re-raise

Every ruling in `DECISIONS.md` (D-001 through **D-125**) binds without restatement here.

**D-114 / D-115 / D-116 / D-117 ARE BUILT IN FULL AND REVIEWED (0126/0127, cleared 0128).**

**D-118 — BUILT (0129), REVIEWED (0130), WIRED (0132), WIRING REVIEWED (0133).**

**D-119 (0128-REVIEW) — RULED, RECONCILED.** The `resolveTextDependencyAddresses` / `deriveEdges`
Source 1 pair; change one → change both; a third consumer forces extraction.

**D-120 (0130-REVIEW) — RULED, answers Q-021. RECONCILED (0131), BUILT (0131), WIRED (0132), reviewed
0133.**

**D-121 (0135-REVIEW) — RULED, answers Q-022. RECONCILED + BUILT (0136), REVIEWED (0137).** A `text`
object's position is `origin.x` / `origin.y`, two `literal` slots on `TEXT_SCHEMA`, same spelling as
the geometry presets. Not dependency-required. Front-of-list placement confirmed at 0137-REVIEW.

**D-122 (0135-REVIEW) — RULED, answers Q-023 / F13. BUILT (0136), REVIEWED (0137).** `content` is
`literal`-only; `link` / `set =` refused in `command/commands.ts`'s `buildSlot`, à la D-046.

**D-123 (0139-REVIEW) — RULED, answers Q-024. BUILT (entry 0141), NOT YET REVIEWED.** `TEXT_SCHEMA`
has a third derived slot `measuredWidth` from the same `measure` call as `measuredHeight` (clauses
1–2, delivered by one shared `measureTextBox` helper); `extent.ts` reads `width` slot →
`measuredWidth` → fallback (clause 3); it is a deliberate extension of §5.6's derived-slot list on
D-121's footing (clause 4). **Clause 5 binds every render cycle:** the box follows the text, the text
NEVER follows the box — `renderer.ts` may not clip, pad, or truncate its line count to match a stored
measurement; only §5.6's `overflow` slot may reduce what is drawn.

**D-124 (0140-RULINGS) — RULED BY THE HUMAN. NOT BUILT.** `text` is placed by pointing: a one-step
`point` prompt sequence on `parser.ts`'s `text` entry, no content step, `PromptStep.accepts`
unwidened. Clause 5 generalises it — EVERY creation command arrives with a `prompts` entry.

**D-125 (0140-RULINGS) — RULED BY THE HUMAN, ABSOLUTE PRIORITY. NOT BUILT — NEXT.** In-place text
entry for a `text` object's `content` and for a table cell, through the existing `commitPanelEdit` →
`executeCommand` seam. Clause 3 is the trap (`content` literal ALWAYS, no `buildPanelSetCommand`
reuse; a cell is Excel-style). Clause 6 (the editor's own overlay makes an empty box visible) and
clause 7 (commit logic in the exported pure half) are the two a cycle is most likely to skip.
Clauses 4–5 are reviewer-chosen defaults the human may overrule on sight.

**THE HUMAN'S DIRECT INSTRUCTION OUTRANKS `PROJECT_BRIEF.md` (0140).** *"If the brief conflicts with
what I say, ignore the brief. I wrote it."* No cycle may "correct" a ruling back toward the brief.

**Implemented AND reviewed, do not re-build:** D-097/D-098/D-099 · D-100 · D-101/D-106/D-102 · D-107 ·
D-081 + D-083 c4 · Phase 4's gate test · D-109 clause 3 · D-110 in full · D-114/D-115/D-116/D-117 ·
D-118 (guard + wiring) · D-120 (`render/measure.ts` + threading) · D-121 / D-122 + the `text`
command (0137-REVIEW) · text rendering + the text bounding box (0139-REVIEW).

**Implemented, awaiting review:** **D-123** (entry 0141).

**NOT implemented, each owned by a named future cycle:** **D-125** (in-place text entry — the
human's ABSOLUTE PRIORITY, NEXT) · **D-124** (`text` placed by pointing) · **D-104** (§5.10's
row/column commands) · **D-108** (§5.11's load path; clause 3 binds every cycle before it) ·
**D-109 clauses 1–2** (cell decimals + clipping, `render/` only).

**Q-014 and Q-018 are CLOSED.** **Q-013 is NOT mooted.** **Q-016 and Q-017 remain OPEN**, both the
human's, neither blocking. **Q-019 → D-116**, **Q-020 → D-117** — BUILT and REVIEWED (0128).
**Q-021 → D-120** — BUILT + WIRED + REVIEWED (0133). **Q-022 → D-121**, **Q-023 → D-122** — RULED
(0135-REVIEW), BUILT (0136), REVIEWED (0137) — CLOSED. **Q-024 → D-123** (0139-REVIEW) — RULED option
(b), BUILT (0141), all tags removed — CLOSED pending review. Next free: **Q-025**.

**D-046 STANDS AND DOES NOT MOVE.** A dimension slot is read `literal`-only and fails closed to `0`.
`content` (0127/0122/0136) inherits the same posture.

**D-094's fourteen clauses stand** · **D-096's four clauses stand** (0129's `TEXT_*_PATH` move is a
named divergence).

**From 0091-REVIEW:** **D-088** (clause 1 built, 2–4 queued) · **D-089** (queued) · **D-090**
(queued) · **D-091**. **From 0090-REVIEW:** D-084–D-087 implemented. Still owed, unchanged: **D-074**.

## Live PROVISIONAL tags and open questions

**`PROVISIONAL(Q-012)` → `src/render/renderer.ts`** and **`src/render/slots.ts`**: world units or
screen pixels for stroke width / cell size / font? Provisional (a) world units. Due with the
`style`-slots cycle.

**`PROVISIONAL(Q-008)` → `src/engine/graph/node.ts`** (`-0`): open, deferred, blocking nothing.

**`PROVISIONAL(Q-024)` — GONE (entry 0141).** All three sites removed: `render/extent.ts` ×2 (in
code) and `render/hittest.ts` ×1 (in its NOT DONE HERE header — the one a narrow grep of `extent.ts`
alone would have missed). `TEXT_AUTO_BOX_WIDTH`/`_HEIGHT` survive as ordinary documented constants
for the no-measurer case only.

**No other `PROVISIONAL` tags exist.** Q-016/Q-017 have none; neither do Q-022/Q-023/Q-024.

## Gotchas for the next model

- **THE HUMAN RULED AT ENTRY 0140 — read the header block before anything else.** D-125 (in-place
  text entry) is ABSOLUTE PRIORITY and is the NEXT slice; D-124 rides with it. Neither is built.
  **0140's stated prerequisite (D-123) is now done**, so there is nothing in front of D-125.
- **THE BATCH IS NOT EMPTY.** Entry 0141 is unreviewed and reports `REVIEW: REQUIRED` (§6.2
  load-bearing + trigger 3 + trigger 5), and the 14-file diff already exceeds §6.3's 10-file cap.
  A review should land before more work — check with the human rather than assuming.
- **`measuredHeight` and `measuredWidth` ARE ONE MEASUREMENT (D-123 clause 2).** Both go through
  `measureTextBox` in `primitives/text.ts`. Do not split them, do not add a check to one alone.
  Entry 0141's one non-additive change: a non-finite WIDTH now `#TYPE`s `measuredHeight` too.
- **A hand-built `text` fixture pushed through `mutate` needs THREE derived placeholders.** Forget
  `measuredWidth` and D-018 refuses the object with a clear message — that is the check working,
  not a bug.
- **D-123 clause 5 — the box follows the text; the text never follows the box.** Do not "fix" a
  drawn-vs-measured disagreement by drawing fewer lines. `overflow` is the only lever.
- **`commitPanelEdit` / `runPanelCommand` (`main.ts`) is the seam D-125 copies** — a UI gesture
  synthesises a `Command` and runs `executeCommand`. There is no second write path (Rule 2).
- **`main.ts`'s `pointerDownAt` already routes a canvas click to `respondToPrompt` when
  `state.pending` is set** — D-124 needs no new plumbing, only a registry entry.
- **A `text` object drags via `interaction.ts`'s existing `origin` path — no `text`-specific code.**
- **`content` cannot be `link`ed or `set =`'d (D-122).** The guard is `isTextContentTarget` in
  `command/commands.ts`'s `buildSlot`, fired before `parseFormula`. Engine has no such guard — a
  loaded file can still carry one.
- **`TEXT_TYPE` (`graph/node.ts`) — import it, never a bare `"text"` literal (D-009).**
- **`grep` for `ORIGIN_X_PATH` in `schema.ts` before touching the `text` entry;** `origin.x`/`origin.y`
  are NOT `primitives/text.ts`'s `TEXT_*_PATH` constants — they reuse `geometry.ts`'s.
- **`EvalContext` is threaded PER CALL, not on `AppState`.** Public entry points default it to
  `NULL_EVAL_CONTEXT`; internal handlers take it REQUIRED.
- **`main.ts` builds a SECOND offscreen 2D context for measurement** — never the renderer's.
- **The block tree is parsed in TWO places every mutation** and must NOT be cached (D-114 clause 4).
- **`#MEASURE` is a real `ErrorCode`** (`graph/node.ts`), sixth after `#SCRIPT`. Produced only by the
  two measured slots, never serialized.
- **The operator cannot see what you can see.** A text box that silently renders empty, zero-height,
  or inside a wrong-sized click box is the injury D-116, D-118 and D-123 are each ruled against.
