# 0047 — row-column-insertion
Date: 2026-08-23   Phase: 2   Model: implementer
Previous entry: 0046-empty-cell-range-fix   Last review: 0045-REVIEW-phase2 (verdict: REVISE, fix list closed at 0046)
Batch: cycle 2 of up to 3 since last review; ~1147 lines / 9 files since 0045-REVIEW-phase2 (cap 800/10 — EXCEEDED).

## Declared scope

Row/column **insertion** for the table primitive (§5.4: "rows and columns can be added or
removed"), plus the reference-adjustment pass §5.4 requires it come with ("over every stored AST
in the document... other tables and text boxes may point into it"). This directly targets Phase 2's
still-outstanding acceptance clause: "`SUM(A1:A5)` recomputes correctly after inserting a row inside
the range." Table **creation** needed no new engine work — `createObject` already suffices, as every
test fixture in this project already demonstrates by hand.

## Explicitly not in scope

Row/column **deletion**, its REPAIR path (`#REF` rewriting, range-endpoint clamping), and the
`force` flag on `delete <table>`. Deletion can ORPHAN a reference in a way insertion structurally
cannot — it is a genuinely different mutation with its own validation and apply story, and building
both in one cycle is exactly the over-large-slice mistake entry 0044 made. Deferred to its own
cycle, as STATUS.md's next slice already named.

## What I did

- **`src/engine/formula/deps.ts`** — added `rewriteAddressesInAst(ast, rewrite)`, a sibling to
  `extractDependencies`: the same total walk over every `FormulaAst` shape, REBUILDING the tree with
  every `ReferenceNode.address`/`RangeNode.start`/`end` passed through `rewrite`, instead of
  extracting them into a flat list. `LiteralNode`/`ErrorNode` return unchanged (no address to
  rewrite). Generic over `rewrite` — this file has no notion of tables, rows, or insertion points,
  matching the separation the file header already draws between range PLACEMENT/DEPENDENCY/
  EVALUATION/ENUMERATION (now a fifth: REWRITING).
- **`src/engine/primitives/table.ts`** — four additions:
  - `getTableDimensions(object)`: the public, `literal`-only-safe (D-046) reader wrapping
    `readTableDimension` for both paths, so `mutation.ts` doesn't need a second copy of that guard.
  - `shiftCoordinates` (private): the ONE place the "does row/column N move" arithmetic lives — a
    row/column at or after the insertion index shifts by one; everything else is unchanged.
  - `shiftCellAddressForInsert(address, tableId, axis, index)`: shifts ONE stored `Address` if and
    only if it names a cell on `tableId`, via `shiftCoordinates` — used by `mutation.ts`'s
    reference-adjustment pass, once per `ReferenceNode`/`RangeNode` endpoint in the whole document.
  - `insertTableLine(object, axis, index)`: returns a NEW table object with the relevant dimension
    incremented and every EXISTING populated cell at or after `index` moved to its shifted position
    (via the SAME `shiftCoordinates`), built via `enumerateTableCellSlotPaths`'s sanctioned
    candidate-generation pattern (never inverting a `slotKey`, D-010). The newly inserted line gets
    NO cell slots — an in-extent cell with no slot is exactly D-047's legal "empty" case, which is
    what makes insertion buildable without inventing a placeholder value. `index` is CLAMPED here
    (defensive arm), not rejected — the primary, message-bearing rejection is `mutation.ts`'s
    `findInvalidTableResizes`.
  - `cellAddressToCoordinates` exported (was private) for reuse by `shiftCellAddressForInsert`.
  - Header rewritten: NOT DONE HERE now says insertion landed and names deletion as the remaining
    gap; a new WHAT THIS IS bullet describes `insertTableLine`.
- **`src/engine/mutation.ts`** — the largest set of changes:
  - New `InsertTableLineOperation` (`{ kind: "insertTableLine", objectId, axis, index }`) added to
    the `Operation` union (now four variants).
  - `operationTargetId` gained a branch; the existence-check's message-building ternary was widened
    to an if-chain (it previously assumed exactly two shapes — `deleteObject` or "has an address" —
    which broke under a third non-`address`-bearing variant).
  - New `findInvalidTableResizes(operations, objects)`: rejects an `insertTableLine` naming a
    non-table object or an out-of-range index, run as a THIRD pre-fold check alongside the existing
    existence-check and `findIllegalOperationPayloads`. Discloses one gap in its own doc comment (a
    table `createObject`d earlier in the SAME batch can't be validated against pre-batch `objects`)
    — `insertTableLine`'s own clamp is the safety net for that narrow case.
  - `applyOperation` gained an `insertTableLine` branch: resolves the target, computes ONE shared
    `clampedIndex`, then maps over EVERY object in the document — resizing the target table
    (`insertTableLine`) and rewriting EVERY object's formula ASTs (`rewriteObjectFormulaAddresses`,
    new helper) through the identical `shiftAddress` closure. One shared `clampedIndex` is why the
    cell-slot shift and the reference shift cannot disagree about where row N goes.
  - `mutate` gained the `findInvalidTableResizes` pre-check, mirroring `findIllegalOperationPayloads`'s
    placement and style.
  - Header updated: the running per-cycle history paragraph, `Operation`'s own doc comment (three →
    four variants), and the file's own NOT DONE HERE list (reference adjustment is no longer wholly
    unbuilt — insertion's half is closed, deletion's is not).
