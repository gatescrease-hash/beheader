# STATUS — as of entry 0035-REVIEW-phase1

STATE: GREEN (compiles under both configs, 385/385 tests pass, 0 skipped, 0 `.only`).
**Cycles 0033 and 0034 are REVIEWED — verdict ACCEPT WITH EDITS (entry 0035-REVIEW-phase1).
`formula/eval.ts` is UNBLOCKED and is the next slice.**

Current phase: **1 — Formula engine (`formula/*`), standalone.** Phase 0 is COMPLETE and SIGNED OFF
(0027-REVIEW-phase0). Last review point: **0035-REVIEW-phase1, ACCEPT WITH EDITS** — two defects
fixed in `functions.ts` (a computed `-0` reported as `#TYPE`; a prototype-chain registry lookup that
ends in a thrown `TypeError`), one header over-claim corrected, one `ast.ts` line corrected, and
three rulings: **D-033** (a computed `-0` normalises to `+0`; only a non-finite result errors),
**D-034** (a registry keyed by user text is looked up by own property), **D-035** (`IF` takes
exactly 3 arguments; `AND`/`OR` at least 1).
Cycles since last review: **0/3** · diff since last review: **0 lines / 0 files** (cap 800/10).

## Next slice
**`formula/eval.ts`** — the evaluator: lazy, short-circuiting, per §5.3 and D-029. It is Phase 1's
last file and its **phase gate**, so it is a §6.1 trigger-1 review point on completion regardless of
size: end the batch there and batch nothing behind it. Read 0035-REVIEW-phase1 §9 first — it lists
the five constraints that cycle has to satisfy, starting with the one that gets violated by
accident (dispatching `IF`/`AND`/`OR` through the registry instead of at the call site).

## Built and reviewed
- Scaffold, `graph/node.ts`, `graph/edge.ts`, `primitives/schema.ts`, `graph/cycles.ts`,
  `graph/eval.ts`, `mutation.ts`, `document.ts` — reviewed, unchanged in substance since 0029.
  See entries 0025–0029 for detail; not repeated here.
- **`address.ts`** (45 tests) — unchanged this batch.
- **`formula/ast.ts`** (14 tests) — one header line corrected at 0035-REVIEW (`IF` is exactly 3
  args, D-035); no code change.
- **`formula/lexer.ts`** (36 tests) — unchanged this batch.
- **`formula/parser.ts`** (49 tests) — its former local `AGGREGATE_FUNCTION_NAMES` set is now an
  import of `functions.ts`'s `RANGE_ACCEPTING_FUNCTION_NAMES` (same four names, same behaviour;
  the fold-in two prior reviewed entries anticipated). Reviewed and approved at 0035-REVIEW.
- **`formula/deps.ts`** (20 tests, cycle 0033) — `extractDependencies(ast)`: eager, total walk of
  the whole `FormulaAst` (§5.3, D-029) — both `IF` branches, both syntactic forms of
  `AND`/`OR`/`NOT`, zero special-casing by name. A `RangeNode` is reported as its own endpoint-pair
  `RangeDependency`, NOT expanded (expansion needs current table dimensions and belongs at
  edge-derivation time — **approved at 0035-REVIEW**). Not deduplicated. Never throws. Accepted
  with no changes. NOT wired into `deriveEdges`/`graph/eval.ts` — Phase 2.
