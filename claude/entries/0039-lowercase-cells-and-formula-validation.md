# 0039 — lowercase cell refs and parse-time formula validation
Date: 2026-08-23   Phase: 2   Model: implementer (Claude Sonnet 5)
Previous entry: 0038-RULINGS   Last review: 0037-REVIEW-phase1 (verdict: ACCEPT WITH EDITS, Phase 1
gate PASSED)
Batch: cycle 1 of up to 3 since last review; 153 lines / 5 files changed so far.

## Declared scope
Execute the two rulings 0038-RULINGS named as immediately executable: **D-039** (accept lowercase
cell references, normalise to uppercase at one point) and **D-038** (`parseFormula` rejects an
unknown function name or wrong argument count at parse time, naming the function and its
position). Not in scope: anything from 0037-REVIEW §9's larger list — wiring the formula engine
into cell slots, the table primitive, range evaluation/expansion, taking down the three temporary
bridges, or D-031's stored-AST value-legality walk. Those are the real, larger Phase 2 slice and
are declared separately below.

## Explicitly not in scope
D-040/D-041 (command-surface rulings) — 0038-RULINGS itself says these are Phase 3 work with
nothing to build now. D-042 changes no code.

## What I did
- **`src/engine/address.ts` (D-039)** — widened `CELL_REFERENCE_PATTERN` to
  `/^[A-Za-z]+[0-9]+$/` (was uppercase-only) and added one new private function,
  `normalizeCellReference`, called from both `toStoredPath` and `bareCellAddress` — the two,
  and only two, places a cell slot's stored path segment is actually built. `isCellReferenceForm`
  is unchanged in shape (still just the pattern test) and so needed no edit beyond its own doc
  comment. `toSurfacePath` needed no change: the stored form is always already uppercase by the
  time anything formats it back.
- **`src/engine/formula/parser.ts` (D-038)** — `parseFunctionCallExpr` now calls
  `functions.ts`'s `getFunctionEntry`/`checkArity` once the full argument list is known, returning
  a `#PARSE` `ParseError` naming the function and pointing `start` at the function-name token's
  position for either failure (unknown name, or a known name with the wrong argument count). Two
  new imports (`checkArity`, `getFunctionEntry`) from `functions.ts`, which this file already
  imported `RANGE_ACCEPTING_FUNCTION_NAMES` from. File header rewritten in the three places it
  previously asserted the opposite ("does NOT validate a function's NAME or ARITY").
- **Tests** — `address.test.ts`: inverted the "does not map a lowercase cell ref, pending Q-004"
  test into "maps a lowercase cell ref, normalised to uppercase", added a same-stored-Address
  cross-check test and a `bareCellAddress`-agrees-on-lowercase test. `parser.ts`'s own bare-cell-ref
  test ("does not treat a lowercase cell-shaped word...") inverted the same way. `parser.test.ts`:
  inverted "parses an unrecognised function name successfully" into a rejection test asserting both
  the message and the `start` position; added a wrong-arity rejection test, a position test for a
  function call not at the start of the source, and a still-parses-correctly control test covering
  `ROUND`'s exact arity and `AND`'s at-least-one arity (D-035). `eval.test.ts`: re-described its two
  "unknown function"/"wrong arity" tests as defensive-only per D-038's own text ("`eval.ts`'s two
  tests stay, re-described as defensive") — no behaviour change, comment only.

## Decisions I made
1. **Normalisation lives in one function, called from both stored-path builders, not inlined
   twice.** 0038-RULINGS's own wording ("Normalisation happens at exactly ONE point... `toStoredPath`
   / `bareCellAddress`") names two call sites, not one — read as "one mechanism used by both,"
   matching D-008's own established shape for the surface/stored mapping generally (one predicate,
   one mapping function, multiple call sites). A single `normalizeCellReference` helper is that
   mechanism; duplicating `.toUpperCase()` at each call site would have been the two-sources-of-
   truth shape D-039 exists to prevent, reached from a different angle.
