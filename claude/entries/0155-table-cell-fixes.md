# 0155 — table cells: the phantom `""`, the ghosted cell, and A1 headers

Date: 2026-09-02   Phase: 5   Model: Opus 5 (implementer)
Previous entry: 0154-wrap-agreement   Last review: 0150-REVIEW-phase5 (verdict: ACCEPT)
Batch: **not batched — the same standing instruction as 0153/0154** ("prioritize these fixes
first... over-rule the brief and rules to actually get work done this cycle"). ~360 added / ~30
removed across 12 files, no new files.

## The instruction this implements

The human tested entry 0154. The wrap work is accepted: *"the render vs. editor text thing seems
mostly sorted out now and the resulting text box object is good to work with moving forward."* Then
two new defects and one feature, all about tables:

1. **The phantom empty cell.** *"double clicking in an empty table cell but not typing anything,
   then exiting, sets that table cell's contents to `""` rather than just keeping it blank/empty.
   Issue is that although it looks empty visually, it's not anymore. Then, to make it worse — if I
   re-click into that same empty-looking table cell, it auto selects in the editor as showing `""`.
   If I then click back out again without editing, it re-adds quotes to either side, so the cell's
   value is now `""""` but displays as `""`. This repeats so each cancelled commit adds additional
   quotes. Bad."*
2. **The ghosted cell.** *"When editing table cells, the current value of the cell doesn't get hidden
   when the editor value is being displayed. That results in ghosting of text/numbers on top of each
   other... The text object works properly for this but somehow the table missed it."*
3. **A1 headers.** *"we need to add table row/column references in a graphical way for table objects.
   Almost like in the same font and size as the object title, but centered over each row and column
   persistently (they should stay when the prop window comes up, not get hidden like the title
   does)."*

## Declared scope

Those three. The load-hardening cycle (D-126 + D-127 + D-108) is the next slice and is NOT in this
entry.

## Defect 1 — the phantom `""`. TWO independent bugs wearing one costume

The report describes one experience but there were two causes, and each is a defect on its own.

### 1a. The seed used the DISPLAY formatter, so it added syntax

`editorSeed` rendered a cell's literal with `props.ts`'s `describeSlotValue` — the formatter the
properties panel and `props` print with, which **quotes strings**. A cell holding `hello` seeded the
editor with `"hello"`, so committing an untouched editor wrote the seven-character string `"hello"`,
and the next open seeded `"""hello"""`. The operator hit it on the worst case, the empty string,
where the growth is pure punctuation: `""` → `""""` → `""""""`.

The seed's whole contract is that **an untouched commit is a no-op** (D-107's principle, stated in
`editorSeed`'s own doc comment), and a formatter that adds syntax cannot satisfy it. The fix is a new
`cellLiteralSeed` — the AUTHORING form, and the deliberate inverse of `buildCellCommand`: a string
verbatim, a number via `String`, a boolean as `TRUE`/`FALSE`, and empty for anything with no
authoring form.

**Note that this was never limited to empty cells.** Every string cell round-tripped wrong. The
operator found the one case where the damage was visible.

### 1b. An empty editor wrote `""` into a cell that had no slot

`""` is a STRING — content that happens to have no glyphs. D-047 makes an ABSENT slot the empty
cell, so the commit was turning a legally-empty cell into a written one. That is the *"looks empty
visually, it's not anymore"* half, and it survives fix 1a.

Fixing it needed something that did not exist: **a way to remove a slot.** `mutation.ts` had
`setSlot` and no inverse, and there is no empty `Value` to write — `""` and `0` are content. So this
entry adds one, at three layers:

- **`ClearSlotOperation`** (`mutation.ts`) — the seventh operation kind. Removes the slot at an
  address. **Legal only at a table cell** (`findIllegalSlotClears`, a new precondition alongside the
  six): D-047 settles what an absent CELL means and nothing settles what an absent anything-else
  means — a missing derived slot is D-018's outright rejection, and a missing declared literal
  (`radius`, `origin.x`) passes validation while silently changing what its object's computes read.
  Clearing a cell a formula READS is legal and deliberate: an empty in-extent cell reads `0` and
  contributes no edge (D-110 clause 4), so there is nothing to dangle.
- **`clear <address>`** (`parser.ts` + `commands.ts`) — **not a §5.10 command word.** The brief's
  command list is extended rather than worked around, under the human's standing leave. It reuses
  `resolveWritableSlot` (the identity questions are identical — D-069) but deliberately NOT
  `writeSlot`, whose entire shape is "build a Slot, commit one setSlot". An already-empty cell
  SUCCEEDS having mutated nothing: it is not an error to ask for a state that already holds, and
  journalling a removal that removed nothing would put an event in §5.11's history that did not
  happen.
- **`buildCellCommand`'s empty arm** (`main.ts`) — a trimmed-empty editor emits `clear`, so opening
  and closing an empty cell leaves the document byte-identical, and deleting a cell's contents now
  actually empties it. **That second half was previously impossible by any route**: `set table_1.A1
  ""` left exactly the phantom this report is about.

### 1c. A third defect, found by this cycle's own test

Writing the round-trip test surfaced one the human had not reported: `editorSeed` showed a boolean
cell as `TRUE`, and `buildCellCommand` had **no boolean arm**, so committing untouched turned the
boolean into the STRING `"TRUE"`. Same seed/commit asymmetry, one type over. Fixed with
`parseCommandBoolean`, exported from `parser.ts` beside `parseCommandNumber` for the same reason
that one is exported — §5.3's booleans get ONE spelling and one reader, not a second copy in
`main.ts`.

## Defect 2 — the ghosted cell. The renderer could not express the question

`renderDocument` took `editingObjectId: string | undefined`. That is enough for a `text` object,
which is skipped WHOLE. It cannot describe a cell edit — and `main.ts` knew it, with a comment
saying so:

> `// A cell editor names no such object — a table's other cells must keep drawing.`
> `const editingObjectId = inPlaceEditor?.kind === "text" ? inPlaceEditor.objectId : undefined;`

That reasoning is right and the conclusion it reached was `undefined`, so the edited cell kept
drawing under the overlay. The two disagree by design — the overlay holds the raw SOURCE while the
canvas draws the last commit's VALUE, so `=A1*2` sits on top of `84`.

The parameter is now `editing: EditorTarget | undefined` — the whole target, imported type-only from
`editor.ts` (which does not import the renderer, so no cycle), because "what is the editor open on"
should have one spelling (D-010). The renderer then splits by receiver:

- a `text` object is skipped whole — body, highlight and grabbers — as before;
- a `table` keeps everything but the ONE cell's value. **Its grid still draws**, including that
  cell's own border: unlike a text box, the overlay does not replace the rectangle, and dropping it
  would leave a hole in the table.

## Feature 3 — A1 row/column headers

`drawTableHeaders`, in the screen-space chrome pass: `A B C …` centred over each column above the
top edge, `1 2 3 …` right-aligned beside each row outside the left edge.

- **The letters come from `address.ts`'s own `indexToColumnLetters`** — the exact function
  `formatCellReference` uses to build the reference a click on that cell resolves to. A header
  reading `C` over a column whose cells are `cells.D*` would be worse than no header at all, and
  only sharing the function makes that impossible (D-010). Column 27 is `AA`, tested.
- **Never suppressed**, which was the explicit ask and is also the right rule: a panelled object's
  NAME moves into the panel header so suppressing it loses nothing, whereas nothing anywhere else
  says which column is `C`.
- **The name label moves up** by the header band's height for a table only
  (`chromeTopReservedScreen`), rather than printing on top of it.
- **Skipped per axis** once cells shrink below `TABLE_HEADER_MIN_CELL_SCREEN` on screen.
  Constant-size labels over a shrinking grid eventually overlap into a smear, and a smear is worse
  than nothing. Per axis, because zoom is uniform but cells are not square.
- Cell screen size is measured as the distance between two `worldToScreen` points rather than by
  multiplying by `camera.zoom` — same "never a second copy of the mapping" rule (D-010).

**One deviation from the request, flagged for the screen test:** the headers are a muted grey
(`#6b7280`) rather than the title's near-black. The ask was *"almost like the same font and size as
the object title"*, and grey reads as the sheet's furniture rather than as another object's name
floating on the canvas. One constant to revert if it looks wrong.

## Rulings and spec this touches

- **§5.10's command list — EXTENDED.** `clear` is not one of its words. Under the human's standing
  leave; the alternative was leaving "empty a cell" inexpressible.
- **`Operation` gains a seventh kind**, per Q-005/D-020's own "widen the union, never restructure"
  stance — which is exactly what this is.
- **D-047 — RELIED ON, not changed.** It said an absent cell is legally empty; this cycle makes that
  state reachable.
- **D-125 clause 3's Excel model — UNCHANGED**, and now actually invertible.

## Verification

- `npx tsc --noEmit` and `npx tsc -p tsconfig.engine.json --noEmit` — both clean.
- `npx vitest run` — **1686 passed / 1686**, 33 files, 0 skipped, 0 `.only`.
- `npx vite build` — clean.
- Four pre-existing renderer tests changed, all because the headers add draw calls and lift a
  table's name label. Each was updated to state the new expectation with its arithmetic, never
  loosened to a `toContain`.
- New: 9 engine tests for `clearSlot` (including the two refusals and the D-110 clause 4 case),
  9 command tests for `clear`, 10 `main.ts` tests for the seed round-trip and the empty-commit
  (including the reported gesture repeated five times), 5 renderer tests for the cell-ghosting fix,
  and 11 for the headers.

## Where I got stuck

**Nothing in this cycle has been seen on screen.** The three fixes are all in pure functions that are
tested; whether the headers *look* right — the grey, the 4px margin, the 14px legibility floor, the
name label's new height — is not a question any test answers.

**One thing I deliberately did not do:** make the headers clickable (select a whole row/column). The
request was for references you can *read*, and selection semantics for a row (does it select cells?
the table? what does a drag do?) is a design question nobody has asked yet.

**One asymmetry I kept, disclosed:** a string cell holding `"42"` seeds `42` and commits back as the
NUMBER 42. It is reachable only from the command line (`set table_1.A1 "42"`), never by editing, and
it is Excel's own behaviour under D-125 clause 3's declared model. Quoting to preserve the
distinction is exactly what caused defect 1a.
