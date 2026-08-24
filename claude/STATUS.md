# STATUS — as of entry 0048-REVIEW-phase2

STATE: GREEN (compiles under both configs, 575/575 tests pass, 0 skipped, 0 `.only` — re-verified
by the reviewer, not taken from the log).

**Process state: REVIEWED. Verdict REVISE — a three-item fix list at 0048-REVIEW-phase2 §8 is the
next slice, before row/column DELETION.** The batch cap and §6.1 trigger 3 that entry 0047 raised
are both cleared; the review has landed.

Current phase: **2 — Table primitive.** Row/column INSERTION is built and now reviewed (0047,
reviewed at 0048); the DELETE half (REPAIR path, `force` flag) is not built.
Last review point: **0048-REVIEW-phase2, REVISE** (covering entries 0046 + 0047).
Cycles since last review: **0/3** · diff since last review: 0 lines (reviewer's comment-only edits
excluded).
Convention: insertions + deletions (settled 0042).

## Next slice — 0048-REVIEW's fix list. Read that entry's §4 and §5 before touching the code.

Three fixes, all in `primitives/table.ts` / `mutation.ts`, all with tests named in §8:

1. **`insertTableLine` must preserve every slot it does not own (D-049).** It currently rebuilds
   `slots` from scratch — `rows`, `cols`, and in-extent cells — and silently DELETES everything
   else. Verified reachable today (an unrecognised literal slot; an out-of-extent cell; a
   formula-dimensioned table losing all cells while `rows` resets to `literal 1`). Build the new
   record FROM `object.slots`, removing only the cell keys being moved.
2. **`findInvalidTableResizes` must simulate the batch left-to-right (D-050).** It validates every
   operation against PRE-BATCH state, which falsely REJECTS a legal two-insert batch (`[insert at
   1, insert at 4]` on a 2-row table). Track each target's `{rows, cols}` through the check the way
   the existence check already tracks `survivingIds` — the same loop also closes the disclosed
   same-batch-`createObject` gap, whose disclosure paragraphs then come OUT of both doc comments.
3. **Reject an insert into a table whose `rows`/`cols` is not `literal`** (naming D-046), instead of
   silently resetting the dimension and dropping the cells.

## Then — the DELETE half, which closes Phase 2's gate

- Row/column **deletion**, taking the §5.1.1 **REPAIR** path, not rejection: every inbound reference
  to the deleted row/column becomes a `#REF` `ErrorNode` (D-028) at that position — including
  references from OTHER tables and future text boxes — and every broken slot is reported. A range
  whose endpoint was deleted clamps to the remaining extent; a range deleted entirely becomes
  `#REF`. Its own `Operation` kind, own precondition check, own apply branch — **D-051**, do not
  retrofit `InsertTableLineOperation`.
- **Read D-052's forward note first.** `rewriteAddressesInAst`'s `(Address) => Address` signature
  CANNOT express deletion's repair: `#REF` replacement is a NODE-level rewrite and range clamping
  needs both endpoints at once. Deletion needs a SECOND, node-level walk in `formula/deps.ts`, not a
  widened callback on the existing one. Design that up front.
- The `force` flag on `delete <table>`: today `DeleteObjectOperation` unconditionally takes the
  REJECT path (§5.1.1 clause 1). Phase 2 requires rejected BY DEFAULT and succeeding (repairing
  dependents to `#REF`) when `force` is passed — a new field on `DeleteObjectOperation` (widen the
  union, per Q-005/D-020) and a REPAIR code path that exists nowhere in this codebase yet.

## Phase 2 acceptance criterion — PARTIAL, one clause left

Quoted in full at entry 0044/0045-REVIEW §4. Clause status, all re-verified at 0048-REVIEW:

