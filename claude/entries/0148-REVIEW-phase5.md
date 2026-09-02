# 0148 — REVIEW (phase 5): entries 0146 + 0147, the editor-polish batch — D-129 / D-130 / D-131
Date: 2026-09-02   Phase: 5   Model: Opus 5 (reviewer)
Reviewing: 0146-editor-polish and 0147-editor-polish-fixes (2 cycles, 301 source + 200 test lines
across 9 files)
Previous review: 0144-REVIEW-phase5 (ACCEPT)

Verdict: **ACCEPT WITH EDITS.** Five small reviewer edits, all listed below, one of them a real
divergence I found and pinned with a failing test before fixing. Two new binding rulings: **D-132**
(records the D-129 widening the human ordered and draws the line it now sits on) and **D-133**
(amends D-130, whose own ruling text prescribed the fix that did not work).

## Verification (re-run, not read)

```
$ npx tsc --noEmit                          -> clean, exit 0
$ npx tsc -p tsconfig.engine.json --noEmit  -> clean, exit 0
$ npx vitest run                            -> Test Files 31 passed (31)
                                               Tests    1533 passed (1533)   [before my edits]
                                               Tests    1535 passed (1535)   [after]
$ grep -rnE "\.(only|skip|todo)\(" src      -> no matches, exit 1
$ git diff --numstat 54bb820 HEAD -- src index.html
                                            -> 9 files, 301 source + 200 test added
```

**Both entries' numbers are exact.** 301 source / 200 test / 9 files is what `--numstat` returns,
digit for digit — not an estimate rounded into place, which is the failure 0144-REVIEW had to note
last time. The test arithmetic checks out end to end: 1510 (0144) → 1521 (0146: format +7, editor
+1, main +3) → 1533 (0147: editor +13 new −1 removed). I counted the `it(` lines in
`editor.test.ts` at 0144 (13) against today (26): 13 + 1 + 13 − 1 = 26. The removed test is the
`fontSize`-on-`EditorPlacement` assertion, removed because the field it asserted no longer exists —
a struct reverting to its reviewed shape, not a weakened test.

The batch is 2 cycles / 9 files against §6.3's 3 and 10. `REVIEW: REQUIRED` was called correctly
(§6.1 trigger 3, twice over). **This review closes the batch: D-124 starts at cycle 0/3 and 0 files,
not at 9/10.** STATUS's standing warning that the next cycle must stop first is now stale and I have
rewritten it.

## Rule audit

- **Rule 1 (no DOM/canvas in `engine/`, or in a pure render module)** — upheld, checked
  mechanically. `grep -nE "document\.|window\.|canvas|CanvasRenderingContext|addEventListener|HTML"`
  over `render/editor.ts` and `engine/formula/format.ts` returns header prose, doc comments, and the
  `import type … from "../engine/document.ts"` line — no DOM in code. `editor.ts`'s import set grew
  by `primitives/text.ts`'s `TEXT_STYLE_*`/`TEXT_WIDTH_PATH` (engine, read-only) and `slots.ts`'s
  `readText` (own layer). Still nothing imports `editor.ts` but `main.ts`; no cycle.
- **Rule 2 (mutation-only state change)** — upheld. `grep "^\+.*(\.slots\[|\.value =|mutate\(|
  writeSlot)"` over the whole diff returns nothing. The only new writes in `main.ts` are DOM
  properties on the overlay element (`style.fontSize`, `style.fontFamily`, `style.lineHeight`,
  `style.textAlign`, `area.wrap`). The commit seam is untouched: `commitTextContent` /
  `commitTableCell` → `runPanelCommand` → `executeCommand`, exactly as reviewed at 0144.
