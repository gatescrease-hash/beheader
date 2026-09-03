# 0157 — REVIEW (phase 5): entries 0152–0156, the five self-reviewed cycles

Date: 2026-09-02   Phase: 5   Model: Opus 5 (reviewer)
Previous entry: 0156-load-hardening   Last review: 0150-REVIEW-phase5 (verdict: ACCEPT)
Reviewed: the diff `5d6a09d..37ee71c` — **~3,940 added / ~285 removed across 31 source files**,
five code cycles (0152, 0153, 0154, 0155, 0156) plus 0151-RULINGS.

## Verdict: **ACCEPT WITH EDITS**

The code is right. Every finding below is documentation drift, and I made all seven edits myself.
One new ruling: **D-137**.

**What the batch is.** Five cycles against a §6.3 cap of 3 cycles / ~800 lines / 10 files —
roughly five times the line cap and three times the file cap. Three §6.1 triggers fired (0153,
0155, 0156) and were waived on the human's standing instruction to skip the review handoff and
self-review with tests. That was the human's call and it is not mine to relitigate; what matters
for this entry is that **every waiver was recorded in the entry that took it**, with the trigger
named. 0153 went further and listed the four triggers that *would* have fired. That is the
behaviour the process wants when the process is being overridden, and it is why this review could
be done at all.

## 1. Honesty audit — clean, and this is the strongest part of the batch

Re-run, not read:

```
$ npx tsc --noEmit                             (clean, exit 0)
$ npx tsc -p tsconfig.engine.json --noEmit     (clean, exit 0)
$ npx vitest run                                Test Files 33 passed (33)
                                                     Tests 1709 passed (1709)
$ grep -rnE "\.(only|skip|todo)\(" src          (no matches)
$ npx vite build                                ✓ built in 319ms
```

**1709/1709 is real**, 33 files, 0 skipped, 0 `.only` — exactly what 0156 claimed. I spot-checked
the specific tests each entry claimed to have written, by name, and every one exists and says what
the entry said it says: 0155's "an EMPTY cell opened and closed five times still has no slot",
0156's fifteen malformed-AST refusals plus the two positive guards, 0154's `break-word`-not-
`break-all` distinction and its code-point split, 0153's pre-`autoresize` document fixture (which
0154 then reused for the `overflow` removal, as it said). 0156's "no existing test needed changing"
checks out — `document.test.ts` is +207/-0.

No silent scope expansion found. Each entry's "What I did" matches its diff file for file. The
"Where I got stuck" sections are unusually good: 0154's refusal to guess between the two remaining
wrap causes, and its one question to put to the operator, is exactly the right move and I would
have made the same call.

**Vocabulary is locked** throughout — slot, literal, formula, derived, address, mutation, journal.
No "property", no "field", no "node" for object.

## 2. Rule audit

- **Rule 1 (`engine/` is pure)** — UPHELD. Grepped `document.`/`window.`/`canvas`/`navigator` and
  every `render/` import path across `src/engine/`: the only hits are the header lines that
  *forbid* them. The measurement seam held under pressure this batch: `editorTextBoxSize` decides
  what to measure and takes a `TextMeasurer`; `render/measure.ts` and `render/textbox.ts` do the
  work. `textbox.ts` imports nothing at all.
- **Rule 2 (all state change through `mutation.ts`)** — UPHELD, and this was the rule most at risk.
  Four new write paths landed this batch and all four go through the seam: the resize gesture
  builds `setSlot` operations and calls `mutate`; the drop-down (`commitPanelChoice`), the abandon
  (`abandonCreatedTextBox`) and the empty-cell clear all synthesise a `Command` and run it through
  `runPanelCommand` → `executeCommand`. `clearSlot` is a seventh `Operation` kind *inside*
  `mutation.ts`, not an exception to it. No second write path exists. The canvas cursor is set
  directly on the element rather than through `AppState` — correct, it is not document state.
- **Rule 3 (addressing)** — UPHELD. `validateFormulaAstShape`'s `readAddress` reconstructs
  `{ objectId, path }` unchanged and requires every path segment to be a string, which is the right
  screen (`slotKey` joins them, and a number in there would key a slot no schema declares). `clear`
  reuses `resolveWritableSlot`; the A1 headers use `address.ts`'s own `indexToColumnLetters`, the
  same function `formatCellReference` uses, so a header can never name a column its cells do not
  belong to.
- **Rule 4 (one formula engine)** — not touched. No second evaluator appeared.
- **Rule 5 (dumbest correct)** — UPHELD. Every new constant is declared untuned and named as such.
  `layOutLines` is a plain greedy loop; `resizeBox` is four `Math.min`/`Math.max`. Nothing was
  optimised. Every keystroke repaints the whole canvas, disclosed and accepted.
- **Rule 6 (the slot set is fixed during evaluation)** — UPHELD, and it deserves a sentence because
  `clearSlot` looks like a violation and is not. Rule 6 says *evaluation* never creates or destroys
  slots and only *mutations* change which slots exist. `clearSlot` is a mutation, and
  `findIllegalSlotClears` is the right shape of guard: it permits removal at exactly the one path
  where an absent slot has a settled meaning (a table cell, D-047) and refuses everywhere else, with
  the reasoning stated — a missing derived slot is D-018's rejection, a missing declared literal
  silently changes what its object's computes read. That is a narrower operation than it needed to
  be, which is the correct instinct for a new `Operation` kind on a load-bearing file.
