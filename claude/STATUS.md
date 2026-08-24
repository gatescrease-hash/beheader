# STATUS — as of entry 0049-insertion-fix-list

STATE: GREEN (compiles under both configs, 589/589 tests pass, 0 skipped, 0 `.only`).

**Process state: REVIEW NOT NEEDED — the 0048-REVIEW fix list is CLOSED (D-049, D-050, fix 3).**
No `PROCESS_BRIEF.md` §6.1 trigger fired this cycle and the batch is well under cap. The
implementer chose to STOP here anyway rather than start the DELETE slice in the same cycle — see
"Next slice" below for why, and entry 0049's own "Review point" section for the full reasoning.
This is a judgment call, not a block: starting the delete slice next is fine.

Current phase: **2 — Table primitive.** Row/column INSERTION is built, reviewed, and its fix list
is closed (0047, reviewed 0048, fixed 0049). The DELETE half (REPAIR path, `force` flag) is not
built.
Last review point: **0048-REVIEW-phase2, REVISE** (covering entries 0046 + 0047; its fix list is
now closed by entry 0049, not yet re-reviewed).
Cycles since last review: **1/3** · diff since last review: ~462 lines / 4 files (cap 800/10).
Convention: insertions + deletions (settled 0042).

## Next slice — row/column DELETION, which closes Phase 2's gate

Read entry 0047's three reviewer questions (now answered as D-050/D-051/D-052) and
0048-REVIEW-phase2 §6/§9 before starting — they bear directly on how deletion's `Operation`(s)
should be shaped.

- Row/column **deletion**, taking the §5.1.1 **REPAIR** path, not rejection: every inbound
  reference to the deleted row/column becomes a `#REF` `ErrorNode` (D-028) at that position —
  including references from OTHER tables and future text boxes — and every broken slot is
  reported. A range whose endpoint was deleted clamps to the remaining extent; a range deleted
  entirely becomes `#REF`. Its own `Operation` kind, own precondition check, own apply branch —
  **D-051**, do not retrofit `InsertTableLineOperation`. This is the FIRST real use of the
  §5.1.1 REPAIR path anywhere in this codebase — nothing to copy from, design it from the brief.
- **Read D-052's forward note first.** `rewriteAddressesInAst`'s `(Address) => Address` signature
  CANNOT express deletion's repair: `#REF` replacement is a NODE-level rewrite and range clamping
  needs both endpoints at once. Deletion needs a SECOND, node-level walk in `formula/deps.ts`, not
  a widened callback on the existing one. Design that up front.
- The `force` flag on `delete <table>`: today `DeleteObjectOperation` unconditionally takes the
  REJECT path (§5.1.1 clause 1). Phase 2 requires rejected BY DEFAULT and succeeding (repairing
  dependents to `#REF`) when `force` is passed — a new field on `DeleteObjectOperation` (widen the
  union, per Q-005/D-020) and a REPAIR code path that exists nowhere in this codebase yet.
- This is a genuinely larger, more design-heavy slice than 0047/0049 — expect it to trigger
  `PROCESS_BRIEF.md` §6.1 (a brief-silent design decision on load-bearing files, at minimum) partway
  through. That is expected, not a sign something went wrong; stop and log honestly when it does.

## Phase 2 acceptance criterion — PARTIAL, one clause left

Quoted in full at entry 0044/0045-REVIEW §4. Clause status, re-verified at 0048-REVIEW, unchanged
by entry 0049 (re-run only, nothing in this cycle touched these paths):

- Two tables, cross-table formula, live update — **PASSING**.
- Circular reference rejected, including through range-derived edges — **PASSING**.
- `SUM(A1:A5)` recomputes correctly after inserting a row inside the range — **PASSING** (0047,
  accepted at 0048-REVIEW §1).
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
`rewriteObjectFormulaAddresses`, `findInvalidTableResizes`, D-051/D-052 (0047, reviewed 0048 —
REVISE, three fixes required).

## Built this batch, NOT YET reviewed (entry 0049)

- **D-049**: `insertTableLine` (`primitives/table.ts`) now preserves every slot it does not own —
  builds `slots` from `object.slots` in full, removing only the in-extent cell keys being moved.
- **D-050**: `findInvalidTableResizes` (`mutation.ts`) now simulates the batch left-to-right (a
  `Map<objectId, TrackedTableState>`), closing both a verified false-reject (two same-table
  inserts in one batch) and the previously disclosed same-batch-`createObject` false-accept.
- **Fix 3** (naming D-046): the same function now rejects an `insertTableLine` whose targeted
  dimension is not `literal`, via new `isTableDimensionResizable` (`primitives/table.ts`).

## Not started

