# STATUS — as of entry 0039-lowercase-cells-and-formula-validation

STATE: GREEN (compiles under both configs, 437/437 tests pass, 0 skipped, 0 `.only`).

**PHASE 1 IS COMPLETE AND SIGNED OFF** (0037-REVIEW-phase1, verdict ACCEPT WITH EDITS; gate
PASSED). **Phase 2 — Table primitive — is OPEN**, and its two immediately-executable opening
rulings (D-039, D-038) are now DONE (entry 0039). One Phase 1 criterion clause is still carried
into Phase 2 by name: **range EVALUATION** (`SUM(A1:B4)` still returns a placeholder `#PARSE`) —
see **D-036**, which gives it a home and four binding constraints. Phase 2's own criterion already
demands the proof.

Current phase: **2 — Table primitive.** "Wire the formula engine into cell slots. Add reference
adjustment. Still headless."
Last review point: **0037-REVIEW-phase1, ACCEPT WITH EDITS** — two edits (`%` now takes the
divisor's sign; the `NOT` dispatch comments corrected), three rulings: **D-036** (range evaluation
belongs to the table primitive's cycle), **D-037** (`%` follows Excel's `MOD`; comparisons stay
same-type-only). Since then: entry **0038-RULINGS** (the human closed four open questions — see
below), and entry **0039** (implementer, this cycle — executed D-039 and D-038).
Cycles since last review: **1/3** · diff since last review: **153 lines / 5 files** (cap 800/10).

## Next slice
The real Phase 2 work, per PROJECT_BRIEF §6 and 0037-REVIEW §9 — **read that section, and D-036,
before designing anything.** Likely starts with `primitives/table.ts` (a new subsystem's first
file — §6.1 trigger 2 fires immediately on it, forcing a stop right after) declaring the table
schema: default 8×8, A1-style `cells.*` slot family, row/column insert/delete. From there:

- The range-enumeration helper (bijective base-26 — `address.ts` already admits multi-letter
  columns) lives beside the table primitive or in `address.ts` itself (D-036 constraint 2).
- `evaluate` expands a range through its own `read` callback (D-036 constraint 1);
  `evaluateRangeNode`'s placeholder is DELETED, not extended (constraint 3).
- `deriveEdges` must expand a `RangeDependency` from CURRENT table dimensions on every mutation,
  never cached.
- A formula containing a range must not be storable until evaluation works, in the SAME cycle
  (constraint 4) — the outcome D-036 forbids is a cell that accepts `= SUM(A1:A5)` and shows
  `#PARSE` forever.
- `MIN`/`MAX`'s `Math.min(...)` spread (0035-REVIEW Finding 4) is this same cycle's problem once
  ranges flatten into long argument lists (constraint 5).
- **The three temporary bridges** — `mutation.ts`'s `findUnsupportedFormulaAsts`, `graph/eval.ts`'s
  `evaluateFormula` `#PARSE` branch, `deriveEdges`'s `ReferenceNode`-only narrowing — come down
  TOGETHER in this cycle, not one at a time.
- **D-031's value-legality walk** must reach a stored AST's `LiteralNode`s in the same cycle that
  makes formulas storable.

Anything touching `mutation.ts`, `graph/*`, or `primitives/schema.ts` is load-bearing under §6.2.

## Built and reviewed (all of Phase 0 and Phase 1)
- Scaffold, `graph/node.ts`, `graph/edge.ts`, `primitives/schema.ts`, `graph/cycles.ts`,
  `graph/eval.ts`, `mutation.ts`, `document.ts`, `address.ts` — Phase 0, signed off at
  0027-REVIEW-phase0.
- **`formula/ast.ts`** (14 tests) — the full §5.3 grammar plus `ErrorNode` (D-028).
- **`formula/lexer.ts`** (36 tests) · **`formula/parser.ts`** (52 tests, now including D-038's
  name/arity validation — cycle 0039) — stages 1 and 2.
- **`formula/deps.ts`** (20 tests) — `extractDependencies`: eager, total, both `IF` branches, both
  `AND`/`OR`/`NOT` forms, ranges reported unexpanded as a `RangeDependency`.
- **`formula/functions.ts`** (44 tests) — all 23 built-ins; `IF`/`AND`/`OR` are lazy entries with
  no `implementation` field to call (D-029, compiler-enforced); `finiteResult` is the one shared
  D-033 guard, exported as of cycle 0036 and used by `eval.ts` too.
- **`formula/eval.ts`** (47 tests) — `evaluate(ast, read)`: structural recursion, never throws.
  `IF`/`AND`/`OR` dispatched at the call site BEFORE any argument is evaluated (D-029); arity
  checked before that; `AND`/`OR` share one lazy operand-array walk so the infix form is just the
  N=2 case; `NOT` delegates to the registry. Arithmetic routes through `finiteResult`; `/` and `%`
  by zero are `#DIV0`; `%` takes the divisor's sign (D-037); comparisons are same-type-only
  (D-037). A `RangeNode` returns a temporary `#PARSE` (D-036). NOT wired into `graph/eval.ts` or
  `mutation.ts` — that is Phase 2.

## Built this batch, not yet reviewed (cycle 0039)
- **`address.ts` (D-039)** — `CELL_REFERENCE_PATTERN` now accepts either case; a lowercase bare
  cell ref or `table_x.a1` normalises to the identical stored `Address` an uppercase spelling
  produces, via the one new `normalizeCellReference` helper called from both `toStoredPath` and
  `bareCellAddress` — the ONE point cell-reference case is decided.
