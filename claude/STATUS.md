# STATUS — as of entry 0142-REVIEW-phase5

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

**0140's prerequisite is DONE AND REVIEWED.** `measuredWidth` (D-123) landed at entry 0141 and was
accepted at 0142-REVIEW, so D-125's overlay can be positioned from a box that is the real size of the
text. Order from here: **D-125**, then **D-124**, then the **load-hardening cycle** (D-126 + D-127 +
D-108, all one `document.ts` diff), then markdown-lite, then `overflow`, then the Phase 5 gate.

---

## Where the code actually is — as of entry 0142-REVIEW

STATE: **GREEN** (compiles, all tests pass). Both configs compile, **1482/1482** tests pass,
0 skipped, 0 `.only`. **30 test files.** **PHASE 5 IS OPEN.**

Last review point: **0142-REVIEW-phase5** (**ACCEPT**, no reviewer edits to source).
Cycles since last review: **0/3**. Diff since last review: **0 lines / 0 files** (cap 800/10).
**THE BATCH IS EMPTY — start the next slice.**

**Entry 0141 is reviewed and accepted.** D-123 is built in full and Q-024 is CLOSED, verified by
grep rather than taken on the entry's word. Two findings came out of the review, both about the LOAD
boundary, **neither a defect in entry 0141's code** — see the two new rulings below.

## Read this first — what a cold reader needs

**0. `TEXT_SCHEMA` HAS ELEVEN NON-DERIVED + THREE DERIVED SLOTS.** Non-derived: `origin.x`/`origin.y`
(D-121, front of the list) + `content` + `width`/`height`/`overflow` + five `style.*`. `content` +
`width` + `style.font`/`fontSize`/`lineHeight` are **effectively-required** (dangling-edge refusal if
absent — 0129). Derived: `resolvedContent` (dynamic deps), `measuredHeight` and `measuredWidth`
(static deps, **the SAME list** — one measurement answers both).

**0a. THE TWO MEASURED SLOTS ARE ONE MEASUREMENT (D-123 clause 2).** `measureTextBox`
(`primitives/text.ts`, private) owns the read set, the failure ladder and the single `measure` call.
`computeMeasuredHeight`/`computeMeasuredWidth` are pass-throughs picking `.height`/`.width`. **Do not
split them, do not give either its own reads, and do not add a failure case to one alone.** Failure
order: upstream `ErrorValue` → `#MEASURE` (no real measurer, D-118) → `#TYPE` (unusable style) →
`#TYPE` (non-finite width OR height) → the box. `hasRealMeasurer(context)` (`eval-context.ts`) checks
the *measurer* is not `NULL_TEXT_MEASURER`. A non-finite WIDTH `#TYPE`s `measuredHeight` too — entry
0141's one non-additive change, disclosed, pinned by test, and accepted at 0142-REVIEW.

**0b. `extent.ts`'s `text` box, both axes:** the fixed slot when positive-finite → the measurement
(`measuredWidth`/`measuredHeight`) when positive-finite → a fixed fallback (240 / 20). The fallback is
reached ONLY when nothing could measure (`#MEASURE`, D-118 — a test, or `main.ts` failing to get an
offscreen context). `undefined` for a `text` object with no `resolvedContent`. `hittest.ts`, the
selection highlight, the chrome anchor and `fit` all read this ONE box (D-066/D-010).

**0c. A HAND-BUILT `text` FIXTURE NEEDS ALL THREE DERIVED PLACEHOLDERS.** D-018 refuses an object
missing one, so every test that pushes a hand-built `text` object through `mutate` carries
`measuredWidth: { kind: "derived", value: null }`. Six test files do. A fixture that only goes through
`evaluate`/`objectExtent` does not need it.

**0d. `DEFAULT_TEXT_*` (`command/commands.ts`) are the handler's provisional pick** — `width`/`height`
`"auto"`, `overflow` `"visible"`, font `"sans-serif"`, fontSize `16`, lineHeight `20` (absolute, not a
ratio), color `"black"`, align `"left"`. §5.6 gives no defaults. Not `PROVISIONAL`-tagged (render
config, `set`-changeable). **`DEFAULT_TEXT_WIDTH` being `"auto"` is why `measuredWidth` is the normal
path, not an edge case.**

