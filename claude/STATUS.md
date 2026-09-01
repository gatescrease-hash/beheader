# STATUS — as of entry 0124

STATE: **GREEN** (compiles, all tests pass) — but **REVIEW: REQUIRED before the next slice.**
Both configs compile, **1337/1337** tests pass, 0 skipped, 0 `.only`.
**PHASE 5 IS OPEN. Entry 0124 built the `EvalContext`/`TextMeasurer` seam** — §6.1 trigger 2
fired (first file of a new subsystem, `src/engine/eval-context.ts`), so the next slice waits on
0124's review. Batch: cycle 1/3 since 0121-REVIEW · diff 344 lines / 8 files (cap 800/10).

**ENTRY 0124 — THE INJECTED-MEASURER TRAP IS SOLVED, PENDING REVIEW.** New leaf file
`src/engine/eval-context.ts`: `EvalContext` (`{ measurer: TextMeasurer }`), `TextMeasurer`
(Rule 1's interface — `measure(text, style)`), `TextStyle` (§5.6's size-relevant style subset:
`font`/`fontSize`/`lineHeight`), and `NULL_EVAL_CONTEXT` (a deep-frozen null-object, zero
measurement, the documented default for the many callers with no text). `DerivedSlotCompute`
gains `context?: EvalContext` (optional ONLY for the isolated-unit-test path — `graph/eval.ts`
always supplies it). `evaluate`, `deriveValidateAndEvaluate` and `mutate` each take
`context = NULL_EVAL_CONTEXT` and forward it untouched down to every `derived`-slot compute.
**No behavioural consumer yet** — `measuredHeight` is the next slice and IS the end-to-end
threading test. `geometry.ts`'s "no `EvalContext` reaches a compute" comment was falsified and
fixed (D-065).

**BOTH TEXT-ERROR-DISPLAY QUESTIONS ARE NOW RULED — NEITHER IS BUILT.** Two related, DIFFERENT
mechanisms, both marked with a `!` prefix and both owed by the same future Phase 5 wiring cycle:

- **D-116** (Q-019, entry 0122) — a span that never PARSED (`{= 1 + }`) renders its own SOURCE back,
  verbatim, delimiters included: `!{= 1 + }`. There is no computed value; the source IS the
  diagnostic.
- **D-117** (Q-020, entry 0123) — a span that parsed fine but EVALUATED to an `ErrorValue`
  (`{= 1 / 0 }`) renders `!` + the error's CODE, not its source: `!#DIV0`. There IS a value, and
  showing the operator's own source back would tell them less than the code does.

Both: the rest of the text object renders normally (no `#PARSE`/error-value propagation to the whole
object); no §5.9 error badge (the `!` mark IS the signifier); the mark is emitted by the ENGINE, into
`resolvedContent`, never added at draw time (`measuredHeight` is computed FROM `resolvedContent`).
**Entry 0122 built D-116's DATA SHAPE only** (`BlockParseErrorBlock.source` is now the whole span
with delimiters; `start` points at the `{`; `orphaned` holds a broken conditional's branches for
dependencies-without-rendering). **D-117 needed no shape change** — a runtime-broken formula is an
ordinary `FormulaBlock`/`ConditionalBlock` that evaluates to an `ErrorValue`; nothing new to hold.
**Neither ruling's actual behaviour is built.** The wiring cycle owes both, together, with a test
each for: a parse-broken span, a runtime-broken formula block, and a runtime-broken conditional
condition.

**ENTRY 0120'S BLOCK-TREE ENGINE IS BUILT AND REVIEWED (0121-REVIEW: ACCEPT WITH EDITS).**
`src/engine/primitives/text.ts` parses §5.6's `{= }` / `{? }{:}{?}` (nestable) out of a raw
`content` string into a `Block[]`, evaluates it with short-circuiting, and extracts its dependencies
eagerly and totally including untaken branches. §6.1 trigger 2 (first file of a new subsystem) is
**DISCHARGED** — Phase 5 may continue. No load-bearing (§6.2) file was touched by that cycle at all.
0121-REVIEW made three edits (two defect fixes, one criterion pin) and issued **D-114**, **D-115**
and **Q-019**.

**WHAT IS STILL UNBUILT IN PHASE 5**, after 0124: no `text` OBJECT type, no schema entry, no
`resolvedContent`/`measuredHeight` derived slots, no `text` command, no markdown-lite rendering, no
layout, and D-116 clauses 1-4 / D-117 still unimplemented. `TextMeasurer`/`EvalContext` threading
into `graph/eval.ts` is DONE (0124, pending review) — but nothing consumes the measurer yet, and no
real (Canvas2D) measurer is wired into `main.ts` / `executeCommand`.

**PHASE 4 IS PASSED AND ITS GATE IS CLOSED.** 0116-REVIEW closed the gate; 0119-REVIEW cleared
entries 0117 and 0118. §6.2's block on starting a later phase was lifted there and has not been
re-armed.

**D-109 CLAUSE 3 IS BUILT (0117) AND REVIEWED (0119).** `main.ts`'s command-bar `keydown` listener
clears `input.value` only when `submitLine`'s returned `AppTransition.refused` is `false`, computed
once in `advance()`. **D-113 affirms that this covers a refused PROMPT STEP answer too**, not only a
refused complete command — entry 0117 declared that reading rather than assuming it, and it is now
binding, so do not "narrow it back" to the ruling's worked examples.

