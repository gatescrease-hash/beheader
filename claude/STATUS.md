# STATUS — as of entry 0132 (batch since 0130-REVIEW — **awaiting review**, cap reached)

STATE: **GREEN** (compiles, all tests pass). Both configs compile, **1427/1427** tests pass,
0 skipped, 0 `.only`. **30 test files**. **PHASE 5 IS OPEN.** Last review point: **0130-REVIEW-phase5**,
verdict ACCEPT WITH EDITS. Cycles since last review: **2/3** · diff since last review:
**~792 lines / 16 src files** — the **§6.3 file cap (10) is exceeded** and the line count is at
~800, so **the batch stops here for review** (entries 0131 + 0132).

**ENTRY 0132 — THE Canvas2D `TextMeasurer` IS WIRED (NOT YET REVIEWED).** `main.ts`'s `start` builds
one `EvalContext` around `createCanvas2dTextMeasurer` (entry 0131) over its **own separate offscreen
2D context**, and threads it through every non-test `mutate` caller: `command/commands.ts`'s
`executeCommand` (→ its 4 `mutate` calls, via `createObjectFromCommand`/`writeSlot`/`renameObject`/
`deleteObject`), `render/interaction.ts`'s `pointerMove` (the drag), and `engine/document.ts`'s
`deserializeDocument`/`loadDocument` (the loader). Each gained an optional trailing
`context: EvalContext = NULL_EVAL_CONTEXT`, forwarded to `mutate` and never inspected. `main.ts`'s
pure transitions (`submitLine`/`respondToPrompt`/`pointerDownAt`/`pointerMoveTo`/`commitPanelEdit`/
`unlinkPanelSlot`) took the same optional param — threaded per call (like `Viewport`), NOT stored on
`AppState`. **A `text` object loaded from JSON now gets a real, wrap-aware `measuredHeight`** (D-120's
`maxWidth` = the numeric `width` slot) instead of `#MEASURE`.

**`document.ts` (LOAD-BEARING, §6.2) HAS AN UNREVIEWED SIGNATURE CHANGE.** `loadDocument(json,
context?)` and `deserializeDocument(raw, context?)` — additive optional param, forwarded to the load
batch's one `mutate` call. No validation logic touched (D-108 clause 3 untouched).

**ENTRY 0131 — `render/measure.ts` IS BUILT (NOT YET REVIEWED).** The Canvas2D-backed `TextMeasurer`:
`createCanvas2dTextMeasurer(ctx)` → a `measure` that splits on `/\r?\n/`, greedily word-wraps each
hard line to `maxWidth` (**D-120**), measures each line with `ctx.measureText`, returns
`{ width: widestLine, height: lineCount * lineHeight }` — never throwing, always finite/non-negative,
with defensive guards. 19 tests. As of 0132 it has ONE real caller: `main.ts`'s `evalContext`.

**Q-021 → D-120 IS RECONCILED (0131).** Every `PROVISIONAL(Q-021)` tag is gone, `(D-120)` cited.
`grep -rnE "PROVISIONAL\(Q-021\)" src/` → nothing.

**ENTRY 0129 — `measuredHeight` IS BUILT AND REVIEWED (0130-REVIEW).** `TEXT_SCHEMA.derivedSlots`
has TWO entries. `measuredHeight`'s `static` deps: `resolvedContent` + `width` +
`style.font`/`fontSize`/`lineHeight`. Its compute, `primitives/text.ts`'s **`computeMeasuredHeight`**,
is a pass-through: propagate any upstream `ErrorValue`, then `#MEASURE` if only the null measurer is
wired (**D-118**), then `#TYPE` for an unusable style, then `context.measurer.measure(resolvedText,
style, maxWidth)`, then `#TYPE` if that height is non-finite (**F21**). `#MEASURE` is a **sixth
`ErrorCode`** (`graph/node.ts`); derived values never serialize.

