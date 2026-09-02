# STATUS — as of entry 0138-text-render

STATE: **GREEN** (compiles, all tests pass). Both configs compile, **1466/1466** tests pass,
0 skipped, 0 `.only`. **30 test files**. **PHASE 5 IS OPEN.**

**REVIEW IS DUE — do not start the next slice.** Entry 0138 fired **§6.1 trigger 5** (`hittest.test.ts`'s
"never hits" type loop dropped `text`; `interaction.test.ts`'s `textObject()` fixture changed — both
because `text` became hittable, no assertion weakened) and **trigger 3** (brief silent on the
auto-width text bounding box → **Q-024**, taken as a reversible tagged provisional per §7, not a
cycle stop). Last review point: **0137-REVIEW-phase5** (ACCEPT WITH EDITS). Cycles since last review:
**1/3**. Diff since last review: **~330 source lines / 4 source files** (cap 800/10).

**TEXT DRAWS NOW (entry 0138).** `renderer.ts`'s `drawText` lays `resolvedContent` out from `origin`
(top-left), wraps at a numeric `width` slot via the SAME `layOutLines` the measurer uses (exported
from `render/measure.ts`), and honours `style.font`/`fontSize`/`lineHeight`/`color`/`align`.
`extent.ts`'s `objectExtent` has a `text` case (origin + width + `measuredHeight`); `hittest.ts`
reads that box (§5.9's "bounding box for text"). A `text` object is now selectable, draggable (via
`interaction.ts`'s existing per-component `origin` path — UNCHANGED), and shows its chrome / a D-094
properties panel. **Markdown-lite rendering and `overflow` clip/ellipsis are NOT built** — markup
draws verbatim (as `measure.ts` still measures it), every box is `overflow: "visible"`. That plus
the gate test are the remaining Phase 5 work.

**Last review point: 0137-REVIEW-phase5** (ACCEPT WITH EDITS). The `text` command + D-121 + D-122
are all reviewed and closed.

**THE `text` COMMAND IS BUILT (entry 0136).** `command/parser.ts` has a `text` registry entry
(`text [x=<number>] [y=<number>] "<content>"` — positional `content`, `x`/`y` optional defaulting to
`0` per **D-121** clause 3), `command/commands.ts` has the `createText` handler, and `text` has left
`COMMANDS_SPECIFIED_BUT_NOT_BUILT`. A created `text` object carries all **eleven** non-derived slots
+ both derived placeholders; `resolvedContent` evaluates inside the creating mutation, `measuredHeight`
is `#MEASURE` under the default `NULL_EVAL_CONTEXT` (**D-118**) and a real height once `main.ts`
threads a measurer (already wired for `executeCommand`, entry 0132).

**D-121 IS RECONCILED IN CODE (entry 0136).** `TEXT_SCHEMA.nonDerivedSlotPaths` now leads with
`ORIGIN_X_PATH` / `ORIGIN_Y_PATH` (imported from `primitives/geometry.ts` — one spelling, no new
constant). Both are ordinary `literal` slots, **NOT dependency-required** (nothing derived reads
them; an absent one is tolerated by `findSchemaSlotKindMismatches`). The `text` command always
creates them; `x=` / `y=` write them. `schema.test.ts`'s `text` expectation moved with it
(non-derived count 9 → **11**; the "5 effectively-required" set is unchanged — origin is not
required). No `PROVISIONAL` tag — cite `(D-121)`.

**D-122 IS RECONCILED IN CODE (entry 0136).** `command/commands.ts`'s `buildSlot` refuses `link
text_1.content …` and `set text_1.content = …` — the guard (`isTextContentTarget`, type + path)
fires at the top of the `formula` arm, before `parseFormula` runs. `content` is permanently
`literal`-kind. A plain literal `set text_1.content "…"` is unaffected. `primitives/text.ts`'s NOT
DONE HERE note and `resolveTextDependencyAddresses`'s doc were updated: the old **F13**
untracked-reference gap is now CLOSED by a refusal (a loaded document could still carry a `formula`
`content` slot, exactly as it can a `formula` `rows` slot under D-046). No `PROVISIONAL` tag — cite
`(D-122)`.

**STILL UNBUILT IN PHASE 5:**
- **Markdown-lite rendering** (`**bold**`, `*italic*`, `` `code` ``, `# heading` 1–3, `- list`,
  paragraph breaks) — §5.6's exact list. `resolvedContent`'s markup currently draws verbatim.
  `render/measure.ts` must become markup-aware in the same cycle so drawn ≡ measured.
