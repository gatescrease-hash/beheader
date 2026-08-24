# STATUS — as of entry 0052-fix-list-both-axis-resize

STATE: GREEN (compiles under both configs, 646/646 tests pass, 0 skipped, 0 `.only`).

**Process state: fix list CLOSED.** 0051-REVIEW-phase2 (verdict REVISE) issued a five-item fix
list; entry 0052 closes all five (three code/test items in `mutation.ts`/`mutation.test.ts`, two
in this file). Not yet re-reviewed — batching under §6.3 is fine, same pattern entries 0049+0050
used before 0051-REVIEW. **The `force`-flag slice ("Next slice" below) starts now.**

Current phase: **2 — Table primitive.** Row/column INSERTION (0047, reviewed 0048, fixed 0049) and
DELETION (0050, reviewed+fix-listed 0051-REVIEW, fix list closed 0052) are both built. The
remaining Phase 2 gap is `delete <table>`'s `force` flag (whole-OBJECT repair) plus §5.1.1/§5.4's
broken-slot REPORT (D-057), which the next slice builds together — see below.

Last review point: **0051-REVIEW-phase2, REVISE** (covering entries 0049 + 0050). Cycles since
last review: **1/3** (entry 0052) · diff since last review: ~180 lines / 2 code files (cap
800/10). Convention: insertions + deletions (settled 0042).

## Next slice — the `force` flag on `delete <table>` (`DeleteObjectOperation`), closing Phase 2's gate

- `DeleteObjectOperation` gains a `force?: boolean` field (widen the union member, per D-020's
  "widen, never restructure" stance). Today it unconditionally takes the REJECT path (§5.1.1
  clause 1) via `validateIntegrity`'s existing dangling-reference check. Phase 2 requires:
  rejected BY DEFAULT (unchanged), and — only when `force` is passed — every inbound reference to
  ANY of the deleted object's slots is rewritten to `#REF` instead, the D-028 `ErrorNode` shape
  row/column deletion already uses.
- **Reuse `repairObjectFormulaAddresses` AS IT STANDS, with different callbacks — D-056.** It is
  already generic over its two callbacks and has no notion of tables, axes, or indices. Whole-object
  repair supplies simpler ones: a `ReferenceNode` naming any slot on the deleted object reports
  `"deleted"`; a `RangeNode` with EITHER endpoint on it reports `"deleted"` entirely (no remaining
  extent to clamp to). Those callbacks live in `mutation.ts`, beside the operation they serve. Do
  NOT add a third `*ObjectFormulaAddresses` helper — settled, not open.
- **Build the broken-slot REPORT in this slice — D-057**, ONE channel serving BOTH repair sites
  (row/column deletion and whole-object `force`), never two. `applyOperation` returns `readonly
  GraphObject[]` and `mutate`'s success arm returns `{ objects, journal }`; widening one of those is
  the load-bearing decision D-057 exists to make deliberately, not accidentally.
- `validateIntegrity`'s dangling-reference check still fires when `force` is NOT passed. When it
  IS, `applyOperation`'s `deleteObject` branch must run the repair pass BEFORE the object is removed
  and BEFORE `validateIntegrity` runs — study `insertTableLine`'s/`deleteTableLine`'s branch shape
  for the established pattern (repair document-wide, unconditionally, no relevance pre-filter).
- This closes Phase 2's gate — §6.1 trigger 1 fires the moment this is claimed complete. Read
  `PROCESS_BRIEF.md` §12 before claiming it.

## Phase 2 acceptance criterion — one clause left

Quoted in full at entry 0044/0045-REVIEW §4. Re-verified at 0051-REVIEW, unchanged by entry 0052:

