# STATUS — as of entry 0031-formula-parser

STATE: GREEN (compiles under both configs, 317/317 tests pass, 0 skipped, 0 `.only`). **Process
state: REVIEW REQUIRED before the next cycle begins** — the §6.3 batch cap is exceeded (see below).
Do not start `deps.ts`, `functions.ts`, or any other new slice until this lands.

Current phase: **1 — Formula engine (`formula/*`), standalone.** Phase 0 is COMPLETE and SIGNED OFF
(0027-REVIEW-phase0). Last review point: **0029-REVIEW-phase1, verdict ACCEPT WITH EDITS.**
Cycles since last review: **2/3** · diff since last review: **1768 lines / 5 files (`src/` only) —
EXCEEDS the 800/10 cap.** Breakdown: 0030 (lexer.ts) was 707/2; 0031 (parser.ts + the
`address.ts` export it needed) added 1061/3 more. **Review is mandatory now regardless of whether
any §6.1 trigger independently fired** — entry 0031 states this explicitly as `REVIEW: REQUIRED`.

## Next slice — BLOCKED pending review
`deps.ts` (`extractDependencies`, eager/total per §5.3/§9) is next once review clears, followed by
`functions.ts` and `formula/eval.ts` — per PROJECT_BRIEF §6's Phase 1 build order. Phase 1's
acceptance criterion needs ALL of these; none is claimed yet, including by entry 0031.

## Built
- Scaffold, `graph/node.ts`, `graph/edge.ts`, `primitives/schema.ts`, `graph/cycles.ts`,
  `graph/eval.ts`, `mutation.ts`, `document.ts` — all reviewed and unchanged in substance since
  0029-REVIEW. See entries 0025–0029 for detail; not repeated here.
- **`address.ts`** (44 tests, unchanged in substance) — THIS cycle added ONE new export,
  `isCellReferenceForm(segment): boolean`, a thin wrapper around the existing private
  `CELL_REFERENCE_PATTERN`, needed by `parser.ts` for bare-cell-ref detection (D-008: reuse the
  exact pattern, never a second copy). No behavior change to any existing export. Flagged to the
  reviewer explicitly (entry 0031, question 3) since it IS new surface area on a load-bearing file.
- **`formula/ast.ts`** (14 tests) — unchanged this cycle.
- **`formula/lexer.ts`** (36 tests, cycle 0030) — unchanged this cycle.
- **`formula/parser.ts`** (NEW this cycle, 46 tests) — `parseFormulaTokens(tokens, objects,
  tableObjectId?)` and `parseFormula(source, objects, tableObjectId?)`. Full recursive-descent
  implementation of §5.3's precedence chain, references (dotted + bare cell ref), function calls
  including D-029's `AND`/`OR`/`NOT` dual forms, and ranges restricted to a direct aggregate
  argument via a post-parse tree walk. Never throws; returns `FormulaAst | ParseError`. Does NOT
  validate function name/arity (deferred to `functions.ts`) except the narrow aggregate-name check
  range placement needs. See the file's own header for full design rationale — it is extensive and
  intentionally not duplicated here.

## Acceptance criterion — Phase 0, all four PASSING and REVIEWED (unchanged, see 0027-REVIEW)
Phase 1's criterion is NOT YET claimed. This cycle demonstrates several named clauses in isolation
(literals, precedence, nested IF, reference resolution, ranges in aggregates, #PARSE-not-throw) —
NOT eager/total dependency extraction or lazy/short-circuit evaluation (`deps.ts`/`eval.ts` unbuilt).

## Known problems
- **`findUnsupportedFormulaAsts` (mutation.ts) and `evaluateFormula`'s `#PARSE` branch
  (graph/eval.ts) are BOTH temporary** (carried, unchanged) — delete both, and `deriveEdges`'s
  matching narrowing, the moment Phase 2 wires in the real `formula/eval.ts`.
- **`camera` has no WRITE-side guard** (D-027, carried).
- **The journal's STRUCTURE is deliberately unvalidated** beyond `Array.isArray` (carried).
- **L-16, L-17/L-18/L-14, §5.11's `style` field, `nextObjectId` reconciliation, `noUnusedLocals`
  off, L-6–L-15 cosmetics, recursion depth, table/`cells` hardcoding — all carried unchanged.**
- **`lexer.ts`'s two disclosed edge cases (a string can't end in a literal backslash before its
  closing quote; two adjacent purely-numeric path segments merge into one NUMBER token) are
  unchanged, inherited by `parser.ts` — the second is explicitly noted in `parser.ts`'s own header
  as never arising for any real schema path (only `vertex.N.x`/`vertex.N.y` use numeric segments,
  always a single index).**