- **`overflow: "clip"` / `"ellipsis"`** — every `text` box draws `visible` today.
- **The Phase 5 acceptance criterion / gate test** — its own cycle (§6.1 trigger 1). Reactivity is
  done engine-side; text draws and wraps; the gate needs markdown-lite + the executable test.

**PHASE 4 IS PASSED AND ITS GATE IS CLOSED.** 0116-REVIEW closed the gate; 0119-REVIEW cleared
0117/0118. §6.2's block on starting a later phase was lifted there and has not been re-armed.

**Separately owed and unchanged: D-109 clauses 1–2** (cell decimals + clipping, `render/` only) ·
**Q-017** (table headers, the human's) · **D-108** (loader AST shape validation) · **D-104** (table
resize bounds).

---

## Read this first — what a cold reader needs

**0. THE `text` COMMAND EXISTS NOW (entry 0136).** Every `text`-object test no longer needs a
hand-built fixture, though several keep one deliberately (`mutation.test.ts`, `eval.test.ts`,
`commands.test.ts`'s EvalContext-threading block — its comment says why). `createText` supplies
eleven literal slots (`origin.x`/`origin.y` from the command, `content` verbatim, eight
`DEFAULT_TEXT_*` constants); `createObjectFromCommand` fills both derived placeholders.

**0a. `DEFAULT_TEXT_*` (`command/commands.ts`) are the handler's provisional pick** — `width`/`height`
`"auto"` (§5.6's "no wrapping" layout), `overflow` `"visible"`, font `"sans-serif"`, fontSize `16`,
lineHeight `20` (absolute, not a ratio — `render/measure.ts`), color `"black"`, align `"left"`. §5.6
gives no defaults; §5.10's grammar has no argument for any of them. Not `PROVISIONAL`-tagged (render
config, `set`-changeable, no open question covers them).

**0b. THE MEASURER IS BUILT, WIRED, AND REVIEWED (0133).** `main.ts:start` builds `evalContext` from
`createCanvas2dTextMeasurer` over a SECOND offscreen 2D context (never the renderer's — `measure`
sets `ctx.font` per line) and threads it through `executeCommand` / `pointerMove` / `loadDocument` /
`deserializeDocument` and `main.ts`'s six pure transitions, all via an optional trailing `context`
param (default `NULL_EVAL_CONTEXT`). A `text` object created through the running app therefore
measures for real; one created in a test with the default context reports `#MEASURE` (legitimate
state, not a refusal).

**0c. `render/measure.ts` — line-breaking lives HERE (D-120), never in `src/engine/`.** Its
`MeasurementContext` type (`{ font: string; measureText(t): { width } }`) a real
`CanvasRenderingContext2D` satisfies with no cast. `layOutLines` splits on hard newlines, then
greedily word-wraps each line only when `maxWidth` is a positive finite number. A run of spaces is
collapsed for wrap fitting (Rule 5, within D-120's grant); a word wider than `maxWidth` overflows
alone.

**0d. `TEXT_SCHEMA` HAS ELEVEN NON-DERIVED + TWO DERIVED SLOTS (entry 0136).** `origin.x`/`origin.y`
(D-121, front of the list) + `content` + `width`/`height`/`overflow` + five `style.*`. `content` +
`width` + `style.font`/`fontSize`/`lineHeight` are **effectively-required** (dangling-edge refusal if
absent — 0129). `origin.x`/`origin.y`/`height`/`overflow`/`style.color`/`style.align` are optional.
The derived slots: `resolvedContent` (dynamic deps) and `measuredHeight` (static deps).

**0e. `computeMeasuredHeight`'s failure order** — upstream `ErrorValue` → `#MEASURE` → `#TYPE`
(unusable style) → `#TYPE` (non-finite height, F21) → the height. `hasRealMeasurer(context)`
(`eval-context.ts`) checks the *measurer* is not `NULL_TEXT_MEASURER`.

**0f. `content` IS `literal`-ONLY (D-122).** The guard is in `command/commands.ts`'s `buildSlot`, not
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
D-106/D-102/D-107 all implemented and reviewed. **Q-014 is CLOSED in code.**

**4. A panel-typed STRING reaches a FORMULA slot, never a literal one.** Correct per D-102 clause 6;
**Q-016** carries the grammar question.

**5. `main.ts`'s DOM half (`start`) IS UNTESTED BY CONSTRUCTION (D-001) AND KEEPS GROWING.** As of
0132 it also builds `evalContext` (incl. the offscreen-canvas `null` fallback) and passes it into
every DOM listener — checked by hand and by the pure-half tests, not by any assertion over `start`.

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

**11. THE PAPERCLIP CANNOT REACH A TABLE CELL.** Cell values must be TYPED. §5.4's formula bar /
in-place cell editing is NOT built.

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

**17. TEXT DRAWS AND IS HITTABLE (entry 0138).** `renderer.ts` `drawText` (verbatim markup, wrap at
numeric `width`, `style.*`), `extent.ts` `textExtent`, `hittest.ts` bounding box. Drag/select/panel
all fall out of the extent + `interaction.ts`'s existing `origin` path. `render/measure.ts` now
exports `layOutLines`/`cssFont` — the renderer shares them so drawn ≡ measured (D-010). Markdown-lite
formatting, `overflow` clip/ellipsis, and the gate are the remaining Phase 5 work. `PROVISIONAL(Q-024)`
covers the auto-width bounding box.

## Next slice (recommended)

**AFTER the 0138 review clears:** **markdown-lite rendering** — §5.6's exact list (`**bold**`,
`*italic*`, `` `code` ``, `# heading` 1–3, `- list item`, blank-line paragraph breaks), nothing
more, in `renderer.ts`'s `drawText`. In the SAME cycle make `render/measure.ts` markup-aware (strip
the markers before measuring) so the drawn text and `measuredHeight` agree — D-120's framing allows
it. Then `overflow: "clip"`/`"ellipsis"` (small), then the **Phase 5 gate**: an executable test over
one document proving the §6 criterion, reported `REVIEW: REQUIRED` (§6.1 trigger 1).