**0e. THE MEASURER IS BUILT, WIRED, AND REVIEWED (0133).** `main.ts:start` builds `evalContext` from
`createCanvas2dTextMeasurer` over a SECOND offscreen 2D context (never the renderer's) and threads it
through `executeCommand` / `pointerMove` / `loadDocument` / `deserializeDocument` and `main.ts`'s six
pure transitions, all via an optional trailing `context` param (default `NULL_EVAL_CONTEXT`). A `text`
object created through the running app measures for real; one created in a test with the default
context reports `#MEASURE` on BOTH measured slots (legitimate state, not a refusal).

**0f. `render/measure.ts` — line-breaking lives HERE (D-120), never in `src/engine/`.** `layOutLines`
splits on hard newlines, then greedily word-wraps each line only when `maxWidth` is a positive finite
number. `measure().width` is the WIDEST laid-out line — that is what `measuredWidth` holds.

**0g. `content` IS `literal`-ONLY (D-122).** The guard is in `command/commands.ts`'s `buildSlot`, not
in the engine. A loaded `formula` `content` slot commits with its inner references untracked — the
disclosed loaded-file gap, mirroring D-046's.

**0h. NEW — ADDING A DERIVED SLOT BREAKS PREVIOUSLY SAVED DOCUMENTS, TODAY (D-126).** Probed at
0142-REVIEW: a document saved before entry 0141 with a `text` object is REFUSED on load —
`text_1.measuredWidth is missing … (D-018)`. A `derived` slot's VALUE does not serialize (§5.11) but
its KEY does, and the loader treats the file's key set as authoritative. **D-120's and D-123's
rationales both assert the opposite; they are wrong on this point.** Ruled D-126: the loader must
reconstruct derived slots from the schema. Until that lands, **any cycle adding a derived slot states
the load consequence in its entry, in one line.**

**1. PHASE 4'S GATE TEST IS `main.test.ts`'s LAST-BUT-ONE `describe` OVER ONE DOCUMENT.** Seven tests
("PHASE 4'S ACCEPTANCE CRITERION"). Do not weaken; do not fold.

**2. D-110's DISCLOSED CONSEQUENCE — `refs` HAS TWO FORMS (D-112).** `refs <cell>` reports the CURRENT
edge set; `refs <object>` derives its blocking half without the target. **Neither may be "fixed" to
match the other.**

**3. THE PANEL IS FULLY BUILT AND FULLY REVIEWED — DO NOT RE-BUILD ANY OF IT.** D-094/D-100/D-101/
D-106/D-102/D-107 all implemented and reviewed. **Q-014 is CLOSED in code.** A selected `text` object's
panel lists three derived slots, mechanically (`props.ts` reads the schema).

**4. A panel-typed STRING reaches a FORMULA slot, never a literal one.** Correct per D-102 clause 6;
**Q-016** carries the grammar question.

**5. `main.ts`'s DOM half (`start`) IS UNTESTED BY CONSTRUCTION (D-001) AND KEEPS GROWING.**
**D-125 clause 7 binds the next cycle here:** the in-place editor's commit logic goes in the exported
pure half, NOT in `start`'s closure.

**6. THE VANISHING-TABLE DEFECT IS FIXED (entry 0101) — D-097/D-098/D-099 are CLOSED.**

**7. D-104 IS OWED BY A CYCLE THAT HAS NOT BEEN SCHEDULED.** `insertTableLine`/`deleteTableLine` are
not bounded by `MIN`/`MAX_TABLE_LINES`. Not command-reachable today. Fix in `findInvalidTableResizes`.

**8. D-108 NOW HAS AN OWNER — ITS OLD DEFERRAL WAS IMPOSSIBLE TO SATISFY (D-127).** D-108 clause 3
deferred the loader's malformed-AST throw to "the cycle that builds §5.11's file input," stating
`loadDocument` had no caller outside tests. **False, and false when written:** `main.ts`'s
`openDocument` has existed since **entry 0089**, and `save`/`load` are live registry entries. Probed
at 0142-REVIEW: all four of D-108 clause 1's AST shapes throw a `TypeError` out of `loadDocument`, and
because the call sits inside `file.text().then(...)` it surfaces as an **unhandled promise rejection**
— the operator picks a file and the program silently does nothing. D-108's clauses 1/2/4 stand;
**D-127** assigns the fix to the load-hardening cycle below. Still no piecemeal walker hardening.

**9. D-081 AND D-083 CLAUSE 4 ARE BUILT (0112) AND REVIEWED (0113).**

**10. THE TEXT BLOCK TREE IS DERIVED STATE, RE-PARSED FROM `content` ON DEMAND, NEVER CACHED (D-114
clause 4).** Re-parsed in TWO places every mutation. A broken span becomes an `error`-kind `Block`
(**D-115**); its parsed branches live in `orphaned`.

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

**15. `EvalContext` IS THREADED PER CALL, NOT STORED (0132, reviewed 0133).** Public entry points
default it to `NULL_EVAL_CONTEXT`; internal handlers take it REQUIRED.

**16. `TEXT_TYPE` (`graph/node.ts`) joins `TABLE_TYPE`.** Import it, never a bare `"text"` literal in
an equality check (D-009).

## Next slice (recommended)

**D-125 — in-place text entry. The human's ABSOLUTE PRIORITY, and its prerequisite is built AND
reviewed.** A DOM input overlaid on the canvas at the receiver's world position (`worldToScreen`, like
the properties panel), for a `text` object's `content` and for a table cell. Commits by synthesising a
`Command` and running `executeCommand` — copy `commitPanelEdit`/`runPanelCommand`, do not invent a
write path (Rule 2, D-069, D-102 c5). **Do not reuse `buildPanelSetCommand` for a `text` box** (it
would produce `=Hello world`, which D-122 refuses): `content` is always a literal `set`; a table cell
is Excel-style, `=` meaning formula. Commit logic goes in `main.ts`'s exported pure half, not in
`start` (D-125 c7). An empty text box must be visible and clickable while its editor is open, via the
editor's OWN overlay — do not loosen `extent.ts` to fake it (c6). §6.1 trigger 2 (first file of a new
subsystem) + trigger 3: report `REVIEW: REQUIRED`. **The overlay is now positioned from a correct
box** — an auto-width `text` object's extent is its real measured ink since 0141.

