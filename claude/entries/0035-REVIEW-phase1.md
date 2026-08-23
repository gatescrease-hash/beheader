# 0035 — REVIEW (phase 1)
Date: 2026-08-23   Phase: 1   Model: reviewer (Claude Opus 5)
Previous entry: 0034-formula-functions   Last review: 0032-REVIEW-phase1 (ACCEPT WITH EDITS)
Reviewed: the diff since `b0a88cb` (0032-REVIEW) — cycles 0033 (`formula/deps.ts`) and 0034
(`formula/functions.ts` + a 23-line `parser.ts` refactor), 1164 insertions / 12 deletions across
5 files — plus both log entries, `STATUS.md`, and `OPEN_QUESTIONS.md`.

## Verdict

**ACCEPT WITH EDITS.** Two real defects found and fixed here, both in `functions.ts`, both
reachable from ordinary user text once `eval.ts` exists; three rulings recorded (**D-033**,
**D-034**, **D-035**). `deps.ts` needed no change. Phase 1 may continue: **`formula/eval.ts` is
UNBLOCKED.**

## 1. Rule audit

- **Rule 1 (engine is pure)** — upheld. `grep` for `document.`/`window.`/`canvas`/`render/` across
  the three changed source files hits comment text only (each file's own "NEVER imports" header
  line and prose about `document.ts`). Both configs typecheck, including `tsconfig.engine.json`
  with `lib: ["ES2022"]` and no DOM.
- **Rule 2 (state change through `mutation.ts`)** — not touched. Neither new file holds or writes
  state; `functions.ts` is a table of pure functions, `deps.ts` a pure walk.
- **Rule 3 (addressing)** — upheld. `deps.ts` passes `Address` values through unmodified and never
  constructs or parses one; no user-facing name appears anywhere in either new file.
- **Rule 4 (one formula engine)** — upheld, and worth stating plainly since this is the cycle where
  it could have gone wrong: `functions.ts` is a registry, not a second evaluator. It computes only
  from already-evaluated `Value`s and contains no AST walk at all.
- **Rule 5 (dumbest correct implementation)** — upheld. No memoisation, no dispatch cleverness, no
  dedup in `deps.ts` (correctly justified against `deriveEdges`'s own precedent).
- **Rule 6 (slot set fixed during evaluation)** — not touched.
- **Rule 7 (§8 deferred list)** — not touched.

## 2. Invariant audit

- **Eager/total dependency extraction** — upheld, and this is the diff's strongest work. `deps.ts`
  recurses into every `FunctionCallNode` arg and every operand unconditionally and never reads
  `node.name`, so §5.3's totality and D-029's dual-form rider hold *by construction* rather than by
  a rule the next reader could delete. The test group naming both `IF` branches and each
  `AND`/`OR`/`NOT` form pins it.
- **Lazy evaluation (D-029)** — upheld structurally, which is better than upheld by convention.
  `LazyFunctionEntry` has no `implementation` field to write into, so an eager `IF` is now a
  compile error, not a review finding. `NOT` is correctly the one exception.
- **A range is stored as an endpoint pair, expanded at edge-derivation time** — upheld.
  `RangeDependency` (Decision 1 of 0033) is the correct reading of §5.3 and is explicitly
  approved: expansion needs the table's current dimensions, which `extractDependencies(ast)` is
  never handed. Binding for the cycle that wires this up: `deriveEdges` expands a
  `RangeDependency` from CURRENT dimensions on every mutation and must never cache the expansion.
- **Errors never throw across the evaluation loop** — upheld in `deps.ts` (exhaustive `switch`,
  no-throw `default`); **violated in `functions.ts` before this review** — see Finding 2.
- **Graph state plain and serializable** — upheld; nothing here is stored in a `Document`.
- Rejection-leaves-state-unchanged, no dangling edges, derived slots inside the topological pass —
  not touched by this diff.

## 3. Findings

### Finding 1 (fixed here; ruled as D-033) — a correct answer was being reported as `#TYPE`

`finiteResult` mapped BOTH halves of `isIllegalNumber` to `#TYPE`. The non-finite half is right
(D-025). The `-0` half is not: it makes ordinary arithmetic fail.

```
CEIL(-0.5)       -> {"error":"#TYPE","message":"CEIL: result is not a legal number (0)"}
ROUND(-0.4, 0)   -> {"error":"#TYPE","message":"ROUND: result is not a legal number (0)"}
ROUND(-0.001, 2) -> {"error":"#TYPE","message":"ROUND: result is not a legal number (0)"}
```
(probe run against the shipped registry, before the fix)

Three things are wrong here. The answer is zero, and zero is exactly representable — so an error
replaces a correct value with a lie. `#TYPE` propagates, so one `CEIL` of a small negative number
poisons every formula downstream of it. And the message reads "not a legal number (0)", because
`-0` formats as "0" — the user is told 0 is not a legal number.

Cycle 0034's Decision 4 reasoned carefully about WHETHER `-0` is reachable (correctly: `CEIL` is a
second producer it did not list) but not about what the right ANSWER is once it is. Q-008 is about
what may be STORED; it does not follow that a compute must refuse to compute. Fixed: `finiteResult`
now normalises `-0` to `+0` and errors only on non-finite. Ruled as **D-033**, which also states
where the normalisation belongs (the one shared guard) so it is not re-derived per function.