- **Rule 7 (nothing from §8)** — UPHELD. The journal gains a `clearSlot` entry and still nothing
  replays it.

## 3. Invariant audit

Derived slots still evaluate inside the topological pass; no `recompute()` appeared.
`extractDependencies` untouched, still eager and total. Rejection still leaves prior state
untouched — I checked the new path specifically: `resizeMove` returns the original `objects` and
`journal` on a refused step, and holds nothing back, which is sound *because* the resize is
absolute rather than incremental. No dangling edges: `clearSlot` reports `brokenSlots: []`, which
is correct and load-bearing on D-110 clause 4 (an empty in-extent cell reads `0` and contributes no
edge), and there is a test for exactly that case. Graph state stays plain and serializable —
`ResizeState` holds an id, a handle string, and four numbers.

Two design calls I want to record as **correct**, because they are the ones a future cycle will be
tempted to "fix":

- **The resize is absolute, from `startExtent`.** An incremental one would read back the box
  `textbox.ts` has already grown to fit its text and run away from the pointer. `interaction.ts`
  says so at the function; do not make it incremental.
- **`autoresize` is not a dependency of either measured slot.** That is what keeps old documents
  loading, and it is D-126's trap avoided by construction rather than by luck.

## 4. Spec conformance

- **§5.6's slot list** — deviated twice, both named. `autoresize` added (0153), `overflow` removed
  (0154). Net eleven non-derived, and `schema.test.ts` pins it. The `overflow` removal is the first
  time a brief-named slot has been deleted rather than extended; 0154's reasoning holds — a slot no
  reader consults and no value can change is a lie in the properties panel — and the migration
  story is right and tested (an undeclared *literal* slot is legal; `findSchemaSlotKindMismatches`
  restricts only derived positions).
- **§5.10's command list** — extended with `clear`. Under the human's standing leave, and the
  justification is the strongest kind: "make this cell empty again" was **inexpressible**, because
  D-047 makes an absent slot the empty cell and `setSlot` had no inverse. D-047 is relied on, not
  changed. Correct.
- **D-120's line-breaking** — 0154's reversal of the "no mid-word breaking" parenthetical is **not**
  the slop 0151-RULINGS forbade, and 0154's own paragraph on the distinction is right: adopting
  CSS's *stated, specified* rule so the two agree on purpose is the D-010 move, whereas a tuned
  epsilon chasing a DOM quirk is the fudge. It also cleared the bar that carry-forward set — the
  human saw the residual first. D-120's actual ruling (breaking lives in `render/measure.ts`, never
  in `src/engine/`) stands untouched.
- **D-108 clause 3** — genuinely satisfied by construction. No walker was hardened;
  `exceedsMaxFormulaAstDepth`, `collectIllegalAstLiterals`, `deps.ts` and `eval.ts` are all still
  guard-free, and the boundary check is what makes that safe.

I verified the one thing in 0156 that could have been hand-waved: **`validateFormulaAstShape`'s
depth cutoff is not a hole.** It stops at `MAX_FORMULA_AST_DEPTH` and returns `ok` for the subtree
below. Any node it skipped hangs at depth ≥ 1001 under a validated recursing node, and
`exceedsMaxFormulaAstDepth` checks `depth > MAX` *before* it reads `ast.type`, so it returns `true`
without ever touching an unvalidated property. The ordering is correct, the reasoning is correct,
and the entry stated it rather than assuming it. Good.

## 5. Legibility audit — this is where the batch is weak, and it is the cost of five self-reviewed cycles

Six sites, every one mechanically checkable, every one the same failure: **the cycle updated the
doc comment nearest the change and left the file header, or the comment one declaration away,
describing the design it had just replaced.** Ruled as **D-137**; the full list is there. In short:

