# STATUS — as of entry 0036-formula-eval

STATE: GREEN (compiles under both configs, 430/430 tests pass, 0 skipped, 0 `.only`). **Cycle 0036
is UNREVIEWED. Process state: REVIEW REQUIRED before the next cycle begins** — this was Phase 1's
LAST file and its phase gate (§6.1 trigger 1), a mandatory review point on completion regardless of
size; the 955-line diff also exceeds the 800/10 cap on its own. **Do not start ANY new slice
(Phase 2 above all) until this lands.**

Current phase: **1 — Formula engine (`formula/*`), standalone — now functionally complete pending
review, with one disclosed, reviewer-flagged gap (see below).** Phase 0 is COMPLETE and SIGNED OFF
(0027-REVIEW-phase0). Last review point: **0035-REVIEW-phase1, ACCEPT WITH EDITS** — two defects
fixed in `functions.ts` (a computed `-0` reported as `#TYPE`; a prototype-chain registry lookup
that threw), one header over-claim corrected, one `ast.ts` line corrected, and three rulings:
**D-033** (`-0` normalises to `+0` on compute; only non-finite errors), **D-034** (registry lookup
by `Object.hasOwn`), **D-035** (`IF` exactly 3 args; `AND`/`OR` at least 1).
Cycles since last review: **1/3** · diff since last review: **955 lines / 3 files** — EXCEEDS the
800/10 cap on a single cycle.

