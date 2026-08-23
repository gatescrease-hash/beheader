# 0040 — table primitive, first file: dimensions and range enumeration
Date: 2026-08-23   Phase: 2   Model: implementer (Claude Sonnet 5)
Previous entry: 0039-lowercase-cells-and-formula-validation   Last review: 0037-REVIEW-phase1
(verdict: ACCEPT WITH EDITS, Phase 1 gate PASSED)
Batch: cycle 2 of up to 3 since last review; ~638 lines / 7 files changed so far (153/5 at 0039,
485/4 this cycle — `address.ts`/`address.test.ts` touched in both, counted once for the file total).

## Declared scope
Build `primitives/table.ts` — the table primitive subsystem's first file — covering exactly what
D-036 named as decidable standalone: §5.4's default-dimension fact, and the pure "enumerate the
rectangle between two range endpoints" helper D-036 constraint 2 asks for. Necessary widening of
`address.ts` (bijective column-letter arithmetic, cell-reference splitting/formatting) to support
it. This is PROCESS_BRIEF §6.1 **trigger 2** — first file of a new subsystem — so the cycle stops
immediately after, per that trigger, regardless of remaining batch headroom.

## Explicitly not in scope
- **Registering `table` in `primitives/schema.ts`'s `SCHEMAS`.** A table's cells are a DYNAMIC slot
  family, and `ObjectSchema.nonDerivedSlotPaths` is a fixed list — D-017 explicitly forbids
  extending it for tables without first solving that mechanism, which requires widening
  `ObjectSchema`'s own shape AND both of `mutation.ts`'s consumers of it (`deriveEdges`,
  `validateIntegrity`). That is its own load-bearing, mutation.ts-touching decision, deserving its
  own dedicated cycle — not a rider on "first file of new subsystem." `getObjectSchema("table")`
  still returns `undefined` after this cycle.
- Row/column insert/delete mutations and §5.4's reference-adjustment/clamping pass — needs the
  concrete delete-mutation machinery, which doesn't exist yet.
- Wiring `enumerateRangeCellPaths` into `formula/eval.ts` or `mutation.ts`'s edge derivation —
  both are the wiring cycle's job (D-036 constraints 1 and 2's other half).
- `MIN`/`MAX`'s `Math.min(...)` spread risk (0035-REVIEW Finding 4, D-036 constraint 5) — same
  future cycle, once this function's output actually reaches a long argument list.
- Any table command (`table x=0 y=0 rows=8 cols=8`, §5.10) — Phase 3.

## What I did
- **`src/engine/address.ts`** — exported the previously-private `TABLE_CELL_PATH_PREFIX` (so
  `table.ts` builds `["cells", ref]` against the same constant, not a second `"cells"` literal),
  and added four new pure functions, all documented as extending this file's existing
  cell-reference-form ownership rather than inventing a new concept:
  - `columnLettersToIndex(letters): number` / `indexToColumnLetters(index): string` — bijective
    base-26 ("Excel column") conversion, both directions. Accepts either case in, always emits
    uppercase out (D-039).
  - `parseCellReference(ref): CellCoordinates | undefined` / `formatCellReference(coords): string`
    — splits `"AB12"` into `{ column: 28, row: 12 }` and back; `undefined`/never-throws for a
    non-cell-shaped string.
- **`src/engine/primitives/table.ts`** (NEW, 190 lines) —
  - `DEFAULT_TABLE_ROWS`/`DEFAULT_TABLE_COLS` = 8 (§5.4: "Default 8×8").
  - `enumerateRangeCellPaths(start, end)` — expands two endpoint `Address`es into every
    `["cells", ref]` path in the inclusive rectangle between them, row-major order. Deliberately
    does NOT bounds-check against a table's actual current dimensions (see Decisions below).
    Rejects a cross-object range and a malformed endpoint with a `RangeEnumerationError` (`#REF`);
    never throws.
  - `isRangeEnumerationError` — the same `Array.isArray`-doesn't-reliably-narrow workaround
    `formula/parser.ts`'s `isLexError` already established.
- **Tests** — `address.test.ts`: round-trips 1–1000 for the bijective conversion (no collisions),
  boundary cases (`Z`→`AA`, `ZZ`→`AAA`), either-case-in/uppercase-out, `parseCellReference`'s
  never-throws behaviour over malformed strings, and a cross-check that
  `parseCellReference`/`formatCellReference` agree with `bareCellAddress`'s own stored-path shape.
  `primitives/table.test.ts` (NEW, 118 lines, 14 tests): single-cell/single-row/single-column/2×2
  rectangles, reversed endpoints producing the identical rectangle, a multi-letter column boundary
  (`Z`→`AA`→`AB`), the deliberate absence of a table-dimension bounds check (a range into `Z99`
  enumerates fine, unbounded by the 8×8 default), cross-object rejection, three malformed-endpoint
  shapes, and a lowercase-in-a-hand-built-Address robustness case.

## Decisions I made
1. **`enumerateRangeCellPaths` does not table-bounds-check its endpoints.** A cell beyond the
   table's actual current row/column count simply has no real slot at that path — `formula/eval.ts`'s
   existing `evaluateReference` already turns a `read` miss into `#REF`, so bounds-checking falls
   out for free at the eventual consumer, the same way an ordinary out-of-range single reference
   already works today. Adding a bounds check here would be a second, parallel mechanism for one
   invariant. Reversible and low-risk: nothing currently calls this function.