**D-110 IS BUILT IN FULL (0118) AND REVIEWED (0119).** A bare reference to a cell inside an EXISTING
table's current extent that has no slot (or holds `null`) evaluates to the number `0` and gets **no
edge at all**. Shared helper: `primitives/table.ts`'s `isInExtentTableCellAddress(address, objects)`.
Changed: `mutation.ts`'s `deriveEdges` (skips the edge — clause 4) and `graph/eval.ts`'s
`evaluateFormula`'s `read` closure (coerces to `0` — clauses 1-3). D-111 clause 3's pin is built at
the `mutate` level (last test in `mutation.test.ts`'s D-110 block) **and, since 0119-REVIEW, at the
command line too** (`commands.test.ts`'s `set` block). Two existing tests flipped from asserting
refusal to asserting acceptance-and-`0`, exactly as D-110's own ruling text said they would.

**Owed next: the REST of the Phase 5 WIRING slice**, and it inherits a decided direction rather than
an open question. Rule 1's injected-measurer trap is SOLVED (0124, pending review): `EvalContext`
carries a `TextMeasurer` and is threaded through `evaluate`/`deriveValidateAndEvaluate`/`mutate` to
every `derived` compute. What remains: wire `text.ts`'s three functions into `primitives/schema.ts`
(a `text` schema entry, `resolvedContent` + `measuredHeight` derived slots — `measuredHeight` is the
first thing to actually call `context.measurer`), add `render/measure.ts`'s Canvas2D `TextMeasurer`
and thread a real context through `executeCommand`/`main.ts`/`loadDocument`, and add the `text`
command. **That slice is bound by D-114 in full**, including clause 3's non-obvious ordering, which
it MUST pin with a test that fails if the two checks are swapped. It is a §6.1 trigger of its own
(`graph/eval.ts` and `primitives/schema.ts` are load-bearing, §6.2).
**That slice also owes D-116 clauses 1-4 AND D-117, together** (the `!` prefix on a parse-broken
span's own source; the `!` + error CODE on a runtime-broken evaluation; `evaluateBlockTree` no
longer propagating either as `#PARSE`/an `ErrorValue` for the whole tree) — both are now RULED, so
this is implementation work, not a design question. Still separately owed, unchanged: **D-109
clauses 1–2** (cell decimals + clipping, `render/` only) · **Q-017** (table headers).

Still unimplemented and unowned by the next cycle: **D-108** (loader AST shape validation, owed by
§5.11's file-input load cycle) · **D-104** (table resize bounds, owed by §5.10's row/column commands).

---

## Read this first — what a cold reader needs

**1. PHASE 4'S GATE TEST IS `main.test.ts`'s LAST DESCRIBE BLOCK, AND IT IS THE PHASE'S ONLY
PROTECTION.** Seven tests over one document (`table_1` 4×4, `polygon_1` driven, `polygon_2`
driving): the whole document builds with no refusal and both bindings are `formula` **by KIND, not
only by value**; (a) `set table_1.A1 650` moves `polygon_1.origin.x` and its derived `centroid.x`;
(b) dragging `polygon_2` updates `table_1.B1` to twice its new `origin.x` in the same mutation;
(c) dragging `polygon_1` moves Y only and the log names `table_1.A1`; all three over ONE final
state; a real cycle is still refused and leaves `state.document` the same object; and §5.1's own
round trip through ONE object is accepted and propagates. **If a future cycle breaks two-directional
binding, these are what go red.** Do not weaken them; do not fold them into another block.

**2. WHY THE SEVENTH TEST EXISTS (0116-REVIEW, D-111 clause 2).** The gate document binds through
TWO polygons, so its object-level graph is `polygon_2 → table_1 → polygon_1` — a DAG. An
implementation whose graph was OBJECT-granular (§5.1's named mistake) would accept it too, so
`not.toContain("cyclic")` over that document could never have failed. The discriminating shape is
the round trip through ONE object — `table_1.A1 → polygon_1.origin.x → polygon_1.centroid.x →
table_1.C1` — which is legal, is accepted, propagates in one pass, and was pinned nowhere before
0116-REVIEW. `geometry.test.ts:418` is the one-directional half of it.

**3. D-110's DISCLOSED CONSEQUENCE IS NARROWER THAN IT READS — `refs` HAS TWO FORMS AND THEY ANSWER
DIFFERENT QUESTIONS (D-112, 0119-REVIEW).** `refs <cell>` reports the CURRENT edge set, so it does
**not** name a formula reading a still-empty in-extent cell — that is clause 4 working as ruled.
`refs <object>` **does** name it, and is right to: it derives its blocking half over the document
**without** the target, so the reference stops being in-extent, the edge reappears, and the report
matches the `delete <object>` that is in fact refused. **Neither may be "fixed" to match the other.**
§5.1.1's "see what points at something before deleting it" survives D-110 intact by exactly this
mechanism, which `refs`'s own header has documented since 0082-REVIEW for the D-047 range case.
Pinned by a test in `commands.test.ts`'s `refs` block.

**4. THE PANEL IS FULLY BUILT AND FULLY REVIEWED — DO NOT RE-BUILD ANY OF IT.** D-094 (display),
D-100 (selection), D-101 (N panels), D-106 (dismiss), D-102 (writing), D-107 (F1–F4's focus and
identity rules) are ALL implemented and ALL reviewed (0110-REVIEW cleared D-101/D-106/D-102;
0113-REVIEW cleared D-107). **Q-014 is CLOSED in code.** In one line each, what the fix list at
entry 0111 fixed: **F1** a panel press left the keyboard homeless — `pointerdown` now prevents the
DOM's own focus move on every panel press *except* one landing inside an already-open row editor's
input, and `onCommit`/`onCancel` restore the command bar's focus; **F2** a stale blur from a repaint
could clear a freshly-opened editor — `onCancel` acts only while `openEditor` still names the exact
row it was built for; **F3** the editor seeded from the D-099-ROUNDED display value — `PanelRow`
gained a separate unrounded `editSeed`; **F4** the skip-rebuild gate could latch with no input —
`updatePanels` clears `openEditor` when a rebuild produces no matching input.

**5. ONE READING DECISION IS STILL WORTH A HUMAN'S EYES: a panel-typed STRING reaches a FORMULA
slot, never a literal one.** A panel row has no quoting affordance, so `"hello"` typed into a row
lands as a `formula` slot holding that string, and bare `hello` is a formula naming an object called
`hello` (refused if none exists). Correct per D-102 clause 6; **Q-016** carries the grammar question.

**6. `main.ts`'s DOM HALF (`start`) IS UNTESTED BY CONSTRUCTION (D-001) AND KEEPS GROWING.** Entry
0109 added the largest single expansion (the editing machinery); entry 0111 amended it; entry 0117
added the `if (!outcome.refused)` guard around the input clear. Verified live in a real browser at
0109 and 0111 (Playwright, transiently installed, zero console/page errors) — that is several runs by
one person, not a re-runnable assertion, and **entry 0117's own DOM line has not had one**. The
tests reach `main.ts`'s PURE half only: they assert `submitLine`'s returned `refused`, not that the
listener acted on it.

**7. THE VANISHING-TABLE DEFECT IS FIXED (entry 0101) — D-097/D-098/D-099 are CLOSED.**
`mutation.ts`'s `findInvalidDimensionWrites` rejects a `setSlot` that would leave `table`'s
`rows`/`cols` non-`literal`, non-number, non-integer, or outside `MIN_TABLE_LINES..MAX_TABLE_LINES`.
**D-102's panel writes inherit that refusal for free**, because every panel write is a synthesised
`Command` through `executeCommand`.

**8. D-104 IS OWED BY A CYCLE THAT HAS NOT BEEN SCHEDULED.** `insertTableLine`/`deleteTableLine` are
not bounded by `MIN_TABLE_LINES`/`MAX_TABLE_LINES` the way `setSlot` now is. **Not reachable by any
command today** (§5.10's row/column commands are unbuilt). Owed by whichever cycle builds them; the
fix goes in `findInvalidTableResizes`, never in `findInvalidDimensionWrites`.

**9. D-108 IS OWED BY §5.11's LOAD CYCLE, AND ITS CLAUSE 3 BINDS EVERY CYCLE BEFORE THAT ONE.**
`deserializeDocument`'s "never throws" claim is FALSE for a malformed loaded `ast` (`ast: null`, a
`binaryOp` with absent or `null` children, a `functionCall` whose `args` is not an array). **Do not
"fix" it by guarding `exceedsMaxFormulaAstDepth` or any other single walker** — clause 3 forbids it
explicitly, because that only moves the throw. Not operator-reachable today: nothing calls
`loadDocument` outside tests.

**10. D-081 AND D-083 CLAUSE 4 ARE BUILT (0112) AND REVIEWED (0113) — do not re-build either.**
`createObject`'s own name passes the SAME gate a rename does, via `mutation.ts`'s `findInvalidNames`
(renamed from `findInvalidRenames`; no `excludeId` for a creation). A loaded formula's AST depth is
checked in EXACTLY ONE place, `document.ts`'s `reconstructSlot`, via `formula/ast.ts`'s
`exceedsMaxFormulaAstDepth` — `deps.ts` and `eval.ts` still carry no depth parameter of their own,
and that is what makes the single check safe.

**11. THE TEXT BLOCK TREE IS DERIVED STATE, RE-PARSED FROM `content` ON DEMAND, AND MUST NEVER BE
CACHED (D-114 clause 4).** `content` is a **literal** slot holding the raw source, so — unlike a
cell formula — it is NEVER refused at commit time: any string is legal document state, half-typed
`{= }` included. Parsing therefore happens downstream, and a broken span becomes an `error`-kind
`Block` (§5.6 lists three variants; the fourth is sanctioned by **D-115**, the same move D-028 made
for `FormulaAst`'s `ErrorNode` — do NOT "restore" the union to three). An `error` block MUST carry
the offending `source` and its `start` offset **into `content`** (D-115 clause 2, discharging D-038
clauses 2 and 4). **Since D-116 the span is the WHOLE construct, delimiters included** — `{= 1 + }`,
and for a conditional everything from `{?` through its matching `{?}` — because that is what gets
rendered back verbatim. A broken conditional's parsed branches live in the error block's
**`orphaned`** field: walked by `extractTextDependencies`, never by `evaluateBlocks`. They were
inline siblings for one commit (0121-REVIEW), which was safe only while an error block
short-circuited evaluation; D-116 removes that, and inline branches would have printed `yesno` for
`{? 1 + }yes{:}no{?}`. Keeping them at all is D-115 clause 3: dropping them made extraction silently
non-total (0121-REVIEW §4 measured `[]` for a reference living only in the false branch).

**12. THE PAPERCLIP CANNOT REACH A TABLE CELL.** `props.ts` collapses every cell into ONE
`synthetic` summary row and D-102 clause 2 deliberately gives a `synthetic` row no paperclip. **Cell
values must be TYPED** (`set table_1.A1 5`, `set table_1.B1 = polygon_1.origin.x * 2` — the latter
is Phase 4(b) verbatim). Cell values DO render, numbers right-aligned and strings left-aligned per
§5.4. **A table drawn as an empty grid is empty, not broken.** What is genuinely NOT built is
§5.4's last line, the formula bar / in-place cell editing.

## Next slice (recommended)

**Wait for 0124's review, then the rest of Phase 5's wiring slice**: the `text` schema entry,
`resolvedContent` + `measuredHeight` as derived slots (the FIRST consumer of 0124's
`EvalContext` — its `measuredHeight` test must fail if the context is not threaded), the `text`
command, D-116 clauses 1-4 + D-117 in `evaluateBlockTree`, `render/measure.ts`'s Canvas2D
`TextMeasurer` and its wiring through `executeCommand`/`main.ts` and `loadDocument`. **Read
D-114 before writing any of it** — it settles what `read`/`readRange` an embedded `{= }` gets
(the same contract a cell formula's AST gets, D-110 coercion included), where the widening goes
(`evaluateDerivedSlot`, never a second path), and the order the D-110 coercion and D-013's
membership check must run in (coercion first, for an in-extent empty cell only — they collide
silently otherwise). **Decide there whether a `measuredHeight` running against
`NULL_EVAL_CONTEXT` for a real `text` object must return an `ErrorValue` rather than a silent
height 0** — 0124 flagged this and left it to the consuming cycle. Independently, **D-109
clauses 1–2** (cell decimals + clipping, `render/renderer.ts` only) and **Q-017**'s headers
remain the smallest un-owed items if the human wants a render-only slice instead.

## Built and reviewed

Phase 0 (0027-REVIEW) · formula engine (0037) · table primitive through row/column insert/delete and
`delete <table> force` (0054) · `render/camera.ts` + entry 0055's header audit (0058) ·
`primitives/geometry.ts` (0060) · `render/renderer.ts`'s original body/table drawing (0062, widened
by 0093/0094/0107) · `render/hittest.ts` (0064) · entry 0065's header audit · `render/interaction.ts`
(0067, its D-098 widening at 0102 reviewed at 0103) · `command/parser.ts` (0069) ·
`command/prompt.ts` + D-071's formula path (0071) · entries 0072–0073's fix-list work (0074) ·
`command/commands.ts`'s seam and its four creation handlers, `document.ts`'s `mintObjectId`,
`TABLE_SCHEMA`'s `origin.x`/`origin.y` (0078) · `commands.ts`'s four slot commands through one
`writeSlot` path, `engine/formula/format.ts` (0080) · `commands.ts`'s `delete`/`refs`/`list` (0082) ·
`mutation.ts`'s `RenameObjectOperation` + `findInvalidNames`, `commands.ts`'s `rename` (0084, D-081's
widening at 0112 reviewed at 0113) · `CommandEffect` and the five effect handlers (0086) · the two
formula depth limits (0088) · `main.ts` rewritten from the stub, `render/camera.ts`'s
`clampCamera`/`clampZoom`, `render/extent.ts`'s `documentExtent`, `index.html` (0089, reviewed
0090/0091, widened at 0107/0109/0117) · entry 0093's selection highlight / error badge /
formula-driven indicator (D-068) and D-092 clause 1's name label, entry 0094's chrome-anchor fix
(0095) · entry 0096's `render/slots.ts` + `render/extent.ts` split (D-093) and entry 0097's
`command/props.ts` + `props` command (0098, ACCEPT WITH EDITS; D-096) · entry 0099's
`render/panel.ts` + the panel DOM (0100) · entry 0104's selection-list widening (0105, D-105) ·
entries 0107/0109's N panels, drag, dismiss and panel editing — D-101, D-106, D-102 (0110-REVIEW:
REVISE, four findings) · entry 0111's F1–F4 fix list and D-107, entry 0112's D-081 + D-083 clause 4
(0113-REVIEW: ACCEPT, no edits) · entry 0115's Phase 4 gate test (0116-REVIEW: ACCEPT WITH EDITS) ·
**entry 0117's D-109 clause 3 and entry 0118's D-110 in full (0119-REVIEW: ACCEPT WITH EDITS — two
tests and one comment added by the reviewer; D-112, D-113)** · **entry 0120's `primitives/text.ts`
block-tree engine (0121-REVIEW: ACCEPT WITH EDITS — three edits; D-114, D-115, Q-019)** · entry
0122's D-116 data-shape change (rulings entry; the human's Q-019 answer, clauses 1-4 still unbuilt) ·
entry 0123's D-117 (rulings entry; the human's Q-020 answer, still unbuilt, no shape change needed).

