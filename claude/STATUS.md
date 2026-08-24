# STATUS — as of entry 0047-row-column-insertion

STATE: GREEN (compiles under both configs, 575/575 tests pass, 0 skipped, 0 `.only`).

**Process state: REVIEW REQUIRED before the next cycle begins.** Two independent, objective
grounds, both fired by entry 0047: §6.1 trigger 3 (a brief-silent, load-bearing design decision —
the `InsertTableLineOperation` shape, on `mutation.ts`/`primitives/table.ts`, both load-bearing
files) AND the batch cap (~1147 lines / 9 files since 0045-REVIEW-phase2, across entries 0046+0047
combined — cap 800/10). Do not start a new slice until this lands review. Three explicit reviewer
questions are waiting in entry 0047.

Current phase: **2 — Table primitive.** "Wire the formula engine into cell slots. Add reference
adjustment. Still headless." The formula engine is wired (0044+0046) and reference adjustment now
has its INSERT half (0047); the DELETE half (REPAIR path, `force` flag) is not built.
Last review point: **0045-REVIEW-phase2, REVISE** — fix list closed at 0046; entry 0047 (this one)
is NOT yet independently reviewed.
Cycles since last review: **2/3** · diff since last review: **~1147 lines / 9 files** (cap 800/10 —
EXCEEDED, forcing review regardless of trigger 3).
Convention: insertions + deletions (settled 0042).

## Next slice — table resize/creation: the DELETE half (what actually closes Phase 2's gate)

Once reviewed. Row/column INSERTION is done (entry 0047: `insertTableLine`,
`shiftCellAddressForInsert`, `rewriteAddressesInAst`, `InsertTableLineOperation`). What remains:

- Row/column **deletion**, taking the §5.1.1 **REPAIR** path, not rejection: rewrites every inbound
  reference to the deleted row/column into a `#REF` `ErrorNode` (D-028) at that position — including
  references from OTHER tables and future text boxes — and reports every slot it broke. A range
  whose endpoint was deleted clamps to the remaining extent; a range deleted entirely becomes
  `#REF`. This is a GENUINELY DIFFERENT operation from insertion (entry 0047 Decision 2): insertion
  can never orphan a reference, deletion can, so it needs its own `Operation` kind, its own
  precondition story, and its own apply logic — do not try to unify them.