- Two tables, cross-table formula, live update — **PASSING**.
- Circular reference rejected, including through range-derived edges — **PASSING**.
- `SUM(A1:A5)` recomputes correctly after inserting a row inside the range — **PASSING**.
- Row/column delete with `#REF` repair — **PASSING** (0050; §5.4's separate "reports every slot it
  broke" clause is NOT built — D-057, see Known problems, and is NOT required by this clause).
- `delete <table>` rejected-until-`force` — **NOT YET**. The only remaining clause.

## Built and reviewed

Phase 0 in full (0027-REVIEW) · the formula engine (0037-REVIEW) · `address.ts`'s column
arithmetic, `primitives/table.ts`'s first file (0041-REVIEW) · the dynamic slot family (0043-REVIEW)
· range evaluation wired end-to-end (0044+0046, reviewed 0045/0048) · row/column INSERTION (0047,
reviewed 0048 REVISE, closed 0049) · row/column DELETION (0050) — reviewed 0051-REVIEW-phase2
(REVISE), fix list closed at entry 0052 (**D-053** through **D-058** — see `DECISIONS.md`).

## Not started

The `force` flag on `delete <table>` (see "Next slice") · a table-creation COMMAND (the engine
primitive already suffices via `createObject`) · everything in Phases 3–7.

## Known problems

- **§5.1.1/§5.4's "the command reports every slot it broke" is UNBUILT** for row/column deletion —
  no collector, no report field, `applyOperation` has no channel for one. **D-057** assigns it to
  the `force` slice, ONE channel for both repair sites. Disclosed in `DeleteTableLineOperation`'s
  own doc comment as of entry 0052.
- **Row/column deletion CAN still be REJECTED**, contradicting §5.4's "it proceeds even when other
  objects depend on the deleted cells": the address-repair pass is unbounded while the slot walk is
  extent-bounded, so a reference to an out-of-extent cell slot shifts to an empty position and
  dangles. Reachable only through a raw `setSlot` writing an out-of-extent cell (the coherence gap
  below). **Pinned by a test as of entry 0052** (`mutation.test.ts`, "KNOWN INCOHERENCE" describe
  block). **D-053's companion ruling forbids fixing one side** — insertion has the identical
  divergence (0048-REVIEW case 4); both close together or not at all.
- **A dimension write is not checked for COHERENCE with the cells that exist, in general.** D-046
  settles the KIND; D-053 (entry 0052) makes a resize reject unless BOTH dimensions are literal.
  Still unguarded: (a) a raw `setSlot` writing an INCOHERENT `literal` count, (b) a `setSlot`
  EARLIER IN THE SAME BATCH that changes a table's `rows`/`cols` value/kind AFTER
  `findInvalidTableResizes` has seeded its per-table tracked state.
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

Every ruling in `DECISIONS.md` (D-001 through D-058) is binding without restatement here. Notably
recent: **D-053** (a resize precondition checks the WHOLE extent, both dimensions, not just its own
axis) · **D-054** (deletion has no defensive index clamp, deliberately) · **D-055** (range endpoint
role is decided by VALUE, never AST field or normalisation) · **D-056** (the rewrite/repair helper
pair stays a pair; whole-object repair reuses the repair one, no third helper) · **D-057** (the
repair-report channel is built once, in the `force` slice, serving both repair sites) · **D-058**
(a cycle-history comment names its entry number, never a bare "this cycle"). See `DECISIONS.md`
itself for the full list and every earlier `D-NNN`.

## Live PROVISIONAL tags and open questions

**Zero open questions block any phase.** Still open, blocking nothing: `PROVISIONAL(Q-007)` →
`document.ts`'s `CameraState`; `PROVISIONAL(Q-008)` → `graph/node.ts`'s `isIllegalNumber`. Next
free: **Q-011**. See `OPEN_QUESTIONS.md` for the full answered/open list.

## Gotchas for the next model

- **The REPAIR path's concrete shape to copy: `applyOperation`'s `deleteTableLine` branch,
  `repairAddressesInAst` (`formula/deps.ts`), `repairObjectFormulaAddresses` (`mutation.ts`).** The
  `force`-flag cycle should study this shape rather than re-deriving it (D-056 already settles that
  it is REUSED, not copied).
- **A range endpoint's role is decided by comparing its VALUE against the OTHER endpoint's, never by
  which AST field it occupies** (D-055) — `primitives/table.ts`'s `clampRangeEndpointValue` is the
  reference implementation for any future code walking range endpoints the same way.
- **A precondition check that reads document state must simulate the batch, and when TWO operation
  kinds change the SAME tracked quantity they share ONE simulation** — `findInvalidTableResizes` is
  the standing example (D-050, widened again at entry 0052 for D-053). Extend it, never add a
  parallel `Map`.
- **A `false && narrowingCondition` mutation-test gate breaks TypeScript's control-flow narrowing**
  — use the flag-after-narrowing pattern, or disable the whole boolean-producing expression instead.
  Confirmed FIVE times now (0046, 0047, 0049, 0050, 0052).
- **`shiftCoordinates`/`shiftCoordinatesForDelete` (`primitives/table.ts`) are the ONLY two places
  row/column shift arithmetic lives** (D-051) — never a third call site computing a position
  independently.
- **`applyOperation`'s `insertTableLine`/`deleteTableLine` branches both touch EVERY object in the
  document**, per §5.4. Do not add an "is this object relevant" pre-filter.
- **`readRange` runs DURING evaluation and reads `rows`/`cols` — only safe because D-046 makes
  dimensions `literal`-only.** Do not relax D-046 without re-reading this.
- **`resolveNonDerivedSlotPaths` is the ONLY sanctioned way to read `nonDerivedSlotPaths`**, and
  `enumerateTableCellSlotPaths`/`insertTableLine`/`deleteTableLine` never invert a `slotKey` (D-010).
- **State every file you touched in the log entry, comment-only edits included** — and get the CYCLE
  NUMBER right in source comments, per D-058.
- Each PowerShell call is a fresh process; the Bash tool's `npm`/`npx` resolve directly and don't
  need PowerShell.
