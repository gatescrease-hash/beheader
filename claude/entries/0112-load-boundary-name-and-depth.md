# 0112 — §5.11's load boundary: D-081's name gate, D-083 clause 4's AST depth check
Date: 2026-08-31   Phase: 4   Model: Claude Sonnet 5
Previous entry: 0111-panel-fix-list   Last review: 0110-REVIEW-phase4 (verdict: REVISE; fix list
built at entry 0111)
Batch: cycle 2 of up to 3 since last review; 9 files / 418 insertions, 70 deletions since 0110-REVIEW
(entry 0111's 102/17 across 2 files, plus this cycle's 316/53 across 7 different files — no overlap).

## Declared scope

Close the two remaining "owed" items from `STATUS.md`'s standing queue: **D-081** (`createObject`'s
own name must pass `checkNameAvailable`, the same gate a rename passes) and **D-083 clause 4** (a
loaded formula's AST depth is checked ONCE, at the load boundary, against `MAX_FORMULA_AST_DEPTH`).
Both rulings name `document.ts`'s load cycle as their owner; both were still open.

## Explicitly not in scope

`document.ts`'s other known gaps (journal `Operation` payload validation, format migration) —
untouched, neither ruling asks for them. `command/commands.ts` — D-081 clause 2 is explicit that
`createObject`'s own precondition extends `mutation.ts`'s existing simulation, not a second check
layered on top of the command layer.

## What I did

**`src/engine/formula/ast.ts`**: new exported `exceedsMaxFormulaAstDepth(ast, depth = 1)` — the ONE
depth check a loaded `FormulaAst` passes through (D-083 clause 4). Counts the same way `parser.ts`'s
`walkForRangePlacement` and `format.ts`'s `formatNode` already do (root at depth 1, check before
recursing into children, so the call stack never grows past `MAX_FORMULA_AST_DEPTH` frames even for
an adversarial input). File header's `INVARIANTS UPHELD HERE` gained one bullet naming it.

**`src/engine/document.ts`**: `reconstructSlot`'s `formula` branch calls `exceedsMaxFormulaAstDepth`
on the loaded `ast` before accepting the slot, refusing with `parser.ts`'s own message vocabulary
("formula has more than N nested operations..."), located to `${objectName}.${key}`. File header
gained a binding note for D-081/D-083 clause 4, and its "Shape-validates only..." / `reconstructSlot`
/ `reconstructObject` doc comments each gained the one-line carve-out: depth is the one thing checked
about an AST's CONTENT here, because it has to run before any recursive walk touches the AST — before
`mutate` (and therefore `deps.ts`/`eval.ts`) ever sees one.

**`src/engine/mutation.ts`**: `findInvalidRenames` renamed to `findInvalidNames` (it now checks more
than renames) and widened: the `createObject` branch runs `checkNameAvailable(operation.object.name,
tracked)` — no `excludeId`, since a freshly created object has no prior name of its own — before
pushing the tracked entry; a refused creation is not applied to the simulation, mirroring the refused
rename branch already there. `CreateObjectOperation`'s doc comment widened from one precondition to
two. The "FOURTH, FIFTH, SIXTH check" summary comment and the call site's own comment both renamed
along with the function.

**`src/engine/address.ts`**: `checkNameAvailable`'s doc comment updated — the "`createObject` does
not yet" disclosure removed now that it does.

