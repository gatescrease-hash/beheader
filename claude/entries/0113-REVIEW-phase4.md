# 0113 — REVIEW (phase 4)
Date: 2026-08-31   Phase: 4   Model: reviewer
Reviews: entries 0111 (0110-REVIEW's fix list F1–F4, D-107), 0112 (D-081's name gate, D-083 clause
4's load-boundary depth check)   Previous review: 0110-REVIEW-phase4
Verdict: **ACCEPT** — both cycles are built as ruled, and the one §6.1 trigger that forced this
review is the intended diff its own ruling names. Two findings, neither caused by this batch and
neither blocking; both go to the fix list with an owner.

Scope of this review: the diff since 0110-REVIEW — 418 insertions / 70 deletions across 9 source
files (`git diff --stat 83ce64d..HEAD`), two cycles. Review forced by §6.1 trigger 5 (entry 0112
flipped a previously-passing test's expectation), not by the §6.3 cap, which is nowhere near.

## Honesty audit — one line, because it matches

Re-ran everything both entries claim, independently. `npx tsc --noEmit -p tsconfig.json` and `-p
tsconfig.engine.json` both clean; `npx vitest run` → **27 files, 1262 passed, 0 skipped, 0 `.only`**
— exactly entry 0112's number, and 1245 is exactly what entry 0111 logged for its own point in the
batch. The arithmetic in both entries checks out (1244 → +1 → 1245 → +17 → 1262), including the
distinction both draw between a NEW test and a WIDENED existing assertion. The file-by-file accounts
match the diff: entry 0111's 2 files / 102+ / 17-, entry 0112's 7 files / 316+ / 53-, no overlap, as
entry 0112's batch line states. No silent scope expansion in either cycle. Both cycles' §6 self-
assessments are correct, including entry 0111's `NOT NEEDED` — which is the honest verdict for that
diff, and the binary form the human's own correction at entry 0108 requires.

Entry 0112's two mutation checks are the right two and I re-derived the second one's claim rather
than taking it: disabling the depth guard does produce a genuine `RangeError` out of a 40,000-level
fixture. That is the exposure D-083's own rationale probed and could not close at the time. It is
closed now, with direct evidence rather than an assertion about an assertion.

## Rule and invariant audit

Rules 1, 4, 5, 6, 7 — not touched. Grepped `src/engine/` for `document.`/`window.`/`canvas`/a
`render/` import: the only hits are `document.ts`'s own local `Document` parameter named `document`,
which is the standing gotcha, not the global. No second evaluator, no slot-set change, no
optimisation, nothing from §8.

**Rule 2 — upheld.** Entry 0112's engine work adds a *rejection* path, never a write: the new check
sits in `mutate`'s pre-staging phase beside the four already there, and `exceedsMaxFormulaAstDepth`
is a pure predicate. Entry 0111's `main.ts` work touches focus and DOM only — no `mutate`, no
`writeSlot`, no new `executeCommand` call site.

**Rule 3 / plain serializable state — upheld.** `PanelRow.editSeed` is a string on a plain record.
`findInvalidNames`'s `tracked` array holds `{id, name, type}` copies, not live object references.

**Invariants** — rejection leaves prior state bit-for-bit unchanged: `findInvalidNames` runs
*before* `cloneObjects`, so a refused name never reaches staging at all, and the "refused creation
claims no name" test pins the simulation's own honesty. Derived-slot participation, eager/total
dependency extraction, edge re-derivation, no dangling edges — all untouched by this diff.

## Spec and ruling conformance

**D-081 — all four clauses, built as written.** Clause 2: `createObject`'s name passes the *same*
`checkNameAvailable` gate a rename passes, evaluated at its own position in the left-to-right
simulation, by *extending* `findInvalidRenames` rather than adding a fifth pre-staging check —
exactly what the clause forbids doing any other way. Clause 3: the whole batch is rejected and every
offender is named (the two-offender test pins it), with no auto-repair. Clause 4: `address.ts`'s
"do not read this as proof" disclosure is removed, correctly, because it is no longer true. The
reconciliation duty — "the pinned test must FLIP; that is the intended visible diff, not a test
being weakened" — is discharged exactly, and entry 0112 was right to report it as a §6.1 trigger
anyway. **A ruling authorising a change is not an exemption from the trigger that change fires**;
this is the first cycle to actually hit that gotcha, and it applied it correctly rather than
reasoning its way out of it.

Checked for the backward-compatibility hazard the clause creates and did not find one: every name
in any document this software could have produced was minted by `generateDefaultName` or passed the
rename gate, so no previously-loadable document becomes unloadable. The round-trip test
(`saveDocument(loaded) === json`) still passes.

**D-083 clause 4 — built as written.** One check, at the load boundary, in `document.ts`'s
`reconstructSlot`, against `MAX_FORMULA_AST_DEPTH`, with `parser.ts`'s message vocabulary reused
verbatim. `deps.ts` and `eval.ts` grew no depth parameter (diffstat confirms neither file is
touched); `format.ts`'s guard stands untouched. Decision 4's placement of the function in `ast.ts`
beside the constant and the shape it bounds is right, and D-010 is the correct citation for it.

**The counting is consistent with the parser, which is the property that actually matters.**
`walkForRangePlacement` is entered at depth 1 and checks `depth > MAX_FORMULA_AST_DEPTH` before
recursing with `depth + 1`; `exceedsMaxFormulaAstDepth` does character-for-character the same.
Verified rather than assumed, because the failure mode if they diverged is the nasty one: a formula
the parser accepts, saved, that the loader then refuses — a user unable to reopen their own
document. They do not diverge, and the "accepts exactly at the limit" test pins the boundary from
the other side.

**D-107 / fix items 1–6 — all six discharged.** Item 1 (`preventDefault` on every panel press, focus
the command bar only when `openEditor === undefined` and the press is not inside a row input) is
built with one narrowing, addressed below. Item 2 (`onCommit`/`onCancel` both restore the command
bar) built; the `input.focus()` *before* `apply()` ordering in `onCommit` is deliberate and correct
— it moves focus out before the repaint tears the input out, so the removal steals nothing. Item 3
(identity-guarded `onCancel`) built, checking both `objectId` and `path`. Item 4 (`editSeed` as a
separate field, `describeSlotValue` with no `maxDecimals`, no fourth formatter) built, and pinned by
exactly the test the item specified. Item 5 (`updatePanels` clears `openEditor` when the rebuild
produced no input) built as the one line asked for. Item 6 (live browser confirmation of 1–3) done,
with a transcript specific enough to re-run.

**Legibility audit.** Headers present and in present tense; `main.ts`'s and `document.ts`'s both
gained their new binding notes without turning into changelogs. Vocabulary locked throughout — slot,
literal, formula, derived, address, mutation, object, all correct. No `any` anywhere in the changed
files. Tests are behaviour sentences. The one comment I want to single out as *earning its space* is
the `pointerdown` listener's: it records what `preventDefault()` actually does to a focused input,
which is the non-obvious fact the next model will otherwise rediscover the hard way.

## Findings

Neither of these is caused by this batch, and neither blocks. I am recording both because each is
one probe away from being invisible again.

**F5 — `deserializeDocument`'s "Never throws" is false, and has been for longer than this batch.**
The file header states it as an invariant, `deserializeDocument`'s own doc comment states it in two
words, and `document.test.ts` pins it with a "never throws for any of the malformed inputs above"
test. It is false. Four hand-editable inputs throw a `TypeError` straight out of the loader:

| loaded `ast` | throws |
| --- | --- |
| `null` | `Cannot read properties of null (reading 'type')` |
| `{type:"binaryOp",operator:"+",left:null,right:null}` | same |
| `{type:"binaryOp",operator:"+"}` (children absent) | `...of undefined (reading 'type')` |
| `{type:"functionCall",name:"SUM",args:42}` | `ast.args.some is not a function` |

**This is not entry 0112's regression, and I checked before saying so.** Against the pre-0112
`document.ts` the identical four inputs throw the identical way, out of `mutation.ts`'s
`collectIllegalAstLiterals`. Entry 0112 moved the throw *earlier* — from `mutate` to
`reconstructSlot` — and changed nothing a caller can observe. The count is unchanged: four in, four
out, before and after.

The reason this is a finding and not a footnote is what it means for the obvious fix. **Guarding
`exceedsMaxFormulaAstDepth` alone would not fix the invariant — it would only restore the old throw
site.** The cause is one level up: `reconstructSlot` casts `raw.ast as FormulaAst` with no shape
check at all, and *two* separate walkers now trust that cast. This is the same hazard `parser.ts`'s
`default:` branch reasoned about at 0032-REVIEW ("a hand-edited file is a real path by which a shape
the compiler believes impossible could reach this walk") and the same one D-083's own rationale
pointed at when it wrote that a document must be validated when it is read "the way every other
unchecked-cast field in a loaded document will have to be". Third sighting. It gets a ruling rather
than a patch — **D-108** below.

Not operator-reachable today: §5.11's file input is unbuilt, so `loadDocument` has no caller outside
tests. That is why this is fix-list debt with an owner and not a REVISE.

**F6 — a panel row's text can no longer be selected with the mouse.** `preventDefault()` on every
panel press — fix item 1's literal instruction, which I wrote — also suppresses the native
drag-select that a press on the panel *body* used to start, because the old code only reached
`preventDefault()` in the header-drag branch. So a displayed value can no longer be selected and
copied off a panel. This follows from precisely the mechanism entry 0111 verified live for the caret
(preventing a press's default cancels the browser's whole mousedown handling for that element, not
only the focus move); I read it off the code and off their evidence and did **not** drive a browser
myself, so it is reported at that confidence. It is also not masked by the rebuild-every-paint
behaviour the way it would be on the canvas: the repaint listener is on `canvas`, so moving the
pointer across a panel does not repaint, and a selection there would otherwise have survived.

Nothing in the brief or any ruling promises selectable panel text, and F3's fix gives the operator
another way to see an unrounded value (open the row's editor). So this is a small, unasked-for loss,
recorded rather than fixed — D-095's "build nothing here until a human asks" stance is the right one
for panel affordances, and it cuts both ways.

## Verdict

**ACCEPT.** No edits. Both cycles do what they declared, and no more; the tests are real; the
rulings are implemented clause by clause; the trigger that forced this review was correctly
identified and correctly reported by the cycle that fired it.

Two things I want on the record as *good*, because the log is where that has to live. First, entry
0111 found the caret regression by testing one step past what the fix list asked for, then disclosed
the resulting deviation instead of quietly taking either the literal wording or its own reading —
that is exactly the behaviour §7 and §13 are trying to buy, and it caught a defect I had written
into the fix list myself. Second, entry 0112's mutation check on the depth guard produced a real
`RangeError` rather than a red assertion; that is the difference between knowing a guard is load-
bearing and believing it.

## Ruling

**D-108** is appended to `DECISIONS.md`: a loaded `FormulaAst`'s SHAPE is validated once, at the
load boundary, by the cycle that builds §5.11's file-input load path; until then no walker
reachable from a loaded AST may be individually hardened to paper over the gap, and the "never
throws" claims in `document.ts` are corrected to say what is actually true. Ownership follows
D-081's own precedent exactly — the cycle that has to weigh what rejecting a user's saved file
costs is the cycle that decides it.

## The implementers' decisions

Entry 0111's three.

- **Decision 1 (the `preventDefault()` carve-out for a press inside the open row editor) —
  RATIFIED, and it is the better reading of D-107.** This is entry 0111's question for the reviewer,
  so answering it plainly: the narrower shape is right, the fix list's literal "unconditionally" was
  wrong, and the wrongness is mine. D-107 clause 1's actual rule is "prevent the press's default so
  the DOM never moves focus on its own, then place focus deliberately — the command bar when no row
  editor is open, the row's input when one is." A press *inside* an already-focused row input has no
  focus move to prevent; the input is already where clause 1 says focus belongs. Preventing that
  press's default therefore buys nothing the rule wants and costs the caret, which is not a
  cosmetic loss — an editor you cannot click into the middle of is a worse editor than the one F3
  just fixed. Keep the carve-out. The gotcha entry 0111 added to `STATUS.md` (re-verify the caret
  probe before ever removing it) is the right guard on it.
  - Worth naming the general lesson, since this batch produced two instances of it and F6 is the
    second: **`preventDefault()` on a press cancels the element's entire native mousedown handling,
    not just "focus".** Caret placement and text selection both ride on it. Reach for the narrowest
    target, not the container.
- **Decision 2 (`onCommit` gets no identity guard) — RATIFIED, and the trace is sound, not lucky.**
  I re-walked it: `onCommit` fires only from a keystroke on the live input, and JS run-to-completion
  means nothing can move `openEditor` on while that same input keeps receiving keys. Declining to
  add a defensive check with no reachable failure is the correct call under Rule 5, and the entry
  explains *why* rather than just asserting asymmetry with `onCancel`. Note the belt-and-braces that
  makes it safe regardless: `input.focus()` inside `onCommit` fires the input's own blur → `onCancel`
  → which now returns early because `openEditor` was cleared one line earlier.
- **Decision 3 (F4's guard gets no test) — RATIFIED.** No command in today's registry can construct
  the precondition; a test would have to fabricate a state the program cannot reach. Disclosed as
  defensive code, which is the honest handling.

Entry 0112's five — **all five ratified.** Decision 1 (renaming `findInvalidRenames` →
`findInvalidNames`) is required, not optional: a private function with one call site whose name
described half its job is exactly D-058's drift. Decision 2 (no `excludeId`) is correct and the
reasoning is the right one — there is nothing yet for a fresh object to be excused against. Decision
3 (a refused creation claims no name) is the subtle one and the test that pins it is better than the
decision: two operations, both rejected, because a half-applied refusal would have blamed the wrong
one. Decision 4 (the function lives in `ast.ts`) and decision 5 (the parser's message reused
verbatim rather than paraphrased) both follow their cited rulings literally, which is what those
rulings asked for.

## Open questions

- **Q-016 — remains OPEN, untouched, still the human's.** Neither cycle reached a panel-typed string
  or boolean, and entry 0111 was right that F3 was a rounding defect rather than the grammar
  question. Still no provisional tag, still nothing in today's schemas that reaches it.
- **F3's exponential-seed tail — checked, and it is NOT made worse.** `parseCommandNumber`'s
  `NUMBER_PATTERN` has no exponent form, so a literal below `1e-6` seeds text the command line will
  not take back as a number and the commit becomes a formula instead. It is reachable (link a slot
  to a formula computing a tiny value, then `unlink`), but it fails **loudly** — a parse refusal in
  the log, not a silent rewrite — where the case F3 actually fixed was silent. Unchanged in kind by
  this batch: the pre-fix seed (D-099 clause 3's exponential form) was equally unacceptable to
  `NUMBER_PATTERN`. Stays on the fix list where 0110-REVIEW put it; it is Q-016's neighbour and
  should be ruled with it rather than patched alone.
- **Q-008 (`-0`) and Q-012 (world units vs screen pixels) — DEFERRED again.** Unchanged, blocking
  nothing, untouched by this diff.
- **Entry 0112 raised none**, correctly — D-081's own reconciliation text answers the only question
  its diff could have prompted.

## What happens next

**The review gate entry 0112 opened is now CLOSED. No fix cycle is owed — this is an ACCEPT.** The
counter resets to 0/3.

The standing next step is unchanged and is still not code: **Phase 4's own gate needs a human
session** — two polygons bound through a table, in one document, authored either by typed commands
or by the panel's paperclip. Everything F1–F4 fixed was in the way of that session being pleasant;
nothing is now. Phase 4's criterion cannot be claimed until that session happens, and no amount of
further engine work substitutes for it.

If a coding slice is wanted before that session, **D-108's loader-shape validation is the one with
the clearest brief** — it is small, it is engine-only and therefore fully testable (unlike
everything F1–F4 touched), and it closes the last of the three load-boundary items §5.11 has been
accumulating since Phase 0, the other two of which entry 0112 just finished. It should not be
started, though, if it would delay the human session — the gate outranks it.
