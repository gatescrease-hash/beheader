# 0046 — empty-cell-range-fix
Date: 2026-08-23   Phase: 2   Model: implementer
Previous entry: 0045-REVIEW-phase2   Last review: 0045-REVIEW-phase2 (verdict: REVISE)
Batch: cycle 1 of up to 3 since last review; ~335 lines / 3 files changed so far.

## Declared scope

Exactly the 0045-REVIEW §8 fix list, nothing else: (1) `deriveEdges` skips an enumerated range
cell with no slot (D-047 item 1); (2)-(3) `readRange` omits an absent or `null`-valued cell from
the flattened `Value[]` instead of erroring (D-047 items 2-3); (4) `findIllegalOperationPayloads`
walks a `setSlot`/`createObject` formula payload's AST the same way `findIllegalSlotValues` already
does post-fold (D-048). The resize/creation slice is explicitly NOT this cycle — STATUS.md and
0045-REVIEW §9 both say the fix list goes first, alone.

## Explicitly not in scope

Table creation, row/column insert/delete, the reference-adjustment pass, the `force` flag,
dimension-coherence between a `rows`/`cols` write and the cells that actually exist, and the
dangling-reference message improvement (0045-REVIEW Finding 4 — recorded as a known problem, not
urgent since D-047 removes the common path into it).

## What I did

- **`src/engine/mutation.ts`, `deriveEdges`** — the range-dependency loop now resolves `tableObject`
  first (an explicit `if (tableObject === undefined)` in place of the old ternary, needed so later
  lines can use `tableObject` without TypeScript re-widening it to `GraphObject | undefined`), then,
  for each enumerated cell address, checks `tableObject.slots[slotKey(cellAddress.path)] ===
  undefined` and skips it — no edge at all, not a dangling one. The unresolvable-TABLE fallback
  (entry 0044 Decision 3: one edge from the range's own `start`) is untouched, per the reviewer's
  explicit instruction not to touch it.
- **`src/engine/graph/eval.ts`, `readRange`** — the per-cell loop now skips (`continue`) when the
  resolved value is `undefined` (no slot — matches what `deriveEdges` now does not produce an edge
  for) OR `null` (a slot that exists but is empty), instead of returning `{ error: "#REF", ... }`
  for the whole range on either condition.
- **`src/engine/mutation.ts`, `findIllegalOperationPayloads`** — both the `setSlot` and
  `createObject` arms now additionally check `slot.kind === "formula"` and, if so, run
  `collectIllegalAstLiterals(slot.ast)` (the same function D-031 added for `findIllegalSlotValues`),
  pushing a problem string naming the slot and the offending literal(s) if any are found. Reused the
  existing `name`/`describeUndeclaredSlot` naming each arm already had; no new naming logic needed.
- **Header/doc-comment updates** — `mutation.ts`'s file header (the running per-cycle history
  paragraph, the `deriveEdges` WHAT THIS IS bullet, `validateIntegrity`'s NOT DONE HERE paragraph,
  and both `findIllegalSlotValues`'s and `findIllegalOperationPayloads`'s own doc comments) and
  `graph/eval.ts`'s WHAT THIS IS bullet on `readRange` — all updated to state D-047/D-048 as CLOSED
  rather than open, replacing every stale "disclosed gap" sentence entry 0044 left behind. Checked
  for other stale references via `grep -n "asymmetry\|does NOT yet walk"` — none remained after the
  edit.
- **Tests** — `src/engine/mutation.test.ts` gained two new `describe` blocks at the end of the file
  (nine `it`s total), covering every case 0045-REVIEW §8 required: `SUM` over genuinely absent
  cells; the same over `null`-valued cells, proving the two representations agree; `AVG` dividing by
  the count of non-empty cells, not the range's full span; a range where no cell exists at all
  returning `SUM`'s own zero-argument answer (`0`), not `#REF`; a plain `ReferenceNode` to an absent
  slot still rejected as dangling (pinning D-047's boundary); and four D-048 tests mirroring the
  existing D-025/Q-008-on-payload probes (probe A/F style — an illegal literal a LATER operation in
  the SAME batch overwrites or deletes, plus a buried-literal test and a legal-payload sanity check).

## Decisions I made

1. **Skip check placed as `tableObject.slots[slotKey(cellAddress.path)] === undefined`, reading the
   slot map directly rather than adding a new primitive to `primitives/table.ts`.** `deriveEdges`
   already has `tableObject` in scope from resolving the range's dependency; a table object's slots
   are a plain record exactly like every other object's, so there is nothing table-specific to
   delegate — `enumerateRangeCellAddresses` stays purely about which ADDRESSES are in-bounds
   (D-044/D-046), never about which of them are populated. Kept the two concerns (bounding vs.
   emptiness) in the two different files the reviewer's ruling already assigned them to.
2. **`readRange`'s single `if (value === undefined || value === null) continue;` handles both D-047
   items 2 and 3 in one branch**, rather than two separate checks with two separate comments. They
   are the same rule ("empty is empty, however it's represented") and splitting them would invite
   the two ever disagreeing later. The comment above the branch says so explicitly.
3. **Did not touch `asNumberList` or any scalar-argument path**, per D-047 item 4 and the reviewer's
   explicit "do NOT" — pinned with the new plain-`ReferenceNode`-to-absent-slot test, which still
   fails as dangling exactly as before this cycle.
4. **D-048's two call sites (`setSlot`, `createObject`) each get their own `collectIllegalAstLiterals`
   call rather than factoring out a shared helper.** The two arms already had separate, non-shared
   naming logic (`formatAddress` vs. `describeUndeclaredSlot`) before this cycle; adding a third
   shared helper for just the AST-walk half would split one small piece of duplicated logic out
   while leaving the rest duplicated, which reads worse than the small, obvious duplication now
   sitting next to its `hasIllegalNumber` sibling. Matches the file's existing style at this exact
   spot (the `hasIllegalNumber` check right above each new block is not factored out either).

## Verification (real output)

```
$ npm run typecheck
> tsc --noEmit && tsc --noEmit -p tsconfig.engine.json
(clean, no output)

$ npm test -- --run
 Test Files  15 passed (15)
      Tests  545 passed (545)
```

545/545 — up from 536 at the start of this cycle (9 new tests, all listed above), 0 skipped, 0
`.only` (`grep -rn "\.only(\|\.skip(\|it\.todo(" src` clean).

### Mutation-test checks (D-016)

All four pieces of this fix were temporarily disabled, the affected test file(s) rerun, the
expected named failures confirmed, then reverted. `grep -rn "MUTATION-TEST\|MUTATION_TEST"
src/engine` is clean before and after each check and clean now.

1. **`deriveEdges`'s D-047 item 1 skip disabled** (`mutation.ts`, the slot-existence check wrapped
   in a dead `if (false && ...)`): reran `mutation.test.ts` — **3 named failures**, exactly the
   "genuinely absent cells" `SUM` test, the `AVG` test, and the "no cell exists at all" test. The
   "null-valued cells" test correctly still PASSED — it exercises `readRange`'s skip, not
   `deriveEdges`'s, confirming the two checks are genuinely independent and each test isolates the
   piece it claims to.