Cheap adds while in there: a direct `link text_1.origin.y <cell>` test (0137-REVIEW §honesty — 0136
tested the equivalent on `style.fontSize`); reconcile `PROVISIONAL(Q-024)` if the reviewer rules it.

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
cleared; 4 stale test comments fixed; no new ruling. **Q-022 and Q-023 are now fully closed.**

## Built this batch, not yet reviewed

- **Entry 0138 — text rendering.** `renderer.ts` `drawText` + `text` cases in `drawObject` /
  `drawSelectionHighlight`; `extent.ts` `textExtent` (+ `PROVISIONAL(Q-024)` fallback box);
  `hittest.ts` `hitTestBoundingBox` for `text`; `measure.ts` exports `layOutLines` / `cssFont`.
  `interaction.ts` UNCHANGED (text drag falls out of the existing `origin` path). Tests +23. No
  §6.2 load-bearing file touched. Markdown-lite / `overflow` clip+ellipsis / the gate are NOT in
  this batch.

## Not started

D-090's prompt-sequence preview · §5.9's per-vertex drag path ·
`polyline`/`explode`/`addvertex`/`delvertex` · `style` slots as authorable · point-in-polygon fill
hit-testing (D-067) · §5.4's formula bar / in-place cell editing · D-088 clauses 2–4 · D-089 · D-102
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
22. **F13 (0127) — RULED D-122 (0135-REVIEW), BUILT (0136), REVIEWED (0137). CLOSED.** `command/commands.ts`'s
    `buildSlot` refuses `link` / `set =` on a `text` object's `content` slot, citing D-122 (no
    `PROVISIONAL` tag). A MISSING `content` slot still REFUSES the object (F20/0128). A loaded
    document could still carry a `formula` `content` slot — its inner references go untracked, as a
    loaded `formula` `rows` slot's do under D-046; disclosed in `primitives/text.ts`.
23. **F21 (0130-REVIEW) — CLOSED in the same review.** `computeMeasuredHeight`'s non-finite →
    `#TYPE` guard.
