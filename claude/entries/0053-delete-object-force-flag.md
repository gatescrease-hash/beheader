# 0053 — delete-object-force-flag
Date: 2026-08-24   Phase: 2   Model: implementer
Previous entry: 0052-fix-list-both-axis-resize   Last review: 0051-REVIEW-phase2 (verdict: REVISE)
Batch: cycle 2 of up to 3 since last review; ~620 lines / 2 code files changed since last review
(0052 + 0053 combined) — moot: §6.1 trigger 1 (phase gate) fires regardless of the cap.

## Declared scope

`DeleteObjectOperation`'s `force` flag (§5.1.1's whole-object REPAIR path for `delete <table>`),
closing Phase 2's last acceptance clause — and, per D-057's own binding text, the broken-slot
report channel in the SAME cycle, since this is the second repair site and D-057 was ruled
specifically to stop two separate channels from being built. Nothing else.

## Explicitly not in scope

Anything in Phase 3 (canvas, camera, geometry, command line) — the gate has not cleared yet. The
dimension/cell coherence gap (STATUS.md's carried known problem) — unrelated to whole-object
deletion, whose repair callbacks are pure identity checks with no extent/shifting involved. A
table-creation COMMAND.

## What I did

**`src/engine/mutation.ts`**:

- `DeleteObjectOperation` gains `force?: boolean` (widened union member, D-020's "widen, never
  restructure" stance). Rewrote its doc comment to describe both paths.
- `applyOperation`'s `deleteObject` branch: `force` absent/false takes the UNCHANGED reject-via-
  `validateIntegrity` path (identical to cycle 0022). `force: true` runs `repairObjectFormulaAddresses`
  over EVERY object (document-wide, unconditional, no relevance pre-filter — the same posture
  `insertTableLine`/`deleteTableLine` already established) BEFORE filtering the deleted object out,
  so `validateIntegrity` never sees a dangling edge — it was already rewritten to `#REF`.
- Two new module-level callbacks, `repairReferenceForDeletedObject`/`repairRangeForDeletedObject`
  (**D-056**): a `ReferenceNode` naming any slot on the deleted object reports `"deleted"`; a
  `RangeNode` with EITHER endpoint on it reports `"deleted"` entirely. Both are a single equality
  check — no shifting exists for a whole object going away. `repairObjectFormulaAddresses` itself
  is REUSED UNCHANGED in shape, exactly as D-056 requires — no third `*ObjectFormulaAddresses`
  helper.
- `repairObjectFormulaAddresses` widened to also return `brokenSlots: readonly Address[]` (**D-057**):
  tracks, per formula slot, whether its OWN walk turned any reference/range into `"deleted"`, via a
  per-slot closure flag wrapping the two callbacks — not by changing `repairAddressesInAst`'s own
  signature, which would break its parallel with `rewriteAddressesInAst` (D-052/D-056). A broken
  slot's `Address` is recovered by a new `resolveSlotPathForKey`: forward-resolves the object's
  schema-declared paths (`resolveNonDerivedSlotPaths`, the same call D-017's own check already
  makes) and matches the one whose `slotKey` equals the stored key — never by inverting the key
  (D-010 forbids that).
- `applyOperation`'s OTHER branches (`setSlot`, `createObject`, `insertTableLine`, `deleteTableLine`)
  widened to the same `{ objects, brokenSlots }` return shape — empty for every branch that cannot
  break anything (insertion only ever shifts, per D-051/D-052).
- `mutate`'s fold accumulates `brokenSlots` across the whole batch alongside `objects`, in the SAME
  `reduce`. `MutationResult`'s `ok: true` arm gains `brokenSlots: readonly Address[]`, deduplicated
  (`dedupeAddresses`, keyed by `addressKey` — D-015's sanctioned internal-only use) so a slot broken
  by two DIFFERENT references via two DIFFERENT operations in one batch is reported once.
- Updated `DeleteTableLineOperation`'s doc comment: its "D-057 unbuilt" KNOWN GAP paragraph (added
  at entry 0052) now says BUILT, pointing at the shared channel. Removed the file header's stale
  "force flag NOT DONE HERE" bullet and added this cycle's own history paragraph (D-058: names its
  entry number).

**`src/engine/mutation.test.ts`**: new describe block, "DeleteObjectOperation's `force` flag" (5
tests) — reject-by-default (regression coverage for the unchanged path), force repairs a REFERENCE
dependent, force repairs a RANGE dependent (either-endpoint rule) entirely to `#REF`, force with no
dependents is a plain no-op report-wise, and a dedup case (one slot, two different references, one
report entry). Added one assertion to the EXISTING row/column deletion demonstration test
(`brokenSlots` non-empty), proving the "ONE channel, two repair sites" claim is real, not only
stated in a doc comment.

## Decisions I made

None load-bearing — this cycle applies D-056 and D-057 literally, as both already specified the
exact shape (reuse `repairObjectFormulaAddresses`, one report channel). One small implementation
choice within D-057's scope: where `resolveSlotPathForKey` cannot resolve a key (defensive-only,
cannot happen for a real product primitive per D-011), the broken slot is silently omitted from the
report rather than the whole repair failing — matches this file's "never throws" discipline and
Rule 5 ("dumbest correct implementation" — there is nothing better to do with an unnameable address).

