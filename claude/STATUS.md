# STATUS — as of entry 0127

STATE: **GREEN** (compiles, all tests pass). Both configs compile, **1375/1375** tests pass,
0 skipped, 0 `.only`.
**PHASE 5 IS OPEN. THE WIRING BATCH IS AT ITS §6.3 CAP AND STOPPED FOR REVIEW.** Two cycles since
0125-REVIEW — **0126** (D-116 + D-117's `!` display in `evaluateBlockTree`) and **0127** (the `text`
schema entry + `resolvedContent` + D-114). Batch additions **~923 lines / 10 files** (0126: 146/2;
0127: 777/10) — over the 800/10 cap. **Both cycles await ONE review.**
Last review point: **0125-REVIEW-phase5**, verdict ACCEPT WITH EDITS.
Cycles since last review: **2/3** · diff since last review: **923 lines / 10 files (cap 800/10 — HIT)**.

**ENTRY 0127 — `text` IS A REAL OBJECT TYPE (`resolvedContent` half). `primitives/schema.ts`'s
`TEXT_SCHEMA`**: nine `static` non-derived slot paths (`content`, `width`, `height`, `overflow`,
`style.font/fontSize/lineHeight/color/align`) and ONE derived slot, **`resolvedContent`**. Its
`dynamic` dependency resolver (`primitives/text.ts`'s `resolveTextDependencyAddresses`) and its
compute (`computeResolvedContent`) both re-parse `content` (never cached — **D-114** clause 4) and
evaluate the block tree through the SAME `read`/`readRange` a formula slot's AST gets. **D-114 is
BUILT IN FULL**: `graph/eval.ts`'s `evaluateDerivedSlot` widened so `read` runs D-110's
empty-in-extent coercion BEFORE the D-013 membership check (clause 3, pinned by a test that goes red
if the two are swapped — mutation-checked), and a real `readRange` (extracted `buildRangeReader`,
shared with `evaluateFormula`) handles an embedded `SUM(A1:A4)` (was `#PARSE`). An embedded range's
edges are expanded per cell by the SAME `enumerateRangeCellAddresses`; an empty in-extent cell gets
no edge (D-110 c4 / D-047 c1); an out-of-extent embedding is a dangling reference and refuses the
mutation (D-110 c6). The Phase 5 gate's **non-taken-branch reactivity** property is now real
end-to-end (`resolvedContent` re-resolves through the topological pass when a cell referenced only
in the dormant branch changes) — pinned in `eval.test.ts` and `mutation.test.ts`.

**SIGNATURE WIDENINGS 0127 MADE (all load-bearing, all additive/non-breaking):**
- `DerivedSlotCompute` gains a 4th optional param `deps?: DerivedSlotComputeDeps`
  (`{ readRange?: ReadRange; objects: readonly GraphObject[] }`) — the extra environment a compute
  needs ONLY to evaluate an embedded formula AST. The existing `context?: EvalContext` 3rd param is
  untouched (the `eval-context.test.ts` `DerivedSlotCompute`-typed fixtures still compile).
- `DerivedSlotDependencies`'s `dynamic.resolve` gains a 2nd param `objects` (name resolution + range
  expansion). Fewer-params-is-assignable → existing `schema.test.ts` fixture unchanged.
- `derivedSlotDependencyAddresses` gains a 3rd param `objects = []` (defaulted → static-only call
  sites + unit tests unchanged). `mutation.ts`'s `deriveEdges` Source 2 passes `objects`.
- `graph/eval.ts`'s `evaluateDerivedSlot` gains an `objects` param (from `evaluateSlot`).
- `graph/eval.ts` extracted `isEmptyInExtentCell` + `buildRangeReader` from `evaluateFormula`
  (verbatim behaviour — full range-test suite green), now shared by both slot kinds (D-114 clause 2).

**ENTRY 0126 — D-116 + D-117 ARE BUILT (pending this review).** `evaluateBlockTree` renders a
parse-broken span as `!` + its verbatim source (D-116) and a runtime-broken span as `!` + the error
CODE (D-117), and ALWAYS returns a `string`. `resolvedContent` (0127) inherits this: a broken
embedding never blanks the box, `resolvedContent` never holds an `ErrorValue` for a broken span.
Four `text.test.ts` expectations were flipped — authorised by D-116 clause 2 / D-117 (see 0126).

