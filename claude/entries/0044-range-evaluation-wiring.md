# 0044 — range-evaluation wiring
Date: 2026-08-23   Phase: 2   Model: Claude Sonnet 5
Previous entry: 0043-REVIEW-phase2   Last review: 0043-REVIEW-phase2 (verdict: ACCEPT WITH EDITS)
Batch: cycle 1 of up to 3 since last review; 13 files / 1834 lines (1337 insertions + 497 deletions)
changed so far — over the ~800/10 cap on its own, moot given the §6.1 triggers below.

## Declared scope

STATUS.md's "Next slice — the range-evaluation wiring" in full, per D-036's five constraints and
0041-REVIEW-phase2 §9's ordering: wire `formula/eval.ts`'s real evaluator into `graph/eval.ts` and
`mutation.ts`'s `deriveEdges` (deleting the three temporary bridges together), bound range
expansion by the table's current extent (D-044) reading dimensions `literal`-only (D-046), reject
a cross-object range at parse time (D-045), extend D-031's value-legality walk to a stored AST's
literals, and fix `MIN`/`MAX`'s `Math.min(...)` spread. Not a new subsystem — an extension of
already-reviewed files.

## Explicitly not in scope

Row/column insert/delete and §5.4's reference-adjustment/clamping pass; a table-creation
command/mutation (§5.10); the table dimension-coherence problem D-046 left open (a `literal`
`rows`/`cols` write can still disagree with the cells that actually exist) — all per STATUS.md's
own explicit instruction not to start the resize design in this batch. `findIllegalOperationPayloads`
does not gain the same D-031 stored-AST-literal walk `findIllegalSlotValues` did — see "Where I got
stuck" below.

## What I did

**`src/engine/primitives/table.ts`** — `enumerateRangeCellPaths` renamed to
`enumerateRangeCellAddresses` and given a third parameter, the table's `GraphObject`. Returns
`Address[]` now, not bare paths (the signature decision 0041-REVIEW §9 left open) — both this
cycle's consumers need a full `Address`, and pairing `{objectId, path}` at two call sites would be
exactly the small duplication D-010 argues against. Bounds `maxRow`/`maxColumn` to the table's
current `rows`/`cols`, read via the SAME `readTableDimension` (`literal`-kind-only, D-046)
`enumerateTableCellSlotPaths` already uses — cells outside the extent are omitted, not `#REF`
(D-044). Header rewritten to match.