The `ROUND(-0.4, 0)` test's expectation changed from `#TYPE` to `0` as part of this. Flagging that
explicitly: a changed test expectation is a §6.1 trigger for an implementer, and this one is a
reviewer's ruling, not a convenience — the old expectation pinned the defect.

### Finding 2 (fixed here; ruled as D-034) — a prototype-chain lookup that ends in a thrown `TypeError`

`FUNCTION_REGISTRY` is an object literal, so `getFunctionEntry` indexed straight into its prototype:

```
getFunctionEntry("toString")    -> [Function: toString]   (typed FunctionEntry)
getFunctionEntry("constructor") -> function
getFunctionEntry("__proto__")   -> object
checkArity(...) on that entry   -> TypeError: Cannot read properties of undefined (reading 'kind')
parseFormula("toString(1)")     -> {"type":"functionCall","name":"toString","args":[...]}
```
(probe run before the fix; the last line is why this is reachable, not theoretical — `parser.ts`
validates no function name, so the string comes straight from user text)

That is a throw inside `src/engine/`, from the file whose header promises "No entry here ever
throws", in the exact code path `eval.ts` is about to write next. Fixed with an `Object.hasOwn`
guard plus a regression test over five inherited names. Ruled as **D-034** so the next
`Record<string, T>` keyed by parsed text does not repeat it.

### Finding 3 (header corrected here, no behaviour change) — an over-claim about missing arguments

`functions.ts`'s header said "Every implementation is ALSO defensive against being called with too
FEW arguments — it returns a `#TYPE` naming the missing argument." True for fixed-arity entries;
false for the variadic ones. `SUM()` returns `0` and `CONCAT()` returns `""`; `MIN()`/`MAX()`/
`AVG()` return `#TYPE` only incidentally, via `Infinity`/`NaN` reaching `finiteResult`. The
behaviour is fine — `checkArity` is the real gate — but the header claimed a guarantee the code
does not make, which is the kind of sentence a later reader trusts instead of testing. Corrected
to say what actually happens; no code changed.

### Finding 4 (recorded, NOT fixed — for the cycle that flattens ranges)

`Math.min(...numbers)` in `MIN`/`MAX` throws `RangeError` on a sufficiently large argument list.
Unreachable today (nothing flattens a range into arguments yet) and Rule 5 says do not optimise, so
it stays as written — but the cycle that flattens a `RangeDependency` into evaluated arguments owns
it: that is the cycle that makes the list arbitrarily long, and a `RangeError` would be a throw
inside `engine/`. Recorded in `STATUS.md`'s Known problems, not fixed here.

