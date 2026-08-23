# 0037 — REVIEW (phase 1 GATE)
Date: 2026-08-23   Phase: 1   Model: reviewer (Claude Opus 5)
Previous entry: 0036-formula-eval   Last review: 0035-REVIEW-phase1 (ACCEPT WITH EDITS)
Reviewed: the diff since `9aa4b9f` (0035-REVIEW) — cycle 0036 (`formula/eval.ts`, its tests, and a
+14/−4 export change to `functions.ts`), 951 insertions / 4 deletions across 3 files — plus the log
entry, `STATUS.md`, and `OPEN_QUESTIONS.md`. This is the **Phase 1 gate** (§6.1 trigger 1, §12).

## Verdict

**ACCEPT WITH EDITS — and the Phase 1 gate PASSES, with one clause carried into Phase 2 by
name.** `eval.ts` is the best-built file in this project so far: D-029's dispatch order is not
merely correct, it is structured so that the correct order is the only readable one. Two small
edits made here (one wrong comment, one silently-taken operator semantic), three rulings recorded
(**D-036**, **D-037**), one question raised for the human (**Q-010**). **Phase 2 is OPEN.**

## 1. Rule audit

- **Rule 1 (engine is pure)** — upheld. `grep` for `document.`/`window.`/`canvas`/`render/` in
  `eval.ts` hits its own "NEVER imports" header line and nothing else; both configs typecheck,
  including the DOM-free `tsconfig.engine.json`. Rule 1's named trap is honoured for the right
  reason too: no `EvalContext`/`TextMeasurer` was threaded through "in case", because §5.3's v1
  grammar needs no injected service beyond `read` — Phase 5 adds it when text actually needs it.
- **Rule 2 (state change through `mutation.ts`)** — not touched. `evaluate` reads through an
  injected callback and writes nothing.
- **Rule 3 (addressing)** — upheld. An `Address` is passed to `read` unmodified; no name, no path
  string, no construction.
- **Rule 4 (ONE formula engine)** — upheld, and this was the cycle with the standing temptation.
  There is one evaluator, and the `NOT` case proves the discipline: rather than reimplement
  type-check-and-negate, it calls `functions.ts`'s own registry entry. D-036 below binds the same
  rule onto the range work so it is not violated by a pre-flattening pass later.
- **Rule 5 (dumbest correct implementation)** — upheld. Structural recursion, no caching, no
  precompilation, no clever dispatch table.
- **Rule 6 (slot set fixed during evaluation)** — not touched; `evaluate` cannot create a slot.
- **Rule 7 (§8 deferred list)** — not touched.

## 2. Invariant audit

- **Evaluation is LAZY and short-circuits (§5.3, D-029)** — upheld, and proven rather than
  asserted. `IF`/`AND`/`OR` are dispatched at the `FunctionCallNode` site before a single argument
  is evaluated; the untaken-branch tests use a real `1/0` poison node rather than a sentinel, so
  the proof runs through the file's own arithmetic path. Re-ran the implementer's mutation check
  myself: disabling `AND`'s short-circuit line fails exactly 3 tests, the two form tests and the
  real-pipeline integration test.
- **Dependency extraction stays eager and total** — `deps.ts` is untouched (verified by diff), and
  the two walks were not merged. 0035-REVIEW's carried constraint 3 honoured.
- **Arity is checked before anything is evaluated** — upheld, and it is genuinely load-bearing,
  not redundant with `evaluateIf`'s own defensiveness: disabling the gate fails 2 tests
  (`IF` with 2 args, `AND` with 0), which I re-ran.
- **`evaluate` never throws** — upheld across every failure mode I could construct: unknown name,
  wrong arity, unresolved reference, wrong-typed operand, division by zero, non-finite result,
  a `RangeNode`, and a hand-built AST of an impossible shape. Every registry lookup goes through
  `getFunctionEntry` (D-034-safe); the file never indexes `FUNCTION_REGISTRY` itself.
- **The D-033 guard is REUSED, not copied** — `finiteResult` is now exported and is the single
  place `-0` and non-finite results are decided, for `functions.ts`'s 20 built-ins and `eval.ts`'s
  seven arithmetic operators alike. This is exactly what D-033's binding text asked for, and the
  stronger reading of it (the literal function, not a second one of the same shape).
- **Errors propagate left to right, deterministically** — upheld in arithmetic, comparisons,
  `AND`/`OR` operands, and eager call arguments.
- Rejection-leaves-state-unchanged, no dangling edges, plain serializable graph state — not
  touched by this diff.

## 3. Findings