## Built this batch, not yet reviewed

**Entry 0124** — `src/engine/eval-context.ts` (NEW: `EvalContext`, `TextMeasurer`, `TextStyle`,
`NULL_EVAL_CONTEXT`); `DerivedSlotCompute` gains `context?`; `graph/eval.ts`'s `evaluate`,
`mutation.ts`'s `deriveValidateAndEvaluate` + `mutate` gain `context = NULL_EVAL_CONTEXT`,
forwarded to every `derived`-slot compute; `geometry.ts` one comment fixed (D-065). +344/−20,
8 files. §6.1 trigger 2 fired — review required before the next slice.

## Not started

D-090's prompt-sequence preview · §5.9's per-vertex drag path ·
`polyline`/`explode`/`addvertex`/`delvertex` · `style` slots · point-in-polygon fill hit-testing
(D-067) · §5.4's formula bar / in-place cell editing · D-088 clauses 2–4 · D-089 · D-102 clause 9
(drag-linking between two panels) · **D-109 clauses 1–2** · Phase 5's `text` object/schema/derived
slots/command, D-116 clauses 1-4 + D-117, and markdown-lite rendering (the block-tree engine is
built and reviewed — 0120/0121; the `EvalContext`/`TextMeasurer` seam is built pending review —
0124; `render/measure.ts` and the real measurer wiring are not started) · Phases 6–7.