2. **`readRange`'s D-047 items 2-3 skip disabled** (`graph/eval.ts`, replaced with an unconditional
   push): reran `mutation.test.ts` + `graph/eval.test.ts` — **4 named failures**, all four of the
   sparse-range `mutation.test.ts` tests (absent cells, null cells, `AVG`, all-empty), each now
   producing a `#TYPE` from a `SUM`/`AVG` argument list containing an `undefined` or unexpected
   entry instead of a clean numeric answer. `graph/eval.test.ts`'s own pre-existing range tests
   (which all populate every cell) correctly kept passing.
3. **`findIllegalOperationPayloads`'s D-048 formula-AST walk disabled** (`mutation.ts`, both arms
   gated behind a `MUTATION_TEST_D048_DISABLED` flag — a literal `false &&` in the `if` condition
   itself broke TypeScript's narrowing of `operation`/`slot` to their formula-carrying variants, so
   a named boolean flag was used instead, declared and later removed alongside the two gated `if`s):
   reran `mutation.test.ts` — **2 named failures**, exactly the two probe-style tests (`setSlot`
   overwritten later in the batch; `createObject` deleted later in the batch). The third D-048 test
   (a buried `-0` literal that is NOT overwritten or deleted) correctly kept PASSING — it survives to
   the post-fold graph, where `findIllegalSlotValues`'s pre-existing D-031 check still catches it,
   proving D-048 closes specifically the payload-only hole and nothing more.

## Acceptance criteria status

Phase 2 criterion (quoted in full at entry 0044 and 0045-REVIEW §4), clause 3: "`SUM(A1:A5)`
recomputes correctly... after inserting a row inside the range" — still **NOT YET**, and this cycle
does not claim otherwise: row insertion itself still does not exist (deferred to the resize/creation
cycle). What THIS cycle closes is the semantic PRECONDITION that clause needs — a range spanning an
empty cell can now be committed and evaluated at all, proven by the new sparse-range tests. The
live-update half of clause 3 was already PASSING (entry 0044); it still is. No other clause's status
changes. §6.1 trigger 1 (a phase criterion claimed complete) does not fire.

## Where I got stuck / what is unfinished

The `false && operation.slot.kind === "formula"` mutation-test gate (check 3 above) produced
TypeScript errors that looked, at first glance, like they had nothing to do with the line I'd
edited — `operation.slot` reported as not existing on `Operation`, several lines below the actual
edit. The cause: gating the discriminant check itself (`operation.slot.kind === "formula"`) behind
`false &&` apparently disrupts TypeScript's narrowing of `operation` for the rest of that `if`
block's body in a way that gating a boolean FLAG instead (`!MUTATION_TEST_D048_DISABLED`, ANDed
after an already-narrowed condition) does not. Worked around it by using a named module-level
`const` flag rather than an inline `false` literal; did not fully track down why the two are
different to TypeScript's checker, since the workaround was fast and the flag was reverted
immediately after the check. Leaving this as a note in case a future `false &&`-style
mutation-test gate hits the same thing — prefer the flag-after-narrowing pattern from the start.

## Open questions raised

None. This cycle implements a review's ruling; it does not raise new ambiguity.

## Review point

**Triggers fired: none this cycle** — the four fix-list items were reviewer-directed, not new
design decisions, and no test EXPECTATION changed (all nine new tests are additions; no existing
assertion was altered or deleted). Batching instead: cycle 1 of up to 3 since 0045-REVIEW-phase2;
diff since last review ~335 lines / 3 files (cap 800/10) — well under.

**REVIEW: NOT NEEDED.** No §6.1 trigger fired (correcting this entry's earlier draft, which hedged
with "RECOMMENDED" — not an available verdict; PROCESS_BRIEF's own triggers are objective and this
cycle does not satisfy any of them, so applying them honestly means saying so plainly rather than
splitting the difference). Batch remains well under cap (1/3 cycles, ~335/800 lines). Proceeding to
the next slice.