- The `force` flag on `delete <table>` (whole-object deletion): today `DeleteObjectOperation`
  unconditionally takes the REJECT path (§5.1.1 clause 1) when anything depends on it. Phase 2's
  criterion requires `delete <table>` be rejected BY DEFAULT and succeed (repairing dependents to
  `#REF`) when `force` is passed — this needs a new field on `DeleteObjectOperation` (or a widened
  variant, per Q-005/D-020's "widen the union" stance) and a REPAIR code path that does not exist
  anywhere in this codebase yet (only REJECT does, today).
- Read entry 0047's own reviewer questions before starting — Q1/Q2 bear directly on how the
  deletion `Operation`(s) should be shaped, and getting that answered first avoids redesigning
  insertion's sibling from scratch.

## Phase 2 acceptance criterion — PARTIAL, materially closer

Quoted in full at entry 0044/0045-REVIEW §4. Clause status:

- Two tables, cross-table formula, live update — **PASSING**.
- Circular reference rejected, including through range-derived edges — **PASSING**.
- `SUM(A1:A5)` recomputes correctly after inserting a row inside the range — **NOW PASSING**
  (entry 0047), demonstrated end-to-end: the stored range genuinely WIDENS (verified against the
  actual AST, not just the resulting number), the newly-inserted empty row leaves the sum unchanged
  (D-047), and setting the new row's cell updates the sum live.
- Row/column delete with `#REF` repair, `delete <table>` rejected-until-`force` — **NOT YET**. This
  is the ONLY remaining clause, and it is what the next slice closes.

## Built and reviewed (through 0043-REVIEW-phase2)

Phase 0 in full (0027-REVIEW) · the full formula engine, `formula/ast.ts` … `formula/eval.ts`
(Phase 1, 0037-REVIEW) · `address.ts`'s column arithmetic and cell normalisation, D-039/D-043, plus
`primitives/table.ts`'s first file (0041-REVIEW) · the dynamic slot family
(`NonDerivedSlotPathGroup`, `resolveNonDerivedSlotPaths`, `TABLE_SCHEMA`,
`enumerateTableCellSlotPaths`, D-046's `literal`-only dimension guard) (0043-REVIEW).

## Built, reviewed with REVISE, revisions closed (entries 0044 + 0046, reviewed at 0045-REVIEW)

Range evaluation wired end-to-end · the three temporary bridges DELETED · D-045 · D-031 ·
`MIN`/`MAX`'s `.reduce` · `enumerateRangeCellAddresses` returns `Address[]` · D-047 (empty cells
skipped in both edge derivation and evaluation) · D-048 (payload AST literal walk).

## Built this batch, NOT YET reviewed (entry 0047)

Row/column INSERTION: `InsertTableLineOperation`, `primitives/table.ts`'s `insertTableLine`/
`getTableDimensions`/`shiftCellAddressForInsert`, `formula/deps.ts`'s `rewriteAddressesInAst`,
`mutation.ts`'s `applyOperation` insertion branch + `rewriteObjectFormulaAddresses` +
`findInvalidTableResizes`. 30 new tests; 3 mutation-test checks run and reverted (10, 2, and 2
named failures respectively). See entry 0047 for full detail and its 3 open reviewer questions.

## Not started

Row/col DELETE · its REPAIR path · the `force` flag · a table-creation COMMAND (the engine
primitive already suffices via `createObject`) · everything in Phases 3–7.

## Known problems

- **`findInvalidTableResizes` cannot validate an `insertTableLine` targeting a table `createObject`d
  earlier in the SAME batch** (entry 0047, disclosed in both that function's and `insertTableLine`'s
  own doc comments) — the pre-check reads PRE-BATCH `objects`, which does not yet contain a
  same-batch creation. `insertTableLine`'s own clamp is the safety net: worst case is a
  silently-adjusted index, never a corrupted document. Not fixed — no existing caller composes a
  batch this way; revisit when the command line (§5.10) starts generating batches.
- **The dangling-reference message names the DEPENDENT, not the missing SOURCE**, and repeats once
  per missing cell. D-047 removed the common path into it; still worth fixing when next touched
  (0045-REVIEW Finding 4, carried).
- **A dimension write is not checked for COHERENCE with the cells that exist.** D-046 settles the
  KIND (`literal` only); a raw `setSlot` on a *literal* `rows`/`cols` can still disagree with actual
  cell slots. `insertTableLine` is now the SANCTIONED way to grow a table coherently — a raw
  `setSlot` remains possible and remains un-guarded; the resize design's delete half should decide
  whether to close this now or continue disclosing it.
- **No bound on how large `rows`/`cols` may be set** (via a raw `setSlot`, not `insertTableLine`,
  which only ever grows by exactly one). Flag for the resize/creation design.
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

**Zero open questions block any phase.** Entry 0047 raised none (three REVIEWER questions instead,
in its own §-final section — not `Q-NNN`s, since none are brief ambiguities, all are implementer
design choices seeking confirmation). Still open, blocking nothing: **`PROVISIONAL(Q-007)`** →
`document.ts`'s `CameraState`; **`PROVISIONAL(Q-008)`** → `graph/node.ts`'s `isIllegalNumber`.
Answered earlier: Q-001 → D-041, Q-002 → D-040, Q-003 → D-007, Q-004 → D-039, Q-005, Q-006 → D-025,
Q-009 → D-029, Q-010 → D-038. Next free: **Q-011**.

## Gotchas for the next model

- **A `false && narrowingCondition` mutation-test gate breaks TypeScript's control-flow narrowing**
  for the rest of that block, sometimes even for code ABOVE the gate (entry 0047 hit this a second
  time, on `findInvalidTableResizes`, and confirmed the flag-after-narrowing pattern
  (`condition && !MUTATION_TEST_FLAG`, a named `const` flag) sidesteps it cleanly.
- **`shiftCoordinates` (`primitives/table.ts`) is the ONE place row/column shift arithmetic lives.**
  Both the cell-SLOT shift (`insertTableLine`) and the formula-REFERENCE shift
  (`shiftCellAddressForInsert`, called from `mutation.ts`'s reference-adjustment pass) call it —
  never duplicate this arithmetic at a second call site, or the two can silently disagree about
  where row N goes after an insert.
- **Insertion and deletion are NOT the same `Operation` with a flag.** Insertion cannot orphan a
  reference; deletion can (that's the whole reason §5.1.1's REPAIR path exists). Give deletion its
  own `Operation` kind, own precondition check, own apply branch — do not retrofit
  `InsertTableLineOperation`.
- **`applyOperation`'s `insertTableLine` branch touches EVERY object in the document, not just its
  own target** — §5.4 requires this explicitly ("other tables and text boxes may point into it").
  `rewriteObjectFormulaAddresses` is unconditionally called on every object; `shiftAddress` itself
  is what decides whether a given address is even relevant (returns it unchanged, same reference,
  otherwise) — do not add a pre-filter "is this object relevant" step, it would just be a second
  place that same decision could drift out of sync with the first (`shiftCellAddressForInsert`).
- **D-047 covers RANGE expansion only.** A range skips absent and `null` cells; an explicit scalar
  argument and a plain `ReferenceNode` to a missing slot are UNCHANGED and still rejected as
  dangling.
- **State every file you touched in the log entry, comment-only edits included** (0045-REVIEW's
  Finding, still worth repeating).
- **`readRange` runs DURING evaluation and reads `rows`/`cols` — only safe because D-046 makes
  dimensions `literal`-only.** Do not relax D-046 without re-reading this. `insertTableLine`
  re-asserts `literal` on both dimension slots regardless of their prior kind (entry 0047) — a
  resize is exactly the moment to reassert this invariant, not merely preserve whatever kind was
  there before.
- **`readRange` is OPTIONAL by ruling (0045-REVIEW §7 Q3).** Make it REQUIRED the moment a second
  production caller appears.
- **Range placement (`parser.ts`), range DEPENDENCY reporting (`deps.ts`, pre-expansion), range
  EVALUATION (`graph/eval.ts` → `formula/eval.ts`), range ENUMERATION (`table.ts`), and now address
  REWRITING (`deps.ts`'s `rewriteAddressesInAst`) are FIVE different concerns.** Do not collapse
  them.
- **`resolveNonDerivedSlotPaths` is the ONLY sanctioned way to read `nonDerivedSlotPaths`**, and
  **`enumerateTableCellSlotPaths`/`insertTableLine` never invert a `slotKey`** (D-010) — both
  generate candidate paths from known dimensions and forward-look them up instead.
- **Standing one-liners:** cell-case normalisation happens at exactly one point (D-039) · do not
  "simplify" `IF`/`AND`/`OR` dispatch into a registry (D-029) · one number guard, `finiteResult`
  (D-033) · registry lookup by `Object.hasOwn` (D-034) · `src/engine/` contains no `throw` ·
  one user, justify by correctness and cheapness to change (D-042).
- **Batch discipline:** entry 0044 ran to 1848 lines / 14 files in one cycle and hid a semantic gap
  inside a green tree. Entries 0046+0047 stayed individually scoped (~335 and ~812 lines) but
  TOGETHER exceed the cap — a reminder that the cap is cumulative SINCE LAST REVIEW, not per-cycle;
  check the running total, not just this cycle's own diff, before deciding whether to keep going.
- Each PowerShell call is a fresh process; the Bash tool's `npm` is not on PATH — use PowerShell.