## Open fix list — read 0090-REVIEW §9, 0091-REVIEW §5 and 0100-REVIEW §9 for the full text

Numbering follows 0090-REVIEW §9. Items 2–10 unchanged and open.

1. **DONE at entry 0112**, reviewed at 0113. §5.11's loader validates a loaded formula's AST depth
   once, at the boundary (**D-083** clause 4), and `createObject`'s own name passes **D-081**'s gate.
   Listed only so no later reader mistakes it for open debt.
2. **Give the missing-slot refusal a remedy.** Message only; D-047 clause 4 does not move — except
   where **D-110** now moves it, which narrows this item to the cases D-110 clause 6 keeps refusing.
3. **`findDanglingReferences` names one dependent once per MISSING SOURCE.** `mutation.ts`.
4. **`zoom`'s refusal names `Infinity` rather than what was typed.** Message only.
5. **Carried from 0074-REVIEW §9, all six unchanged, none blocking.**
6. **A middle-drag pan started outside the canvas is untested.** Owned by D-088's cycle.
7. **`TABLE_GRID_STROKE_STYLE` has no comment** where its neighbour has a paragraph (**D-091**).
   Owned by the `style`-slots cycle.
8. **The screen-space chrome constants and `PANEL_OBJECT_GAP_CSS` are untuned** — chosen, not
   measured (Rule 5). The human has seen the panel and did not object to the gap.
