# STATUS — as of entry 0044-range-evaluation-wiring

STATE: GREEN (compiles under both configs, 536/536 tests pass, 0 skipped, 0 `.only`).

**Process state: REVIEW REQUIRED before the next cycle begins.** Entry 0044 (this one) wired the
range-evaluation slice named next at 0043-REVIEW-phase2 §9 — the last piece of D-036. Two §6.1
triggers fired (3: genuine design decisions on load-bearing files; 5: changed test expectations),
independent of the batch cap (also exceeded: 1834 lines / 13 files, cap 800/10). **Do not start a
new slice until entry 0044 lands review.**

Current phase: **2 — Table primitive.** "Wire the formula engine into cell slots. Add reference
adjustment. Still headless." The formula engine IS wired in now (this cycle); reference adjustment
(row/column resize) is not.

Last review point: **0043-REVIEW-phase2, ACCEPT WITH EDITS** (cycle 0042). Entry 0044 has not been
reviewed yet.
Cycles since last review: **1/3** · diff since last review: **1834 lines / 13 files** (cap 800/10,
exceeded — moot given the §6.1 triggers).
Convention: insertions + deletions (settled 0042, upheld 0043-REVIEW).

## Phase 2 acceptance criterion — PARTIAL, not claimed complete

"Two separate tables exist; `table_a.B2` holds `= table_b.C3 * 2` and updates live; a circular
reference between them is rejected; `SUM(A1:A5)` recomputes correctly after inserting a row inside
the range; and deleting a row whose cells have external dependents rewrites those references to
`#REF` (repair path) rather than leaving a dangling edge, while `delete <table>` on that same table
is rejected (rejection path) until `force` is passed."

- Two tables, cross-table formula, live update — **PASSING** (real `mutate()` end-to-end test).
- Circular reference rejected, including through range-derived edges — **PASSING**.
- `SUM(A1:A5)` recomputes when a cell WITHIN the range changes — **PASSING**. "...after inserting a
  row" specifically — **NOT YET**, row insert does not exist.
- Row/column delete with `#REF` repair, `delete <table>` rejected-until-`force` — **NOT YET**.
  `delete <table>` IS correctly rejected while a range depends on it (no repair path exists, so
  rejection is the only outcome today) — but there is no `force` flag anywhere in `Operation`, and
  no row/column deletion to repair.

Both NOT YET items need the still-deferred resize/creation cycle, below.

## Next slice — table resize/creation (UNBLOCKED once entry 0044 clears review)

This is what closes Phase 2's gate. STATUS.md has flagged it as deliberately deferred across three
cycles now (0042, 0043-REVIEW, 0044) — this is the cycle that actually builds it.

- A table-creation mutation/command populating `TABLE_ROWS_PATH`/`TABLE_COLS_PATH` and matching
  `cells.*` literal slots (§5.10: `table x=0 y=0 rows=8 cols=8`). The `createObject` primitive
  already suffices as the underlying mechanism — proven by this cycle's and 0042's own hand-built
  fixtures — but no user-facing command exists yet (Phase 3 territory; a minimal one may be needed
  here just to exercise resize meaningfully).