## 4. Spec conformance

- §5.3's built-ins list: all 23 names present, none invented, none missing — checked name by name
  against the brief's own sentence, and pinned by the registry-completeness test.
- §5.3's "table-driven (name → arity → implementation), so adding one is a single line": honoured
  literally — `eager("ABS", EXACTLY(1), ...)` is one line.
- §5.3's range rule ("only as an argument to an aggregate function"): unchanged behaviour; the name
  set moved into the registry as its owner. Verified the set is the same four names.
- §5.3's eager/total vs. lazy split: see the invariant audit. `deps.ts` is the eager half, and the
  lazy half stays unimplemented and unimplementable-by-accident.
- The brief is silent on `IF`'s arity and on `AND`/`OR`'s minimum. Settled as **D-035** rather than
  left to `eval.ts` to decide by accident; `ast.ts`'s contradicting "2 or 3 args" header note
  corrected in the same breath.

## 5. Legibility audit

Headers present and accurate on both new files (one over-claim, Finding 3, now corrected).
Vocabulary locked — spot-checked for "property"/"field"/"node"/"computed" drift against *slot*,
*object*, *derived*: clean. No `any`, no casts, no `throw`, no commented-out code in either new
file. Tests are behaviour sentences naming the rule they defend ("IF: is EAGER and TOTAL across
BOTH the taken-looking and untaken-looking branch (§5.3)").

One note, not a finding: `functions.ts`'s header is ~105 lines for a 480-line file, and several
paragraphs restate rationale `DECISIONS.md` already holds. It is within this project's established
house style and I am not asking for a rewrite — but prefer citing D-0NN over re-arguing it as the
ratio worsens.

## 6. Honesty audit

Both logs match the diff. Re-ran, not read:

- Claimed 341/341 at 0033 and 382/382 at 0034, typecheck clean under both configs. Verified at
  HEAD before my edits: **382 passed (382)**, 13 files, 0 skipped; `npm run typecheck` silent.
- Claimed diff totals (393/2 for 0033; 1176/5 cumulative): `git diff --stat b0a88cb HEAD -- src/`
  gives 1164 insertions / 12 deletions over 5 files. Matches.
- The `parser.ts` refactor is exactly as described: the local `AGGREGATE_FUNCTION_NAMES` set
  deleted, one import added, one call site changed, both header blocks updated. No test expectation
  moved — confirmed by `parser.test.ts`'s 49 tests passing untouched.
- No `.only`, `.skip`, or `it.todo` anywhere in `src/`.
- The §6.3 cap breach is self-reported accurately and prominently, including that entry 0033
  predicted it before cycle 0034 began. Credit where it is due: the batch discipline failed, the
  reporting of it did not. The gotcha 0034 wrote for itself — treat a hand-off-flagged dense file
  as review-gated regardless of nominal headroom — is the right lesson, and is carried forward.

## 7. Open questions

- **Q-008** stays OPEN and provisional, unchanged in substance. D-033 narrows only the COMPUTE-side
  answer; `mutate` still rejects an authored `-0`.
- **Q-004**, **Q-007**, **Q-001/Q-002** — deferral reaffirmed, none touched by this diff.
- No new question raised by either cycle, and none needed to be: the two defects here were
  mistakes, not ambiguities.

### Answers to 0034's three questions for the reviewer

1. **Uniform `isIllegalNumber` guarding on every eager function, vs. per-function reasoning.**
   Uniform is right — keep it. Reasoning per function about which one structurally cannot produce
   an illegal result is exactly the analysis that goes subtly wrong 20 times, and the dead check in
   `LEN` costs nothing. But the guard's ANSWER was wrong (Finding 1): uniformity was never the
   problem, and after D-033 you get both — one guard, applied everywhere, returning the correct
   value instead of an error.
2. **`AND`/`OR` arity minimum of 1 vs. 2.** Keep 1. Ruled as D-035. It matches Excel (D-030's
   tie-breaker), `AND(x)` is harmlessly `x`, and it binds nothing but `checkArity` today. `IF` is
   confirmed at exactly 3 in the same ruling.
3. **Was folding `parser.ts`'s `AGGREGATE_FUNCTION_NAMES` into this cycle right?** Yes. §4's "never
   refactor code you did not write in this batch" carries "unless a review verdict instructed it",
   and 0032-REVIEW's own text called that set "disclosed as folding into the registry later" — that
   is the instruction. The three properties that made it safe are worth naming, because they are
   the test for the next one: behaviour-preserving, verifiable by an unchanged test suite, and it
   DELETED a duplication rather than introducing a new abstraction. A refactor missing any of the
   three still waits.

## 8. Edits made

All four are small and explained; both configs clean and 385/385 tests pass after them.

1. **`functions.ts` — `finiteResult` normalises `-0` to `+0`** (Finding 1, D-033). It errors only
   on non-finite now. The shared `isIllegalNumber` predicate is still the single gate — only the
   response to its `-0` arm changed, so D-014's "one leaf predicate" stance is intact.
2. **`functions.ts` — `getFunctionEntry` guards with `Object.hasOwn`** (Finding 2, D-034).
3. **`functions.ts` — header corrected** in two places: the `finiteResult` description (now states
   D-033's split) and the missing-argument over-claim (Finding 3).
4. **`ast.ts` — one line**: `IF` "with 2 or 3 args" becomes "with exactly three args (D-035)", so
   the AST file no longer contradicts the registry it describes.

Tests: `ROUND(-0.4, 0)`'s expectation changed from `#TYPE` to `0` (asserting `Object.is(result,
-0)` is false); three added — `CEIL(-0.5)` is `+0`, `ROUND(1, 400)` is still `#TYPE` (D-033's other
half), and `getFunctionEntry` returns `undefined` for five inherited property names. 41 to 44 tests
in `functions.test.ts`.