9. **The chrome pass leaves `ctx.font`/`textAlign`/`textBaseline` set on return.** Harmless today.
10. **The formula-driven indicator's narrowness (`origin.x`/`origin.y` only) should be RE-DECIDED**
    now that `props.ts` exists (0095-REVIEW §4).
11. **A display-only panel's `overflow: auto` scroll position resets on every paint**, because
    `writePanel` rebuilds each non-editing panel's rows whole and paint runs on every pointer move.
    D-102 clause 8 discharged the EDITING case (entry 0109); this narrower scope is still open.
12. **A right-flipped panel that hits the right clamp overlaps its own object.** Correct per D-094
    clause 11 as written; revisit only if the human asks after seeing it.
13. **`insertTableLine`/`deleteTableLine` are not bounded by `MIN_TABLE_LINES`/`MAX_TABLE_LINES`** —
    **D-104**, owed by the cycle that builds §5.10's row/column commands, which must not land
    without it. Not operator-reachable today.
14. **0110-REVIEW's F1–F4 — BUILT (0111), REVIEWED (0113).** Closed; listed so no later reader
    mistakes them for unowned debt. **Q-016** still carries F3's string/boolean tail to the human.
15. **F5 (0113-REVIEW) — `deserializeDocument`'s "never throws" invariant is FALSE for a malformed
    loaded `ast`.** Four shapes throw a `TypeError`. Pre-existing. **Ruled D-108**, owned by §5.11's
    load cycle; clause 3 forbids hardening any single walker in the meantime. `document.test.ts`'s
    "never throws" test must be extended to those four shapes by that cycle.
16. **F6 (0113-REVIEW) — a panel row's text can no longer be selected with the mouse.** D-107 fix
    item 1's `preventDefault()` on every panel press also suppresses the native drag-select the
    panel BODY used to start. Read off the code, not browser-verified. Recorded, not scheduled —
    D-095's "build nothing here until a human asks" governs.
17. **F7/F8 (0114-REVIEW) — ruled D-109. F8 (clause 3) BUILT at 0117 and REVIEWED at 0119; F7
    (clauses 1–2) NOT BUILT.** A table cell draws its number at full float precision
    (`formatCellValue` returns `String(value)`) and nothing clips a cell's text to its cell — two
    independent causes, both in `render/renderer.ts`'s `drawCellText`; still open, `render/` only.
18. **F9 (0116-REVIEW) — CLOSED IN THE SAME REVIEW, recorded for its lesson.** The gate document
    could not fail its own "no false cycle" clause: two polygons make it acyclic even at object
    granularity. Fixed by adding §5.1's one-object round trip to the same block.
19. **F10 (0119-REVIEW) — CLOSED IN THE SAME REVIEW, ruled D-112.** D-110's disclosed consequence
    was stated unqualified where it is true only of `refs <cell>`. See "Read this first" item 3.
20. **F11 (0119-REVIEW) — new, open, no owner needed.** Shrinking a table's extent under a formula
    that reads an empty in-extent cell is now REFUSED (`set table_1.rows 2` while
    `polygon_1.origin.x = table_1.A4`, A4 empty → "references a slot that does not exist"). Correct
    per D-110 clause 6 and arguably better than the stranding a *populated* out-of-bounds cell still
    gets — but new, reachable, and previously unrecorded. Recorded, not scheduled.
21. **F12 (0119-REVIEW) — new, open, DO NOT RE-LITIGATE.** With `B1`/`B2` empty and in-extent,
    `MIN(B1, B2)` is `0` while `MIN(B1:B2)` is `#TYPE (Infinity)`; `AVG` likewise (`0` vs
    `#TYPE (NaN)`); `CONCAT("x", B1)` is `#TYPE: argument 2 must be a string, got number`. All
    compliant: D-110 clause 3 moves the scalar half explicitly and gives no function a special case,
    and the range half is pre-existing D-047 behaviour. **D-110's cost paragraph forbids reopening
    this on the grounds that it is surprising.** Recorded so it is met on paper before it is met
    live.

## Known problems (detail lives where the pointer says)

- **A raw `setSlot` LOWERING `rows`/`cols` still strands any now-out-of-bounds cell slot** rather
  than removing it — see `primitives/table.ts`'s header. Unchanged. (Its EMPTY-cell sibling now
  refuses instead — fix-list item 20.)
- **`main.ts`'s `start` is untested code and keeps growing.** Verified live, not by assertion —
  and entry 0117's own DOM line has not been.
- **The properties panel positions an off-screen selected object's panel clamped to a canvas edge.**
- **The chrome layout is UNSEEN beyond entry 0094's anchor fix.** Labels of two adjacent objects can
  overlap — **D-095**: build no collision avoidance until a human asks; D-101 clause 3 extends that
  stance to panels.
- **A prompt sequence still shows nothing where you clicked** — ruled **D-090**, queued.
- **The formula-driven indicator is read NARROWLY** — `origin.x`/`origin.y` only.
- **A printable keystroke does not reach the command input unless it is focused** — D-088 clauses
  2–4 not built. **There is no command history** (**D-089**, queued — and **D-109 clause 4 says
  clause 3 does not discharge it**).
- **Every pointer move repaints the canvas and rewrites the whole log's `textContent`; every panel
  not currently editing is rebuilt whole every paint.** Immediate-mode, unmeasured, acceptable
  (Rule 5). The one place this became a CORRECTNESS requirement — a row's own open input — is
  handled (D-102 clause 8).
