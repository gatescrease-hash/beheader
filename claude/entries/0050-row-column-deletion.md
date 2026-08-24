# 0050 — row-column-deletion
Date: 2026-08-24   Phase: 2   Model: implementer
Previous entry: 0049-insertion-fix-list   Last review: 0048-REVIEW-phase2 (verdict: REVISE, fix list closed at 0049)
Batch: cycle 2 of up to 3 since last review; ~462 (entry 0049) + ~1246 (this entry, 1167 insertions/79 deletions) = ~1708 lines / 6 files (union of touched files) since 0048-REVIEW-phase2 (cap 800/10 — EXCEEDED).

## Declared scope

Row/column **DELETION** for the table primitive (§5.4: "rows and columns can be added or
removed" — the half insertion, entry 0047, did not cover), taking the §5.1.1 **REPAIR** path
unconditionally: every inbound reference to a deleted cell becomes a `#REF` `ErrorNode` (D-028),
including references from other tables and the deleted table's own other cells, and a range
whose endpoint was deleted clamps to the remaining extent per §5.4's own wording. This is the
**first real use of the §5.1.1 REPAIR path anywhere in this codebase**.

## Explicitly not in scope

The `force` flag on `DeleteObjectOperation` (`delete <table>`) — §5.1.1's REPAIR path for a
WHOLE-OBJECT deletion, widening that (existing, REJECT-by-default) operation to rewrite live
dependents to `#REF` instead. This is Phase 2's other outstanding acceptance-criterion need, and
it is a **different mechanism** from row/column deletion (whole-object repair has no axis, no
clamping, and every range naming the deleted object collapses to `#REF` outright rather than
narrowing) — building both in one cycle would repeat entry 0044's over-large-slice mistake.
Deferred to its own cycle; see "Review point" below for why I am stopping here rather than
continuing into it in this same session, and STATUS.md's "Next slice."

The dimension/cell coherence gap in general, and the `rows`/`cols` upper bound — both still
`STATUS.md` known problems, untouched by this cycle.

## What I did

- **`src/engine/formula/deps.ts`** — added `repairAddressesInAst(ast, repairReference,
  repairRange)`, a THIRD total walk over `FormulaAst`'s seven shapes, sibling to
  `extractDependencies` and `rewriteAddressesInAst`. Per **D-052's own forward note**
  (0048-REVIEW-phase2 §6 item 3): `rewriteAddressesInAst`'s `(Address) => Address` signature
  cannot express deletion's repair, because turning a `ReferenceNode` into an `ErrorNode` is a
  NODE-level replacement and a range endpoint's clamped value needs BOTH endpoints at once. So
  this is a NODE-level walk: `repairReference`/`repairRange` may each report the literal string
  `"deleted"`, which this function — not the caller — turns into a fresh `ErrorNode`
  (`{ type: "error", error: "#REF" }`, D-028) at exactly that position. This file still has no
  notion of tables, rows, or deletion indices — both callbacks carry all of that.
- **`src/engine/primitives/table.ts`** — four additions, mirroring insertion's shape wherever the
  two are symmetric and diverging only where deletion's ability to ORPHAN a reference forces it
  to:
  - `shiftCoordinatesForDelete` (private): the delete-side counterpart to `shiftCoordinates` —
    returns `"deleted"` for a cell whose own row/column IS the one removed, shifted coordinates
    otherwise. D-051: this arithmetic joins `shiftCoordinates` in this file.
  - `repairCellAddressForDelete(address, tableId, axis, index)`: the delete-side sibling of
    `shiftCellAddressForInsert`, returning `Address | "deleted"` — used by `mutation.ts`'s
    reference-adjustment pass, once per `ReferenceNode` address in the whole document.
  - `clampRangeEndpointValue` (private) and `repairRangeEndpointsForDelete(start, end, tableId,
    axis, index)`: the range-endpoint sibling. §5.4's "clamps to the remaining extent" needs a
    tie-break when an endpoint's own line is deleted — which side of the range it was on is
    decided by comparing its value against the OTHER endpoint's, never by which AST field
    ("start"/"end") it occupies, since a `RangeNode`'s two fields carry no min/max guarantee (a
    user may legally write `A5:A1`). Returns `"deleted"` for a range naming only the removed line
    (§5.4: "a range deleted entirely becomes `#REF`").
  - `deleteTableLine(object, axis, index)`: returns a new table object with the dimension
    decremented, the cell AT `index` dropped, and every cell after it shifted back by one — via
    the SAME `shiftCoordinatesForDelete` the address-repair function uses. **D-049 applies here
    exactly as it does to `insertTableLine`**: the new `slots` record starts from `object.slots`
    in full; only in-extent cell keys are removed, and only because they are being dropped or
    re-written. Unlike insertion, this function does NOT clamp an out-of-range index — there is no
    "nearest line" to delete instead of a nonexistent one, so validity is entirely
    `findInvalidTableResizes`'s job.
