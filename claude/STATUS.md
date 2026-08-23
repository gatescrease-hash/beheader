# STATUS — as of entry 0037-REVIEW-phase1

STATE: GREEN (compiles under both configs, 432/432 tests pass, 0 skipped, 0 `.only`).

**PHASE 1 IS COMPLETE AND SIGNED OFF** (0037-REVIEW-phase1, verdict ACCEPT WITH EDITS; gate
PASSED). **Phase 2 — Table primitive — is OPEN.** One Phase 1 criterion clause is carried into
Phase 2 by name: **range EVALUATION** (`SUM(A1:B4)` still returns a placeholder `#PARSE`) — see
**D-036**, which gives it a home and four binding constraints. Phase 2's own criterion already
demands the proof.

Current phase: **2 — Table primitive.** "Wire the formula engine into cell slots. Add reference
adjustment. Still headless."
Last review point: **0037-REVIEW-phase1, ACCEPT WITH EDITS** — two edits (`%` now takes the
divisor's sign; the `NOT` dispatch comments corrected), three rulings: **D-036** (range evaluation
belongs to the table primitive's cycle), **D-037** (`%` follows Excel's `MOD`; comparisons stay
same-type-only), and **Q-010** raised for the human.
Cycles since last review: **0/3** · diff since last review: **0 lines / 0 files** (cap 800/10).

## Next slice
Phase 2's first slice, per PROJECT_BRIEF §6 and 0037-REVIEW §9 — **read that section before
designing anything.** The three temporary bridges (`mutation.ts`'s `findUnsupportedFormulaAsts`,
`graph/eval.ts`'s `evaluateFormula` `#PARSE` branch, `deriveEdges`'s `ReferenceNode`-only
narrowing) come down together, not one at a time. Ask the human **Q-010** early: it sets the
authoring contract for every formula a user types. Anything touching `mutation.ts`, `graph/*`, or
`primitives/schema.ts` is load-bearing under §6.2.

## Built and reviewed (all of Phase 0 and Phase 1)
- Scaffold, `graph/node.ts`, `graph/edge.ts`, `primitives/schema.ts`, `graph/cycles.ts`,
  `graph/eval.ts`, `mutation.ts`, `document.ts`, `address.ts` — Phase 0, signed off at
  0027-REVIEW-phase0; unchanged in substance since.
- **`formula/ast.ts`** (14 tests) — the full §5.3 grammar plus `ErrorNode` (D-028).
- **`formula/lexer.ts`** (36 tests) · **`formula/parser.ts`** (49 tests) — stages 1 and 2.
- **`formula/deps.ts`** (20 tests) — `extractDependencies`: eager, total, both `IF` branches, both
  `AND`/`OR`/`NOT` forms, ranges reported unexpanded as a `RangeDependency`.
- **`formula/functions.ts`** (44 tests) — all 23 built-ins; `IF`/`AND`/`OR` are lazy entries with
  no `implementation` field to call (D-029, compiler-enforced); `finiteResult` is the one shared
  D-033 guard, exported as of cycle 0036 and used by `eval.ts` too.
