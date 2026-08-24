# STATUS — as of entry 0051-REVIEW-phase2

STATE: GREEN (compiles under both configs, 643/643 tests pass, 0 skipped, 0 `.only`) — but see
"Known problems": entry 0051-REVIEW found a live data-loss bug (fix 1) that the suite does not
currently catch.

**Process state: REVISE — a five-item fix list is outstanding.** Entries 0049 + 0050 were reviewed
at **0051-REVIEW-phase2, verdict REVISE**. The next cycle is that fix list and nothing else; the
`force`-flag slice does not start until it closes. The batch cap is reset by this review point.

Current phase: **2 — Table primitive.** Row/column **INSERTION** (0047, reviewed 0048, fixed 0049)
and row/column **DELETION** (0050) are both built; deletion is the FIRST real use of §5.1.1's
REPAIR path anywhere in this codebase, and its design was ACCEPTED at 0051-REVIEW (D-054, D-055,
D-056 all confirm entry 0050 as built). The remaining Phase 2 gap is `delete <table>`'s `force`
flag (whole-OBJECT repair) plus §5.1.1/§5.4's broken-slot REPORT, which D-057 assigns to that same
slice.
Last review point: **0051-REVIEW-phase2, REVISE** (covering entries 0049 + 0050, ~1708 lines /
6 files).
Cycles since last review: **0/3** · diff since last review: 0 lines / 0 files (cap 800/10).
Convention: insertions + deletions (settled 0042).

## Next slice — 0051-REVIEW-phase2 §8's fix list (five items), and nothing else

Read entry `claude/entries/0051-REVIEW-phase2.md` §8 in full; it is specific and numbered. In
summary:

1. **Fix 1 is the only code-behaviour item and it is a live bug.** `findInvalidTableResizes` checks
   only the resized axis's dimension for literal-ness, so a ROW resize on a table whose `cols` slot
   is `formula`-kind commits `ok: true` and destroys that slot (AST, cached value, inbound edge),
   replacing it with `literal 0`. Live on BOTH `insertTableLine` and `deleteTableLine`. Reject when
   EITHER dimension is non-literal — **D-053**. One-line condition change plus two tests.
2. Pin and disclose the deletion-can-still-reject route (0051-REVIEW §5) — a test plus a
   `STATUS.md` known problem. **Do not** bound either repair pass by extent: D-053's companion
   ruling forbids a one-sided fix.
3. Record §5.1.1/§5.4's "reports every slot it broke" as unbuilt (**D-057**) — one paragraph in
   `DeleteTableLineOperation`'s doc comment and one known problem. No code.
4. Rewrite this file's own `force`-slice guidance per **D-056** — whole-object repair REUSES
   `repairObjectFormulaAddresses` unchanged with different callbacks; no third helper function, and
   the "where should the new callbacks live" question is settled, not open.
5. Cut this file under PROCESS_BRIEF §2's 150-line budget (it is 226).

### After that — the `force` flag on `delete <table>` (`DeleteObjectOperation`), closing Phase 2's gate

- `DeleteObjectOperation` gains a `force?: boolean` field (widen the union member, per Q-005/D-020's
  "widen, never restructure" stance). Today it unconditionally takes the REJECT path (§5.1.1 clause
  1) via `validateIntegrity`'s existing dangling-reference check. Phase 2 requires: rejected BY
  DEFAULT (unchanged), and — only when `force` is passed — every inbound reference to ANY of the
  deleted object's slots is rewritten to `#REF` instead, the same D-028 `ErrorNode` shape row/column
  deletion now uses.
- **Reuse `repairObjectFormulaAddresses` AS IT STANDS, with different callbacks — D-056.** It is
  already generic over its two callbacks and has no notion of tables, axes, or indices. Whole-object
  repair supplies simpler ones: a `ReferenceNode` naming any slot on the deleted object reports
  `"deleted"`; a `RangeNode` with EITHER endpoint on it reports `"deleted"` entirely (there is no
  remaining extent to clamp to — the whole table is gone). Those callbacks live in `mutation.ts`,
  beside the operation they serve; no per-object-type primitive file owns whole-object deletion.
  Do NOT add a third `*ObjectFormulaAddresses` helper.
- **Build the broken-slot REPORT in this slice — D-057**, one channel serving BOTH repair sites
  (row/column deletion and whole-object `force`), never two. `applyOperation` returns
  `readonly GraphObject[]` and `mutate`'s success arm returns `{ objects, journal }`; widening one
  of those is the load-bearing decision D-057 exists to make you take deliberately.
- `validateIntegrity`'s existing dangling-reference check (§5.1.1 clause 1) still fires when `force`
  is NOT passed. When it IS passed, `applyOperation`'s `deleteObject` branch needs to run the repair
  pass BEFORE the object is removed and BEFORE `validateIntegrity` runs — study `insertTableLine`'s/
  `deleteTableLine`'s branch shape in `applyOperation` for the established pattern (repair
  document-wide, unconditionally, no relevance pre-filter).

