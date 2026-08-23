# STATUS — as of entry 0041-REVIEW-phase2

STATE: GREEN (compiles under both configs, 474/474 tests pass, 0 skipped, 0 `.only`).

**Cycles 0039 and 0040 are REVIEWED — verdict ACCEPT WITH EDITS (entry 0041-REVIEW-phase2).**
Two defects fixed in `address.ts` (both the same one-spelling-per-cell invariant, reached from two
routes cycle 0039 left open), three rulings: **D-043** (exactly one spelling of a cell exists; the
form enforces it), **D-044** (range expansion is bounded by the table's current dimensions),
**D-045** (a cross-object range is rejected at parse time). Phase 2 continues.

**PHASE 1 IS COMPLETE AND SIGNED OFF** (0037-REVIEW-phase1). **Phase 2 — Table primitive — is
OPEN.** D-039/D-038 (entry 0039) are done. Entry 0040 added standalone, UNWIRED table-primitive
logic (default dimensions; a range's rectangle-enumeration helper) — nothing consumes it yet, and
`getObjectSchema("table")` still returns `undefined`. One Phase 1 criterion clause is still carried
into Phase 2 by name: **range EVALUATION** (`SUM(A1:B4)` still returns a placeholder `#PARSE`) —
see **D-036**, which gives it a home and four binding constraints. Phase 2's own criterion already
demands the proof.

Current phase: **2 — Table primitive.** "Wire the formula engine into cell slots. Add reference
adjustment. Still headless."
Last review point: **0041-REVIEW-phase2, ACCEPT WITH EDITS.** Before it: 0037-REVIEW-phase1 (Phase
1 gate), entry 0038-RULINGS (human, closed Q-010/Q-004/Q-002/Q-001 → D-038..D-042), entries 0039
and 0040 (implementer).
Cycles since last review: **0/3** · diff since last review: **0 lines / 0 files** (cap 800/10).
State the counting convention next batch — insertions, or insertions + deletions (0041-REVIEW §6).

## Next slice — the DYNAMIC SLOT FAMILY, not the wiring
`table` cannot enter `primitives/schema.ts`'s `SCHEMAS` while `ObjectSchema.nonDerivedSlotPaths` is
a fixed list, and D-017 says that mechanism is its own decision. That is now the critical path:
`deriveEdges` and `validateIntegrity` both consume the schema shape, so **nothing about tables can
be wired until it exists.** It touches `mutation.ts` and `primitives/schema.ts` — both load-bearing
(§6.2) — so expect a reviewed cycle of its own, and write the design down before the code.
Read 0041-REVIEW-phase2 §9 first; it lists what bites and in what order.

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

## Built and reviewed (all of Phase 0 and Phase 1)
- Scaffold, `graph/node.ts`, `graph/edge.ts`, `primitives/schema.ts`, `graph/cycles.ts`,
  `graph/eval.ts`, `mutation.ts`, `document.ts`, `address.ts` — Phase 0, signed off at
  0027-REVIEW-phase0.
- **`formula/ast.ts`** (14 tests), **`formula/lexer.ts`** (36 tests), **`formula/parser.ts`**
  (52 tests, D-038 as of cycle 0039), **`formula/deps.ts`** (20 tests), **`formula/functions.ts`**
  (44 tests), **`formula/eval.ts`** (47 tests) — the full formula engine, Phase 1, signed off at
  0037-REVIEW-phase1.

## Built and reviewed at 0041-REVIEW (cycles 0039–0040)
- **`address.ts` (D-039, cycle 0039; D-043, 0041-REVIEW)** — `CELL_REFERENCE_PATTERN` accepts
  either case and rejects leading zeros/row 0; ONE regex defines the form and `parseCellReference`
  `exec`s it; every route into a stored cell path normalises through `normalizeCellReference`,
  including the written-out `table_x.cells.a1` form.
- **`formula/parser.ts` (D-038, cycle 0039)** — rejects an unrecognised function name or wrong
  argument count at `#PARSE` time, naming the function and its position.
- **`address.ts` (cycle 0040)** — exported `TABLE_CELL_PATH_PREFIX`; added
  `columnLettersToIndex`/`indexToColumnLetters` (bijective base-26) and
  `parseCellReference`/`formatCellReference` (splits/builds an A1-form ref).
- **`primitives/table.ts` (NEW, cycle 0040, 190 lines)** — `DEFAULT_TABLE_ROWS`/`COLS` = 8;
  `enumerateRangeCellPaths(start, end)` expands a range's two endpoints into every cell path in
  the rectangle between them (row-major, no table-dimension bounds check by design, rejects a
  cross-object range — both now ruled: D-044 bounds it, D-045 moves the cross-object check to
  parse time). **Not yet wired into anything** — no `ObjectSchema` entry, no `eval.ts`/
  `mutation.ts` consumer. See "Next slice" above for exactly what's deferred and why.
- All mutation-tested (entries 0039/0040), verified at 0041-REVIEW; §6.1 trigger 5 (0039,
  pre-authorised) and trigger 2 (0040) are the only triggers that fired.

## Acceptance criteria
- **Phase 0** — all four PASSING and REVIEWED (0027-REVIEW).
- **Phase 1** — PASSED at 0037-REVIEW, nine clauses outright, one carried: see that entry's §4
  clause-by-clause table. Carried clause: **ranges in aggregates, EVALUATION half** (D-036).
- **Phase 2** — not started. Its criterion already includes the carried clause ("`SUM(A1:A5)`
  recomputes correctly after inserting a row inside the range").

## Known problems
- **Range evaluation is a placeholder `#PARSE`** (D-036). See "Next slice" above.
- **`enumerateRangeCellPaths` is unbounded and must not be wired as it stands** — RULED, **D-044**:
  it takes the table's current extent when it is wired, cells outside it are omitted rather than
  `#REF`, and that same change removes the `A1:ZZ999999` resource hazard. An unbounded expansion in
  `deriveEdges` would build edges to slots that do not exist (dangling edges).
- **A cross-object range is still only rejected at `enumerateRangeCellPaths`** — RULED, **D-045**:
  the check also belongs in `parser.ts` at `#PARSE` time (decidable from the text alone, D-038's
  line); the enumeration check stays as the defensive arm. Found and disclosed by cycle 0040.
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
  reasoning (D-042) · exactly one stored spelling per cell — no leading zeros, no row 0, one regex
  defines the form (D-043, fixed at 0041-REVIEW) · the column arithmetic stays in `address.ts`,
  rectangle enumeration in `table.ts` (0041-REVIEW answer 3) · everything 0029/0032/0035-REVIEW
  listed settled.

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
- **D-043: one spelling per cell, and the test for it is not "the new spelling is accepted".** It
  is that EVERY route into the stored form lands on the same string. There were three routes
  (shorthand, written-out `cells.<ref>`, and the row's digits); cycle 0039 closed one. Enumerate
  the routes before claiming a normalisation ruling is done.
- **`enumerateRangeCellPaths` is not wired-ready (D-044)** — it needs the table's extent, and its
  signature changes when you wire it. Decide `Address[]` vs paths at the same time.
- **The next slice is the dynamic slot family, NOT the wiring** — nothing about tables can be
  wired while `getObjectSchema("table")` returns `undefined`. Read 0041-REVIEW-phase2 §9.
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
