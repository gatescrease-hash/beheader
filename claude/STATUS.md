# STATUS — as of entry 0034-formula-functions

STATE: GREEN (compiles under both configs, 382/382 tests pass, 0 skipped, 0 `.only`). **Cycles
0033 and 0034 are UNREVIEWED. Process state: REVIEW REQUIRED before the next cycle begins** — the
§6.3 batch cap is mechanically exceeded (see below). **Do not start `formula/eval.ts`, or any
other new slice, until this lands.**

Current phase: **1 — Formula engine (`formula/*`), standalone.** Phase 0 is COMPLETE and SIGNED OFF
(0027-REVIEW-phase0). Last review point: **0032-REVIEW-phase1, verdict ACCEPT WITH EDITS** — three
latent defects fixed (`isParseError` vs `ErrorNode`, a hand-built cell path, the engine's only
`throw`) and three rulings: **D-030** (`^` left-associative), **D-031** (numbers in stored ASTs),
**D-032** (error predicates). Cycles since last review: **2/3** · diff since last review: **1176
lines / 5 files** — **EXCEEDS the 800/10 cap.** (393/2 from cycle 0033 + 783/3 from cycle 0034: 760
lines in two new files, `functions.ts`/`functions.test.ts`, plus a 23-line disclosed refactor of
`parser.ts`.) Entry 0033's own hand-off note predicted this before cycle 0034 began: "very likely
denser than the ~400 lines of remaining headroom... worth ending the batch immediately after it."

## Next slice — BLOCKED pending review
`formula/eval.ts` (the evaluator — lazy/short-circuit, per §5.3/D-029) is the last file Phase 1
needs, but **must not start until 0033/0034 are reviewed.** Three questions are open for the
reviewer in entry 0034's own "Questions for reviewer" section (uniform `isIllegalNumber` guarding
on every eager function vs. per-function reasoning; `AND`/`OR`'s arity minimum of 1 vs. 2; whether
folding `parser.ts`'s aggregate-name set into this cycle, rather than a separate one, was right).

## Built
- Scaffold, `graph/node.ts`, `graph/edge.ts`, `primitives/schema.ts`, `graph/cycles.ts`,
  `graph/eval.ts`, `mutation.ts`, `document.ts` — all reviewed and unchanged in substance since
  0029-REVIEW. See entries 0025–0029 for detail; not repeated here.
- **`address.ts`** (45 tests, unchanged this cycle) — see 0032-REVIEW for `bareCellAddress`.
- **`formula/ast.ts`** (14 tests) — unchanged this cycle.
- **`formula/lexer.ts`** (36 tests) — unchanged this cycle.
- **`formula/parser.ts`** (49 tests) — cycle 0034 made ONE small, disclosed, behaviour-preserving
  change: its former local `AGGREGATE_FUNCTION_NAMES` `Set` is now an import of `functions.ts`'s
  `RANGE_ACCEPTING_FUNCTION_NAMES` (same four names, same behaviour — confirmed by the unchanged
  test suite). See entry 0031/0032-REVIEW for everything else; unchanged in substance.
- **`formula/deps.ts`** (20 tests, cycle 0033) — `extractDependencies(ast): readonly Dependency[]`.
  Eager, total walk of the whole `FormulaAst` (§5.3, D-029): both `IF` branches, both syntactic
  forms of `AND`/`OR`/`NOT`, zero special-casing by function name. `Dependency` is
  `ReferenceDependency | RangeDependency` — a `RangeNode` is reported as its own endpoint-pair
  shape, NOT expanded into individual cells (expansion needs a table's current dimensions and
  happens at edge-derivation time, per §5.3 — a disclosed design decision, no consumer yet). Not
  deduplicated. `ErrorNode`/`LiteralNode` yield nothing. Never throws. NOT wired into
  `mutation.ts`'s `deriveEdges` or `graph/eval.ts` this cycle (Phase 2 work).