- **`formula/functions.ts`** (44 tests, cycle 0034 + 0035-REVIEW's edits) — `FUNCTION_REGISTRY`:
  all 23 §5.3 built-ins, name to arity to implementation. `IF`/`AND`/`OR` are `LazyFunctionEntry`
  (no `implementation` field exists to write one into — D-029 enforced by the compiler); `NOT` is
  the one eager exception. Every eager implementation propagates the first upstream error,
  type-checks its arguments, and routes its result through `finiteResult`. Also exports
  `RANGE_ACCEPTING_FUNCTION_NAMES`, `LAZY_FUNCTION_NAMES`, `getFunctionEntry`, `checkArity`.
  NOT wired into any evaluator yet.

## Not started
`formula/eval.ts` (next). Everything in Phase 2 onward.

## Acceptance criteria
Phase 0: all four PASSING and REVIEWED (unchanged, see 0027-REVIEW).
Phase 1: NOT YET claimed. Demonstrated in isolation so far — literals, precedence, nested `IF`,
reference resolution, ranges in aggregates, `#PARSE`-not-throw (entry 0031); eager/total dependency
extraction across both `IF` branches and both `AND`/`OR`/`NOT` forms (entry 0033); every built-in
computing correctly, propagating errors, and failing closed (entry 0034, corrected at 0035-REVIEW).
NOT demonstrated: lazy/short-circuit evaluation itself — `eval.ts` is unbuilt.

## Known problems
- **NEW (0035-REVIEW, finding 4, NOT fixed):** `MIN`/`MAX` use `Math.min(...numbers)`, which throws
  `RangeError` on a very large argument list. Unreachable today — nothing flattens a range into
  arguments yet — and Rule 5 says do not optimise, so it stays. **The cycle that flattens a
  `RangeDependency` into evaluated arguments owns it**, because that is the cycle that makes the
  list arbitrarily long, and a `RangeError` would be a throw inside `engine/`.
- **`findUnsupportedFormulaAsts` (mutation.ts) and `evaluateFormula`'s `#PARSE` branch
  (graph/eval.ts) are BOTH temporary** (carried) — delete both, and `deriveEdges`'s matching
  narrowing, the moment Phase 2 wires in the real `formula/eval.ts`. `deps.ts`/`functions.ts`
  existing does NOT change this.
- **`functions.ts`'s registry and `deps.ts`'s `RangeDependency` have no consumer yet** — both are
  tested by direct call from their own test files, not through any real evaluation path. `eval.ts`
  is what will exercise them.
- **`camera` has no WRITE-side guard** (D-027, carried).
- **The journal's STRUCTURE is deliberately unvalidated** beyond `Array.isArray` (carried).
- **L-16, L-17/L-18/L-14, §5.11's `style` field, `nextObjectId` reconciliation, `noUnusedLocals`
  off, L-6–L-15 cosmetics, recursion depth, table/`cells` hardcoding — all carried unchanged.**
- **`lexer.ts`'s two disclosed edge cases** (carried, unchanged).
- **`^` (exponentiation) is left-associative — RULED, D-030.** Do not "correct" it.
- **A `LiteralNode`'s `value` inside a stored AST is unchecked document state (D-031)** — carried.
- **SETTLED, do not re-raise:** everything 0029/0032-REVIEW listed settled; plus function names are
  matched case-sensitively, uppercase-only; `CONCAT` requires string arguments with no implicit
  coercion; a `RangeNode` is reported pre-expansion; `IF`/`AND`/`OR` arity (D-035).

## Live PROVISIONAL tags and open questions
**`PROVISIONAL(Q-007)`** → `document.ts`'s `CameraState`. **`PROVISIONAL(Q-008)`** →
`graph/node.ts`'s `isIllegalNumber` — still open, still provisional; **D-033 narrows only the
COMPUTE-side answer** (a computed `-0` normalises to `+0`), and `mutate` still rejects an authored
`-0` exactly as before. **Q-009** ANSWERED → D-029. **Q-005** ANSWERED. **Q-006** ANSWERED → D-025.
**Q-001/Q-002** (Phase 3), **Q-004** (Phase 2) deferred. **Q-003** → D-007. No new question raised
this batch. Next free: **Q-010**.

## Gotchas for the next model
- **Read 0035-REVIEW-phase1 §9 before writing a line of `eval.ts`.** Five constraints, and the
  first one (D-029: dispatch `LAZY_FUNCTION_NAMES` at the call site, BEFORE any registry lookup, in
  both syntactic forms) is the one this design gets wrong by accident. The registry cannot save you
  — `IF`/`AND`/`OR` have no `implementation` to call, deliberately.
- **A compute result of `-0` normalises to `+0` (D-033); a non-finite result is `#TYPE` (D-025).**
  One shared guard (`finiteResult`), never re-derived per function. Do not "restore" the old
  behaviour: it made `CEIL(-0.5)` and `ROUND(-0.4, 0)` return errors.
- **Look up a registry by `Object.hasOwn`, never a bare index (D-034)** — `parser.ts` validates no
  function name, so `toString(1)` reaches `getFunctionEntry` as ordinary user text.
- **`parser.ts` does NOT validate function names or arity** — `FOO(1,2,3)` parses successfully.
  Rejecting an unknown name is `eval.ts`'s (or a future command layer's) job.
- **Range placement (`parser.ts`) and range DEPENDENCY reporting (`deps.ts`) are different
  concerns** — don't conflate them (carried).
- **An error-shaped type predicate discriminates on the CODE, never on the presence of an `error`
  field (D-032).**
- **`src/engine/` contains no `throw`, and should stay that way** — 0035-REVIEW found one latent
  path to a `TypeError` and closed it; that is the standard being held to here.
- **`isCellReferenceForm`/`bareCellAddress` (address.ts) are the ONLY sanctioned way to detect or
  build a bare cell-ref-shaped segment outside `address.ts` itself.**
- **`ErrorNode` still exists but nothing constructs one yet, deliberately (D-028).**
- **Batch discipline, for the third time:** two consecutive batches have blown the §6.3 line cap
  (2.2x, then 1.5x), both by starting a known-dense file with nominal headroom left. `eval.ts` is a
  phase gate anyway — it ends the batch by rule, not by arithmetic.
- Each PowerShell call is a fresh process; the Bash tool's `npm` is not on PATH — use PowerShell.