**`src/engine/formula/functions.ts`** — `MIN`/`MAX` replaced `Math.min(...numbers)`/
`Math.max(...numbers)` with `numbers.reduce(...)`, seeded with `Infinity`/`-Infinity` to preserve
the exact existing zero-argument answer (D-044 point 2's "do not invent a new error path").

**`src/engine/formula/eval.ts`** — `evaluate` gains an optional third parameter, `readRange:
(start, end) => Value[] | ErrorValue`. `evaluateFunctionCall`'s eager argument loop special-cases a
`range`-typed argument: expands it via `readRange`, flattens every value into the same `argValues`
list a scalar argument would land in, propagating the first error (the range's own, or one cell's)
left to right. `readRange` threaded through every recursive `evaluateNode` call so a range nested
inside `IF`/`AND`/etc. still reaches the flattening logic. Omitted `readRange` (or a range reached
anywhere `validateRangePlacement` would have rejected) falls back to the OLD disclosed `#PARSE` —
documented as the fallback for a caller with no range capability, not a silent gap.

**`src/engine/formula/parser.ts`** — `walkForRangePlacement`'s `range` case gains D-045: a
`RangeNode` whose `start.objectId !== end.objectId` is now a `#PARSE` at parse time, right beside
the existing placement check.

**`src/engine/graph/eval.ts`** — the old `evaluateFormula` (`ReferenceNode`-only, `#PARSE`
otherwise) is DELETED. The new one builds `read`/`readRange` closures over this pass's
`evaluatedValues` and the full `objects` list, and calls `formula/eval.ts`'s real `evaluate`.
`readRange` resolves a range's table via `objects.find`, calls `enumerateRangeCellAddresses`
(the SAME function `deriveEdges` used to build this formula's edges), and reads each returned
address from `evaluatedValues`.

**`src/engine/mutation.ts`** — `deriveEdges`'s Source 1 walks `formula/deps.ts`'s
`extractDependencies` for real: a `ReferenceDependency` becomes one edge; a `RangeDependency`
expands via `enumerateRangeCellAddresses` into one edge per cell, falling back to ONE edge from the
range's own `start` address if the table cannot be resolved (deleted, or a defensive-only
enumeration failure) — so the dangling-reference check still catches and names it, the same
treatment a broken plain reference already gets, rather than silently dropping the dependency.
`findUnsupportedFormulaAsts` and its `validateIntegrity` call site are DELETED — every `FormulaAst`
shape is genuinely supported now. `findIllegalSlotValues` (D-025/Q-008) is WIDENED per **D-031**: a
new `collectIllegalAstLiterals` walks a `formula`-kind slot's stored AST for an illegal
`LiteralNode`, reachable for the first time now that the AST-shape shield is gone. Header rewritten
throughout: the running per-cycle history gained a new paragraph; the `validateIntegrity` doc block
renumbered from five checks to four.

**Tests** — `primitives/table.test.ts`, `formula/functions.test.ts`, `formula/parser.test.ts`,
`formula/eval.test.ts`, `graph/eval.test.ts`, `mutation.test.ts`, `document.test.ts` all updated or
extended. Highlights: `mutation.test.ts` gains end-to-end `mutate()` proofs for two of Phase 2's
acceptance-criterion clauses (cross-table live update; a circular reference rejected, including one
running entirely through range-derived edges and a genuine self-inclusive range per §5.3's "do not
special-case it"); a D-044 bounding proof through the real pipeline; and the deriveEdges fallback
described above, including the specific case that keeps `delete <table>` correctly rejected while a
range elsewhere still names it.

## Decisions I made

1. **`enumerateRangeCellAddresses` returns `Address[]`, not paths.** Both consumers need a full
   address; this function already knows the objectId. Disclosed above.
2. **`readRange` is an OPTIONAL third parameter on `evaluate`, with a documented fallback.** This
   kept ~70 pre-existing `evaluate(ast, read)` call sites in `formula/eval.test.ts` untouched
   rather than mechanically threading a third argument through every one that has nothing to do
   with ranges. The real production caller (`graph/eval.ts`) always supplies a real one; the
   fallback is the same `#PARSE` this file always returned for a range, now explicitly the answer
   for "no range capability wired," not merely "not built yet."
3. **A range dependency whose table cannot be resolved falls back to ONE edge from its own `start`
   address**, rather than being silently dropped. This is what makes `delete <table>` correctly
   rejected while a range elsewhere still names it — the same §5.1.1 mechanism a broken plain
   reference already uses, no new mechanism invented.
4. **`findIllegalOperationPayloads` was NOT extended to walk a payload's stored AST for D-031.**
   D-031's own binding text names only `findIllegalSlotValues` (the post-fold check); the
   payload-level companion check closes a narrower, separate hole (an illegal value overwritten or
   deleted within the same batch never reaching the post-fold check at all) that D-031 doesn't
   itself ask to be closed the same way. Disclosed as a known gap rather than silently left or
   scope-crept into fixing — see "Where I got stuck."

## Verification (real output)

```
$ npm run typecheck
> tsc --noEmit && tsc --noEmit -p tsconfig.engine.json
(clean, no output)

$ npm test -- --run
 Test Files  15 passed (15)
      Tests  536 passed (536)
```

536 = up from 501 at 0043-REVIEW. 0 skipped, 0 `.only` — confirmed by grep across `src/`.

**Mutation-test checks (D-016), all reverted, `grep -rn "MUTATION-TEST" src/engine` clean before and
after each:**

1. D-031's stored-literal walk (`slot.kind === "formula"` branch in `findIllegalSlotValues`)
   disabled: exactly the 3 named D-031-storability tests fail (98 passed / 3 failed).
2. `deriveEdges`'s range-dependency branch disabled (`continue` on `dependency.kind === "range"`):
   8 named failures, all range-related, all in `mutation.test.ts`; `graph/eval.test.ts` unaffected
   (it hand-builds edges, doesn't call `deriveEdges`) — confirming the two files' range-related
   tests exercise genuinely different code paths, not a shared fixture accident.
3. `formula/eval.ts`'s range-flattening forced to the omitted-`readRange` fallback even when one is
   supplied: 11 named failures across `formula/eval.test.ts`, `mutation.test.ts`, and
   `graph/eval.test.ts`.
4. D-044's clamp removed from `enumerateRangeCellAddresses` (bare `Math.max`, dimensions voided):
   6 named failures in `primitives/table.test.ts`.
5. D-045's cross-object check short-circuited to `false` in `parser.ts`: exactly the 1 named D-045
   test fails.
6. `MIN`'s `.reduce` reverted to `Math.min(...numbers)`: the 1 named large-argument-list test fails
   with the actual `RangeError` the fix exists to prevent — confirming the test reproduces the real
   defect, not a synthetic one.

## Acceptance criteria status

Phase 2 criterion (§6): "two separate tables exist; `table_a.B2` holds `= table_b.C3 * 2` and
updates live; a circular reference between them is rejected; `SUM(A1:A5)` recomputes correctly
after inserting a row inside the range; and deleting a row whose cells have external dependents
rewrites those references to `#REF` (repair path) rather than leaving a dangling edge, while
`delete <table>` on that same table is rejected (rejection path) until `force` is passed."

**PARTIAL, not claimed complete:**
- Two tables, cross-table formula, live update — PASSING. `mutate — two separate tables, a
  cross-table formula, live update`.
- Circular reference rejected — PASSING, including through range-derived edges specifically.
  `mutate — a circular reference between two tables, running through a RANGE`.
- `SUM(A1:A5)` recomputes correctly when a cell WITHIN the range changes — PASSING. `mutate —
  SUM(A1:A5) recomputes correctly as cell values change`. The clause's own wording ("after
  inserting a row") is NOT demonstrated: row/column insert does not exist yet — deliberately out
  of scope this cycle (STATUS.md's own instruction).
- Row/column delete with `#REF` repair, and `delete <table>` rejected-until-`force` — NOT YET.
  `delete <table>` IS correctly rejected when a range depends on it (demonstrated), but there is no
  `force` flag anywhere in `Operation` yet, and no row/column deletion exists to repair. Both need
  the still-deferred resize/creation cycle.

This cycle does not claim the phase gate. §6.1 trigger 1 does not fire.

## Where I got stuck / what is unfinished

The `findIllegalOperationPayloads`/`findIllegalSlotValues` asymmetry (Decision 4) is the one place
I stopped short of full symmetry on purpose rather than by oversight, and I want to flag the
reasoning rather than let it look like an accident: D-025/Q-008's own history is "the same defect
found four times" (slot values → journal payloads → camera/nextObjectId → stored ASTs), and I could
see this becoming a fifth instance the moment a range-containing formula becomes storable — an
illegal literal inside a `setSlot`/`createObject` payload's AST, later overwritten or deleted within
the SAME batch, would reach the journal without `findIllegalSlotValues` ever seeing it, exactly the
shape 0025-REVIEW-phase0 finding 1 already fixed for plain slot values. I chose not to close it here
because D-031's own binding text names only the post-fold check, and this cycle was already large
enough that I did not want to make a second, undirected judgement call on a load-bearing file
without asking first. Flagged in STATUS.md's Known problems; reviewer question 1 below.

## Open questions raised

None — no new `Q-NNN`. Reviewer questions instead, below.

## Review point

Fired: §6.1 trigger 3 (multiple genuine design decisions on load-bearing files —
`mutation.ts`, `formula/eval.ts`, `graph/eval.ts`, `primitives/table.ts` — not fully dictated by
the brief, see Decisions 1-4) and trigger 5 (several test expectations intentionally changed — the
whole "unsupported formula AST shape" describe block in `mutation.test.ts`, one `document.test.ts`
test, one `graph/eval.test.ts` test — per D-036's own instruction that the three temporary bridges
come down together). Batch: cycle 1/3, diff 1834/800 lines and 13/10 files — also over the cap on
its own, moot given the triggers above.

**REVIEW: REQUIRED**
Reason: triggers 3 and 5 both fired on load-bearing files; also the batch cap.

Questions for reviewer:
  1. Is the `findIllegalOperationPayloads`/D-031 asymmetry (Decision 4) acceptable to leave
     disclosed, or should it be closed now, in a follow-up edit to this same review?
  2. Is `enumerateRangeCellAddresses` returning `Address[]` (Decision 1) the right call, or would
     paths plus a `tableObjectId` at each call site have been preferable?
  3. Is an OPTIONAL `readRange` with a documented fallback (Decision 2) the right shape for
     `formula/eval.ts`'s public API, or should it be a required parameter — forcing every caller,
     tests included, to supply one, and treating "no range capability" as something only a test
     double should ever construct?
  4. Is the `deriveEdges` fallback-to-one-edge-from-`start` for an unresolvable range table
     (Decision 3) the right mechanism, or does a range dependency deserve a more specific failure
     path than reusing the plain-dangling-reference message?