Row/col DELETE · its REPAIR path · the `force` flag · a table-creation COMMAND (the engine
primitive already suffices via `createObject`) · everything in Phases 3–7.

## Known problems

- **`rewriteObjectFormulaAddresses` walks `formula`-kind slots only** — total TODAY (a `formula`
  slot's `ast` is the only stored AST), but §5.4 requires the adjustment pass to cover text boxes,
  and Phase 4 stores text content as a block tree in a different shape. The pass silently stops
  being total the day text lands (0048-REVIEW §9). Do not build for it now; do not forget it.
- **A dimension write is not checked for COHERENCE with the cells that exist, in general.** D-046
  settles the KIND; fix 3 (entry 0049) now also rejects an `insertTableLine` against a non-literal
  dimension. What remains unguarded: (a) a raw `setSlot` writing an INCOHERENT `literal` count
  (disagreeing with actual cell slots), and (b) a `setSlot` EARLIER IN THE SAME BATCH that changes
  a table's `rows`/`cols` value or kind AFTER `findInvalidTableResizes` has already seeded its
  per-table tracked state for that table — entry 0049's own disclosed residual gap, reached
  through the new D-050 tracking rather than a new hole. Closing either in general is the deletion
  cycle's business.
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
  D-039 · bijective base-26 columns · D-043 · D-044 · D-045 · D-046 · D-047 · D-048 · D-049 ·
  D-050 · D-051 (insert/delete are separate `Operation` kinds; `axis` stays unified) ·
  D-052 (every total `FormulaAst` walk lives in `formula/deps.ts`) ·
  `enumerateRangeCellAddresses` returns `Address[]` · the unresolvable-table fallback stays ·
  `readRange` stays OPTIONAL until a 2nd production caller · dimensions stay SLOTS · the
  `static`/`dynamic` union stays · D-040/D-041 (Phase 3) · D-042 · everything
  0029/0032/0035/0041/0043/0045/0048-REVIEW listed settled.

## Live PROVISIONAL tags and open questions

**Zero open questions block any phase.** Entry 0049 raised none. Still open, blocking nothing:
**`PROVISIONAL(Q-007)`** → `document.ts`'s `CameraState`; **`PROVISIONAL(Q-008)`** →
`graph/node.ts`'s `isIllegalNumber`. Answered earlier: Q-001 → D-041, Q-002 → D-040, Q-003 →
D-007, Q-004 → D-039, Q-005, Q-006 → D-025, Q-009 → D-029, Q-010 → D-038. Next free: **Q-011**.

## Gotchas for the next model

- **A mutation that rebuilds an object's `slots` must start FROM the existing slots (D-049).**
  Confirmed by entry 0049's own mutation-test: reverting to a fresh-record rebuild instantly
  breaks all three of the tests written to defend it. Phase 3's `origin.x` on a table is still the
  next thing waiting to exercise this for real.
- **A precondition check that reads document state must simulate the batch (D-050).** Pre-batch
  state both misses illegal operations and rejects legal ones, and only the first of those is
  rescuable by a downstream clamp. `findInvalidTableResizes`'s `TrackedTableState` map
  (`mutation.ts`) is the second time this pattern has been needed (`survivingIds` was the first);
  reuse the shape again rather than re-deriving it a third time.
- **A "simulate the batch" tracker only needs to track what its OWN checks can change.**
  `findInvalidTableResizes`'s tracked `{rows, cols}` only updates in response to `insertTableLine`
  operations, not `setSlot` — deliberately narrower than a full batch fold. Extending it to also
  watch `setSlot` mid-batch is real, disclosed, additional scope (see Known Problems), not an
  oversight — don't "fix" it without deciding that's worth the cost first.
- **A `false && narrowingCondition` mutation-test gate breaks TypeScript's control-flow narrowing**
  for the rest of that block, sometimes even for code ABOVE the gate. Use the flag-after-narrowing
  pattern (`condition && !MUTATION_TEST_FLAG`, a named `const`) — confirmed three times now (0046,
  0047; sidestepped cleanly in 0049 by disabling a whole boolean-producing line instead, e.g.
  `const resizable = true; // MUTATION-TEST`, which never needed the pattern at all — prefer that
  shape when the check IS a single boolean).
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
  re-asserts `literal` on both dimension slots, and as of entry 0049's fix 3,
  `findInvalidTableResizes` REFUSES the insert before that if either dimension is already
  non-`literal` — the precondition and the primitive agree, don't let them drift apart again.
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
- **Batch discipline:** the cap is cumulative SINCE LAST REVIEW, not per-cycle. Check the running
  total, not just this cycle's diff.
- Each PowerShell call is a fresh process; the Bash tool's `npm` is not on PATH — use PowerShell.