**FIVE `text` SLOTS ARE EFFECTIVELY-REQUIRED (0129).** `measuredHeight`'s `static` deps make
`deriveEdges` emit an edge from `width`/`style.font`/`style.fontSize`/`style.lineHeight`/
`resolvedContent` into `measuredHeight` every mutation, so a `text` object created without one of
those five is **refused** (§5.1.1's dangling-edge mechanism). `height`/`overflow`/`style.color`/
`style.align` stay optional. **The `text` command MUST create all nine non-derived slots + both
derived placeholders**, with defaults (F13/F20's neighbour).

**STILL UNBUILT IN PHASE 5:**
- **The `text` command.** `command/parser.ts` + `commands.ts` `text` handler (move `text` out of
  `COMMANDS_SPECIFIED_BUT_NOT_BUILT`), creating a `text` object with all nine non-derived slots +
  both derived placeholders and sensible `style` defaults (settles F13/F20 + 0129's five-required
  consequence). **Owes the F13 ruling** (a `formula`-driven `content` slot — refuse it, à la D-046?
  §6.1 trigger 3). This is the next slice — the measurer is now wired, so a created `text` object
  gets a real `measuredHeight` immediately (in the running app).
- **A `text` object's POSITION.** §5.6's `TextBox` has no `origin` slot — `content`/`width`/`height`/
  `overflow`/`style.*` only. Nothing decides where a text box sits on the canvas yet; the `text`
  command's `x=`/`y=` need somewhere to land (an `origin` slot? a schema question). Not touched by
  0132.
- **`render/renderer.ts`'s text-drawing pass**, markdown-lite rendering, layout — all unbuilt. A
  `text` object draws as nothing today.

**`measuredHeight` IS `#MEASURE` FOR EVERY DOCUMENT A USER CAN CURRENTLY MAKE** — because there is no
`text` command, the only way to get a `text` object into the running app is `load`, and a loaded one
now measures for real (0132). D-118 is working as ruled: loud, not silent.

**PHASE 4 IS PASSED AND ITS GATE IS CLOSED.** 0116-REVIEW closed the gate; 0119-REVIEW cleared
0117/0118. §6.2's block on starting a later phase was lifted there and has not been re-armed.

**Separately owed and unchanged: D-109 clauses 1–2** (cell decimals + clipping, `render/` only) ·
**Q-017** (table headers, the human's) · **D-108** (loader AST shape validation) · **D-104** (table
resize bounds).

---

## Read this first — what a cold reader needs

**0. THE MEASURER IS WIRED (0132) BUT NO USER-REACHABLE `text` OBJECT EXISTS.** `main.ts:start`
builds `evalContext` from `createCanvas2dTextMeasurer` over a SECOND offscreen 2D context (never the
renderer's — `measure` sets `ctx.font` per line). It flows through `executeCommand`, `pointerMove`,
`loadDocument`, and `main.ts`'s pure transitions, all via an optional trailing `context` param
(default `NULL_EVAL_CONTEXT`). Only a LOADED `text` object exercises it until the `text` command
lands.

**0a. `render/measure.ts` — line-breaking lives HERE (D-120), never in `src/engine/`.** Its
`MeasurementContext` type (`{ font: string; measureText(t): { width } }`) a real
`CanvasRenderingContext2D` satisfies with no cast.

**0b. `TEXT_SCHEMA` HAS BOTH DERIVED SLOTS.** `resolvedContent` (0127) and `measuredHeight` (0129).
`getObjectSchema("text").derivedSlots` has length 2.

**0c. A WELL-FORMED `text` OBJECT HAS 9 NON-DERIVED + 2 DERIVED SLOTS.** `content` + `width` +
`style.font`/`fontSize`/`lineHeight` are **required** (dangling-edge refusal if absent — 0129).
`height`/`overflow`/`style.color`/`style.align` are optional. Both derived placeholders
(`{ kind: "derived", value: null }`) are required by D-018. The minimal well-formed shape (5
non-derived + 2 derived) is what `mutation.test.ts`/`eval.test.ts`/`0132`'s new tests hand-build.

**0d. `computeMeasuredHeight`'s failure order** — upstream `ErrorValue` → `#MEASURE` → `#TYPE`
(unusable style) → `#TYPE` (non-finite height, F21) → the height. `hasRealMeasurer(context)`
(`eval-context.ts`) checks the *measurer* is not `NULL_TEXT_MEASURER`.

**1. PHASE 4'S GATE TEST IS `main.test.ts`'s LAST `describe` OVER ONE DOCUMENT.** Seven tests. Do
not weaken; do not fold.

**2. D-110's DISCLOSED CONSEQUENCE — `refs` HAS TWO FORMS (D-112).** `refs <cell>` reports the
CURRENT edge set; `refs <object>` derives its blocking half without the target. **Neither may be
"fixed" to match the other.**

**3. THE PANEL IS FULLY BUILT AND FULLY REVIEWED — DO NOT RE-BUILD ANY OF IT.** D-094/D-100/D-101/
D-106/D-102/D-107 all implemented and reviewed. **Q-014 is CLOSED in code.**

**4. A panel-typed STRING reaches a FORMULA slot, never a literal one.** Correct per D-102 clause 6;
**Q-016** carries the grammar question.

**5. `main.ts`'s DOM half (`start`) IS UNTESTED BY CONSTRUCTION (D-001) AND KEEPS GROWING.** As of
0132 it also builds `evalContext` and passes it into every DOM listener — checked by hand and by
the pure-half tests that prove those functions thread `context` when given one, not by any assertion
over `start`.

**6. THE VANISHING-TABLE DEFECT IS FIXED (entry 0101) — D-097/D-098/D-099 are CLOSED.**

**7. D-104 IS OWED BY A CYCLE THAT HAS NOT BEEN SCHEDULED.** `insertTableLine`/`deleteTableLine` are
not bounded by `MIN`/`MAX_TABLE_LINES`. Not command-reachable today. Fix in `findInvalidTableResizes`.

**8. D-108 IS OWED BY §5.11's LOAD CYCLE, AND ITS CLAUSE 3 BINDS EVERY CYCLE BEFORE IT.**
`deserializeDocument`'s "never throws" is FALSE for a malformed loaded `ast`. **Do not "fix" it by
guarding a single walker.** 0132 added a forwarded `context` param there but touched no validation.

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

**15. `EvalContext` IS THREADED PER CALL, NOT STORED (0132).** `executeCommand(cmd, doc, context?)`,
`pointerMove(..., context?)`, `loadDocument(json, context?)`, and `main.ts`'s six pure transitions
all take an optional trailing `context`. The internal `commands.ts` handlers take it as a REQUIRED
param (compiler-enforced threading); only the public entry points default it to `NULL_EVAL_CONTEXT`.

## Next slice (recommended)

**The `text` command.** `command/parser.ts` grammar + `commands.ts` handler, moving `text` out of
`COMMANDS_SPECIFIED_BUT_NOT_BUILT`. It must create a `text` object with all nine non-derived slots +
both derived placeholders and sane `style` defaults (settles F13/F20 and 0129's five-required
consequence), and it **owes the F13 ruling** — a `formula`-driven `content` slot: refuse it à la
D-046, or track its inner references? That is **§6.1 trigger 3** (brief ambiguity on something
load-bearing), so that cycle likely escalates rather than completing. It also runs into the
**position question** (§5.6's `TextBox` has no `origin` slot — where does `text x=… y=…` land?),
which may itself be an open question. The render-only alternative (**D-109 clauses 1–2** +
**Q-017** headers) is unchanged and needs no ruling.

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
D-119) · `measuredHeight` (§5.6's second `text` derived slot) + `#MEASURE` `ErrorCode` +
`TextMeasurer.measure`'s `maxWidth` + `hasRealMeasurer` (**0130-REVIEW: ACCEPT WITH EDITS; F21 fixed;
D-120 answers Q-021**).

## Built this batch, not yet reviewed

- **entry 0131** — `src/render/measure.ts` (the Canvas2D `TextMeasurer`, 19 tests) + Q-021 → D-120
  reconciliation (doc/comment only). No engine logic changed. Load-bearing `primitives/schema.ts`
  touched comment-only.
- **entry 0132** — threading a real `EvalContext` from `main.ts` through `executeCommand`,
  `pointerMove`, and `deserializeDocument`/`loadDocument` (each +optional trailing `context`), and
  through `main.ts`'s pure transitions. +9 tests across `commands.test.ts`/`interaction.test.ts`/
  `document.test.ts`/`main.test.ts`. **Load-bearing `engine/document.ts` signature change**
  (additive optional param, no validation logic touched).

## Not started

D-090's prompt-sequence preview · §5.9's per-vertex drag path ·
`polyline`/`explode`/`addvertex`/`delvertex` · `style` slots as authorable (the `text` `style.*`
paths are declared; nothing writes them) · point-in-polygon fill hit-testing (D-067) · §5.4's
formula bar / in-place cell editing · D-088 clauses 2–4 · D-089 · D-102 clause 9 · **D-109 clauses
1–2** · the `text` command, a `text` object's position, `renderer.ts`'s text pass, markdown-lite
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
- **`measuredHeight` is `#MEASURE` for every document a USER can make** — no `text` command, so the
  only `text` object reachable is a LOADED one, which now (0132) measures for real. D-118 working
  as ruled.
- **`render/measure.ts` (0131) has exactly one caller** — `main.ts`'s `evalContext` (0132). No test
  file drives it through `main.ts`; the wiring is pinned by pure-half tests over
  `executeCommand`/`pointerMove`/`loadDocument`.
- **A `text` object has no position.** §5.6's `TextBox` shape omits `origin`; `TEXT_SCHEMA` follows
  it. `render/interaction.ts`'s drag would find no origin slots and do nothing. The `text` command
  cycle has to decide where `x=`/`y=` land.
- **`resolveTextDependencyAddresses` and `deriveEdges` Source 1 are a hand-maintained PAIR (D-119).**
- **`main.ts`'s `start` is untested code and keeps growing.** Verified live, not by assertion. Its
  "nothing evaluates text yet" framing is stale since 0127; 0131 fixed the injecting-a-measurer
  bullet and 0132 rewrote it (the injection is now done) — the rest of that batch's doc debt stands.
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
- **`text.test.ts`'s `expectError` helper is unused** — kept deliberately.
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

Every ruling in `DECISIONS.md` (D-001 through **D-120**) binds without restatement here.

**D-114 / D-115 / D-116 / D-117 ARE BUILT IN FULL AND REVIEWED (0126/0127, cleared 0128).**

**D-118 (0125-REVIEW) — BUILT (0129), REVIEWED (0130), WIRED (0132, unreviewed).** `measuredHeight`
returns `#MEASURE` when it can see only `NULL_EVAL_CONTEXT`'s measurer; `main.ts` now threads a real
one through `executeCommand` / `pointerMove` / `loadDocument`.

**D-119 (0128-REVIEW) — RULED, RECONCILED.** The `resolveTextDependencyAddresses` / `deriveEdges`
Source 1 pair; change one → change both; a third consumer forces extraction.

**D-120 (0130-REVIEW) — RULED, answers Q-021. RECONCILED at entry 0131.** `TextMeasurer.measure(text,
style, maxWidth?)`; line-breaking lives in `render/measure.ts` (built 0131, wired 0132), never
`src/engine/`; `maxWidth` = the `width` slot iff numeric.

**Implemented AND reviewed, do not re-build:** D-097/D-098/D-099 · D-100 · D-101/D-106/D-102 · D-107 ·
D-081 + D-083 c4 · Phase 4's gate test · D-109 clause 3 · D-110 in full · **D-114/D-115/D-116/D-117** ·
**D-118** (the `#MEASURE` guard; its wiring is 0132, unreviewed).

**NOT implemented, each owned by a named future cycle:** **D-104** (§5.10's row/column commands) ·
**D-108** (§5.11's load path; clause 3 binds every cycle before it) · **D-109 clauses 1–2** (cell
decimals + clipping, `render/` only).

**Q-014 and Q-018 are CLOSED.** **Q-013 is NOT mooted.** **Q-016 and Q-017 remain OPEN**, both the
human's, neither blocking. **Q-019 → D-116**, **Q-020 → D-117** — BUILT and REVIEWED (0128).
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

**No other `PROVISIONAL` tags exist.** Q-016/Q-017 deliberately have none.

## Gotchas for the next model

- **The batch is at the §6.3 file cap (16 src files > 10) and awaiting review.** Do not start
  another slice on top of 0131 + 0132 — hand off. The next slice (the `text` command) starts after
  the review clears.
- **`EvalContext` is threaded PER CALL, not on `AppState`.** `executeCommand(cmd, doc, context?)`,
  `pointerMove(..., context?)`, `loadDocument(json, context?)`, `deserializeDocument(raw, context?)`,
  and `main.ts`'s `submitLine`/`respondToPrompt`/`pointerDownAt`/`pointerMoveTo`/`commitPanelEdit`/
  `unlinkPanelSlot` — all optional trailing, default `NULL_EVAL_CONTEXT`. `commands.ts`'s internal
  handlers take it REQUIRED so a new `mutate`-reaching handler can't forget it.
- **`main.ts` builds a SECOND offscreen 2D context for measurement** — never the renderer's
  `context` (measure.ts sets `ctx.font` per line). A `null` second context → `NULL_EVAL_CONTEXT`
  fallback (`#MEASURE`, loud).
- **No `text` command exists.** Every `text`-object test hand-builds one (5 required non-derived + 2
  derived) or loads it from JSON.
- **`MeasurementContext`** (`render/measure.ts`) is a hand-written structural type — a real ctx
  satisfies it, a fake needs only `font` + `measureText`, no cast.
- **`TEXT_SCHEMA` has TWO derived slots.** `grep` for `derivedSlots` / `resolvedContent` /
  `measuredHeight` before touching the schema.
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