- **Tests** — `table.test.ts` (10 new: `getTableDimensions`, `shiftCellAddressForInsert`,
  `insertTableLine` including the clamp and the D-046 formula-dimension interaction), `deps.test.ts`
  (6 new: `rewriteAddressesInAst` over every AST shape, identity-rewrite, never-throws),
  `mutation.test.ts` (12 new: basic row/column insertion, cross-object reference adjustment, a
  reference into a DIFFERENT table left untouched, invalid-target/invalid-index/missing-id
  rejections, batch composition with `setSlot`, and the Phase 2 clause 3 completion test — see
  below).

## Decisions I made

1. **One `InsertTableLineOperation` with an `axis: "row" | "column"` discriminant, not two separate
   Operation kinds.** Row and column insertion are the exact same shape (an index, a table, a
   direction) with symmetric arithmetic (`shiftCoordinates` already takes `axis` as a parameter for
   this reason) — two variants would duplicate every check and apply-branch for no gain. The brief
   names no vocabulary for this at the engine level (§5.10's command examples are Phase 3, not
   engine `Operation`s), so this is a disclosed, reversible naming choice.
2. **Deletion is a SEPARATE operation kind, never this one with a negative index or a `remove`
   flag.** Insertion can never orphan a reference; deletion can (§5.1.1's REPAIR path exists
   specifically for it). Forcing them into one shape would mean `applyOperation`'s insertion branch
   growing REPAIR logic it structurally cannot need, or deletion's REPAIR logic living behind an
   `if` most insertion callers never take. Two kinds keeps each one's precondition/apply/test story
   honest about what it actually does.
3. **`insertTableLine` (the primitive) CLAMPS an invalid index; `findInvalidTableResizes` (the
   pre-check) REJECTS one with a message.** Same split D-045 already established for range
   placement (parser rejects the reachable case; the enumeration function stays defensively safe).
   The one disclosed gap this creates — a same-batch `createObject`-then-`insertTableLine` sequence
   skips the pre-check and falls through to the silent clamp — is written into both functions' doc
   comments and is not fixed here: no existing caller composes a batch that way, and building full
   batch-simulated dimension tracking to cover a scenario nothing exercises is disproportionate to
   this cycle.
4. **`rewriteAddressesInAst` lives in `formula/deps.ts`, not a new file.** It is the exact same
   total-switch-over-`FormulaAst`-shapes `extractDependencies` already has, doing a rebuild instead
   of an extract — the reusable thing is the switch, not any dependency-specific logic, so a new
   file would only split one small piece of already-established AST-walking logic across two
   locations for no benefit.
5. **`applyOperation`'s `insertTableLine` branch rewrites EVERY object's formulas, unconditionally**
   (via `rewriteObjectFormulaAddresses`, which is itself blind to which object it's touching) rather
   than first checking whether an object's formulas could possibly reference the resized table. This
   is Rule 5's "dumbest correct implementation": `shiftAddress` already returns any irrelevant
   address completely unchanged (same reference, verified by a dedicated `shiftCellAddressForInsert`
   test), so a pre-filter would only add a second place that same "is this relevant" decision could
   drift out of sync with the first.

## Verification (real output)

```
$ npm run typecheck
> tsc --noEmit && tsc --noEmit -p tsconfig.engine.json
(clean, no output)

$ npm test -- --run
 Test Files  15 passed (15)
      Tests  575 passed (575)
```

575/575 — up from 545 at the start of this cycle (30 new tests, all listed above), 0 skipped, 0
`.only` (`grep -rn "\.only(\|\.skip(\|it\.todo(" src` clean).

### Mutation-test checks (D-016)

Three pieces disabled, affected test files rerun, expected named failures confirmed, reverted.
`grep -rn "MUTATION-TEST\|MUTATION_TEST" src/engine` clean before, during (checked per-step), and
after.

1. **`shiftCoordinates`'s row/column shift disabled** (`table.ts`, both `if` bodies gated behind a
   dead `false &&`): reran `table.test.ts` + `mutation.test.ts` — **10 named failures**, spanning
   both direct `insertTableLine` unit tests and the end-to-end `mutate()` tests that depend on cells
   actually moving. Confirms the shift arithmetic is load-bearing everywhere it's used.