- **Rule 3 (addressing is load-bearing)** — upheld, and this is the load-bearing check for D-131.
  `formatFormula`'s relative mode is a DISPLAY transform only: the stored AST still holds an
  `Address` with an id and a `["cells", "A1"]` path, and nothing in the diff writes an address. The
  bare form's escape hatch fails CLOSED, which I checked rather than assumed: `parser.ts` line 529
  resolves a bare cell ref only when `state.tableObjectId` is supplied, so a relative string that
  leaks out of the cell editor into a context with no host table is REFUSED by `parseAddress`, never
  silently resolved against the wrong object. `relativeCellReference` reaches for `address.ts`'s
  `TABLE_CELL_PATH_PREFIX` and `isCellReferenceForm` instead of re-testing the shape (D-010).
- **Rule 4 (one formula engine)** — not touched. No second evaluator, no second parser; `format.ts`
  gained a parameter, not a grammar.
- **Rule 5 (dumbest correct implementation)** — upheld. `editorTextStyle` is five slot reads and a
  multiply. The `range` branch's "both or neither" is three lines of explicit belt-and-braces over a
  guarantee D-045 already gives — decision 4 of entry 0146 argues it and I agree: it makes "never
  mixed" a property of this function rather than of a distant invariant.
- **Rule 6 (slot set fixed during evaluation)** — not touched. No schema change, no derived slot
  added; the D-126 load consequence does not apply to this batch and both entries say so.
- **Rule 7 (§8 deferred list)** — upheld. D-124, markdown-lite, `overflow` and the gate are declared
  out and genuinely absent.

## Invariant audit

- **Rejection leaves prior state bit-for-bit unchanged** — not touched (no new commit path).
- **Errors propagate, nothing throws** — upheld. `editorTextStyle` reads through
  `readNumber`/`readText`, both of which narrow an `ErrorValue` away; every branch returns a finite
  number or a string. `relativeCellReference` returns `undefined` rather than throwing on a
  malformed path, and `formatOneAddress` still routes a dead object through `formatAddress`'s error
  message.
- **Graph state plain and serializable** — upheld. `EditorTextStyle` is a plain struct of numbers and
  strings, computed per paint and stored nowhere.
- **`formatFormula`'s round trip** — upheld and now proven in both files: `format.test.ts` re-parses
  the relative output with the same host and compares ASTs; `main.test.ts` seeds a real cell,
  commits the untouched seed, and compares the stored slot. That is the invariant D-131 clause 2
  actually rests on, tested at both altitudes.

## Spec conformance — the three rulings, clause by clause

- **D-129 clause 1 (font tracks the camera)** — met, and exceeded on the human's instruction.
  `editorTextStyle` scales every world length by `camera.zoom / usableRatio(ratio)`, sharing
  `usableRatio` with `editorPlacement` so the box and its glyphs can never scale by different
  factors — a good structural choice, better than passing the number twice.
- **D-129 clause 1's "family and alignment need not match"** — deliberately exceeded, correctly. The
  human reported the mismatch AS the defect; PROCESS §1 and STATUS's standing note make that outrank
  a reviewer's ruling, and entry 0147 flagged it for the record instead of quietly widening. Recorded
  as **D-132**.
- **D-129 clause 2 (never clips)** — met by `overflow: auto` plus a zero-inset content box. See
  finding 1: this is the one place I am not confident the built behaviour is the wanted one, and I
  cannot settle it from here.
- **D-129 clause 3 (box anchoring unchanged)** — met. `editorPlacement` is byte-identical to its
  0144-reviewed shape after 0147 backed 0146's `fontSize` field out of it, and its tests reverted
  with it.
- **D-130 (a pan does not commit)** — met, on the second attempt, and the second attempt is right for
  the right reason. Entry 0146 moved the explicit `commitInPlace()` below the pan branch while
  leaving `input.focus()` above it; because the overlay commits on `blur` and `focus()` fires that
  blur synchronously, the moved call was never what committed. The fix guards the FOCUS. I traced
  every path that can now reach a commit during a middle-button press and found none:
  `preventDefault()` suppresses the default focus shift, `setPointerCapture` does not blur, and the
  editor's own `keydown` `stopPropagation` keeps a typed space from ever setting `spaceHeld`.