- Row/column insert/delete, and §5.4's reference-adjustment pass: every stored AST in the document
  gets walked, references at/after the insertion point shift, a range spanning the point widens, a
  reference to a deleted row/column becomes `#REF` (D-028's `ErrorNode`, at that position), a range
  whose endpoint was deleted clamps to the remaining extent.
- Row/column deletion takes the REPAIR path (§5.1.1's second option), not rejection — the one place
  in the system a deletion is allowed to break someone else's formula, by design.
- **A bare `setSlot` on `rows`/`cols` is NOT an adequate resize primitive** — read entry 0042's
  Decision 3 and D-046 together before designing this. D-046 constrains the dimension slots' KIND
  (must be `literal`); it does NOT constrain COHERENCE between a dimension write and the cells that
  actually exist. This cycle's design owns closing that gap for good, or explicitly deciding it
  stays open with a new disclosed reason.

## Built and reviewed (through 0043-REVIEW-phase2)

- Scaffold, `graph/node.ts`, `graph/edge.ts`, `graph/cycles.ts`, `mutation.ts`'s Phase-0 shape,
  `document.ts`, `address.ts`'s Phase-0 shape, `primitives/schema.ts`'s Phase-0 shape — Phase 0,
  signed off at 0027-REVIEW-phase0.
- The full formula engine (`formula/ast.ts` through `formula/eval.ts`) — Phase 1, signed off at
  0037-REVIEW-phase1.
- `address.ts`'s column arithmetic, cell-reference normalisation (D-039/D-043), and
  `primitives/table.ts`'s first file — 0041-REVIEW (ACCEPT WITH EDITS).
- The dynamic slot family (`NonDerivedSlotPathGroup`, `resolveNonDerivedSlotPaths`, `TABLE_SCHEMA`,
  `enumerateTableCellSlotPaths`, D-046's `literal`-only dimension guard) — 0043-REVIEW (ACCEPT WITH
  EDITS).

## Built this batch, not yet reviewed (entry 0044)

- Range evaluation wired end-to-end: `formula/eval.ts`'s `evaluate` gains `readRange`;
  `graph/eval.ts` builds real `read`/`readRange` closures and calls the real evaluator (no more
  `ReferenceNode`-only bridge); `mutation.ts`'s `deriveEdges` walks `extractDependencies` for real
  and expands a `RangeDependency` via `primitives/table.ts`'s renamed, bounded
  `enumerateRangeCellAddresses` (D-044, reading dimensions `literal`-only per D-046).
- **D-045**: a cross-object range is rejected at PARSE time (`formula/parser.ts`).
- **D-031**: `mutation.ts`'s `findIllegalSlotValues` now also walks a `formula`-kind slot's stored
  AST for an illegal `LiteralNode` (`collectIllegalAstLiterals`).
- `MIN`/`MAX`'s `Math.min(...)`/`Math.max(...)` spread risk fixed (`.reduce`, same zero-argument
  answer preserved).
- The THREE temporary bridges (`findUnsupportedFormulaAsts`, `graph/eval.ts`'s old
  `evaluateFormula`, `deriveEdges`'s `ReferenceNode`-only narrowing) are all DELETED.

## Not started

Table resize/creation (next slice, above) · row/col insert/delete · reference adjustment (§5.4) ·
everything in Phases 3–7.

## Known problems

- **`findIllegalOperationPayloads` does not walk a `setSlot`/`createObject` payload's stored AST
  for a D-031-style illegal literal** — only `findIllegalSlotValues` (the post-fold check) does. An
  illegal literal inside a range-containing formula's AST, overwritten or deleted within the SAME
  batch, could reach the journal — the same shape D-025/Q-008's payload check (cycle 0026) closed
  for plain slot values, not yet closed for stored ASTs. Disclosed at entry 0044, not fixed —
  reviewer question 1.
- **A dimension write is not checked for COHERENCE with the cells that exist.** D-046 settles the
  dimension slot's KIND (`literal` only); a raw `setSlot` writing a *literal* `rows`/`cols` can
  still disagree with the object's actual cell slots. Self-limiting for the dangerous half (D-017
  catches a stray formula/derived cell outside the new extent in that same mutation); silently
  orphaning for the harmless half (a stray literal cell). The resize design (next slice) owns this.
- **No bound on how large `rows`/`cols` may be set.** Nothing can write them yet outside a hand-built
  fixture; flag for the resize/creation design.
- **D-022's bounded-correctness claim does not hold for `table`** — narrowed and accepted at
  0043-REVIEW §7 Q1. Do not "fix" it; the pinning test stays as a tripwire for future types.
- **`describeValueType` is duplicated verbatim** in `functions.ts` and `eval.ts` (0037-REVIEW
  Finding 4, carried, untouched).
- **`camera` has no WRITE-side guard** (D-027, carried). **The journal's STRUCTURE is deliberately
  unvalidated** beyond `Array.isArray` (carried).
- **L-16, L-17/L-18/L-14, §5.11's `style` field, `nextObjectId` reconciliation, `noUnusedLocals`
  off, L-6–L-15 cosmetics, recursion depth — carried unchanged.**
- **`lexer.ts`'s two disclosed edge cases** (carried) — its own header's D-031 forward-reference is
  now stale (the shield it named IS removed, as of this cycle) and should be updated to say so
  rather than "will be" when next touched.
- **SETTLED, do not re-raise:** everything 0029/0032/0035/0037/0038/0041/0043-REVIEW settled, plus:
  `nonDerivedSlotPaths` is a `NonDerivedSlotPathGroup[]`, read only via `resolveNonDerivedSlotPaths`
  · a table's cell family is generated from `rows`/`cols`, never by inverting a `slotKey` ·
  dimensions stay SLOTS, not structural state · the `static`/`dynamic` union stays · a slot that
  SIZES a dynamic family must be `literal` (D-046) · a cross-object range is rejected at PARSE time
  (D-045) · range expansion is bounded by current dimensions, cells outside are OMITTED not `#REF`
  (D-044) · a stored AST's number literals are document state, checked the same way a slot's value
  is (D-031) · `readRange` is an optional third parameter on `formula/eval.ts`'s `evaluate`, with a
  documented `#PARSE` fallback when omitted — see entry 0044 Decision 2.

## Live PROVISIONAL tags and open questions

**Zero open questions block any phase.** Entry 0044 raised none — four reviewer questions instead,
in its own log entry, awaiting reviewer attention.

Still open, blocking nothing: **`PROVISIONAL(Q-007)`** → `document.ts`'s `CameraState`;
**`PROVISIONAL(Q-008)`** → `graph/node.ts`'s `isIllegalNumber`. Next free: **Q-011**.

## Gotchas for the next model

- **The three temporary bridges are GONE.** Do not look for `findUnsupportedFormulaAsts`,
  `graph/eval.ts`'s old `#PARSE`-on-non-reference `evaluateFormula`, or `deriveEdges`'s
  `ReferenceNode`-only narrowing — all deleted at entry 0044. Every `FormulaAst` shape is genuinely
  supported end to end now.
- **`enumerateRangeCellAddresses` (renamed from `enumerateRangeCellPaths`) now takes a THIRD
  parameter, the table's `GraphObject`, and returns `Address[]`, not paths.** Bounded by current
  extent (D-044), reading dimensions `literal`-only (D-046) via the SAME `readTableDimension`
  `enumerateTableCellSlotPaths` already used.
- **`formula/eval.ts`'s `evaluate` takes an optional THIRD parameter, `readRange`.** A range
  reached as a direct aggregate argument with no `readRange` supplied evaluates to a disclosed
  `#PARSE` — this is a documented fallback for a caller with no range capability, not a bug. The
  one real production caller (`graph/eval.ts`) always supplies a real one.
- **`resolveNonDerivedSlotPaths` is still the ONLY sanctioned way to read
  `ObjectSchema.nonDerivedSlotPaths`.** Unchanged this cycle; still binding.
- **`enumerateTableCellSlotPaths`/`enumerateRangeCellAddresses` both generate paths from
  `rows`/`cols`; neither ever reads a table's actual `cells.*` keys back into a path** (D-010).
- **A formula's name/arity is validated at parse time (D-038)**; a cross-object range likewise
  (D-045, this cycle). `formula/eval.ts`'s defensive arms for both stay — they are the answer for a
  loaded/hand-built AST, not a typed one.
- **D-029 is still the rule most likely to be broken by accident**: `IF`/`AND`/`OR` dispatch stays
  hard-coded by name in `formula/eval.ts`, never a registry-lookup dispatch — unaffected by this
  cycle's `readRange` threading, but easy to snag while editing nearby code.
- **One shared guard for numbers: `finiteResult` (D-033).** `MIN`/`MAX`'s `.reduce` fix routes
  through it exactly as the old spread did — do not reintroduce a raw `Math.min(...)`.
- **Batch discipline is fixed and should stay fixed:** 0042 solved exactly the dynamic-slot-family
  mechanism and stopped short of wiring; 0044 solved exactly the range-evaluation wiring and
  stopped short of resize — do not start the resize design in the same batch as anything else.
- Each PowerShell call is a fresh process; the Bash tool's `npm` is not on PATH — use PowerShell.