2. **`rewriteObjectFormulaAddresses`'s rewrite disabled** (`mutation.ts`, replaced with a bare
   pass-through `newSlots[key] = slot`): reran `mutation.test.ts` — **2 named failures**, exactly
   the cross-object reference-shift test and the Phase 2 acceptance-clause widening test. Every
   OTHER insertion test (cell-position shift, invalid-index rejection, etc.) correctly kept passing
   — confirming the cell-slot shift and the reference-adjustment rewrite are genuinely independent
   pieces, same shape as 0046's D-047 checks.
3. **`findInvalidTableResizes`'s range check disabled** (via a named boolean flag, `false &&`
   directly on the condition broke narrowing again — see "Where I got stuck"): reran
   `mutation.test.ts` — **2 named failures**, exactly the two out-of-range-index rejection tests.

## Acceptance criteria status

Phase 2 criterion (quoted in full at entry 0044/0045-REVIEW §4), clause 3: "`SUM(A1:A5)` recomputes
correctly after inserting a row inside the range" — **NOW PASSING, demonstrated end-to-end.** The
new test (`"insertion WIDENS the formula's stored range..."`) builds `SUM(A1:A5)` over a
fully-populated 5-row table, inserts a row inside the range (index 3), confirms the STORED range
widened to `A1:A6` (not merely that the sum happens to still be right), confirms the sum is
UNCHANGED at that point (the new row is empty, D-047), then sets the new row's cell and confirms the
sum updates live — proving the widened range genuinely includes the new cell, not just that nothing
broke. Clause 4 (row/column delete with REPAIR, `delete <table>` rejected-until-`force`) remains
**NOT YET** — deliberately out of scope this cycle. §6.1 trigger 1 does not fire: the phase gate as a
whole is still not claimed complete.

## Where I got stuck / what is unfinished

Hit the SAME `false && narrowingCondition` TypeScript pitfall entry 0046 flagged in STATUS.md's
gotchas — gating `findInvalidTableResizes`'s range check with `if (false) { ... }` broke narrowing
for `operation.axis`/`operation.index` a few lines down, and even made `target` (from an `Array.find`
several lines EARLIER, outside the disabled block) report as possibly-`undefined` again. Went
straight to the flag-after-narrowing pattern (`!MUTATION_TEST_..._DISABLED && condition`) this time
rather than rediscovering the same dead end — the gotcha paid for itself immediately.

The one real gap: `findInvalidTableResizes` cannot validate an `insertTableLine` targeting a table
created earlier in the SAME batch (disclosed in decision 3 and in both functions' doc comments).
Not fixed — no existing caller produces such a batch, and the safety net (`insertTableLine`'s own
clamp) means the worst case is a silently-adjusted index, never a corrupted document.

## Open questions raised

None. Every design choice above was either directly specified by §5.4 or is a disclosed,
reversible engine-level naming/shape decision — none of it forecloses a future direction the brief
or a prior ruling already committed to.

## Review point

**Triggers fired: §6.1 trigger 3** — a brief-silent, load-bearing design decision (the `Operation`
shape for insertion, the clamp/reject split, the same-batch-creation gap) on `mutation.ts` and
`primitives/table.ts`, both load-bearing files. Independently, the **batch cap is exceeded**: ~1147
lines / 9 files since 0045-REVIEW-phase2 across this cycle and 0046 combined (cap 800/10).

**REVIEW: REQUIRED.** Both grounds are objective and both fire on their own — this is not a
judgment call. No further cycle should begin until this lands review.

Questions for reviewer:
  1. Is `InsertTableLineOperation`'s unified `axis` shape (vs. two separate Operation kinds) the
     right call, given deletion will need its OWN kind regardless (decision 2)?
  2. Is the clamp-in-the-primitive / reject-in-the-precheck split (decision 3), including the
     disclosed same-batch-creation gap, acceptable to leave as-is, or does it need closing now —
     same shape as D-045's own primary/defensive split, but worth confirming given `mutation.ts`'s
     `findIllegalOperationPayloads` has an analogous, already-accepted gap (0045-REVIEW §7 Q1
     eventually closed that ONE as D-048; is this one different enough to stay open, or should it
     be ruled on too)?
  3. Does `rewriteAddressesInAst` belong in `formula/deps.ts` (decision 4), or would a dedicated
     file better signal that it is a MUTATION-time transform, not a pure query, despite sharing the
     walk with `extractDependencies`?
