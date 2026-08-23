# STATUS — as of entry 0040-table-primitive-first-file

STATE: GREEN (compiles under both configs, 470/470 tests pass, 0 skipped, 0 `.only`).

**Process state: REVIEW REQUIRED before the next cycle begins.** `primitives/table.ts` (entry
0040) is the table primitive subsystem's FIRST FILE — PROCESS_BRIEF §6.1 trigger 2, a mandatory
stop regardless of batch headroom. **Do not start a new slice** — Phase 2's real wiring work above
all — until this lands.

**PHASE 1 IS COMPLETE AND SIGNED OFF** (0037-REVIEW-phase1). **Phase 2 — Table primitive — is
OPEN.** D-039/D-038 (entry 0039) are done. Entry 0040 adds standalone, UNWIRED table-primitive
logic (default dimensions; a range's rectangle-enumeration helper) — nothing consumes it yet, and
`getObjectSchema("table")` still returns `undefined`. One Phase 1 criterion clause is still carried
into Phase 2 by name: **range EVALUATION** (`SUM(A1:B4)` still returns a placeholder `#PARSE`) —
see **D-036**, which gives it a home and four binding constraints. Phase 2's own criterion already
demands the proof.

Current phase: **2 — Table primitive.** "Wire the formula engine into cell slots. Add reference
adjustment. Still headless."
Last review point: **0037-REVIEW-phase1, ACCEPT WITH EDITS** (Phase 1 gate PASSED; D-036/D-037
ruled). Since then: entry **0038-RULINGS** (human, closed Q-010/Q-004/Q-002/Q-001 → D-038..D-042),
entry **0039** (implementer — executed D-039/D-038), entry **0040** (implementer, this cycle —
`primitives/table.ts`, first file of the table subsystem, trigger 2 fired).
Cycles since last review: **2/3** · diff since last review: **~638 lines / 7 files** (cap 800/10)
— under cap, but trigger 2 forces the stop regardless.

## Next slice — BLOCKED pending review of entry 0040
Once reviewed, the real Phase 2 wiring work, per PROJECT_BRIEF §6 and 0037-REVIEW §9 — **read that
section, and D-036, before designing anything.** What entry 0040 did NOT solve, and what this
slice must:

- **The `ObjectSchema` dynamic-slot-family mechanism.** A table's cells (`cells.A1`...`cells.H8`,
  growing/shrinking with row/column count) cannot be expressed by `ObjectSchema.nonDerivedSlotPaths`
  today — it's a FIXED list (D-017: "cannot express a slot FAMILY... do not extend it for tables
  without reading D-017 first"). This is THE central design decision of the wiring cycle: widening
  `ObjectSchema`'s shape AND both of `mutation.ts`'s consumers of it (`deriveEdges`,
  `validateIntegrity`). Entry 0040's own header/log entry disclose this explicitly as deferred.
- Register a real `table: TABLE_SCHEMA` entry once that mechanism exists.
- `evaluate` expands a range through its own `read` callback (D-036 constraint 1), calling entry
  0040's `enumerateRangeCellPaths` — `evaluateRangeNode`'s placeholder is DELETED, not extended
  (constraint 3).
- `deriveEdges` expands a `RangeDependency` via the SAME function, from CURRENT table dimensions on
  every mutation, never cached (constraint 2's other half).
- A formula containing a range must not be storable until evaluation works, in the SAME cycle
  (constraint 4) — the outcome D-036 forbids is a cell that accepts `= SUM(A1:A5)` and shows
  `#PARSE` forever.
- `MIN`/`MAX`'s `Math.min(...)` spread (0035-REVIEW Finding 4) — this same cycle's problem once
  ranges flatten into long argument lists (constraint 5).
- **The three temporary bridges** — `mutation.ts`'s `findUnsupportedFormulaAsts`, `graph/eval.ts`'s
  `evaluateFormula` `#PARSE` branch, `deriveEdges`'s `ReferenceNode`-only narrowing — come down
  TOGETHER, not one at a time.
- **D-031's value-legality walk** must reach a stored AST's `LiteralNode`s in the same cycle that
  makes formulas storable.
- Row/column insert/delete + §5.4's reference-adjustment/clamping pass — needs its own design too;
  entry 0040 deliberately built nothing towards this (clamping depends on the delete-mutation
  mechanics, not on dimensions alone).
- **Three open questions from entry 0040, unanswered:** (1) should `enumerateRangeCellPaths`
  bounds-check against the table's actual dimensions, or is relying on `read`'s own `#REF` miss
  correct; (2) should a cross-table range (`SUM(table_x.A1:table_y.B4)`) be rejected earlier, at
  `parser.ts`'s parse time, rather than only at enumeration time as entry 0040 does today (a
  genuinely new finding — nothing upstream currently blocks it); (3) is the `address.ts`/`table.ts`
  split for the column-arithmetic helpers the right home long-term.