**Then D-124 — `text` placed by pointing.** A `prompts` entry on `parser.ts`'s `text` spec: one
`point` step, no content step, `buildFromPrompts` producing the same `TextCommand` with `content` `""`;
then D-125's editor opens on the new object. `PromptStep.accepts` does NOT widen. Read `prompt.ts`'s
`usesNamedForm` hazard note first — it is what keeps `text "hi"` and `text x=0 y=0 "hi"` working.

**Then the LOAD-HARDENING CYCLE — one `document.ts` diff discharging three owed things** (**D-126**,
**D-127**, and D-108's own reconciliation note). Its visible diff: (1) the loader reconstructs each
schema's declared derived slots instead of trusting the file's keys, so a schema extension stops
invalidating saved documents; (2) ONE `FormulaAst` shape validation at the load boundary — never a
guard per walker (D-108 c2/c3 stand); (3) `document.test.ts` extended to D-108 clause 1's four shapes
plus a serialize-under-N / load-under-N+1 round trip; (4) `openDocument`'s promise chain given a
rejection path so nothing reaches the console instead of `onRefused`; (5) the two "never throws" doc
claims corrected (D-108 c1). `document.ts` is §6.2 load-bearing — `REVIEW: REQUIRED`.

Then, in order: **markdown-lite rendering** — §5.6's exact list (`**bold**`, `*italic*`, `` `code` ``,
`# heading` 1–3, `- list item`, blank-line paragraph breaks), nothing more, in `renderer.ts`'s
`drawText`, and in the SAME cycle make `render/measure.ts` markup-aware so drawn and measured agree —
a markup-aware measurer now moves the BOX as well as the height, which is the point. Then
`overflow: "clip"`/`"ellipsis"` (small — read **D-123 clause 5** first). Then the **Phase 5 gate**: an
executable test over one document proving the §6 criterion, `REVIEW: REQUIRED` (§6.1 trigger 1).

