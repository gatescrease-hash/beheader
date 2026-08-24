# STATUS — as of entry 0053-delete-object-force-flag

STATE: GREEN (compiles under both configs, 651/651 tests pass, 0 skipped, 0 `.only`).

**Process state: PHASE 2 ACCEPTANCE CRITERION CLAIMED COMPLETE — REVIEW REQUIRED (§6.1 trigger
1).** Entry 0053 builds the LAST outstanding clause (`delete <table>` rejected-until-`force`) and
D-057's broken-slot report in the same cycle, per D-057's own binding text. **Do not begin Phase 3
work before this gate clears** (PROCESS_BRIEF §12 clause 4) — this is the ONLY item in STATUS.md
right now; there is no "next slice" pending review.

Current phase: **2 — Table primitive, ALL FIVE acceptance clauses now PASSING** (see below).
Row/column INSERTION (0047/0048/0049), DELETION (0050/0051-REVIEW/0052), and whole-object `force`
deletion + the D-057 report channel (0053) are all built.

Last review point: **0051-REVIEW-phase2, REVISE** (covering entries 0049 + 0050). Cycles since
last review: **2/3** (0052, 0053) · diff since last review: ~620 lines / 2 code files (cap
800/10) — irrelevant here: §6.1 trigger 1 (phase gate) fires regardless of the cap. Convention:
insertions + deletions (settled 0042).

## Phase 2 acceptance criterion — ALL CLAUSES PASSING, gate ready for review

Quoted in full at entry 0044/0045-REVIEW §4.

- Two tables, cross-table formula, live update — **PASSING**.
- Circular reference rejected, including through range-derived edges — **PASSING**.
- `SUM(A1:A5)` recomputes correctly after inserting a row inside the range — **PASSING**.
- Row/column delete with `#REF` repair — **PASSING** (0050). §5.4's "reports every slot it broke"
  clause is now BUILT too (D-057, entry 0053) — see `MutationResult.brokenSlots`.
- `delete <table>` rejected-until-`force` — **PASSING (entry 0053)**. REJECT half unchanged since
  cycle 0022 (`validateIntegrity`'s dangling-reference check); force half reuses
  `repairObjectFormulaAddresses` (D-056) with new whole-object callbacks
  (`repairReferenceForDeletedObject`/`repairRangeForDeletedObject`, `mutation.ts`). Demonstrated by
  `mutation.test.ts`'s "DeleteObjectOperation's `force` flag" describe block (5 tests: reject
  default, repair a reference, repair a range endpoint, no-dependents no-op, dedup).

## Built and reviewed

Phase 0 in full (0027-REVIEW) · the formula engine (0037-REVIEW) · `address.ts`'s column
arithmetic, `primitives/table.ts`'s first file (0041-REVIEW) · the dynamic slot family (0043-REVIEW)
· range evaluation wired end-to-end (0044+0046, reviewed 0045/0048) · row/column INSERTION (0047,
reviewed 0048 REVISE, closed 0049) · row/column DELETION (0050) — reviewed 0051-REVIEW-phase2
(REVISE), fix list closed at entry 0052 (**D-053** through **D-058**).

## Built this batch, not yet reviewed

Entry 0053: `DeleteObjectOperation.force?: boolean` · `applyOperation`'s widened `deleteObject`
branch (repair-then-filter under `force`) · `repairReferenceForDeletedObject`/
`repairRangeForDeletedObject` (whole-object callbacks, `mutation.ts`) · `repairObjectFormulaAddresses`
widened to also return `brokenSlots` · new `resolveSlotPathForKey` (schema-forward path recovery for
a report `Address`, never a `slotKey` inversion — D-010) · `MutationResult.brokenSlots`, deduped via
`dedupeAddresses`. No new `DECISIONS.md` entries — this cycle only APPLIES D-056/D-057, it does not
extend them; nothing ambiguous was found.

## Not started

A table-creation COMMAND (the engine primitive already suffices via `createObject`) · everything in
Phase 3 onward (canvas, camera, geometry, command line — cannot start until this gate clears) ·
Phases 4–7.

## Known problems