Anything touching `mutation.ts`, `graph/*`, or `primitives/schema.ts` is load-bearing under §6.2.

## Built and reviewed (all of Phase 0 and Phase 1)
- Scaffold, `graph/node.ts`, `graph/edge.ts`, `primitives/schema.ts`, `graph/cycles.ts`,
  `graph/eval.ts`, `mutation.ts`, `document.ts`, `address.ts` — Phase 0, signed off at
  0027-REVIEW-phase0.
- **`formula/ast.ts`** (14 tests), **`formula/lexer.ts`** (36 tests), **`formula/parser.ts`**
  (52 tests, D-038 as of cycle 0039), **`formula/deps.ts`** (20 tests), **`formula/functions.ts`**
  (44 tests), **`formula/eval.ts`** (47 tests) — the full formula engine, Phase 1, signed off at
  0037-REVIEW-phase1.

## Built this batch, not yet reviewed (cycles 0039–0040)
- **`address.ts` (D-039, cycle 0039)** — `CELL_REFERENCE_PATTERN` accepts either case; normalises
  to uppercase at one point (`normalizeCellReference`), called from `toStoredPath`/`bareCellAddress`.
- **`formula/parser.ts` (D-038, cycle 0039)** — rejects an unrecognised function name or wrong
  argument count at `#PARSE` time, naming the function and its position.
- **`address.ts` (cycle 0040)** — exported `TABLE_CELL_PATH_PREFIX`; added
  `columnLettersToIndex`/`indexToColumnLetters` (bijective base-26) and
  `parseCellReference`/`formatCellReference` (splits/builds an A1-form ref).
- **`primitives/table.ts` (NEW, cycle 0040, 190 lines)** — `DEFAULT_TABLE_ROWS`/`COLS` = 8;
  `enumerateRangeCellPaths(start, end)` expands a range's two endpoints into every cell path in
  the rectangle between them (row-major, no table-dimension bounds check by design, rejects a
  cross-object range). **Not yet wired into anything** — no `ObjectSchema` entry, no `eval.ts`/
  `mutation.ts` consumer. See "Next slice" above for exactly what's deferred and why.
- All mutation-tested (entries 0039/0040); §6.1 trigger 5 (0039, pre-authorised) and trigger 2
  (0040, the reason this batch stops here) are the only triggers that fired.

## Acceptance criteria
- **Phase 0** — all four PASSING and REVIEWED (0027-REVIEW).
- **Phase 1** — PASSED at 0037-REVIEW, nine clauses outright, one carried: see that entry's §4
  clause-by-clause table. Carried clause: **ranges in aggregates, EVALUATION half** (D-036).