- **`escape` is bound to the window**, so it cancels a live prompt from anywhere. Innermost-first
  order — input, then prompt, then selection — is achieved STRUCTURALLY: a row's own `keydown`
  `stopPropagation`s. Dismissing a panel is deliberately NOT on this list (D-106 clause 8).
- **`zoom`'s echoed line names the REQUEST and `main.ts` adds a second line with the RESULT** —
  deliberate, D-082 clause 5.
- **`format.ts`'s elision does not re-parse** — a disclosed exception to the round-trip property.
- **A `delete` refusal can name the same dependent twice** — fix-list item 3.
- **`refs` names a range's START cell as the source** when the range's table is being removed.
- **Two sites ask the schema whether it declares a path** — `declaresSlotPath` and
  `resolveWritableSlot`'s inline check. A THIRD is forbidden.
- **`refs <address>` REFUSES for a cell of a table whose `rows` is a formula** (D-046) — a state
  D-097 makes unreachable BY COMMAND, though a loaded file can still carry it.
- **SETTLED at 0118, REVIEWED at 0119 — do not re-raise.** A bare reference to an EMPTY cell WITHIN
  a table's extent used to be refused; **D-110** reverses that (reads `0`, gets no edge) for
  in-extent cells specifically. Outside a table's extent, or to an unknown object, the refusal
  stands unchanged (D-110 clause 6). Its two live consequences are fix-list items 20 and 21, and
  its `refs` consequence is item 19 / **D-112**.
- **Eight §5.10 commands have no registry entry** — `polyline`/`text`/`script`/`image`/`explode`/
  `addvertex`/`delvertex` wait on a schema or an `Operation` kind; **`pan` waits on Q-012**.
- **`createObjectFromCommand`'s "type has no schema" branch is uncovered**, as are
  `describeSlotValue`'s `Point`/`Point[]` arms.
- **A 1000×1000 table is legal and costs ~1.5 s per MUTATION.** Rule 5's accepted trade, **not a
  defect** (D-077 clause 3).
- **`renderer.ts`'s `formatCellValue` and `props.ts`'s `describeSlotValue` are two separate
  `Value`-to-text formatters** never reconciled (D-099 clause 5, deliberate). `mutation.ts`'s
  `describeDimensionSlotValue` is a THIRD, narrower one, scoped to one rejection message.
- **Carried unchanged, each with its pointer:** `set-formula` is a `kind` not a registry name ·
  comment debt in TEST files only · mixed line endings in the WORKING TREE only (`core.autocrlf=true`)
  · dangling-reference messages name the DEPENDENT not the missing SOURCE · D-022's bounded-correctness
  claim fails for `table` · `describeValueType` duplicated in `functions.ts`/`eval.ts` ·
  `rewrite`/`repairObjectFormulaAddresses` walk `formula` slots only · journal structure unvalidated
  beyond `Array.isArray` · `lexer.ts`'s two edge cases · §5.11's `style` field · `noUnusedLocals` off
  · `.gitattributes` still owed.

## Settled — do not re-raise

Every ruling in `DECISIONS.md` (D-001 through **D-117**) binds without restatement here.

**D-114 THROUGH D-117 ARE ALL NEW AND ALL BIND THE NEXT SLICE — read all four before writing any of
it.** D-114: an embedded `{= }` AST evaluates through the SAME `read`/`readRange` contract a formula
slot's AST gets — D-110's coercion included, plus a REAL `readRange` built on
`enumerateRangeCellAddresses` (today `evaluateDerivedSlot` supplies none, so an embedded
`SUM(A1:A4)` derives correct edges and then evaluates `#PARSE`). Widen `evaluateDerivedSlot`; never
add a second evaluation path; never give text its own extent arithmetic. **Clause 3 is the trap**:
an empty in-extent cell has NO edge (D-110 clause 4), so D-013's membership check rejects it before
D-110 can return `0` — the coercion runs FIRST for that address class only. D-115: the block tree's
`error` variant is sanctioned, must carry `source` (the WHOLE broken span, delimiters included,
since D-116) + `start`, and must not narrow dependency extraction (a broken conditional's branches
live in `orphaned`, walked for deps, never rendered). D-116: a parse-broken span renders its own
source, marked `!`; the object keeps rendering. D-117: a runtime-broken evaluation renders `!` + the
error's CODE instead — a DIFFERENT mechanism from D-116's, do not merge them. Both D-116 and D-117
are RULED but **UNBUILT** — nothing in the tree today implements either.