- **`src/engine/mutation.ts`** — the largest set of changes:
  - New `DeleteTableLineOperation` (`{ kind: "deleteTableLine", objectId, axis, index }`) added to
    the `Operation` union (now five variants). Carries no `force` flag — §5.4 states the repair
    path unconditionally for row/column deletion, unlike `delete <table>`.
  - `operationTargetId` gained a shared branch with `insertTableLine`.
  - `applyOperation` gained a `deleteTableLine` branch: resolves the target, applies
    `deleteTableLine` to it, then rewrites/repairs EVERY object's formula ASTs via a new
    `repairObjectFormulaAddresses` helper (the REPAIR-side sibling of `rewriteObjectFormulaAddresses`),
    passing `repairCellAddressForDelete`/`repairRangeEndpointsForDelete` bound to this operation's
    `objectId`/`axis`/`index`.
  - **`findInvalidTableResizes` WIDENED** (never a second, parallel check — the "widen, don't
    duplicate" stance D-020/D-026/D-027/D-050 already established) to simulate `insertTableLine`
    AND `deleteTableLine` together, in ONE left-to-right walk over `TrackedTableState`. This is
    **D-050's own binding text** applied directly: "every future operation kind that changes it
    extends that same simulation" — a separate simulation pass per operation kind would
    mis-validate a batch that INTERLEAVES inserts and deletes on the same table, since each pass
    would be blind to the other kind's effect on the same table's count. Insertion's valid range is
    `1..count+1`; deletion's is `1..count` (it must name an existing line — a bound of `0`
    correctly makes every index invalid). The tracked count updates by `+1` after a valid insert,
    `-1` after a valid delete.
  - `mutate`'s D-021 existence-check message ternary gained a `deleteTableLine` branch.
  - `findIllegalOperationPayloads`'s trailing comment updated: `deleteTableLine` carries no
    Slot/Value payload either.
