# STATUS — as of entry 0129

STATE: **GREEN** (compiles, all tests pass). Both configs compile, **1398/1398** tests pass,
0 skipped, 0 `.only`.
**PHASE 5 IS OPEN.** Entry **0129** built `measuredHeight` (§5.6's second `text` derived slot),
D-118's `#MEASURE` guard, and raised **Q-021** (reversible provisional choice taken + tagged).
One cycle since 0128-REVIEW; **not yet reviewed**.
Last review point: **0128-REVIEW-phase5**, verdict ACCEPT WITH EDITS.
Cycles since last review: **1/3** · diff since last review: **586 lines / 10 files (cap 800/10)**.

**ENTRY 0129 — `measuredHeight` IS BUILT (pending review).** `TEXT_SCHEMA.derivedSlots` now has TWO
entries. `measuredHeight`'s `static` deps: `resolvedContent` + `width` +
`style.font`/`fontSize`/`lineHeight` (§5.6; `color`/`align` omitted — they do not affect size). Its
compute, `primitives/text.ts`'s **`computeMeasuredHeight`**, is a pass-through: read the five slots,
propagate any upstream `ErrorValue`, then `#MEASURE` if only the null measurer is wired (**D-118**),
then `#TYPE` for an unusable style, then `context.measurer.measure(resolvedText, style, maxWidth)`.
`#MEASURE` is a **sixth `ErrorCode`** (`graph/node.ts`) — D-028's move, sanctioned by D-118 c2;
derived values never serialize so it never reaches disk.

**Q-021 (0129) — OPEN, reversible provisional (a) taken, tagged.** §5.6 makes `measuredHeight`
depend on `width` but 0124's `TextMeasurer.measure(text, style)` has no width parameter. Provisional
call: widen to `measure(text, style, maxWidth?)`, and **line-breaking lives in the measurer
implementation, not `src/engine/`**. `maxWidth` = the `width` slot iff numeric; `"auto"` → no wrap
(§5.6 layout). Tagged `PROVISIONAL(Q-021)` at `eval-context.ts` (`TextMeasurer.measure`'s
`maxWidth`) and `primitives/text.ts` (`computeMeasuredHeight`).

**FIVE `text` SLOTS ARE NOW EFFECTIVELY-REQUIRED (0129, narrows 0128's F20).** `measuredHeight`'s
`static` deps make `deriveEdges` emit an edge from `width`/`style.font`/`style.fontSize`/
`style.lineHeight`/`resolvedContent` into `measuredHeight` every mutation. An edge may never point
at a slot that does not exist (§5.1.1), so a `text` object created without one of those five is
**refused** — the same mechanism that refuses an `add` node with no `in.a`. `height`/`overflow`/
`style.color`/`style.align` stay optional (nothing computes from them). **The `text` command cycle
MUST create all nine non-derived slots + both derived placeholders**, with defaults (F13/F20's
neighbour, owed to that cycle).

**STILL UNBUILT IN PHASE 5:** the real Canvas2D `TextMeasurer` (`render/measure.ts`) and threading a
real `EvalContext` through the non-test `mutate` callers — so **`measuredHeight` reports `#MEASURE`
for every real document today** (D-118 working as ruled). The `text` command
(`COMMANDS_SPECIFIED_BUT_NOT_BUILT` still lists `text`), markdown-lite rendering, layout/wrapping.
Non-test `mutate` callers that pass no context: `command/commands.ts` ×4 (lines 374/571/706/753),
`engine/document.ts:380`, `render/interaction.ts:291` (drag).

**PHASE 4 IS PASSED AND ITS GATE IS CLOSED.** 0116-REVIEW closed the gate; 0119-REVIEW cleared
0117/0118. §6.2's block on starting a later phase was lifted there and has not been re-armed.

**Owed next: after this batch's review — the `text` command + `render/measure.ts` + context
threading** (which also settles F13/F20 and makes `measuredHeight` actually useful). Then, separately
owed and unchanged: **D-109 clauses 1–2** (cell decimals + clipping, `render/` only) · **Q-017**
(table headers). Still unimplemented and unowned by any scheduled cycle: **D-108** (loader AST shape
validation) · **D-104** (table resize bounds).

---

## Read this first — what a cold reader needs

**0. `TEXT_SCHEMA` NOW HAS BOTH DERIVED SLOTS.** `resolvedContent` (0127) and `measuredHeight`
(0129). `getObjectSchema("text").derivedSlots` has length 2.

**0a. A WELL-FORMED `text` OBJECT HAS 9 NON-DERIVED + 2 DERIVED SLOTS.** `content` + `width` +
`style.font`/`fontSize`/`lineHeight` are **required** (they feed a derived slot → dangling-edge
refusal if absent — 0129). `height`/`overflow`/`style.color`/`style.align` are optional. Both
derived placeholders (`{ kind: "derived", value: null }`) are required by D-018. A `formula`/
`derived`/missing `content` still means "no inner references, empty resolved text" (F13) — but a
*missing* `content` slot refuses the object (its `resolvedContent` self-edge dangles). Not reachable
today (no `text` command).

**0b. `measuredHeight` READS `context.measurer` AND RETURNS `#MEASURE` UNTIL A REAL MEASURER IS
WIRED (D-118).** `hasRealMeasurer(context)` (`eval-context.ts`) is the detector — it checks the
*measurer* is not `NULL_TEXT_MEASURER`, so wrapping the null measurer in a fresh `EvalContext` does
not sneak past. `computeMeasuredHeight`'s failure order: upstream `ErrorValue` → `#MEASURE` →
`#TYPE` (unusable style) → the height.

**1. PHASE 4'S GATE TEST IS `main.test.ts`'s LAST DESCRIBE BLOCK, AND IT IS THE PHASE'S ONLY
PROTECTION.** Seven tests over one document. Do not weaken; do not fold. See 0116-REVIEW / D-111
clause 2 for why the seventh test (round trip through ONE object) exists.

**2. D-110's DISCLOSED CONSEQUENCE — `refs` HAS TWO FORMS (D-112).** `refs <cell>` reports the
CURRENT edge set; `refs <object>` derives its blocking half without the target. **Neither may be
"fixed" to match the other.**

**3. THE PANEL IS FULLY BUILT AND FULLY REVIEWED — DO NOT RE-BUILD ANY OF IT.** D-094/D-100/D-101/
D-106/D-102/D-107 all implemented and reviewed. **Q-014 is CLOSED in code.**

**4. A panel-typed STRING reaches a FORMULA slot, never a literal one.** Correct per D-102 clause 6;
**Q-016** carries the grammar question.

**5. `main.ts`'s DOM half (`start`) IS UNTESTED BY CONSTRUCTION (D-001) AND KEEPS GROWING.** Verified
live at 0109/0111 (Playwright, transient). Tests reach `main.ts`'s PURE half only.

**6. THE VANISHING-TABLE DEFECT IS FIXED (entry 0101) — D-097/D-098/D-099 are CLOSED.**
`findInvalidDimensionWrites` rejects a `setSlot` that would leave `rows`/`cols` non-`literal`,
non-number, non-integer, or outside `MIN_TABLE_LINES..MAX_TABLE_LINES`.

**7. D-104 IS OWED BY A CYCLE THAT HAS NOT BEEN SCHEDULED.** `insertTableLine`/`deleteTableLine` are
not bounded by `MIN`/`MAX_TABLE_LINES`. Not command-reachable today. Fix in `findInvalidTableResizes`.

**8. D-108 IS OWED BY §5.11's LOAD CYCLE, AND ITS CLAUSE 3 BINDS EVERY CYCLE BEFORE IT.**
`deserializeDocument`'s "never throws" is FALSE for a malformed loaded `ast`. **Do not "fix" it by
guarding a single walker.** Not operator-reachable today.

**9. D-081 AND D-083 CLAUSE 4 ARE BUILT (0112) AND REVIEWED (0113).** `createObject`'s own name
passes `findInvalidNames`; a loaded formula's AST depth is checked in EXACTLY ONE place,
`document.ts`'s `reconstructSlot`.

**10. THE TEXT BLOCK TREE IS DERIVED STATE, RE-PARSED FROM `content` ON DEMAND, NEVER CACHED (D-114
clause 4).** Re-parsed in TWO places every mutation — `resolveTextDependencyAddresses`
(edge-derivation) and `computeResolvedContent` (evaluation) — over the SAME staged object list
(`deriveValidateAndEvaluate` passes one list to both `deriveEdges` and `evaluate`), so name→id
resolution cannot drift. A broken span becomes an `error`-kind `Block` (**D-115**); its parsed
branches live in `orphaned`, walked by `extractTextDependencies`, never rendered.

**11. THE PAPERCLIP CANNOT REACH A TABLE CELL.** Cell values must be TYPED. §5.4's formula bar /
in-place cell editing is NOT built.

**12. `evaluateDerivedSlot`'s `read` RUNS THE D-110 COERCION BEFORE THE D-013 MEMBERSHIP CHECK
(D-114 clause 3).** Do not swap them — `eval.test.ts` "D-114 clause 3…" goes red. `isEmptyInExtentCell`
and `buildRangeReader` (`graph/eval.ts`) are shared by `evaluateFormula` AND `evaluateDerivedSlot`
(D-114 clause 2).

**13. `resolveTextDependencyAddresses` and `deriveEdges` Source 1 are a hand-maintained PAIR with no
compiler link (D-119).** Change one → change both, same cycle, log names both. Verified in sync at
0128.

**14. A broken embedded span is marked `!` in place (D-116 parse / D-117 runtime), never blanks the
box; `evaluateBlockTree` always returns a `string`.** The four flipped `text.test.ts` expectations
(0126) are authorised — do NOT "restore" them.

## Next slice (recommended)

**AFTER THE BATCH REVIEW.** Two candidates, roughly equal size:

- **The `text` command + `render/measure.ts` + context threading.** `command/parser.ts` +
  `commands.ts` `text` handler (move `text` out of `COMMANDS_SPECIFIED_BUT_NOT_BUILT`), creating a
  `text` object with all nine non-derived slots + both derived placeholders and sensible style
  defaults (settling F13/F20 and 0129's five-required-slots consequence). `render/measure.ts`'s
  Canvas2D `TextMeasurer` (honouring `PROVISIONAL(Q-021)`'s `maxWidth` — line-break with
  `ctx.measureText`). Thread a real `EvalContext` through `executeCommand` and the other non-test
  `mutate` callers. This is what makes `measuredHeight` stop being `#MEASURE` and lets the Phase 5
  gate be approached.
- **Render-only:** **D-109 clauses 1–2** (cell number precision + no cell-text clipping,
  `render/renderer.ts`) and **Q-017**'s display-only table headers — the smallest un-owed items.

## Built and reviewed

Phase 0 (0027-REVIEW) · formula engine (0037) · table primitive through row/column insert/delete and
`delete <table> force` (0054) · `render/camera.ts` + entry 0055's header audit (0058) ·
`primitives/geometry.ts` (0060) · `render/renderer.ts`'s original body/table drawing (0062, widened
by 0093/0094/0107) · `render/hittest.ts` (0064) · entry 0065's header audit · `render/interaction.ts`
(0067, D-098 widening reviewed 0103) · `command/parser.ts` (0069) · `command/prompt.ts` (0071) ·
entries 0072–0073's fix-list work (0074) · `command/commands.ts`'s seam + four creation handlers,
`document.ts`'s `mintObjectId`, `TABLE_SCHEMA`'s `origin.x/y` (0078) · four slot commands through
`writeSlot`, `engine/formula/format.ts` (0080) · `commands.ts`'s `delete`/`refs`/`list` (0082) ·
`mutation.ts`'s `RenameObjectOperation` + `findInvalidNames`, `commands.ts`'s `rename` (0084, D-081
widening reviewed 0113) · `CommandEffect` + five effect handlers (0086) · two formula depth limits
(0088) · `main.ts` rewritten, `render/camera.ts`'s `clampCamera`/`clampZoom`, `render/extent.ts`'s
`documentExtent`, `index.html` (0089, reviewed 0090/0091, widened 0107/0109/0117) · entry 0093's
selection highlight / error badge / formula-driven indicator + D-092 clause 1's name label, entry
0094's chrome-anchor fix (0095) · entry 0096's `render/slots.ts` + `render/extent.ts` split, entry
0097's `command/props.ts` + `props` command (0098, D-096) · entry 0099's `render/panel.ts` + panel
DOM (0100) · entry 0104's selection-list widening (0105, D-105) · entries 0107/0109's N panels,
drag, dismiss, panel editing (0110-REVIEW) · entry 0111's F1–F4 + D-107, entry 0112's D-081 +
D-083 clause 4 (0113-REVIEW: ACCEPT) · entry 0115's Phase 4 gate test (0116-REVIEW) · entry 0117's
D-109 clause 3 + entry 0118's D-110 in full (0119-REVIEW; D-112, D-113) · entry 0120's
`primitives/text.ts` block-tree engine (0121-REVIEW; D-114, D-115, Q-019) · entry 0122's D-116
data-shape + entry 0123's D-117 (rulings) · entry 0124's `src/engine/eval-context.ts` +
`context` threading (0125-REVIEW; D-118) · entry 0126's `!`-marked broken-span rendering + entry
0127's `text` schema entry, `resolvedContent`, D-114's `evaluateDerivedSlot` widening (0128-REVIEW:
ACCEPT WITH EDITS; D-119).

## Built this batch, not yet reviewed

**Entry 0129 — `measuredHeight` + D-118 + Q-021.** `graph/node.ts` `ErrorCode` += `#MEASURE`;
`eval-context.ts` `TextMeasurer.measure` += `maxWidth?` (`PROVISIONAL(Q-021)`) + `hasRealMeasurer`;
`primitives/text.ts` `computeMeasuredHeight` + all `TEXT_*_PATH` constants (moved from `schema.ts`);
`primitives/schema.ts` `TEXT_SCHEMA.derivedSlots` += `measuredHeight`; `graph/eval.ts` header only.
+586/−101 across 10 src files. 1375→1398 tests. Two mutation-checks (threading → 3 red; D-118 guard
→ 6 red) reproduce as stated.

## Not started

D-090's prompt-sequence preview · §5.9's per-vertex drag path ·
`polyline`/`explode`/`addvertex`/`delvertex` · `style` slots as authorable (the `text` `style.*`
paths are declared; nothing writes them) · point-in-polygon fill hit-testing (D-067) · §5.4's
formula bar / in-place cell editing · D-088 clauses 2–4 · D-089 · D-102 clause 9 · **D-109 clauses
1–2** · the `text` command, `render/measure.ts`, real measurer wiring, markdown-lite rendering ·
Phases 6–7.

## Open fix list — read 0090-REVIEW §9, 0091-REVIEW §5 and 0100-REVIEW §9 for the full text

Numbering follows 0090-REVIEW §9. Items 2–13, 15–21 unchanged and open unless noted.

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
21. **F12 (0119-REVIEW) — open, DO NOT RE-LITIGATE.** `MIN(B1, B2)` = `0` vs `MIN(B1:B2)` = `#TYPE`
    on empty in-extent cells; compliant per D-110 clause 3.
22. **F13 (0127) — open, owed a ruling by the `text` command cycle.** A `formula`-driven `content`
    slot's inner references are untracked (`content` read `literal`-only, D-046's move); the object
    commits anyway. A MISSING `content` slot REFUSES the object (F20/0128). Since 0129 the same "must
    exist" now also binds `width`/`style.font`/`style.fontSize`/`style.lineHeight` (they feed
    `measuredHeight`). Not reachable today. See "Read this first" 0a.

