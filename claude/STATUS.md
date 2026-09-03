# STATUS — as of entry 0156-load-hardening

**ENTRY 0156 CLOSED THE LOAD-HARDENING CYCLE — D-126 + D-127 + D-108, one `document.ts` boundary.**
A loaded formula AST's SHAPE is now validated once, at the load boundary
(`formula/ast.ts`'s `validateFormulaAstShape`); the SCHEMA — not the file — says which derived slots
an object has (`withSchemaDerivedSlots`); `openDocument`'s promise chain has a `.catch`. **Adding a
derived slot to a schema is no longer a load-compatibility event.** Fix-list items 15/25/26 close.
It reported **REVIEW: REQUIRED** per D-127 clause 4 and self-reviewed with tests instead, on the
human's standing instruction — see the entry. STATE GREEN — **1709/1709**.

---


**READ THIS FIRST — entry 0154's WRAP WORK was tested on screen and is GOOD** (*"the render vs.
editor text thing seems mostly sorted out now and the resulting text box object is good to work with
moving forward"*). **Entry 0155 fixes the two TABLE defects that test found and adds A1 headers, and
is ITSELF UNSEEN.** STATE GREEN — 1686/1686, 0 skipped, 33 test files, both configs clean, `vite
build` clean. NEXT: the human tests 0155 on screen; the load-hardening cycle follows.

**THE THREE THINGS ENTRY 0155 DID (read `entries/0155-table-cell-fixes.md`):**

1. **The phantom empty cell — TWO bugs, plus a third found by its own test.** (a) `editorSeed`
   rendered a cell literal with `describeSlotValue`, the DISPLAY formatter, which QUOTES strings — so
   an untouched commit wrote `"hello"` over `hello`, and an empty cell grew two quotes per open.
   Fixed with `cellLiteralSeed`, the authoring form and the deliberate inverse of
   `buildCellCommand`. (b) An empty editor wrote `""` into a cell that had NO slot; `""` is content,
   and D-047's empty cell is an ABSENT slot. Fixed by making an empty commit a **`clear`**. (c) The
   round-trip test found that `buildCellCommand` had no BOOLEAN arm, so `TRUE` committed back as the
   string `"TRUE"` — fixed with `parseCommandBoolean`.
2. **The ghosted cell.** `renderDocument` took an `editingObjectId: string`, which cannot describe a
   CELL edit — so `main.ts` passed `undefined` for one and the committed value kept drawing under
   the overlay. It now takes the whole **`EditorTarget`**.
3. **A1 row/column headers on every table** (`drawTableHeaders`), never suppressed.

**NEW: `clear <address>` AND `mutation.ts`'s SEVENTH OPERATION KIND.** See "Read this first" 0n.

**THE TWO THINGS ENTRY 0154 CHANGED (read `entries/0154-wrap-agreement.md` for the full account):**

1. **`render/measure.ts` now breaks lines by CSS's rules, deliberately** — `white-space: pre-wrap` +
   `overflow-wrap: break-word`, which is what the editor's `<textarea>` uses. Two visible defects,
   one cause: it never broke inside a word (so an unbroken run of text drew straight out through the
   side of its own box while the editor broke it neatly), and it collapsed runs of spaces (so `"a  b"`
   measured narrower than it laid out — one extra line in the editor near a boundary, AND the canvas
   drew `"a  b"` as `"a b"`). Now: spaces preserved, trailing spaces HANG, a too-wide word split
   between code points. **This is not the slop 0151-RULINGS forbade — see the entry's own paragraph
   on the distinction. The measurer adopted the browser's specified rule; it did not add a fudge.**
2. **The `text` `overflow` slot is REMOVED** — the slot, not just 0153's drop-down. The human's
   call, answering the question STATUS carried in their name: *"Remove overflow options — always
   default to a standard overflow."* Nothing read it, `clip`/`ellipsis` were never built, and "a text
   box never crops" leaves them nothing to mean. **A document saved with one still loads** (an extra
   LITERAL slot is legal; it stops being enumerated). `TEXT_SCHEMA` is back to ELEVEN non-derived.

**WHAT TO TEST ON SCREEN (nothing in 0154 has been seen):**
- In a box with a set width (`set text_1.width 200`), type a long unbroken run — `aaaaaaaa…` or a
  URL. Does it now BREAK inside the word, and does the box stay at the width you dragged?
- Type a double space mid-sentence. Does the canvas DRAW both spaces once the editor closes?
- The X-vs-X+1 line disagreement: still there? **If yes, the one question that decides it — do the
  misbehaving boxes contain `{= }` references?** The editor shows RAW SOURCE and the canvas draws
  the RESOLVED value, so those two legitimately differ in length. If the remaining cases are plain text,
  the cause is platform glyph quantization and 0154's "Where I got stuck" says why there is no
  honest fix from the measurer's side.
- The properties panel: `overflow` should have NO row at all now. `style.align` and `autoresize`
  should still be drop-downs that commit on change.