2. **A range whose two endpoints name different objects is rejected**, not silently enumerated as a
   nonsensical cross-table rectangle. Nothing upstream (`formula/parser.ts`'s grammar) currently
   prevents `SUM(table_x.A1:table_y.B4)` from parsing — each endpoint resolves through the ordinary
   `name.path` address grammar independently, with no same-object constraint. §5.4 frames a table
   as self-contained ("without being regions of one giant sheet"), and rows/columns of two
   different tables aren't comparable quantities to enumerate a rectangle over. Disclosed as an
   implementation decision, not a brief-mandated one — nothing in §5.3/§5.4 discusses this case by
   name. This is a genuinely new finding (a parser-level gap noticed while designing this
   function), not something D-036 or 0037-REVIEW flagged; recording it here rather than silently
   fixing `parser.ts` mid-cycle, which would be out of this cycle's declared scope.
3. **Row-major enumeration order**, chosen and documented as a deterministic-but-not-otherwise-
   meaningful convention: every brief-specified aggregate (`SUM`/`MIN`/`MAX`/`AVG`) is order-
   independent, so nothing downstream may depend on the order beyond determinism (needed for test
   assertions and stable dependency lists later).
4. **The column-letter arithmetic and cell-reference split/format pair live in `address.ts`, not
   `table.ts`.** `address.ts` already owns every other cell-reference-FORM concern (the pattern,
   `isCellReferenceForm`, `bareCellAddress`); taking a reference apart and putting one back
   together is the same concern, not a new one, and both directions are pure integer/string
   arithmetic with no table-domain dependency. `table.ts` is the first CONSUMER (the rectangle
   enumerator), which is genuinely table-domain. D-036 constraint 2 explicitly permits either home
   ("lives beside the table primitive or in `address.ts`").

## Verification (real output)
```
$ npm run typecheck
> tsc --noEmit && tsc --noEmit -p tsconfig.engine.json
(clean, no output)

$ npm test -- --run
 Test Files  15 passed (15)
      Tests  470 passed (470)
```
470 = the 437 at 0039's HEAD, plus 33 new (19 in `address.test.ts`, 14 in the new
`primitives/table.test.ts`). 0 skipped, 0 `.only`.

Grep for `.only(`/`.skip(`/`it.todo` across `src/`: clean.

### Mutation checks (D-016 discipline, no acceptance criterion claimed this cycle)
- Disabled the cross-object rejection in `enumerateRangeCellPaths` (`if (false && ...)`): exactly
  2 tests failed (the cross-object rejection test and `isRangeEnumerationError`'s own true/false
  test), 12/14 passed in `table.test.ts`. Restored.
- Disabled min/max normalisation (used raw `start`/`end` order instead of `Math.min`/`Math.max`):
  exactly 1 test failed — "reversed endpoints... produce the identical rectangle" — 13/14 passed.
  Restored.
- Disabled the bijective `-1` offset in `indexToColumnLetters` (plain base-26 instead): 17 tests
  failed in `address.test.ts` and 6 in `table.test.ts` (23 total) — every round-trip/boundary case
  and every downstream table test that touches a multi-letter or off-by-one column, none spared,
  confirming the offset is load-bearing everywhere it is used, not just at its own unit tests.
  Restored; `grep -rn "MUTATION-TEST"` clean before and after each check.

## Acceptance criteria status
No Phase 2 (or other) acceptance-criterion clause is claimed this cycle. This is standalone,
unwired primitive logic — the same "heavily unit-tested, standalone" posture Phase 1's `formula/*`
files took before Phase 2 wired them in.

## Where I got stuck / what is unfinished
Discovered, while designing `enumerateRangeCellPaths`, that `formula/parser.ts`'s grammar does not
currently reject a range whose two endpoints name different tables (Decision 2 above) — handled it
at the enumeration layer rather than going back to touch `parser.ts` (out of this cycle's declared
scope; `parser.ts` is an already-reviewed file and this finding doesn't rise to a §6.1 trigger on
its own). Flagging it explicitly here and in `STATUS.md`'s Known Problems in case a future cycle
wants to reject it earlier, at parse time, instead of at enumeration time — both are defensible;
I did not judge which is correct, only that ONE of them must (and now does).

## Open questions raised
None.

## Review point
Fired: **§6.1 trigger 2 — first file of a new subsystem** (`primitives/table.ts`). This is a
mandatory stop regardless of batch headroom (cycle 2/3, ~638/800 lines, 7/10 files — well under the
cap on its own, but the trigger applies independent of it).

**REVIEW: REQUIRED.**
Reason: trigger 2. The design choices in a subsystem's first file are the expensive ones to get
wrong (PROCESS_BRIEF §6.1's own words) — in particular, Decisions 1 and 2 above (no bounds-check,
cross-object rejection) are exactly the kind of judgement call this project's process wants
checked before more code is built on top of them.

Questions for the reviewer:
1. Is the "no table-dimension bounds check, rely on the read callback's own #REF" design
   (Decision 1) the right call, or should `enumerateRangeCellPaths` take the table's current
   row/column count and reject/clamp out-of-bounds endpoints itself?
2. Is rejecting a cross-object range at the ENUMERATION layer (Decision 2, this cycle) sufficient,
   or should `formula/parser.ts` reject `SUM(table_x.A1:table_y.B4)` earlier, at parse time, the
   same way it already rejects a misplaced range? (Genuinely new finding — nothing upstream
   currently blocks it.)
3. Is the `address.ts` / `primitives/table.ts` split (Decision 4) the right home for the column
   arithmetic, or should it move wholesale into `table.ts` once `address.ts`'s own file grows any
   further?
