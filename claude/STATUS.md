# STATUS — as of entry 0043-REVIEW-phase2

STATE: GREEN (compiles under both configs, 501/501 tests pass, 0 skipped, 0 `.only`).

**The review gate is CLEAR. The next cycle may start immediately.** Entry 0042's
dynamic-slot-family mechanism was reviewed at 0043-REVIEW-phase2: **ACCEPT WITH EDITS**. The
mechanism was kept in full; one Rule 6 defect was found, fixed by the reviewer, and ruled as
**D-046**. `table` is a real `SCHEMAS` entry and `resolveNonDerivedSlotPaths` is the sanctioned way
to read `nonDerivedSlotPaths`.

**PHASE 1 IS COMPLETE AND SIGNED OFF** (0037-REVIEW-phase1). **Phase 2 — Table primitive — is
OPEN.** Range EVALUATION is still a placeholder `#PARSE` (D-036) and nothing creates or resizes a
table yet. That wiring is the next slice, and Phase 2's acceptance criterion demands it.

Current phase: **2 — Table primitive.** "Wire the formula engine into cell slots. Add reference
adjustment. Still headless."
Last review point: **0043-REVIEW-phase2, ACCEPT WITH EDITS** (cycle 0042).
Cycles since last review: **0/3** · diff since last review: **0 lines / 0 files** (cap 800/10).
Convention, settled at 0042 and upheld at 0043-REVIEW: **insertions + deletions**.

## Next slice — the range-evaluation wiring (UNBLOCKED, start here)
Everything below lands in ONE cycle; the pieces are deliberately not separable.
- `evaluate` expands a range through its own `read` callback (D-036 constraint 1), calling
  `enumerateRangeCellPaths` — bounded by the table's current extent per **D-044**. The
  enumerator's SIGNATURE changes when this lands: decide `Address[]` vs. paths at the same time
  (0041-REVIEW §5, 0043-REVIEW §9).
- `deriveEdges` expands a `RangeDependency` via the SAME function, from CURRENT table dimensions on
  every mutation, never cached (D-036 constraint 2).
  **Read those dimensions `literal`-only, per D-046** — not a bare `slot.value`. Same Rule 6
  argument as `enumerateTableCellSlotPaths`; do not reintroduce the hole 0043-REVIEW just closed.
- `evaluateRangeNode`'s placeholder is DELETED, not extended (D-036 constraint 3).
- A cross-object range is rejected at PARSE time (**D-045**); `enumerateRangeCellPaths`'s own check
  stays as the defensive arm.
- A formula containing a range must not be storable until evaluation works, in the SAME cycle
  (D-036 constraint 4).
- `MIN`/`MAX`'s `Math.min(...)` spread (0035-REVIEW Finding 4) becomes reachable this cycle once
  ranges flatten into argument lists — fix it here (D-036 constraint 5).
- **The three temporary bridges** — `mutation.ts`'s `findUnsupportedFormulaAsts`, `graph/eval.ts`'s
  `evaluateFormula` `#PARSE` branch, `deriveEdges`'s `ReferenceNode`-only narrowing — come down
  TOGETHER, not one at a time.
- **D-031's value-legality walk** must reach a stored AST's `LiteralNode`s in the same cycle that
  makes formulas storable.

Deferred beyond it, still unbuilt and still correctly deferred: row/column insert/delete plus
§5.4's reference-adjustment/clamping pass, and a table-creation command (§5.10). When either is
designed, read entry 0042's Decision 3 and D-046 together — a bare `setSlot` on `rows`/`cols` is
not an adequate resize primitive.

## Built and reviewed (all of Phase 0, all of Phase 1, and Phase 2's schema work)
- Scaffold, `graph/node.ts`, `graph/edge.ts`, `graph/cycles.ts`, `graph/eval.ts`, `mutation.ts`,
  `document.ts`, `address.ts`, `primitives/schema.ts` — Phase 0, signed off at 0027-REVIEW-phase0.