24. **F22 (0133-REVIEW) — CLOSED in the same review.** `render/measure.ts`'s `WHAT THIS IS` trim.

## Known problems (detail lives where the pointer says)

- **A raw `setSlot` LOWERING `rows`/`cols` still strands any now-out-of-bounds cell slot** —
  `primitives/table.ts`'s header.
- **A loaded document can carry a `formula`/`derived` `content` slot on a `text` object** — the
  `text` command refuses to create one (D-122), but the loader has no such guard, and
  `resolveTextDependencyAddresses` reads `content` `literal`-only, so its embedded references go
  untracked. Exactly D-046's loaded-file posture for `rows`/`cols`. Disclosed in `primitives/text.ts`.
- **`measuredHeight` is `#MEASURE` for a `text` object created in a test** (default `NULL_EVAL_CONTEXT`).
  Through the running app `main.ts` threads a real measurer (0132), so a command-created `text`
  measures for real. D-118 working as ruled.
- **`render/measure.ts`'s wrap path reconstructs each output line with single spaces** — latent;
  `renderer.ts`'s `drawText` now shares that path (`layOutLines`), so a wrapped line draws
  single-spaced too — drawn and measured stay consistent.
- **`extent.ts`'s `text` box height trusts the stored `measuredHeight`; `renderer.ts` re-wraps with
  its own `ctx`.** If the two wrap loops ever diverge (same font, same browser — they should not),
  `extent.maxY` lags the drawn line count by a line. Flagged to the 0138 reviewer (Q2).
