# STATUS — as of entry 0032-REVIEW-phase1

STATE: GREEN (compiles under both configs, 321/321 tests pass, 0 skipped, 0 `.only`). **Cycles
0030 and 0031 are REVIEWED — 0032-REVIEW-phase1, ACCEPT WITH EDITS. `deps.ts` is UNBLOCKED.**

Current phase: **1 — Formula engine (`formula/*`), standalone.** Phase 0 is COMPLETE and SIGNED OFF
(0027-REVIEW-phase0). Last review point: **0032-REVIEW-phase1, verdict ACCEPT WITH EDITS** —
three latent defects fixed (`isParseError` vs `ErrorNode`, a hand-built cell path, the engine's
only `throw`) and three
rulings: **D-030** (`^` left-associative), **D-031** (numbers in stored ASTs), **D-032** (error
predicates). Cycles since last review: 0/3 · diff since last review: 0 lines / 0 files (cap
800/10). The reviewed batch ran to 1768 lines — 2.2× the cap. **End a batch before starting any
cycle that cannot fit the remaining headroom** (0032-REVIEW §6): at 707/800 after cycle 0030, the
right move was to stop.

## Next slice — `deps.ts` (unblocked)
`deps.ts` (`extractDependencies`, eager/total per §5.3/§9 — across BOTH `IF` branches and BOTH
syntactic forms of `AND`/`OR`/`NOT`, D-029; yielding nothing for an `ErrorNode`, D-028), followed by
`functions.ts` and `formula/eval.ts` — per PROJECT_BRIEF §6's Phase 1 build order. Phase 1's
acceptance criterion needs ALL of these; none is claimed yet, including by entry 0031.

## Built
- Scaffold, `graph/node.ts`, `graph/edge.ts`, `primitives/schema.ts`, `graph/cycles.ts`,
  `graph/eval.ts`, `mutation.ts`, `document.ts` — all reviewed and unchanged in substance since
  0029-REVIEW. See entries 0025–0029 for detail; not repeated here.
- **`address.ts`** (44 tests, unchanged in substance) — THIS cycle added ONE new export,
  `isCellReferenceForm(segment): boolean`, a thin wrapper around the existing private
  `CELL_REFERENCE_PATTERN`, needed by `parser.ts` for bare-cell-ref detection (D-008: reuse the
  exact pattern, never a second copy). 0032-REVIEW added the OTHER half, `bareCellAddress`, after
  finding `parser.ts` hand-building `["cells", ref]` — sharing the regex but copying the stored
  path shape, which is the half that decides which slot a ref lands on. Both spellings of one cell
  are now pinned to one slot by a test. No behavior change to any existing export.
- **`formula/ast.ts`** (14 tests) — unchanged this cycle.
- **`formula/lexer.ts`** (36 tests, cycle 0030) — unchanged this cycle.
- **`formula/parser.ts`** (46 + 3 tests) — `parseFormulaTokens(tokens, objects,
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
- **`^` (exponentiation) is left-associative — now RULED, D-030.** §5.3 is silent; §1 names Excel
  as this project's formula model and Excel's `^` is left-associative. Do not "correct" it to the
  mathematical right-associative convention. Where §5.3 is silent on a formula-language detail,
  Excel is the tie-breaker.
- **NEW (0032-REVIEW, D-031): a `LiteralNode`'s `value` inside a stored AST is unchecked
  document state.** `findIllegalSlotValues` walks `slot.value` only, never `slot.ast`, so a
  `LiteralNode` holding `Infinity` (which `parseFormula` CAN now produce, from a 400-digit
  literal) would serialize to `null` — D-025's own defect, fourth round. Unreachable today ONLY
  because `findUnsupportedFormulaAsts` rejects every non-reference AST shape. **The cycle that
  deletes that check MUST extend the value-legality walk to formula ASTs in the same cycle.**
- **SETTLED, do not re-raise:** everything 0029-REVIEW's STATUS already listed settled, PLUS
  `SUM((A1:B4))`'s acceptance (0032-REVIEW confirmed: a redundant paren is transparent in a grammar
  with no `ParenNode`, and the walk is correctly strict for `SUM(A1:B4 + 1)`, `SUM((A1:B4) + 1)`
  and `SUM(IF(x, A1:B4, y))`), and:
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
- **Batch discipline (0032-REVIEW §6):** end a batch before starting any cycle that cannot fit the
  remaining headroom under the 800-line cap — roughly, stop if under ~200 lines are left. The last
  batch reached 2.2× the cap because a 707/800 cycle was followed by the densest file of the phase.
- **`parser.ts` does NOT validate function names or arity** — `FOO(1,2,3)` parses successfully.
  Only `functions.ts` (unbuilt) rejects an unknown name. Do not "fix" this in `parser.ts`.
- **Range placement is a POST-PARSE tree walk (`validateRangePlacement`), not inline tracking.**
  `ParseError.start` is `0` for any error this walk produces — the AST carries no source positions
  at all (an `ast.ts` design choice), so this is a genuine, disclosed limitation, not a bug to fix
  by "just threading the position through."
- **`^` is left-associative (D-030, ruled), `AND`/`OR`/`NOT`'s dual-form dispatch lives in
  `parsePrimaryExpr` + `parseUnaryExpr`'s one-token lookahead (`peekAt(state,1).type === "lparen"`)**
  — neither should be silently "corrected" without reading entry 0031's reasoning and D-030 first.
- **An error-shaped type predicate discriminates on the CODE, never on the presence of an `error`
  field (D-032).** `ErrorNode` (`{ type: "error"; error: "#REF" }`) is a `FormulaAst` that has an
  `error` field — a presence check calls a valid repaired AST a parse failure. `isParseError` was
  fixed at 0032-REVIEW; `isAddressError` still uses a presence check and is correct only because
  its domain (`Address`/`string`) has no `error` field — tighten it before widening that domain.
- **`src/engine/` contains no `throw`, and should stay that way.** 0032-REVIEW removed the one
  that existed (`walkForRangePlacement`'s exhaustiveness arm). Compile-time exhaustiveness via
  `const exhaustive: never = node` is the guarantee worth having; returning a `#PARSE` beside it
  costs nothing and keeps every stage's "never throws" invariant literally true.
- **D-029, still binding, still not implemented in any evaluator**: `IF`/`AND`/`OR` MUST be
  evaluated lazily by `formula/eval.ts` itself, never by a `functions.ts` registry entry computing
  from pre-evaluated arguments — in BOTH syntactic forms. `NOT` is an ordinary registry entry.
  `deps.ts` stays eager and total over both forms. `parser.ts` only produces the correct AST SHAPE
  for both forms — it does not and cannot enforce this evaluation-order rule; that binds whoever
  writes `functions.ts`/`eval.ts` next.
- **`isCellReferenceForm` (address.ts, NEW this cycle) is the ONLY sanctioned way to detect a bare
  cell-ref-shaped segment outside `address.ts` itself.** Do not re-derive the regex elsewhere.
- **`ErrorNode` still exists but nothing constructs one yet, deliberately (D-028)** — unchanged.
  Two of 0032-REVIEW's three fixes were assumptions written before it existed; when it starts being
  constructed in Phase 2, grep for code that assumes an AST cannot carry an `error` field.
- Each PowerShell call is a fresh process; the Bash tool's `npm` is not on PATH — use PowerShell.