### Finding 1 (fixed here; ruled as D-037) — an operator semantic taken silently from the host language

`%` was implemented as the bare JavaScript operator, so `-5 % 3` evaluated to `-2`. §5.3 lists `%`
in the `* / %` tier and never defines its sign behaviour, which makes this a semantics gap —
and **D-030 already settled how this project answers those: by Excel.** `MOD(-5, 3)` is `1`.

Two reasons this matters beyond consistency. It is the behaviour the wrapping cases a canvas
actually has need — an angle, a grid index, a colour cycle — where a negative input silently
producing a negative result is the bug you find last. And nothing tested it: the only `%` test was
`10 % 3`, so the sign convention was unpinned in either direction.

Fixed here as `((l % r) + r) % r`, which matches Excel including a negative divisor (`5 % -3` is
`-1`), still routes through `finiteResult` (so `-6 % 3` is `+0`, not `-0`), and is pinned by two
new tests. Mutation-checked: reverting it to the bare operator fails exactly the new sign test.

The process point is the more useful half, and it is why this is a finding rather than a silent
edit: **reaching for the host language's default IS a decision.** Entry 0036 lists six decisions,
carefully, and this was not among them — it did not feel like a choice. Recorded in D-037 so the
next semantics gap is disclosed rather than absorbed.

### Finding 2 (fixed here, no behaviour change) — the header describes a dispatch that does not exist

`eval.ts`'s header and `evaluateNot`'s own comment both state that the prefix `NOT x` form and the
call `NOT(x)` form "route through the SAME `evaluateNot([operand], read)`". They do not.
`evaluateNot` has exactly one caller — `evaluateUnaryOp` (line 232, confirmed by grep). `NOT(x)` is
an ordinary `EagerFunctionEntry`, so it takes `evaluateFunctionCall`'s eager path like `SUM`.

The behaviour is right and the two forms do agree — both end at `functions.ts`'s `NOT`
implementation with one evaluated operand, which is what the tests check. But the claim a reader
would rely on ("there is one shared helper") is false, and the next person to change `NOT`'s
handling would edit `evaluateNot` and silently miss the call form. Both comments corrected to state
the two routes and why they converge.

### Finding 3 (not a defect — recorded, and answered as D-036) — the range gap and the phase gate

Cycle 0036 asked, twice and honestly, whether Phase 1 can be claimed with `RangeNode` evaluating to
a placeholder `#PARSE`. The answer is yes, and the reasoning is stronger than "the reviewer said
Phase 2": §5.4 requires a range whose endpoint was deleted to **clamp to the remaining extent**,
which is a function of the table's current dimensions; §5.3 puts expansion at edge-derivation time;
and `address.ts` already admits multi-letter columns, so enumeration needs bijective base-26
arithmetic whose natural home is beside the table primitive. A `formula/*`-standalone
implementation would be one that has to be **replaced**, not extended.

Full ruling, including the four constraints on whoever implements it (expand through `read`, never
a pre-flattening pass; helper lives with the table primitive; delete the placeholder rather than
extend it; and **never ship a cell that accepts `= SUM(A1:A5)` and then shows `#PARSE` forever**),
is D-036.

### Finding 4 (recorded, not fixed) — `describeValueType` is now duplicated verbatim

`eval.ts` carries a byte-identical copy of `functions.ts`'s private `describeValueType`, disclosed
in a comment whose justification ("this file's error messages are a distinct concern") does not
really hold — it is the same function over the same union, and a future `Value` variant needs both
updated or the messages drift. Not worth an edit at a phase gate for 12 lines of message
formatting, and the fix (export it, or move it to `graph/node.ts` beside `Value` itself) is a
judgement call about `functions.ts`'s export surface that the next cycle can make with more
context. Recorded in `STATUS.md`'s Known problems.

## 4. Phase 1 gate — criterion by criterion

> "tests cover literals, operator precedence, nested `IF`, every built-in, reference resolution,
> ranges in aggregates, and error propagation — plus explicit tests that dependency extraction is
> **total across both `IF` branches** while evaluation **short-circuits**, and that malformed input
> yields `#PARSE` rather than throwing."

