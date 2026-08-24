# STATUS — as of entry 0046-empty-cell-range-fix

STATE: GREEN (compiles under both configs, 545/545 tests pass, 0 skipped, 0 `.only`) — and, as of
this cycle, the SEMANTICS the build was hiding a gap in (0045-REVIEW's REVISE) are fixed too.

**Process state: 0045-REVIEW's four-item fix list is CLOSED (D-047, D-048).** No `§6.1` trigger
fired this cycle — the fix list was reviewer-directed, not a new design decision, and no test
expectation changed (nine tests added, none altered). Batching: cycle 1/3 since 0045-REVIEW-phase2,
diff ~335 lines / 3 files (cap 800/10). Entry 0046's own assessment: **REVIEW RECOMMENDED, not
REQUIRED** — the implementer is not starting the resize/creation slice without hearing back first,
even though the batch cap does not force a stop.

Current phase: **2 — Table primitive.** "Wire the formula engine into cell slots. Add reference
adjustment. Still headless." The formula engine is wired AND now handles the ordinary sparse-table
case (entry 0044 + 0046); reference adjustment is not built.
Last review point: **0045-REVIEW-phase2, REVISE** (cycle 0044) — fix list closed at entry 0046.
Cycles since last review: **1/3** · diff since last review: **~335 lines / 3 files** (cap 800/10).
Convention: insertions + deletions (settled 0042).

## Next slice — table resize/creation (what actually closes Phase 2's gate)

Deferred across five cycles now (0042, 0043-REVIEW, 0044, 0045-REVIEW, 0046). This is the cycle,
**once a reviewer has looked at 0046** (recommended, not a hard gate — see Process state above).

- A table-creation mutation/command populating `TABLE_ROWS_PATH`/`TABLE_COLS_PATH` and the cell
  family (§5.10: `table x=0 y=0 rows=8 cols=8`). `createObject` already suffices as the underlying
  primitive.
- Row/column insert/delete, and §5.4's reference-adjustment pass over **every stored AST in the
  document** (not just the resized table's): references at/after the insertion point shift, a range
  spanning the point widens, a reference to a deleted row/column becomes `#REF` (D-028's
  `ErrorNode`) at that position, a range whose endpoint was deleted clamps to the remaining extent.
  Deletion takes the §5.1.1 **REPAIR** path, not rejection — the one place a deletion may break
  someone else's formula — and reports every slot it broke. Plus the `force` flag the criterion
  names, which no `Operation` carries yet.
- **A bare `setSlot` on `rows`/`cols` is NOT an adequate resize primitive** — read entry 0042's
  Decision 3 and D-046 together. D-046 settles the dimension slots' KIND; COHERENCE with the cells
  that actually exist is still open and this cycle owns closing it.
- **D-047 now guarantees this design choice is not load-bearing for the formula engine**: whatever
  creation/resize decides about how an empty cell is represented (no slot at all, vs. a slot holding
  `null`), both already work identically in every aggregate, proven by entry 0046's tests. Design
  the resize primitive for whatever is cleanest to implement; do not let the formula engine's needs
  constrain that choice.

## Phase 2 acceptance criterion — PARTIAL

Quoted in full at entry 0044 and 0045-REVIEW §4. Clause status:

- Two tables, cross-table formula, live update — **PASSING** (real `mutate()` end-to-end).
- Circular reference rejected, including through range-derived edges — **PASSING**.
- `SUM(A1:A5)` recomputes when a cell within the range changes — **PASSING for both a
  fully-populated AND a sparsely-populated range** (0045-REVIEW Finding 1 / D-047, closed entry
  0046). "...after inserting a row" — **NOT YET**; row insertion itself still does not exist. Entry
  0046 closed the semantic PRECONDITION that clause needs (an empty cell inside a range no longer
  breaks the document); the resize cycle still owns the insertion itself.
- Row/column delete with `#REF` repair, `delete <table>` rejected-until-`force` — **NOT YET**.
  `delete <table>` IS correctly rejected while a range depends on it; there is no `force` flag and
  no row/column deletion to repair.

## Built and reviewed (through 0043-REVIEW-phase2)

Phase 0 in full (0027-REVIEW) · the full formula engine, `formula/ast.ts` … `formula/eval.ts`
(Phase 1, 0037-REVIEW) · `address.ts`'s column arithmetic and cell normalisation, D-039/D-043, plus
`primitives/table.ts`'s first file (0041-REVIEW) · the dynamic slot family
(`NonDerivedSlotPathGroup`, `resolveNonDerivedSlotPaths`, `TABLE_SCHEMA`,
`enumerateTableCellSlotPaths`, D-046's `literal`-only dimension guard) (0043-REVIEW).

## Built, reviewed with REVISE, revisions now closed (entries 0044 + 0046, reviewed at 0045-REVIEW)

Range evaluation wired end-to-end (`formula/eval.ts`'s `readRange`, `graph/eval.ts`'s real
`read`/`readRange` closures, `deriveEdges` walking `extractDependencies` and expanding a
`RangeDependency` via `enumerateRangeCellAddresses`, D-044-bounded and D-046-safe) · **the three
temporary bridges are DELETED**, verified by grep · **D-045** · **D-031**'s
`collectIllegalAstLiterals` · `MIN`/`MAX`'s `.reduce` · `enumerateRangeCellAddresses` returns
`Address[]` · **D-047**: `deriveEdges` skips an enumerated range cell with no slot; `readRange`
omits an absent or `null`-valued cell from its flattened `Value[]` · **D-048**:
`findIllegalOperationPayloads` walks a `setSlot`/`createObject` formula payload's AST via
`collectIllegalAstLiterals`, closing the asymmetry with `findIllegalSlotValues`.

**Not yet independently reviewed**: entry 0046 itself (the fix-list implementation) — recommended,
not required, per its own self-assessment.

## Not started

Row/col insert/delete · reference adjustment (§5.4) · table creation (§5.10) · the `force` flag ·
everything in Phases 3–7.

## Known problems

- **The dangling-reference message names the DEPENDENT, not the missing SOURCE**, and repeats once
  per missing cell (`table_x.B1 references a slot that does not exist; table_x.B1 references...`).
  Scales badly for a range. D-047 removed the common path into it (a sparse range with an ordinary
  gap no longer reaches this at all); still worth fixing the message when it is next touched
  (0045-REVIEW Finding 4, not fixed at 0046 — out of that cycle's declared scope).
- **A dimension write is not checked for COHERENCE with the cells that exist.** D-046 settles the
  KIND (`literal` only); a raw `setSlot` on a *literal* `rows`/`cols` can still disagree with the
  object's actual cell slots. Self-limiting for the dangerous half (D-017 catches a stray
  formula/derived cell); silently orphaning for the harmless half. The resize design owns this. As
  of D-047, this is no longer a formula-engine-correctness problem (an orphaned/undersized cell just
  reads as empty) — it is purely a resize-design problem now.
- **No bound on how large `rows`/`cols` may be set.** Flag for the resize/creation design.
- **D-022's bounded-correctness claim does not hold for `table`** — narrowed and accepted at
  0043-REVIEW §7 Q1. Do not "fix" it; the pinning test stays as a tripwire.
- **`describeValueType` is duplicated verbatim** in `functions.ts` and `eval.ts` (0037-REVIEW
  Finding 4, carried).
- **Carried unchanged:** `camera` has no WRITE-side guard (D-027) · the journal's STRUCTURE is
  deliberately unvalidated beyond `Array.isArray` · `lexer.ts`'s two disclosed edge cases · L-16,
  L-17/L-18/L-14, §5.11's `style` field, `nextObjectId` reconciliation, `noUnusedLocals` off,
  L-6–L-15 cosmetics, recursion depth.
- **SETTLED, do not re-raise:** D-030 `^` left-assoc · uppercase-only function names · strict
  `CONCAT` · `deps.ts` reports a range PRE-expansion · D-035 · D-033 `-0` · D-037 `%` · D-038 ·
  D-039 · bijective base-26 columns · D-043 · D-044 · D-045 · D-046 · D-047 · D-048 ·
  `enumerateRangeCellAddresses` returns `Address[]` · the unresolvable-table fallback stays ·
  `readRange` stays OPTIONAL until a 2nd production caller · dimensions stay SLOTS · the
  `static`/`dynamic` union stays · D-040/D-041 (Phase 3) · D-042 · everything
  0029/0032/0035/0041/0043/0045-REVIEW listed settled.

## Live PROVISIONAL tags and open questions

**Zero open questions block any phase.** Entry 0046 raised none. Still open, blocking nothing:
**`PROVISIONAL(Q-007)`** → `document.ts`'s `CameraState`; **`PROVISIONAL(Q-008)`** →
`graph/node.ts`'s `isIllegalNumber`. Answered earlier: Q-001 → D-041, Q-002 → D-040, Q-003 → D-007,
Q-004 → D-039, Q-005, Q-006 → D-025, Q-009 → D-029, Q-010 → D-038. Next free: **Q-011**.

## Gotchas for the next model

- **D-047 covers RANGE expansion only.** A range skips absent and `null` cells; an explicit scalar
  argument and a plain `ReferenceNode` to a missing slot are UNCHANGED and still rejected as
  dangling — pinned by a dedicated test at entry 0046. Do not extend the skip to scalar arguments.
- **`deriveEdges`'s D-047 skip and `readRange`'s D-047 skip are two SEPARATE checks that happen to
  agree, not one shared function.** `deriveEdges` reads `tableObject.slots[...]` directly (no slot
  at all → no edge); `readRange` checks the resolved VALUE (`undefined` from no edge having existed,
  OR an existing slot's value being `null`) → omitted from the flattened list. Entry 0046's
  mutation-test checks proved these are independent: disabling one alone produces a DIFFERENT
  failure set than disabling the other. Keep them that way — do not try to unify them into one
  check spanning both files.
- **A `false && narrowingCondition` mutation-test gate can break TypeScript's control-flow narrowing
  for the REST of that `if` block**, even on lines that look unrelated to the edit — reported as a
  property missing from the wider (pre-narrowed) union type. Entry 0046 hit this gating
  `operation.slot.kind === "formula"`. Prefer gating with a named boolean flag ANDed AFTER an
  already-narrowed condition (`condition && !MUTATION_TEST_FLAG`) instead of `false && condition`.
- **The brief is SILENT on empty cells, and silence is a §6.1 trigger 3, not a licence to decide.**
  Entry 0044 settled it by omission and it cost a REVISE (D-047 fixed it at 0046). When the brief
  says nothing about something load-bearing, raise a `Q-NNN`.
- **State every file you touched in the log entry, comment-only edits included** (0045-REVIEW's
  Finding, re-stated because it is easy to forget under time pressure, not because it recurred).
- **`readRange` runs DURING evaluation and reads `rows`/`cols` — that is only safe because D-046
  makes dimensions `literal`-only.** Do not relax D-046 without re-reading this.
- **`readRange` is OPTIONAL by ruling (0045-REVIEW §7 Q3).** Make it REQUIRED the moment a second
  production caller appears — until then the churn is not worth it.
- **Range placement (`parser.ts`), range DEPENDENCY reporting (`deps.ts`, pre-expansion), range
  EVALUATION (`graph/eval.ts` → `formula/eval.ts`), and range ENUMERATION (`table.ts`) are FOUR
  different concerns.** Do not collapse them.
- **`resolveNonDerivedSlotPaths` is the ONLY sanctioned way to read `nonDerivedSlotPaths`**, and
  **`enumerateTableCellSlotPaths` never inverts a `slotKey`** (D-010).
- **Standing one-liners:** cell-case normalisation happens at exactly one point (D-039) · do not
  "simplify" `IF`/`AND`/`OR` dispatch into a registry (D-029) · one number guard, `finiteResult`
  (D-033) · registry lookup by `Object.hasOwn` (D-034) · `src/engine/` contains no `throw` ·
  one user, justify by correctness and cheapness to change (D-042).
- **Batch discipline:** entry 0044 ran to 1848 lines / 14 files, more than twice the cap, in one
  cycle, and hid a semantic gap inside a green tree. Entry 0046, by contrast, stayed tightly scoped
  to exactly the reviewer's fix list (~335 lines / 3 files) — this is the shape to aim for: small,
  reviewer-directed, fully tested. Prefer stopping at the cap even when no trigger forces it.
- Each PowerShell call is a fresh process; the Bash tool's `npm` is not on PATH — use PowerShell.