- **`formula/ast.ts`** (14), **`formula/lexer.ts`** (36), **`formula/parser.ts`** (52),
  **`formula/deps.ts`** (20), **`formula/functions.ts`** (44), **`formula/eval.ts`** (47) — the
  full formula engine, Phase 1, signed off at 0037-REVIEW-phase1.
- **`address.ts`** column arithmetic + `parseCellReference`/`formatCellReference` and
  **`primitives/table.ts`**'s `enumerateRangeCellPaths` — 0041-REVIEW (ACCEPT WITH EDITS).
- **The dynamic slot family** — `ObjectSchema.nonDerivedSlotPaths` as
  `readonly NonDerivedSlotPathGroup[]` (`static | dynamic`), `resolveNonDerivedSlotPaths`,
  `TABLE_SCHEMA` registered as `table`, `enumerateTableCellSlotPaths`, and `mutation.ts`'s three
  consumers routed through the one resolver — 0043-REVIEW (ACCEPT WITH EDITS, + D-046).

## Not started
- Range evaluation wiring (next slice, above) · row/col insert/delete · reference adjustment
  (§5.4) · table creation (§5.10) · everything in Phases 3–7.

## Known problems
- **Range evaluation is a placeholder `#PARSE`** (D-036). Owned by the next slice.
- **A dimension write is not checked for COHERENCE with the cells that exist.** D-046 settles the
  dimension slot's KIND (`literal` only, so evaluation can never resize the family) but a raw
  `setSlot` writing a *literal* `rows`/`cols` can still disagree with the object's actual cell
  slots. Self-limiting for the dangerous half — a stray formula/derived cell outside the new extent
  is caught by D-017 in that same mutation — and silently orphaning for the harmless half (a stray
  literal cell). The resize design owns this.
- **No bound on how large `rows`/`cols` may be set.** Nothing can write them yet; flag for the
  creation/resize design (same reasoning as D-044).
- **D-022's bounded-correctness claim does not hold for `table`** — `describeUndeclaredSlot` names a
  stray cell by raw key (`table_x.cells.C5`), `formatAddress` by surface form (`table_x.C5`). Both
  resolve to the same slot. **Ruled acceptable and NARROWED at 0043-REVIEW §7 Q1 — do not "fix" it.**
  The pinning test stays as a tripwire for future types.
- **`MIN`/`MAX` spread their argument list** (`Math.min(...numbers)`) — `RangeError` risk, becomes
  reachable in the next slice and is owned by it.
- **`describeValueType` is duplicated verbatim** in `functions.ts` and `eval.ts` (0037-REVIEW
  Finding 4, carried, untouched).
- **The three temporary bridges** come down together in the wiring cycle, never one at a time.
- **D-031's value-legality walk does not yet reach a stored AST's literals.** Opens the moment
  formulas become storable, closes in that same cycle.
- **`camera` has no WRITE-side guard** (D-027, carried).
- **The journal's STRUCTURE is deliberately unvalidated** beyond `Array.isArray` (carried).
- **L-16, L-17/L-18/L-14, §5.11's `style` field, `nextObjectId` reconciliation, `noUnusedLocals`
  off, L-6–L-15 cosmetics, recursion depth — carried unchanged.**
- **`lexer.ts`'s two disclosed edge cases** (carried).
- **SETTLED, do not re-raise:** `^` is left-associative (D-030) · function names are case-sensitive
  uppercase-only · `CONCAT` takes strings with no coercion · a `RangeNode` is reported
  pre-expansion by `deps.ts` · `IF` is exactly 3 args, `AND`/`OR` at least 1 (D-035) · a computed
  `-0` normalises to `+0` (D-033) · `%` follows Excel's `MOD`, comparisons are same-type-only
  (D-037) · a typo'd formula is refused at entry (D-038) · lowercase cell refs accepted/normalised
  (D-039) · column letters are bijective base-26 · exactly one stored spelling per cell (D-043) ·
  range expansion is bounded by current dimensions (D-044) · cross-object range rejection belongs
  at parse time (D-045) · **a slot that SIZES a dynamic family must be `literal` (D-046)** ·
  `nonDerivedSlotPaths` is a `NonDerivedSlotPathGroup[]`, read only via
  `resolveNonDerivedSlotPaths` · a table's cell family is generated from `rows`/`cols`, never by
  inverting a `slotKey` · dimensions stay SLOTS, not structural state (0043-REVIEW §7 Q2) · the
  `static`/`dynamic` union stays (0043-REVIEW §7 Q3) · an explicit write replaces a formula (D-040,
  Phase 3) · `unlink` keeps what was displayed (D-041, Phase 3) · one user, no product reasoning
  (D-042) · everything 0029/0032/0035/0041/0043-REVIEW listed settled.