- **`formula/functions.ts`** (41 tests, cycle 0034) — `FUNCTION_REGISTRY`: all 23 §5.3 built-ins,
  `name → arity → implementation`. `IF`/`AND`/`OR` are `LazyFunctionEntry` (name/arity only, NO
  `implementation` field — D-029, enforced structurally by the discriminated union, not just by
  convention). `NOT` is D-029's one eager exception. Every eager implementation propagates the
  first upstream error, type-checks its arguments (`#TYPE`, naming the bad argument's position),
  and guards its numeric result with `finiteResult` (D-025 non-finite AND Q-008 `-0`, via the
  shared `isIllegalNumber` predicate). Also exports `RANGE_ACCEPTING_FUNCTION_NAMES`,
  `LAZY_FUNCTION_NAMES`, and `checkArity`. NOT wired into any evaluator yet — see file header.

## Acceptance criterion — Phase 0, all four PASSING and REVIEWED (unchanged, see 0027-REVIEW)
Phase 1's criterion is NOT YET claimed. Demonstrated so far, in isolation: literals, precedence,
nested IF, reference resolution, ranges in aggregates, #PARSE-not-throw (parser, entry 0031);
eager/total dependency extraction across both IF branches and both AND/OR/NOT forms (deps, entry
0033); every built-in computing correctly, propagating errors, and failing closed (functions,
entry 0034). NOT yet demonstrated: lazy/short-circuit evaluation itself (`eval.ts` unbuilt, and
blocked pending review — see above).

## Known problems
- **`findUnsupportedFormulaAsts` (mutation.ts) and `evaluateFormula`'s `#PARSE` branch
  (graph/eval.ts) are BOTH temporary** (carried, unchanged) — delete both, and `deriveEdges`'s
  matching narrowing, the moment Phase 2 wires in the real `formula/eval.ts`. `deps.ts`/
  `functions.ts` existing does NOT change this; wiring either into `deriveEdges`/`graph/eval.ts` is
  explicitly Phase 2 work.
- **`camera` has no WRITE-side guard** (D-027, carried).
- **The journal's STRUCTURE is deliberately unvalidated** beyond `Array.isArray` (carried).
- **L-16, L-17/L-18/L-14, §5.11's `style` field, `nextObjectId` reconciliation, `noUnusedLocals`
  off, L-6–L-15 cosmetics, recursion depth, table/`cells` hardcoding — all carried unchanged.**
- **`lexer.ts`'s two disclosed edge cases** (carried, unchanged — see prior STATUS revisions).
- **`^` (exponentiation) is left-associative — RULED, D-030.** Do not "correct" it.
- **A `LiteralNode`'s `value` inside a stored AST is unchecked document state (D-031)** — carried,
  unchanged; still unreachable today only because `findUnsupportedFormulaAsts` rejects every
  non-reference AST shape.
- **`formula/deps.ts`'s `RangeDependency` shape has no consumer yet** (carried from 0033) —
  pinned by tests inside `deps.test.ts` only.
- **NEW: `functions.ts`'s registry has no consumer yet either** — `checkArity` and every
  `implementation` are tested directly, by calling them from the test file, not through any real
  evaluation path. `eval.ts` (blocked, see above) is what will actually call these.
- **SETTLED, do not re-raise:** everything 0029/0032-REVIEW's STATUS already listed settled (see
  prior revisions — precedence chain, D-029 dispatch, range-placement-as-post-parse-walk,
  `SUM((A1:B4))`'s acceptance, dependency extraction needing no per-name special-casing, a
  `RangeNode` reported pre-expansion), plus now: function names are matched case-sensitively,
  uppercase-only (consistent with the pre-existing `AGGREGATE_FUNCTION_NAMES`/
  `RANGE_ACCEPTING_FUNCTION_NAMES` precedent — not a fresh guess); `CONCAT` requires string
  arguments with no implicit coercion.

## Live PROVISIONAL tags and open questions
**`PROVISIONAL(Q-007)`** → `document.ts`'s `CameraState`. **`PROVISIONAL(Q-008)`** →
`graph/node.ts`'s `isIllegalNumber`. **Q-009** ANSWERED → D-029. **Q-005** ANSWERED. **Q-006**
ANSWERED → D-025. **Q-001/Q-002** (Phase 3), **Q-004** (Phase 2, inherited unchanged) deferred.
**Q-003** → D-007. No new question raised this cycle. Next free: **Q-010**.

## Gotchas for the next model
- **STOP: do not start a new slice.** Cycles 0033/0034 need review first (§6.3's line cap is
  exceeded: 1176/800). Read entry 0034's "Questions for reviewer" section before anything else.
- **Batch discipline, restated a third time now:** 0032-REVIEW's own STATUS text already warned
  "end a batch before starting any cycle that cannot fit the remaining headroom" after the PRIOR
  batch reached 2.2× the cap the same way (a moderate cycle followed immediately by the phase's
  densest file). It happened again this batch, predicted correctly in entry 0033's own hand-off
  note but not avoided, because there was still nominal headroom (393/800) and the next file was
  the declared next slice. Take from this: predicting a dense file correctly is not the same as it
  fitting — when a hand-off note names a specific risk, prefer treating that file as review-gated
  on completion regardless of the arithmetic at the START of the cycle.
- **`functions.ts`'s registry is data with no consumer yet** — reading its own file header before
  wiring it into `eval.ts` is essential: the `LazyFunctionEntry`/`EagerFunctionEntry` split exists
  specifically so `eval.ts` can special-case `LAZY_FUNCTION_NAMES` and never accidentally call an
  `implementation` that does not exist for `IF`/`AND`/`OR`.
- **`parser.ts` does NOT validate function names or arity** — `FOO(1,2,3)` parses successfully.
  `functions.ts`'s `getFunctionEntry`/`checkArity` exist now but are not wired into anything that
  rejects an unknown name yet — that's `eval.ts`'s (or a future command layer's) job.
- **Range placement (`parser.ts`) and range DEPENDENCY reporting (`deps.ts`) are different
  concerns** — don't conflate them (carried from 0033).
- **`^` is left-associative (D-030, ruled), `AND`/`OR`/`NOT`'s dual-form dispatch lives in
  `parser.ts`'s `parsePrimaryExpr`/`parseUnaryExpr`** — read entry 0031 and D-030 before touching.
- **An error-shaped type predicate discriminates on the CODE, never on the presence of an `error`
  field (D-032).** `isAddressError` is correct only because its domain has no `error` field.
- **`src/engine/` contains no `throw`, and should stay that way.**
- **D-029, still binding, still not implemented in any evaluator**: `IF`/`AND`/`OR` MUST be
  evaluated lazily by `formula/eval.ts` itself, never by a `functions.ts` registry entry — `NOT` is
  the one exception. `deps.ts` is eager/total over both forms; `functions.ts`'s registry now
  structurally FORBIDS an eager `IF`/`AND`/`OR` implementation (no `implementation` field exists to
  write one into) — both halves of D-029 are now enforced by the type system, not only by rule.
- **`isCellReferenceForm`/`bareCellAddress` (address.ts) are the ONLY sanctioned way to detect/build
  a bare cell-ref-shaped segment outside `address.ts` itself.**
- **`ErrorNode` still exists but nothing constructs one yet, deliberately (D-028)** — unchanged.
- Each PowerShell call is a fresh process; the Bash tool's `npm` is not on PATH — use PowerShell.