- Two tables, cross-table formula, live update — **PASSING**.
- Circular reference rejected, including through range-derived edges — **PASSING**.
- `SUM(A1:A5)` recomputes correctly after inserting a row inside the range — **PASSING** (0047,
  accepted at 0048-REVIEW §1: the test asserts the STORED range widened to `A1:A6`, that the empty
  new row leaves the sum unchanged (D-047), and that setting the new row's cell moves it live).
- Row/column delete with `#REF` repair, `delete <table>` rejected-until-`force` — **NOT YET**. The
  only remaining clause. The gate review happens when it lands.

## Built and reviewed

Phase 0 in full (0027-REVIEW) · the full formula engine, `formula/ast.ts` … `formula/eval.ts`
(0037-REVIEW) · `address.ts`'s column arithmetic and cell normalisation, D-039/D-043, plus
`primitives/table.ts`'s first file (0041-REVIEW) · the dynamic slot family
(`NonDerivedSlotPathGroup`, `resolveNonDerivedSlotPaths`, `TABLE_SCHEMA`,
`enumerateTableCellSlotPaths`, D-046) (0043-REVIEW) · range evaluation wired end-to-end, the three
temporary bridges deleted, D-045/D-031/D-047/D-048 (0044+0046, reviewed 0045 and 0048) · row/column
INSERTION: `InsertTableLineOperation`, `insertTableLine`/`getTableDimensions`/
`shiftCellAddressForInsert`/`shiftCoordinates`, `rewriteAddressesInAst`,
`rewriteObjectFormulaAddresses`, `findInvalidTableResizes` (0047, reviewed 0048 — **REVISE**, the
three fixes above outstanding; the DESIGN is confirmed, the slot bookkeeping is not).

## Not started

Row/col DELETE · its REPAIR path · the `force` flag · a table-creation COMMAND (the engine
primitive already suffices via `createObject`) · everything in Phases 3–7.

## Known problems

- **The three 0048-REVIEW fix-list items above** are known defects in committed code, not
  hypotheticals. Until fixed: a row insert can silently delete a table slot it does not recognise,
  and a legal multi-insert batch is rejected.
- **`rewriteObjectFormulaAddresses` walks `formula`-kind slots only** — total TODAY (a `formula`
  slot's `ast` is the only stored AST), but §5.4 requires the adjustment pass to cover text boxes,
  and Phase 4 stores text content as a block tree in a different shape. The pass silently stops
  being total the day text lands (0048-REVIEW §9). Do not build for it now; do not forget it.
- **A dimension write is not checked for COHERENCE with the cells that exist.** D-046 settles the
  KIND; a raw `setSlot` on a *literal* `rows`/`cols` can still disagree with actual cell slots.
  `insertTableLine` is the SANCTIONED way to grow a table; a raw `setSlot` remains un-guarded. Fix 3
  narrows this where it is now reachable; closing it in general is the deletion cycle's call.
- **No bound on how large `rows`/`cols` may be set** via a raw `setSlot`.
- **The dangling-reference message names the DEPENDENT, not the missing SOURCE**, and repeats once
  per missing cell (0045-REVIEW Finding 4, carried). 0048-REVIEW §4 case 4 is a fresh example of how
  this misleads — worth fixing when next touched.
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
  D-039 · bijective base-26 columns · D-043 · D-044 · D-045 · D-046 · D-047 · D-048 · **D-049** ·
  **D-050** · **D-051** (insert/delete are separate `Operation` kinds; `axis` stays unified) ·
  **D-052** (every total `FormulaAst` walk lives in `formula/deps.ts`) ·
  `enumerateRangeCellAddresses` returns `Address[]` · the unresolvable-table fallback stays ·
  `readRange` stays OPTIONAL until a 2nd production caller · dimensions stay SLOTS · the
  `static`/`dynamic` union stays · D-040/D-041 (Phase 3) · D-042 · everything
  0029/0032/0035/0041/0043/0045/0048-REVIEW listed settled.

## Live PROVISIONAL tags and open questions

**Zero open questions block any phase.** Entries 0046/0047 raised none; 0047's three reviewer
questions are answered as D-050/D-051/D-052. Still open, blocking nothing: **`PROVISIONAL(Q-007)`**
→ `document.ts`'s `CameraState`; **`PROVISIONAL(Q-008)`** → `graph/node.ts`'s `isIllegalNumber`.
Answered earlier: Q-001 → D-041, Q-002 → D-040, Q-003 → D-007, Q-004 → D-039, Q-005, Q-006 → D-025,
Q-009 → D-029, Q-010 → D-038. Next free: **Q-011**.

## Gotchas for the next model

- **A mutation that rebuilds an object's `slots` must start FROM the existing slots (D-049).** The
  0047 defect was not a typo — it is what "build the record from what I know about" always does to
  slots you have not thought of yet. Phase 3's `origin.x` on a table is the one waiting to be
  deleted by it.
- **A precondition check that reads document state must simulate the batch (D-050).** Pre-batch
  state both misses illegal operations and rejects legal ones, and only the first of those is
  rescuable by a downstream clamp.
- **A `false && narrowingCondition` mutation-test gate breaks TypeScript's control-flow narrowing**
  for the rest of that block, sometimes even for code ABOVE the gate. Use the flag-after-narrowing
  pattern (`condition && !MUTATION_TEST_FLAG`, a named `const`) — confirmed twice now (0046, 0047).
- **`shiftCoordinates` (`primitives/table.ts`) is the ONE place row/column shift arithmetic lives**
  (D-051). Both the cell-SLOT shift and the formula-REFERENCE shift call it; deletion's arithmetic
  joins it there. Never a second call site, or the two can silently disagree about where row N goes.
- **`applyOperation`'s `insertTableLine` branch touches EVERY object in the document**, per §5.4
  ("other tables and text boxes may point into it"). Do not add an "is this object relevant"
  pre-filter — `shiftCellAddressForInsert` already answers that, and a pre-filter would be a second
  place the same answer could drift.
- **D-047 covers RANGE expansion only.** A range skips absent and `null` cells; an explicit scalar
  argument and a plain `ReferenceNode` to a missing slot are UNCHANGED and still rejected as
  dangling.
- **`readRange` runs DURING evaluation and reads `rows`/`cols` — only safe because D-046 makes
  dimensions `literal`-only.** Do not relax D-046 without re-reading this. `insertTableLine`
  re-asserts `literal` on both dimension slots — keep that, but per fix 3 it must REFUSE a
  non-literal dimension rather than overwrite it.
- **`readRange` is OPTIONAL by ruling (0045-REVIEW §7 Q3).** Make it REQUIRED the moment a second
  production caller appears.
- **Range placement (`parser.ts`), range DEPENDENCY reporting (`deps.ts`, pre-expansion), range
  EVALUATION (`graph/eval.ts` → `formula/eval.ts`), range ENUMERATION (`table.ts`), and address
  REWRITING (`deps.ts`) are FIVE different concerns.** Do not collapse them.
- **`resolveNonDerivedSlotPaths` is the ONLY sanctioned way to read `nonDerivedSlotPaths`**, and
  **`enumerateTableCellSlotPaths`/`insertTableLine` never invert a `slotKey`** (D-010) — both
  generate candidate paths from known dimensions and forward-look them up instead.
- **State every file you touched in the log entry, comment-only edits included** — and get the CYCLE
  NUMBER right in source comments. 0047 attributed 15 comment sites to the wrong entry; the reviewer
  corrected them (0048-REVIEW §7). Those comments are how the next model dates a decision.
- **Standing one-liners:** cell-case normalisation happens at exactly one point (D-039) · do not
  "simplify" `IF`/`AND`/`OR` dispatch into a registry (D-029) · one number guard, `finiteResult`
  (D-033) · registry lookup by `Object.hasOwn` (D-034) · `src/engine/` contains no `throw` ·
  one user, justify by correctness and cheapness to change (D-042).
- **Batch discipline:** the cap is cumulative SINCE LAST REVIEW, not per-cycle. 0046+0047 were each
  individually well scoped (~335 and ~812 lines) and together blew through it. Check the running
  total, not just this cycle's diff.
- Each PowerShell call is a fresh process; the Bash tool's `npm` is not on PATH — use PowerShell.