- **Row/column deletion CAN still be REJECTED**, contradicting §5.4's "it proceeds even when other
  objects depend on the deleted cells": the address-repair pass is unbounded while the slot walk is
  extent-bounded, so a reference to an out-of-extent cell slot shifts to an empty position and
  dangles. Reachable only through a raw `setSlot` writing an out-of-extent cell. **Pinned by a test**
  (`mutation.test.ts`, "KNOWN INCOHERENCE" describe block, entry 0052). **D-053's companion ruling
  forbids fixing one side** — insertion has the identical divergence (0048-REVIEW case 4); both
  close together or not at all. **Does NOT affect `delete <table> force`** — its repair callbacks
  are pure object-identity checks, no extent/shifting involved.
- **A dimension write is not checked for COHERENCE with the cells that exist, in general.** D-046
  settles the KIND; D-053 makes a resize reject unless BOTH dimensions are literal. Still unguarded:
  (a) a raw `setSlot` writing an INCOHERENT `literal` count, (b) a `setSlot` EARLIER IN THE SAME
  BATCH that changes a table's `rows`/`cols` value/kind AFTER `findInvalidTableResizes` has seeded
  its per-table tracked state.
- **No bound on how large `rows`/`cols` may be set** via a raw `setSlot`.
- **The dangling-reference message names the DEPENDENT, not the missing SOURCE**, and repeats once
  per missing cell (0045-REVIEW Finding 4, carried).
- **D-022's bounded-correctness claim does not hold for `table`** — narrowed/accepted at
  0043-REVIEW §7 Q1. Do not "fix" it; the pinning test stays as a tripwire.
- **`describeValueType` is duplicated verbatim** in `functions.ts` and `eval.ts` (0037-REVIEW
  Finding 4, carried).
- **`rewriteObjectFormulaAddresses`/`repairObjectFormulaAddresses` walk `formula`-kind slots only**
  — total TODAY, but §5.4 requires the pass to cover text boxes too once Phase 4 lands (block-tree
  content, a different AST shape). Do not build for it now; do not forget it.
- **Carried unchanged:** `camera` has no WRITE-side guard (D-027) · journal STRUCTURE deliberately
  unvalidated beyond `Array.isArray` · `lexer.ts`'s two disclosed edge cases · §5.11's `style` field
  · `nextObjectId` reconciliation · `noUnusedLocals` off · recursion depth.

## Settled — do not re-raise

Every ruling in `DECISIONS.md` (D-001 through D-058) is binding without restatement here. See that
file for the full list; nothing in entry 0053 required a new one.

## Live PROVISIONAL tags and open questions

**Zero open questions block any phase.** Still open, blocking nothing: `PROVISIONAL(Q-007)` →
`document.ts`'s `CameraState`; `PROVISIONAL(Q-008)` → `graph/node.ts`'s `isIllegalNumber`. Next
free: **Q-011**. See `OPEN_QUESTIONS.md` for the full answered/open list.

## Gotchas for the next model

- **Phase 3 does not start until this gate clears (PROCESS_BRIEF §12).** If you are reading this as
  the implementer and no review verdict for entry 0053 exists yet, your only legal move is to wait
  or work something that is not phase-gated.
- **D-057's report shape: `Address[]`, recovered via schema-forward resolution
  (`resolveSlotPathForKey`), never by inverting a `slotKey` (D-010).** Any FUTURE repair site that
  needs to report a broken slot should call `repairObjectFormulaAddresses` (widened, generic over
  its callbacks) rather than reinventing tracking — the per-slot `broke` flag pattern in that
  function is the reference shape.
- **A range endpoint's role is decided by comparing its VALUE against the OTHER endpoint's, never by
  which AST field it occupies** (D-055) — `primitives/table.ts`'s `clampRangeEndpointValue` is the
  reference implementation.
- **A precondition check that reads document state must simulate the batch, and when TWO operation
  kinds change the SAME tracked quantity they share ONE simulation** — `findInvalidTableResizes` is
  the standing example (D-050, widened again at entry 0052 for D-053).
- **`applyOperation`'s `insertTableLine`/`deleteTableLine`/`deleteObject`-with-`force` branches all
  touch EVERY object in the document**, per §5.1.1/§5.4. Do not add an "is this object relevant"
  pre-filter.
- **`resolveNonDerivedSlotPaths` is the ONLY sanctioned way to read `nonDerivedSlotPaths`**, and no
  function in this file inverts a `slotKey` (D-010) — forward-resolve and match instead.
- **State every file you touched in the log entry, comment-only edits included** — and get the CYCLE
  NUMBER right in source comments, per D-058.
- Each PowerShell call is a fresh process; the Bash tool's `npm`/`npx` resolve directly and don't
  need PowerShell.