Cheap adds while in there: a direct `link text_1.origin.y <cell>` test (0137-REVIEW §honesty).

**The render-only alternative, still needs no ruling:** **D-109 clauses 1–2** (cell decimal precision +
no cell-text clipping, `render/renderer.ts` only). **Q-017** headers remain the human's.

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
entry, `resolvedContent`, D-114's `evaluateDerivedSlot` widening (0128-REVIEW; D-119) ·
`measuredHeight` + `#MEASURE` `ErrorCode` + `TextMeasurer.measure`'s `maxWidth` + `hasRealMeasurer`
(0130-REVIEW; D-120 answers Q-021) · `render/measure.ts` (the Canvas2D `TextMeasurer`) + a real
`EvalContext` threaded from `main.ts` (0133-REVIEW; F22) · **0135-REVIEW: ACCEPT (no code)** — entry
0134's `text`-command escalation cleared; **D-121** (Q-022) and **D-122** (Q-023/F13) issued ·
**0137-REVIEW: ACCEPT WITH EDITS** — entry 0136's `text` command cleared. **Q-022 and Q-023 CLOSED.** ·
**0139-REVIEW: ACCEPT WITH EDITS** — entry 0138's text rendering cleared; **D-123** issued, answering
**Q-024** · **0142-REVIEW: ACCEPT** — entry 0141's `measuredWidth` cleared; **Q-024 CLOSED**;
**D-126** and **D-127** issued, both from probes, both about the LOAD boundary.

## Built this batch, not yet reviewed

**Nothing. The batch is empty.**

## Not started

D-090's prompt-sequence preview · §5.9's per-vertex drag path ·
`polyline`/`explode`/`addvertex`/`delvertex` · `style` slots as authorable · point-in-polygon fill
hit-testing (D-067) · §5.4's formula bar (in-place cell editing is now **D-125**, next) ·
**D-125's in-place editor + D-124's `text` prompt sequence** · **the load-hardening cycle (D-126 +
D-127 + D-108)** · D-088 clauses 2–4 · D-089 · D-102 clause 9 · **D-109 clauses 1–2** · markdown-lite
text rendering + a markup-aware measurer · `text` `overflow` clip/ellipsis · the Phase 5 gate test ·
Phases 6–7.

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
    `ast`.** Ruled **D-108**; **re-owned by D-127 (0142-REVIEW) — the old deferral was impossible to
    satisfy, and the defect is operator-reachable and silent.** Clause 3 still forbids piecemeal
    hardening meanwhile.
16. **F6 (0113-REVIEW) — a panel row's text can no longer be mouse-selected.** D-095 governs.
17. **F7/F8 (0114-REVIEW) — ruled D-109. F8 BUILT (0117), REVIEWED (0119); F7 (clauses 1–2) NOT
    BUILT.** Cell number precision + no cell-text clipping, both in `render/renderer.ts`.
18. **F9 (0116-REVIEW) — CLOSED in the same review.**
19. **F10 (0119-REVIEW) — CLOSED, ruled D-112.**
20. **F11 (0119-REVIEW) — open, no owner.** Shrinking a table's extent under a formula reading an
    empty in-extent cell is REFUSED. Correct per D-110 clause 6.
21. **F12 (0119-REVIEW) — open, DO NOT RE-LITIGATE.** `MIN(B1, B2)` vs `MIN(B1:B2)` on empty
    in-extent cells; compliant per D-110 clause 3.
22. **F13 (0127) — RULED D-122, BUILT (0136), REVIEWED (0137). CLOSED.**
23. **F21 (0130-REVIEW) — CLOSED**, and WIDENED at 0141: the non-finite guard now covers the measured
    WIDTH as well as the height (D-123 clause 2). Reviewed and accepted at 0142.
