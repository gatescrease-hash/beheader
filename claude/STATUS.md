# STATUS — as of entry 0042-dynamic-slot-family

STATE: GREEN (compiles under both configs, 499/499 tests pass, 0 skipped, 0 `.only`).

**Process state: REVIEW REQUIRED before the next cycle begins.** Cycle 0042 solved the
`ObjectSchema` dynamic-slot-family mechanism 0041-REVIEW-phase2 §9 named as Phase 2's critical
path, and registered a real `table` schema entry through it (`getObjectSchema("table")` no longer
returns `undefined`). This touches two load-bearing files (`primitives/schema.ts`, `mutation.ts`)
with a design nothing in the brief specifies by name — §6.1 trigger 3, plus trigger 5 (three
`schema.test.ts` expectations intentionally changed by the type widening). Do not start a new
slice — the real range-evaluation wiring above all — until entry 0042 lands review.

**PHASE 1 IS COMPLETE AND SIGNED OFF** (0037-REVIEW-phase1). **Phase 2 — Table primitive — is
OPEN.** D-039/D-038 (entry 0039) done. Entry 0040 added standalone table-primitive logic
(dimensions, range-rectangle enumeration) with two defects entry 0041-REVIEW fixed (D-043) and two
rulings (D-044, D-045). Entry 0042 (this one) is the dynamic-slot-family mechanism: `table` now has
real `nonDerivedSlotPaths` (`rows`/`cols` fixed, `cells.*` dynamic) — but NOTHING is wired yet: no
table-creation command, no row/col mutations, and range EVALUATION (`SUM(A1:B4)` still returns a
placeholder `#PARSE`) is still carried — see D-036, which gives it a home and four binding
constraints. Phase 2's own acceptance criterion already demands that proof.

Current phase: **2 — Table primitive.** "Wire the formula engine into cell slots. Add reference
adjustment. Still headless."
Last review point: **0041-REVIEW-phase2, ACCEPT WITH EDITS** (cycles 0039/0040). Entry 0042
(this one) awaits its own review.
Cycles since last review: **1/3** · diff since last review: **819 lines (723 insertions + 96
deletions) / 6 files** (cap 800/10) — **using the insertions+deletions convention**, per
0041-REVIEW's own request to state which one is in use; by that count this single cycle is
already at the cap. Moot: §6.1 triggers fired independently regardless.