- **D-131 clauses 1–4** — met. Bare only for a `cells.<A1>` slot of exactly the relative object;
  ranges both-or-neither; other objects stay qualified; all five other `formatFormula` call sites
  pass two arguments and are pinned unaffected by an explicit test. `editorSeed` passes the host id
  from the cell branch only — the `text` branch returns before that line, which I checked rather
  than took from the entry.

## Probes I ran

- **A blank `style.font`.** `set text_1.style.font "   "` is operator-reachable (`parser.ts` takes a
  quoted run with spaces). `renderer.ts` draws it as `sans-serif`, because `measure.ts`'s `cssFont`
  screens `family.trim() === ""` on top of `readText`'s empty-string screen. `editorTextStyle`
  applied only `readText`'s half and returned `"   "`. **Confirmed by a test written before the
  fix** — it failed with `expected '   ' to be 'sans-serif'`. This is entry 0147's own defect one
  corner in: an invalid `font-family` is dropped by the CSSOM, leaving the overlay on the page's
  inherited MONOSPACE, re-wrapping the text. Edit 1 below.
- **Where the relative form can escape.** Traced `formatFormula`'s five other call sites and
  `parser.ts`'s bare-ref gate. Fails closed (Rule 3 above).
- **The `text` branch of `editorSeed` with a host id.** Unreachable — the branch returns first.
- **`getSlot` after `readText` moved out of `renderer.ts`.** Still used at four sites there, so the
  import is not orphaned; `noUnusedLocals` is off and would not have caught it.
- **Both `tsc` configs and the full suite, before and after my edits, in a clean tree.**

## Findings

**1. `overflow: auto` gives a one-line overlay a scrollbar that eats the line. UNVERIFIED — the
first thing to look at on screen.** For the normal object (`DEFAULT_TEXT_WIDTH` is `"auto"`) the
overlay is fitted to the exact measured text: one line tall, typically 20 world units. Type one
character past the committed width and the content outgrows the box; with `overflow: auto` and no
inset, a horizontal scrollbar appears inside a ~20px-tall content box — on Windows a classic
scrollbar takes ~15px of it, which can then force a vertical one, which takes width, which re-wraps
a wrapping box. That is the same class of defect D-129 was raised to close, arriving through
D-129's own remedy. I have **not** fixed it: it is CSS nobody has seen, and the last two cycles were
both lost to confident untested DOM reasoning — that is the human's twenty seconds, not my
guess. If it reproduces, `scrollbar-width: none` (plus the `::-webkit-scrollbar` twin) keeps the
scrolling and the caret-tracking that D-129 clause 2 requires while giving the scrollbar no layout,
and stays inside the ruling. Logged as fix-list **F28**.

**2. `editorTextStyle` did not mirror `cssFont`'s blank-family screen.** Fixed — edit 1, with the
test that proves it.

**3. The zoom scaling is a `PROVISIONAL(Q-012)` reconciliation site and carried no tag.** STATUS
argued that D-129 makes the scaling a ruling rather than a guess, which is true of the DECISION but
not of the MECHANISM: *that a font size is a world length at all* is `renderer.ts`'s open Q-012
reading, and if Q-012 lands on screen pixels the renderer stops scaling the drawn font and this
function must stop scaling the typed one in the same cycle. The reconciliation grep §7 clause 4
mandates would have found `renderer.ts` ×3 and `slots.ts` ×1 and walked straight past `editor.ts`.
Fixed — edit 2.

**4. `slots.ts`'s header did not survive gaining `readText`.** It still said "narrowing a `Value` to
a `number` or a `Point[]`" and "All four exist ONLY so `renderer.ts`, `hittest.ts` and `extent.ts`
read the same slot paths the same way" — false about the file on both counts, and §5.2's whole
point is that a reader who opens one file gets a true account of it. Fixed — edit 3.