- **`formula/parser.ts` (D-038)** — `parseFunctionCallExpr` now rejects an unrecognised function
  name or a wrong argument count at `#PARSE` time (via `functions.ts`'s own `getFunctionEntry`/
  `checkArity`), naming the function and pointing `ParseError.start` at its position.
- Both mutation-tested (entry 0039); neither is a §6.1 trigger — both pre-authorised by
  0038-RULINGS.

## Acceptance criteria
- **Phase 0** — all four PASSING and REVIEWED (0027-REVIEW).
- **Phase 1** — PASSED at 0037-REVIEW, nine clauses outright, one carried: see that entry's §4
  clause-by-clause table. Carried clause: **ranges in aggregates, EVALUATION half** (D-036).
- **Phase 2** — not started. Its criterion already includes the carried clause ("`SUM(A1:A5)`
  recomputes correctly after inserting a row inside the range").

## Known problems
- **Range evaluation is a placeholder `#PARSE`** (D-036). Four binding constraints on the cycle
  that fixes it — see "Next slice" above.
- **`MIN`/`MAX` spread their argument list** (`Math.min(...numbers)`), which throws `RangeError` on
  a very large one. Unreachable until ranges flatten into arguments — owned by that same cycle
  (0035-REVIEW Finding 4, carried).
- **`describeValueType` is duplicated verbatim** in `functions.ts` (private) and `eval.ts`
  (private). Same function, same union; a future `Value` variant needs both updated or the error
  messages drift. Fix by exporting one or moving it beside `Value` in `graph/node.ts` (0037-REVIEW
  Finding 4, carried, untouched this cycle).
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
  same-type-only (D-037) · **a typo'd formula is refused at entry (D-038), IMPLEMENTED cycle
  0039** · **lowercase cell refs are accepted and normalised to uppercase (D-039), IMPLEMENTED
  cycle 0039** · an explicit write replaces a formula, dragging unchanged (D-040, Phase 3 —
  nothing to build yet) · `unlink` keeps what was displayed (D-041, Phase 3 — nothing to build
  yet) · this is a one-user tool, no product/market reasoning (D-042) · everything
  0029/0032/0035-REVIEW listed settled.

## Live PROVISIONAL tags and open questions
**Zero open questions block any phase.** Q-010 → D-038, Q-004 → D-039, Q-002 → D-040, Q-001 → D-041
(all ruled at 0038-RULINGS; D-038/D-039 now also implemented, cycle 0039). D-042 is standing and
applies to every future entry: *this is a tool with one user — no product or "users will expect"
reasoning.*

Still open, blocking nothing: **`PROVISIONAL(Q-007)`** → `document.ts`'s `CameraState` (resolves
when Phase 3 builds `render/camera.ts`); **`PROVISIONAL(Q-008)`** → `graph/node.ts`'s
`isIllegalNumber` (compute side narrowed by D-033; storage side unchanged, approved as provisional).
Answered earlier: **Q-003** → D-007, **Q-005**, **Q-006** → D-025, **Q-009** → D-029.
Next free: **Q-011**.

## Gotchas for the next model
- **D-042: this is a TOOL with exactly one user.** Justify a choice by whether it is correct,
  simple (Rule 5), and cheap to change (§9) — never by "users will expect" or any appeal to a
  market that does not exist. An argument that reduces to "someone might be confused" carries no
  weight here; "this silently produces the wrong number" carries all of it.
- **D-040 covers the `set` command only.** Dragging still behaves per §5.9 (slide the free axis,
  report what drives the other). Do not "make it consistent" by widening one into the other.
- **Cell-reference case normalisation happens at exactly one point (D-039): `normalizeCellReference`
  in `address.ts`, called only from `toStoredPath` and `bareCellAddress`.** A future call site that
  builds a cell path (the table primitive's own row/column operations, most likely) MUST route
  through one of those two, or through the helper directly — never re-derive `.toUpperCase()`.
- **A formula's name/arity is now validated at parse time (D-038)** — `formula/eval.ts`'s own
  "unknown function"/"wrong arity" arms are DEFENSIVE ONLY as of cycle 0039 (unreachable from
  typed input, still reachable from a loaded document's stored AST, D-031's world). Do not remove
  them; do not assume `parseFormula` was called on everything `evaluate` ever sees.
- **D-038's autocomplete condition is binding**, not a footnote: validate at commit not per
  keystroke, carry the offending name AND its position in the error (`ParseError.start` — reused,
  not a new field), keep the registry enumerable, never discard the rejected source text.
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
- **Look up a registry by `Object.hasOwn`, never a bare index (D-034).**
- **An operator/parse-time semantic the brief does not state is a DECISION** — D-037's own process
  note, reinforced by D-038/D-039 both landing as explicit human rulings rather than silent choices.
- **`src/engine/` contains no `throw`, and should stay that way.**
- **Range placement (`parser.ts`), range DEPENDENCY reporting (`deps.ts`), and range EVALUATION
  (`eval.ts`, unbuilt) are three different concerns.** Do not collapse them.
- **Batch discipline is fixed and should stay fixed:** cycle 0036 ran one file, hit its phase gate,
  and stopped. Cycle 0039 ran two small, related, pre-authorised rulings and stopped short of the
  much larger wiring slice rather than blurring the two together. Keep that pattern.
- Each PowerShell call is a fresh process; the Bash tool's `npm` is not on PATH — use PowerShell.
