# STATUS — as of entry 0131 (batching — 0131 not yet reviewed)

STATE: **GREEN** (compiles, all tests pass). Both configs compile, **1418/1418** tests pass,
0 skipped, 0 `.only`. **30 test files** (0131 added `src/render/measure.test.ts`).
**PHASE 5 IS OPEN.** Last review point: **0130-REVIEW-phase5**, verdict ACCEPT WITH EDITS.
Cycles since last review: **1/3** · diff since last review: **392 lines / 9 files (cap 800/10)**.

**ENTRY 0131 — `render/measure.ts` IS BUILT (NOT YET REVIEWED).** The Canvas2D-backed `TextMeasurer`
(`engine/eval-context.ts`'s interface, Rule 1's seam): `createCanvas2dTextMeasurer(ctx)` →
a `measure` that splits on `/\r?\n/`, greedily word-wraps each hard line to `maxWidth` (**D-120**),
measures each line with `ctx.measureText`, and returns `{ width: widestLine, height: lineCount *
lineHeight }` — never throwing, always finite/non-negative (`eval-context.ts`'s contract, with
defensive guards for NaN/`0`/negative `fontSize`/`lineHeight`/`maxWidth`, a non-finite `measureText`
width, a blank family). 19 tests. **It has NO consumers yet** — the wiring slice is next.

