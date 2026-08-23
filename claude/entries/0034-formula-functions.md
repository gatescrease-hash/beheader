# 0034 — formula functions

Date: 2026-08-23   Phase: 1   Model: implementer (Claude Sonnet 5)
Previous entry: 0033-formula-deps (implementer, REVIEW: NOT NEEDED)
Batch: cycle 2 of up to 3 since 0032-REVIEW-phase1; **1176 lines / 5 files changed (`src/` only)
since the last review point — exceeds the §6.3 cap (800/10) on the line dimension.** Review is
mandatory regardless of §6.1. (Predicted in entry 0033's own hand-off note: "very likely denser
than the ~400 lines of remaining headroom... worth ending the batch immediately after it." It was.)

## Declared scope

Build `formula/functions.ts`: §5.3's table-driven built-in registry (name → arity →
implementation) for all 23 named built-ins, upholding D-029's binding rider that `IF`/`AND`/`OR`
get NO eager implementation (registered for name/arity only) while `NOT` gets an ordinary one.

## Explicitly not in scope

`formula/eval.ts` — not built; nothing here is wired to a live evaluator, `mutation.ts`, or
`graph/eval.ts`. No actual lazy/short-circuit evaluation (that's `eval.ts`'s job). No range
expansion (unrelated to this file; `deps.ts`/`eval.ts`'s later concern).

## What I did

- **`src/engine/formula/functions.ts`** (new, 480 lines) — `FUNCTION_REGISTRY`, a
  `Record<string, FunctionEntry>` covering all 23 §5.3 built-ins. `FunctionEntry` is a
  discriminated union: `EagerFunctionEntry` (name, arity, `acceptsRangeArgument`, and an
  `implementation: (args: readonly Value[]) => Value`) and `LazyFunctionEntry` (same shape, minus
  `implementation` — structurally absent, not merely unused, for `IF`/`AND`/`OR` per D-029). `NOT`
  is the one eager exception. Every eager implementation follows `primitives/schema.ts`'s `add`
  compute function's own established shape: propagate the first upstream `ErrorValue` (left to
  right), type-check remaining arguments (one `#TYPE` per bad argument, naming its 1-based
  position), compute, then route the result through `finiteResult` — the SAME `isIllegalNumber`
  predicate (`graph/node.ts`, D-014) `mutation.ts`'s D-025/Q-008 checks already use. Every
  implementation is also defensive against too few arguments (a missing `args[index]` reads as
  `undefined` and returns `#TYPE` rather than crashing) — belt-and-braces alongside the separate
  `checkArity` function, matching D-017's layered-validation posture. Also exports
  `RANGE_ACCEPTING_FUNCTION_NAMES` and `LAZY_FUNCTION_NAMES` (derived from the registry, single
  source of truth) and `checkArity(name, arity, argCount)` (same "report which rule failed" shape
  as `address.ts`'s `checkNameAvailable`).
- **`src/engine/formula/functions.test.ts`** (new, 280 lines, 41 tests) — registry
  completeness (all 23 names present, no more, no fewer; case-sensitive lookup); D-029's structural
  guarantees (`IF`/`AND`/`OR` are `evaluationMode: "lazy"` with no `implementation` property; `NOT`
  is eager and callable; `LAZY_FUNCTION_NAMES` is exactly `{IF, AND, OR}`); `RANGE_ACCEPTING_
  FUNCTION_NAMES` is exactly `{SUM, MIN, MAX, AVG}`; `checkArity`'s exact/at-least branches, both
  pass and fail cases, pluralisation; per-function correctness tests for all 20 eager built-ins
  (normal computation, error propagation, type-mismatch `#TYPE`, missing-argument `#TYPE`, and —
  where a real, reachable non-finite/`-0` case exists — `SQRT(-1)`, `ROUND(-0.4, 0)`, `POW(0, -1)`);
  a malformed-input battery proving every eager `implementation` never throws.
- **`src/engine/formula/parser.ts`** (modified, net −1 line) — folded `parser.ts`'s own former
  `AGGREGATE_FUNCTION_NAMES` local `Set` into an import of this file's new
  `RANGE_ACCEPTING_FUNCTION_NAMES`, closing the disclosed duplication both entry 0031's decision 6
  and `parser.ts`'s own header explicitly flagged as "expected to fold into `functions.ts`'s
  registry once it exists." Pure refactor: the recognised name set is byte-identical before and
  after (`SUM`/`MIN`/`MAX`/`AVG`), so no `parser.test.ts` expectation moved — confirmed by the full
  suite still passing unchanged. Both affected header-comment blocks updated to say so.

## Decisions I made

1. **Function names are matched case-sensitively, uppercase-only** (`getFunctionEntry("sum")` is
   `undefined`). Not a fresh guess: `parser.ts`'s own, already-reviewed `AGGREGATE_FUNCTION_NAMES`
   was ALREADY case-sensitive-uppercase in shipped code before this cycle. A case-insensitive
   registry here would create a real inconsistency (`sum(...)` recognised as a call, but not as
   legal for a range argument) — matching the existing precedent was the only choice that avoids
   introducing it, and it's the safe, reversible direction besides (same standing as Q-004).
2. **`CONCAT` requires every argument to already be a `string` — no implicit coercion.** The brief
   doesn't specify either way. PROJECT_BRIEF §9's own tie-breaker order settles it: "(4) whatever
   is simplest to delete later." Coercion is a pure widening to add later; removing it once
   formulas depend on it would not be. Strict typing is also this file's uniform posture for every
   other argument (`NOT`'s boolean, every numeric function's number) — CONCAT isn't a special case.
3. **`IF` has exact arity 3; `AND`/`OR` have arity "at least 1."** The brief writes `IF(cond,
   trueVal, falseVal)` with all three named and every existing test in this codebase (parser.ts's
   own `IF` tests) always supplies 3 — no 2-arg-IF variant is stated or tested anywhere, so I did
   not invent one. `AND`/`OR`'s minimum of 1 (rather than 2) matches Excel's own permissive
   single-argument behaviour (D-030's own precedent: where §5.3 is silent, Excel is the
   tie-breaker) and costs nothing to widen or narrow later — this binds only `checkArity`, which
   nothing calls yet.
4. **Every eager implementation guards its result with `finiteResult` (D-025 AND Q-008), not just
   D-025's non-finite half.** `add`'s own compute function (the only prior precedent) explicitly
   does NOT guard `-0`, with a documented reason specific to `+`. That reasoning does not transfer
   here: `ROUND(-0.4, 0)` is a real, reachable `-0` (`Math.round(-0.4) === -0` in JS) this file
   would otherwise let through. Verified by mutation check (below) that this guard is genuinely
   load-bearing for three distinct cases (`SQRT(-1)`'s NaN, `ROUND`'s `-0`, `POW(0,-1)`'s
   `Infinity`), not merely decorative.
5. **Folded `parser.ts`'s `AGGREGATE_FUNCTION_NAMES` into this file's `RANGE_ACCEPTING_FUNCTION_
   NAMES` in the same cycle**, rather than leaving the disclosed duplication for a future one.
   Both already-reviewed entries (0031, and `parser.ts`'s own header) named this as the concrete
   next step once `functions.ts` existed; deferring it further would have meant re-disclosing the
   same debt a third time for no reason. Confirmed behaviour-preserving by the unchanged
   `parser.test.ts` suite passing as-is.

## Verification (real output)

```
$ npm run typecheck
> tsc --noEmit && tsc --noEmit -p tsconfig.engine.json
(clean, no output)

$ npm test -- --run
 Test Files  13 passed (13)
      Tests  382 passed (382)
```
382 total, up from 341 (+41, all new; none changed or removed — including every `parser.test.ts`
test, unchanged by the `AGGREGATE_FUNCTION_NAMES` fold-in). 0 skipped, 0 `.only`, 0 `it.todo`
(confirmed by `grep -rn "\.only(\|\.skip(\|it\.todo(" src/` — no matches).

## D-016-style mutation checks (not required for an acceptance-criterion claim this cycle — see
Acceptance criteria status below — done anyway, on the three lines judged least obviously correct
on inspection alone)

1. **`asNumber`'s error-propagation check removed** (the `isErrorValue(value)` early-return
   deleted): `npm test -- --run` → **2 named tests fail** (380/382) — `SUM`'s and `ROUND`'s
   "propagates ... upstream error" tests. Every other test unaffected (in particular, `NOT`'s own
   propagation test, which goes through the separate `asBoolean` helper, still passed — confirming
   the two helpers are genuinely independent, not accidentally sharing one guard). Reverted;
   `grep -rn "MUTATION-TEST" src/engine/` clean before and after.