24. **F22 (0133-REVIEW) — CLOSED in the same review.**
25. **F23 (0142-REVIEW) — RULED D-126, NOT BUILT.** Adding a derived slot to a schema invalidates
    every previously saved document carrying that object type. Owned by the load-hardening cycle.
26. **F24 (0142-REVIEW) — RULED D-127, NOT BUILT.** D-108's deferral condition could never fire; the
    malformed-AST throw is operator-reachable and surfaces as a silent no-op. Same cycle as F23.

## Known problems (detail lives where the pointer says)

- **A raw `setSlot` LOWERING `rows`/`cols` still strands any now-out-of-bounds cell slot** —
  `primitives/table.ts`'s header.
- **A saved document does not survive a derived-slot addition** — **D-126**, fix-list 25. Probed at
  0142-REVIEW. Reachable today: `save`/`load` are both built.
- **A malformed loaded `ast` throws out of `loadDocument`, and `openDocument` swallows it as an
  unhandled promise rejection** — **D-108 + D-127**, fix-list 26. The operator sees nothing at all.
- **A loaded document can carry a `formula`/`derived` `content` slot on a `text` object** — the `text`
  command refuses to create one (D-122), but the loader has no such guard. Exactly D-046's loaded-file
  posture. Disclosed in `primitives/text.ts`.
- **BOTH measured slots are `#MEASURE` for a `text` object created in a test** (default
  `NULL_EVAL_CONTEXT`), so its extent falls back to 240×20 there. Through the running app `main.ts`
  threads a real measurer. D-118 working as ruled.
- **`measure.ts` and `renderer.ts` fall back DIFFERENTLY for an unusable `style.*` slot, and that also
  moves the BOX's width.** The measurer takes an unusable `lineHeight` as `fontSize` and returns a ZERO
  box for an unusable `fontSize`; `resolveTextStyle` substitutes `DEFAULT_TEXT_LINE_HEIGHT` (20) /
  `DEFAULT_TEXT_FONT_SIZE` (16) and draws anyway. So for a LOADED document carrying a `#TYPE` style on
  a multi-line `text` object, `measuredWidth`/`measuredHeight` are both `0`, the extent falls back to
  240×20, and the ink is N real lines. Disclosed in both headers; unfixed — one shared set of fallbacks
  needs a ruling on which file owns them. **D-123 clause 5 forbids fixing it from the renderer's side.**
- **`extent.ts`'s `text` box trusts the stored measurement; `renderer.ts` re-wraps with its own `ctx`.**
  **0139-REVIEW ruled this stays as it is** (D-123 clause 5): the box follows the text, never the reverse.
- **An empty-`content` `text` object is invisible AND unselectable** — no ink, no extent, so no hit box,
  no chrome, no name label, no panel. Correct per D-066. **This is load-bearing for the NEXT cycle:**
  D-124 creates exactly this object and hands it to D-125's editor. **D-125 clause 6 rules the fix — the
  EDITOR's own overlay draws the box and caret; `extent.ts` is NOT loosened.**
- **NOBODY HAS SEEN THE NEW TEXT BOX ON SCREEN.** Entry 0141 says so itself and 0142-REVIEW confirms it:
  every claim is engine-side or through `objectExtent`. A human clicking beside a short text label is
  the check neither model can perform. Worth doing before the Phase 5 gate.
- **`x`/`y` are OPTIONAL for the `text` command (default `0`, per D-121 clause 3)** but REQUIRED for
  `circle`/`polygon`/`rect`/`table`. **0137-REVIEW confirmed it is intended.** (D-124 makes the pointing
  path the normal one, which is the real answer.)
- **`DEFAULT_TEXT_*` style values (`command/commands.ts`) are the handler's provisional pick** — no
  ruling, no `PROVISIONAL` tag (render config, `set`-changeable).