**5. `editor.ts`'s INVARIANTS overclaimed, and `style.color` was silently unmatched.**
"Mirrors `resolveTextStyle`/`drawText` read-for-read" was true of four reads out of five; the colour
read is deliberately not mirrored and was disclosed nowhere. Narrowed the claim to the
layout-affecting reads and disclosed the exception, and ruled the boundary in **D-132** so the next
cycle does not have to re-decide it. Fixed — edit 4.

**6. `main.ts`'s new `pointerdown` comment still had the commit ordering backwards.** It said the
explicit `commitInPlace()` is made "rather than left to the blur `input.focus()` just fired" — but
`focus()` fires that blur synchronously, so the blur's commit has already run and the explicit call
returns at its re-entrancy guard. The explicit call is the path for a press while the editor is open
but does not hold focus. The code is right; the comment described the mechanism the wrong way round,
which is *precisely* the misreading that produced 0146's defect, sitting in the comment that exists
to stop it recurring. Fixed — edit 5.

**7. One cheap test was missing.** `relativeCellReference`'s `path.length !== 2` branch — a
reference to a NON-cell slot of the relative object itself (`table_x.rows` inside a cell of
`table_x`) — had no test, though it is the branch that keeps clause 1 narrow. Added.

## Reviewer edits (5)

1. **`src/render/editor.ts`** — `editorTextStyle` screens a BLANK `style.font` as well as an empty
   one, matching `cssFont`. Two lines plus the comment naming the pair. `src/render/editor.test.ts`
   — one test, written failing first.
2. **`src/render/editor.ts`** — `PROVISIONAL(Q-012)` tag on `editorTextStyle`'s scaling paragraph,
   stating that this file FOLLOWS `renderer.ts`'s reading rather than taking a second one.
3. **`src/render/slots.ts`** — header corrected for `readText` (five exports, four consumers), and
   `readText`'s own doc now says it screens `""` and NOT `"   "`, so the next caller knows which half
   of the guard it owns.
4. **`src/render/editor.ts`** — INVARIANTS narrowed to the layout-affecting reads; `style.color`
   added to NOT DONE HERE with its reason (D-132).
5. **`src/main.ts`** — the `pointerdown` commit comment rewritten to name both paths and which one
   actually fires. Comment only; no behaviour change.
6. **`src/engine/formula/format.test.ts`** — one test for the non-cell same-object reference.

Net: 61 added / 20 removed across 5 files, of which the only behaviour change is edit 1's blank-family
screen. 1533 → **1535** tests, 31 files, both configs clean.

## Legibility audit