| Clause | Status | Demonstrated by |
| --- | --- | --- |
| literals | PASSING | `lexer.test.ts`, `parser.test.ts`, `eval.test.ts` ("a literal evaluates to its own value") |
| operator precedence | PASSING | `parser.test.ts`'s precedence-chain group; D-030 pins `^` |
| nested `IF` | PASSING | `parser.test.ts`; `eval.test.ts`'s integration group evaluates a real nested one |
| every built-in | PASSING | `functions.test.ts` (each entry directly) **and** `eval.test.ts`'s sweep proving every eager name is reachable through the real dispatch path, cross-checked against the registry so it cannot drift |
| reference resolution | PASSING | `address.test.ts`, `parser.test.ts`, `eval.test.ts` (resolved, unresolved → `#REF`, nested in a call) |
| **ranges in aggregates** | **PARTIAL — carried to Phase 2 (D-036)** | parse level (0031) and dependency level (0033) pass; EVALUATION deferred with a named home and four binding constraints |
| error propagation | PASSING | every `formula/*` test file; `eval.test.ts` covers propagation through operands, arguments, comparisons, and `IF`'s condition |
| deps total across both `IF` branches | PASSING | `deps.test.ts`'s two totality tests + the D-029 dual-form group |
| evaluation short-circuits | PASSING | `eval.test.ts`'s centerpiece group, poison-node based; mutation-checked (3 failures when disabled) |
| malformed input → `#PARSE`, never a throw | PASSING | `lexer.test.ts`/`parser.test.ts`'s malformed batteries + `eval.test.ts`'s "malformed input never reaches evaluate at all" |

**Gate verdict: PASSED**, with "ranges in aggregates (evaluation)" carried into Phase 2's gate by
D-036, where the brief's own criterion already demands it ("`SUM(A1:A5)` recomputes correctly after
inserting a row inside the range"). Nine of ten clauses pass outright; the tenth cannot be honestly
finished inside `formula/*` alone, for reasons that are the brief's, not this cycle's.

## 5. Legibility audit

The header is long but earns it this time — `evaluateFunctionCall`'s ordered contract is written
out step by step and the code below is literally that order, which is the single most valuable
paragraph in the file. Vocabulary locked. No `any`, no casts, no `throw`. Every defensive
unreachable arm says why it exists and returns a value rather than throwing. Tests are behaviour
sentences, and the two best ones name the rule they defend ("D-029 laziness: the centerpiece",
"arity is checked before laziness matters").

Two notes: the duplicated `describeValueType` (Finding 4), and the header's `NOT` claim (Finding 2,
fixed). Neither is a pattern — the file is otherwise unusually accurate about its own behaviour.

## 6. Honesty audit

The log matches the diff, with one numerical slip worth stating precisely.

- Claimed 430/430 and clean typecheck under both configs. Verified at HEAD before my edits:
  **430 passed (430)**, 14 files, 0 skipped, 0 `.only`. `npm run typecheck` silent.
- Claimed diff: 955 lines / 3 files. `git diff --stat 9aa4b9f HEAD -- src/` gives 951 insertions /
  4 deletions over 3 files. Matches.
- The `functions.ts` change is exactly what was disclosed: `finiteResult` exported, two header
  passages updated, no behaviour change to any existing export — and `functions.test.ts`'s 44 tests
  pass untouched, which is the proof that matters.
- **The mutation-check denominators are wrong, the substance is right.** The entry reports
  "426/428" and "425/428" against a 430-test suite. I re-ran both checks: disabling the arity gate
  gives `2 failed | 428 passed (430)` and names exactly the two tests claimed; disabling `AND`'s
  short-circuit gives `3 failed | 427 passed (430)` and names exactly the three claimed. So the
  failure counts and the named tests are accurate and the mutations are real — the pass/total
  figures are transcribed from a run made before the last two tests existed, or simply mis-typed.
  Worth flagging only because a pasted number is supposed to be a pasted number; nothing here is
  an overclaim, and the check itself was done properly.
- **Decision 6 is disclosed against the implementer's own interest**, which is the behaviour this
  process exists to produce: stop-at-first-error in the eager argument loop is written defensively,
  and the entry says plainly that no mutation could prove it independently load-bearing rather than
  implying coverage it does not have. Correct call, correctly reported. (It is still worth keeping:
  it means an argument after a known-bad one is never evaluated, which will matter the moment an
  argument can be expensive or can itself read a broken range.)
- The criterion was NOT claimed, and the gap was named precisely rather than rounded off. Compare
  0034's over-claiming header (0035-REVIEW's Finding 3): the discipline is visibly better this
  cycle.

## 7. Open questions

- **Q-010 RAISED (new).** Nothing in this codebase rejects an unknown function name or a wrong
  argument count at authoring time — `= FOO(1)` and `= SUM()` parse cleanly and become an error
  value at evaluation, while `= nosuchobject.v` cannot be authored at all. That asymmetry is a
  product-facing behaviour question (does the app refuse the entry, or show a broken cell?), it is
  the human's call, and it must be settled by the Phase 2 cycle that first makes formulas storable.
  Deliberately NOT ruled here; recommendation (b) recorded, three affected test expectations named
  and authorised in advance so whoever implements it is not tripped by §6.1 trigger 5.
