# 0031 — formula parser
Date: 2026-08-23   Phase: 1   Model: implementer (Claude Sonnet 5)
Previous entry: 0030-formula-lexer   Last review: 0029-REVIEW-phase1 (verdict: ACCEPT WITH EDITS)
Batch: cycle 2 of up to 3 since last review; **1768 lines / 5 files changed (`src/` only) —
exceeds the §6.3 cap (800/10) on the line dimension.** Review is mandatory regardless of §6.1.

## Declared scope
Build `formula/parser.ts` (§5.3's parser stage): consume `lexer.ts`'s token stream and produce a
`FormulaAst`, or a `#PARSE`-shaped `ParseError`, never throwing. Per 0029-REVIEW's carried
constraint 1, this is where D-029 (`AND`/`OR`/`NOT` dual forms), Q-004 (inherited, not re-decided),
and §5.3's range-placement rule all land — declared, and delivered, in one cycle.

## Explicitly not in scope
`deps.ts`, `functions.ts`, `formula/eval.ts` — not built. No function-name/arity validation beyond
the narrow, brief-mandated aggregate-name check needed for range placement. No text `{= }`/`{? }`
embedding (§5.6, Phase 5). No decision on Q-004 (still open, still uppercase-only, inherited via
`address.ts`'s newly-exported `isCellReferenceForm` rather than re-litigated here).

## What I did
- **`src/engine/address.ts`** — exported `isCellReferenceForm(segment): boolean`, a thin wrapper
  around the existing private `CELL_REFERENCE_PATTERN`. Needed so `parser.ts` detects a bare cell
  ref using the EXACT pattern `address.ts` already uses for `table_x.A1` shorthand (D-008: key on
  form, never a proxy), rather than keeping a second copy that could drift. Updated the file's own
  "NOT DONE HERE" section to name `parser.ts` as the consumer. No other change to `address.ts`;
  `parseAddress` itself is unchanged (still requires 2+ segments, as before).
- **`src/engine/formula/parser.ts`** (new) — `parseFormulaTokens(tokens, objects, tableObjectId?)`
  and `parseFormula(source, objects, tableObjectId?)`. Full recursive-descent implementation of
  §5.3's precedence chain (`OR -> AND -> comparison -> + - -> * / % -> ^ -> unary -/NOT -> primary`),
  one shared `parseLeftAssociativeExpr` helper backing the six binary tiers; literals; dotted and
  bare-cell references (resolved via `address.ts`'s `parseAddress` or the new `isCellReferenceForm`
  path); function calls, including `AND(...)`/`OR(...)`/`NOT(...)` call-syntax (D-029); ranges,
  parsed permissively wherever `reference : reference` occurs and restricted to a direct aggregate
  argument by a single post-parse tree walk (`validateRangePlacement`). Full design rationale for
  every judgment call is in the file's own header, not repeated here.
- **`src/engine/formula/parser.test.ts`** (new, 46 tests) — literals, references (dotted, bare cell
  ref with/without table context, Q-004's uppercase-only behaviour inherited unchanged), the full
  precedence chain including associativity, function calls (recognised and unrecognised names,
  nested `IF`), D-029's dual AND/OR/NOT forms (call syntax, infix/prefix syntax, N-ary calls, a bare
  keyword with no operand), range placement (accepted as a direct aggregate argument, rejected
  everywhere else including one level of nesting, a redundant-paren case explicitly accepted per
  the file's own disclosed simplification), and a malformed-input battery proving `parseFormula`
  never throws.

## Decisions I made
1. **`^` is left-associative.** §5.3 is silent; this project's own stated formula-language model is
   Excel (§1), whose `^` is itself left-associative (`2^3^2` = `(2^3)^2`). Not an arbitrary pick —
   the one reading consistent with the brief's own chosen precedent. Fully reversible (nothing
   stored is re-parseable source text, §5.11 stores the AST).
2. **Range placement is checked by a single post-parse tree walk, not threaded through the
   precedence chain as a boolean parameter.** Simpler, and correctly (if by consequence rather than
   intent) treats a redundant paren as transparent — `SUM((A1:B4))` is accepted, since parens add no
   AST node (§5.3 has no `ParenNode`) and so are structurally indistinguishable, post-parse, from
   `SUM(A1:B4)`. Judged the right, simpler reading of "only as an argument to an aggregate
   function" — nothing in §5.3 suggests a redundant paren should specifically defeat that.
3. **`ParseError.start` is best-effort — `0` for `validateRangePlacement`'s post-parse detections**,
   since the AST carries no source positions at all (a deliberate `ast.ts` design choice, not
   something this file could recover). Documented on the type itself.
4. **A misplaced range's rejection is "direct argument of an aggregate call, or reject" — checked
   structurally by walking each `RangeNode`'s actual parent in the finished tree**, not by tracking
   source-level nesting depth. Verified correct for the genuinely tricky case: `SUM(A1:B4 + 1)` is
   rejected (the range's parent is `+`, not `SUM`) while `SUM(A1:B4) + 1` is accepted (the range's
   parent IS `SUM`; the `+1` only touches the call's result). Both cases are tests, and one was
   mutation-checked (see below).
5. **This file trusts a caller-supplied `tableObjectId` names a real table** — it does not
   re-verify that against `objects`. Consistent with this project's established layered-validation
   posture (D-017's precedent: parse-time correctness is necessary, not sufficient; `mutation.ts`'s
   `validateIntegrity` is the actual backstop when a formula is later written into a slot).
6. **Function name/arity validation is explicitly NOT this file's job**, except the one narrow,
   brief-mandated exception needed for range placement (which names may take a range argument).
   `FOO(1,2,3)` for an unrecognised `"FOO"` parses successfully — `functions.ts`, a later cycle,
   rejects it. Documented as a disclosed, minimal duplication (the aggregate-name set) expected to
   fold into `functions.ts`'s registry once it exists.

## Verification (real output)
```
$ npm run typecheck
> tsc --noEmit && tsc --noEmit -p tsconfig.engine.json
(clean, no output)

$ npm test -- --run
 Test Files  11 passed (11)
      Tests  317 passed (317)
```
317 total, up from 271 (+46, all new; none changed or removed). 0 skipped, 0 `.only`, 0 `it.todo`.

## D-016-style mutation checks (not required for an acceptance-criterion claim this cycle — see
Acceptance criteria status below — done anyway, on the three places I judged least obviously
correct on inspection alone)
1. **`NOT(` vs prefix-`NOT` lookahead disabled** (`peekAt(state,1).type !== "lparen"` removed from
   `parseUnaryExpr`'s NOT branch): `npm test -- --run` → `parses NOT(a.v) as a FunctionCallNode...`
   FAILS (316/317), every other test unaffected. Reverted; `grep -rn "MUTATION-TEST" src/engine/`
   clean before and after.
2. **`validateRangePlacement`'s placement check disabled** (`if (!isDirectAggregateArgument)`
   forced to `if (false)`): 3 named tests FAIL (314/317) — the non-aggregate-argument rejection, the
   bare-range rejection, and the one-level-nested rejection (`SUM(A1:B4 + 1)`). Reverted; grep clean.
3. **The bare-cell-ref branch disabled** (`parseReferenceAddress`'s `tableObjectId`/
   `isCellReferenceForm` check forced to never match): 8 named tests FAIL (309/317) — the direct
   bare-cell-ref test plus every range test (ranges are built from two bare cell refs in every test
   fixture, so this mutation's blast radius correctly includes all of them). Reverted; grep clean.

## Acceptance criteria status
Phase 1's criterion is NOT claimed. This cycle demonstrates, in isolation, several of its named
clauses — "literals, operator precedence, nested IF, ... reference resolution, ranges in
aggregates" and "malformed input yields #PARSE rather than throwing" — but NOT eager/total
dependency extraction or lazy/short-circuit evaluation (needs `deps.ts`/`eval.ts`, still unbuilt).

## Where I got stuck / what is unfinished
Nothing incomplete, but two design points cost real deliberation and are worth flagging explicitly
rather than presenting as obviously-only-one-right-answer:
- Whether range-placement validation should be inline (threaded through the precedence chain,
  tracking exact source position and correctly distinguishing a parenthesized range) or a
  post-parse walk (simpler, loses position info, treats parens as transparent). I chose the
  post-parse walk — see Decisions 2–4 — and I think it's the right trade for this grammar, but it
  is a real design choice, not a mechanical translation of the brief.
- Whether `AND`/`OR`/`NOT` should be lexer-level keyword tokens at all (settled last cycle in
  `lexer.ts`) shaped how THIS file has to dispatch them — the `isFunctionNameToken` + one-token
  lookahead pattern is the direct consequence of that earlier choice, not a new one, but it's worth
  naming as the point where the two cycles' decisions actually meet.

## Open questions raised
None. Q-004 is inherited unchanged (still OPEN, still deferred to Phase 2, still uppercase-only) —
see `address.ts`'s `isCellReferenceForm` doc comment, which says so explicitly rather than silently
reusing the pattern without comment.

## Review point
Fired: **§6.3's batch cap, on the line dimension** — 1768 lines / 5 files since 0029-REVIEW-phase1,
against an 800/10 cap. No single §6.1 trigger fired on its own merits (no brief deviation found, no
hard rule worked around, no test expectation changed, no new dependency), but 0029-REVIEW's own
carried note already predicted this cycle would be dense enough to warrant review "even without a
formal §6.1 trigger" — it was, and the cap makes it mandatory rather than a judgment call.

**REVIEW: REQUIRED** — batch cap exceeded (1768/800 lines). Also recommended independently: this
cycle carries real, disclosed design judgment (range-placement semantics, `^` associativity,
`isFunctionNameToken` dispatch) that a reviewer should confirm rather than have stand unexamined.

## Questions for reviewer
1. Is the post-parse `validateRangePlacement` tree walk (Decision 2) the right trade against
   inline/threaded tracking, given it accepts `SUM((A1:B4))` as a disclosed consequence of parens
   adding no AST node? I judged this the simpler, still-correct reading of §5.3's placement rule.
2. Is left-associative `^` (Decision 1) the right call given the brief's silence and Excel's own
   convention, or should this have been raised as a fresh `OPEN_QUESTIONS.md` entry instead of
   settled as an implementation decision?
3. Does exporting `isCellReferenceForm` from `address.ts` (a load-bearing file, Rule 3) for
   `parser.ts` to consume count as the kind of touch that should have been flagged more loudly than
   one bullet in "What I did" — it's a 9-line additive wrapper around an existing private regex, no
   behavior change to any existing export, but it IS new surface area on a reviewed file.
