# STATUS — as of entry 0033-formula-deps

STATE: GREEN (compiles under both configs, 341/341 tests pass, 0 skipped, 0 `.only`). Cycle 0033
(`deps.ts`) is UNREVIEWED but under no obligation to stop — no §6.1 trigger fired and the batch cap
is nowhere near exceeded (see below). **`functions.ts` is UNBLOCKED**, but read the Gotchas section
below before starting it.

Current phase: **1 — Formula engine (`formula/*`), standalone.** Phase 0 is COMPLETE and SIGNED OFF
(0027-REVIEW-phase0). Last review point: **0032-REVIEW-phase1, verdict ACCEPT WITH EDITS** — three
latent defects fixed (`isParseError` vs `ErrorNode`, a hand-built cell path, the engine's only
`throw`) and three rulings: **D-030** (`^` left-associative), **D-031** (numbers in stored ASTs),
**D-032** (error predicates). Cycles since last review: **1/3** · diff since last review: **393
lines / 2 files** (cap 800/10, well under).

## Next slice — `functions.ts` (unblocked, read the Gotchas note first)
`functions.ts`: the table-driven built-in registry (name → arity → implementation) for `IF`, `AND`,
`OR`, `NOT`, `SUM`, `MIN`, `MAX`, `AVG`, `ABS`, `ROUND(n, digits)`, `FLOOR`, `CEIL`, `SQRT`, `POW`,
`CONCAT`, `LEN`, `PI()`, `SIN`, `COS`, `TAN`, `ATAN2`, `DEG`, `RAD` (§5.3's own list). **D-029 binds
this file directly**: `IF`/`AND`/`OR` may be registered for arity/name-checking purposes but MUST
NOT hold an implementation that computes from pre-evaluated arguments — that lazy, short-circuit
evaluation is `formula/eval.ts`'s job, at the `FunctionCallNode` site, in BOTH syntactic forms. `NOT`
is an ordinary registry entry (one argument, no branch to skip). Getting this backwards produces a
formula engine that looks right and passes casual tests while silently evaluating the untaken branch
of every conditional — read D-029 in full (`claude/DECISIONS.md`) before writing this file, not
after. Followed by `formula/eval.ts` — per PROJECT_BRIEF §6's Phase 1 build order. Phase 1's
acceptance criterion needs ALL of `functions.ts`/`eval.ts`; none is claimed yet.

## Built
- Scaffold, `graph/node.ts`, `graph/edge.ts`, `primitives/schema.ts`, `graph/cycles.ts`,
  `graph/eval.ts`, `mutation.ts`, `document.ts` — all reviewed and unchanged in substance since
  0029-REVIEW. See entries 0025–0029 for detail; not repeated here.
- **`address.ts`** (45 tests, unchanged this cycle) — see 0032-REVIEW for `bareCellAddress`.
- **`formula/ast.ts`** (14 tests) — unchanged this cycle.
- **`formula/lexer.ts`** (36 tests) — unchanged this cycle.
- **`formula/parser.ts`** (49 tests) — unchanged this cycle. See entry 0031/0032-REVIEW.
- **`formula/deps.ts`** (20 tests, cycle 0033) — `extractDependencies(ast): readonly Dependency[]`.
  Walks the entire `FormulaAst` eagerly and totally (§5.3, D-029): both `IF` branches, both
  syntactic forms of `AND`/`OR`/`NOT`, with zero special-casing by function name (the walk recurses
  into every `FunctionCallNode` arg and every operator's operand(s) unconditionally). `Dependency`
  is `ReferenceDependency | RangeDependency` — a `RangeNode` is reported as its own endpoint-pair
  shape, NOT expanded into individual cells (that expansion needs the target table's current
  dimensions and happens at edge-derivation time, per §5.3 — a disclosed design decision this cycle
  makes for whichever cycle wires this into `mutation.ts`, not yet done). Dependencies are NOT
  deduplicated (`a.v + a.v` yields two entries). `ErrorNode` (D-028) and `LiteralNode` yield nothing.
  Never throws. NOT wired into `mutation.ts`'s `deriveEdges` or `graph/eval.ts` this cycle — both
  stay on their existing, narrower `ReferenceNode`-only path until Phase 2 (see Known problems).
  See the file's own header for full design rationale.

## Acceptance criterion — Phase 0, all four PASSING and REVIEWED (unchanged, see 0027-REVIEW)
Phase 1's criterion is NOT YET claimed. Demonstrated so far, in isolation: literals, precedence,
nested IF, reference resolution, ranges in aggregates, #PARSE-not-throw (parser, entry 0031), and
eager/total dependency extraction across both IF branches and both AND/OR/NOT forms (deps, entry
0033). NOT yet demonstrated: lazy/short-circuit evaluation, the full built-in registry
(`functions.ts`/`eval.ts` unbuilt).

## Known problems
- **`findUnsupportedFormulaAsts` (mutation.ts) and `evaluateFormula`'s `#PARSE` branch
  (graph/eval.ts) are BOTH temporary** (carried, unchanged) — delete both, and `deriveEdges`'s
  matching narrowing, the moment Phase 2 wires in the real `formula/eval.ts`. `deriveEdges` still
  derives an edge only from the `ReferenceNode` shape — `deps.ts` existing does NOT change this;
  wiring `extractDependencies` into `deriveEdges` is explicitly Phase 2 work (§5.3: range expansion
  needs a table's current dimensions, which `primitives/schema.ts` cannot yet express for a slot
  FAMILY — see D-017's own forward note).
- **`camera` has no WRITE-side guard** (D-027, carried).
- **The journal's STRUCTURE is deliberately unvalidated** beyond `Array.isArray` (carried).
- **L-16, L-17/L-18/L-14, §5.11's `style` field, `nextObjectId` reconciliation, `noUnusedLocals`
  off, L-6–L-15 cosmetics, recursion depth, table/`cells` hardcoding — all carried unchanged.**
- **`lexer.ts`'s two disclosed edge cases** (carried, unchanged — see prior STATUS revisions for
  detail).
- **`^` (exponentiation) is left-associative — RULED, D-030.** Do not "correct" it.
- **A `LiteralNode`'s `value` inside a stored AST is unchecked document state (D-031)** — carried,
  unchanged. Still unreachable today only because `findUnsupportedFormulaAsts` rejects every
  non-reference AST shape; the cycle that deletes that check MUST extend the value-legality walk to
  formula ASTs in the same cycle (D-031's own binding text).
- **NEW: `formula/deps.ts`'s `RangeDependency` shape is a disclosed, forward-looking design choice
  with no consumer yet.** Nothing today reads `Dependency.kind === "range"` — pinned by tests inside
  `deps.test.ts` only. Whoever wires `extractDependencies` into `mutation.ts`'s `deriveEdges`
  (Phase 2) inherits this shape rather than needing to invent one; it is NOT yet validated against a
  real edge-derivation consumer.
- **SETTLED, do not re-raise:** everything 0029-REVIEW's and 0032-REVIEW's STATUS already listed
  settled (see prior revisions for the full list — precedence chain, D-029 dispatch,
  range-placement-as-post-parse-walk, `SUM((A1:B4))`'s acceptance, etc.), plus now: dependency
  extraction needs no per-function-name special-casing (walking every arg/operand unconditionally is
  sufficient for D-029), and a `RangeNode` is reported pre-expansion rather than flattened.

## Live PROVISIONAL tags and open questions
**`PROVISIONAL(Q-007)`** → `document.ts`'s `CameraState`. **`PROVISIONAL(Q-008)`** →
`graph/node.ts`'s `isIllegalNumber`. **Q-009** ANSWERED → D-029. **Q-005** ANSWERED. **Q-006**
ANSWERED → D-025. **Q-001/Q-002** (Phase 3), **Q-004** (Phase 2, inherited unchanged) deferred.
**Q-003** → D-007. No new question raised this cycle. Next free: **Q-010**.

## Gotchas for the next model
- **Read D-029 (`claude/DECISIONS.md`) in full before writing `functions.ts`.** The registry MUST
  NOT hold an eager implementation of `IF`/`AND`/`OR` — that's `eval.ts`'s job, lazily, at the call
  site, in both syntactic forms. `NOT` is the one exception (ordinary registry entry). Getting this
  backwards produces code that passes casual tests while evaluating the untaken branch of every
  conditional — the exact failure D-029 exists to prevent.
- **Batch discipline (0032-REVIEW §6, restated):** end a batch before starting any cycle that
  cannot fit the remaining headroom under the 800-line cap — roughly, stop if under ~200 lines are
  left. Currently 393/800 used (1/3 cycles) — real headroom, but `functions.ts` is likely to be
  dense (≈20 built-ins × implementation + tests, plus this project's own documentation-heavy style)
  and carries D-029's binding correctness rule. Entry 0033's own recommendation: treat it as its own
  cycle and stop the batch immediately after it rather than continuing straight to `eval.ts`.
- **`parser.ts` does NOT validate function names or arity** — `FOO(1,2,3)` parses successfully.
  Only `functions.ts` (next) rejects an unknown name.
- **Range placement is a POST-PARSE tree walk** in `parser.ts` (`validateRangePlacement`), unrelated
  to but easily confused with `deps.ts`'s `RangeDependency` shape — the former is a parse-time
  syntax restriction, the latter is a dependency-reporting shape. Don't conflate them.
- **`deps.ts`'s `extractDependencies` does NOT expand a range into concrete cells** — it reports the
  endpoint pair only (`RangeDependency`). Expansion needs a table's current dimensions and happens
  at edge-derivation time (`mutation.ts`), which does not consume this file yet.
- **`^` is left-associative (D-030, ruled), `AND`/`OR`/`NOT`'s dual-form dispatch lives in
  `parser.ts`'s `parsePrimaryExpr` + `parseUnaryExpr`** — neither should be silently "corrected"
  without reading entry 0031's reasoning and D-030 first. `deps.ts` achieves the SAME dual-form
  neutrality with no dispatch logic at all — it just walks every arg/operand unconditionally; that
  asymmetry (parser needs to dispatch, deps does not) is expected, not a sign one of them is wrong.
- **An error-shaped type predicate discriminates on the CODE, never on the presence of an `error`
  field (D-032).** `isParseError` was fixed at 0032-REVIEW; `isAddressError` is correct only because
  its domain has no `error` field — tighten it before widening that domain.
- **`src/engine/` contains no `throw`, and should stay that way.** `deps.ts`'s exhaustiveness arm
  follows the same non-throwing discipline `parser.ts`'s `walkForRangePlacement` established.
- **D-029, still binding, still not implemented in any evaluator**: `IF`/`AND`/`OR` MUST be
  evaluated lazily by `formula/eval.ts` itself, never by a `functions.ts` registry entry computing
  from pre-evaluated arguments — in BOTH syntactic forms. `NOT` is an ordinary registry entry.
  `deps.ts` (this cycle) IS eager and total over both forms, by construction — see Built above.
- **`isCellReferenceForm`/`bareCellAddress` (address.ts) are the ONLY sanctioned way to detect/build
  a bare cell-ref-shaped segment outside `address.ts` itself.** Do not re-derive the regex elsewhere.
- **`ErrorNode` still exists but nothing constructs one yet, deliberately (D-028)** — unchanged.
  `deps.ts` yields nothing for one (tested); when it starts being constructed in Phase 2, grep for
  code that assumes an AST cannot carry an `error` field.
- Each PowerShell call is a fresh process; the Bash tool's `npm` is not on PATH — use PowerShell.