## Live PROVISIONAL tags and open questions
**Zero open questions block any phase.** Entry 0042 raised none, and 0043-REVIEW answered all three
of its reviewer questions (§7: D-022 divergence stands and is narrowed; dimensions stay slots;
the union stays).

Still open, blocking nothing: **`PROVISIONAL(Q-007)`** → `document.ts`'s `CameraState`;
**`PROVISIONAL(Q-008)`** → `graph/node.ts`'s `isIllegalNumber`. Answered earlier: Q-001 → D-041,
Q-002 → D-040, Q-003 → D-007, Q-004 → D-039, Q-005, Q-006 → D-025, Q-009 → D-029, Q-010 → D-038.
Next free: **Q-011**.

## Gotchas for the next model
- **D-046 is the newest and the easiest to re-break.** Any read of a slot that determines a
  dynamic family's MEMBERSHIP must check `slot.kind === "literal"` first. A `formula` slot's value
  is written at step 7, after edge derivation and validation have already run — honouring one lets
  EVALUATION resize the slot set (Rule 6) and lets `mutate` commit a document that fails its own
  re-validation. Both were real and are pinned by tests in `mutation.test.ts`.
- **`resolveNonDerivedSlotPaths` is the ONLY sanctioned way to read
  `ObjectSchema.nonDerivedSlotPaths`.** Never iterate it as a flat path array. All three
  `mutation.ts` consumers route through it; a fourth call site must too, or it will disagree with
  the other three about a table's current cell family.
- **`enumerateTableCellSlotPaths` generates paths from `rows`/`cols`; it never reads a table's
  actual `cells.*` keys back into a path** (D-010). Do not "simplify" it by scanning
  `Object.keys(object.slots)`.
- **Range placement (`parser.ts`), range DEPENDENCY reporting (`deps.ts`), range EVALUATION
  (`eval.ts`, unbuilt), and range ENUMERATION (`table.ts`, unwired) are FOUR different concerns.**
  Do not collapse them.
- **Cell-reference case normalisation happens at exactly one point (D-039):
  `normalizeCellReference` in `address.ts`.** Column-letter arithmetic is a separate, solved concern.
- **A formula's name/arity is validated at parse time (D-038)** — `formula/eval.ts`'s defensive
  arms stay; do not remove them.
- **D-029 is still the rule most likely to be broken by accident**: when `graph/eval.ts` calls
  `formula/eval.ts`, do not "simplify" `IF`/`AND`/`OR` dispatch into a registry lookup.
- **`evaluate(ast, read)` takes a `read` callback and nothing else** — no `EvalContext` yet.
- **One shared guard for numbers: `finiteResult` (D-033).** Do not write a fourth copy.
- **Look up a registry by `Object.hasOwn`, never a bare index (D-034).**
- **`src/engine/` contains no `throw`, and should stay that way.**
- **D-042: this is a TOOL with exactly one user.** Justify by correctness, simplicity (Rule 5), and
  cheapness to change — never "users will expect."
- **Batch discipline is fixed and should stay fixed:** 0036 stopped at its phase gate; 0039 stopped
  short of the wiring slice; 0040 stopped at trigger 2; 0042 solved exactly the one named mechanism
  and stopped. Keep that pattern — the next slice is large, so declare it honestly and do not also
  start the resize design in the same batch.
- Each PowerShell call is a fresh process; the Bash tool's `npm` is not on PATH — use PowerShell.
