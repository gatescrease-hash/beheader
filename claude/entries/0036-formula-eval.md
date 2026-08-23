# 0036 — formula eval

Date: 2026-08-23   Phase: 1   Model: implementer (Claude Sonnet 5)
Previous entry: 0035-REVIEW-phase1 (reviewer, verdict: ACCEPT WITH EDITS — `formula/eval.ts` UNBLOCKED)
Batch: cycle 1 of up to 3 since 0035-REVIEW-phase1; **955 lines / 3 files changed (`src/` only)**.
This is Phase 1's LAST file and its phase gate — a review point on completion regardless of size
(0035-REVIEW's carried constraint 5, itself PROCESS_BRIEF §6.1 trigger 1). Nothing is batched
behind it, and the line count alone would also exceed the 800/10 cap on its own merits.

## Declared scope

Build `formula/eval.ts` (§5.3's evaluator, stage 4 of 4): `evaluate(ast, read)`, lazy and
short-circuiting per §5.3 and D-029. Read 0035-REVIEW-phase1 §9 first, per its own instruction and
`STATUS.md`'s — all five carried constraints are addressed below.

## Explicitly not in scope

Wiring this into `graph/eval.ts` or `mutation.ts` (Phase 2). Range expansion — a `RangeNode`
evaluates to a disclosed, temporary `#PARSE` (see Decisions). Any change to `deps.ts` (carried
constraint 3: dependency extraction and evaluation are different walks; this cycle does not touch
that file). Deleting `mutation.ts`'s `findUnsupportedFormulaAsts` or fixing 0035-REVIEW's Finding 4
(`MIN`/`MAX`'s `Math.min(...)` spread) — both explicitly belong to the future cycle that does range
expansion (carried constraint 4).

## What I did

- **`src/engine/formula/eval.ts`** (new, 511 lines) — `evaluate(ast, read): Value`, where
  `read: (address: Address) => Value | undefined` is the same shape `primitives/schema.ts`'s
  `DerivedSlotCompute` already uses. Structural recursion over every `FormulaAst` node
  (`evaluateNode`, one exhaustive `switch`, mirroring `deps.ts`'s `walk`/`parser.ts`'s
  `walkForRangePlacement`):
  - `literal` -> its own value. `reference` -> `read(address)`, `#REF` if unresolved.
  - `range` -> a disclosed, temporary `#PARSE` (see Decisions).
  - `error` (D-028) -> `{ error: ast.error, message: ... }` — never `#PARSE`.
  - `binaryOp` -> split by operator into lazy `AND`/`OR`, eager same-type comparisons
    (`= <> < > <= >=`), and eager numeric arithmetic (`+ - * / % ^`, `/`/`%` by zero -> `#DIV0`,
    every other result routed through `functions.ts`'s now-exported `finiteResult`).
  - `unaryOp` -> `-` (numeric negation, same `finiteResult` guard) or `NOT` (delegates to
    `functions.ts`'s own `NOT` registry entry).
  - `functionCall` -> `evaluateFunctionCall`, the D-029 dispatch: `getFunctionEntry` (D-034-safe)
    -> `checkArity` (BEFORE evaluating anything) -> `LAZY_FUNCTION_NAMES` special-cased by name to
    `evaluateIf`/`evaluateAndOperands`/`evaluateOrOperands` (before any argument is evaluated, and
    before `entry.implementation` is so much as considered — it does not exist for these three) ->
    otherwise, evaluate every argument eagerly left to right, stopping at the first error, and call
    `entry.implementation` once.
  - `AND`/`OR` share ONE lazy implementation over an operand array (`evaluateAndOperands`/
    `evaluateOrOperands`) — the infix `BinaryOpNode` form calls it with `[left, right]`; the N-ary
    call form calls it with `node.args` directly. Binary is simply the N=2 case.
- **`src/engine/formula/functions.ts`** (modified, +14/−4 lines) — exported the previously-private
  `finiteResult` so this file's arithmetic operators route through the SAME D-033 guard rather than
  a second copy, per that ruling's own binding text ("A future compute path that can produce `-0`
  MUST route through a guard of THAT SHAPE"). Two header additions (one bullet in WHAT THIS IS per
  new export, `finiteResult`'s own comment extended); zero behaviour change to any existing export.
- **`src/engine/formula/eval.test.ts`** (new, 426 lines, 45 tests) — literals/references/`ErrorNode`
  (D-028)/range (disclosed `#PARSE`); arithmetic (all six operators, `#DIV0`, D-033's `-0`
  normalisation, non-finite `#TYPE`, left-then-right error/type-check ordering); comparisons (all
  six operators, same-type only, cross-type `#TYPE`, error propagation); `NOT` (both syntactic
  forms, delegating consistently to `functions.ts`); the **D-029 laziness centerpiece** — `IF`/
  `AND`/`OR`, both syntactic forms, each proven via a `POISON` node (a real `1/0`) placed in the
  UNTAKEN branch/operand and asserting it never surfaces; dispatch-order tests (arity checked
  before laziness matters, an out-of-sync `LAZY_FUNCTION_NAMES` guard); ordinary eager calls
  (dispatch correctness, unknown name `#TYPE`, wrong arity `#TYPE`, left-to-right stop-at-first-
  error, a reference nested inside a call); a full sweep proving every EAGER built-in
  `functions.ts` declares is reachable through `evaluate()` itself, cross-checked against the real
  registry so it cannot silently drift; a malformed-input battery; and capstone integration tests
  building real ASTs via `lex -> parseFormula -> evaluate` (a compound `IF`/comparison/arithmetic
  formula, both `AND` forms agreeing on real parsed input including short-circuiting, a nested
  `ROUND(SQRT(...) + 1, 2)`).

## Decisions I made

1. **A `RangeNode` evaluates to a disclosed, TEMPORARY `#PARSE`** (matching
   `graph/eval.ts`'s own established vocabulary for "this build's evaluator does not support this
   shape yet" — its `evaluateFormula`'s bridge for every non-reference AST shape, deleted only when
   this very file gets wired in). 0035-REVIEW's carried constraint 4 is explicit and specific:
   "A `RangeDependency` expands at edge-derivation time, from current dimensions, every mutation.
   That is Phase 2's wiring, not `eval.ts`'s" — and Finding 4 names "the cycle that flattens a
   `RangeDependency` into evaluated arguments" as that same future cycle's job. I read this as
   binding on `evaluate` itself, not only on `deriveEdges`: expanding a range into concrete cell
   values needs the target table's actual current structure (real column-letter arithmetic beyond
   `Z`, and knowing which cells actually exist), which is exactly the kind of "current table
   dimensions" context this standalone file is never handed. Reversible and cheap to replace: the
   `RangeNode` case is one function, one call site.
2. **`finiteResult` is now EXPORTED from `functions.ts`, reused rather than reimplemented.** D-033's
   own ruling text names the shape ("route through A GUARD OF THAT SHAPE") but reusing the literal
   function (not a second copy with the same logic) is the stronger reading and keeps D-014's "one
   leaf predicate, one place it is applied" property intact for a third caller. Confirmed
   behaviour-preserving: `functions.test.ts`'s existing 44 tests pass unchanged.
3. **Comparisons (`= <> < > <= >=`) require both operands to already be the SAME primitive type**
   (`number`, `string`, or `boolean`); cross-type is `#TYPE`. §5.3 lists the six operators without
   defining cross-type semantics. Strict, same-type-only matches this file's and `functions.ts`'s
   uniform posture elsewhere (`CONCAT`'s own decision) and is additively widenable — a future
   cross-type ordering can be added later without invalidating any formula this build already
   accepts, since every one already satisfies the stricter rule.
4. **`/` and `%` by zero are `#DIV0`, checked explicitly before the JS operator would produce
   `Infinity`/`NaN`.** `#DIV0` is more specific and more useful than the generic `#TYPE`
   `finiteResult` would otherwise report for the same underlying non-finite result, and `#DIV0` is
   already a member of `graph/node.ts`'s `ErrorCode` with no other producer yet.
5. **`NOT` is delegated to `functions.ts`'s own registry entry, not reimplemented.** Both the
   prefix `UnaryOpNode` form and the call `FunctionCallNode` form route through one
   `evaluateNot([operand], read)` — D-009/D-014's "declare once" principle, applied across files
   this time rather than within one.
6. **Eager function-call arguments are evaluated left to right, STOPPING at the first error** —
   not merely relying on `functions.ts`'s own left-to-right propagation over an already-fully-
   evaluated array. This is deliberate belt-and-braces (an argument past a known error is never
   even evaluated) though I could not construct a test that observably distinguishes it from
   "evaluate all, then let `functions.ts` propagate" for `SUM`-shaped calls, since that file's own
   propagation produces the same visible result either way — noted honestly rather than claimed as
   independently mutation-tested (see Verification).

## Verification (real output)

```
$ npm run typecheck
> tsc --noEmit && tsc --noEmit -p tsconfig.engine.json
(clean, no output)

$ npm test -- --run
 Test Files  14 passed (14)
      Tests  430 passed (430)
```
430 total, up from 385 (+45, all new; none changed or removed in any other file — `functions.test.ts`'s
44 tests pass unchanged after exporting `finiteResult`). 0 skipped, 0 `.only`, 0 `it.todo`
(confirmed by `grep -rn "\.only(\|\.skip(\|it\.todo(" src/` — no matches).

## D-016-style mutation checks (not required for an acceptance-criterion claim this cycle — see
Acceptance criteria status below — done anyway, on the two lines judged most load-bearing and most
likely to be "violated by accident" per 0035-REVIEW's own warning)

1. **The arity-check gate in `evaluateFunctionCall` disabled** (`if (!arityCheck.ok)` forced to
   `if (false && !arityCheck.ok)`): `npm test -- --run` → **2 named tests fail** (426/428) — `IF`
   called with 2 args (would otherwise silently succeed, since `evaluateIf`'s own defensive
   fallback only fires when a branch is genuinely `undefined`, and with a TRUE condition and 2 args
   `args[1]` DOES exist) and `AND` called with 0 args. This is exactly the "arity checked before
   laziness matters" ordering 0035-REVIEW's carried constraint 2 requires, confirmed genuinely
   load-bearing rather than redundant with `evaluateIf`'s own defensiveness. Reverted;
   `grep -rn "MUTATION-TEST" src/engine/` clean before and after.
2. **`AND`'s short-circuit line disabled** (`if (value === false) return false;` forced to
   `if (false && value === false)`): **3 named tests fail** (425/428) — both syntactic-form
   short-circuit tests AND the real-pipeline integration test asserting infix/call-form `AND`
   agree on real parsed input. Reverted; grep clean.

## Acceptance criteria status

**Phase 1's criterion is NOT claimed, close but genuinely incomplete.** Every named clause is now
demonstrated somewhere in `formula/*`'s tests EXCEPT one: "ranges in aggregates" is fully
demonstrated at the PARSE level (entry 0031) and at the dependency-extraction level (entry 0033,
`RangeDependency`, unexpanded) but NOT at the EVALUATION level — `SUM(A1:B4)` evaluates to a
disclosed, temporary `#PARSE` in this build (Decision 1), not a real sum. This is not an oversight;
it is 0035-REVIEW-phase1's own explicit, binding scope boundary for this cycle (carried constraint
4). Every other clause — literals, operator precedence, nested `IF`, every built-in, reference
resolution, error propagation, dependency extraction total across both `IF` branches WHILE
evaluation short-circuits (this cycle's own centerpiece test group), and malformed input yielding
`#PARSE` rather than throwing — is demonstrated and, per the mutation checks above, genuinely
load-bearing rather than merely present. Whether the reviewer judges the criterion satisfiable
without real range evaluation, or wants that gap closed first, is exactly the kind of question this
entry surfaces rather than silently resolves.

## Where I got stuck / what is unfinished

Nothing incomplete relative to the declared scope. The one thing worth naming plainly: Decision 6
(stop-at-first-error in the eager argument loop) is written defensively but I could not prove by
mutation that it is independently load-bearing, because `functions.ts`'s own propagation produces
the same result either way for every shape I could construct. I disclosed this rather than writing
a mutation-check section that implied otherwise.

## Open questions raised

None. Nothing here touches an existing open question or raises a new one — every judgment call
above is a disclosed, reversible implementation decision, not a brief ambiguity.

## Review point

**Fired: PROCESS_BRIEF §6.1 trigger 1 (phase gate), per 0035-REVIEW-phase1's own carried
constraint 5** — this is Phase 1's last file, a review point on completion regardless of size.
Independently, the line count (955/3 files) would also exceed the 800/10 cap on its own. Both
reasons point the same direction.

**REVIEW: REQUIRED.** No further cycle should begin — there is no more Phase 1 work to batch
behind it in any case — until this lands.

## Questions for reviewer

1. Is treating `RangeNode` evaluation as out of THIS file's scope (Decision 1) the right reading of
   carried constraint 4, or did that constraint mean only `deriveEdges`/edge-derivation, leaving
   `evaluate` itself expected to implement real range expansion now? I read it as binding on both,
   for the "needs the table's actual current structure" reason stated in Decision 1 — but the
   constraint's own wording ("Phase 2's wiring, not `eval.ts`'s") is about `RangeDependency`
   specifically, which is `deps.ts`'s type, not this file's, so I want this confirmed rather than
   assumed.
2. Is same-type-only comparison (Decision 3) the right default, or should `=`/`<>` at least permit
   comparing any two values for equality (returning `false` for a type mismatch rather than
   `#TYPE`) while `< > <= >=` stay strict? I chose uniform strictness for all six as the simpler
   rule, but equality-across-types-is-just-false is a real, defensible alternative I did not adopt.
3. Does Phase 1's acceptance criterion require real range evaluation to be claimable, or is the
   disclosed `#PARSE` placeholder (matching `graph/eval.ts`'s own established precedent for a
   temporary gap) sufficient to consider Phase 1 functionally complete, with range expansion folded
   into whichever Phase 2 cycle wires the formula engine into real table cells?