**WHAT IS STILL UNBUILT IN PHASE 5**, after 0127: **`measuredHeight`** (§5.6's other derived slot)
and its `TextMeasurer` call, carrying **D-118**'s null-measurer `#MEASURE` guard AND an unresolved
brief inconsistency — §5.6 lists `width` as a `measuredHeight` input, but Rule 1's / 0124's
`measure(text, style)` interface has no `width`. **The next cycle owns `measuredHeight` and MUST
raise Q-021 for that.** Also unbuilt: the `text` command (`COMMANDS_SPECIFIED_BUT_NOT_BUILT` still
lists `text`), `render/measure.ts`'s Canvas2D measurer, markdown-lite rendering, layout/wrapping,
and threading a real `EvalContext` through every non-test `mutate` caller (`command/commands.ts` ×4
lines 374/571/706/753, `engine/document.ts:380`, `render/interaction.ts:291`).

**D-118 (0125-REVIEW) — RULED, UNBUILT — owed by the `measuredHeight` cycle.** A `measuredHeight`
compute that can see only `NULL_EVAL_CONTEXT`'s null measurer MUST return an `ErrorValue` (suggested
`#MEASURE`), never height `0`. Note `#MEASURE` is not in `graph/node.ts`'s `ErrorCode` — that cycle
must widen it (a brief deviation D-118 sanctions, D-028's move) or use an existing code.

**PHASE 4 IS PASSED AND ITS GATE IS CLOSED.** 0116-REVIEW closed the gate; 0119-REVIEW cleared
0117/0118. §6.2's block on starting a later phase was lifted there and has not been re-armed.

**D-109 CLAUSE 3 (0117, reviewed 0119) and D-110 IN FULL (0118, reviewed 0119) are BUILT.** See
0119-REVIEW / DECISIONS. D-110's `read`-closure coercion is now shared by BOTH `evaluateFormula` and
`evaluateDerivedSlot` via `isEmptyInExtentCell` (0127) — one predicate, two call sites.

**Owed next: CYCLE 3 of the wiring batch — `measuredHeight` + D-118 + Q-021.** After the review of
this batch. It is a §6.1 trigger of its own (`primitives/schema.ts` load-bearing; likely `graph/node.ts`
for `#MEASURE`). Then, separately owed and unchanged: the `text` command + `render/measure.ts` +
context threading through every non-test `mutate` caller · **D-109 clauses 1–2** (cell decimals +
clipping, `render/` only) · **Q-017** (table headers).

Still unimplemented and unowned by the next cycle: **D-108** (loader AST shape validation, owed by
§5.11's file-input load cycle) · **D-104** (table resize bounds, owed by §5.10's row/column commands).

---

## Read this first — what a cold reader needs

**0. THE `text` SCHEMA ENTRY IS HALF-BUILT ON PURPOSE.** `resolvedContent` is real (0127);
`measuredHeight` is not. `TEXT_SCHEMA.derivedSlots` has exactly one entry. Do not read the missing
`measuredHeight` as a bug — it is the next cycle, and it is deferred because it drags in D-118 and
the width/wrapping question (§5.6 vs. the 0124 `TextMeasurer` interface).

**0a. `content` IS READ `literal`-ONLY (0127).** `resolveTextDependencyAddresses` and
`computeResolvedContent` both treat a `formula`/`derived`/missing `content` slot as "no references,
empty resolved text" — the Rule 6 guard `readTableDimension` applies to `rows`/`cols`. So a
`link`ed `content` would NOT track what its formula names. This is a **silent gap**, recorded in
Known problems, owed a ruling by the cycle that builds the `text` command (D-046's move for
dimensions). Not reachable today (no `text` command).

**1. PHASE 4'S GATE TEST IS `main.test.ts`'s LAST DESCRIBE BLOCK, AND IT IS THE PHASE'S ONLY
PROTECTION.** Seven tests over one document (`table_1` 4×4, `polygon_1` driven, `polygon_2`
driving): the whole document builds with no refusal and both bindings are `formula` **by KIND, not
only by value**; (a) `set table_1.A1 650` moves `polygon_1.origin.x` and its derived `centroid.x`;
(b) dragging `polygon_2` updates `table_1.B1` to twice its new `origin.x` in the same mutation;
(c) dragging `polygon_1` moves Y only and the log names `table_1.A1`; all three over ONE final
state; a real cycle is still refused and leaves `state.document` the same object; and §5.1's own
round trip through ONE object is accepted and propagates. **Do not weaken them; do not fold them
into another block.**

**2. WHY THE SEVENTH TEST EXISTS (0116-REVIEW, D-111 clause 2).** The gate document binds through
TWO polygons (`polygon_2 → table_1 → polygon_1`, a DAG), so `not.toContain("cyclic")` over it could
never fail. The discriminating shape is the round trip through ONE object — `table_1.A1 →
polygon_1.origin.x → polygon_1.centroid.x → table_1.C1` — legal, accepted, propagates in one pass.
`geometry.test.ts:418` is the one-directional half.

**3. D-110's DISCLOSED CONSEQUENCE — `refs` HAS TWO FORMS (D-112, 0119-REVIEW).** `refs <cell>`
reports the CURRENT edge set, so it does **not** name a formula reading a still-empty in-extent cell
(clause 4 working as ruled). `refs <object>` **does**, deriving its blocking half over the document
without the target. **Neither may be "fixed" to match the other.** Pinned in `commands.test.ts`.

**4. THE PANEL IS FULLY BUILT AND FULLY REVIEWED — DO NOT RE-BUILD ANY OF IT.** D-094 (display),
D-100 (selection), D-101 (N panels), D-106 (dismiss), D-102 (writing), D-107 (F1–F4) are ALL
implemented and reviewed. **Q-014 is CLOSED in code.**

**5. A panel-typed STRING reaches a FORMULA slot, never a literal one.** `"hello"` → a `formula`
slot holding that string; bare `hello` → a formula naming an object. Correct per D-102 clause 6;
**Q-016** carries the grammar question.

**6. `main.ts`'s DOM half (`start`) IS UNTESTED BY CONSTRUCTION (D-001) AND KEEPS GROWING.** Verified
live at 0109/0111 (Playwright, transient); entry 0117's own DOM line has not had a live run. Tests
reach `main.ts`'s PURE half only.

**7. THE VANISHING-TABLE DEFECT IS FIXED (entry 0101) — D-097/D-098/D-099 are CLOSED.**
`mutation.ts`'s `findInvalidDimensionWrites` rejects a `setSlot` that would leave `rows`/`cols`
non-`literal`, non-number, non-integer, or outside `MIN_TABLE_LINES..MAX_TABLE_LINES`. D-102's panel
writes inherit that refusal.

**8. D-104 IS OWED BY A CYCLE THAT HAS NOT BEEN SCHEDULED.** `insertTableLine`/`deleteTableLine` are
not bounded by `MIN_TABLE_LINES`/`MAX_TABLE_LINES`. Not reachable by any command today. Fix goes in
`findInvalidTableResizes`.

**9. D-108 IS OWED BY §5.11's LOAD CYCLE, AND ITS CLAUSE 3 BINDS EVERY CYCLE BEFORE THAT ONE.**
`deserializeDocument`'s "never throws" claim is FALSE for a malformed loaded `ast`. **Do not "fix"
it by guarding a single walker** — clause 3 forbids it. Not operator-reachable today.

**10. D-081 AND D-083 CLAUSE 4 ARE BUILT (0112) AND REVIEWED (0113).** `createObject`'s own name
passes `findInvalidNames`; a loaded formula's AST depth is checked in EXACTLY ONE place,
`document.ts`'s `reconstructSlot`.

**11. THE TEXT BLOCK TREE IS DERIVED STATE, RE-PARSED FROM `content` ON DEMAND, AND MUST NEVER BE
CACHED (D-114 clause 4).** `content` is a **literal** slot (any string is legal state); parsing
happens downstream. Since 0127 the tree is re-parsed in TWO places every mutation —
`resolveTextDependencyAddresses` (edge-derivation time) and `computeResolvedContent` (evaluation
time) — both over the SAME staged object list, so name→id resolution agrees (0119-REVIEW §3's
argument, now a third consumer). A broken span becomes an `error`-kind `Block` (**D-115**), carrying
the WHOLE construct's `source` + `start`; its parsed branches live in `orphaned`, walked by
`extractTextDependencies`, never rendered.

**12. THE PAPERCLIP CANNOT REACH A TABLE CELL.** Cell values must be TYPED. A table drawn as an
empty grid is empty, not broken. §5.4's formula bar / in-place cell editing is NOT built.

**13. `resolvedContent`'s EDGES include `content` ITSELF (0127).** §5.6: "from `content` plus every
referenced slot". `resolveTextDependencyAddresses` returns `[content, ...refs]`. This is what lets
`computeResolvedContent` `read` `content` under D-013, and what a future `formula`-content would
re-trigger on.

## Next slice (recommended)

**AFTER THE BATCH REVIEW: wiring batch cycle 3 — `measuredHeight` + D-118 + Q-021.** Add
`measuredHeight` to `TEXT_SCHEMA.derivedSlots` (`static` deps on `resolvedContent` + `width` +
`style.font/fontSize/lineHeight` per §5.6; compute in `primitives/text.ts` calling
`context.measurer`). **D-118**: a compute that sees only `NULL_EVAL_CONTEXT`'s null measurer returns
an `ErrorValue` (suggested `#MEASURE` — not in `ErrorCode`, so widen `graph/node.ts` or pick an
existing code and say why), never height `0`; one test covers that AND "is `context` threaded at
all" (D-118 clause 5). **Q-021 MUST be raised**: §5.6 says `measuredHeight` is computed "from
`resolvedContent`, `width`, and `style`", but 0124's `TextMeasurer.measure(text, style)` has no
`width` parameter — decide whether to widen the interface (reversible; `eval-context.ts` is not on
§6.2's list), and how wrapping reaches `measuredHeight`. Then, separately: the `text` command
(`command/parser.ts` + `commands.ts` + move `text` out of `COMMANDS_SPECIFIED_BUT_NOT_BUILT` in the
same cycle), `render/measure.ts`, context threading through every non-test `mutate` caller.
Independently, **D-109 clauses 1–2** and **Q-017**'s headers remain the smallest un-owed items for a
render-only slice.

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
D-083 clause 4 (0113-REVIEW: ACCEPT) · entry 0115's Phase 4 gate test (0116-REVIEW) · **entry 0117's
D-109 clause 3 + entry 0118's D-110 in full (0119-REVIEW; D-112, D-113)** · **entry 0120's
`primitives/text.ts` block-tree engine (0121-REVIEW; D-114, D-115, Q-019)** · entry 0122's D-116
data-shape + entry 0123's D-117 (rulings) · **entry 0124's `src/engine/eval-context.ts` +
`context` threading (0125-REVIEW; D-118)**.

## Built this batch, not yet reviewed

**Entry 0126 — D-116 + D-117 in `evaluateBlockTree`.** A parse-broken span renders `!` + verbatim
source; a runtime-broken span renders `!` + error CODE; the tree always returns a `string`.
`text.ts` +102/−69, `text.test.ts` +44/−14 (four expectations flipped — authorised by D-116 clause
2 / D-117).

**Entry 0127 — the `text` schema entry + `resolvedContent` + D-114.** `TEXT_SCHEMA` in
`primitives/schema.ts` (nine non-derived paths + `resolvedContent`); `resolveTextDependencyAddresses`
+ `computeResolvedContent` in `primitives/text.ts`; `graph/eval.ts`'s `evaluateDerivedSlot` widened
per D-114 (D-110 coercion before D-013 membership — clause 3, mutation-checked; shared
`buildRangeReader`); `DerivedSlotCompute` / `DerivedSlotDependencies.dynamic` / `derivedSlotDependencyAddresses`
signature widenings; `deriveEdges` Source 2 passes `objects`. `props.test.ts` fixture swapped
(`text`→`script`) + `main.test.ts` comment fixed — §6.1 trigger 5. +777/−101 across 10 files.
1342→1375 tests.

## Not started

D-090's prompt-sequence preview · §5.9's per-vertex drag path ·
`polyline`/`explode`/`addvertex`/`delvertex` · `style` slots (as authorable — the `text` `style.*`
paths are declared but nothing writes them) · point-in-polygon fill hit-testing (D-067) · §5.4's
formula bar / in-place cell editing · D-088 clauses 2–4 · D-089 · D-102 clause 9 · **D-109 clauses
1–2** · Phase 5's `measuredHeight` + D-118 + Q-021, the `text` command, `render/measure.ts`, the
real measurer wiring, markdown-lite rendering · Phases 6–7.

## Open fix list — read 0090-REVIEW §9, 0091-REVIEW §5 and 0100-REVIEW §9 for the full text

Numbering follows 0090-REVIEW §9. Items 2–13, 15–22 unchanged and open unless noted.

1. **DONE at entry 0112**, reviewed 0113.
2. **Give the missing-slot refusal a remedy.** Message only; narrowed by D-110 to the cases D-110
   clause 6 keeps refusing.
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
    on empty in-extent cells; all compliant per D-110 clause 3. D-110's cost paragraph forbids
    reopening.
22. **F13 (0127) — new, open, owed a ruling by the `text` command cycle.** A `formula`-driven
    `content` slot's references are untracked: `resolveTextDependencyAddresses` reads `content`
    `literal`-only (Rule 6, D-046's move). Not reachable today. See "Read this first" 0a.

## Known problems (detail lives where the pointer says)

- **A raw `setSlot` LOWERING `rows`/`cols` still strands any now-out-of-bounds cell slot** —
  `primitives/table.ts`'s header. Its EMPTY-cell sibling now refuses (fix-list item 20).
- **A `formula`/`derived`/missing `content` slot yields no `resolvedContent` references** — read
  `literal`-only (fix-list item 22). Not reachable today.
- **`measuredHeight` is unbuilt, and §5.6 vs. the 0124 `TextMeasurer` interface disagree about
  `width`** — the next cycle raises Q-021.
- **`main.ts`'s `start` is untested code and keeps growing.** Verified live, not by assertion.
- **The properties panel positions an off-screen selected object's panel clamped to a canvas edge.**
- **The chrome layout is UNSEEN beyond entry 0094's anchor fix.** **D-095**: no collision avoidance
  until a human asks; D-101 clause 3 extends that to panels.
- **A prompt sequence still shows nothing where you clicked** — ruled **D-090**, queued.
- **The formula-driven indicator is read NARROWLY** — `origin.x`/`origin.y` only.
- **A printable keystroke does not reach the command input unless it is focused** — D-088 clauses
  2–4 not built. **No command history** (**D-089**, queued; D-109 clause 4 says clause 3 does not
  discharge it).
- **Every pointer move repaints the canvas and rewrites the whole log's `textContent`; every panel
  not currently editing is rebuilt whole every paint.** Immediate-mode, unmeasured, acceptable
  (Rule 5). The one CORRECTNESS case (a row's own open input) is handled (D-102 clause 8).
- **`escape` is bound to the window.** Innermost-first order is STRUCTURAL (a row's `keydown`
  `stopPropagation`s).
- **`zoom`'s echoed line names the REQUEST; `main.ts` adds a second line with the RESULT** — D-082
  clause 5.
- **`format.ts`'s elision does not re-parse** — a disclosed round-trip exception.
- **A `delete` refusal can name the same dependent twice** — fix-list item 3.
- **`refs` names a range's START cell as the source** when the range's table is being removed.
- **Two sites ask the schema whether it declares a path** — `declaresSlotPath` and
  `resolveWritableSlot`'s inline check. A THIRD is forbidden.
- **`refs <address>` REFUSES for a cell of a table whose `rows` is a formula** (D-046) — unreachable
  by command (D-097), reachable via a loaded file.
- **SETTLED at 0118, REVIEWED 0119 — do not re-raise.** A bare reference to an EMPTY in-extent cell
  reads `0`, gets no edge (**D-110**). Outside the extent, or to an unknown object, the refusal
  stands (D-110 clause 6). Since 0127 this same coercion applies to an embedded `{= }` in a `text`
  object (D-114), through the same `isEmptyInExtentCell` predicate.
- **Eight §5.10 commands have no registry entry** — `polyline`/`text`/`script`/`image`/`explode`/
  `addvertex`/`delvertex` wait on a schema or an `Operation` kind (`text` now HAS a schema but no
  command); **`pan` waits on Q-012**.
- **`createObjectFromCommand`'s "type has no schema" branch is uncovered**, as are
  `describeSlotValue`'s `Point`/`Point[]` arms.
- **A 1000×1000 table is legal and costs ~1.5 s per MUTATION.** Rule 5's accepted trade (D-077 c3).
- **`renderer.ts`'s `formatCellValue`, `props.ts`'s `describeSlotValue`, and `mutation.ts`'s
  `describeDimensionSlotValue` are three separate `Value`-to-text formatters** — deliberate.
- **`primitives/text.ts` now imports `primitives/table.ts`** (for `enumerateRangeCellAddresses` /
  `isInExtentTableCellAddress`) and `import type`s `DerivedSlotComputeDeps` from `primitives/schema.ts`
  — mirroring the existing `geometry.ts` ⇄ `schema.ts` type-only cycle. `text.ts` CANNOT import
  `mutation.ts` (would close `mutation → schema → text → mutation`), which is why
  `resolveTextDependencyAddresses` re-implements `deriveEdges` Source 1's reference/range handling
  rather than sharing it.
- **Carried unchanged, each with its pointer:** `set-formula` is a `kind` not a registry name ·
  comment debt in TEST files only · mixed line endings in the WORKING TREE only (`core.autocrlf=true`)
  · dangling-reference messages name the DEPENDENT not the missing SOURCE · D-022's bounded-correctness
  claim fails for `table` · `describeValueType` duplicated in `functions.ts`/`eval.ts` ·
  `rewrite`/`repairObjectFormulaAddresses` walk `formula` slots only · journal structure unvalidated
  beyond `Array.isArray` · `lexer.ts`'s two edge cases · §5.11's `style` field · `noUnusedLocals` off
  · `.gitattributes` still owed.

## Settled — do not re-raise

Every ruling in `DECISIONS.md` (D-001 through **D-118**) binds without restatement here.

**D-114 IS BUILT IN FULL (0127).** An embedded `{= }`/`{? }` AST evaluates through the SAME
`read`/`readRange` a formula slot's AST gets — `graph/eval.ts`'s `evaluateDerivedSlot` widened, NOT
a second evaluation path; D-110 coercion consulted BEFORE D-013's membership check (clause 3, pinned
by a test that goes red if swapped); a real `readRange` on `enumerateRangeCellAddresses`
(`buildRangeReader`, shared with `evaluateFormula`); the block tree re-parsed every mutation, never
cached (clause 4). **D-115 IS BUILT (0121/0122).** **D-116 + D-117 ARE BUILT (0126)**, pending this
review — `evaluateBlockTree` always returns a `string`, a broken span marked `!` in place.

**D-118 (0125-REVIEW) — RULED, UNBUILT — owed by the `measuredHeight` cycle.** A measurement-needing
compute that sees only the null measurer returns an `ErrorValue`, never height `0`. `#MEASURE` is not
in `ErrorCode`.

**Implemented AND reviewed, do not re-build:** D-097/D-098/D-099 (0101/0102, cleared 0103) · D-100
(0104, cleared 0105) · D-101, D-106, D-102 (0107/0109, cleared 0110) · D-107 (0111, cleared 0113) ·
D-081 and D-083 clause 4 (0112, cleared 0113) · Phase 4's gate test (0115, cleared 0116) · **D-109
clause 3 (0117, cleared 0119) · D-110 in full (0118 + 0119's edit, cleared 0119).**

**NOT implemented, each owned by a named future cycle:** **D-104** (§5.10's row/column commands) ·
**D-108** (§5.11's load path; clause 3 binds every cycle before it) · **D-109 clauses 1–2** (cell
decimals + clipping, `render/` only) · **D-118** (the `measuredHeight` cycle).

**Q-014 and Q-018 are CLOSED.** **Q-013 is NOT mooted.** **Q-016 and Q-017 remain OPEN**, both the
human's, neither blocking. **Q-019 → D-116**, **Q-020 → D-117** — both BUILT at 0126, pending this
review. **No question was raised by entries 0122–0127.** Next free: **Q-021** — the `measuredHeight`
width/wrapping inconsistency, to be raised by the next cycle.

**D-046 STANDS AND DOES NOT MOVE.** A dimension slot is read `literal`-only and fails closed to `0`.
This is also what makes D-110 (and now D-114) safe. `content` (0127) inherits the same posture.

**D-094's fourteen clauses stand** (clause 10 superseded by D-102 clause 1; clause 3 generalised by
D-100 clause 8 and D-106 clause 5). **D-096's four clauses stand** — a ruling's file/move list is a
CEILING, its rationale governs a divergence, and a divergence must be named in the log entry (0127
names two: extracting `buildRangeReader`/`isEmptyInExtentCell` in `eval.ts`, and widening
`schema.test.ts`'s "no schema entry" list).

**From 0091-REVIEW (the human's session):** **D-088** (clause 1 built, 2–4 queued) · **D-089**
(queued) · **D-090** (queued) · **D-091** (the grey grid stands). **From 0090-REVIEW:** D-084–D-087
implemented. Still owed, unchanged: **D-074**.

## Live PROVISIONAL tags and open questions

**`PROVISIONAL(Q-012)` → `src/render/renderer.ts`** and **`src/render/slots.ts`**
(`DEFAULT_SHAPE_STROKE_WIDTH`, `TABLE_CELL_*`, `SELECTION_HIGHLIGHT_WIDTH`): world units or screen
pixels? Provisional (a) world units. Due with the `style`-slots cycle. `eval-context.ts`'s
`TextStyle` doc restates provisional (a) for `fontSize`/`lineHeight` without settling it.

**`PROVISIONAL(Q-008)` → `src/engine/graph/node.ts`** (`-0`): open, deferred, blocking nothing.

**No other `PROVISIONAL` tags exist.** Q-016/Q-017 deliberately have none (no operator can reach the
site). Q-021 is not yet raised, so has none.

## Gotchas for the next model

- **`text` HAS A SCHEMA NOW (0127) but only `resolvedContent`.** `getObjectSchema("text")` is no
  longer `undefined`. Any code that branched on `text` being schema-less has been updated
  (`props.test.ts`, `main.test.ts` comment); grep `type === "text"` / `"text"` before assuming.
  Creating a `text` object via `createObject` MUST include the `resolvedContent` derived-slot
  placeholder (`{ kind: "derived", value: null }`) or `validateIntegrity`'s D-018 check rejects it.
- **`measuredHeight` is deliberately NOT in `TEXT_SCHEMA` yet.** D-118 + Q-021 are why. Do not "add
  the missing slot" without reading D-118 and raising Q-021.
- **`DerivedSlotCompute`'s 4th param `deps?` is `undefined` only in isolated unit tests** — the same
  "optional for tests, always supplied in the pipeline" shape `context?` has. `evaluateDerivedSlot`
  always passes `{ readRange, objects }`.
- **`evaluateDerivedSlot`'s `read` runs the D-110 coercion BEFORE the D-013 membership check
  (D-114 clause 3).** Do not "tidy" it by checking membership first — an empty in-extent cell is
  edge-less by design (D-110 clause 4) and must still read `0`, not `#REF`. There is a test that
  goes red if you swap them.
- **`isEmptyInExtentCell` and `buildRangeReader` (`graph/eval.ts`) are shared by `evaluateFormula`
  AND `evaluateDerivedSlot`.** A change to either affects both slot kinds. That sharing IS D-114
  clause 2 ("never a second evaluation path").
- **The block tree is parsed in TWO places every mutation** — `resolveTextDependencyAddresses`
  (edges) and `computeResolvedContent` (values) — over the SAME staged object list, so name→id
  resolution cannot drift. This is the 0119-REVIEW §3 argument with a third consumer. Do NOT cache
  the tree to "avoid the double parse" (D-114 clause 4).
- **`resolveTextDependencyAddresses` mirrors `deriveEdges` Source 1's reference/range/D-110 logic by
  hand** because an import cycle forbids sharing (`text.ts` cannot import `mutation.ts`). If you
  change D-110/D-047 edge handling in `deriveEdges`, change it here too — they are a pair with no
  compiler link.
- **An out-of-extent embedded reference (`{= table_1.Z99 }` on an 8×8 table) REFUSES the whole
  mutation** (dangling reference, D-110 clause 6) — same as a cell formula. An IN-extent empty cell
  reads `0`. Do not confuse the two.
- **`NULL_EVAL_CONTEXT` measures every box as ZERO and never errors.** For `measuredHeight` (next
  cycle) that is a silent wrong value — **D-118** requires that compute to error instead.
- **D-116 + D-117 are BUILT (0126) but only reviewed as part of THIS batch.** The four flipped
  `text.test.ts` expectations are authorised (D-116 clause 2 / D-117); do NOT "restore" them.
- **The three countable claims a log entry makes — diff total, test counts, mutation-check red
  sets — are checked by every review.** 0127's: +777/−101 across 10 files; 1342→1375; the two
  mutation-checks reproduce 1 red and 2 red respectively, as stated.
- **A safety argument that rests on what another component currently does is only as durable as that
  component's current behaviour** (0121→0126's lesson). 0127's range-half safety rests on the
  resolver and `buildRangeReader` both calling `enumerateRangeCellAddresses` — a STRUCTURAL
  argument, not a behavioural one.
- **The operator cannot see what you can see.** Phase 5's own version: a text box that silently
  renders empty (a broken `content` slot, a null measurer) is the injury D-116 and D-118 are ruled
  against.