- **Q-008** — unchanged, still OPEN and provisional; D-033 (compute side) untouched by this cycle,
  and `eval.ts` correctly routes through the shared guard rather than re-deciding.
- **Q-004, Q-007, Q-001/Q-002** — deferral reaffirmed. Q-004 (lowercase cell refs) now has a second
  reason to be settled in Phase 2: range enumeration under D-036 will read cell forms in bulk.
- Q-009/Q-005/Q-006/Q-003 — answered, unchanged.

### Answers to 0036's three questions for the reviewer

1. **Is deferring range EVALUATION the right reading of carried constraint 4?** Yes — and it is
   right for a better reason than the one you cite. My constraint was written about
   `RangeDependency`, so your caution in re-reading it was warranted; the decisive argument is
   §5.4's own "a range whose endpoint was deleted clamps to the remaining extent", which no
   table-blind evaluator can honour. Ruled as **D-036**, with the four constraints that keep the
   eventual implementation from becoming a second evaluator.
2. **Same-type-only comparison, or equality-across-types-is-just-false?** Keep same-type-only.
   Ruled in **D-037**: a silent `false` when a cell holds `"5"` and the formula compares it to `5`
   hides exactly the type confusion this project surfaces everywhere else, and strictness is the
   widenable direction. Your Decision 3 stands as written.
3. **Does Phase 1's criterion require real range evaluation to be claimable?** No — see §4's
   clause-by-clause table and D-036. Nine clauses pass outright; the tenth is carried with a named
   home and a gate that cannot close without it. Asking rather than quietly claiming the criterion
   was the right call, and it is the reason this gate could be signed off in one pass.

## 8. Edits made

Both small; both configs clean and 432/432 tests pass after them.

1. **`eval.ts` — `%` now takes the divisor's sign** (Finding 1, D-037): `((l % r) + r) % r`, with
   the operator's own comment explaining why, plus a line in `evaluateArithmetic`'s doc.
2. **`eval.ts` — the `NOT` dispatch comments corrected** in both places (Finding 2). No code
   changed.

Tests: two added — `%`'s sign convention across all four sign combinations, and `-6 % 3` landing on
`+0` rather than `-0` (the D-033 guard still applies through the new expression). 45 → 47 tests in
`eval.test.ts`.

Mutation-checked my own code edit: reverting `%` to the bare JS operator fails exactly the new sign
test and nothing else. Restored; grep clean.

## 9. Phase 2 — opening notes

Phase 2 is OPEN: "Wire the formula engine into cell slots. Add reference adjustment. Still
headless." Before the first slice:

1. **D-036 governs the range work.** Read it before designing the wiring, not after — constraint 4
   in particular ("a formula containing a range must not be storable until it can be evaluated")
   shapes what the first cycle is allowed to accept.
2. **Q-010 should be answered by the human before formulas become storable.** Ask early; it is
   cheap now and it sets the authoring contract.
3. **The three temporary bridges come down together**: `mutation.ts`'s `findUnsupportedFormulaAsts`,
   `graph/eval.ts`'s `evaluateFormula` `#PARSE` branch, and `deriveEdges`'s `ReferenceNode`-only
   narrowing. Deleting one without the others leaves the graph half-wired.
4. **D-031's value-legality walk must reach a stored AST's literals** in the same cycle that makes
   formulas storable — `evaluate` returns a `LiteralNode`'s value unchecked, correctly, because
   the check belongs at mutation time. That hole opens the moment formulas can be stored.
5. **`deriveEdges` consumes `deps.ts`, expanding a `RangeDependency` from CURRENT dimensions on
   every mutation** — never a cached expansion (§5.3's "can never go stale" is the whole point).
6. The batch cap resets: 0/3 cycles, 0 lines. Phase 2's first file that touches `mutation.ts`,
   `graph/*`, or `primitives/schema.ts` is load-bearing under §6.2 — those need review before
   Phase 3, and the phase gate will force it anyway.

## Verification (real output, after edits)

```
$ npm run typecheck
> tsc --noEmit && tsc --noEmit -p tsconfig.engine.json
(clean, no output)

$ npm test -- --run
 Test Files  14 passed (14)
      Tests  432 passed (432)
```
432 = the 430 at HEAD, plus 2 added here. No expectation changed. 0 skipped, 0 `.only`.