Mutation-checked my own two code edits, per D-016: reverting the `Object.hasOwn` guard and the
`-0` normalisation together fails exactly the three tests written for them (3 failed | 41 passed)
and no others. Both restored; grep clean.

## 9. Carried constraints for the next cycle (`formula/eval.ts`)

1. **D-029 is the one that gets violated by accident.** Dispatch `LAZY_FUNCTION_NAMES` at the
   `FunctionCallNode` site BEFORE any registry lookup, in both syntactic forms. The registry cannot
   help you here — it has no `implementation` to call, by design.
2. **Check arity before evaluating anything**, via `getFunctionEntry` + `checkArity`. An unknown
   name is a failure to report, never a crash — and after D-034 an unknown name really does come
   back `undefined`.
3. **`extractDependencies` stays eager and total** no matter how tempting it looks to reuse the
   evaluator's laziness. They are different walks. Do not merge them.
4. **A `RangeDependency` expands at edge-derivation time, from current dimensions, every mutation.**
   That is Phase 2's wiring, not `eval.ts`'s — and the same cycle owns Finding 4 and the deletion
   of `findUnsupportedFormulaAsts`.
5. **Batch discipline.** This batch ran 1176 lines against an 800 cap, after the previous one ran
   2.2x over in the same way. `eval.ts` is Phase 1's last file and its phase gate — a review point
   on completion by §6.1 trigger 1 regardless of size. End the batch there; batch nothing behind it.

## Verification (real output, after edits)

```
$ npm run typecheck
> tsc --noEmit && tsc --noEmit -p tsconfig.engine.json
(clean, no output)

$ npm test -- --run
 Test Files  13 passed (13)
      Tests  385 passed (385)
```
385 = the 382 at HEAD, plus 3 added here; 1 expectation changed, documented above. 0 skipped,
0 `.only`.