## Known problems (detail lives where the pointer says)

- **A raw `setSlot` LOWERING `rows`/`cols` still strands any now-out-of-bounds cell slot** —
  `primitives/table.ts`'s header. Its EMPTY-cell sibling now refuses (fix-list item 20).
- **A `text` object must carry `content` + `width` + `style.font`/`fontSize`/`lineHeight` as slots,
  or it is refused (0129); a `formula`/`derived` `content` commits with inner references untracked**
  (fix-list item 22 / F13). Neither reachable today.
- **`measuredHeight` is `#MEASURE` for every real document** until `render/measure.ts` + context
  threading land (D-118 working as ruled).
- **Q-021 is a provisional choice** — `TextMeasurer.measure`'s `maxWidth` and where wrapping lives.
- **`resolveTextDependencyAddresses` and `deriveEdges` Source 1 are a hand-maintained PAIR (D-119).**
- **`main.ts`'s `start` is untested code and keeps growing.** Verified live, not by assertion.
- **The properties panel positions an off-screen selected object's panel clamped to a canvas edge.**
- **The chrome layout is UNSEEN beyond entry 0094's anchor fix.** **D-095**: no collision avoidance
  until a human asks; D-101 clause 3 extends that to panels.
- **A prompt sequence still shows nothing where you clicked** — ruled **D-090**, queued.
- **The formula-driven indicator is read NARROWLY** — `origin.x`/`origin.y` only.
- **A printable keystroke does not reach the command input unless it is focused** — D-088 clauses
  2–4 not built. **No command history** (**D-089**, queued).
