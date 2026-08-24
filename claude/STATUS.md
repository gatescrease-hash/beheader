# STATUS — as of entry 0045-REVIEW-phase2

STATE: GREEN (compiles under both configs, 536/536 tests pass, 0 skipped, 0 `.only`) — but see
below: the build is green and the SEMANTICS are not.

**Process state: entry 0044 reviewed at 0045-REVIEW-phase2 — verdict REVISE.** Four numbered fix
items (0045-REVIEW §8), all small. Two new binding rulings: **D-047** (an empty cell inside a range
is skipped, not an error) and **D-048** (the payload-level AST literal walk). **The next cycle is
the fix list**, not the resize slice — the resize slice would trip over D-047 on its first test.

Current phase: **2 — Table primitive.** "Wire the formula engine into cell slots. Add reference
adjustment. Still headless." The formula engine IS wired (entry 0044); reference adjustment is not.
Last review point: **0045-REVIEW-phase2, REVISE** (cycle 0044).
Cycles since last review: **0/3** · diff since last review: **0 lines / 0 files** (cap 800/10).
Convention: insertions + deletions (settled 0042).

## Next slice — the 0045-REVIEW fix list (start here, one cycle, with tests)

1. **`deriveEdges` (`mutation.ts`): skip an enumerated range cell that has no slot.** D-047 item 1.
   Leave the unresolvable-TABLE fallback (entry 0044 Decision 3) alone — different case, correct.
2. **`readRange` (`graph/eval.ts`): omit an absent cell** from the returned `Value[]` instead of
   returning `#REF` for the whole range. D-047 item 2.
3. **`readRange`: omit a `null`-valued cell**, so both representations of "empty" agree. D-047
   item 3. Do NOT touch `asNumberList` or any scalar path — `SUM(a, null)` stays `#TYPE`.
4. **`findIllegalOperationPayloads` (`mutation.ts`): walk a payload's `formula`-slot AST** via the
   existing `collectIllegalAstLiterals`. D-048.

Required tests are listed in 0045-REVIEW §8 — the sparse-range case was a testing gap as much as a
design one, so the fix does not count as done without them. Read D-047's boundary carefully: it
covers RANGE expansion only.

## Then — table resize/creation (what actually closes Phase 2's gate)

Deferred across four cycles now (0042, 0043-REVIEW, 0044, 0045-REVIEW). This is the cycle.

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
- Whatever creation decides about empty cells, **D-047 guarantees aggregates behave identically
  either way** — that choice is no longer load-bearing for the formula engine.

## Phase 2 acceptance criterion — PARTIAL

Quoted in full at entry 0044 and 0045-REVIEW §4. Clause status:

- Two tables, cross-table formula, live update — **PASSING** (real `mutate()` end-to-end).
- Circular reference rejected, including through range-derived edges — **PASSING**.
- `SUM(A1:A5)` recomputes when a cell within the range changes — **PASSING, but only for a
  FULLY-POPULATED range** (0045-REVIEW Finding 1). "...after inserting a row" — **NOT YET**;
  needs both the D-047 fix and row insert.
- Row/column delete with `#REF` repair, `delete <table>` rejected-until-`force` — **NOT YET**.
  `delete <table>` IS correctly rejected while a range depends on it; there is no `force` flag and
  no row/column deletion to repair.

## Built and reviewed (through 0043-REVIEW-phase2)