2. **Name/arity validation runs after the full argument list is parsed, not before.** `checkArity`
   needs an argument count, and an unknown-name check gates it (there is nothing to check an
   unrecognised name's arity against) — so both checks sit after the closing paren is consumed,
   mirroring `formula/eval.ts`'s own dispatch order (unknown-name check, then arity) rather than
   inventing a different order for the same two checks in a second file.
3. **The `ParseError`'s existing `start` field is reused for D-038's "position" requirement rather
   than adding a new field.** D-038 asks for "the offending name AND its position" — `ParseError`
   already carries `start: number` for exactly this purpose, and `nameToken.start` (captured before
   `advance` consumes it) is the position a future caller would want to highlight. No shape change
   to `ParseError` was needed.
4. **`checkArity`'s own message already names the function**, so the arity `ParseError`'s message
   is `arityCheck.message` verbatim rather than a second, redundant "offending name" wrapper — one
   string, not two nested ones.

## Verification (real output)
```
$ npm run typecheck
> tsc --noEmit && tsc --noEmit -p tsconfig.engine.json
(clean, no output)

$ npm test -- --run
 Test Files  14 passed (14)
      Tests  437 passed (437)
```
437 = the 432 at 0037-REVIEW's HEAD, plus 5 new (2 lowercase cross-checks in `address.test.ts`, 3
new function-call tests in `parser.test.ts` net of the one inverted). 0 skipped, 0 `.only`.

Grep for `.only(`/`.skip(`/`it.todo` across `src/`: clean.

### Mutation checks (D-016 discipline, no acceptance criterion claimed this cycle)
- Disabled the unknown-function-name gate in `parseFunctionCallExpr` (`if (false && entry ===
  undefined)`): exactly 1 test failed — "rejects an unrecognised function name at parse time
  (D-038)...", 51/52 passed in `parser.test.ts`. Restored; `grep -rn "MUTATION-TEST"` clean before
  and after.
- Disabled the arity gate the same way: exactly 2 tests failed — the wrong-argument-count test and
  the position test ("reports the wrong-arity function's position..."), 50/52 passed. Restored.
- Disabled `normalizeCellReference` (identity function instead of `.toUpperCase()`): exactly 4
  tests failed, split across two files — 3 in `address.test.ts` (both new D-039 tests plus the
  `bareCellAddress` lowercase cross-check) and 1 in `parser.test.ts` (the bare-cell-ref lowercase
  test), 95/99 passed across the two files combined. Restored.

All three checks confirm the new logic is genuinely load-bearing, not merely defensive-looking.

## Acceptance criteria status
No Phase 2 (or other) acceptance-criterion clause is claimed this cycle. This slice closes two
open questions that were blocking nothing yet (nothing can store a general formula until the
larger wiring slice lands) but that 0038-RULINGS asked to be done first so the larger slice does
not re-derive them mid-cycle.

## Where I got stuck / what is unfinished
Nothing. Both rulings were unambiguous and small once read in full; the only real judgement call
(decision 1 above, how literally to read "one point") is disclosed rather than hidden.

## Open questions raised
None. `OPEN_QUESTIONS.md` already had zero questions blocking any phase before this cycle
(0038-RULINGS); this cycle answers none and raises none.

## Review point
Fired: none — no §6.1 trigger. In particular, trigger 5 (changed test expectations) does NOT fire:
0038-RULINGS pre-authorised both inversions by name ("Neither is a §6.1 trigger 5 escalation. Say
so in the entry and move on.") — said here, moving on. Batch: cycle 1/3, diff 153 lines / 5 files
(cap 800/10). `address.ts` and `formula/parser.ts` are both touched and both need review before
Phase 3 begins (§6.2) — unchanged from before this cycle, since `address.ts` was already
load-bearing and `parser.ts` is an ordinary file in the already-reviewed `formula/` subsystem.

**REVIEW: NOT NEEDED** for this cycle in isolation. The next slice (wiring the formula engine into
cell slots, the table primitive, taking the three bridges down together) is large, creates
`primitives/table.ts` as the first file of a new subsystem, and will trigger §6.1 trigger 2
immediately on its own — continuing into it now, in the same session, per PROCESS_BRIEF §3 step 7.