- **NEW this cycle: `SUM((A1:B4))` is accepted, identically to `SUM(A1:B4)`** — a disclosed,
  deliberate consequence of range-placement validation being a post-parse tree walk rather than
  inline/threaded tracking (parens add no AST node, so the two are indistinguishable post-parse).
  Flagged to the reviewer as question 1 of entry 0031.
- **NEW this cycle: `^` (exponentiation) is left-associative**, a documented implementer decision
  (§5.3 is silent; Excel's own `^` is left-associative) rather than a brief-stated rule. Flagged to
  the reviewer as question 2 of entry 0031.
- **SETTLED, do not re-raise:** everything 0029-REVIEW's STATUS already listed settled, PLUS:
  whether `lexer.ts` needs its own keyword vocabulary (it does), whether `IF` gets one (it does
  not), and now: the full precedence chain's tier structure, D-029's dispatch mechanism
  (`isFunctionNameToken` + one-token lookahead), and range-placement-as-post-parse-walk.

## Live PROVISIONAL tags and open questions
**`PROVISIONAL(Q-007)`** → `document.ts`'s `CameraState`. **`PROVISIONAL(Q-008)`** →
`graph/node.ts`'s `isIllegalNumber`. **Q-009** ANSWERED → D-029. **Q-005** ANSWERED. **Q-006**
ANSWERED → D-025. **Q-001/Q-002** (Phase 3), **Q-004** (Phase 2, inherited unchanged by `parser.ts`
this cycle — see `address.ts`'s `isCellReferenceForm` doc comment) deferred. **Q-003** → D-007.
No new question raised this cycle. Next free: **Q-010**.

## Gotchas for the next model
- **STOP: do not start a new slice.** The §6.3 batch cap is exceeded (1768/800 lines since
  0029-REVIEW). Entry 0031 is `REVIEW: REQUIRED`. If you are an implementer reading this before a
  review has landed, write nothing beyond what this file and entry 0031 already say — orient,
  confirm the cap is still unresolved, and stop.
- **`parser.ts` does NOT validate function names or arity** — `FOO(1,2,3)` parses successfully.
  Only `functions.ts` (unbuilt) rejects an unknown name. Do not "fix" this in `parser.ts`.
- **Range placement is a POST-PARSE tree walk (`validateRangePlacement`), not inline tracking.**
  `ParseError.start` is `0` for any error this walk produces — the AST carries no source positions
  at all (an `ast.ts` design choice), so this is a genuine, disclosed limitation, not a bug to fix
  by "just threading the position through."
- **`^` is left-associative, `AND`/`OR`/`NOT`'s dual-form dispatch lives in `parsePrimaryExpr` +
  `parseUnaryExpr`'s one-token lookahead (`peekAt(state,1).type === "lparen"`)** — both are
  documented implementer decisions, both flagged explicitly to the reviewer, neither should be
  silently "corrected" without reading entry 0031's own reasoning first.
- **D-029, still binding, still not implemented in any evaluator**: `IF`/`AND`/`OR` MUST be
  evaluated lazily by `formula/eval.ts` itself, never by a `functions.ts` registry entry computing
  from pre-evaluated arguments — in BOTH syntactic forms. `NOT` is an ordinary registry entry.
  `deps.ts` stays eager and total over both forms. `parser.ts` only produces the correct AST SHAPE
  for both forms — it does not and cannot enforce this evaluation-order rule; that binds whoever
  writes `functions.ts`/`eval.ts` next.
- **`isCellReferenceForm` (address.ts, NEW this cycle) is the ONLY sanctioned way to detect a bare
  cell-ref-shaped segment outside `address.ts` itself.** Do not re-derive the regex elsewhere.
- **`ErrorNode` still exists but nothing constructs one yet, deliberately (D-028)** — unchanged.
- Each PowerShell call is a fresh process; the Bash tool's `npm` is not on PATH — use PowerShell.