- **Every pointer move repaints the canvas and rewrites the whole log's `textContent`; every panel
  not currently editing is rebuilt whole every paint.** Immediate-mode, unmeasured, acceptable
  (Rule 5).
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
  a `text` object (D-114), through the same `isEmptyInExtentCell` predicate.
- **`text.test.ts`'s `expectError` helper is unused** — kept deliberately for D-118's `#MEASURE`
  test... which 0129 wrote WITHOUT it (used `toMatchObject`). `expectError` is now genuinely unused;
  a future cycle may remove it or the next test author may reach for it.
- **Eight §5.10 commands have no registry entry** — `polyline`/`text`/`script`/`image`/`explode`/
  `addvertex`/`delvertex` wait on a schema or an `Operation` kind (`text` has a schema, no command);
  **`pan` waits on Q-012**.
- **`createObjectFromCommand`'s "type has no schema" branch is uncovered**, as are
  `describeSlotValue`'s `Point`/`Point[]` arms.
- **A 1000×1000 table is legal and costs ~1.5 s per MUTATION.** Rule 5's accepted trade (D-077 c3).
- **`renderer.ts`'s `formatCellValue`, `props.ts`'s `describeSlotValue`, and `mutation.ts`'s
  `describeDimensionSlotValue` are three separate `Value`-to-text formatters** — deliberate.