- **An auto-width `text` object's click box is a `PROVISIONAL(Q-024)` fixed fallback (240×20)** —
  a line wider than that draws outside its own hit region. Most `text` objects carry a numeric
  `width` (Phase 5's gate: "set width"), so this is an edge affordance. Q-024 will rule it.
- **`x`/`y` are OPTIONAL for the `text` command (default `0`, per D-121 clause 3)** but REQUIRED for
  `circle`/`polygon`/`rect`/`table`. A visible inconsistency across the creation commands; **0137-REVIEW
  confirmed it is intended** (D-121 clause 3's operative text; its "(matching `table`)" aside is
  imprecise — `table` requires x/y — but immaterial). Do not revisit absent a human ruling.
- **`DEFAULT_TEXT_*` style values (`command/commands.ts`) are the handler's provisional pick** — no
  ruling, no `PROVISIONAL` tag (render config, `set`-changeable). **0137-REVIEW confirmed no tag is
  needed**; the render cycle will exercise these (the font default especially) directly.
- **`resolveTextDependencyAddresses` and `deriveEdges` Source 1 are a hand-maintained PAIR (D-119).**
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
- **`render/measure.ts` measures markdown markup verbatim AND `renderer.ts` now draws it verbatim**
  (`**bold**`/`# heading` shown as typed) — deliberately consistent for now. The markdown-lite
  cycle moves both: strip the markers before measuring, render them as formatting. §5.6's exact
  list only. Flagged in `measure.ts` and `renderer.ts`.
- **Seven §5.10 commands have no registry entry** — `polyline`/`script`/`image`/`explode`/
  `addvertex`/`delvertex` wait on a schema or an `Operation` kind; **`pan` waits on Q-012**. (`text`
  LEFT this list at entry 0136.)
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

Every ruling in `DECISIONS.md` (D-001 through **D-122**) binds without restatement here.

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
`literal`-only; `link` / `set =` refused in `command/commands.ts`'s `buildSlot`, à la D-046. Guard
placement (`buildSlot`'s `formula` arm) confirmed at 0137-REVIEW.

**Implemented AND reviewed, do not re-build:** D-097/D-098/D-099 · D-100 · D-101/D-106/D-102 · D-107 ·
D-081 + D-083 c4 · Phase 4's gate test · D-109 clause 3 · D-110 in full · D-114/D-115/D-116/D-117 ·
D-118 (guard + wiring) · D-120 (`render/measure.ts` + threading) · **D-121 / D-122 + the `text`
command (0137-REVIEW)**.

**NOT implemented, each owned by a named future cycle:** **D-104** (§5.10's row/column commands) ·
**D-108** (§5.11's load path; clause 3 binds every cycle before it) · **D-109 clauses 1–2** (cell
decimals + clipping, `render/` only).

**Q-014 and Q-018 are CLOSED.** **Q-013 is NOT mooted.** **Q-016 and Q-017 remain OPEN**, both the
human's, neither blocking. **Q-019 → D-116**, **Q-020 → D-117** — BUILT and REVIEWED (0128).
**Q-021 → D-120** — BUILT + WIRED + REVIEWED (0133). **Q-022 → D-121**, **Q-023 → D-122** — RULED
(0135-REVIEW), BUILT (0136), REVIEWED (0137) — CLOSED. **Q-024** (entry 0138) — how is a `text`
object's bounding box width computed when `width: "auto"`? OPEN; reversible provisional (a) taken
and tagged in `render/extent.ts`; awaits the 0138 review. Next free: **Q-025**.

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

**`PROVISIONAL(Q-024)` → `src/render/extent.ts`** (`textExtent`, the `TEXT_AUTO_BOX_WIDTH` /
`TEXT_AUTO_BOX_HEIGHT` fallbacks): an auto-width / no-measurer `text` object gets a fixed fallback
bounding box. Reversible, render-only, no stored state. Due with the 0138 review / the markdown-lite
cycle.

**No other `PROVISIONAL` tags exist.** Q-016/Q-017 have none; neither do Q-022/Q-023 — both ruled and
built without a provisional site (0135-REVIEW §5 clause 4).

## Gotchas for the next model

- **REVIEW IS DUE (entry 0138).** §6.1 trigger 5 (changed test expectations) + trigger 3 (Q-024).
  Do not start markdown-lite / the gate until it clears.
- **TEXT DRAWS (entry 0138).** `renderer.ts` `drawText`; `extent.ts`/`hittest.ts` `text` cases;
  `measure.ts` now exports `layOutLines`/`cssFont` for the renderer to share (drawn ≡ measured,
  D-010). Markdown-lite + `overflow` clip/ellipsis are NOT built — markup draws verbatim.
- **`extent.ts`'s `text` box:** origin + numeric `width` (else `PROVISIONAL(Q-024)` fallback 240) +
  numeric `height`/`measuredHeight` (else fallback 20). `undefined` for a `text` object with no
  `resolvedContent`. `hittest.ts` and the selection highlight read this same box.
- **A `text` object drags via `interaction.ts`'s existing `origin` path — no `text`-specific code.**
  D-121's payoff, now reachable.
- **A selected `text` object shows a D-094 properties panel** (it has an `objectExtent` now).
- **The `text` command exists.** `text [x=<number>] [y=<number>] "<content>"`. `x`/`y` optional,
  default `0` (D-121 c3 — the geometry presets require theirs). `content` required, kept verbatim.
- **`TEXT_SCHEMA` has ELEVEN non-derived slots** (was nine). `grep` for `ORIGIN_X_PATH` in
  `schema.ts` before touching the `text` entry; `origin.x`/`origin.y` are NOT
  `primitives/text.ts`'s `TEXT_*_PATH` constants — they reuse `geometry.ts`'s.
- **`content` cannot be `link`ed or `set =`'d (D-122).** The guard is `isTextContentTarget` in
  `command/commands.ts`'s `buildSlot`, fired before `parseFormula`. Engine has no such guard — a
  loaded file can still carry one.
- **`TEXT_TYPE` (`graph/node.ts`) — import it, never a bare `"text"` literal (D-009).**
- **`EvalContext` is threaded PER CALL, not on `AppState`.** Public entry points default it to
  `NULL_EVAL_CONTEXT`; internal handlers take it REQUIRED.
- **`main.ts` builds a SECOND offscreen 2D context for measurement** — never the renderer's.
- **The block tree is parsed in TWO places every mutation** and must NOT be cached (D-114 clause 4).
- **`resolveTextDependencyAddresses` and `deriveEdges` Source 1 are a hand-maintained PAIR** (D-119).
- **`#MEASURE` is a real `ErrorCode`** (`graph/node.ts`), sixth after `#SCRIPT`. Only ever produced
  by `measuredHeight`, never serialized.
- **The operator cannot see what you can see.** A text box that silently renders empty or
  zero-height is the injury D-116 and D-118 are ruled against.