- **Tests** — `deps.test.ts` (9 new: `repairAddressesInAst` over every AST shape, the
  "deleted" → `ErrorNode` substitution for both reference and range, "repairRange is called with
  BOTH endpoints together," never-throws), `table.test.ts` (25 new: `repairCellAddressForDelete`,
  `repairRangeEndpointsForDelete` — including the reversed-range `A5:A1` case proving role is
  decided by value, not by AST field — and `deleteTableLine`, including a D-049-parity describe
  block mirroring insertion's own), `mutation.test.ts` (21 new: basic row/column deletion,
  cross-object `#REF` repair, cross-object shift-back, untouched-before-index, untouched-other-table,
  range clamping (interior/lower-bound/upper-bound), range-deleted-entirely, five rejection cases
  (out-of-range, index 0, empty table, non-table, missing id, non-literal dimension), batch
  composition with `setSlot`, the widened-simulation describe block (two deletes in one batch,
  interleaved insert-then-delete, delete-then-insert, same-batch-created table, and a
  second-delete-beyond-what-remains rejection that was the one test precise enough to catch the
  `delta`-direction mutation below), and the Phase 2 clause 4 DELETE-half demonstration test
  quoting the brief's own words and re-checking the committed result via
  `deriveValidateAndEvaluate` for "no dangling edge."

## Decisions I made

1. **`repairAddressesInAst` is NODE-level, not a widened `rewrite` callback on
   `rewriteAddressesInAst`** — dictated directly by D-052's forward note, not a fresh choice.
   Implemented exactly as that note specified: two callbacks (`repairReference`, `repairRange`),
   each may report `"deleted"`, and this function alone constructs the `ErrorNode`.
2. **Role in a range (lower vs. upper bound) is decided by comparing the two endpoints' VALUES,
   never by which AST field holds them.** A `RangeNode`'s `start`/`end` carry no min/max guarantee
   — `parser.ts` accepts `A5:A1` as a legal, reversed range — so `clampRangeEndpointValue` takes
   the OTHER endpoint's value as an explicit parameter and decides the tie-break from it, rather
   than assuming `start` is always the lower bound. Verified by a dedicated test using a reversed
   range.
3. **`deleteTableLine` does NOT clamp an out-of-range index the way `insertTableLine` clamps one.**
   There is no sensible "nearest line" to delete instead of a nonexistent one (insertion's clamp
   has a natural interpretation — "append instead"; deletion's would not). This makes
   `findInvalidTableResizes` the ONLY thing standing between a malformed `deleteTableLine` and a
   malformed table, stated explicitly in both the operation's and the primitive's own doc
   comments — a disclosed, deliberate asymmetry with insertion, not an oversight.
4. **`findInvalidTableResizes` is WIDENED in place, not duplicated into a second function.** A
   batch that interleaves `insertTableLine`/`deleteTableLine` on one table needs ONE simulation
   that both kinds update, or a batch like `[insert row at 3, delete row at 3]` would be validated
   against two mutually-blind simulations. This is D-050's own binding text read literally, not a
   new design decision.
5. **Repair happens document-wide, unconditionally, exactly mirroring insertion's
   `applyOperation` branch** — `repairObjectFormulaAddresses` is blind to which object it is
   walking, the same posture `rewriteObjectFormulaAddresses` already takes, for the same Rule 5
   reason entry 0047 gave: a pre-filter would be a second place "is this address relevant" could
   drift from `repairCellAddressForDelete`'s own answer.

## Verification (real output)

```
$ npm run typecheck
> tsc --noEmit && tsc --noEmit -p tsconfig.engine.json
(clean, no output)

$ npm test -- --run
 Test Files  15 passed (15)
      Tests  643 passed (643)
```

643/643 — up from 589 at the start of this cycle (54 new tests, all listed above), 0 skipped, 0
`.only`/`.skip`/`it.todo` (`grep -rn "\.only(\|\.skip(\|it\.todo(" src` clean).

### Mutation-test checks (D-016)

Six pieces disabled one at a time, affected test files rerun, expected named failures confirmed,
reverted. `grep -rn "MUTATION-TEST\|MUTATION_TEST" src/engine` clean before, during (checked
per-step), and after.

1. **`shiftCoordinatesForDelete`'s shift arithmetic disabled** (the `value > index` branch gated
   behind a dead flag): reran `table.test.ts` + `mutation.test.ts` — **9 named failures**, spanning
   both direct `repairCellAddressForDelete`/`deleteTableLine` unit tests and end-to-end `mutate()`
   tests. Confirms the shift arithmetic is load-bearing everywhere it's used.
2. **`clampRangeEndpointValue`'s tie-break comparison disabled** (forced to always return
   `index - 1`, the upper-bound answer): reran the same two files — **1 named failure**, exactly
   "clamps when the deleted row IS the range's lower bound." Confirms the tie-break logic is real,
   not vestigial — most scenarios happen not to distinguish the two branches, but this one does.
3. **`applyOperation`'s `deleteTableLine` branch's document-wide repair call disabled** (replaced
   with a bare pass-through of the resized target): reran `mutation.test.ts` — **5 named
   failures**, exactly the cross-object `#REF`/shift tests, the two range tests, and the Phase 2
   clause 4 demonstration test. Every OTHER deletion test (in-table cell shift, untouched-other-table,
   rejections) correctly kept passing — confirming the cell-slot move and the document-wide repair
   pass are genuinely independent pieces, same shape as 0047's own checks.
4. **`findInvalidTableResizes`'s `delta` direction forced to always `+1`** (ignoring
   `isInsert`): reran `mutation.test.ts` — **0 failures** against the ORIGINAL test suite, which
   exposed a real gap in my own first-draft coverage (none of my interleaved-batch tests happened
   to distinguish a wrongly-tracked count from a correct one). Added a new, genuinely
   distinguishing test — "a SECOND delete beyond what remains is rejected" — confirmed it passes
   against correct code, then reran the SAME mutation: **1 named failure**, exactly that new test.
   Reverted, reconfirmed 149/149. This is disclosed as a real correctness gain from the mutation-
   test discipline itself, not just a confirmation step.
5. **`findInvalidTableResizes`'s `maxValidIndex` forced to always `bound + 1`** (insertion's
   bound, ignoring deletion's stricter `bound`): reran `mutation.test.ts` — **2 named failures**,
   the empty-table-deletion rejection and the new second-delete-beyond-what-remains test. Confirms
   deletion's tighter bound is genuinely enforced, not accidentally permissive.