- Drag a width grabber narrower than the longest word. It should now go where you drag it (it used
  to snap back to that word's width).

**WHAT TO TEST ON SCREEN FOR 0155:**
- Double-click an empty cell, type nothing, click out. Then `props table_1` — is there STILL no
  `A1`? Repeat five times; no quotes should ever appear.
- Type `hello` in a cell, click out, double-click back in, click out untouched. Still `hello`, not
  `"hello"`.
- Type something in a cell, then delete it all and click out. Does the cell go genuinely EMPTY?
- Double-click a cell that HAS a value — does the old value vanish while you type, or ghost under it?
- Every table should show `A B C…` above and `1 2 3…` beside, always — including while its
  properties panel is open. Do the letters line up with the columns they name?
- Zoom out a long way: the headers should DISAPPEAR rather than smear into each other.
- **Is the grey right?** The headers are `#6b7280`, not the title's near-black. One constant.

**Still unconfirmed from 0153 (re-test if you have not):** eight grabbers and the resize cursor; a
dragged height surviving; toggling `autoresize` back to shrink-to-fit; text looking identical
editing vs not editing.

---

## Where the code actually is — as of entry 0155

STATE: **GREEN**. Both configs compile, **1709/1709** tests pass, 0 skipped, 0 `.only`.
**33 test files.** `npx vite build` clean. **PHASE 5 IS OPEN.**

Last review point: **0150-REVIEW-phase5**. Entries since: **0151-RULINGS** (D-135 + D-136, no code),
**0152** (the editor cycle — built, tested on screen, GOOD), **0153** (the text-box rework —
**tested on screen, GOOD**), **0154** (wrap agreement + `overflow` removal — **tested on screen,
GOOD**), **0155** (the table-cell fixes + A1 headers — self-reviewed with tests, UNSEEN), **0156**
(load hardening — D-126 + D-127 + D-108; **REVIEW: REQUIRED, not taken** on the human's standing
instruction).

**THREE REVIEW TRIGGERS HAVE FIRED AND BEEN WAIVED** (0153, 0155, 0156). The human's standing
instruction for this session is explicit and repeated; the waivers are recorded in each entry rather
than dropped, so a reviewer picking this up knows exactly what was not reviewed. **0156 is the one
that most wants a second pair of eyes** — `document.ts` is §6.2 load-bearing.

**THE HUMAN'S DIRECT INSTRUCTION OUTRANKS `PROJECT_BRIEF.md` AND ANY PRIOR RULING (0140, restated
2026-09-02).** Entries 0153, 0154 and 0155 overrule several by their explicit leave — the lists are
in those entries and are summarised under "Settled" below. **Never "correct" the code back toward an
overruled ruling.**

## Read this first — what a cold reader needs