1. **`render/editor.ts`'s header contradicted three of its own doc comments.** It still said the
   overlay's box was sized "in CSS pixels" and its type style "scaled by the SAME `camera.zoom /
   ratio` the box is", and listed matching `style.color` under `NOT DONE HERE`. Entry 0153 reversed
   all three and documented each reversal correctly — at `EditorPlacement` and `EditorTextStyle`,
   250 lines below the header saying the opposite.
2. **`main.ts`'s header** listed font family, alignment and load validation under `NOT DONE HERE`.
   All three are done (0147, 0153, 0156).
3. **`formula/ast.ts`** — `validateFormulaAstShape` was inserted between `exceedsMaxFormulaAstDepth`
   and its doc comment. Orphaned comment above a type; the function itself undocumented.
4. **`mutation.ts`** — `findIllegalSlotClears` inserted the same way, under D-097's "vanishing
   table" comment, leaving `findInvalidDimensionWrites` bare.
5. **`primitives/text.ts`** — "the eight `text`-specific stored slot paths". There are nine.
6. **`render/textbox.ts`** — still explained the width rule by "`measure.ts` breaks between words
   only", the sentence 0154 reversed. 0154's entry names that sentence as now false and corrected
   it *in the log only*.

Items 1 and 2 are not cosmetic. Both headers described the pre-multiplied `fontSize × camera.zoom`
overlay that 0153 removed — the one thing STATUS's own gotcha list says never to reintroduce. An
implementer trusting the header over the code walks straight back into the bug the rework existed
to fix.

Everything else in the legibility audit passes: headers present on both new files, no `any`
anywhere in the diff, tests named as behaviour sentences (0154's and 0155's are particularly good —
they name the rule they defend), `PROVISIONAL(Q-012)` correctly reworded at `editor.ts` rather than
dropped, and `handles.ts`/`textbox.ts` correctly adding no new tag.

## 6. Edits made

Seven, all small, all explained here.

1. `render/editor.ts` — header rewritten: `WHAT THIS IS` now states world units + one transform and
   covers `editorTextBoxSize`; the `INVARIANTS` line says `style.color` IS mirrored; the false
   `NOT DONE HERE` colour bullet is replaced by the measurement one that belongs there.
2. `src/main.ts` — the two stale `NOT DONE HERE` bullets rewritten to what is actually undone
   (markdown in the overlay; nothing beyond `loadDocument`'s own boundary), and the world-units rule
   stated where the pre-multiplication claim used to be.
3. `engine/formula/ast.ts` — `exceedsMaxFormulaAstDepth`'s doc comment moved back onto the function,
   with one paragraph added on why it runs immediately after the shape walk.
4. `engine/mutation.ts` — D-097's comment moved back onto `findInvalidDimensionWrites`; the clear
   check given its own.
5. `engine/primitives/text.ts` — "eight" → "nine".
6. `render/textbox.ts` — the width comment restated for CSS's `break-word`.
7. `index.html` — the `.text-editor` comment cited `renderDocument`'s `editingObjectId`, renamed to
   the whole `EditorTarget` at 0155.

**One behavioural edit**, with a test:

8. `main.ts`'s `describePanelCommand` echoed a boolean drop-down write as `set text_1.autoresize
   false`. §5.3's boolean is exact-uppercase (`parser.ts` reads `token.text === "TRUE"`), so that
   echoed line, typed back, writes the STRING `"false"` — which the slot's own option set would
   then show as a blank drop-down. D-102 clause 7 asks for "an echo of the synthesised command
   itself", and an echo the operator cannot retype is not one. Now `TRUE`/`FALSE`, the same
   convention `cellLiteralSeed` uses one screen away. New test:
   `"echoes a BOOLEAN choice in §5.3's uppercase spelling…"`, which asserts the echo AND that the
   echoed line retyped produces the identical slot.

Re-verified after the edits: **both configs clean, 1710/1710, 0 skipped, `vite build` clean.**

## 7. Open questions

**Q-025 was never reached** — nothing in five cycles raised one, which is right: none of this was
load-bearing ambiguity, it was the human specifying and the implementer building. Next free is
still **Q-025**.

- **Q-012** (world units vs screen pixels) — still OPEN, still deferred, still not blocking. The
  batch added no new tag site and correctly reworded `editor.ts`'s. Due with the `style`-slots
  cycle.
- **Q-016** (a panel row's grammar) — still OPEN for free-text rows. 0153 narrowed it in practice
  for enum rows and said so. Correct not to claim it closed.
- **Q-017** (headers) — remains the human's.
- **Q-013** — not mooted, unchanged.

## 8. What I did NOT do, deliberately

- **I did not touch the wrap residual.** 0154's question to the operator — *do the misbehaving
  boxes contain `{= }` references?* — is the right question and it is still unanswered. Nothing here
  should move until it is. 0151-RULINGS' carry-forward still binds for the platform-quantization
  case: no slop in `measure.ts`, no compensating `letter-spacing`.
- **I did not second-guess the grey A1 headers**, the `#6b7280` vs near-black call. That is an
  on-screen judgement and 0155 flagged it as one constant to revert.
- **I did not widen `findIllegalSlotClears`'s doc/code mismatch into a finding.** It says
  "a `createObject` earlier in the same batch" while the code scans the whole operations array —
  but that is copied verbatim from `findInvalidDimensionWrites` beside it, which has always done
  the same, and the only orderings it admits are ones D-021's existence check rejects anyway.
  Matching the neighbour was the right call under §4; changing both is a separate cycle's job if
  anyone wants it.
- **I did not fix fix-list item 13 / D-104**, still unscheduled and still not command-reachable.

## 9. For the human — the on-screen test that is still owed

Entries **0155 and 0156 have not been seen on screen.** 0153 and 0154 were, and were good. The
script is in STATUS.md; the two that matter most:

1. **The phantom cell.** Double-click an empty cell, type nothing, click out, five times. Then
   `props table_1`: there must be no `A1` at all, and never a quote.
2. **The ghosted cell.** Double-click a cell that HAS a value. The old value must vanish while you
   type, and the table's grid — including that cell's border — must stay.

0156 is engine-side and its failure mode is invisible: **save a document, then load it.** If it
comes back, D-126 works.