## Next slice — BLOCKED pending review of entry 0042
Once reviewed, the real Phase 2 wiring cycle begins:
- `evaluate` expands a range through its own `read` callback (D-036 constraint 1), calling
  `enumerateRangeCellPaths` (cycle 0040) — bounded by the table's current extent per **D-044**
  (the enumerator's SIGNATURE changes when this lands: decide `Address[]` vs. paths at the same
  time, per 0041-REVIEW §5's own design note).
- `deriveEdges` expands a `RangeDependency` via the SAME function, from CURRENT table dimensions
  on every mutation, never cached (D-036 constraint 2's other half) — this can now read `rows`/
  `cols` the SAME way `enumerateTableCellSlotPaths` (cycle 0042) already does.
- `evaluateRangeNode`'s placeholder is DELETED, not extended (D-036 constraint 3).
- A cross-object range is rejected at PARSE time (**D-045**) — `enumerateRangeCellPaths`'s own
  check stays as the defensive arm.
- A formula containing a range must not be storable until evaluation works, in the SAME cycle
  (D-036 constraint 4).
- `MIN`/`MAX`'s `Math.min(...)` spread (0035-REVIEW Finding 4) — this same cycle's problem once
  ranges flatten into long argument lists (D-036 constraint 5).
- **The three temporary bridges** — `mutation.ts`'s `findUnsupportedFormulaAsts`, `graph/eval.ts`'s
  `evaluateFormula` `#PARSE` branch, `deriveEdges`'s `ReferenceNode`-only narrowing — come down
  TOGETHER, not one at a time.
- **D-031's value-legality walk** must reach a stored AST's `LiteralNode`s in the same cycle that
  makes formulas storable.
- Row/column insert/delete + §5.4's reference-adjustment/clamping pass — its own design; entry
  0042 deliberately left `rows`/`cols` as ordinary, unprotected literal slots (see its Decision 3
  and reviewer question 2) — do not build a resize mutation as a bare `setSlot` on them.
- A table-creation command/mutation (§5.10) that actually populates `rows`/`cols` and a fresh
  `cells.*` slot set — Phase 3's command line, but the underlying `createObject` primitive
  (cycle 0024) already suffices for it, proven this cycle by hand-built fixtures.

## Built and reviewed (all of Phase 0 and Phase 1)
- Scaffold, `graph/node.ts`, `graph/edge.ts`, `primitives/schema.ts`, `graph/cycles.ts`,
  `graph/eval.ts`, `mutation.ts`, `document.ts`, `address.ts` — Phase 0, signed off at
  0027-REVIEW-phase0.
- **`formula/ast.ts`** (14 tests), **`formula/lexer.ts`** (36 tests), **`formula/parser.ts`**
  (52 tests, D-038 as of cycle 0039), **`formula/deps.ts`** (20 tests), **`formula/functions.ts`**
  (44 tests), **`formula/eval.ts`** (47 tests) — the full formula engine, Phase 1, signed off at
  0037-REVIEW-phase1.
- **`address.ts`** (D-039 cycle 0039; column arithmetic + `parseCellReference`/`formatCellReference`
  cycle 0040; D-043 fixed at 0041-REVIEW) and **`primitives/table.ts`**'s `enumerateRangeCellPaths`
  (cycle 0040) — reviewed at 0041-REVIEW-phase2 (ACCEPT WITH EDITS).

## Built this batch, not yet reviewed (cycle 0042)
- **`primitives/schema.ts`** — `ObjectSchema.nonDerivedSlotPaths` widened to
  `readonly NonDerivedSlotPathGroup[]` (`static | dynamic`, mirrors `DerivedSlotDependencies`);
  new `resolveNonDerivedSlotPaths(object, groups)`; `VALUE_SCHEMA`/`ADD_SCHEMA` updated to the new
  shape (no behaviour change); new `TABLE_SCHEMA` registered as `table` in `SCHEMAS`.
- **`primitives/table.ts`** (extended, not a new subsystem file) — `TABLE_ROWS_PATH`/
  `TABLE_COLS_PATH`, `enumerateTableCellSlotPaths(object)` (the `dynamic` group's `enumerate`
  function: generates every current cell path from the object's own `rows`/`cols`, never inverts
  a `slotKey`).
- **`mutation.ts`** — `deriveEdges`, `findUndeclaredFormulaOrDerivedSlots` (D-017),
  `findSchemaSlotKindMismatches` (D-018) all now resolve non-derived paths via
  `resolveNonDerivedSlotPaths` instead of walking a flat array.
- 25 new tests across `schema.test.ts`/`table.test.ts`/`mutation.test.ts`; 3 mutation-checks run
  and reverted (dynamic-branch disabled: 9 named failures; dimension guard loosened: 1 named
  failure; `table` unregistered: 12 named failures).
- A genuinely new, disclosed-not-fixed finding: **D-022's bounded-correctness claim
  ("`describeUndeclaredSlot` matches `formatAddress`") no longer holds for `table`** — a stray
  out-of-extent cell is named `table_x.cells.C5` (raw key) by D-017's check but `table_x.C5`
  (surface form) by `formatAddress` for the identical `Address`. Both resolve to the same slot
  (D-043); pinned by a test per D-022's own explicit ask, not fixed. See entry 0042's own
  "genuinely new finding" section and reviewer question 1.

## Acceptance criteria
- **Phase 0** — all four PASSING and REVIEWED (0027-REVIEW).
- **Phase 1** — PASSED at 0037-REVIEW, nine clauses outright, one carried: see that entry's §4
  clause-by-clause table. Carried clause: **ranges in aggregates, EVALUATION half** (D-036).
- **Phase 2** — not started. Its criterion already includes the carried clause ("`SUM(A1:A5)`
  recomputes correctly after inserting a row inside the range").

## Known problems
- **Range evaluation is a placeholder `#PARSE`** (D-036). See "Next slice" above.
- **D-022's bounded-correctness claim is false for `table`** (this cycle's new finding, disclosed
  not fixed) — see reviewer question 1.
- **`rows`/`cols` are ordinary, unprotected literal slots** — a raw `setSlot` on either could
  disagree with the cells that actually exist. Self-limiting for the dangerous half (a stray
  formula/derived cell is still caught by D-017); silently orphans the harmless half (a stray
  literal cell). A future resize mutation must not be a bare `setSlot` on these paths.
- **No bound on how large `rows`/`cols` may be set** — nothing can write to them yet (D-044's own
  "costs nothing to leave unbounded" reasoning, same shape). Flag for the table-creation/resize
  design.
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
  same-type-only (D-037) · a typo'd formula is refused at entry (D-038) · lowercase cell refs
  accepted/normalised (D-039) · column letters are bijective base-26 (cycle 0040) · exactly one
  stored spelling per cell (D-043) · range expansion is bounded by current table dimensions
  (D-044) · cross-object range rejection belongs at parse time (D-045) · an explicit write
  replaces a formula (D-040, Phase 3 — nothing to build yet) · `unlink` keeps what was displayed
  (D-041, Phase 3) · this is a one-user tool, no product/market reasoning (D-042) ·
  `ObjectSchema.nonDerivedSlotPaths` is a `NonDerivedSlotPathGroup[]` (`static`/`dynamic`), resolved
  per-object via `resolveNonDerivedSlotPaths` — never walked as a flat array directly (cycle 0042)
  · a table's cell family is generated from `rows`/`cols`, never by inverting a `slotKey` (cycle
  0042) · everything 0029/0032/0035/0041-REVIEW listed settled.

## Live PROVISIONAL tags and open questions
**Zero open questions block any phase.** Q-010 → D-038, Q-004 → D-039, Q-002 → D-040, Q-001 → D-041
(0038-RULINGS). D-042 standing: this is a tool with one user.

Still open, blocking nothing: **`PROVISIONAL(Q-007)`** → `document.ts`'s `CameraState`;
**`PROVISIONAL(Q-008)`** → `graph/node.ts`'s `isIllegalNumber` (compute side narrowed by D-033).
Answered earlier: **Q-003** → D-007, **Q-005**, **Q-006** → D-025, **Q-009** → D-029.
**Three reviewer questions from entry 0042 (implementer questions, not brief ambiguities):**
the D-022 divergence's disposition; whether `rows`/`cols` belong as slots or as structural
`GraphObject` state; whether `NonDerivedSlotPathGroup`'s `static`/`dynamic` split is the right
shape versus a single always-a-function form. (Entry 0040's own three questions were all answered
at 0041-REVIEW — see D-043/D-044/D-045 and that entry's §7.) Next free: **Q-011**.

## Gotchas for the next model
- **`resolveNonDerivedSlotPaths` is now the ONLY sanctioned way to read
  `ObjectSchema.nonDerivedSlotPaths`.** Never iterate `schema.nonDerivedSlotPaths` as if it were a
  flat path array — it is a `NonDerivedSlotPathGroup[]` as of cycle 0042. All three of
  `mutation.ts`'s consumers already route through it; a fourth call site must too, or it will
  disagree with the other three about a table's current cell family.
- **`enumerateTableCellSlotPaths` generates paths from `rows`/`cols`; it never reads a table's
  actual `cells.*` slot keys back into a path.** D-010 forbids inverting a `slotKey`, even where
  it happens to be safe (a cell ref never contains "."). Do not "simplify" this by scanning
  `Object.keys(object.slots)` for the dynamic family.
- **D-022's bounded-correctness claim is now FALSE for `table`** — `describeUndeclaredSlot`'s
  raw-key naming and `formatAddress`'s surface form diverge for a table cell (`table_x.cells.C5`
  vs. `table_x.A1`-style short form). Both resolve to the same slot; this is disclosed, not fixed
  (reviewer question 1). Do not "fix" it without reading entry 0042's own reasoning for why both
  obvious fixes (inverting a key, or teaching `mutation.ts` about table-shaped keys) have real
  costs.
- **The next slice is the range-evaluation wiring, NOT another schema/mutation.ts design change.**
  Read D-036's four constraints and 0041-REVIEW-phase2 §9's ordering before starting it.
- **`rows`/`cols` are unprotected literal slots today.** A future resize mutation must not be a
  bare `setSlot` on them — see entry 0042's Decision 3 and reviewer question 2.
- **Cell-reference case normalisation happens at exactly one point (D-039): `normalizeCellReference`
  in `address.ts`.** Column-letter arithmetic is a SEPARATE, already-solved concern.
- **A formula's name/arity is validated at parse time (D-038)** — `formula/eval.ts`'s own
  defensive arms stay; do not remove them.
- **D-042: this is a TOOL with exactly one user.** Justify a choice by correctness, simplicity
  (Rule 5), and cheapness to change — never "users will expect."
- **D-040 covers the `set` command only; D-041 covers `unlink` only.** Neither is built yet
  (Phase 3). Dragging still behaves per §5.9.
- **D-029 is still the rule most likely to be broken by accident**: when `graph/eval.ts` calls
  `formula/eval.ts`, do not "simplify" `IF`/`AND`/`OR` dispatch into a registry lookup.
- **`evaluate(ast, read)` takes a `read` callback and nothing else** — no `EvalContext` yet.
- **One shared guard for numbers: `finiteResult` (D-033).** Do not write a fourth copy.
- **Look up a registry by `Object.hasOwn`, never a bare index (D-034).**
- **`src/engine/` contains no `throw`, and should stay that way.**
- **Range placement (`parser.ts`), range DEPENDENCY reporting (`deps.ts`), range EVALUATION
  (`eval.ts`, unbuilt), and range ENUMERATION (`table.ts`, unwired) are FOUR different concerns.**
  Do not collapse them.
- **Batch discipline is fixed and should stay fixed:** cycle 0036 stopped at its phase gate; 0039
  stopped short of the wiring slice; 0040 built exactly what a subsystem's first file can honestly
  claim and stopped at trigger 2; 0042 (this cycle) solved exactly the one named mechanism and
  stopped rather than continuing into the wiring cycle in the same batch. Keep that pattern.
- Each PowerShell call is a fresh process; the Bash tool's `npm` is not on PATH — use PowerShell.