- **`primitives/text.ts` imports `primitives/table.ts`** and `import type`s `DerivedSlotComputeDeps`
  from `primitives/schema.ts` — mirroring the `geometry.ts` ⇄ `schema.ts` type-only cycle. It also
  now imports `hasRealMeasurer` + `TextStyle` (value + type) from `eval-context.ts` (a leaf — no
  cycle). `text.ts` CANNOT import `mutation.ts` (D-119).
- **Carried unchanged, each with its pointer:** `set-formula` is a `kind` not a registry name ·
  comment debt in TEST files only · mixed line endings in the WORKING TREE only (`core.autocrlf=true`)
  · dangling-reference messages name the DEPENDENT not the missing SOURCE · D-022's bounded-correctness
  claim fails for `table` · `describeValueType` duplicated in `functions.ts`/`eval.ts` ·
  `rewrite`/`repairObjectFormulaAddresses` walk `formula` slots only · journal structure unvalidated
  beyond `Array.isArray` · `lexer.ts`'s two edge cases · §5.11's `style` field · `noUnusedLocals` off
  · `.gitattributes` still owed.

## Settled — do not re-raise

Every ruling in `DECISIONS.md` (D-001 through **D-119**) binds without restatement here.

**D-114 / D-115 / D-116 / D-117 ARE BUILT IN FULL AND REVIEWED (0126/0127, cleared 0128).**