- **Phase 2** — not started. Its criterion already includes the carried clause ("`SUM(A1:A5)`
  recomputes correctly after inserting a row inside the range").

## Known problems
- **Range evaluation is a placeholder `#PARSE`** (D-036). See "Next slice" above.
- **`primitives/table.ts`'s `enumerateRangeCellPaths` has no table-dimension bounds check by
  design** (entry 0040 Decision 1) — reviewer question 1, unanswered.
- **A cross-table range is not rejected until `enumerateRangeCellPaths` runs** (entry 0040
  Decision 2) — `formula/parser.ts` does not currently prevent `SUM(table_x.A1:table_y.B4)` from
  parsing. Reviewer question 2, unanswered. A genuinely new finding, not previously flagged.
- **`MIN`/`MAX` spread their argument list** (`Math.min(...numbers)`), `RangeError` risk on a large
  one — unreachable until ranges flatten into arguments, owned by the wiring cycle (0035-REVIEW
  Finding 4, carried).
- **`describeValueType` is duplicated verbatim** in `functions.ts` (private) and `eval.ts`
  (private) (0037-REVIEW Finding 4, carried, untouched).
- **The three temporary bridges** — `findUnsupportedFormulaAsts` (mutation.ts), `evaluateFormula`'s
  `#PARSE` branch (graph/eval.ts), `deriveEdges`'s `ReferenceNode`-only narrowing — come down
  together in Phase 2's wiring cycle, never one at a time.
- **D-031's value-legality walk does not yet reach a stored AST's literals.** Opens the moment
  formulas become storable, closes in that same cycle.
- **`camera` has no WRITE-side guard** (D-027, carried).
- **The journal's STRUCTURE is deliberately unvalidated** beyond `Array.isArray` (carried).
- **L-16, L-17/L-18/L-14, §5.11's `style` field, `nextObjectId` reconciliation, `noUnusedLocals`
  off, L-6–L-15 cosmetics, recursion depth, table/`cells` hardcoding — carried unchanged.**
- **`lexer.ts`'s two disclosed edge cases** (carried).
- **SETTLED, do not re-raise:** `^` is left-associative (D-030) · function names are
  case-sensitive uppercase-only · `CONCAT` takes strings with no coercion · a `RangeNode` is
  reported pre-expansion by `deps.ts` · `IF` is exactly 3 args, `AND`/`OR` at least 1 (D-035) ·
  a computed `-0` normalises to `+0` (D-033) · `%` follows Excel's `MOD`, comparisons are
  same-type-only (D-037) · a typo'd formula is refused at entry (D-038, implemented cycle 0039) ·
  lowercase cell refs accepted/normalised (D-039, implemented cycle 0039) · column letters are
  bijective base-26, either case in, uppercase out (cycle 0040) · an explicit write replaces a
  formula, dragging unchanged (D-040, Phase 3 — nothing to build yet) · `unlink` keeps what was
  displayed (D-041, Phase 3 — nothing to build yet) · this is a one-user tool, no product/market
  reasoning (D-042) · everything 0029/0032/0035-REVIEW listed settled.

## Live PROVISIONAL tags and open questions
**Zero open questions block any phase.** Q-010 → D-038, Q-004 → D-039, Q-002 → D-040, Q-001 → D-041
(0038-RULINGS; D-038/D-039 implemented cycle 0039). D-042 standing: this is a tool with one user.

Still open, blocking nothing: **`PROVISIONAL(Q-007)`** → `document.ts`'s `CameraState`;
**`PROVISIONAL(Q-008)`** → `graph/node.ts`'s `isIllegalNumber` (compute side narrowed by D-033).
Answered earlier: **Q-003** → D-007, **Q-005**, **Q-006** → D-025, **Q-009** → D-029.
**Three reviewer questions from entry 0040 (not `Q-NNN` — implementer questions for the reviewer,
not brief ambiguities):** bounds-checking in `enumerateRangeCellPaths`; cross-table range
rejection point; the `address.ts`/`table.ts` split. Next free: **Q-011**.

## Gotchas for the next model
- **This batch is BLOCKED on review (trigger 2).** Do not start Phase 2's wiring cycle, or any
  other new slice, until entry 0040 is reviewed.
- **The `ObjectSchema` dynamic-slot-family problem is THE design question waiting at the top of
  the wiring cycle.** Read D-017 in full before touching `primitives/schema.ts` or `mutation.ts`'s
  `deriveEdges`/`validateIntegrity`. Do not extend `nonDerivedSlotPaths` with more fixed entries —
  that is explicitly the wrong move.
- **`primitives/table.ts`'s `enumerateRangeCellPaths` takes two `Address` endpoints and needs no
  table-dimension input** — bounds-checking happens for free at the `read` callback. Don't
  reintroduce a redundant bounds check without reading entry 0040's Decision 1 first.
- **Cell-reference case normalisation happens at exactly one point (D-039): `normalizeCellReference`
  in `address.ts`.** Column-letter arithmetic (`columnLettersToIndex`/`indexToColumnLetters`,
  cycle 0040) is a SEPARATE, already-solved concern — don't reintroduce a second implementation of
  either inside `primitives/table.ts` or `mutation.ts`.
- **A formula's name/arity is validated at parse time (D-038)** — `formula/eval.ts`'s own "unknown
  function"/"wrong arity" arms are DEFENSIVE ONLY (unreachable from typed input, still reachable
  from a loaded document's stored AST). Do not remove them.
- **D-042: this is a TOOL with exactly one user.** Justify a choice by correctness, simplicity
  (Rule 5), and cheapness to change (§9) — never "users will expect."
- **D-040 covers the `set` command only.** Dragging still behaves per §5.9. Do not widen one into
  the other.
- **D-029 is still the rule most likely to be broken by accident**: when `graph/eval.ts` calls
  `formula/eval.ts`, do not "simplify" `IF`/`AND`/`OR` dispatch into a registry lookup.
- **`evaluate(ast, read)` takes a `read` callback and nothing else** — no `EvalContext` yet.
- **One shared guard for numbers: `finiteResult` (D-033).** Do not write a fourth copy.
- **Look up a registry by `Object.hasOwn`, never a bare index (D-034).**
- **`src/engine/` contains no `throw`, and should stay that way.**
- **Range placement (`parser.ts`), range DEPENDENCY reporting (`deps.ts`), range EVALUATION
  (`eval.ts`, unbuilt), and range ENUMERATION (`table.ts`, unwired) are FOUR different concerns.**
  Do not collapse them.
- **Batch discipline is fixed and should stay fixed:** cycle 0036 stopped at its phase gate; cycle
  0039 stopped short of the big wiring slice; cycle 0040 built exactly what a subsystem's first
  file can honestly claim (standalone, unwired, pure logic) and stopped at trigger 2 rather than
  reaching into `mutation.ts` to finish the job in the same cycle. Keep that pattern.
- Each PowerShell call is a fresh process; the Bash tool's `npm` is not on PATH — use PowerShell.