- **`resolveTextDependencyAddresses` and `deriveEdges` Source 1 are a hand-maintained PAIR (D-119).**
  (The `measuredHeight`/`measuredWidth` pair is NOT one of these — 0141 gave them a single shared helper
  precisely so the compiler enforces their agreement.)
- **`main.ts`'s `start` is untested code and keeps growing.** Verified live, not by assertion.
- **The properties panel positions an off-screen selected object's panel clamped to a canvas edge.**
- **The chrome layout is UNSEEN beyond entry 0094's anchor fix.** **D-095** / D-101 clause 3.
- **A prompt sequence still shows nothing where you clicked** — ruled **D-090**, queued.
- **The formula-driven indicator is read NARROWLY** — `origin.x`/`origin.y` only.
- **A printable keystroke does not reach the command input unless it is focused** — D-088 clauses 2–4
  not built. **No command history** (**D-089**, queued).
- **Every pointer move repaints the canvas and rewrites the whole log's `textContent`.** Rule 5.
- **`escape` is bound to the window.** Innermost-first order is STRUCTURAL.
- **`zoom`'s echoed line names the REQUEST; `main.ts` adds a second line with the RESULT** — D-082 c5.
- **`format.ts`'s elision does not re-parse** — a disclosed round-trip exception.
- **A `delete` refusal can name the same dependent twice** — fix-list item 3.
- **`refs` names a range's START cell as the source** when the range's table is being removed.
- **Two sites ask the schema whether it declares a path** — `declaresSlotPath` and
  `resolveWritableSlot`'s inline check. A THIRD is forbidden.
- **`refs <address>` REFUSES for a cell of a table whose `rows` is a formula** (D-046) — unreachable by
  command (D-097), reachable via a loaded file.
- **SETTLED at 0118, REVIEWED 0119 — do not re-raise.** A bare reference to an EMPTY in-extent cell
  reads `0`, gets no edge (**D-110**). Since 0127 the same coercion applies to an embedded `{= }`.
- **`text.test.ts`'s `expectError` helper is unused** — kept deliberately.
- **`schema.test.ts`'s new derived-slot assertion compares `derivedSlots[2]` to `[1]` by index** — it
  would keep passing if a fourth slot were inserted between them. Noted at 0142-REVIEW; fine today.
- **`render/measure.ts` measures markdown markup verbatim AND `renderer.ts` draws it verbatim** —
  deliberately consistent for now. The markdown-lite cycle moves both. §5.6's exact list only.
- **Seven §5.10 commands have no registry entry** — `polyline`/`script`/`image`/`explode`/
  `addvertex`/`delvertex` wait on a schema or an `Operation` kind; **`pan` waits on Q-012**.
- **`createObjectFromCommand`'s "type has no schema" branch is uncovered**, as are `describeSlotValue`'s
  `Point`/`Point[]` arms.
- **A 1000×1000 table is legal and costs ~1.5 s per MUTATION.** Rule 5's accepted trade (D-077 c3).
- **`renderer.ts`'s `formatCellValue`, `props.ts`'s `describeSlotValue`, and `mutation.ts`'s
  `describeDimensionSlotValue` are three separate `Value`-to-text formatters** — deliberate.
- **`primitives/text.ts` imports `primitives/table.ts`** and `import type`s `DerivedSlotComputeDeps`
  from `primitives/schema.ts`. It also imports `hasRealMeasurer` + `TextStyle` from `eval-context.ts`
  (a leaf — no cycle). `text.ts` CANNOT import `mutation.ts` (D-119).
- **Carried unchanged, each with its pointer:** `set-formula` is a `kind` not a registry name · comment
  debt in TEST files only · mixed line endings in the WORKING TREE only (`core.autocrlf=true`) ·
  dangling-reference messages name the DEPENDENT not the missing SOURCE · D-022's bounded-correctness
  claim fails for `table` · `describeValueType` duplicated in `functions.ts`/`eval.ts` ·
  `rewrite`/`repairObjectFormulaAddresses` walk `formula` slots only · journal structure unvalidated
  beyond `Array.isArray` · `lexer.ts`'s two edge cases · §5.11's `style` field · `noUnusedLocals` off ·
  `.gitattributes` still owed.