2. **`finiteResult`'s `isIllegalNumber` guard removed** (returns the raw value unchecked): **3
   named tests fail** (379/382) — `SQRT(-1)`, `ROUND(-0.4, 0)`, and `POW(0, -1)`, exactly the three
   cases Decision 4 above claims are real and reachable. Reverted; grep clean.
3. **`checkArity`'s two mismatch branches disabled** (`if (false && ...)` guarding each): **3 named
   tests fail** (379/382) — the exact-mismatch test, the at-least-mismatch test, and the
   pluralisation test. Reverted; grep clean.

## Acceptance criteria status

Phase 1's criterion is NOT claimed. This cycle demonstrates, in isolation, "every built-in" (§6's
own acceptance wording) computing correctly, propagating errors, and failing closed on a bad
argument or an illegal result — but NOT lazy/short-circuit evaluation itself, which needs
`eval.ts`, still unbuilt, to actually dispatch `LAZY_FUNCTION_NAMES` and call into this registry.

## Where I got stuck / what is unfinished

Nothing incomplete. The one real judgment call beyond ordinary implementation (Decision 5, folding
`parser.ts`'s aggregate-name set into this file) was flagged by two PRIOR, already-reviewed
entries as the expected next step — I did not have to guess whether it was in scope, only confirm
it was safe (it is: behaviour-identical, confirmed by the unchanged test suite).

## Open questions raised

None. Nothing here touches an existing open question or raises a new one.

## Review point

**Fired: §6.3's batch cap, on the line dimension.** 1176 lines / 5 files changed since
0032-REVIEW-phase1 (393/2 from cycle 0033, plus 783/3 from this cycle — 760 in two new files, 23 in
`parser.ts`), against an 800/10 cap. No single §6.1 trigger fired independently (this is an
ordinary file inside the already-reviewed `formula/` subsystem; the `parser.ts` touch is a
disclosed, behaviour-preserving refactor two prior reviewed entries already anticipated; no test
expectation changed; no new dependency/config), but the cap makes review mandatory regardless — and
entry 0033's own hand-off note predicted exactly this outcome before writing a line of this file.

**REVIEW: REQUIRED** — batch cap exceeded (1176/800 lines). No further implementer cycle
(`formula/eval.ts` above all) should begin until this lands.

## Questions for reviewer

1. Is guarding EVERY eager function's result with the full `isIllegalNumber` check (non-finite AND
   `-0`, Decision 4) the right default, or should some functions (e.g. `LEN`, which returns a
   non-negative integer and can structurally never produce `-0` or a non-finite result) skip the
   check as dead code? I judged uniform guarding simpler and more defensible than reasoning
   per-function about which ones structurally cannot need it (`add`'s own header shows how easy
   that reasoning is to get subtly wrong for one operator; I did not want to repeat it 20 times).
2. Is `AND`/`OR`'s arity minimum of 1 (Decision 3) the right call, or should it be 2 (a boolean
   combinator over a single argument is a degenerate case nothing in this codebase's tests
   exercises)? Nothing consumes `checkArity` yet, so this is cheap to revisit before `eval.ts` ever
   calls it for real.
3. Was folding `parser.ts`'s `AGGREGATE_FUNCTION_NAMES` into this cycle (Decision 5) the right
   call, or should a behaviour-preserving refactor of an already-reviewed file still have waited
   for an explicit go-ahead even when two prior entries anticipated it?
