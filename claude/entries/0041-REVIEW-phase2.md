# 0041 — REVIEW (phase 2, subsystem gate)
Date: 2026-08-23   Phase: 2   Model: reviewer (Claude Opus 5)
Previous entry: 0040-table-primitive-first-file   Last review: 0037-REVIEW-phase1 (ACCEPT WITH
EDITS, Phase 1 gate PASSED)
Reviewed: the diff since `32d3387` (0038-RULINGS) — cycles 0039 (D-038/D-039 execution) and 0040
(`primitives/table.ts`, the table subsystem's first file), 638 insertions / 47 deletions across 7
files — plus both log entries and `STATUS.md`. Trigger: **§6.1 trigger 2**, first file of a new
subsystem.

## Verdict

**ACCEPT WITH EDITS.** `table.ts` is a good first file — it does the part that is decidable
standalone, refuses the part that is not, and says which is which. Two edits made here, both in
`address.ts`, both closing the SAME hazard cycle 0039 half-closed. Three rulings recorded
(**D-043**, **D-044**, **D-045**), the last two answering 0040's own questions. **Phase 2
continues; the next slice is the dynamic slot family, not the wiring.**

## 1. Rule audit

- **Rule 1 (engine is pure)** — upheld. No DOM/window/canvas/render reference in either new or
  changed file; both configs typecheck.
- **Rule 2 (state change through `mutation.ts`)** — not touched. `table.ts` holds no state and
  writes none; `enumerateRangeCellPaths` is a pure function of two addresses.
- **Rule 3 (addressing is load-bearing)** — this is the cycle that stressed it, and it is where
  both findings live. `address.ts` gained four exported functions and a widened form; the form's
  own one-spelling invariant was left with two holes (Findings 1 and 2). Upheld after this
  review's edits, not before.
- **Rule 4 (one formula engine)** — upheld; `table.ts` contains no evaluation and no second walk.
- **Rule 5 (dumbest correct implementation)** — upheld. Two nested loops and integer arithmetic.
- **Rule 6 (slot set fixed during evaluation)** — not violated, and correctly identified as the
  reason `table` is NOT yet in `SCHEMAS`: a table's cells are a dynamic slot family and
  `nonDerivedSlotPaths` is a fixed list (D-017). Declining to register the type was the right
  call, and saying so plainly instead of shipping a placeholder is better still.
- **Rule 7 (§8 deferred list)** — not touched.

## 2. Invariant audit

- **A stored address never contains a user-facing name** — upheld; nothing new stores a name.
- **Exactly one stored spelling per cell (D-039)** — **VIOLATED before this review, twice.** See
  Findings 1 and 2. This is the invariant Rule 3 exists to protect, and the cycle that widened the
  form is exactly where it had to be checked.
- **`enumerateRangeCellPaths` never throws** — upheld: both failure modes return a typed `#REF`,
  and the malformed-endpoint battery covers the shapes.
- **No dangling edges** — not yet reachable (nothing derives edges from a range), but the current
  unbounded enumeration would break it the moment it is wired. Ruled as **D-044**.
- **Values, error propagation, laziness** — untouched by this diff.

## 3. Findings

### Finding 1 (fixed here; ruled as D-043) — the written-out stored form was never normalised

```
table_x.a1        ->  { path: ["cells","A1"] }
table_x.cells.a1  ->  { path: ["cells","a1"] }     <- two slots, one cell
```
(probe against the shipped code, before the fix)

`toStoredPath` routes the one-segment shorthand through `normalizeCellReference` and returns
every other table path untouched — including the two-segment `cells.<ref>` form, which this file
explicitly supports typing directly (its own comment says so: "a user typing the stored form
directly is not double-prefixed"). So the ruling held on the path the tests exercised and not on
the one beside it.

Fixed: `toStoredPath` normalises the two-segment cell form through the same single point. No
prefix is added there, so D-008's `toSurfacePath` inverse is unaffected.

### Finding 2 (fixed here; ruled as D-043) — leading zeros and row zero are still second spellings

```
table_x.A7    ->  { path: ["cells","A7"] }
table_x.A007  ->  { path: ["cells","A007"] }   <- two slots, one cell
isCellReferenceForm("A0") -> true               <- a row A1 notation does not have
parseCellReference("A007") -> { column: 1, row: 7 }   <- and back out as "A7"
```

The last line is the sharp one: cycle 0040's `parseCellReference` carried its OWN regex whose row
part was `[0-9]+`, so the splitter and the predicate had already drifted — an enumerated path
(`A7`) would never have matched the stored slot (`A007`) at the seam the next cycle wires.

Fixed: the row part is `[1-9][0-9]*`, so `A007` and `A0` are not cell references at all and
resolve as ordinary path segments that name no slot; and `parseCellReference` now `exec`s the
SAME pattern `isCellReferenceForm` tests, so a second copy cannot drift again. Accepting `A007`
as a synonym for `A7` later is purely additive — splitting one cell into two is not.

**The general lesson is D-043's last paragraph and it is worth more than either fix:** when a
ruling says "exactly one spelling is ever stored", the test is not "the new spelling is accepted"
— it is that *every route into the stored form lands on the same string*. There were three routes
here. Cycle 0039 found one, wrote exactly the right test for it ("both spellings resolve to the
IDENTICAL stored Address" — the right assertion, applied to one route), and did not enumerate the
others.

### Finding 3 (recorded, ruled as D-044, not fixed) — unbounded expansion would create dangling edges

0040's Decision 1 (no bounds check; rely on a `read` miss becoming `#REF`) is right for a single
reference and wrong for a range: `deriveEdges` expanding `A1:B99` over an 8×8 table would build
edges to slots that do not exist, and "no dangling edges" is an invariant rather than a
preference. §5.3's own words put the dimensions IN the expansion ("always re-derived from current
table dimensions"). Ruled as **D-044** — the enumerator takes the extent when it is wired, cells
outside it are omitted rather than `#REF`, and the same change removes the `A1:ZZ999999` resource
hazard the current shape has. Nothing consumes the function yet, so this costs a signature and no
migration.

### Finding 4 (no change needed) — D-038's "name and position" condition, met in substance

Cycle 0039 put the position in `ParseError.start` and the name in the message text, and disclosed
that it did not add a structured field. Judged sufficient: a later did-you-mean pass has the
position, the source text (kept by the caller, D-038's fourth constraint), and an enumerable
registry — that is everything it needs, and a fifth field would be gold-plating. The condition is
met; recording the judgement so it is not re-litigated.

## 4. Spec conformance

- §5.4's "Default 8×8" — recorded as two constants, unused, honestly labelled. Correct.
- §5.4's A1 addressing — bijective base-26 both directions, round-tripped 1–1000 in tests with the
  `Z`→`AA`→`ZZ`→`AAA` boundaries covered. The `-1` offset is mutation-checked and the check is a
  good one (23 failures across two files when removed).
- §5.3's range model — endpoint pair in, rectangle out, re-derived per call, nothing cached.
  Conforms; the missing half is the dimensions (D-044).
- D-036's constraint 2 ("the helper lives beside the table primitive or in `address.ts`") —
  honoured, and split the right way: the cell-reference FORM concerns went to `address.ts`, which
  already owns the pattern and `bareCellAddress`; the rectangle enumeration went to `table.ts`,
  which is table domain. That is 0040's question 3, answered: keep it.
- D-038/D-039 — implemented as ruled, with the two gaps above.

## 5. Legibility audit

Headers present and accurate. `table.ts`'s "NOT DONE HERE" is the best example of that section in
the project so far: four items, each with the concrete reason it is not here and who owns it.
Vocabulary locked. No `throw`.

Two notes, both addressed by this review's edits: `parseCellReference` used two `as string` casts
to work around `noUncheckedIndexedAccess` on capture groups — gone now, replaced by an
`undefined` check that reads the same and asserts nothing; and the second regex that made the
casts necessary is gone with it.

One design note for the wiring cycle, not a finding: `enumerateRangeCellPaths` returns paths, not
`Address`es, so every consumer re-attaches the same `objectId` the function already verified both
endpoints share. Returning `Address[]` would be less to get wrong at three call sites. Free to
change while nothing consumes it — decide it alongside D-044's signature change.

## 6. Honesty audit

Both logs match the diff.

- 470/470 and clean typecheck under both configs, claimed at 0040. Verified at HEAD before my
  edits: **470 passed (470)**, 15 files, 0 skipped, 0 `.only`.
- Diff sizes: claimed 153/5 for 0039, 485/4 for 0040, ~638/7 for the batch. `git diff --shortstat`
  gives 153+46, 485+1, and 638+47 — so the figures are **insertions only**, where earlier batches
  (0034) counted insertions plus deletions. Under the cap either way; worth one line so the next
  cycle states which convention it is using rather than switching silently.
- All six mutation checks across the two cycles are described precisely enough to reproduce, and
  the two I re-ran behave as claimed.
- **0040's disclosure of the cross-object range gap is the best thing in this batch.** It was
  found mid-design, it was outside the declared scope to fix properly, and the entry says all of
  that plainly — including "I did not judge which is correct, only that ONE of them must (and now
  does)". That is exactly the shape a good escalation takes. Answered as D-045.
- 0039 correctly cited its pre-authorisation for the two inverted test expectations and moved on,
  as instructed. No §6.1 trigger was missed: continuing from 0039 into 0040 in one session was
  legitimate (§6.2 does not force a stop, the cap was not reached), and 0040 stopped exactly where
  trigger 2 says to.

## 7. Open questions

None raised, none answered — no brief ambiguity surfaced this batch. Q-007 and Q-008 remain open,
provisional, blocking nothing. Next free: **Q-011**.

### Answers to 0040's three questions

1. **Bounds-check, or rely on the read miss?** Bounds-check — but at expansion, from the table's
   current dimensions, which is where §5.3 puts it. Your reasoning holds for a single reference
   and breaks for a range because `deriveEdges` builds edges before anything reads: an unbounded
   expansion means edges to slots that do not exist. Ruled as **D-044**, including what an empty
   clamped range means (zero arguments, which existing rules already decide).
2. **Cross-object range: enumeration layer enough, or parse time too?** Parse time too, and your
   enumeration check stays as the defensive arm — same relationship `eval.ts`'s unknown-function
   branch now has to `parser.ts`'s. It is decidable from the text alone, which is the line D-038
   drew two weeks of cycles ago. Ruled as **D-045**. Finding it and refusing to fix it out of
   scope was the right call twice over.
3. **Is `address.ts` the right home for the column arithmetic?** Yes, keep it. `address.ts` owns
   the cell-reference FORM — the pattern, the predicate, `bareCellAddress` — and taking a
   reference apart is that same concern. The split you drew (form in `address.ts`, rectangle in
   `table.ts`) is the one I would have asked for. If `address.ts` ever needs splitting it should
   split by concern, not by file length.

## 8. Edits made

Both in `address.ts`, both closing D-043's one-spelling invariant; 470 → 474 tests, both configs
clean.

1. **`toStoredPath` normalises the two-segment `cells.<ref>` form** (Finding 1).
2. **The row part of `CELL_REFERENCE_PATTERN` is `[1-9][0-9]*`, and `parseCellReference` now
   `exec`s that same pattern** instead of carrying its own looser copy (Finding 2). The two `as
   string` casts went with it.

Tests added (4): `table_x.cells.a1` resolves to the same slot as `table_x.A1`; `A007` is not a
cell reference and does not become a phantom slot; row `0` is not a cell reference; and
`parseCellReference` agrees with `isCellReferenceForm` across eleven shapes — that last one is the
regression test for the drift itself, not just for today's symptom.

Mutation-checked both edits: disabling the two-segment branch fails exactly the `cells.a1` test;
loosening the row part back to `[0-9]+` fails exactly the leading-zero and row-0 tests. No other
test moved either time.

## 9. Next slice

**The dynamic slot family, not the wiring.** 0040 is right that `table` cannot enter `SCHEMAS`
while `nonDerivedSlotPaths` is a fixed list, and D-017 says that mechanism is its own decision.
That is now the critical path: `deriveEdges` and `validateIntegrity` both consume the schema
shape, so nothing about tables can be wired until it exists. It touches `mutation.ts` and
`primitives/schema.ts` — both load-bearing (§6.2) — so expect it to be its own reviewed cycle, and
write the design down before the code.

Carried, in order of when they bite:

1. **D-044** — the enumerator's signature changes when it is wired. Decide `Address[]` vs paths at
   the same time (§5).
2. **D-045** — cross-object range rejection moves to `parser.ts`; the enumerator's check stays.
3. **D-036** — still governs the wiring: expand through `read`, delete the `#PARSE` placeholder
   rather than extend it, and never accept a range formula that cannot yet be evaluated.
4. **The three temporary bridges come down together** (`findUnsupportedFormulaAsts`,
   `graph/eval.ts`'s `#PARSE` branch, `deriveEdges`'s `ReferenceNode`-only narrowing), and
   D-031's value-legality walk must reach a stored AST's literals in that same cycle.
5. Batch counting: state whether the number is insertions or insertions+deletions (§6).

## Verification (real output, after edits)

```
$ npm run typecheck
> tsc --noEmit && tsc --noEmit -p tsconfig.engine.json
(clean, no output)

$ npm test -- --run
 Test Files  15 passed (15)
      Tests  474 passed (474)
```
474 = the 470 at HEAD, plus 4 added here. No existing expectation changed. 0 skipped, 0 `.only`.