**D-118 (0125-REVIEW) — BUILT (0129), pending review.** `measuredHeight` returns `#MEASURE` (a new
sixth `ErrorCode`) when it can see only `NULL_EVAL_CONTEXT`'s measurer; `hasRealMeasurer`
(`eval-context.ts`) is the detector; `evaluate`/`mutate` still forward `context` untouched.

**D-119 (0128-REVIEW) — RULED, RECONCILED.** The `resolveTextDependencyAddresses` / `deriveEdges`
Source 1 pair; change one → change both; a third consumer forces extraction.

**Implemented AND reviewed, do not re-build:** D-097/D-098/D-099 · D-100 · D-101/D-106/D-102 · D-107 ·
D-081 + D-083 c4 · Phase 4's gate test · D-109 clause 3 · D-110 in full · **D-114/D-115/D-116/D-117.**

**NOT implemented, each owned by a named future cycle:** **D-104** (§5.10's row/column commands) ·
**D-108** (§5.11's load path; clause 3 binds every cycle before it) · **D-109 clauses 1–2** (cell
decimals + clipping, `render/` only).

**Q-014 and Q-018 are CLOSED.** **Q-013 is NOT mooted.** **Q-016 and Q-017 remain OPEN**, both the
human's, neither blocking. **Q-019 → D-116**, **Q-020 → D-117** — both BUILT and REVIEWED (0128).
**Q-021 (0129) is OPEN** — reversible provisional (a) taken (widen `measure` with `maxWidth?`,
wrapping in the measurer), tagged at `eval-context.ts` + `primitives/text.ts`. Next free: **Q-022**.

**D-046 STANDS AND DOES NOT MOVE.** A dimension slot is read `literal`-only and fails closed to `0`.
This is what makes D-110 / D-114 safe. `content` (0127) inherits the same posture.

**D-094's fourteen clauses stand** · **D-096's four clauses stand** (0129's `TEXT_*_PATH` move is a
named divergence).

**From 0091-REVIEW:** **D-088** (clause 1 built, 2–4 queued) · **D-089** (queued) · **D-090**
(queued) · **D-091**. **From 0090-REVIEW:** D-084–D-087 implemented. Still owed, unchanged: **D-074**.

## Live PROVISIONAL tags and open questions

**`PROVISIONAL(Q-021)` → `src/engine/eval-context.ts`** (`TextMeasurer.measure`'s `maxWidth`
parameter) and **`src/engine/primitives/text.ts`** (`computeMeasuredHeight`, the `width` → `maxWidth`
line): does `measuredHeight` become width-aware by the measurer wrapping (a — taken), by not
wrapping (b), or by an engine-side wrap loop (c)? The human's, non-blocking, reversible.

**`PROVISIONAL(Q-012)` → `src/render/renderer.ts`** and **`src/render/slots.ts`**: world units or
screen pixels for stroke width / cell size / font? Provisional (a) world units. Due with the
`style`-slots cycle.

**`PROVISIONAL(Q-008)` → `src/engine/graph/node.ts`** (`-0`): open, deferred, blocking nothing.

**No other `PROVISIONAL` tags exist.** Q-016/Q-017 deliberately have none.

## Gotchas for the next model

- **`TEXT_SCHEMA` has TWO derived slots now.** Any code that assumed one — `grep` for
  `derivedSlots` / `resolvedContent` / `measuredHeight` before touching the schema.
- **A `text` object needs `content`/`width`/`style.font`/`style.fontSize`/`style.lineHeight` as
  slots or `mutate` refuses it** (dangling edge into `measuredHeight`). The `text` command must
  create them with defaults. This is 0129's main downstream consequence.
- **`measuredHeight` is `#MEASURE` everywhere until a real `TextMeasurer` is threaded through
  `mutate`.** That is D-118, not a bug. `render/measure.ts` (unbuilt) + context threading is the
  cycle that fixes it.
- **`hasRealMeasurer` checks the MEASURER, not the context object.** `{ measurer:
  NULL_EVAL_CONTEXT.measurer }` is still "no real measurer".
- **Q-021's provisional: `TextMeasurer.measure(text, style, maxWidth?)`.** Line-breaking is the
  measurer implementation's job. If the human rules otherwise, `computeMeasuredHeight`'s body and/or
  the interface param change — two sites tagged.
- **`#MEASURE` is a real `ErrorCode` now** (`graph/node.ts`), sixth after `#SCRIPT`. It is only ever
  produced by `measuredHeight` and never serialized (derived values are not — §5.11).
- **`computeMeasuredHeight`'s failure order** — upstream `ErrorValue` → `#MEASURE` → `#TYPE` → the
  height. Pinned; reviewer question 4 asks whether it is right.
- **`TEXT_*_PATH` constants live in `primitives/text.ts` now**, not `schema.ts` (0129 move). `schema.ts`
  imports them.
- **The block tree is parsed in TWO places every mutation** and must NOT be cached (D-114 clause 4).
- **A mutation-check's red count grows over time** as later cycles add coverage for the same rule —
  that is not a discrepancy (0128's read of 0126's numbers; applies to 0129's own too).
- **The operator cannot see what you can see.** A text box that silently renders empty or
  zero-height is the injury D-116 and D-118 are ruled against.