## Settled — do not re-raise

Every ruling in `DECISIONS.md` (D-001 through **D-127**) binds without restatement here.

**D-114 / D-115 / D-116 / D-117 ARE BUILT IN FULL AND REVIEWED (0126/0127, cleared 0128).**

**D-118 — BUILT (0129), REVIEWED (0130), WIRED (0132), WIRING REVIEWED (0133).**

**D-119 (0128-REVIEW) — RULED, RECONCILED.** The `resolveTextDependencyAddresses` / `deriveEdges`
Source 1 pair; change one → change both; a third consumer forces extraction.

**D-120 (0130-REVIEW) — RULED, answers Q-021. BUILT + WIRED + REVIEWED (0133).** **Note: its rationale's
claim that "no stored document can depend on the answer" is WRONG about the slot KEY — see D-126.**

**D-121 (0135-REVIEW) — RULED, answers Q-022. BUILT (0136), REVIEWED (0137).**

**D-122 (0135-REVIEW) — RULED, answers Q-023 / F13. BUILT (0136), REVIEWED (0137).**

**D-123 (0139-REVIEW) — RULED, answers Q-024. BUILT (0141), REVIEWED AND ACCEPTED (0142).** All five
clauses implemented and each pinned by a test. **Clause 5 binds every render cycle:** the box follows
the text, the text NEVER follows the box — only §5.6's `overflow` slot may reduce what is drawn.

**D-124 (0140-RULINGS) — RULED BY THE HUMAN. NOT BUILT.** `text` is placed by pointing. Clause 5
generalises it — EVERY creation command arrives with a `prompts` entry.

**D-125 (0140-RULINGS) — RULED BY THE HUMAN, ABSOLUTE PRIORITY. NOT BUILT — NEXT.** Clause 3 is the
trap (`content` literal ALWAYS, no `buildPanelSetCommand` reuse; a cell is Excel-style). Clause 6 and
clause 7 are the two a cycle is most likely to skip. Clauses 4–5 are reviewer-chosen defaults the human
may overrule on sight.

**D-126 (0142-REVIEW) — RULED, NOT BUILT.** A derived-slot addition is a load-compatibility event; the
loader reconstructs a schema's declared derived slots and never trusts the file to list them.
`formatVersion` is NOT bumped. Until it lands, every derived-slot cycle states the load consequence.

**D-127 (0142-REVIEW) — RULED, NOT BUILT.** D-108's deferral condition already fired at entry 0089.
D-108 clauses 1/2/4 stand; the owner is now the named load-hardening cycle, after D-125 and D-124.

**THE HUMAN'S DIRECT INSTRUCTION OUTRANKS `PROJECT_BRIEF.md` (0140).** *"If the brief conflicts with
what I say, ignore the brief. I wrote it."* No cycle may "correct" a ruling back toward the brief.

**Implemented AND reviewed, do not re-build:** D-097/D-098/D-099 · D-100 · D-101/D-106/D-102 · D-107 ·
D-081 + D-083 c4 · Phase 4's gate test · D-109 clause 3 · D-110 in full · D-114/D-115/D-116/D-117 ·
D-118 · D-120 · D-121 / D-122 + the `text` command · text rendering + the text bounding box ·
**D-123 + `measuredWidth` (0142-REVIEW)**.

**Implemented, awaiting review:** none.