- **`formula/eval.ts`** (47 tests, cycle 0036 + this review's edits) — `evaluate(ast, read)`:
  structural recursion, never throws. `IF`/`AND`/`OR` dispatched at the call site BEFORE any
  argument is evaluated (D-029); arity checked before that; `AND`/`OR` share one lazy operand-array
  walk so the infix form is just the N=2 case; `NOT` delegates to the registry. Arithmetic routes
  through `finiteResult`; `/` and `%` by zero are `#DIV0`; `%` takes the divisor's sign (D-037);
  comparisons are same-type-only (D-037). A `RangeNode` returns a temporary `#PARSE` (D-036).
  NOT wired into `graph/eval.ts` or `mutation.ts` — that is Phase 2.

## Acceptance criteria
- **Phase 0** — all four PASSING and REVIEWED (0027-REVIEW).
- **Phase 1** — PASSED at 0037-REVIEW, nine clauses outright, one carried: see that entry's §4
  clause-by-clause table. Carried clause: **ranges in aggregates, EVALUATION half** (D-036).
- **Phase 2** — not started. Its criterion already includes the carried clause ("`SUM(A1:A5)`
  recomputes correctly after inserting a row inside the range").

## Known problems
- **Range evaluation is a placeholder `#PARSE`** (D-036). Four binding constraints on the cycle
  that fixes it, the sharpest being: **never ship a cell that accepts `= SUM(A1:A5)` and then shows
  `#PARSE` forever** — implement expansion in the same cycle that makes range formulas storable, or
  keep rejecting them at authoring time.
- **`MIN`/`MAX` spread their argument list** (`Math.min(...numbers)`), which throws `RangeError` on
  a very large one. Unreachable until ranges flatten into arguments — owned by that same cycle
  (0035-REVIEW Finding 4, carried).
- **NEW: `describeValueType` is duplicated verbatim** in `functions.ts` (private) and `eval.ts`
  (private). Same function, same union; a future `Value` variant needs both updated or the error
  messages drift. Fix by exporting one or moving it beside `Value` in `graph/node.ts` — the next
  cycle that touches either file should just do it (0037-REVIEW Finding 4).
- **The three temporary bridges** — `findUnsupportedFormulaAsts` (mutation.ts), `evaluateFormula`'s
  `#PARSE` branch (graph/eval.ts), `deriveEdges`'s `ReferenceNode`-only narrowing — come down
  together in Phase 2's wiring cycle, never one at a time.
- **D-031's value-legality walk does not yet reach a stored AST's literals.** `evaluate` returns a
  `LiteralNode`'s value unchecked, correctly (the check belongs at mutation time) — the hole opens
  the moment formulas become storable, so it closes in that same cycle.
- **`camera` has no WRITE-side guard** (D-027, carried).
- **The journal's STRUCTURE is deliberately unvalidated** beyond `Array.isArray` (carried).
- **L-16, L-17/L-18/L-14, §5.11's `style` field, `nextObjectId` reconciliation, `noUnusedLocals`
  off, L-6–L-15 cosmetics, recursion depth, table/`cells` hardcoding — carried unchanged.**
- **`lexer.ts`'s two disclosed edge cases** (carried).
- **SETTLED, do not re-raise:** `^` is left-associative (D-030) · function names are
  case-sensitive uppercase-only · `CONCAT` takes strings with no coercion · a `RangeNode` is
  reported pre-expansion by `deps.ts` · `IF` is exactly 3 args, `AND`/`OR` at least 1 (D-035) ·
  a computed `-0` normalises to `+0` (D-033) · `%` follows Excel's `MOD` and comparisons are
  same-type-only (D-037) · everything 0029/0032/0035-REVIEW listed settled.

## Live PROVISIONAL tags and open questions
**`PROVISIONAL(Q-007)`** → `document.ts`'s `CameraState`. **`PROVISIONAL(Q-008)`** →
`graph/node.ts`'s `isIllegalNumber` (compute side narrowed by D-033; storage side unchanged).
**Q-010 NEW, OPEN, for the human** — is an unknown function name / wrong argument count rejected at
authoring time, or accepted and shown as an error value? Recommendation (b) recorded; three test
expectations named and pre-authorised to move with whichever option lands. **Q-004** (lowercase
cell refs) now matters twice over in Phase 2 — range enumeration reads cell forms in bulk.
**Q-001/Q-002** (Phase 3) deferred. **Q-003** → D-007, **Q-005**, **Q-006** → D-025, **Q-009** →
D-029: answered. Next free: **Q-011**.

## Gotchas for the next model
- **Read 0037-REVIEW-phase1 §9 (Phase 2 opening notes) and D-036 before designing the wiring.**
  Both were written for exactly the cycle you are about to start.
- **D-029 is still the rule most likely to be broken by accident**, now in a new place: when
  `graph/eval.ts` calls `formula/eval.ts`, do not "simplify" the call-site dispatch of
  `IF`/`AND`/`OR` into a registry lookup. The registry has no `implementation` for them, by design.
- **`evaluate(ast, read)` takes a `read` callback and nothing else** — no `EvalContext` is threaded
  through yet, deliberately. Phase 5 adds `TextMeasurer` when text needs it; do not add it "while
  you're there".
- **One shared guard for numbers: `finiteResult` (D-033).** Three callers now. Do not write a
  fourth copy.
- **Look up a registry by `Object.hasOwn`, never a bare index (D-034)** — `parser.ts` still
  validates no function name, so `toString(1)` reaches lookups as ordinary user text (see Q-010).
- **An operator semantic the brief does not state is a DECISION** — D-037's own process note.
  Reaching for JavaScript's default is a choice, and it belongs in the entry's Decisions section.
- **`src/engine/` contains no `throw`, and should stay that way.**
- **Range placement (`parser.ts`), range DEPENDENCY reporting (`deps.ts`), and range EVALUATION
  (`eval.ts`, unbuilt) are three different concerns.** Do not collapse them.
- **Batch discipline is fixed and should stay fixed:** cycle 0036 ran one file, hit its phase gate,
  and stopped — after two consecutive batches that blew the §6.3 cap. That is the pattern to keep.
- Each PowerShell call is a fresh process; the Bash tool's `npm` is not on PATH — use PowerShell.