Headers are present-tense and cite rulings as supplements to stated reasons, not substitutes
(D-060's "Okay" tier or better) — `editor.ts`'s new `EditorTextStyle` doc explains *why* `wraps`
exists by naming the symptom, which is the good tier. Vocabulary locked: object, slot, literal,
formula, derived, address, extent, receiver. No `any` added. Test names are behaviour sentences and
several name the defect they pin ("`wraps` is false for an auto-width object"). `index.html`'s
comment block earns its length: "nothing here may set a font" with the reason attached is the one
thing that stops this regressing. The four stale/overclaiming sites are findings 3–6 above, now
fixed.

## Honesty audit

**This is the most honest pair of entries in the log so far, and the honesty is the reason the
defect got fixed.** Entry 0147 leads with "Entry 0146's fix was in the wrong place, and I should
have seen it," names the exact mechanism, and states the general lesson ("moving a call is not the
same as establishing it is the only caller") rather than the comfortable one ("test the DOM"). The
`readText` move to `slots.ts` is a genuine §4 scope breach — a file outside the batch — and it is
declared as one, argued on its merits, and I am ratifying it: the alternative was a second copy of a
guard whose exact subtlety was the bug being fixed, and `renderer.test.ts`'s coverage of the moved
behaviour passes unchanged. Both entries state what has NOT been seen on screen, twice, without
softening. No test was weakened; the one removed assertion tracked a deleted field.

Two things to correct, neither concealment:

- **"Sub-pixel at the default 16/20" understates the vertical-centring gap.** True at zoom 1 — but
  the half-leading is a world length like everything else here, so it scales: the same 16/20 object
  at zoom 5 sits ~4 CSS px low. Still not worth a layout hack, and still correctly disclosed; the
  number just should not be read as a constant.
- **STATUS's "entries 0143, 0146 and 0147 added no `PROVISIONAL` tags" was defensible on the letter
  and wrong on the consequence** — finding 3.

## New rulings

- **D-132** — the overlay matches every LAYOUT-AFFECTING slot of the drawn text (D-129 clause 1
  widened, as the human instructed at 0147), colour and markdown explicitly excluded, and
  `editorTextStyle` / `resolveTextStyle` / `cssFont` declared a hand-maintained pair with D-119's
  standing.
- **D-133** — amends D-130. A gesture ruled non-committing must not take FOCUS from the editor
  either; D-130's own "move the `commitInPlace()` call" prescription is withdrawn as insufficient,
  and the general form is stated: a ruling names the outcome, and where it names a call site the
  outcome governs.

## Open questions

- **None raised, none owed. Next free: Q-025.**
- **Q-012** — still open, still deferred to the `style`-slots cycle, still blocking nothing. It now
  has a fourth reconciliation site (`editor.ts`), tagged this review.
- **Q-016, Q-017** — unchanged, both the human's, neither blocking.
- **Q-008** — unchanged, provisional, blocking nothing.

## Noted, not findings

- **The command log still echoes a cell formula fully qualified** (`table_1.A1 = table_1.A2 * 2`)
  while the editor now shows `=A2 * 2`. Correct per D-131 clause 4 — the log echoes a typed COMMAND,
  and a command line has no host-table context — but the human may want the echo relative too once
  they see the two side by side. Not a defect; a question for the operator.
- **The properties panel never shows a cell formula** (`props.ts` summarises cells, D-077/D-094
  clause 8), so D-131's relative form has exactly one display site and no second surface to disagree
  with.
- **`editor.ts`'s five type-style constants still mirror `renderer.ts`'s by value.** Correctly on the
  open constant-tuning list (fix-list 8), and correctly not "fixed" from the editor's side — D-123
  clause 5 forbids that direction, and the ruling on which file OWNS one shared fallback set now
  covers three files.
- **`wrap` is set once at build, not per paint.** Right for the reason given (no gesture can change
  the `width` slot while the element holds the keyboard) — but note that a FORMULA-driven `width`
  slot can change under a mid-edit recalculation from elsewhere. Nothing can trigger one today while
  the overlay holds focus; if D-124 or a later cycle ever lets a mutation land mid-edit, `wrap` moves
  into `updateEditor`. Named so it is not rediscovered.

## Verdict

**ACCEPT WITH EDITS.**

Both rulings landed as ruled and the one that was ruled WRONG (D-130, whose text prescribed a call
move that could not work) was caught by the operator and fixed at the mechanism instead of the
symptom. The structural choice at 0147 — splitting `editorTextStyle` out rather than growing
`EditorPlacement` into a nine-field struct with a lying name, which returned the placement tests to
exactly what 0144 accepted — is the right instinct, and shrinking an unreviewed diff on the way to
fixing a defect is a move I would like to see again. The pure halves are tested hard and at the
right altitude.

What remains unverified is unchanged and unhidden: every DOM-half change in this batch, plus
finding 1, which I could not settle from here. **The live look is owed before D-124 opens this
editor on every newly-created `text` object** — that gesture inherits all of it.

Phase 5 remains OPEN. Order unchanged: **D-124** (`text` placed by pointing, opening this editor on
creation — starting a FRESH batch, 0/3 and 0 files), then the **load-hardening cycle** (D-126 +
D-127 + D-108, one `document.ts` diff), then markdown-lite with a markup-aware measurer in one
cycle, then `overflow`, then the Phase 5 gate.
