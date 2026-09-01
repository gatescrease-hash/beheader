# STATUS — as of entry 0120-text-block-tree

STATE: **GREEN, AWAITING REVIEW.** Both configs compile, **1322/1322** tests pass, 0 skipped, 0
`.only`. **PHASE 5 HAS BEGUN.** Entry 0120 built the text primitive's block-tree engine
(`src/engine/primitives/text.ts` — parse/evaluate/extract-dependencies over `{= }`/`{? }{:}{?}`),
headless and fully unit-tested, and stopped there: it is the **first file of a new subsystem**
(§6.1 trigger 2), which forces a review point regardless of size or the §6.3 batch cap. **This is
unreviewed.** No `text` object, schema entry, derived slot, `TextMeasurer`/`EvalContext` threading,
or command exists yet — see entry 0120's "Explicitly not in scope" and "Where I got stuck" for
exactly what the next cycle (post-review) owes, including an open design question for the reviewer
about D-110's interaction with `resolvedContent`'s future `read` closure.

**PHASE 4 IS PASSED, ITS GATE IS CLOSED, AND THE PRE-PHASE-5 BATCH IS REVIEWED.** 0116-REVIEW
closed the gate; **0119-REVIEW cleared entries 0117 and 0118 (ACCEPT WITH EDITS, three edits: two
tests and one comment, no production behaviour changed)**. §6.2's block on starting a later phase is
**LIFTED** — `mutation.ts`, `graph/eval.ts` and `primitives/table.ts` no longer carry unreviewed
changes. (This is unrelated to entry 0120's own, separate review point above — Phase 5's own first
file needs its own review before Phase 5 continues.)

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

**Owed next:** entry 0120's review point (§6.1 trigger 2, first file of `primitives/text.ts`) —
Phase 5 may not continue until it clears. After that: wire `text.ts`'s three functions into
`primitives/schema.ts` (a `text` schema entry, `resolvedContent`/`measuredHeight` derived slots),
thread a `TextMeasurer` through an `EvalContext` into `graph/eval.ts` (Rule 1's injected-measurer
trap), add the `text` command, and settle entry 0120's own open question — does `resolvedContent`'s
`read` closure need D-110's empty-in-extent-cell treatment, given `graph/eval.ts`'s generic
`evaluateDerivedSlot` `read` does not currently apply it (only `evaluateFormula`'s own `read` does).
Still separately owed, unchanged: **D-109 clauses 1–2** (cell decimals + clipping, `render/` only) ·
**Q-017** (table headers, open — F12 strengthens the case).

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

**11. THE PAPERCLIP CANNOT REACH A TABLE CELL.** `props.ts` collapses every cell into ONE
`synthetic` summary row and D-102 clause 2 deliberately gives a `synthetic` row no paperclip. **Cell
values must be TYPED** (`set table_1.A1 5`, `set table_1.B1 = polygon_1.origin.x * 2` — the latter
is Phase 4(b) verbatim). Cell values DO render, numbers right-aligned and strings left-aligned per
§5.4. **A table drawn as an empty grid is empty, not broken.** What is genuinely NOT built is
§5.4's last line, the formula bar / in-place cell editing.

## Next slice (recommended)

**Review entry 0120 first** — it is a §6.1 trigger (first file of `primitives/text.ts`) and Phase 5
may not continue past it unreviewed. After that clears: wire `text.ts` into `primitives/schema.ts`
(schema entry, `resolvedContent`/`measuredHeight`), thread `TextMeasurer`/`EvalContext` into
`graph/eval.ts`, add the `text` command — and settle 0120's own flagged question about D-110 and
`resolvedContent`'s `read` closure before building it, not while building it. Independently,
**D-109 clauses 1–2** (cell decimals + clipping, `render/renderer.ts` only, Rule 5's `save()`/
`clip()`/`restore()` or measured truncation) and **Q-017**'s headers remain the smallest un-owed
items on the board if the human wants a render-only slice instead.

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
tests and one comment added by the reviewer; D-112, D-113).**

## Built this batch, not yet reviewed

**Entry 0120 — `src/engine/primitives/text.ts` + its tests.** §5.6's block-tree engine: parses
`{= }`/`{? }{:}{?}` (nestable) out of a `content` string into a `Block[]` (widened by a fourth,
non-brief `error` variant — see the entry), evaluates it with short-circuiting, and extracts its
dependencies eagerly/totally including untaken branches. Headless; no `text` object, schema, derived
slot, `TextMeasurer`, or command exists yet. This is the first file of a new subsystem (§6.1 trigger
2) and needs its own review before Phase 5 continues.

## Not started

D-090's prompt-sequence preview · §5.9's per-vertex drag path ·
`polyline`/`explode`/`addvertex`/`delvertex` · `style` slots · point-in-polygon fill hit-testing
(D-067) · §5.4's formula bar / in-place cell editing · D-088 clauses 2–4 · D-089 · D-102 clause 9
(drag-linking between two panels) · **D-109 clauses 1–2** · Phase 5's `text` object/schema/derived
slots/`TextMeasurer`/command (block-tree engine itself is entry 0120, above, awaiting review) ·
Phases 6–7.

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

Every ruling in `DECISIONS.md` (D-001 through **D-113**) binds without restatement here.

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
the human's, neither blocking. Next free: **Q-019**.

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