**Tests**: `mutation.test.ts`'s pinned "KNOWN GAP, pinned not fixed" test **FLIPPED** to assert
rejection (D-081's own text names this the intended visible diff, not a weakened test) plus four new
tests (grammar-invalid name, reserved-word name, two `createObject`s in one batch claiming the same
name, a refused creation claiming no name for the simulation, and a symmetric "accepts a name an
earlier delete freed" case). `document.test.ts` gained two new loader-level tests (duplicate name,
ungrammatical name) beside the existing duplicate-ID test, plus a new describe block for D-083 clause
4 (accepts at the limit, rejects one level past, never throws at 40,000 levels, and confirms the
rejection is document.ts's own — not a downstream `mutate` failure). `ast.test.ts` gained a describe
block for `exceedsMaxFormulaAstDepth` directly (six tests: a leaf, exactly at the limit, one past it,
40,000 levels with no `RangeError`, every branch of a `functionCall` checked, and a legal nested
shape reported false).

## Decisions I made

1. **Renamed `findInvalidRenames` to `findInvalidNames`.** The old name described only half of what
   the function now checks; D-060/§5.1's legibility standard is what a cold reader sees, and
   `findInvalidRenames` checking `createObject` too would be exactly the kind of drift D-058 warns
   about. Cheap — it is a private function with one call site and no external reference.
2. **`createObject`'s name check gets no `excludeId`.** `checkNameAvailable`'s `excludeId` exists so
   a rename that only changes an object's OWN name (or its case) is not rejected against itself. A
   fresh `createObject` has no prior name in the simulation to be excused against — passing `undefined`
   (the parameter's default) is correct, not an oversight.
3. **A refused `createObject` is not applied to the simulation**, mirroring the refused-rename
   branch's existing posture exactly. Pinned by a new test: two operations, the first a duplicate
   `createObject` and the second a `renameObject` claiming the SAME name — both must be rejected,
   because the refused creation must not have silently claimed the name for the second check to
   collide against (that would report the WRONG operation as the duplicate).
4. **The depth check lives in `ast.ts`, not in `document.ts` and not in `mutation.ts`.** `ast.ts`
   already owns `MAX_FORMULA_AST_DEPTH` and `FormulaAst`; a function over the shape belongs beside
   the shape (D-010's reasoning, applied to a function rather than a constant). `document.ts` is the
   ONE caller, per D-083 clause 4's own wording — no second call site was added, and none should be.
5. **The rejection message reuses `parser.ts`'s exact phrase** ("formula has more than N nested
   operations; split it across cells, or use SUM over a range"), located with `${objectName}.${key}:`
   in front — D-083 clause 4 says "with the same vocabulary parser.ts uses," read literally rather
   than paraphrased.

## Verification (real output)

```
$ npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.engine.json
(clean, no output)

$ npm test
 Test Files  27 passed (27)
      Tests  1262 passed (1262)

$ npm run build
✓ 32 modules transformed.
✓ built in 325ms
```

Zero skipped, zero `.only`. 1262 = 1245 (entry 0111's count) + 17 new (5 in `mutation.test.ts`, 6 in
`ast.test.ts`, 6 in `document.test.ts`); the flipped `mutation.test.ts` test is an edit to an
EXISTING test, not counted as new.

**Mutation-checked (D-016), both new checks, each confirmed red then green:**

- `findInvalidNames`'s `createObject` branch: `checkNameAvailable(...)` replaced with a literal
  `{ ok: true }` → 7 tests failed (5 new `mutation.test.ts` tests plus the 2 new `document.test.ts`
  loader-level name tests), 0 others. Reverted, confirmed 220/220 green again.
- `exceedsMaxFormulaAstDepth`'s guard: `if (depth > MAX_FORMULA_AST_DEPTH)` replaced with `if
  (false)` → 6 tests failed, including a GENUINE `RangeError: Maximum call stack size exceeded` out
  of the 40,000-level fixture — direct evidence the guard is what prevents exactly the crash D-079
  was ruled over, not merely what a test asserts it prevents. Reverted, confirmed 52/52 green again.

## Acceptance criteria status

Not a phase-gate cycle. Neither ruling is a Phase 4 acceptance criterion; both close standing debt
from Phase 0-3 rulings (D-081 ruled at 0084-REVIEW-phase3, D-083 at 0088-REVIEW-phase3).

## Where I got stuck / what is unfinished

Nothing. Both rulings were fully specified — the "what" and the "where" were already decided; this
cycle was the "when."

## Open questions raised

None. No `PROVISIONAL(Q-NNN)` tag was added or touched.

## Review point

**Fired: PROCESS_BRIEF §6.1 trigger 5 — a previously-passing test's expectation was CHANGED.**
`mutation.test.ts`'s "KNOWN GAP, pinned not fixed" test asserted `result.ok === true` before this
cycle and asserts `result.ok === false` after it. D-081's own ruling text authorises this exact
change ("The pinned test... must FLIP when the load cycle implements this — that is the intended
visible diff, not a test being weakened") — but per this project's own standing rule, a ruling
authorising a change is not an exemption from the trigger that change fires (`STATUS.md`'s own
gotcha). The trigger is objective and independent of the batch cap, which is nowhere close on its
own terms (cycle 2/3, 418/70 across 9 files, cap 800/10).

**REVIEW: REQUIRED.**
Reason: §6.1 trigger 5 (a previously-passing test's expectation changed).
Questions for reviewer: none beyond confirming the flip is the intended one — D-081's own text
already answers it, so this is a formality rather than a genuine open question.