## Verification (real output)

```
$ npx tsc --noEmit
(clean, no output)
$ npx tsc --noEmit -p tsconfig.engine.json
(clean, no output)
$ npx vitest run --reporter=dot
 Test Files  15 passed (15)
      Tests  651 passed (651)
```

Mutation-checked (D-016) the `force` gate itself: temporarily swapped `operation.force !== true` to
`operation.force === true` in `applyOperation` (inverting which branch runs) and re-ran the whole
new describe block —

```
$ npx vitest run -t "force" --reporter=verbose
 Tests  4 failed | 4 passed (8 total for this filter, including 3 unrelated Q-008 tests)
```

4 of the 5 new tests failed (the reject-by-default test now committed instead of rejecting; the two
repair tests rejected instead of committing; the dedup test rejected). The 5th ("on an object with
NO dependents") passed under EITHER branch — expected, not a gap: nothing to reject or repair
either way. Restored the real condition and re-ran the full suite (green, shown above).

## Acceptance criteria status

**Phase 2's acceptance criterion (§6) is now FULLY PASSING, all five clauses:**
1. Two tables, cross-table formula, live update — PASSING (prior work).
2. Circular reference rejected — PASSING (prior work).
3. `SUM(A1:A5)` recomputes after row insertion — PASSING (entry 0047/0048).
4. Row/column delete with `#REF` repair — PASSING (entry 0050), AND §5.4's "reports every slot it
   broke" clause is now BUILT (D-057) — demonstrated by the augmented assertion on the existing
   demonstration test (`mutation.test.ts`).
5. `delete <table>` rejected-until-`force` — PASSING (this entry). Demonstrated by the new
   "DeleteObjectOperation's `force` flag" describe block: reject-by-default test proves the REJECT
   half; the reference/range repair tests prove the force half; both against a real `table`-typed
   object being deleted, matching the brief's own `delete <table>` wording.

Per PROCESS_BRIEF §12 clause 1, every clause above is backed by an executable test, pasted/named
above — no clause is claimed by description alone.

## Where I got stuck / what is unfinished

Nothing stuck. The design was fully specified by D-056/D-057 before this cycle started, which is
exactly what those rulings were for — the only real decision this cycle made was HOW to track
"did this slot break" without changing `repairAddressesInAst`'s signature (the per-slot closure
flag), and how to recover a report `Address` without violating D-010 (`resolveSlotPathForKey`).
Both are documented in their own doc comments. Everything STATUS.md's carried known problems list
is genuinely unfinished, not newly discovered here.

## Open questions raised

None. D-056 and D-057 already answered every design question this cycle could have raised.

## Review point

**Fired: §6.1 trigger 1 — a phase acceptance criterion is claimed complete.** Phase 2's gate is
claimed CLOSED as of this entry, per the criteria and tests above. This is always a mandatory,
immediate review point (PROCESS_BRIEF §12), never something a batch can absorb — cycles-since-
last-review (2/3) and diff-since-last-review (~620/800 lines) are both still under cap, but
irrelevant: the phase gate fires regardless. **Phase 3 does not begin until this gate clears.**

CYCLE 0053 COMPLETE
Slice: `DeleteObjectOperation`'s `force` flag + D-057's broken-slot report channel — closes Phase 2
Files: 3 changed (src/engine/mutation.ts, src/engine/mutation.test.ts, claude/STATUS.md) + this entry
Tests: 651/651, 0 skipped   Typecheck: clean (both configs)
Phase 2 criterion: ALL FIVE CLAUSES PASSING — claimed COMPLETE
Review point: §6.1 trigger 1 (phase acceptance criterion claimed complete)
Open questions: none
REVIEW: REQUIRED
Reason: phase gate — PROCESS_BRIEF §12 clause 2, no exceptions