## Phase 2 acceptance criterion — one clause left, narrower than before

Quoted in full at entry 0044/0045-REVIEW §4. Clause status, re-verified at 0051-REVIEW:

- Two tables, cross-table formula, live update — **PASSING**.
- Circular reference rejected, including through range-derived edges — **PASSING**.
- `SUM(A1:A5)` recomputes correctly after inserting a row inside the range — **PASSING** (0047,
  accepted at 0048-REVIEW §1).
- Row/column delete with `#REF` repair — **PASSING** (0050; demonstration test confirmed at
  0051-REVIEW §1 and §10). §5.4's separate "reports every slot it broke" clause is NOT built —
  D-057, see Known problems.
- `delete <table>` rejected-until-`force` — **NOT YET**. The only remaining clause. The gate review
  happens when it lands.

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
REVISE, three fixes required, closed 0049: D-049, D-050, fix 3).

## Built and reviewed at 0051-REVIEW-phase2 (entries 0049 + 0050) — REVISE, fix list outstanding

- Entry 0049's fix list (D-049, D-050, fix 3) — see prior STATUS revision for detail, unchanged by
  entry 0050.
- **Entry 0050**: `DeleteTableLineOperation`, `deleteTableLine`/`shiftCoordinatesForDelete`/
  `repairCellAddressForDelete`/`repairRangeEndpointsForDelete`/`clampRangeEndpointValue`
  (`primitives/table.ts`), `repairAddressesInAst` (`formula/deps.ts`, the node-level REPAIR walk
  D-052's forward note called for), `repairObjectFormulaAddresses` (`mutation.ts`),
  `findInvalidTableResizes` widened to simulate insert AND delete together in one left-to-right
  walk. No new `DECISIONS.md` entries yet — three open questions for the reviewer, see entry 0050's
  own "Review point."

## Not started

The `force` flag on `delete <table>` (see "Next slice" above) · a table-creation COMMAND (the
engine primitive already suffices via `createObject`) · everything in Phases 3–7.

## Known problems

- **LIVE BUG (0051-REVIEW §4, fix 1): a ROW resize on a table whose `cols` slot is not `literal`
  destroys that slot.** `findInvalidTableResizes` checks only `operation.axis`'s dimension, but both
  primitives re-assert `literal` on BOTH — so the untouched axis's `formula` slot commits as
  `literal 0`, losing its AST, its value, and its inbound edge, `ok: true`, nothing reported.
  Verified on insertion AND deletion. **D-053.** Fix it before anything else.
- **§5.1.1/§5.4's "the command reports every slot it broke" is UNBUILT** for row/column deletion —
  no collector, no report field, and `applyOperation` returns `readonly GraphObject[]` with no
  channel for one. **D-057** assigns it to the `force` slice, ONE channel for both repair sites.
- **Row/column deletion CAN still be REJECTED**, contradicting §5.4's "it proceeds even when other
  objects depend on the deleted cells" (0051-REVIEW §5): the address-repair pass is unbounded while
  the slot walk is extent-bounded, so a reference to an out-of-extent cell slot shifts to an empty
  position and dangles. Reachable only through the coherence gap below. **D-053's companion ruling
  forbids fixing one side** — insertion and deletion must diverge identically until the coherence
  gap closes for both.
- **`repairObjectFormulaAddresses` and `rewriteObjectFormulaAddresses` are near-duplicate
  functions** (`mutation.ts`) — one calls `repairAddressesInAst`, the other `rewriteAddressesInAst`,
  otherwise structurally identical. **RULED at 0051-REVIEW: D-056 — they stay a pair, and
  whole-object repair reuses `repairObjectFormulaAddresses` unchanged rather than adding a third.**
  Not a problem to fix; listed so nobody re-opens it.
- **`rewriteObjectFormulaAddresses`/`repairObjectFormulaAddresses` both walk `formula`-kind slots
  only** — total TODAY (a `formula` slot's `ast` is the only stored AST), but §5.4 requires the
  adjustment/repair pass to cover text boxes too, and Phase 4 stores text content as a block tree in
  a different shape. Both passes silently stop being total the day text lands (0048-REVIEW §9,
  carried unchanged by entry 0050 — the same gap now exists twice, once per pass). Do not build for
  it now; do not forget it.
- **`deleteTableLine` has NO defensive clamp for an out-of-range index** — a deliberate asymmetry
  with `insertTableLine`, CONFIRMED and ruled **D-054** at 0051-REVIEW (do not add one). Currently
  safe because `findInvalidTableResizes` is the ONLY caller path that reaches it with a real
  operation; a future caller bypassing that check would corrupt the table rather than clamp.
- **A dimension write is not checked for COHERENCE with the cells that exist, in general.** D-046
  settles the KIND; entry 0049's fix 3 rejects a resize (insert OR delete, as of this cycle) against
  a non-`literal` dimension. What remains unguarded: (a) a raw `setSlot` writing an INCOHERENT
  `literal` count, and (b) a `setSlot` EARLIER IN THE SAME BATCH that changes a table's `rows`/`cols`
  value or kind AFTER `findInvalidTableResizes` has already seeded its per-table tracked state —
  unchanged by entry 0050, which only widened the simulation to cover `insertTableLine`/
  `deleteTableLine` together, not arbitrary `setSlot`s.
- **No bound on how large `rows`/`cols` may be set** via a raw `setSlot`.
- **The dangling-reference message names the DEPENDENT, not the missing SOURCE**, and repeats once
  per missing cell (0045-REVIEW Finding 4, carried).
- **D-022's bounded-correctness claim does not hold for `table`** — narrowed and accepted at
  0043-REVIEW §7 Q1. Do not "fix" it; the pinning test stays as a tripwire.
- **`describeValueType` is duplicated verbatim** in `functions.ts` and `eval.ts` (0037-REVIEW
  Finding 4, carried).
- **Carried unchanged:** `camera` has no WRITE-side guard (D-027) · the journal's STRUCTURE is
  deliberately unvalidated beyond `Array.isArray` · `lexer.ts`'s two disclosed edge cases · L-16,
  L-17/L-18/L-14, §5.11's `style` field, `nextObjectId` reconciliation, `noUnusedLocals` off,
  L-6–L-15 cosmetics, recursion depth.
- **SETTLED at 0051-REVIEW:** D-054 · D-055 · D-056 · D-058 (a comment names its ENTRY number,
  never a bare "this cycle").
- **SETTLED, do not re-raise:** D-030 `^` left-assoc · uppercase-only function names · strict
  `CONCAT` · `deps.ts` reports a range PRE-expansion · D-035 · D-033 `-0` · D-037 `%` · D-038 ·
  D-039 · bijective base-26 columns · D-043 · D-044 · D-045 · D-046 · D-047 · D-048 · D-049 ·
  D-050 · D-051 (insert/delete are separate `Operation` kinds; `axis` stays unified) ·
  D-052 (every total `FormulaAst` walk lives in `formula/deps.ts` — `repairAddressesInAst` now
  joins `extractDependencies`/`rewriteAddressesInAst` there, per D-052's own instruction) ·
  `enumerateRangeCellAddresses` returns `Address[]` · the unresolvable-table fallback stays ·
  `readRange` stays OPTIONAL until a 2nd production caller · dimensions stay SLOTS · the
  `static`/`dynamic` union stays · D-040/D-041 (Phase 3) · D-042 · everything
  0029/0032/0035/0041/0043/0045/0048-REVIEW listed settled · deletion is UNCONDITIONAL repair, no
  `force` flag (entry 0050 — that flag belongs to `delete <table>` only) · role in a range endpoint
  pair is decided by VALUE against the other endpoint, never by AST field (entry 0050).

## Live PROVISIONAL tags and open questions

**Zero open questions block any phase.** Entry 0050 raised none in `OPEN_QUESTIONS.md`; its three
reviewer questions were design confirmations and are now **answered — D-054 (no delete clamp),
D-055 (value-based range tie-break, no normalisation), D-056 (the helper pair stays, no third)**. Still open, blocking nothing: **`PROVISIONAL(Q-007)`** →
`document.ts`'s `CameraState`; **`PROVISIONAL(Q-008)`** → `graph/node.ts`'s `isIllegalNumber`.
Answered earlier: Q-001 → D-041, Q-002 → D-040, Q-003 → D-007, Q-004 → D-039, Q-005, Q-006 → D-025,
Q-009 → D-029, Q-010 → D-038. Next free: **Q-011**.

## Gotchas for the next model

- **The REPAIR path is now real and has a concrete shape to copy: `applyOperation`'s
  `deleteTableLine` branch, `repairAddressesInAst` (`formula/deps.ts`), and
  `repairObjectFormulaAddresses` (`mutation.ts`).** The `force`-flag cycle should study this shape
  closely rather than re-deriving it — but see entry 0050's open question 3 about whether to
  collapse the near-duplicate rewrite/repair helper pair before adding a third caller.
- **A range endpoint's role (lower vs. upper bound) must be decided by comparing its VALUE against
  the OTHER endpoint's, never by which AST field ("start"/"end") it occupies** — `parser.ts` accepts
  a reversed range (`A5:A1`) as legal, so `RangeNode.start` is not guaranteed to be the numerically
  smaller endpoint. `primitives/table.ts`'s `clampRangeEndpointValue` is the reference
  implementation; any future code walking range endpoints for a similar "which side is this"
  decision should take the same shape, not assume `start <= end`.
- **A mutation-testing pass can catch real gaps in the SAME cycle's own test coverage, not just
  confirm lines are load-bearing.** Entry 0050's `delta`-direction check (mutation-test 4) initially
  found ZERO failures against a "load-bearing" line — not because the line wasn't load-bearing, but
  because none of the interleaved-batch tests happened to distinguish a wrongly-tracked count from a
  correct one. The fix was to add a genuinely distinguishing test (a second delete beyond what
  remains), not to skip the check or assume the line was dead code.
- **`deleteTableLine` (the primitive) does NOT clamp an out-of-range index — deletion has no
  defensive arm the way insertion's clamp is one.** `findInvalidTableResizes` is the SOLE guard.
  Do not add a "just in case" clamp to `deleteTableLine` without re-reading entry 0050's decision 3
  and its open reviewer question 1 — a silent clamp there would hide a real precondition bug instead
  of surfacing it.
- **A mutation that rebuilds an object's `slots` must start FROM the existing slots (D-049).**
  `deleteTableLine` follows this exactly the way `insertTableLine` does — confirmed by the SAME
  three-test D-049-parity pattern, reused verbatim for the delete side.
- **A precondition check that reads document state must simulate the batch (D-050) — and when TWO
  operation kinds can both change the SAME tracked quantity, they MUST share ONE simulation, not
  one each.** `findInvalidTableResizes` is now the second time this generalisation has mattered
  (first: insert alone vs. pre-batch state; now: insert AND delete interleaved) — extend the
  EXISTING simulation's `forEach` when a third resize-like operation kind appears, never add a
  parallel `Map`.
- **A `false && narrowingCondition` mutation-test gate breaks TypeScript's control-flow narrowing**
  for the rest of that block — use the flag-after-narrowing pattern, or (preferred where the check
  IS a single boolean) disable the whole boolean-producing expression instead — confirmed FOUR times
  now (0046, 0047, 0049, and again sidestepped cleanly in 0050 by disabling whole expressions/lines
  rather than wrapping conditions in `if (false)`).
- **`shiftCoordinates`/`shiftCoordinatesForDelete` (`primitives/table.ts`) are the ONLY two places
  row/column shift arithmetic lives** (D-051, extended by entry 0050) — insert's and delete's
  cell-slot shift and formula-reference shift/repair each call the matching one of these two; never
  a third call site computing a position independently.
- **`applyOperation`'s `insertTableLine`/`deleteTableLine` branches both touch EVERY object in the
  document**, per §5.4. Do not add an "is this object relevant" pre-filter — the address-level
  functions already answer that.
- **D-047 covers RANGE expansion only.** Unchanged by entry 0050 — a range clamp is a DIFFERENT
  operation from D-047's "skip an empty in-bounds cell."
- **`readRange` runs DURING evaluation and reads `rows`/`cols` — only safe because D-046 makes
  dimensions `literal`-only.** Do not relax D-046 without re-reading this.
- **`readRange` is OPTIONAL by ruling (0045-REVIEW §7 Q3).** Make it REQUIRED the moment a second
  production caller appears.
- **Range placement (`parser.ts`), range DEPENDENCY reporting (`deps.ts`, pre-expansion), range
  EVALUATION (`graph/eval.ts` → `formula/eval.ts`), range ENUMERATION (`table.ts`), address
  REWRITING (`deps.ts`), and address REPAIR (`deps.ts`, entry 0050) are SIX different concerns now.**
  Do not collapse them.
- **`resolveNonDerivedSlotPaths` is the ONLY sanctioned way to read `nonDerivedSlotPaths`**, and
  **`enumerateTableCellSlotPaths`/`insertTableLine`/`deleteTableLine` never invert a `slotKey`**
  (D-010) — all three generate candidate paths from known dimensions and forward-look them up.
- **State every file you touched in the log entry, comment-only edits included** — and get the CYCLE
  NUMBER right in source comments (0048-REVIEW caught 15 misattributed sites once already).
- **Standing one-liners:** cell-case normalisation happens at exactly one point (D-039) · do not
  "simplify" `IF`/`AND`/`OR` dispatch into a registry (D-029) · one number guard, `finiteResult`
  (D-033) · registry lookup by `Object.hasOwn` (D-034) · `src/engine/` contains no `throw` ·
  one user, justify by correctness and cheapness to change (D-042).
- **Batch discipline:** the cap is cumulative SINCE LAST REVIEW, not per-cycle. Check the running
  total, not just this cycle's diff — entry 0050 is itself over cap on its own, before even adding
  entry 0049's total.
- Each PowerShell call is a fresh process; the Bash tool's `npm` is not on PATH — use PowerShell
  (or the Bash tool's own shell environment, which DOES resolve `npm`/`npx` directly — verified this
  cycle).