**Implemented AND reviewed, do not re-build:** D-097/D-098/D-099 (0101/0102, cleared 0103) · D-100
(0104, cleared 0105; Q-015 CLOSED) · D-101, D-106, D-102 (0107/0109, cleared 0110) · D-107 (0111,
cleared 0113) · D-081 and D-083 clause 4 (0112, cleared 0113) · Phase 4's gate test (0115, cleared
0116) · **D-109 clause 3 (0117, cleared 0119) · D-110 in full, with D-111 clause 3's pin at both the
`mutate` and command-line levels (0118 + 0119's own edit, cleared 0119).**

**NOT implemented, each owned by a named future cycle:** **D-104** (§5.10's row/column commands) ·
**D-108** (§5.11's load path; clause 3 binds every cycle before it) · **D-109 clauses 1–2** (cell
decimals + clipping, `render/` only).

**Q-014 and Q-018 are CLOSED.** **Q-013 is NOT mooted** — `set <address> = <formula>` stays the
spelling, and D-102's panel reuses that exact synthesised form. **Q-016 and Q-017 remain OPEN**, both
the human's, neither blocking. **Q-019 is ANSWERED → D-116** (the human, entry 0122): a parse-broken
span renders itself with a `!` prefix and the box keeps rendering. **Q-020 is ANSWERED → D-117**
(the human, entry 0123, option (b)): a span that parses but evaluates to an error renders `!` + the
error's CODE (`!#DIV0`), not its source — a different mechanism from D-116's, sharing only the `!`.
Next free: **Q-021**.

**D-046 STANDS AND DOES NOT MOVE.** A dimension slot is read `literal`-only and fails closed to `0`.
D-097's write-time refusal sits BESIDE that read, not inside it. **This is also what makes D-110
safe**: the extent both callers consult can never be an evaluated value.

**D-094's fourteen clauses stand**, with clause 10 SUPERSEDED by D-102 clause 1 and clause 3
generalised by D-100 clause 8 and again by D-106 clause 5. **D-096's four clauses stand** — in
particular clause 1: a ruling's file/move list is a CEILING, its rationale governs a divergence, and
a divergence **must be named in the log entry**.

**From 0091-REVIEW (the human's session):** **D-088** (clause 1 built, 2–4 queued) · **D-089**
(queued) · **D-090** (queued) · **D-091** (the grey grid stands). **From 0090-REVIEW:** D-084,
D-085, D-086, D-087 all implemented. Still owed, unchanged: **D-074**.

## Live PROVISIONAL tags and open questions

**`PROVISIONAL(Q-012)` → `src/render/renderer.ts`** and **`src/render/slots.ts`**
(`DEFAULT_SHAPE_STROKE_WIDTH`, `TABLE_CELL_*`, `SELECTION_HIGHLIGHT_WIDTH`): world units or screen
pixels? Provisional (a) world units. Due with the `style`-slots cycle. `PANEL_OBJECT_GAP_CSS` does
NOT take a side — it is CSS pixels by a stated reason.

**`PROVISIONAL(Q-008)` → `src/engine/graph/node.ts`** (`-0`): open, deferred, blocking nothing.

**No other `PROVISIONAL` tags exist** — **Q-016** deliberately has none (no operator can reach the
site).

## Gotchas for the next model

- **`NULL_EVAL_CONTEXT` measures every box as ZERO and never errors** (`eval-context.ts`, 0124). It
  is the right inert answer for a document with no text, but a `measuredHeight` compute that runs
  against it for a REAL `text` object would read height 0 silently. The consuming cycle must decide
  whether that case returns an `ErrorValue` instead — flagged in 0124, not decided there.
- **`DerivedSlotCompute`'s `context` parameter is typed `context?` but `graph/eval.ts` ALWAYS
  passes it.** The optionality is only so an isolated unit test can call `compute(OBJECT, read)`.
  Do not read `context` as "sometimes absent in the pipeline" — it never is.
- **`context` reaches `derived` compute functions, NOT `formula`/`literal` slots.** The formula
  language has nothing that measures text; `evaluateFormula` was deliberately left unthreaded.
- **A safety argument that rests on what ANOTHER component currently does is only as durable as that
  component's current behaviour.** 0121-REVIEW justified keeping a broken conditional's branches
  inline with "rendering is unaffected, because the error block short-circuits evaluation first" —
  true when written, false one entry later when D-116 stopped error blocks short-circuiting, at
  which point those inline branches would have printed `yesno`. The fix (`orphaned`) is the
  structural version of the same claim: those blocks are not rendered because NOTHING renders them,
  not because something else returns first. Prefer the structural form.
- **When a recovery path DROPS a subtree, ask what else reads that subtree.** Entry 0120 reasoned
  about a broken conditional's recovery purely as a display choice ("which branch would we show?")
  and dropped the false branch. Display turned out to be inert — the error block short-circuits
  evaluation before either branch is reached — so the ONLY observable effect of the choice was that
  dependency extraction went half-total, silently (0121-REVIEW §4, F13). The reasoning was applied
  to the one consumer that did not exist yet, and not to the one that did.
- **`{= }` inside text is NOT a second formula language.** It is `formula/parser.ts` and
  `formula/eval.ts` called with no `tableObjectId` — which is also the entire reason "bare refs in
  text formulas are a parse error" (§5.3) is true, with no special case anywhere. Do not add one.
- **The three countable claims a log entry makes — diff total, test counts, mutation-check red
  sets — are checked by every review now.** Entry 0120's all reproduced exactly; 0115's and 0118's
  did not. Paste the runner's tail.
- **A mutation check is only worth the accuracy of "which tests went red and why."** Entry 0118's
  two checks reproduce with 5 red / 3 green each, not the 6 / 2 it reports, and the two red SETS
  differ — which is *stronger* evidence for its own conclusion than what it claimed. Write that
  section from the runner's output, not from what you expected (0119-REVIEW §5). Entry 0117 did
  paste its real tail; copy that.
- **A negative assertion is only worth what the positive case behind it costs.** "No false cycle"
  over the two-polygon gate document could never have gone red — that document is acyclic even at
  object granularity. Before asserting that something is NOT reported, build the case where it
  WOULD be, and check the assertion can actually fail (0116-REVIEW, **D-111** clause 2).
- **A test that passes on its FIRST run is not yet trusted — mutation-check it.** Entries 0109,
  0112, 0115, 0117, 0118, and both of 0119-REVIEW's own added tests each carry a check
  broken-then-reverted.
- **A gate test pins its criterion; it does not anticipate an unbuilt ruling** (D-111 clause 1).
- **"Does this edge exist" and "what does this address read as" are TWO different questions, asked
  in TWO different files, over TWO different pieces of state** — `mutation.ts`'s `deriveEdges` asks
  the first of a candidate OBJECT LIST; `graph/eval.ts`'s `read` closure asks the second of THIS
  PASS's EVALUATED VALUES. D-110 needed both answered the same way for one case without merging the
  two checks — `isInExtentTableCellAddress` (`primitives/table.ts`) is the ONE thing they share, and
  it answers neither question itself, only "is this address in bounds." **They cannot drift**,
  because `evaluateGraph` passes evaluation the SAME staged object list `deriveEdges` saw and
  accumulates results in a separate map (0119-REVIEW §3).
- **A cell that HAS a slot holding `null` and a cell that has NO slot at all are the same "empty" to
  a bare reference (D-110) exactly as they already were to a range (D-047) — but they reach that
  sameness through DIFFERENT edges.** The null cell gets a real edge and evaluates normally to
  `null`; the coercion to `0` happens only at the `read` closure, after evaluation. The missing cell
  gets NO edge, so its "value" is simply never in `evaluatedValues` — same closure, same `0`, two
  different roads there. Do not "simplify" by giving the missing cell a synthetic edge. **This is
  also why the two mutation checks fail different test sets.**
- **`refs <object>` and `refs <cell>` are not two spellings of one query** (**D-112**) — the object
  form derives edges over the document WITHOUT the target, which is what keeps it honest about what
  a `delete` will refuse. Same mechanism, older cause: an unwritten range (D-047 item 1).
- **`preventDefault()` on a press cancels the element's ENTIRE native mousedown handling, not just
  "focus".** Reach for the narrowest target, never the container (entry 0111; 0113-REVIEW item 16).
- **A loaded AST is cast unchecked and TWO walkers trust that cast** — `document.ts`'s
  `exceedsMaxFormulaAstDepth` call and `mutation.ts`'s `collectIllegalAstLiterals`. **D-108 clause 3
  forbids guarding either on its own**; the fix is one shape validation at the boundary.
- **`mutation.ts`'s name-availability check is `findInvalidNames`, not `findInvalidRenames`.**
- **A loaded formula's AST depth is checked in EXACTLY ONE place** — `document.ts`'s
  `reconstructSlot`. Do not add a second guard in `deps.ts` or `eval.ts`.
- **The DOM moves focus on a press unless you `preventDefault()` it, and a repaint that removes a
  focused element fires that element's `blur`.** Those two facts are all of F1 and F2, and **D-107**
  is the rule they produced.
- **A panel row's DISPLAY value and its EDIT SEED are two different strings** — `value` is rounded
  (D-099), `editSeed` is not. Neither is a fourth formatter.
- **A gate that "skips a rebuild while editing" must default to REBUILDING, never to skipping.**
- **`event.stopPropagation()` on a row input's OWN `keydown`** is what gives Escape its "input only"
  meaning.
- **A panel-typed bare word with no quotes and no leading `=` is a FORMULA reference, not a string
  literal** (D-102 clause 6).
- **`AppState.interaction` is assigned in exactly ONE place: `withInteraction`.** **`AppTransition`
  now carries a third field, `refused`** — set only in `advance()`, defaulted by `transition()`, and
  read only by the command bar's `keydown` listener (D-109 clause 3, D-113).
- **`renderDocument`'s `panelledObjectIds` and `selectedObjectIds` are DELIBERATELY two different
  lists** (D-106 clause 5) — do not collapse them.
- **A panel's DOM element is NOT the thing to hang gesture state off of** — panels rebuild whole
  every paint BY DEFAULT. The one deliberate exception is a row's own open `<input>`.
- **`mouse.click(..., { modifiers })` in Playwright/Chromium does NOT reliably set the modifier flag
  on the synthesized `pointerdown`** — `keyboard.down("Shift")` around a plain click does.
- **A dismissed panel's object does NOT un-dismiss on a click that merely narrows a multi-selection
  down to it** — only if the object actually LEFT the selection first.
- **A drag notice dedupes by TEXT, per GESTURE.** Do NOT reach for `Date.now()` in `interaction.ts`.
- **`describeSlotValue` must never be copied.** `maxDecimals` is its one optional argument.
- **`render/panel.ts` is PURE and tested; the panel DOM in `main.ts` is not.**
- **The panel is positioned in CSS pixels; `worldToScreen` returns BACKING pixels.**
- **The canvas is a FLEX CHILD, so nothing floats over it as written** — `#stage` is `position:
  relative` (D-065).
- **A properties panel is not a `table` object and must never be spoken of as one** (D-094 clause 1).
- **`main.ts` can be tested, and the trick is the bottom of the file** — the bootstrap is guarded on
  `typeof document !== "undefined"`. **The global `document` and `state.document` are different
  things.**
- **An object's non-derived slot paths are NOT a list you may render** (D-077).
- **`origin` does not mean the same thing across object types** — a circle's/polygon's CENTRE, a
  rect's/table's TOP-LEFT CORNER. "Where is this object, visually" wants `objectExtent`.
- **A test that asserts an OFFSET cannot catch a wrong ANCHOR.** Pin the ABSOLUTE position for at
  least two geometries that differ.
- **A review's fix list authorises a CHANGE, never an exemption from the trigger that change fires.**
- **A comment saying another file does not exist — or OWNS something — is YOURS once you falsify it**
  (D-065).
- **`clampZoom` takes `(requestedZoom, fallbackZoom)`, not a camera.** · **An `effect` is a REQUEST,
  not a report** (D-082 clause 5). · **A pan gesture is not the `pan` command.** · **`command/` may
  not see a `CameraState`, a selection, or a DOM handle** (`render/panel.ts` may — it is `render/`).
  · **`parser.ts` validates the FORM of a number, not its usefulness.** · **A name §5.2 allows is not
  automatically a name §5.3 can READ (D-080).** · **`writeSlot` in `commands.ts` is the ONE place a
  slot is written by COMMAND-LINE command**, `runPanelCommand` in `main.ts` the ONE place by PANEL
  command (both are `executeCommand` underneath — D-069 stays singular), and `withCamera` the ONE
  place the camera is written. · **A formula's SOURCE does not exist anywhere** — it is reconstructed
  from the AST against current names, every paint. · **Find the recursion before you bound it.**
- **The operator cannot see what you can see.** The panel exists because that question kept going
  unasked. Phase 4's gate session answered a third version: what the operator hits first is not the
  graph being wrong, it is a number overrunning its cell and a refused line vanishing (D-109).
