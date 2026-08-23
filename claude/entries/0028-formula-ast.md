# 0028 — formula-ast
Date: 2026-08-23   Phase: 1   Model: implementer (Claude Sonnet 5)
Previous entry: 0027-REVIEW-phase0 (verdict: ACCEPT WITH EDITS — **Phase 0 gate SIGNED OFF**),
commit `d10173c`.

## Declared scope

Widen `formula/ast.ts`'s `FormulaAst` from Phase 0's one-variant stand-in to the full PROJECT_BRIEF
§5.3 v1 grammar, resolving **Q-005** (0006-REVIEW's own binding constraint, executed now that Phase
1 has landed). As a direct, disclosed consequence of that widening — not optional scope — keep
`mutation.ts` (`deriveEdges`) and `graph/eval.ts` (formula-slot evaluation) correctly typed and
behaviorally safe against every new AST shape, since both were written when `FormulaAst` had
exactly one variant. This is `formula/`'s first REAL file (0027-REVIEW's carried constraint 1,
§6.1 trigger 2) — **stop here**; `lexer.ts`/`parser.ts`/`deps.ts`/`functions.ts`/`formula/eval.ts`
are NOT built this cycle.

## Explicitly not in scope

- The lexer, parser, standalone formula evaluator, `extractDependencies`, and the function
  registry — every other `formula/*` file. All later, separate, reviewed cycles.
- Actually WIRING the formula engine into `graph/eval.ts`/table cells — Phase 2's job
  ("wire the formula engine into cell slots"). This cycle's `graph/eval.ts`/`mutation.ts` changes
  are a narrow, temporary correctness patch (fail closed on an AST shape this build cannot yet
  process), not that wiring.
- Resolving whether `AND`/`OR`/`NOT` are operators, functions, or both (raised as **Q-009** — see
  below) — it does not block this cycle since both forms are already representable without
  conflict; it is a `parser.ts`/`functions.ts`-cycle decision.
- Range expansion (`A1:B4` → concrete dependencies) and reference adjustment on table resize —
  Phase 2/4, per the brief's own build order. `RangeNode` now EXISTS in the type; nothing expands
  one yet.

## What I did