**0. `TEXT_SCHEMA` HAS ELEVEN NON-DERIVED + THREE DERIVED SLOTS.** Non-derived: `origin.x`/`origin.y`
(D-121) + `content` + `width`/`height`/**`autoresize`** + five `style.*`. **NO `overflow`** — the slot
was REMOVED at 0154 on the human's instruction; `autoresize` took its place in the count. Derived:
`resolvedContent` (dynamic deps), `measuredHeight` and `measuredWidth` (static deps, **the SAME
list** — one measurement answers both).

**0a. `autoresize` IS NOT A DEPENDENCY OF EITHER MEASURED SLOT, AND THAT IS THE POINT.** It sizes the
BOX, not the TEXT. Two consequences, both wanted: toggling it never re-measures, and **a document
saved before it existed still loads** (nothing derived depends on it → no dangling edge; every
reader defaults it to `true`). D-126's trap avoided by construction. There is a test.

**0s. THE LOADER IS HARDENED (0156). TWO FACTS A COLD READER NEEDS.**
- **A loaded formula AST's SHAPE is validated ONCE, at the boundary** —
  `formula/ast.ts`'s `validateFormulaAstShape`, called from `document.ts`'s `reconstructSlot`
  BEFORE the depth check (the depth check itself walks the AST). It descends at most
  `MAX_FORMULA_AST_DEPTH` and stops; the depth check that runs next refuses anything deeper, so
  nothing below the bound is reachable. **D-108 clause 3 still forbids hardening any individual
  walker** — `exceedsMaxFormulaAstDepth`, `collectIllegalAstLiterals`, `deps.ts`, `eval.ts` all stay
  guard-free, and this boundary is what makes that safe. `BinaryOperator`/`UnaryOperator` are now
  DERIVED from `BINARY_OPERATORS`/`UNARY_OPERATORS` so the validator cannot drift from the type.
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
Word.

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
`executeCommand` / `pointerMove` / `loadDocument` and the pure transitions. **The in-place editor now
uses it directly too** (`editorTextBoxSize` on every keystroke).

**0g. `render/measure.ts` — line-breaking lives HERE (D-120), never in `src/engine/`. AND IT
IMPLEMENTS CSS'S RULES ON PURPOSE (0154):** `white-space: pre-wrap` + `overflow-wrap: break-word`,
because that is what the editor's `<textarea>` uses and the two must not drift. Spaces are
PRESERVED, not collapsed; trailing spaces HANG (trimmed off the emitted line — no width, no break);
a word too wide for its own line is split between CODE POINTS (`break-word`, not `break-all` — it
moves to a fresh line first and is only then broken). Not Rule-5 slop and not a fudge: the browser's
rule adopted, so drawn and typed agree by construction (D-010).

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
  box (its width is otherwise the exact end of the text, and `overflow: hidden` would clip the
  caret); never for a wrapping one, where widening would move a break.

`main.ts`'s pure half: `commitTextContent` (ALWAYS a literal `set`), `commitTableCell` (Excel-style),
`editorSeed`, `abandonCreatedTextBox` (D-136 clause 2), **`commitPanelChoice`** (a drop-down's
literal write). All go through `runPanelCommand` → `executeCommand` — NO second write path (Rule 2).
DOM half in `start`: opens on a double-click OR on a newly-created `text` whose command carried no
content (D-124 + D-136 clause 1); blur/click-outside commits, Escape cancels, Enter commits in a
cell; a PAN press does not commit or steal focus (D-130/D-133); an editor opened on-create that ends
empty deletes the box (D-136 clause 2). **Every keystroke repaints** (`input` → `paint` →
`updateEditor`), which is what grows the box.

**0j. `render/handles.ts` — the eight resize grabbers.** `hasResizeHandles` is `text`-ONLY (a shape's
size is `radius`/`sides`; a table's is `rows`/`cols` — a different question). `resizeHandleAt` is a
SCREEN-space test with a pixel tolerance, so a grabber is one size at every zoom. `resizeBox` clamps
so an edge can never cross its opposite.

**0k. A RESIZE IS ABSOLUTE, NOT INCREMENTAL, AND THIS IS LOAD-BEARING.** Each step recomputes the box
from `ResizeState.startExtent` plus the total delta since the press. Incremental would read the
committed box back in — which `textbox.ts` has already grown to fit the text — and run away from the
pointer. **A HEIGHT drag also writes `autoresize: false`**, or the box snaps straight back and the
grabber looks broken (Word does the same).

**0l. `InteractionState` HAS THREE FIELDS: `selectedObjectIds`, `drag`, `resize`.** `resize` is a
SEPARATE field, never a variant of `drag`, so every existing reader of `drag` still means what it
meant. A hand-built `InteractionState` in a test needs all three.

**0n. `mutation.ts` HAS SEVEN OPERATION KINDS — `clearSlot` JOINED AT 0155.** It REMOVES the slot at
an address, because there is no empty `Value` to write: D-047 makes an ABSENT cell slot the empty
cell, and `""`/`0` are content. **Legal ONLY at a table cell** (`findIllegalSlotClears`, a seventh
precondition): D-047 settles that one case and nothing settles any other — a missing derived slot is
D-018's rejection, a missing declared literal silently changes what its object's computes read.
Clearing a cell a formula READS is fine (D-110 clause 4: empty in-extent reads `0`, no edge).

**0o. `clear <address>` IS A COMMAND, AND IS NOT IN §5.10.** Added at 0155 under the human's standing
leave, because "empty this cell" was inexpressible. It reuses `resolveWritableSlot` but NOT
`writeSlot` (whose whole shape is "build a Slot, commit a setSlot"). **An already-empty cell
SUCCEEDS and mutates nothing** — no journal entry for an event that did not happen. `main.ts`'s
`buildCellCommand` emits it whenever the in-place editor is left blank.

**0p. `editorSeed` USES THE AUTHORING FORM, NEVER `describeSlotValue`.** That formatter QUOTES
strings and is for DISPLAY; using it made an untouched commit rewrite `hello` as `"hello"` and grow
two quotes per open on an empty cell (the human's 2026-09-02 report). `cellLiteralSeed` is the
deliberate INVERSE of `buildCellCommand`, and the two must be changed together — a boolean arm was
missing from the commit side and only the round-trip test caught it.

**0q. `renderDocument` TAKES THE WHOLE `EditorTarget`, NOT AN OBJECT ID.** A `text` receiver is
skipped WHOLE (body, highlight, grabbers); a `table` keeps everything but the ONE edited cell's
value — its grid, including that cell's border, still draws. An id alone could not express the
second, which is exactly why the cell ghosted.

**0r. A TABLE'S A1 HEADERS ARE NEVER SUPPRESSED** (`drawTableHeaders`, 0155). Unlike the name label,
which moves into the properties panel, nothing else says which column is `C`. Letters come from
`address.ts`'s `indexToColumnLetters` — the SAME function `formatCellReference` uses, so a header
can never name a different column than the cell under it (D-010). Skipped per axis below
`TABLE_HEADER_MIN_CELL_SCREEN`. A table's name label is lifted by `chromeTopReservedScreen` to clear
them.

**0m. A SLOT WITH A CLOSED VALUE SET IS DECLARED ON THE SCHEMA** (`ObjectSchema.slotOptions`,
`findSlotOptions`) — `text`'s `style.align` and `autoresize` are the only two today (`overflow` was
a third for exactly one cycle; 0154 removed the slot).
`SlotDescriptor.options` → `PanelRow.choices` → a `<select>` committing on `change`. The option's
DOM value is its **INDEX**, never its label or a stringified value — an index resolves back to the
exact `Value`, including a boolean, which no string round-trip does. **Only a `literal` row gets a
drop-down**; a `formula` row keeps its blue paperclip (it is driven — D-040).

**1. PHASE 4'S GATE TEST IS `main.test.ts`'s `describe` "PHASE 4'S ACCEPTANCE CRITERION" (7 tests).**
Do not weaken; do not fold.

**2. D-110's DISCLOSED CONSEQUENCE — `refs` HAS TWO FORMS (D-112).** Neither may be "fixed".

**3. THE PANEL IS BUILT AND REVIEWED — DO NOT RE-BUILD IT.** D-094/D-100/D-101/D-106/D-102/D-107.
0153 ADDED drop-down rows; it replaced nothing else.

**4. `main.ts`'s DOM half (`start`) IS UNTESTED BY CONSTRUCTION (D-001) AND KEEPS GROWING.** 0153
added the overlay's transform/live-growth wiring, the canvas cursor, and the drop-down `change`
listener. Every DECISION behind them is in an exported pure function that is tested.

**5. THE VANISHING-TABLE DEFECT IS FIXED (entry 0101) — D-097/D-098/D-099 are CLOSED.**

**6. D-104 IS OWED BY A CYCLE THAT HAS NOT BEEN SCHEDULED.** `insertTableLine`/`deleteTableLine` not
bounded by `MIN`/`MAX_TABLE_LINES`. Not command-reachable. Fix in `findInvalidTableResizes`.

**7. D-108 / D-126 / D-127 ARE BUILT (0156).** See "Read this first" 0s. **D-108 clause 3's
prohibition on hardening any individual AST walker SURVIVES the fix** — the boundary check is what
makes `deps.ts`/`eval.ts`/`exceedsMaxFormulaAstDepth`/`collectIllegalAstLiterals` safe to leave
guard-free. Do not "helpfully" add a null check to one of them.

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

## Next slice (recommended)

**Blocked on the human's on-screen test of entry 0155** (the script is at the top of this file).
Whatever that finds comes first. The one question 0154 could not settle without a screen is still
open: **do the remaining X-vs-X+1 cases contain `{= }` references?**

Once the editor surface is clean on screen:

**~~THE LOAD-HARDENING CYCLE~~ — DONE at 0156.** D-126 + D-127 + D-108 all discharged.

Next: **markdown-lite rendering** (§5.6's exact list, in `renderer.ts`'s `drawText`, with
`render/measure.ts` made markup-aware in the SAME cycle so drawn and measured agree — **and the
in-place editor, which shows RAW source, will then differ from the canvas by design; decide
deliberately what the overlay shows**). Then the **Phase 5 gate**: an executable test over one
document proving the §6 criterion, `REVIEW: REQUIRED`.

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
**0151-RULINGS** D-135 + D-136 · **0152** the editor cycle (D-135 + D-136) — **confirmed GOOD on
screen 2026-09-02** · **0153** the text-box rework — **confirmed GOOD on screen 2026-09-02**, with
two defects that entry 0154 fixes.

## Built this batch, not yet seen on screen

- **Entry 0156 — load hardening.** No new files. Modified: `engine/formula/ast.ts`
  (`validateFormulaAstShape` + the operator arrays), `engine/document.ts` (the boundary call +
  `withSchemaDerivedSlots` + the corrected claims), `main.ts` (`openDocument`'s `.catch`), plus
  `document.test.ts`. **REVIEW: REQUIRED, waived** — the one cycle here that most wants a reviewer.
- **Entry 0155 — the table-cell fixes + A1 headers.** No new files. Modified: `engine/mutation.ts`
  (the `clearSlot` operation + its precondition), `command/parser.ts` (`clear`,
  `parseCommandBoolean`), `command/commands.ts` (the `clear` handler), `main.ts` (`cellLiteralSeed`,
  `buildCellCommand`'s empty and boolean arms, the whole-`EditorTarget` render call),
  `render/renderer.ts` (cell-aware editing suppression, `drawTableHeaders`), plus five test files.
  **Their on-screen test is the gate.**

## Not started

D-090's prompt-sequence preview · §5.9's per-vertex drag path ·
`polyline`/`explode`/`addvertex`/`delvertex` · `style` slots as authorable · point-in-polygon fill
hit-testing (D-067) · §5.4's formula bar · D-088 clauses 2–4 · D-089 · D-102 clause 9 ·
**D-109 clauses 1–2** · markdown-lite rendering
+ a markup-aware measurer · the Phase 5 gate test · Phases 6–7. (**`text` `overflow` clip/ellipsis is
no longer on this list — 0154 removed the slot on the human's instruction.**)

## Open fix list — read 0090-REVIEW §9, 0091-REVIEW §5 and 0100-REVIEW §9 for the full text

Numbering follows 0090-REVIEW §9. Items 2–13, 15–21, 23–24 unchanged and open unless noted.

1. **DONE at entry 0112**, reviewed 0113.
2. **Give the missing-slot refusal a remedy.** Message only; narrowed by D-110 to clause 6's cases.
3. **`findDanglingReferences` names one dependent once per MISSING SOURCE.**
4. **`zoom`'s refusal names `Infinity`.** Message only.
5. **Carried from 0074-REVIEW §9, all six unchanged.**
6. **A middle-drag pan started outside the canvas is untested.** Owned by D-088's cycle.
7. **`TABLE_GRID_STROKE_STYLE` has no comment** (D-091). Owned by the `style`-slots cycle.
8. **The screen-space chrome constants are untuned** (Rule 5). `handles.ts`'s
   `RESIZE_HANDLE_SIZE_SCREEN` / `_TOLERANCE_SCREEN` / `MIN_TEXT_BOX_SIZE` and `editor.ts`'s
   `CARET_ALLOWANCE` join this list. `editor.ts`'s `EMPTY_TEXT_EDITOR_*` are GONE (folded into
   `textbox.ts`'s single fallback pair at 0153).
9. **The chrome pass leaves `ctx.font`/`textAlign`/`textBaseline` set on return.** Harmless.
10. **The formula-driven indicator's narrowness (`origin.x`/`origin.y` only) should be RE-DECIDED.**
11. **A display-only panel's `overflow: auto` scroll resets on every paint.**
12. **A right-flipped panel that hits the right clamp overlaps its own object.** Correct per D-094.
13. **`insertTableLine`/`deleteTableLine` are not bounded by `MIN`/`MAX_TABLE_LINES`** — **D-104**.
14. **0110-REVIEW's F1–F4 — BUILT (0111), REVIEWED (0113).** Closed. **Q-016** carries F3's tail.
15. **F5 — CLOSED at 0156.** `validateFormulaAstShape` validates a loaded AST at the boundary; the
    doc claims are corrected; 15 malformed shapes are pinned. **D-108 clause 3's prohibition on
    piecemeal walker hardening SURVIVES** — no walker was touched, and none should be.
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
25. **F23 — CLOSED at 0156.** The loader rebuilds derived slots from the SCHEMA, so adding one no
    longer invalidates saved documents. Round-trip tested.
26. **F24 — CLOSED at 0156.** `openDocument`'s promise chain has a rejection path; the loader no
    longer throws for a malformed AST. **D-127's lesson stands: a ruling deferred work to a trigger
    that had already fired 24 entries earlier, and it survived nine STATUS rewrites because it was
    ASSERTED rather than grepped.**
27. **F25 — RULED D-129, BUILT (0146/0147), REVIEWED (0148) → D-132. CLOSED.** 0153 reworked the
    mechanism (world units + one transform) for a better reason than D-129's.
28. **F26 — RULED D-130, FIXED (0147), REVIEWED (0148) → D-133. CLOSED**, confirmed on screen.
29. **F27 — RULED D-131, BUILT (0146), REVIEWED (0148). CLOSED.**
30. **F28 — RULED D-135, BUILT (0152). CLOSED, and SUPERSEDED at 0153:** the scrollbars are not
    hidden, they are unnecessary — `overflow: hidden` plus a box that grows.
31. **F29 — RULED D-136, BUILT (0152). CLOSED and CONFIRMED ON SCREEN 2026-09-02.**

## Known problems (detail lives where the pointer says)

- **ENTRY 0155 IS UNSEEN ON SCREEN.** 0153 and 0154 were both seen and are GOOD; 0155 is the fix for
  the two TABLE defects 0154's test found, plus the A1 headers, and nothing in it has been looked at.
- **THE A1 HEADERS ARE GREY (`#6b7280`), NOT THE TITLE'S NEAR-BLACK.** The ask was "almost like the
  same font and size as the object title"; grey reads as sheet furniture rather than another
  object's name. One constant to revert if it looks wrong on screen.
- **THE HEADERS ARE NOT CLICKABLE.** Selecting a whole row/column is a design question nobody has
  asked (does it select cells? the table? what does a drag do?) — deliberately not invented.
- **A string cell holding `"42"` seeds `42` and commits back as the NUMBER 42.** Reachable only from
  the command line, never by editing; Excel's own behaviour under D-125 clause 3. Quoting to
  preserve the distinction is what caused the 2026-09-02 defect.
- **The X-vs-X+1 wrap residual may not be fully closed.** 0154 fixed two real causes (mid-word
  breaking, space collapsing) and proved both with tests. **Two candidates remain and the human's
  answer to ONE question decides which: do the misbehaving boxes contain `{= }` references?** If yes
  it is by design — the editor shows RAW SOURCE, the canvas draws `resolvedContent`, and those are
  different strings. If no, it is platform glyph quantization (canvas `measureText` returns float
  advances; Chrome on Windows can quantize DOM advances to whole pixels), which is cumulative over a
  line and has **no honest fix from the measurer's side**. **0151-RULINGS' "Carried forward" still
  binds for that case: do NOT add slop to `render/measure.ts` or a compensating `letter-spacing` to
  the overlay.** 0154's own change is NOT slop — read its paragraph on the distinction before
  assuming otherwise.
- **A panel with a focused `<select>` stops updating its other rows** until it is blurred. The
  smaller injury versus tearing the control out mid-gesture; self-heals on blur.
- **A freshly-created `text` object opens its editor UNSELECTED** (entry 0149 Decision 4; D-136
  clause 4 leaves it). Human's call on sight.
- **`text 30,40` (unquoted, comma) places a box at (30,40) with empty content** (entry 0149).
- **THE EDITOR SHOWS RAW SOURCE; THE CANVAS DRAWS `resolvedContent`.** For plain text those are the
  same string. For a box containing a `{= … }` block they are NOT — the source is usually longer, so
  it legitimately wraps to more lines while being edited. Unavoidable (you cannot edit a reference
  you cannot see) but it looks exactly like the wrap defect, which is why 0154 named it as a
  candidate for the X-vs-X+1 residual. Markdown markup is likewise raw on both sides today, so it
  agrees; the markdown-lite cycle will make THAT differ and must decide deliberately what the
  overlay shows.
- **the cell editor does not reproduce `TABLE_CELL_TEXT_PADDING`'s 4-unit inset, and left-aligns a
  number cell** — deliberate. `editor.ts`'s NOT DONE HERE.
- **the properties panel and the in-place editor can overlap** at small window sizes. No remedy.
- **A raw `setSlot` LOWERING `rows`/`cols` still strands any now-out-of-bounds cell slot** —
  `primitives/table.ts`'s header.
- ~~A saved document does not survive a DERIVED-slot addition~~ — **FIXED at 0156.**
- ~~A malformed loaded `ast` throws out of `loadDocument`~~ — **FIXED at 0156.**
- **The JOURNAL's `Operation` payloads are still unvalidated beyond `Array.isArray` + a raw
  illegal-number walk.** Deliberate and unchanged: nothing replays the journal, so inventing a
  contract for a reader that does not exist would be the defect. Validate it the moment something
  reads it. Named in `document.ts`'s own header.
- **A loaded document can carry a `formula`/`derived` `content` slot on a `text` object** (D-122
  blocks the command path, not the loader).
- **BOTH measured slots are `#MEASURE` for a `text` object created in a test** (default
  `NULL_EVAL_CONTEXT`), so its box falls back to `textbox.ts`'s 240×20 there. **The in-place editor
  degrades the same way** — with no real measurer the live box never grows.
- **`measure.ts` and `renderer.ts` fall back DIFFERENTLY for an unusable `style.*` slot.** Disclosed
  in both headers; unfixed — one shared set of fallbacks needs a ruling on which file owns them.
  **D-123 clause 5 forbids fixing it from the renderer's side.** `render/editor.ts` is a THIRD
  reader of that set (mirrors by value: 16 / 20 / "sans-serif" / 14).
- **`extent.ts` trusts the stored measurement; `renderer.ts` re-wraps with its own `ctx`.** D-123
  clause 5: the box follows the text, never the reverse.
- **An empty-`content` `text` object is invisible AND unselectable** — no ink, no extent, no hit box
  (D-066). D-124 creates exactly this; D-136 clause 2 removes an abandoned one; the editor's own
  overlay is what makes a live one real on screen.
- **`x`/`y` are OPTIONAL for the `text` command (default `0`, D-121 clause 3)** but REQUIRED for
  `circle`/`polygon`/`rect`/`table`.
- **`DEFAULT_TEXT_*` style values are the handler's provisional pick** — no ruling, no tag.
- **`resolveTextDependencyAddresses` and `deriveEdges` Source 1 are a hand-maintained PAIR (D-119).**
- **`main.ts`'s `start` is untested code and keeps growing.** Verified live, not by assertion.
- **The properties panel positions an off-screen selected object's panel clamped to a canvas edge.**
- **A prompt sequence still shows nothing where you clicked** — ruled **D-090**, queued.
- **The formula-driven indicator is read NARROWLY** — `origin.x`/`origin.y` only.
- **A printable keystroke does not reach the command input unless it is focused** — D-088 clauses 2–4
  not built. **No command history** (**D-089**, queued).
- **Every pointer move repaints the canvas, and now every EDITOR keystroke does too.** Rule 5's
  accepted trade — it is what grows the box.
- **`escape` is bound to the window.** The in-place editor's own keydown `stopPropagation`s, so a
  focused editor's Escape reaches `cancelInPlace` (which may `abandonCreatedTextBox`).
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
- **A 1000×1000 table is legal and costs ~1.5 s per MUTATION.** Rule 5's accepted trade (D-077 c3).
- **`renderer.ts`'s `formatCellValue`, `props.ts`'s `describeSlotValue`, and `mutation.ts`'s
  `describeDimensionSlotValue` are three separate `Value`-to-text formatters** — deliberate.
- **`primitives/text.ts` CANNOT import `mutation.ts`** (D-119).
- **`render/editor.ts` imports `hittest.ts` + `extent.ts` + `camera.ts` + `slots.ts` + `textbox.ts` +
  engine leaves.** `render/handles.ts` imports `camera.ts` + `extent.ts` + engine leaves.
  `render/textbox.ts` imports NOTHING. No cycles.
- **Carried unchanged:** `set-formula` is a `kind` not a registry name · comment debt in TEST files ·
  mixed line endings in the WORKING TREE only (`core.autocrlf=true`) · dangling-reference messages
  name the DEPENDENT not the missing SOURCE · D-022's bounded-correctness claim fails for `table` ·
  `describeValueType` duplicated in `functions.ts`/`eval.ts` · `rewrite`/
  `repairObjectFormulaAddresses` walk `formula` slots only · journal structure unvalidated beyond
  `Array.isArray` · `lexer.ts`'s two edge cases · §5.11's `style` field · `noUnusedLocals` off ·
  `.gitattributes` still owed.

## Settled — do not re-raise

Every ruling in `DECISIONS.md` (D-001 through D-136) binds **except where entry 0153 overruled one
on the human's explicit instruction.** Those, in full:

- **D-123 clause 3 — INVERTED.** A set `width`/`height` no longer crops the text; the box grows.
  `hittest.test.ts`'s test of the old rule was rewritten. Clause 2 (one measurement, two slots) and
  clause 5 (the box follows the text, never the reverse) both STAND.
- **D-129 clause 2 / D-135 — SUPERSEDED.** `overflow: auto` and zero-layout scrollbars are replaced
  by `overflow: hidden` plus a box that grows. Same complaint, better answer.
- **D-132's colour clause — REVERSED.** The overlay matches `style.color`.
- **D-129's zoom-scaled type style — MOVED.** `editorTextStyle` reports WORLD lengths; the scaling
  is one CSS transform. This is what makes the layouts match.
- **§5.6's `TextBox` slot list — DEVIATED, TWICE.** `autoresize` was ADDED (0153), like D-121's
  `origin.*` and D-123's `measuredWidth` before it; **`overflow` was REMOVED (0154)** on the human's
  instruction — the first time a brief-named slot has been deleted rather than extended. Net: still
  eleven.
- **D-102 clause 6's panel grammar — NARROWED.** A drop-down row writes a literal directly. Free-text
  rows are untouched, so **Q-016 stays OPEN** for them.
- **D-120's "no mid-word breaking" — REVERSED (0154).** `layOutLines` now implements CSS's
  `pre-wrap` + `break-word`, because the editor's `<textarea>` does and the two must agree. D-120's
  actual ruling — that line-breaking lives in `render/measure.ts` and never in `src/engine/` —
  STANDS untouched; only the parenthetical about how it breaks is superseded.
- **§5.10's command list — EXTENDED (0155).** `clear <address>` is not one of its words. Added
  because "make this cell empty again" was inexpressible: D-047 makes an absent slot the empty cell,
  and `setSlot` had no inverse. **D-047 itself is RELIED ON, not changed** — 0155 makes the state it
  describes reachable.

Otherwise standing, unchanged: **D-114/D-115/D-116/D-117** (built, reviewed 0128) · **D-118** (built,
wired, reviewed 0133) · **D-119** (reconciled) · **D-120** (built, reviewed 0133) · **D-121/D-122**
(built 0136, reviewed 0137) · **D-124 + D-134** (built 0149, reviewed 0150) · **D-125 + D-128** (the
in-place editor, built 0143, reviewed 0144) · **D-130/D-131/D-133** (built 0146/0147, reviewed 0148,
D-130/D-133 confirmed on screen) · **D-136** (built 0152, confirmed on screen).

**D-126 / D-127 / D-108 — BUILT at 0156**, all clauses discharged, `REVIEW: REQUIRED` waived on the
human's standing instruction and recorded in the entry.

**D-046 STANDS.** A dimension slot is read `literal`-only and fails closed to `0`. `content`
inherits the same posture.

**D-094's fourteen clauses stand** · **D-096's four clauses stand.**

**From 0091-REVIEW:** **D-088** (clause 1 built, 2–4 queued) · **D-089** (queued) · **D-090**
(queued) · **D-091**. **From 0090-REVIEW:** D-084–D-087 implemented. Still owed: **D-074**.

**Q-014 and Q-018 are CLOSED.** **Q-013 is NOT mooted.** **Q-016 and Q-017 remain OPEN**, both the
human's, neither blocking. **Q-019 → D-116**, **Q-020 → D-117**, **Q-021 → D-120**, **Q-022 →
D-121**, **Q-023 → D-122**, **Q-024 → D-123** — all CLOSED. Next free: **Q-025**.

## Live PROVISIONAL tags and open questions

**`PROVISIONAL(Q-012)` → `src/render/renderer.ts`** (×3), **`src/render/slots.ts`** (×1) and
**`src/render/editor.ts`** (×1): world units or screen pixels for stroke width / cell size / font?
Provisional (a) world units. Due with the `style`-slots cycle. **0153 reworded `editor.ts`'s tag** —
that file no longer scales the font itself, so its reconciliation note now says "if Q-012 lands on
screen pixels, `renderer.ts` stops scaling the drawn font and this file's `scale` stops applying to
the type." `handles.ts` and `textbox.ts` added NO new site: handles are explicitly screen-space
chrome, and `textbox.ts` deals only in world lengths handed to it.

**`PROVISIONAL(Q-008)` → `src/engine/graph/node.ts`** (×2, `-0`): open, deferred, blocking nothing.

**No other `PROVISIONAL` tags exist.**

## Gotchas for the next model

- **THE 2026-09-02 TEXT-BOX WORK (entries 0153 + 0154) OVERRULED EIGHT PRIOR RULINGS ON THE HUMAN'S
  EXPLICIT INSTRUCTION.** The list is under "Settled" above. **Never "correct" the code back toward
  one.** In particular: a text box never crops, the measurer breaks words, and there is no
  `overflow` slot.
- **`render/textbox.ts` IS THE ONE BOX-SIZING RULE.** Three readers. Do not add a fourth reading.
- **THE OVERLAY IS LAID OUT IN WORLD UNITS AND SCALED BY ONE TRANSFORM.** Do not pre-multiply
  `camera.zoom / ratio` into its width or its font size again — that is exactly the bug the rework
  removed.
- **A TEXT BOX NEVER CROPS.** Every sizing question answers to that first.
- **A RESIZE IS ABSOLUTE, NOT INCREMENTAL** (from `ResizeState.startExtent`), and a HEIGHT drag
  writes `autoresize: false`.
- **`InteractionState` HAS THREE FIELDS NOW** — a hand-built one in a test needs `resize` too.
- **A DROP-DOWN OPTION CARRIES ITS INDEX, NOT ITS LABEL** — that is what makes a boolean choice work.
- **A `formula` ROW NEVER GETS A DROP-DOWN** (D-040: a gesture may not overwrite a formula).
- **`autoresize` IS NOT A MEASURED-SLOT DEPENDENCY**, which is what keeps old saved documents
  loading. If you ever make it one, you inherit D-126.
- **ADDING A DERIVED SLOT IS SAFE FOR SAVED DOCUMENTS AS OF 0156** (D-126 built). D-126 clause 5's
  "state the load consequence in your entry" still applies; the honest line is now "none".
- **`main.ts`'s `pointerDownAt` routes a canvas click to `respondToPrompt` when `state.pending` is
  set** — the path a `text` position pick takes; it does NOT select the new object.
- **A `<textarea>` soft-wraps unless you set `wrap="off"`.** An auto-width `text` object never wraps.
  **Do NOT add `white-space` to `.text-editor`** — an author rule overrides the `white-space: pre`
  that `wrap="off"` relies on, and would re-break exactly the auto-width lines that must stay whole.
  `overflow-wrap: break-word` IS set there as of 0154, deliberately, and `measure.ts` now implements
  the same rule — that pair must be changed together or not at all. (This gotcha said the opposite
  before 0154. The reason it did — that the measurer refused to break mid-word — is gone.)
- **`.text-editor` may not set a font, a padding or a border** — `index.html`'s comment says why.
- **`commitTextContent` NEVER sniffs for `=`** — the whole string is one literal `set`.
- **The in-place editor is mounted in `#stage`**, not `#panels`.
- **`measuredHeight` and `measuredWidth` ARE ONE MEASUREMENT (D-123 clause 2).**
- **D-123 clause 5 — the box follows the text; the text never follows the box.** Still binding.
- **DO NOT TRUST A RULING'S CLAIM ABOUT REACHABILITY — GREP FOR THE CALLER** (D-127's lesson).
- **`EvalContext` is threaded PER CALL, not on `AppState`.**
- **`#MEASURE` is a real `ErrorCode`** (`graph/node.ts`), sixth after `#SCRIPT`.
- **The operator cannot see what you can see.** Ask for a live look before treating an authoring
  surface as done — this is the fourth cycle in a row where that was the deciding step.