## Next slice — BLOCKED pending review
Phase 1 has no more declared files. Once 0036 is reviewed: Phase 2 begins ("wire the formula engine
into cell slots" — the table primitive, real range expansion, deleting `mutation.ts`'s
`findUnsupportedFormulaAsts`, and fixing 0035-REVIEW's Finding 4). Three questions are open for the
reviewer in entry 0036's own "Questions for reviewer" section — most importantly, whether treating
`RangeNode` evaluation as out of `eval.ts`'s scope was the right reading of 0035-REVIEW's carried
constraint 4, since Phase 2's exact starting point depends on the answer.

## Built and reviewed (through 0035-REVIEW; 0036 itself is UNREVIEWED, see below)
- Scaffold, `graph/node.ts`, `graph/edge.ts`, `primitives/schema.ts`, `graph/cycles.ts`,
  `graph/eval.ts`, `mutation.ts`, `document.ts` — reviewed, unchanged in substance since 0029.
- `address.ts` (45 tests), `formula/ast.ts` (14 tests), `formula/lexer.ts` (36 tests),
  `formula/parser.ts` (49 tests), `formula/deps.ts` (20 tests) — all reviewed at 0032/0035-REVIEW,
  unchanged this cycle. See prior STATUS revisions and their own entries for detail.
- `formula/functions.ts` (44 tests) — reviewed at 0035-REVIEW; THIS cycle made one small, disclosed
  change: `finiteResult` is now EXPORTED (was private) so `eval.ts` reuses the same D-033 guard.
  Zero behaviour change to any existing export; confirmed by the unchanged 44-test suite.

## Built this cycle, UNREVIEWED
- **`formula/eval.ts`** (45 tests, cycle 0036) — `evaluate(ast, read): Value`. Lazy,
  short-circuiting per §5.3/D-029: `IF` evaluates only the taken branch; `AND`/`OR` short-circuit,
  in BOTH syntactic forms; `NOT` delegates to `functions.ts`'s own registry entry; every other
  built-in dispatches through `getFunctionEntry`/`checkArity` then `entry.implementation`.
  Arithmetic (`+ - * / % ^`) and unary `-` route through `functions.ts`'s now-exported
  `finiteResult` (D-033). Comparisons (`= <> < > <= >=`) require same-type operands (disclosed
  decision). `/`/`%` by zero is `#DIV0`. A `RangeNode` evaluates to a disclosed, TEMPORARY `#PARSE`
  — see Known problems. Never throws. NOT wired into `graph/eval.ts`/`mutation.ts` yet.

## Acceptance criteria
Phase 0: all four PASSING and REVIEWED (unchanged, see 0027-REVIEW).
Phase 1: **NOT claimed — close, one disclosed gap.** Every named clause in §6's "Done when" is now
demonstrated somewhere in `formula/*`'s tests EXCEPT real evaluation of "ranges in aggregates":
`SUM(A1:B4)` evaluates to a disclosed `#PARSE` in this build (see Known problems), not a real sum,
per 0035-REVIEW's own carried constraint 4. Demonstrated: literals, precedence, nested `IF`,
reference resolution, ranges PARSED correctly, error propagation, dependency extraction total
across both `IF` branches WHILE evaluation short-circuits (entry 0036's own centerpiece — see
`eval.test.ts`'s laziness tests using a real `1/0` "poison" node in the untaken position), and
malformed input yielding `#PARSE` rather than throwing.

## Known problems
- **NEW (0036): a `RangeNode` evaluates to a disclosed, TEMPORARY `#PARSE`** — `evaluate` cannot
  expand a range into concrete cell values without the target table's actual current structure,
  which this standalone file is never handed. `SUM`/`MIN`/`MAX`/`AVG` over a real range therefore
  always fail in this build. Same disclosure posture as `graph/eval.ts`'s own `evaluateFormula`
  bridge — deleted, not extended, the moment a later cycle wires in real range expansion. **The
  cycle that does this also owns 0035-REVIEW's Finding 4** (`MIN`/`MAX`'s `Math.min(...numbers)`
  throwing `RangeError` on a very large list — still unreachable, still unfixed, same reason).
- **`findUnsupportedFormulaAsts` (mutation.ts) and `evaluateFormula`'s `#PARSE` branch
  (graph/eval.ts) are BOTH temporary** (carried) — delete both, and `deriveEdges`'s matching
  narrowing, the moment Phase 2 wires in `formula/eval.ts` for real. `eval.ts` existing does NOT
  change this on its own — the wiring is separate work.
- **`camera` has no WRITE-side guard** (D-027, carried).
- **The journal's STRUCTURE is deliberately unvalidated** beyond `Array.isArray` (carried).
- **L-16, L-17/L-18/L-14, §5.11's `style` field, `nextObjectId` reconciliation, `noUnusedLocals`
  off, L-6–L-15 cosmetics, recursion depth, table/`cells` hardcoding — all carried unchanged.**
- **`lexer.ts`'s two disclosed edge cases** (carried, unchanged).
- **`^` is left-associative (D-030).** **A stored `LiteralNode.value` is unchecked document state
  (D-031)** — still unreachable, same reason as before.
- **SETTLED, do not re-raise:** everything 0029/0032/0035-REVIEW's STATUS already listed settled
  (precedence chain, D-029 dispatch mechanism in BOTH `parser.ts` and now `eval.ts`,
  range-placement-as-post-parse-walk, `SUM((A1:B4))`'s acceptance, dependency extraction needing no
  per-name special-casing, function-name case sensitivity, `CONCAT`'s strict typing, `IF`/`AND`/
  `OR` arity D-035), plus now: comparisons require same-type operands; `/`/`%` by zero is `#DIV0`;
  `finiteResult` is shared between `functions.ts` and `eval.ts`, not duplicated.

## Live PROVISIONAL tags and open questions
**`PROVISIONAL(Q-007)`** → `document.ts`'s `CameraState`. **`PROVISIONAL(Q-008)`** →
`graph/node.ts`'s `isIllegalNumber` — still open; D-033 narrows only the compute-side answer.
**Q-009** ANSWERED → D-029. **Q-005** ANSWERED. **Q-006** ANSWERED → D-025. **Q-001/Q-002**
(Phase 3), **Q-004** (Phase 2) deferred. **Q-003** → D-007. No new question raised this cycle —
three questions raised FOR the reviewer in entry 0036 (not `OPEN_QUESTIONS.md` entries; see that
entry). Next free: **Q-010**.

## Gotchas for the next model
- **STOP: do not start a new slice.** Cycle 0036 needs review first — it is Phase 1's phase gate,
  reviewed regardless of size, per §6.1 trigger 1. Read entry 0036's "Questions for reviewer"
  section, especially question 1 (does Phase 2 start with range expansion, or was that always
  assumed and this just confirms it).
- **D-029 is enforced by the type system in TWO files now**: `functions.ts`'s `LazyFunctionEntry`
  has no `implementation` field to call, and `eval.ts`'s `evaluateFunctionCall` dispatches
  `IF`/`AND`/`OR` by name BEFORE evaluating any argument or considering `entry.implementation`.
  Read `eval.ts`'s own header before touching either dispatch — it is the one place D-029 could be
  violated by accident, per 0035-REVIEW's own warning, now itself pinned by two mutation checks
  (arity-before-dispatch ordering; `AND`'s short-circuit line).
- **A `RangeNode` cannot be evaluated to a real value in this build (see Known problems).**
  `SUM(A1:B4)` is `#PARSE`, always, until a later cycle wires in real expansion. Don't be surprised
  by this in a future test — it is disclosed, not a bug to silently "fix" without re-reading entry
  0036's Decision 1 and question 1 first.
- **`finiteResult` (D-033's shared guard) is exported from `functions.ts`** and reused by
  `eval.ts`'s arithmetic — one guard, one place, per D-014. Do not write a second copy in a future
  file that computes numbers; import this one, or extend the reasoning here first.
- **Comparisons require same-type operands (a disclosed decision, not a brief requirement)** — see
  question 2 in entry 0036 if this needs revisiting.
- **`parser.ts` does NOT validate function names or arity** — `eval.ts` does, via `getFunctionEntry`
  + `checkArity`, but only at evaluation time, not at parse/command time.
- **Range placement (`parser.ts`), range DEPENDENCY reporting (`deps.ts`), and range EVALUATION
  (`eval.ts`, still a disclosed gap) are three separate, distinct concerns** — don't conflate them.
- **An error-shaped type predicate discriminates on the CODE, never on the presence of an `error`
  field (D-032).**
- **`src/engine/` contains no `throw`, and should stay that way.**
- **`isCellReferenceForm`/`bareCellAddress` (address.ts) are the ONLY sanctioned way to detect/build
  a bare cell-ref-shaped segment outside `address.ts` itself.**
- **`ErrorNode` still exists but nothing constructs one yet, deliberately (D-028)** — `eval.ts`
  evaluates one correctly (to its own `ErrorValue`, never `#PARSE`) should one ever appear.
- Each PowerShell call is a fresh process; the Bash tool's `npm` is not on PATH — use PowerShell.