6. **`deleteTableLine`'s cell-drop `continue` disabled** (a deleted cell re-placed at its
   ORIGINAL position instead of dropped): reran `table.test.ts` — **1 named failure**, "deleting
   the LAST remaining row leaves a 0-row table with no cells." Weaker signal than the others — most
   scenarios happen to mask this because a later cell's correct shift overwrites the wrongly-placed
   one at the same key — but it is genuinely caught, not merely assumed.

## Acceptance criteria status

Phase 2 criterion (quoted in full at entry 0044/0045-REVIEW §4), clause 4's DELETE half: "deleting
a row whose cells have external dependents rewrites those references to `#REF` (repair path)
rather than leaving a dangling edge" — **NOW PASSING**, demonstrated end-to-end by the dedicated
test quoting the brief's own words, which builds a table with an external dependent, deletes the
referenced row, asserts `ok: true` (never a rejection), asserts the dependent's stored AST is now
an `ErrorNode` and its cached value is a live `#REF` `ErrorValue`, and re-derives/re-validates the
COMMITTED result via `deriveValidateAndEvaluate` to confirm no dangling edge survives.

Clause 4's OTHER half — `delete <table>` rejected-until-`force` — remains **NOT YET**, deliberately
out of scope this cycle (see above). The phase gate as a whole is still not claimed complete;
§6.1 trigger 1 does not fire.

## Where I got stuck / what is unfinished

Nothing structurally stuck — D-052's forward note specified the shape of `repairAddressesInAst`
precisely enough that there was no design ambiguity there. The one place I second-guessed myself
was the range clamp's tie-break (decision 2 above): my first instinct was to route through
`Math.min`/`Math.max` on the two endpoints and reassign by role after the fact, which turned out to
need the exact same "compare against the other endpoint" information anyway, just computed less
directly — I simplified to the direct per-endpoint form once I'd worked both through by hand and
confirmed they agree on every case I could construct (documented in `clampRangeEndpointValue`'s own
doc comment rather than left implicit).

The mutation-testing pass (check 4 above) caught a real, if narrow, coverage gap in my own first
draft — worth stating plainly rather than folding into the "all checks confirmed" summary, per
PROCESS_BRIEF §10's "describe what I actually did, including what I got wrong."

The `force` flag on `DeleteObjectOperation` — Phase 2's other outstanding need — is unstarted; see
"Explicitly not in scope."

## Open questions raised

None. `repairAddressesInAst`'s shape was dictated by D-052; `clampRangeEndpointValue`'s
value-based tie-break is a direct reading of §5.4's own "clamps to the remaining extent" wording,
verified against hand-worked examples in both the doc comment and the test suite; deletion's
non-clamping stance (decision 3) is a disclosed, reversible engine-level choice with no brief
position either way.

## Review point

**Triggers fired: §6.1 trigger 3** — brief-silent, load-bearing design decisions (the node-level
repair-walk shape, though largely dictated by D-052; the range tie-break arithmetic; the widened
batch-simulation shape) on `mutation.ts`, `primitives/table.ts`, and `formula/deps.ts`, all
load-bearing files. Independently, and by a wide margin, the **batch cap is exceeded**: this
cycle's own diff alone is ~1246 changed lines / 6 files (cap 800/10), before even adding entry
0049's ~462/4 since the last review point.

**REVIEW: REQUIRED.** Both grounds are objective. No further cycle should begin until this lands
review — in particular, the `force`-flag cycle that would close Phase 2's gate must not start
before this one is reviewed, since it will very likely reuse or extend the REPAIR mechanism built
here.

Questions for reviewer:
  1. Is deletion's NON-clamping stance (decision 3 — no defensive-arm clamp the way insertion has
     one, `findInvalidTableResizes` as the sole guard) the right asymmetry, or should
     `deleteTableLine` gain some defensive floor (e.g. clamping to `1` / refusing to go below 0
     rows) even though nothing in this codebase can currently reach it unvalidated?
  2. Is the value-based (not field-based) tie-break in `clampRangeEndpointValue` (decision 2) the
     right general answer, or would you rather range endpoints be normalised to `start <= end` at
     a single canonical point (parse time or storage time) so this kind of role ambiguity can't
     arise in future AST-walking code?
  3. `repairObjectFormulaAddresses` and `rewriteObjectFormulaAddresses` are now near-duplicate
     functions (one calls `repairAddressesInAst`, the other `rewriteAddressesInAst`, otherwise
     identical). Worth collapsing behind a shared helper now, or keep them separate since their
     callback shapes genuinely differ (`(Address) => Address` vs. the two-callback repair shape)?