**Q-021 → D-120 IS RECONCILED (0131).** Every `PROVISIONAL(Q-021)` tag is removed and swapped for a
`(D-120)` citation (`eval-context.ts`, `primitives/text.ts` ×3, `primitives/schema.ts`, and the test
descriptions that carried the label). `grep -rnE "PROVISIONAL\(Q-021\)" src/` → nothing. The prose
explaining why `maxWidth` exists stays (D-120's reconciliation note). **No `PROVISIONAL(Q-021)` site
remains; it is off the Live PROVISIONAL list.**

**ENTRY 0129 — `measuredHeight` IS BUILT AND REVIEWED (0130-REVIEW).** `TEXT_SCHEMA.derivedSlots` has
TWO entries. `measuredHeight`'s `static` deps: `resolvedContent` + `width` +
`style.font`/`fontSize`/`lineHeight` (§5.6; `color`/`align` omitted). Its compute,
`primitives/text.ts`'s **`computeMeasuredHeight`**, is a pass-through: read the five slots, propagate
any upstream `ErrorValue`, then `#MEASURE` if only the null measurer is wired (**D-118**), then `#TYPE`
for an unusable style, then `context.measurer.measure(resolvedText, style, maxWidth)`, then `#TYPE`
if that height is non-finite (**F21**, 0130-REVIEW). `#MEASURE` is a **sixth `ErrorCode`**
(`graph/node.ts`) — D-028's move, sanctioned by D-118 c2; derived values never serialize.

**FIVE `text` SLOTS ARE EFFECTIVELY-REQUIRED (0129).** `measuredHeight`'s `static` deps make
`deriveEdges` emit an edge from `width`/`style.font`/`style.fontSize`/`style.lineHeight`/
`resolvedContent` into `measuredHeight` every mutation. An edge may never point at a slot that does
not exist (§5.1.1), so a `text` object created without one of those five is **refused** — same
mechanism that refuses an `add` node with no `in.a`. `height`/`overflow`/`style.color`/`style.align`
stay optional. **The `text` command cycle MUST create all nine non-derived slots + both derived
placeholders**, with defaults (F13/F20's neighbour).

**STILL UNBUILT IN PHASE 5 (the wiring slice is what closes most of this):**
- **Threading a real `EvalContext` through the non-test `mutate` callers.** `main.ts` must build an
  `EvalContext` around `createCanvas2dTextMeasurer` (its own separate offscreen 2D context) and pass
  it through: `command/commands.ts`'s `executeCommand` (×4 `mutate` calls, lines ~374/571/706/753 —
  `executeCommand` needs a `context` param), `engine/document.ts:380` (loader), `render/interaction.ts:291`
  (drag). This is the slice that makes `measuredHeight` stop being `#MEASURE`. Touches load-bearing
  `document.ts` (§6.2) → likely `REVIEW: REQUIRED`.
- **The `text` command.** `command/parser.ts` + `commands.ts` `text` handler (move `text` out of
  `COMMANDS_SPECIFIED_BUT_NOT_BUILT`), creating a `text` object with all nine non-derived slots +
  both derived placeholders and sensible `style` defaults (settles F13/F20 + 0129's five-required
  consequence). **Owes the F13 ruling** (a `formula`-driven `content` slot — refuse it, à la D-046?
  §6.1 trigger 3).
- **`render/renderer.ts`'s text-drawing pass**, markdown-lite rendering, layout — all unbuilt.

**`measuredHeight` REPORTS `#MEASURE` FOR EVERY REAL DOCUMENT** until the threading slice lands
(D-118 working as ruled — loud, not silent). A real `text` object also lights §5.9's error badge
until then.

**PHASE 4 IS PASSED AND ITS GATE IS CLOSED.** 0116-REVIEW closed the gate; 0119-REVIEW cleared
0117/0118. §6.2's block on starting a later phase was lifted there and has not been re-armed.

**Separately owed and unchanged: D-109 clauses 1–2** (cell decimals + clipping, `render/` only) ·
**Q-017** (table headers, the human's) · **D-108** (loader AST shape validation) · **D-104** (table
resize bounds).

---

## Read this first — what a cold reader needs

**0. `render/measure.ts` EXISTS BUT IS WIRED TO NOTHING.** It implements `engine/eval-context.ts`'s
`TextMeasurer`. Its `MeasurementContext` type (`{ font: string; measureText(t): { width } }`) a real
`CanvasRenderingContext2D` satisfies with no cast. Line-breaking lives HERE (D-120), never in
`src/engine/`.

**0a. `TEXT_SCHEMA` HAS BOTH DERIVED SLOTS.** `resolvedContent` (0127) and `measuredHeight` (0129).
`getObjectSchema("text").derivedSlots` has length 2.

**0b. A WELL-FORMED `text` OBJECT HAS 9 NON-DERIVED + 2 DERIVED SLOTS.** `content` + `width` +
`style.font`/`fontSize`/`lineHeight` are **required** (they feed a derived slot → dangling-edge
refusal if absent — 0129). `height`/`overflow`/`style.color`/`style.align` are optional. Both derived
placeholders (`{ kind: "derived", value: null }`) are required by D-018. Not reachable today (no
`text` command).

**0c. `measuredHeight` READS `context.measurer` AND RETURNS `#MEASURE` UNTIL A REAL MEASURER IS
THREADED THROUGH `mutate` (D-118).** `hasRealMeasurer(context)` (`eval-context.ts`) is the detector —
it checks the *measurer* is not `NULL_TEXT_MEASURER`. Failure order in `computeMeasuredHeight`:
upstream `ErrorValue` → `#MEASURE` → `#TYPE` (unusable style) → `#TYPE` (non-finite height — F21) →
the height.

**1. PHASE 4'S GATE TEST IS `main.test.ts`'s LAST DESCRIBE BLOCK, AND IT IS THE PHASE'S ONLY
PROTECTION.** Seven tests over one document. Do not weaken; do not fold.

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

**7. D-104 IS OWED BY A CYCLE THAT HAS NOT BEEN SCHEDULED.** `insertTableLine`/`deleteTableLine` are
not bounded by `MIN`/`MAX_TABLE_LINES`. Not command-reachable today. Fix in `findInvalidTableResizes`.

**8. D-108 IS OWED BY §5.11's LOAD CYCLE, AND ITS CLAUSE 3 BINDS EVERY CYCLE BEFORE IT.**
`deserializeDocument`'s "never throws" is FALSE for a malformed loaded `ast`. **Do not "fix" it by
guarding a single walker.** Not operator-reachable today.

**9. D-081 AND D-083 CLAUSE 4 ARE BUILT (0112) AND REVIEWED (0113).**

**10. THE TEXT BLOCK TREE IS DERIVED STATE, RE-PARSED FROM `content` ON DEMAND, NEVER CACHED (D-114
clause 4).** Re-parsed in TWO places every mutation — `resolveTextDependencyAddresses`
(edge-derivation) and `computeResolvedContent` (evaluation) — over the SAME staged object list. A
broken span becomes an `error`-kind `Block` (**D-115**); its parsed branches live in `orphaned`.

**11. THE PAPERCLIP CANNOT REACH A TABLE CELL.** Cell values must be TYPED. §5.4's formula bar /
in-place cell editing is NOT built.

**12. `evaluateDerivedSlot`'s `read` RUNS THE D-110 COERCION BEFORE THE D-013 MEMBERSHIP CHECK
(D-114 clause 3).** Do not swap them. `isEmptyInExtentCell` and `buildRangeReader` (`graph/eval.ts`)
are shared by `evaluateFormula` AND `evaluateDerivedSlot` (D-114 clause 2).

**13. `resolveTextDependencyAddresses` and `deriveEdges` Source 1 are a hand-maintained PAIR with no
compiler link (D-119).** Change one → change both, same cycle, log names both.

**14. A broken embedded span is marked `!` in place (D-116 parse / D-117 runtime), never blanks the
box; `evaluateBlockTree` always returns a `string`.**

## Next slice (recommended)

**The `EvalContext` threading slice.** `main.ts` builds an `EvalContext` around
`createCanvas2dTextMeasurer` (a fresh offscreen 2D context, kept separate from the renderer's so
setting `font` there never disturbs a draw), and threads it through every non-test `mutate` caller:
add a `context` parameter to `command/commands.ts`'s `executeCommand` and forward it to the four
`mutate` calls; forward one through `engine/document.ts`'s loader; forward one through
`render/interaction.ts`'s drag. This makes `measuredHeight` stop being `#MEASURE`. Touches
load-bearing `document.ts` (§6.2) — expect `REVIEW: REQUIRED`. Then, separately, **the `text`
command** (owes the F13 ruling). The render-only alternative (**D-109 clauses 1–2** + **Q-017**
headers, the smallest un-owed items) is unchanged.

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
threading (0125-REVIEW; D-118) · `!`-marked broken-span rendering + `text` schema entry,
`resolvedContent`, D-114's `evaluateDerivedSlot` widening (0128-REVIEW: ACCEPT WITH EDITS; D-119) ·
`measuredHeight` (§5.6's second `text` derived slot) + `#MEASURE` `ErrorCode` + `TextMeasurer.measure`'s
`maxWidth` + `hasRealMeasurer` (**0130-REVIEW: ACCEPT WITH EDITS; F21 fixed; D-120 answers Q-021**).

## Built this batch, not yet reviewed

- **entry 0131** — `src/render/measure.ts` (the Canvas2D `TextMeasurer`, 19 tests) + Q-021 → D-120
  reconciliation (every `PROVISIONAL(Q-021)` tag removed, `(D-120)` cited; doc/comment only). No
  logic changed in any engine file. Load-bearing `primitives/schema.ts` touched comment-only.

## Not started

D-090's prompt-sequence preview · §5.9's per-vertex drag path ·
`polyline`/`explode`/`addvertex`/`delvertex` · `style` slots as authorable (the `text` `style.*`
paths are declared; nothing writes them) · point-in-polygon fill hit-testing (D-067) · §5.4's
formula bar / in-place cell editing · D-088 clauses 2–4 · D-089 · D-102 clause 9 · **D-109 clauses
1–2** · the `EvalContext` threading slice, the `text` command, `renderer.ts`'s text pass, markdown-lite
rendering · Phases 6–7.

## Open fix list — read 0090-REVIEW §9, 0091-REVIEW §5 and 0100-REVIEW §9 for the full text

Numbering follows 0090-REVIEW §9. Items 2–13, 15–22 unchanged and open unless noted.

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
22. **F13 (0127) — open, owed a ruling by the `text` command cycle.** A `formula`-driven `content`
    slot's inner references are untracked; the object commits anyway. A MISSING `content` slot
    REFUSES the object (F20/0128). Since 0129 the same "must exist" binds `width`/`style.font`/
    `style.fontSize`/`style.lineHeight` too. Not reachable today.
23. **F21 (0130-REVIEW) — CLOSED in the same review.** `computeMeasuredHeight`'s non-finite →
    `#TYPE` guard, mirroring `add`'s compute. +1 test.

## Known problems (detail lives where the pointer says)

- **A raw `setSlot` LOWERING `rows`/`cols` still strands any now-out-of-bounds cell slot** —
  `primitives/table.ts`'s header.
- **A `text` object must carry `content` + `width` + `style.font`/`fontSize`/`lineHeight` as slots,
  or it is refused (0129); a `formula`/`derived` `content` commits with inner references untracked**
  (fix-list item 22 / F13). Neither reachable today.
- **`measuredHeight` is `#MEASURE` for every real document** until the `EvalContext` threading slice
  lands (D-118 working as ruled). Consequence: a real `text` object lights §5.9's error badge until
  then — self-resolves when wired. `render/measure.ts` (0131) is built and tested but has NO caller.
- **`resolveTextDependencyAddresses` and `deriveEdges` Source 1 are a hand-maintained PAIR (D-119).**
- **`main.ts`'s `start` is untested code and keeps growing.** Verified live, not by assertion. Its
  "nothing evaluates text yet" NOT-DONE-HERE framing is stale since 0127; 0131 fixed the one bullet
  about injecting a measurer, the rest is that batch's debt.
- **The properties panel positions an off-screen selected object's panel clamped to a canvas edge.**
- **The chrome layout is UNSEEN beyond entry 0094's anchor fix.** **D-095**: no collision avoidance
  until a human asks; D-101 clause 3 extends that to panels.
- **A prompt sequence still shows nothing where you clicked** — ruled **D-090**, queued.
- **The formula-driven indicator is read NARROWLY** — `origin.x`/`origin.y` only.
- **A printable keystroke does not reach the command input unless it is focused** — D-088 clauses
  2–4 not built. **No command history** (**D-089**, queued).
- **Every pointer move repaints the canvas and rewrites the whole log's `textContent`.**
  Immediate-mode, unmeasured, acceptable (Rule 5).
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
- **`text.test.ts`'s `expectError` helper is unused** — kept deliberately; a future test author may
  reach for it or remove it.
- **`render/measure.ts` measures markdown markup verbatim** (`**bold**`/`# heading` count toward the
  string) — §5.6 says "from `resolvedContent`", which holds the markup; a markdown-aware measurer is
  a later cycle's option (D-120's "the measurer's job" framing allows it). Flagged in `measure.ts`.
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
  imports `hasRealMeasurer` + `TextStyle` from `eval-context.ts` (a leaf — no cycle). `text.ts`
  CANNOT import `mutation.ts` (D-119).
- **Carried unchanged, each with its pointer:** `set-formula` is a `kind` not a registry name ·
  comment debt in TEST files only · mixed line endings in the WORKING TREE only (`core.autocrlf=true`)
  · dangling-reference messages name the DEPENDENT not the missing SOURCE · D-022's bounded-correctness
  claim fails for `table` · `describeValueType` duplicated in `functions.ts`/`eval.ts` ·
  `rewrite`/`repairObjectFormulaAddresses` walk `formula` slots only · journal structure unvalidated
  beyond `Array.isArray` · `lexer.ts`'s two edge cases · §5.11's `style` field · `noUnusedLocals` off
  · `.gitattributes` still owed.

## Settled — do not re-raise

Every ruling in `DECISIONS.md` (D-001 through **D-120**) binds without restatement here.

**D-114 / D-115 / D-116 / D-117 ARE BUILT IN FULL AND REVIEWED (0126/0127, cleared 0128).**

**D-118 (0125-REVIEW) — BUILT (0129), REVIEWED (0130).** `measuredHeight` returns `#MEASURE` when it
can see only `NULL_EVAL_CONTEXT`'s measurer; `hasRealMeasurer` (`eval-context.ts`) is the detector.

**D-119 (0128-REVIEW) — RULED, RECONCILED.** The `resolveTextDependencyAddresses` / `deriveEdges`
Source 1 pair; change one → change both; a third consumer forces extraction.

**D-120 (0130-REVIEW) — RULED, answers Q-021. RECONCILED at entry 0131.** `TextMeasurer.measure(text,
style, maxWidth?)` stays; line-breaking lives in the measurer implementation (`render/measure.ts`,
built 0131), never `src/engine/`; `maxWidth` = the `width` slot iff numeric. Every
`PROVISIONAL(Q-021)` tag is gone.

**Implemented AND reviewed, do not re-build:** D-097/D-098/D-099 · D-100 · D-101/D-106/D-102 · D-107 ·
D-081 + D-083 c4 · Phase 4's gate test · D-109 clause 3 · D-110 in full · **D-114/D-115/D-116/D-117** ·
**D-118.**

**NOT implemented, each owned by a named future cycle:** **D-104** (§5.10's row/column commands) ·
**D-108** (§5.11's load path; clause 3 binds every cycle before it) · **D-109 clauses 1–2** (cell
decimals + clipping, `render/` only).

**Q-014 and Q-018 are CLOSED.** **Q-013 is NOT mooted.** **Q-016 and Q-017 remain OPEN**, both the
human's, neither blocking. **Q-019 → D-116**, **Q-020 → D-117** — both BUILT and REVIEWED (0128).
**Q-021 → D-120 (0130-REVIEW), RECONCILED (0131).** Next free: **Q-022**.

**D-046 STANDS AND DOES NOT MOVE.** A dimension slot is read `literal`-only and fails closed to `0`.
`content` (0127) inherits the same posture.

**D-094's fourteen clauses stand** · **D-096's four clauses stand** (0129's `TEXT_*_PATH` move is a
named divergence).

**From 0091-REVIEW:** **D-088** (clause 1 built, 2–4 queued) · **D-089** (queued) · **D-090**
(queued) · **D-091**. **From 0090-REVIEW:** D-084–D-087 implemented. Still owed, unchanged: **D-074**.

## Live PROVISIONAL tags and open questions

**`PROVISIONAL(Q-012)` → `src/render/renderer.ts`** and **`src/render/slots.ts`**: world units or
screen pixels for stroke width / cell size / font? Provisional (a) world units. Due with the
`style`-slots cycle.

**`PROVISIONAL(Q-008)` → `src/engine/graph/node.ts`** (`-0`): open, deferred, blocking nothing.

**`PROVISIONAL(Q-021)` — GONE.** Reconciled at entry 0131 (D-120). No site remains.

**No other `PROVISIONAL` tags exist.** Q-016/Q-017 deliberately have none.

## Gotchas for the next model

- **`render/measure.ts` is built but has NO caller.** The next slice wires it: `main.ts` builds an
  `EvalContext` around `createCanvas2dTextMeasurer(<its own offscreen 2D ctx>)` and threads it
  through `executeCommand` (needs a `context` param) → the four `mutate` calls, plus `document.ts`'s
  loader and `render/interaction.ts`'s drag. That is what makes `measuredHeight` stop being
  `#MEASURE`.
- **`MeasurementContext`** (`render/measure.ts`) is a hand-written structural type, not
  `Pick<CanvasRenderingContext2D, …>` — a real ctx satisfies it, a fake needs only `font` +
  `measureText`, no cast.
- **`TEXT_SCHEMA` has TWO derived slots.** `grep` for `derivedSlots` / `resolvedContent` /
  `measuredHeight` before touching the schema.
- **A `text` object needs `content`/`width`/`style.font`/`style.fontSize`/`style.lineHeight` as
  slots or `mutate` refuses it** (dangling edge into `measuredHeight`). The `text` command must
  create them with defaults.
- **`hasRealMeasurer` checks the MEASURER, not the context object.**
- **`#MEASURE` is a real `ErrorCode`** (`graph/node.ts`), sixth after `#SCRIPT`. Only ever produced
  by `measuredHeight`, never serialized.
- **`computeMeasuredHeight`'s failure order** — upstream `ErrorValue` → `#MEASURE` → `#TYPE`
  (unusable style) → `#TYPE` (non-finite height, F21) → the height.
- **`TEXT_*_PATH` constants live in `primitives/text.ts`**, not `schema.ts` (0129 move).
- **The block tree is parsed in TWO places every mutation** and must NOT be cached (D-114 clause 4).
- **`resolveTextDependencyAddresses` and `deriveEdges` Source 1 are a hand-maintained PAIR** (D-119).
- **The operator cannot see what you can see.** A text box that silently renders empty or
  zero-height is the injury D-116 and D-118 are ruled against.
