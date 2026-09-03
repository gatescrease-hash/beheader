# STATUS — as of entry 0158-RULINGS-phase5

**NOTHING IS BLOCKED. THE NEXT SLICE IS MARKDOWN-LITE.**

0157-REVIEW reviewed the whole five-cycle batch (0152–0156): **`ACCEPT WITH EDITS`**. The code is
right — rules, invariants and spec conformance all pass, and the honesty audit was the strongest part
of it. Every finding was documentation drift, six sites, all fixed in that entry, plus **D-137** (a
file's HEADER is part of the diff that changes its behaviour).

0158-RULINGS then closed the two things that review left owed. The human's answers:
**the wrap residual happens WITHOUT `{= }` references and is "mostly fixed"** → **D-138**: it is
platform glyph quantization, it is ACCEPTED, and **nothing may compensate for it** (0151's
prohibition was conditional and its condition has now been met — D-138 re-issues it
unconditionally). **Save/load is confirmed on screen** → 0156 fully closed.

**STATE GREEN — 1710/1710.**

---

## Where the code actually is

STATE: **GREEN**. Both configs compile, **1710/1710** tests pass, 0 skipped, 0 `.only`.
**33 test files.** `npx vite build` clean. **PHASE 5 IS OPEN.**

Last review point: **0157-REVIEW-phase5** (verdict ACCEPT WITH EDITS). **Batch reset: 0/3 cycles,
0 files.** Nothing is unreviewed and nothing is waiting on the human.

**Confirmed on screen:** 0152, 0153, 0154 (2026-09-02) and **0156** (save/load round-trips).

**ONE THING NOBODY HAS LOOKED AT, AND IT IS NOT BLOCKING:** **entry 0155** — the phantom `""`, the
ghosted cell, the A1 headers. Reviewed and green, all three fixes in tested pure functions, but the
human's answer named 0154 and 0156 and did not name this one, so the log does not claim it was seen
(0158-RULINGS §3). Ten seconds of gestures if anyone wants them: double-click an empty cell and click
out five times then `props table_1` (no `A1`, no quotes, ever); double-click a cell that HAS a value
and watch for ghosting under the overlay; check the A1 headers line up and that the grey reads right.

**Still unconfirmed from 0153:** eight grabbers and the resize cursor; a dragged height surviving;
toggling `autoresize` back to shrink-to-fit.

## Read this first — what a cold reader needs

**0. `TEXT_SCHEMA` HAS ELEVEN NON-DERIVED + THREE DERIVED SLOTS.** Non-derived: `origin.x`/`origin.y`
(D-121) + `content` + `width`/`height`/**`autoresize`** + five `style.*`. **NO `overflow`** — the slot
was REMOVED at 0154 on the human's instruction; `autoresize` took its place in the count. Derived:
`resolvedContent` (dynamic deps), `measuredHeight` and `measuredWidth` (static deps, **the SAME
list** — one measurement answers both). `primitives/text.ts` owns NINE of the eleven paths; the two
`origin.*` come from `geometry.ts`.

**0a. `autoresize` IS NOT A DEPENDENCY OF EITHER MEASURED SLOT, AND THAT IS THE POINT.** It sizes the
BOX, not the TEXT. Two consequences, both wanted: toggling it never re-measures, and **a document
saved before it existed still loads** (nothing derived depends on it → no dangling edge; every
reader defaults it to `true`). D-126's trap avoided by construction. There is a test.
**0157-REVIEW confirmed this and flagged it as a call a future cycle must not "fix".**

**0s. THE LOADER IS HARDENED (0156, REVIEWED 0157). TWO FACTS A COLD READER NEEDS.**
- **A loaded formula AST's SHAPE is validated ONCE, at the boundary** —
  `formula/ast.ts`'s `validateFormulaAstShape`, called from `document.ts`'s `reconstructSlot`
  BEFORE the depth check (the depth check itself walks the AST). It descends at most
  `MAX_FORMULA_AST_DEPTH` and stops; **0157-REVIEW verified that is not a hole** — any node it
  skipped sits at depth ≥ 1001, and `exceedsMaxFormulaAstDepth` returns `true` on depth alone before
  it ever reads `ast.type`. **D-108 clause 3 still forbids hardening any individual walker** —
  `exceedsMaxFormulaAstDepth`, `collectIllegalAstLiterals`, `deps.ts`, `eval.ts` all stay guard-free,
  and this boundary is what makes that safe. `BinaryOperator`/`UnaryOperator` are DERIVED from
  `BINARY_OPERATORS`/`UNARY_OPERATORS` so the validator cannot drift from the type.
- **The SCHEMA says which derived slots an object has, never the file** (`withSchemaDerivedSlots`,
  D-126). Declared-but-absent → the placeholder; present-but-undeclared → dropped; a NON-derived slot
  at a declared derived path is left alone so D-018 case 2 still refuses it. **Adding a derived slot
  is no longer a load-compatibility event.**

**0b. `render/textbox.ts` OWNS THE BOX-SIZING RULE. THREE READERS, NO SECOND COPY.**
`extent.ts` (the committed box), `renderer.ts` (the alignment box), `editor.ts`/`main.ts` (the LIVE
box while typing). The rule: no set size → the measurement; set size and the text is BIGGER → the
measurement (**a text box never crops**); set size and the text is SMALLER → `autoresize` decides.
**WIDTH IS ASYMMETRIC ON PURPOSE:** a numeric `width` is also the WRAP width, so it is a FLOOR never
a ceiling — only the height answers to `autoresize`, exactly as "resize shape to fit text" works in
Word. (Since 0154 the floor is reached only by a box narrower than one glyph — `measure.ts` breaks
inside a word now.)

**0c. THE TWO MEASURED SLOTS ARE ONE MEASUREMENT (D-123 clause 2).** `measureTextBox`
(`primitives/text.ts`, private) owns the read set, the failure ladder and the single `measure` call.
Failure order: upstream `ErrorValue` → `#MEASURE` (no real measurer, D-118) → `#TYPE` (unusable
style) → `#TYPE` (non-finite width OR height) → the box.

**0d. A HAND-BUILT `text` FIXTURE PUSHED THROUGH `mutate` NEEDS ALL THREE DERIVED PLACEHOLDERS.**
D-018 refuses a missing `measuredWidth: { kind: "derived", value: null }`. A fixture that only goes
through `evaluate`/`objectExtent` does not. `autoresize` may be omitted (it reads as `true`).

**0e. `DEFAULT_TEXT_*` (`command/commands.ts`)** — `width`/`height` `"auto"`, **`autoresize` `true`**,
font `"sans-serif"`, fontSize `16`, lineHeight `20`, color `"black"`, align `"left"`. No `overflow`
default: 0154 removed the slot, so `createText` no longer writes one.

**0f. THE MEASURER IS BUILT, WIRED, AND REVIEWED (0133).** `main.ts:start` builds `evalContext` from
`createCanvas2dTextMeasurer` over a SECOND offscreen 2D context and threads it through
`executeCommand` / `pointerMove` / `loadDocument` and the pure transitions. **The in-place editor
uses it directly too** (`editorTextBoxSize` on every keystroke).

**0g. `render/measure.ts` — line-breaking lives HERE (D-120), never in `src/engine/`. AND IT
IMPLEMENTS CSS'S RULES ON PURPOSE (0154, reviewed 0157):** `white-space: pre-wrap` +
`overflow-wrap: break-word`, because that is what the editor's `<textarea>` uses and the two must not
drift. Spaces are PRESERVED, not collapsed; trailing spaces HANG (trimmed off the emitted line — no
width, no break); a word too wide for its own line is split between CODE POINTS (`break-word`, not
`break-all` — it moves to a fresh line first and is only then broken). **0157-REVIEW confirmed this
is not the slop 0151-RULINGS forbade**: the measurer adopted the browser's *specified* rule, which is
the D-010 move, rather than a tuned constant chasing a quirk.

**0h. `content` IS `literal`-ONLY (D-122).** The guard is `isTextContentTarget` in
`command/commands.ts`'s `buildSlot`.

**0i. THE IN-PLACE EDITOR, AS OF 0153.** `render/editor.ts` is pure geometry:
- `editorTargetAt` picks the receiver via `hitTest`.
- `editorPlacement` returns `left`/`top` in **CSS pixels**, `width`/`height` in **WORLD units**, and
  a `scale`. `main.ts` applies `transform: scale(...)` with `transform-origin: 0 0`. **This split is
  what makes the browser break lines where the canvas does — do not pre-multiply them again.**
- `editorTextStyle` returns WORLD `fontSize`/`lineHeight`, plus family, align, **colour**, `wraps`.
- `editorTextBoxSize(object, typed, style, measurer)` is the LIVE box, from `textbox.ts`'s rule with
  a measurement of the TYPED string. `CARET_ALLOWANCE` (2 units) is added only for a NON-wrapping
  box; never for a wrapping one, where widening would move a break.

`main.ts`'s pure half: `commitTextContent` (ALWAYS a literal `set`), `commitTableCell` (Excel-style),
`editorSeed`, `abandonCreatedTextBox` (D-136 clause 2), **`commitPanelChoice`** (a drop-down's
literal write). All go through `runPanelCommand` → `executeCommand` — NO second write path (Rule 2,
**re-verified at 0157**). DOM half in `start`: opens on a double-click OR on a newly-created `text`
whose command carried no content (D-124 + D-136 clause 1); blur/click-outside commits, Escape
cancels, Enter commits in a cell; a PAN press does not commit or steal focus (D-130/D-133); an editor
opened on-create that ends empty deletes the box (D-136 clause 2). **Every keystroke repaints**
(`input` → `paint` → `updateEditor`), which is what grows the box.

**0j. `render/handles.ts` — the eight resize grabbers.** `hasResizeHandles` is `text`-ONLY (a shape's
size is `radius`/`sides`; a table's is `rows`/`cols` — a different question). `resizeHandleAt` is a
SCREEN-space test with a pixel tolerance, so a grabber is one size at every zoom. `resizeBox` clamps
so an edge can never cross its opposite.

**0k. A RESIZE IS ABSOLUTE, NOT INCREMENTAL, AND THIS IS LOAD-BEARING.** Each step recomputes the box
from `ResizeState.startExtent` plus the total delta since the press. Incremental would read the
committed box back in — which `textbox.ts` has already grown to fit the text — and run away from the
pointer. **A HEIGHT drag also writes `autoresize: false`**, or the box snaps straight back and the
grabber looks broken (Word does the same). **0157-REVIEW recorded this as a call not to "fix".**

**0l. `InteractionState` HAS THREE FIELDS: `selectedObjectIds`, `drag`, `resize`.** `resize` is a
SEPARATE field, never a variant of `drag`, so every existing reader of `drag` still means what it
meant. A hand-built `InteractionState` in a test needs all three.

**0n. `mutation.ts` HAS SEVEN OPERATION KINDS — `clearSlot` JOINED AT 0155.** It REMOVES the slot at
an address, because there is no empty `Value` to write: D-047 makes an ABSENT cell slot the empty
cell, and `""`/`0` are content. **Legal ONLY at a table cell** (`findIllegalSlotClears`, a seventh
precondition): D-047 settles that one case and nothing settles any other. Clearing a cell a formula
READS is fine (D-110 clause 4: empty in-extent reads `0`, no edge). **0157-REVIEW: this does NOT
violate Rule 6** — Rule 6 binds evaluation, and only mutations change which slots exist.

**0o. `clear <address>` IS A COMMAND, AND IS NOT IN §5.10.** Added at 0155 under the human's standing
leave, because "empty this cell" was inexpressible. It reuses `resolveWritableSlot` but NOT
`writeSlot`. **An already-empty cell SUCCEEDS and mutates nothing** — no journal entry for an event
that did not happen. `main.ts`'s `buildCellCommand` emits it whenever the in-place editor is blank.

**0p. `editorSeed` USES THE AUTHORING FORM, NEVER `describeSlotValue`.** That formatter QUOTES
strings and is for DISPLAY; using it made an untouched commit rewrite `hello` as `"hello"` and grow
two quotes per open on an empty cell. `cellLiteralSeed` is the deliberate INVERSE of
`buildCellCommand`, and **the two must be changed together** — a boolean arm was missing from the
commit side and only the round-trip test caught it.

**0q. `renderDocument` TAKES THE WHOLE `EditorTarget`, NOT AN OBJECT ID.** A `text` receiver is
skipped WHOLE (body, highlight, grabbers); a `table` keeps everything but the ONE edited cell's
value — its grid, including that cell's border, still draws. An id alone could not express the
second, which is exactly why the cell ghosted.

**0r. A TABLE'S A1 HEADERS ARE NEVER SUPPRESSED** (`drawTableHeaders`, 0155). Unlike the name label,
which moves into the properties panel, nothing else says which column is `C`. Letters come from
`address.ts`'s `indexToColumnLetters` — the SAME function `formatCellReference` uses, so a header
can never name a different column than the cell under it (D-010). Skipped per axis below
`TABLE_HEADER_MIN_CELL_SCREEN`. A table's name label is lifted by `chromeTopReservedScreen`.

**0m. A SLOT WITH A CLOSED VALUE SET IS DECLARED ON THE SCHEMA** (`ObjectSchema.slotOptions`,
`findSlotOptions`) — `text`'s `style.align` and `autoresize` are the only two today.
`SlotDescriptor.options` → `PanelRow.choices` → a `<select>` committing on `change`. The option's
DOM value is its **INDEX**, never its label or a stringified value. **Only a `literal` row gets a
drop-down**; a `formula` row keeps its blue paperclip (it is driven — D-040). **A boolean choice
echoes as `TRUE`/`FALSE`** (0157-REVIEW) — the echo must retype to the same value.

**1. PHASE 4'S GATE TEST IS `main.test.ts`'s `describe` "PHASE 4'S ACCEPTANCE CRITERION" (7 tests).**
Do not weaken; do not fold.

**2. D-110's DISCLOSED CONSEQUENCE — `refs` HAS TWO FORMS (D-112).** Neither may be "fixed".

**3. THE PANEL IS BUILT AND REVIEWED — DO NOT RE-BUILD IT.** D-094/D-100/D-101/D-106/D-102/D-107.
0153 ADDED drop-down rows; it replaced nothing else.

**4. `main.ts`'s DOM half (`start`) IS UNTESTED BY CONSTRUCTION (D-001) AND KEEPS GROWING.** Every
DECISION behind it is in an exported pure function that is tested.

**5. THE VANISHING-TABLE DEFECT IS FIXED (entry 0101) — D-097/D-098/D-099 are CLOSED.**

**6. D-104 IS OWED BY A CYCLE THAT HAS NOT BEEN SCHEDULED.** `insertTableLine`/`deleteTableLine` not
bounded by `MIN`/`MAX_TABLE_LINES`. Not command-reachable. Fix in `findInvalidTableResizes`.

**7. D-108 / D-126 / D-127 ARE BUILT (0156) AND REVIEWED (0157).** See 0s. **D-108 clause 3's
prohibition on hardening any individual AST walker SURVIVES the fix.** Do not "helpfully" add a null
check to one of them.

**8. THE TEXT BLOCK TREE IS DERIVED STATE, RE-PARSED FROM `content` ON DEMAND, NEVER CACHED (D-114
clause 4).** A broken span becomes an `error`-kind `Block` (D-115); its parsed branches live in
`orphaned`.

**9. `evaluateDerivedSlot`'s `read` RUNS THE D-110 COERCION BEFORE THE D-013 MEMBERSHIP CHECK
(D-114 clause 3).** Do not swap them.

**10. `resolveTextDependencyAddresses` and `deriveEdges` Source 1 are a hand-maintained PAIR with no
compiler link (D-119).** Change one → change both, same cycle, log names both.

**11. A broken embedded span is marked `!` in place (D-116 parse / D-117 runtime), never blanks the
box; `evaluateBlockTree` always returns a `string`.**

**12. `EvalContext` IS THREADED PER CALL, NOT STORED (0132, reviewed 0133).**

**13. `TEXT_TYPE` (`graph/node.ts`) joins `TABLE_TYPE`.** Import it, never a bare `"text"` literal in
an equality check (D-009) — EXCEPT `advance`'s `session.command.kind === "text"`, which compares a
`Command`'s discriminant, not an `ObjectType`.

**14. NEW — D-137: A FILE'S HEADER IS PART OF THE DIFF THAT CHANGES ITS BEHAVIOUR.** Before ending a
cycle, re-read the header of every source file you touched and check `WHAT THIS IS` /
`INVARIANTS UPHELD HERE` / `NOT DONE HERE` against what the file now does. **`NOT DONE HERE` is the
likeliest to be wrong** — it goes stale by the file getting BETTER, so nothing about your change
draws your eye to it. And **NEVER insert a declaration between a doc comment and what it documents.**
Six sites in 0152–0156; all fixed at 0157. Not a licence to sweep — it binds only files your cycle
already touched.

## Next slice — MARKDOWN-LITE. Read these three things before you start.

**§5.6's exact markdown list, drawn in `renderer.ts`'s `drawText`, with `render/measure.ts` made
markup-aware IN THE SAME CYCLE** so drawn and measured agree. Splitting those two across cycles puts
the box and its ink back into disagreement, which is the defect the last four cycles existed to
remove.

Three standing constraints this cycle inherits, all of which it walks into:

1. **D-138 — you are about to open `layOutLines` for another reason. Do not touch the wrap residual
   while you are in there.** No epsilon, no fudge, no `letter-spacing`. Adopting a further
   *specified* CSS rule is the one legitimate move, and it must name the rule at the site.
2. **D-137 — the headers of `measure.ts`, `renderer.ts` AND `editor.ts` are part of your diff.** All
   three currently state that markup is measured and drawn VERBATIM; all three stop being true the
   moment this cycle lands. `NOT DONE HERE` is where the stale claim will be.
3. **Q-025 — what does the overlay show once the canvas renders markup?** The rework's whole goal
   was "no difference between how the text looks when you're editing it and when you're not", and
   markdown breaks that by construction. Recommended: **(a)** the overlay shows RAW source and is
   MEASURED from raw source. Reversible — take it provisionally and tag every site
   `// PROVISIONAL(Q-025)`, or get the human's answer first.

Then the **Phase 5 gate**: one executable test over one document proving the §6 criterion,
`REVIEW: REQUIRED` (§6.1 trigger 1 — no batch absorbs a phase gate).

Cheap adds: a direct `link text_1.origin.y <cell>` test (0137-REVIEW §honesty). **D-109 clauses 1–2**
(cell decimal precision + no cell-text clipping, `render/renderer.ts` only) still need no ruling.
**Q-017** headers remain the human's.

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
D-121 + D-122 · **0137-REVIEW** the `text` command; Q-022/Q-023 CLOSED · **0139-REVIEW** text
rendering; D-123, Q-024 answered · **0142-REVIEW** `measuredWidth`; Q-024 CLOSED; D-126 + D-127 ·
**0144-REVIEW** the in-place editor (D-125); D-128 · **0145-RULINGS** D-129 + D-130 + D-131 ·
**0148-REVIEW** editor-polish; D-132 + D-133 · **0150-REVIEW** `text`-by-pointing (D-124); D-134 ·
**0151-RULINGS** D-135 + D-136 · **0157-REVIEW** the whole 0152–0156 batch — the editor cycle, the
text-box rework, wrap agreement, the table-cell fixes and load hardening; **D-137**.

· **0158-RULINGS** D-138 (the wrap residual, accepted); Q-025 raised.

**Confirmed GOOD on screen 2026-09-02:** 0152 (D-135 + D-136), 0153 (the text-box rework), 0154
(wrap agreement + `overflow` removal), **0156 (save/load round-trips — D-126's only observable
test)**.

## Reviewed but NOT yet seen on screen

- **Entry 0155 — the table-cell fixes + A1 headers.** `mutation.ts`'s `clearSlot` + precondition,
  `parser.ts`'s `clear`/`parseCommandBoolean`, `commands.ts`'s `clear` handler, `main.ts`'s
  `cellLiteralSeed` + `buildCellCommand`'s empty and boolean arms + the whole-`EditorTarget` render
  call, `renderer.ts`'s cell-aware suppression + `drawTableHeaders`. **The only unseen entry left.**

## Not started

D-090's prompt-sequence preview · §5.9's per-vertex drag path ·
`polyline`/`explode`/`addvertex`/`delvertex` · `style` slots as authorable · point-in-polygon fill
hit-testing (D-067) · §5.4's formula bar · D-088 clauses 2–4 · D-089 · D-102 clause 9 ·
**D-109 clauses 1–2** · markdown-lite rendering + a markup-aware measurer · the Phase 5 gate test ·
Phases 6–7.

## Open fix list — read 0090-REVIEW §9, 0091-REVIEW §5 and 0100-REVIEW §9 for the full text

Numbering follows 0090-REVIEW §9. Items 2–13, 16–21, 23–24 unchanged and open unless noted.

1. **DONE at entry 0112**, reviewed 0113.
2. **Give the missing-slot refusal a remedy.** Message only; narrowed by D-110 to clause 6's cases.
3. **`findDanglingReferences` names one dependent once per MISSING SOURCE.**
4. **`zoom`'s refusal names `Infinity`.** Message only.
5. **Carried from 0074-REVIEW §9, all six unchanged.**
6. **A middle-drag pan started outside the canvas is untested.** Owned by D-088's cycle.
7. **`TABLE_GRID_STROKE_STYLE` has no comment** (D-091). Owned by the `style`-slots cycle.
8. **The screen-space chrome constants are untuned** (Rule 5). `handles.ts`'s
   `RESIZE_HANDLE_SIZE_SCREEN` / `_TOLERANCE_SCREEN` / `MIN_TEXT_BOX_SIZE`, `editor.ts`'s
   `CARET_ALLOWANCE`, and `renderer.ts`'s `TABLE_HEADER_*` all join this list.
9. **The chrome pass leaves `ctx.font`/`textAlign`/`textBaseline` set on return.** Harmless —
   `drawObjectChrome` sets all three explicitly, so `drawTableHeaders` cannot corrupt the next
   object's label (checked at 0157).
10. **The formula-driven indicator's narrowness (`origin.x`/`origin.y` only) should be RE-DECIDED.**
11. **A display-only panel's `overflow: auto` scroll resets on every paint.**
12. **A right-flipped panel that hits the right clamp overlaps its own object.** Correct per D-094.
13. **`insertTableLine`/`deleteTableLine` are not bounded by `MIN`/`MAX_TABLE_LINES`** — **D-104**.
14. **0110-REVIEW's F1–F4 — BUILT (0111), REVIEWED (0113).** Closed. **Q-016** carries F3's tail.
15. **F5 — CLOSED at 0156, reviewed 0157.** `validateFormulaAstShape` validates a loaded AST at the
    boundary; the doc claims are corrected; 15 malformed shapes are pinned.
16. **F6 — a panel row's text can no longer be mouse-selected.** D-095 governs.
17. **F7/F8 — ruled D-109. F8 BUILT (0117), REVIEWED (0119); F7 (clauses 1–2) NOT BUILT.**
18. **F9 — CLOSED in the same review.**
19. **F10 — CLOSED, ruled D-112.**
20. **F11 — open, no owner.** Shrinking a table's extent under a formula reading an empty in-extent
    cell is REFUSED. Correct per D-110 clause 6.
21. **F12 — open, DO NOT RE-LITIGATE.** `MIN(B1, B2)` vs `MIN(B1:B2)` on empty in-extent cells.
22. **F13 — RULED D-122, BUILT (0136), REVIEWED (0137). CLOSED.**
23. **F21 — CLOSED**, WIDENED at 0141 (D-123 clause 2).
24. **F22 — CLOSED in the same review.**
25. **F23 — CLOSED at 0156, reviewed 0157.** The loader rebuilds derived slots from the SCHEMA.
26. **F24 — CLOSED at 0156, reviewed 0157.** `openDocument`'s promise chain has a rejection path.
    **D-127's lesson stands: a ruling deferred work to a trigger that had already fired 24 entries
    earlier, and it survived nine STATUS rewrites because it was ASSERTED rather than grepped.**
27. **F25 — RULED D-129, BUILT (0146/0147), REVIEWED (0148) → D-132. CLOSED.**
28. **F26 — RULED D-130, FIXED (0147), REVIEWED (0148) → D-133. CLOSED**, confirmed on screen.
29. **F27 — RULED D-131, BUILT (0146), REVIEWED (0148). CLOSED.**
30. **F28 — RULED D-135, BUILT (0152). CLOSED, and SUPERSEDED at 0153.**
31. **F29 — RULED D-136, BUILT (0152). CLOSED and CONFIRMED ON SCREEN 2026-09-02.**

## Known problems (detail lives where the pointer says)

- **ENTRY 0155 IS UNSEEN ON SCREEN.** Reviewed and green; nobody has looked. Not blocking.
- **THE X-vs-X+1 WRAP RESIDUAL IS CLOSED AS "ACCEPTED" — D-138. DO NOT TRY TO FIX IT.** The human's
  answer (2026-09-02): it happens **regardless of `{= }` references**, and it is "mostly fixed". That
  eliminates the by-design explanation and leaves platform glyph quantization — canvas `measureText`
  returns unrounded float advances, a browser can quantize DOM advances to whole pixels, and the
  error accumulates along a line, so **no fixed epsilon can absorb it**. **D-138 re-issues 0151's
  prohibition UNCONDITIONALLY** (0151's wording was "not without the human seeing the residual
  first", and that condition has now been met — do not read the gate as passed): no epsilon, no fudge
  factor, no rounding step in `layOutLines`/`measure`, no `letter-spacing`/`word-spacing`/
  `font-kerning` on `.text-editor`, no per-platform branch. Adopting a further **specified** CSS rule
  is the one legitimate move (that is what 0154 did, and why it was not slop) and must name the rule
  at the site. Reopen only on evidence the cause is NOT quantization — see D-138 clause 5 for what
  that evidence would look like.
- **THE A1 HEADERS ARE GREY (`#6b7280`), NOT THE TITLE'S NEAR-BLACK.** One constant to revert if it
  looks wrong on screen.
- **THE HEADERS ARE NOT CLICKABLE.** Selecting a whole row/column is a design question nobody has
  asked; deliberately not invented.
- **A string cell holding `"42"` seeds `42` and commits back as the NUMBER 42.** Reachable only from
  the command line; Excel's own behaviour under D-125 clause 3. Quoting to preserve the distinction
  is what caused the 2026-09-02 defect.
- **A panel with a focused `<select>` stops updating its other rows** until it is blurred. The
  smaller injury versus tearing the control out mid-gesture; self-heals on blur.
- **A freshly-created `text` object opens its editor UNSELECTED** (D-136 clause 4 leaves it).
- **`text 30,40` (unquoted, comma) places a box at (30,40) with empty content** (entry 0149).
- **THE EDITOR SHOWS RAW SOURCE; THE CANVAS DRAWS `resolvedContent`.** For plain text those are the
  same string; for a `{= … }` block they are NOT. Unavoidable, and the markdown-lite cycle will make
  it worse deliberately — decide then what the overlay shows.
- **The cell editor does not reproduce `TABLE_CELL_TEXT_PADDING`'s 4-unit inset, and left-aligns a
  number cell** — deliberate. `editor.ts`'s NOT DONE HERE.
- **The properties panel and the in-place editor can overlap** at small window sizes. No remedy.
- **A raw `setSlot` LOWERING `rows`/`cols` still strands any now-out-of-bounds cell slot** —
  `primitives/table.ts`'s header.
- **The JOURNAL's `Operation` payloads are still unvalidated beyond `Array.isArray` + a raw
  illegal-number walk.** Deliberate and unchanged: nothing replays the journal. Validate it the
  moment something reads it. Named in `document.ts`'s own header.
- **A loaded document can carry a `formula`/`derived` `content` slot on a `text` object** (D-122
  blocks the command path, not the loader).
- **BOTH measured slots are `#MEASURE` for a `text` object created in a test** (default
  `NULL_EVAL_CONTEXT`), so its box falls back to `textbox.ts`'s 240×20 there. **The in-place editor
  degrades the same way.** `renderer.ts`'s alignment box does too, and matches `extent.ts` — which is
  the point (D-010).
- **`measure.ts` and `renderer.ts` fall back DIFFERENTLY for an unusable `style.*` slot.** Disclosed
  in both headers; unfixed — one shared set of fallbacks needs a ruling on which file owns them.
  **D-123 clause 5 forbids fixing it from the renderer's side.** `render/editor.ts` is a THIRD
  reader of that set (mirrors by value: 16 / 20 / "sans-serif" / 14).
- **`extent.ts` trusts the stored measurement; `renderer.ts` re-wraps with its own `ctx`.** D-123
  clause 5: the box follows the text, never the reverse.
- **An empty-`content` `text` object is invisible AND unselectable** — no ink, no extent, no hit box
  (D-066). D-136 clause 2 removes an abandoned one.
- **`x`/`y` are OPTIONAL for the `text` command (default `0`, D-121 clause 3)** but REQUIRED for
  `circle`/`polygon`/`rect`/`table`.
- **`DEFAULT_TEXT_*` style values are the handler's provisional pick** — no ruling, no tag.
- **`resolveTextDependencyAddresses` and `deriveEdges` Source 1 are a hand-maintained PAIR (D-119).**
- **`main.ts`'s `start` is untested code and keeps growing.** Verified live, not by assertion.
- **`findIllegalSlotClears`'s doc says "a `createObject` EARLIER in the same batch" while the code
  scans the whole operations array.** Copied verbatim from `findInvalidDimensionWrites` beside it,
  which has always done the same; the only orderings it admits are ones D-021's existence check
  rejects anyway. **Left alone at 0157 on purpose (§4)** — changing both is a separate cycle's job.
- **The properties panel positions an off-screen selected object's panel clamped to a canvas edge.**
- **A prompt sequence still shows nothing where you clicked** — ruled **D-090**, queued.
- **The formula-driven indicator is read NARROWLY** — `origin.x`/`origin.y` only.
- **A printable keystroke does not reach the command input unless it is focused** — D-088 clauses 2–4
  not built. **No command history** (**D-089**, queued).
- **Every pointer move repaints the canvas, and now every EDITOR keystroke does too.** Rule 5's
  accepted trade — it is what grows the box.
- **`escape` is bound to the window.** The in-place editor's own keydown `stopPropagation`s.
- **`zoom`'s echoed line names the REQUEST; `main.ts` adds a second line with the RESULT** — D-082 c5.
- **`format.ts`'s elision does not re-parse** — a disclosed round-trip exception.
- **A `delete` refusal can name the same dependent twice** — fix-list item 3.
- **`refs` names a range's START cell as the source** when the range's table is being removed.
- **Two sites ask the schema whether it declares a path** — `declaresSlotPath` and
  `resolveWritableSlot`'s inline check. A THIRD is forbidden.
- **`refs <address>` REFUSES for a cell of a table whose `rows` is a formula** (D-046).
- **SETTLED at 0118 — do not re-raise.** A bare reference to an EMPTY in-extent cell reads `0`, gets
  no edge (**D-110**).
- **`text.test.ts`'s `expectError` helper is unused** — kept deliberately.
- **`render/measure.ts` measures markdown markup verbatim AND `renderer.ts` draws it verbatim** —
  deliberately consistent for now. The markdown-lite cycle moves both.
- **Seven §5.10 commands have no registry entry** — `polyline`/`script`/`image`/`explode`/
  `addvertex`/`delvertex` wait on a schema or an `Operation` kind; **`pan` waits on Q-012**.
- **`createObjectFromCommand`'s "type has no schema" branch is uncovered**, as are
  `describeSlotValue`'s `Point`/`Point[]` arms.
- **A 1000×1000 table is legal and costs ~1.5 s per MUTATION** — and now also 2,000 header
  `fillText` calls per frame. Rule 5's accepted trade (D-077 c3).
- **`renderer.ts`'s `formatCellValue`, `props.ts`'s `describeSlotValue`, and `mutation.ts`'s
  `describeDimensionSlotValue` are three separate `Value`-to-text formatters** — deliberate.
  `main.ts`'s `cellLiteralSeed` is a FOURTH, and deliberately so: it is the only *authoring*-form
  one, and the inverse of `buildCellCommand`.
- **`primitives/text.ts` CANNOT import `mutation.ts`** (D-119).
- **`render/editor.ts` imports `hittest.ts` + `extent.ts` + `camera.ts` + `slots.ts` + `textbox.ts` +
  engine leaves.** `render/handles.ts` imports `camera.ts` + `extent.ts` + engine leaves.
  `render/textbox.ts` imports NOTHING. `renderer.ts` imports `editor.ts` TYPE-ONLY, one direction.
  No cycles.
- **Carried unchanged:** `set-formula` is a `kind` not a registry name · comment debt in TEST files ·
  mixed line endings in the WORKING TREE only (`core.autocrlf=true`) · dangling-reference messages
  name the DEPENDENT not the missing SOURCE · D-022's bounded-correctness claim fails for `table` ·
  `describeValueType` duplicated in `functions.ts`/`eval.ts` · `rewrite`/
  `repairObjectFormulaAddresses` walk `formula` slots only · journal structure unvalidated beyond
  `Array.isArray` · `lexer.ts`'s two edge cases · §5.11's `style` field · `noUnusedLocals` off ·
  `.gitattributes` still owed.

## Settled — do not re-raise

Every ruling in `DECISIONS.md` (D-001 through **D-138**) binds **except where entries 0153/0154/0155
overruled one on the human's explicit instruction.** Those, in full:

- **D-123 clause 3 — INVERTED.** A set `width`/`height` no longer crops the text; the box grows.
  Clause 2 (one measurement, two slots) and clause 5 (the box follows the text) both STAND.
- **D-129 clause 2 / D-135 — SUPERSEDED.** `overflow: auto` and zero-layout scrollbars replaced by
  `overflow: hidden` plus a box that grows.
- **D-132's colour clause — REVERSED.** The overlay matches `style.color`.
- **D-129's zoom-scaled type style — MOVED.** `editorTextStyle` reports WORLD lengths; the scaling is
  one CSS transform. This is what makes the layouts match.
- **§5.6's `TextBox` slot list — DEVIATED, TWICE.** `autoresize` ADDED (0153); **`overflow` REMOVED
  (0154)** — the first time a brief-named slot has been deleted rather than extended. Net: eleven.
- **D-102 clause 6's panel grammar — NARROWED.** A drop-down row writes a literal directly. Free-text
  rows untouched, so **Q-016 stays OPEN** for them.
- **D-120's "no mid-word breaking" — REVERSED (0154).** `layOutLines` implements CSS's `pre-wrap` +
  `break-word`. D-120's actual ruling — line-breaking lives in `render/measure.ts`, never in
  `src/engine/` — STANDS untouched.
- **§5.10's command list — EXTENDED (0155).** `clear <address>`. **D-047 itself is RELIED ON, not
  changed** — 0155 makes the state it describes reachable.

Otherwise standing, unchanged: **D-114–D-119** · **D-120** · **D-121/D-122** · **D-124 + D-134** ·
**D-125 + D-128** · **D-130/D-131/D-133** · **D-136** · **D-126 / D-127 / D-108** (built 0156,
reviewed 0157) · **D-137** (0157) · **NEW D-138** (0158 — the wrap residual is accepted, and nothing
may compensate for it).

**D-046 STANDS.** A dimension slot is read `literal`-only and fails closed to `0`. `content`
inherits the same posture.

**D-094's fourteen clauses stand** · **D-096's four clauses stand.**

**From 0091-REVIEW:** **D-088** (clause 1 built, 2–4 queued) · **D-089** (queued) · **D-090**
(queued) · **D-091**. **From 0090-REVIEW:** D-084–D-087 implemented. Still owed: **D-074**.

**Q-014 and Q-018 are CLOSED.** **Q-013 is NOT mooted.** **Q-016 and Q-017 remain OPEN**, both the
human's, neither blocking. **Q-019 → D-116**, **Q-020 → D-117**, **Q-021 → D-120**, **Q-022 →
D-121**, **Q-023 → D-122**, **Q-024 → D-123** — all CLOSED. **Q-025 is NEW and OPEN** — what the
overlay shows once the canvas renders markdown. The human's call; the markdown cycle takes
recommendation (a) provisionally and tags it if unanswered. Next free: **Q-026**.

## Live PROVISIONAL tags and open questions

**`PROVISIONAL(Q-012)` → `src/render/renderer.ts`** (×3), **`src/render/slots.ts`** (×1) and
**`src/render/editor.ts`** (×1): world units or screen pixels for stroke width / cell size / font?
Provisional (a) world units. Due with the `style`-slots cycle. `handles.ts` and `textbox.ts` added NO
new site: handles are explicitly screen-space chrome, and `textbox.ts` deals only in world lengths
handed to it.

**`PROVISIONAL(Q-008)` → `src/engine/graph/node.ts`** (×2, `-0`): open, deferred, blocking nothing.

**No other `PROVISIONAL` tags exist.**

## Gotchas for the next model

- **D-138 — THE WRAP RESIDUAL IS SETTLED AND ACCEPTED. DO NOT COMPENSATE FOR IT.** 0151's
  prohibition was conditional on the human seeing it first; they have, so D-138 re-issues it with no
  condition at all. If you are in `layOutLines` for another reason, that is exactly the moment this
  ruling is aimed at.
- **D-137 IS ABOUT YOU.** When your cycle changes what a file does, its HEADER is part
  of your diff. Check `NOT DONE HERE` hardest — it goes stale by the file getting better. And never
  insert a declaration between a doc comment and what it documents.
- **THE 2026-09-02 TEXT-BOX WORK (0153 + 0154) OVERRULED EIGHT PRIOR RULINGS ON THE HUMAN'S EXPLICIT
  INSTRUCTION.** The list is under "Settled". **Never "correct" the code back toward one.** In
  particular: a text box never crops, the measurer breaks words, and there is no `overflow` slot.
- **`render/textbox.ts` IS THE ONE BOX-SIZING RULE.** Three readers. Do not add a fourth reading.
- **THE OVERLAY IS LAID OUT IN WORLD UNITS AND SCALED BY ONE TRANSFORM.** Do not pre-multiply
  `camera.zoom / ratio` into its width or its font size again — that is exactly the bug the rework
  removed, and it is the claim two stale headers still made until 0157 fixed them.
- **A TEXT BOX NEVER CROPS.** Every sizing question answers to that first.
- **A RESIZE IS ABSOLUTE, NOT INCREMENTAL** (from `ResizeState.startExtent`), and a HEIGHT drag
  writes `autoresize: false`.
- **`InteractionState` HAS THREE FIELDS NOW** — a hand-built one in a test needs `resize` too.
- **A DROP-DOWN OPTION CARRIES ITS INDEX, NOT ITS LABEL** — that is what makes a boolean choice work.
  And a boolean ECHOES as `TRUE`/`FALSE`, because an echo must retype to the same value.
- **A `formula` ROW NEVER GETS A DROP-DOWN** (D-040: a gesture may not overwrite a formula).
- **`autoresize` IS NOT A MEASURED-SLOT DEPENDENCY**, which is what keeps old saved documents
  loading. If you ever make it one, you inherit D-126.
- **ADDING A DERIVED SLOT IS SAFE FOR SAVED DOCUMENTS AS OF 0156.** D-126 clause 5's "state the load
  consequence in your entry" still applies; the honest line is now "none".
- **`cellLiteralSeed` AND `buildCellCommand` ARE INVERSES AND MUST CHANGE TOGETHER.** A missing
  boolean arm on the commit side survived until a round-trip test found it.
- **`main.ts`'s `pointerDownAt` routes a canvas click to `respondToPrompt` when `state.pending` is
  set** — the path a `text` position pick takes; it does NOT select the new object.
- **A `<textarea>` soft-wraps unless you set `wrap="off"`.** An auto-width `text` object never wraps.
  **Do NOT add `white-space` to `.text-editor`** — an author rule overrides the `white-space: pre`
  that `wrap="off"` relies on. `overflow-wrap: break-word` IS set there as of 0154, deliberately, and
  `measure.ts` implements the same rule — **that pair must be changed together or not at all.**
- **`.text-editor` may not set a font, a padding or a border** — `index.html`'s comment says why.
- **`commitTextContent` NEVER sniffs for `=`** — the whole string is one literal `set`.
- **The in-place editor is mounted in `#stage`**, not `#panels`.
- **`measuredHeight` and `measuredWidth` ARE ONE MEASUREMENT (D-123 clause 2).**
- **D-123 clause 5 — the box follows the text; the text never follows the box.** Still binding.
- **DO NOT TRUST A RULING'S CLAIM ABOUT REACHABILITY — GREP FOR THE CALLER** (D-127's lesson).
- **`EvalContext` is threaded PER CALL, not on `AppState`.**
- **`#MEASURE` is a real `ErrorCode`** (`graph/node.ts`), sixth after `#SCRIPT`.
- **The operator cannot see what you can see.** Ask for a live look before treating an authoring
  surface as done — this was the deciding step in five cycles running.