**NOT implemented, each owned by a named future cycle:** **D-125** (in-place text entry — the human's
ABSOLUTE PRIORITY, NEXT) · **D-124** (`text` placed by pointing) · **D-126** + **D-127** + **D-108**
(one load-hardening cycle, after D-124) · **D-104** (§5.10's row/column commands) · **D-109 clauses
1–2** (cell decimals + clipping, `render/` only).

**Q-014 and Q-018 are CLOSED.** **Q-013 is NOT mooted.** **Q-016 and Q-017 remain OPEN**, both the
human's, neither blocking. **Q-019 → D-116**, **Q-020 → D-117** — BUILT and REVIEWED (0128).
**Q-021 → D-120** — BUILT + WIRED + REVIEWED (0133). **Q-022 → D-121**, **Q-023 → D-122** — CLOSED.
**Q-024 → D-123 — BUILT (0141), REVIEWED (0142), ALL TAGS VERIFIED GONE — CLOSED.** Next free: **Q-025**.

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

**`PROVISIONAL(Q-024)` — GONE, and VERIFIED GONE at 0142-REVIEW** by a repo-wide grep, not a claim.

**No other `PROVISIONAL` tags exist.** Q-016/Q-017 have none.

## Gotchas for the next model

- **THE HUMAN RULED AT ENTRY 0140 — read the header block before anything else.** D-125 (in-place text
  entry) is ABSOLUTE PRIORITY and is the NEXT slice; D-124 rides with it. Neither is built. Both
  prerequisites are now done AND reviewed, so there is nothing in front of D-125.
- **THE BATCH IS EMPTY.** Entry 0141 was reviewed and accepted at 0142. Start the next slice.
- **A DERIVED-SLOT ADDITION BREAKS SAVED DOCUMENTS UNTIL D-126 IS BUILT.** If your cycle adds one,
  say so in your entry in one line, naming the object types affected. Do not discover this the way
  0142-REVIEW did.
- **DO NOT TRUST A RULING'S CLAIM ABOUT WHAT IS OR IS NOT REACHABLE — GREP FOR THE CALLER.** D-108
  asserted `loadDocument` had no caller outside tests; it had one, twenty-four entries earlier, and the
  claim was copied forward through nine STATUS rewrites. That is what D-127 exists to correct.
- **`measuredHeight` and `measuredWidth` ARE ONE MEASUREMENT (D-123 clause 2).** Both go through
  `measureTextBox` in `primitives/text.ts`. Do not split them, do not add a check to one alone. A
  non-finite WIDTH `#TYPE`s `measuredHeight` too.
- **A hand-built `text` fixture pushed through `mutate` needs THREE derived placeholders.** Forget
  `measuredWidth` and D-018 refuses the object with a clear message — that is the check working.
- **D-123 clause 5 — the box follows the text; the text never follows the box.** Do not "fix" a
  drawn-vs-measured disagreement by drawing fewer lines. `overflow` is the only lever.
- **`commitPanelEdit` / `runPanelCommand` (`main.ts`) is the seam D-125 copies** — a UI gesture
  synthesises a `Command` and runs `executeCommand`. There is no second write path (Rule 2).
- **`main.ts`'s `pointerDownAt` already routes a canvas click to `respondToPrompt` when `state.pending`
  is set** — D-124 needs no new plumbing, only a registry entry.
- **A `text` object drags via `interaction.ts`'s existing `origin` path — no `text`-specific code.**
- **`content` cannot be `link`ed or `set =`'d (D-122).** The guard is `isTextContentTarget` in
  `command/commands.ts`'s `buildSlot`. Engine has no such guard — a loaded file can still carry one.
- **`TEXT_TYPE` (`graph/node.ts`) — import it, never a bare `"text"` literal (D-009).**
- **`grep` for `ORIGIN_X_PATH` in `schema.ts` before touching the `text` entry;** `origin.x`/`origin.y`
  are NOT `primitives/text.ts`'s `TEXT_*_PATH` constants — they reuse `geometry.ts`'s.
- **`EvalContext` is threaded PER CALL, not on `AppState`.**
- **`main.ts` builds a SECOND offscreen 2D context for measurement** — never the renderer's.
- **The block tree is parsed in TWO places every mutation** and must NOT be cached (D-114 clause 4).
- **`#MEASURE` is a real `ErrorCode`** (`graph/node.ts`), sixth after `#SCRIPT`. Produced only by the
  two measured slots, never serialized.
- **The operator cannot see what you can see.** A text box that silently renders empty, zero-height, or
  inside a wrong-sized click box is the injury D-116, D-118 and D-123 are each ruled against — and a
  file picker that silently does nothing is the same injury at the load boundary (D-127).
