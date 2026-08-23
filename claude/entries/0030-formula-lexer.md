# 0030 — formula lexer
Date: 2026-08-23   Phase: 1   Model: implementer (Claude Sonnet 5)
Previous entry: 0029-REVIEW-phase1   Last review: 0029-REVIEW-phase1 (verdict: ACCEPT WITH EDITS)
Batch: cycle 1 of up to 3 since last review; 707 lines / 2 files changed so far (`src/` only,
matching how 0029-REVIEW itself measured the running total).

## Declared scope
Build `formula/lexer.ts` (§5.3's lexer stage) alone: scan formula source text into a flat `Token`
stream, or a single `#PARSE`-shaped `LexError`, never throwing. Nothing else — 0029-REVIEW's
carried constraint 1 says explicitly not to batch `parser.ts` behind it.

## Explicitly not in scope
`parser.ts`, `deps.ts`, `functions.ts`, `formula/eval.ts` — none built or even sketched. No grammar,
precedence, or AST construction happens in this file; it has no opinion on whether a given token
sequence is a legal formula. Nothing resolves an identifier to an `Address`, and nothing checks a
literal's `value` against D-025/D-027's `isIllegalNumber` (that binds `mutate`, not this file, per
its own NOT DONE HERE section). Q-009/D-029's `IF`/`AND`/`OR` short-circuiting question does not
apply here at all — this file only tokenizes; it doesn't evaluate.

## What I did
- **`src/engine/formula/lexer.ts`** (new) — `lex(source): readonly Token[] | LexError`. Four token
  shapes (`NumberToken`, `StringToken`, `BooleanToken`, `WordOrSymbolToken`), discriminated on
  `type`, unioned as `Token`. Handles: whitespace skipping; unsigned number literals
  (`[0-9]+(\.[0-9]+)?`, no leading dot, no exponent, no sign — a `-` is always its own `minus`
  token, matching `ast.ts`'s `UnaryOpNode` reading of `-2`); double-quoted strings with the one
  specified escape (`\"`); `TRUE`/`FALSE` as `BooleanToken`s and `AND`/`OR`/`NOT` as their own
  keyword token types, both matched case-sensitively in exact uppercase; every other word as a
  plain `identifier` (including `IF`, which the grammar never lists as an operator); every §5.3
  operator/punctuation mark, with two-character lookahead for `<=`/`<>`/`>=`; a trailing `eof`
  token always appended. Full design rationale, including every reversible policy call, is in the
  file's own header — not repeated here.
- **`src/engine/formula/lexer.test.ts`** (new, 36 tests) — whitespace, every number/string/boolean/
  keyword/identifier/operator case named above, malformed-input-never-throws (a battery of bad
  inputs plus two dedicated unterminated-string cases), two realistic composite formulas
  (`IF(table_x.A1 > 50, "big", -3.5)`, `SUM(A1:B4)`), the full precedence chain in one expression,
  and a reconstruction test proving every source character is accounted for (consumed into a
  token's `text`, or whitespace between tokens — never silently dropped or duplicated).

## Decisions I made
1. **Numbers are unsigned; `-` is always a standalone `minus` token.** §5.3 lists `-2` as a literal
   example but also puts unary `-` in the same precedence chain — the grammar itself already
   resolves this as `UnaryOpNode` over a plain literal, not a signed number token. Documented in
   the file header; tested (`lexes '-2' as a standalone minus token...`).
2. **Keywords are case-sensitive, exact uppercase.** Matches every occurrence in §5.3 and D-008's
   precedent (uppercase-only now, lowercase acceptance purely additive later, since no formula
   source text is ever stored — only the AST is, §5.11). `IF` gets no keyword token at all: it is
   exclusively a `FunctionCallNode` per §5.3/`ast.ts`, so it lexes as an ordinary identifier like
   `SUM`. This is a genuinely reversible, non-load-bearing policy call (nothing stored depends on
   it), so I did not raise it as a new `OPEN_QUESTIONS.md` entry — see the file header for the
   fuller reasoning, including why this is unlike Q-004 (which WAS raised, because lowercase cell
   refs risk two stored slots for one cell — a real data-model hazard this has no analogue of).
3. **Only `\"` is a recognised string escape; a backslash before anything else is copied through
   literally, one character at a time.** §5.3 specifies exactly one escape. One disclosed
   consequence: a string cannot end in a literal backslash immediately before its closing quote
   (that backslash always pairs with the quote as the defined escape instead) — narrow, obscure,
   and not worth a question given the brief's silence gives no contrary signal either way.
4. **A purely-numeric path segment (`vertex.0.x`'s `0`) lexes as a `number` token, not an
   `identifier`**, because this lexer's identifier grammar requires a leading letter/underscore
   (matching `address.ts`'s own `NAME_PATTERN`). Flagged explicitly in the file header as something
   `parser.ts` must accept (a `number` token's `text` used as a path segment) — a real, disclosed
   consequence of keeping this lexer context-free, not an oversight.
5. **`Token` is four discriminated shapes, not one shape per punctuation character or one flat
   shape with an optional `value`.** Matches this codebase's existing style (`FormulaAst`, `Slot`)
   and keeps `token.value` properly narrowed by `type` wherever a `number`/`string`/`boolean` token
   is consumed, with no `as` cast needed at the call site.

## Verification (real output)
```
$ npm run typecheck
> tsc --noEmit && tsc --noEmit -p tsconfig.engine.json
(clean, no output)

$ npm test -- --run
 Test Files  10 passed (10)
      Tests  271 passed (271)
```
271 total, up from 235 (+36, all new; none changed or removed). 0 skipped, 0 `.only`, 0 `it.todo`
(`grep -rn "\.only(\|\.skip(\|it\.todo" src/` — no matches).

## D-016-style mutation checks (not required for an acceptance-criterion claim this cycle — see
Acceptance criteria status below — done anyway, matching this project's established practice for a
new load-bearing mechanism)
1. **Two-char `<=`/`<>` lookahead disabled** (`<` always emits `lt`): `npm test -- --run` →
   `disambiguates < / <= / <>` and `tokenizes the full operator precedence chain...` both FAIL
   (269/271), every other test unaffected. Reverted; `grep -rn "MUTATION-TEST" src/engine/` clean
   before and after.
2. **String escape handling disabled** (`\"` no longer resolved; every character copied through
   raw): `npm test -- --run` → `resolves the one specified escape...`, `returns a #PARSE LexError
   for a string left open by a trailing escaped quote`, and `never throws across a battery of
   malformed inputs` all FAIL (268/271). Reverted; grep clean.

## Acceptance criteria status
Phase 1's criterion is NOT claimed. This file alone demonstrates one clause of it in isolation
("malformed input yields #PARSE rather than throwing" — for the lexer stage specifically) but the
rest (operator precedence, nested `IF`, every built-in, reference resolution, ranges, eager/total
dependency extraction vs. lazy/short-circuit evaluation) needs `parser.ts`/`deps.ts`/`eval.ts`/
`functions.ts`, none of which exist yet.

## Where I got stuck / what is unfinished
Nothing. The one place I deliberated longest was whether `AND`/`OR`/`NOT`/`TRUE`/`FALSE` should be
lexer-level keywords at all, versus plain identifiers the parser reinterprets by text — went with
keyword tokens because they sit in §5.3's own operator precedence chain (unlike `IF`/`SUM`/etc.,
which are call-only), and because D-029 already commits `parser.ts` to giving `AND`/`OR`/`NOT`
dedicated grammar productions regardless of how the lexer hands them over.

## Open questions raised
None. No `PROVISIONAL(Q-NNN)` tag taken — every reversible decision this cycle needed no ruling
(see Decisions I made above for why each one stays out of `OPEN_QUESTIONS.md`).

## Review point
Fired: none — `formula/lexer.ts` is ordinary work inside the now-reviewed `formula/` subsystem
(0029-REVIEW signed off `ast.ts`), not a new subsystem's first file, no brief deviation, no hard
rule worked around, no changed test expectation, no new dependency. Batching: cycle 1/3 since last
review, diff 707 lines / 2 files (`src/` only) — well under the 800/10 cap.

**REVIEW: NOT NEEDED** (§6.4) — additive work inside an already-reviewed structure, fully tested,
no §6.1 trigger fired.

## Questions for reviewer
None this cycle.