**`formula/ast.ts`** — rewritten. `FormulaAst` is now a six-variant union:
`LiteralNode` (number/string/boolean, one node for all three per §5.3's own grouping),
`ReferenceNode` (byte-for-byte unchanged from Phase 0 — pinned by a test), `RangeNode` (an
endpoint pair, never pre-expanded, per §5.3's explicit instruction), `BinaryOpNode` (one node, one
`operator` field spanning the WHOLE precedence chain — precedence is a parser concern, not an
AST-shape one), `UnaryOpNode` (`-`, `NOT`), `FunctionCallNode` (`name: string`, `args:
FormulaAst[]` — `IF` is an ordinary function call per §5.3's own built-ins list, not a dedicated
`ConditionalNode`). Added `isReferenceNode`, the one sanctioned narrowing predicate (D-014).

**`formula/ast.test.ts`** (new file) — 12 tests. Shape tests for every node type, a recursive-
composition test (nested `BinaryOpNode`), a test proving `IF(...)` composes as a `FunctionCallNode`
wrapping a comparison, a test proving a `RangeNode` nests correctly inside an aggregate call's
args, `isReferenceNode`'s discrimination across all six variants, and a deep multi-kind nesting
test (`IF(a > SUM(range), NOT b, -3)`) proving the union composes recursively, not just at one
level.

**`mutation.ts`** — `deriveEdges`'s source-1 loop now narrows `slot.ast` to `ReferenceNode` via
`isReferenceNode` before reading `.address` (the type widening makes this narrowing MANDATORY —
confirmed by compiler error when I removed it, see mutation-check 3 below); any other AST shape is
skipped (no edge derived). `validateIntegrity` gained a FIFTH, deliberately TEMPORARY check —
`findUnsupportedFormulaAsts`, run as check 2 (immediately after D-017, same family: both are about
whether `deriveEdges`'s output can be trusted) — which rejects any `formula`-kind slot whose AST is
not a `ReferenceNode`, naming it via `describeUndeclaredSlot` (D-022's fourth call site). This
closes the exact D-017 hazard shape one more time: without it, a formula slot holding e.g. a
`BinaryOpNode` would get NO edge (deriveEdges can't walk it yet) and nothing would say so — the
document would be silently mis-evaluated rather than rejected. Deleted the moment Phase 2 wires in
a real `extractDependencies`.

**`graph/eval.ts`** — `evaluateSlot`'s `"formula"` case now calls a new `evaluateFormula(ast,
evaluatedValues)`, which narrows to `ReferenceNode` (delegating to the unchanged
`evaluateReference`) or returns `#PARSE` for any other shape — a defensive fallback this file
cannot avoid writing even though `mutation.ts`'s new check makes it provably unreachable for any
document `mutate` accepted: this file cannot see that check run from here, and every other function
in it already fails closed rather than trusting an invariant from elsewhere.

**`mutation.test.ts`** — 6 new tests: rejects a `LiteralNode`-holding formula slot, naming it;
rejects all five non-reference shapes in turn (literal/range/binaryOp/unaryOp/functionCall); does
NOT flag the one supported shape (an ordinary binding); runs before the dangling-reference check
on a document with both problems; rejected via the real `mutate()` entry point with prior state
unchanged; never throws.

**`graph/eval.test.ts`** — 1 new test: `evaluate()` given a formula slot with a non-reference AST
(hand-built, bypassing `mutate`, the same convention the existing L-13 test uses) evaluates to
`#PARSE` rather than throwing.

**`document.test.ts`** — 1 new test: a loaded document whose formula slot's `ast` is a `LiteralNode`
is rejected via `mutate`'s own message — the concrete reachability path this whole mechanism exists
for (`document.ts`'s `reconstructSlot` trusts a formula slot's `ast` content unchecked, so a
hand-edited or foreign save file could carry any shape today; nothing else in this build can
construct one, since no parser is wired up until later Phase 1/Phase 3 work).

## Decisions I made

1. **Building the widened `ast.ts` alone, as the "first real file" checkpoint**, rather than
   batching it with `lexer.ts`/`parser.ts` behind it. 0027-REVIEW's carried constraint 1 says stop
   at the first real file; the AST shape is what every later formula file is built ON, so getting
   it reviewed before more code depends on it is the whole point of the trigger.
2. **Touching `mutation.ts`/`graph/eval.ts` beyond doc-comment updates**, adding a genuinely new
   `validateIntegrity` check rather than leaving a silent, disclosed gap. The type widening makes
   `slot.ast.address` a compile error the instant a second variant exists — SOME narrowing is
   mandatory, not optional. Given that, I chose to close the resulting gap (a formula slot with an
   unsupported AST silently losing its edge) rather than merely narrow-and-skip, because this
   project has hit this exact failure shape three times before (D-017, D-018, and the D-025/D-027
   value-legality rounds) and each time the lesson was "make the disagreement loud, don't let it
   sit as a documented gap." This is a REVERSIBLE implementation decision (deleted whole-cloth once
   Phase 2 lands), not a data-model-shaping one, so I proceeded rather than escalating — but I am
   flagging it as a question below, since it is more than the reviewer's constraint literally asked
   for ("clear the tags"), and I want the boundary confirmed rather than assumed right.
3. **`IF` is an ordinary `FunctionCallNode`, not a dedicated node type.** §5.3 lists it among the
   built-in functions, and the Phase 1 acceptance criterion says "nested `IF`" not "nested
   conditional expression" — a function call that can nest in its own arguments already gives
   nesting for free.
4. **One `LiteralNode` for number/string/boolean, not three node types.** §5.3 groups them as one
   grammar category; `LiteralNode.value: number | string | boolean` is already a proper subset of
   `graph/node.ts`'s `Value`. Rule 5's dumbest-correct shape.
5. **Raised Q-009** rather than guessing whether `AND`/`OR`/`NOT` are operators, functions, or
   both — §5.3 lists them as both, and I could not find a reading of the brief that resolves the
   overlap. Did not block on it: both forms are already representable in the AST without conflict,
   so nothing in THIS cycle needed an answer; deferred to whichever cycle builds `parser.ts`/
   `functions.ts`.

## Verification (real output)

```
$ npm run typecheck
> tsc --noEmit && tsc --noEmit -p tsconfig.engine.json
(clean, both configs)

$ npm test -- --run
 Test Files  9 passed (9)
      Tests  233 passed (233)
```

233/233, up from 213 at 0027-REVIEW's commit (`d10173c`). 0 skipped, 0 `.only`. Breakdown of the
+20: `formula/ast.test.ts` +12 (new file), `mutation.test.ts` 68→74 (+6), `graph/eval.test.ts`
11→12 (+1), `document.test.ts` 25→26 (+1).

## D-016 mutation-check transcripts

Three experiments, each: neutralize → `npm test -- --run` (or `npm run typecheck`) → confirm exact
named failures → revert → confirm `grep -rn "MUTATION-TEST" src/engine/` clean.

**1. `graph/eval.ts`'s `evaluateFormula` non-reference branch** — replaced the whole function body
with an unconditional cast-and-call (`evaluateReference((ast as { address: Address }).address,
...)`), removing the `isReferenceNode` guard entirely. Failed exactly 1, and — worth noting — did
NOT crash the suite; the neutralized code produced a `#REF` (via `evaluateReference`'s own
dangling-address fallback, since `undefined` came out of the bad cast) instead of `#PARSE`,
demonstrating the ORIGINAL branch is genuinely doing something, not merely present:
```
✗ evaluate — a formula slot whose AST is not a ReferenceNode (Q-005/cycle 0028) > evaluates to
  #PARSE rather than throwing
```

**2. `mutation.ts`'s `findUnsupportedFormulaAsts` call in `validateIntegrity`** — replaced with a
hardcoded empty array. Failed exactly 5, all and only the tests naming this mechanism (4 in
`mutation.test.ts`, 1 in `document.test.ts` — the end-to-end load path):
```
✗ validateIntegrity — unsupported formula AST shape... > rejects a formula slot holding a
  LiteralNode...
✗ ...> rejects every non-reference AST shape in turn...
✗ ...> runs before the dangling-reference check...
✗ ...> rejected via the real mutate() entry point...
✗ deserializeDocument — malformed input, never throws > routes a formula slot holding an
  unsupported AST shape... through mutate's own rejection
```
(The "does not flag... ReferenceNode" and "never throws" tests in the same describe block correctly
kept passing — they do not depend on rejection.)

**3. `mutation.ts`'s `deriveEdges` narrowing (`!isReferenceNode(slot.ast)`)** — removed the clause
entirely. This one did NOT need a test run: `npm run typecheck` failed immediately —
```
src/engine/mutation.ts(463,30): error TS2339: Property 'address' does not exist on type
'FormulaAst'.  Property 'address' does not exist on type 'LiteralNode'.
```
This narrowing is COMPILER-enforced, not merely test-enforced — a stronger guarantee than a
mutation-test can demonstrate. Noted here rather than silently treated as "well-tested," per this
project's own "ask both is it load-bearing and is it correct" discipline (D-016's refined lesson):
a compile-time guarantee is a different, stronger kind of proof than a passing test suite, worth
naming as such.

`isReferenceNode` itself was not given a separate mutation-test: `ast.test.ts`'s own
`describe("isReferenceNode", ...)` exercises it directly against all six variants with a single
assertion mapping each to `true`/`false` — full branch coverage by direct unit test already, so a
mutation-test experiment would only re-confirm what that test already proves outright.

All three reverted; `grep -rn "MUTATION-TEST" src/engine/` returns no matches.

## Acceptance criteria status

Phase 1's full criterion ("tests cover literals, operator precedence, nested `IF`, every built-in,
reference resolution, ranges in aggregates, and error propagation — plus... total across both `IF`
branches while evaluation short-circuits, and malformed input yields `#PARSE`") is **NOT claimed
this cycle** — this is `ast.ts` alone, the type shapes the grammar needs, with no lexer/parser/
evaluator/function-registry built yet. None of Phase 1's acceptance criterion is testable without
those. This is the deliberate stopping point 0027-REVIEW's carried constraint asked for.

## Where I got stuck / what is unfinished

Nothing unfinished within the declared scope. The obvious next slice (`lexer.ts`) is deliberately
NOT started — see Review point below.

## Open questions raised

**Q-009** — are `AND`/`OR`/`NOT` operators, functions, or both (§5.3 lists them as both)?
Recommendation: (a) both, meaning the same thing. Not reversible-blocking; deferred to
`parser.ts`/`functions.ts`'s own cycle. Tagged: nowhere yet (nothing commits to an answer today).

**Q-005** — ANSWERED (0006-REVIEW's own ruling, executed this cycle). See OPEN_QUESTIONS.md.

## Review point

**REVIEW: REQUIRED.** `formula/ast.ts` is the first REAL file of the `formula/` subsystem (§6.1
trigger 2, 0027-REVIEW's carried constraint 1) — mandatory regardless of diff size. Stated for the
record: `git diff --numstat d10173c -- src/` reports **557 changed lines across 6 tracked files**,
plus one new untracked file pair (`formula/ast.ts` 193 lines, `formula/ast.test.ts` 165 lines —
already counted in the 557 via `git add`, not double-counted per 0025-REVIEW's own correction of
this project's past arithmetic mistake).

**Do not start `lexer.ts`, `parser.ts`, or any other `formula/*` file until this lands.**

## Questions for reviewer

1. Is adding `findUnsupportedFormulaAsts` (a genuinely new, if temporary, `validateIntegrity`
   check) the right scope for a cycle whose declared job was "widen `FormulaAst`"? The alternative
   — narrow the two call sites just enough to compile, accept the silent "no edge derived" gap for
   a shape nothing in this build can currently produce except via a hand-edited file — would have
   been a smaller diff, and I chose not to take it. Confirm the boundary, or say which was right.
2. Is `IF` as an ordinary `FunctionCallNode` (not a dedicated node type) the right reading of §5.3,
   given "nested `IF`" is Phase 1's own acceptance-criterion wording and `IF` is listed among the
   built-in functions?
3. Q-009 (`AND`/`OR`/`NOT` as operators vs. functions vs. both) — confirm recommendation (a), or
   rule differently, before `parser.ts` needs an answer.