Phase 0 in full (0027-REVIEW) · the full formula engine, `formula/ast.ts` … `formula/eval.ts`
(Phase 1, 0037-REVIEW) · `address.ts`'s column arithmetic and cell normalisation, D-039/D-043, plus
`primitives/table.ts`'s first file (0041-REVIEW) · the dynamic slot family
(`NonDerivedSlotPathGroup`, `resolveNonDerivedSlotPaths`, `TABLE_SCHEMA`,
`enumerateTableCellSlotPaths`, D-046's `literal`-only dimension guard) (0043-REVIEW).

## Built, reviewed, REVISIONS PENDING (entry 0044, 0045-REVIEW)

Accepted as built, except the four fix items above: range evaluation wired end-to-end
(`formula/eval.ts`'s `readRange`, `graph/eval.ts`'s real `read`/`readRange` closures, `deriveEdges`
walking `extractDependencies` and expanding a `RangeDependency` via `enumerateRangeCellAddresses`,
D-044-bounded and D-046-safe) · **the three temporary bridges are DELETED**, verified by grep ·
**D-045** · **D-031**'s `collectIllegalAstLiterals` · `MIN`/`MAX`'s `.reduce` ·
`enumerateRangeCellAddresses` returns `Address[]`, closing 0041-REVIEW §5's open signature question.

## Not started

Row/col insert/delete · reference adjustment (§5.4) · table creation (§5.10) · the `force` flag ·
everything in Phases 3–7.

## Known problems

- **A range spanning an empty cell cannot be committed** — 0045-REVIEW Finding 1, ruled D-047,
  **owned by the next cycle's fix list**. Absent cell → document rejected as a dangling reference;
  `null` cell → `#TYPE`. Neither representation of "empty" works today.
- **`findIllegalOperationPayloads` does not walk a payload's stored AST** — ruled D-048, fix item 4.
- **The dangling-reference message names the DEPENDENT, not the missing SOURCE**, and repeats once
  per missing cell (`table_x.B1 references a slot that does not exist; table_x.B1 references...`).
  Scales badly for a range. D-047 removes the common path into it; fix the message when it is next
  touched (0045-REVIEW Finding 4).
- **A dimension write is not checked for COHERENCE with the cells that exist.** D-046 settles the
  KIND (`literal` only); a raw `setSlot` on a *literal* `rows`/`cols` can still disagree with the
  object's actual cell slots. Self-limiting for the dangerous half (D-017 catches a stray
  formula/derived cell); silently orphaning for the harmless half. The resize design owns this.
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
  D-039 · bijective base-26 columns · D-043 · D-044 · D-045 · D-046 · **D-047 empty cells skipped**
  · **D-048 payload ASTs walked** · `enumerateRangeCellAddresses` returns `Address[]` · the
  unresolvable-table fallback stays · `readRange` stays OPTIONAL until a 2nd production caller ·
  dimensions stay SLOTS · the `static`/`dynamic` union stays · D-040/D-041 (Phase 3) · D-042 ·
  everything 0029/0032/0035/0041/0043/0045-REVIEW listed settled.

## Live PROVISIONAL tags and open questions

**Zero open questions block any phase.** Entry 0044 raised no `Q-NNN`; 0045-REVIEW answered all
four of its reviewer questions (§7) and ruled D-047/D-048.

Still open, blocking nothing: **`PROVISIONAL(Q-007)`** → `document.ts`'s `CameraState`;
**`PROVISIONAL(Q-008)`** → `graph/node.ts`'s `isIllegalNumber`. Answered earlier: Q-001 → D-041,
Q-002 → D-040, Q-003 → D-007, Q-004 → D-039, Q-005, Q-006 → D-025, Q-009 → D-029, Q-010 → D-038.
Next free: **Q-011**.

## Gotchas for the next model

- **D-047 covers RANGE expansion only.** A range skips absent and `null` cells; an explicit scalar
  argument and a plain `ReferenceNode` to a missing slot are UNCHANGED. Over-reaching here would
  turn every genuine dangling reference into a silent skip — pin the boundary with a test.
- **The brief is SILENT on empty cells, and silence is a §6.1 trigger 3, not a licence to decide.**
  Entry 0044 settled it by omission and it cost a REVISE. When the brief says nothing about
  something load-bearing, raise a `Q-NNN`.
- **State every file you touched in the log entry, comment-only edits included.** Entry 0044's
  `lexer.ts` edit was correct but undisclosed, which is why its file count was wrong (13 vs 14).
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
  cycle. The §6.1 triggers made it moot, but a slice that large is hard to review well and this one
  hid a semantic gap inside a green tree. Prefer stopping at the cap.
- Each PowerShell call is a fresh process; the Bash tool's `npm` is not on PATH — use PowerShell.
