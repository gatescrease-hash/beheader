# STATUS — as of entry 0030-formula-lexer

STATE: GREEN. Compiles under both configs, 271/271 tests pass, 0 skipped, 0 `.only`, no test pins
known-broken behaviour.

Current phase: **1 — Formula engine (`formula/*`), standalone.** Phase 0 is COMPLETE and SIGNED OFF
(0027-REVIEW-phase0). Last review point: **0029-REVIEW-phase1, verdict ACCEPT WITH EDITS** — it
unblocked `lexer.ts`, added `ErrorNode` to `FormulaAst` (D-028), and ruled D-029 (Q-009).
Cycles since last review: 1/3 · diff since last review: 707 lines / 2 files (`src/` only, cap
800/10) — this cycle (0030) added `formula/lexer.ts` + its test, nothing else in `src/`.

## Next slice — `parser.ts`
`lexer.ts` is done; 0029-REVIEW's constraint 1 said explicitly not to batch `parser.ts` behind it,
and this cycle didn't. `parser.ts` is next, and per that same constraint it is where D-029, Q-004,
and §5.3's range-placement rule ("only as an argument to an aggregate function") all land at once —
expect it to be a denser cycle than this one, possibly its own review point even without a formal
§6.1 trigger, given how much lands there simultaneously. After it: `deps.ts` (`extractDependencies`,
eager/total per §5.3/§9), `functions.ts`, `formula/eval.ts` — each standalone, heavily unit-tested,
per PROJECT_BRIEF §6's Phase 1 build order. Phase 1's acceptance criterion needs ALL of these; none
is claimed yet, including by this cycle.

## Built
- Scaffold, `address.ts` (44 tests), `graph/node.ts` (27 tests), `graph/edge.ts` (6 tests),
  `primitives/schema.ts` (21 tests), `graph/cycles.ts` (11 tests), `graph/eval.ts` (12 tests),
  `mutation.ts` (74 tests), `document.ts` (26 tests) — all reviewed and unchanged in substance since
  0029-REVIEW. See entries 0025–0029 for detail; not repeated here (STATUS stays short).
- **`formula/ast.ts`** (14 tests) — the full §5.3 grammar, seven `FormulaAst` variants including
  D-028's `ErrorNode`. Unchanged this cycle.
- **`formula/lexer.ts`** (NEW this cycle, 36 tests) — `lex(source): readonly Token[] | LexError`.
  Turns formula source text into a flat token stream or a single `#PARSE` failure; never throws.
  Four token shapes (`NumberToken`/`StringToken`/`BooleanToken`/`WordOrSymbolToken`), discriminated
  on `type`. Has zero grammar knowledge — no operator precedence, no function-arity checks, no
  address resolution. See its own file header for the full design and every reversible policy call
  (unsigned numbers, exact-uppercase keywords, the one `\"` string escape, `IF` as a plain
  identifier, a numeric path segment lexing as `number` not `identifier`).

## Acceptance criterion — Phase 0, all four PASSING and REVIEWED (unchanged, see 0027-REVIEW)
Phase 1's criterion is NOT YET claimed. `lexer.ts` alone demonstrates one clause in isolation
("malformed input yields #PARSE rather than throwing," for the lexer stage) — the rest needs
`parser.ts`/`deps.ts`/`eval.ts`/`functions.ts`, none built yet.

## Known problems
- **`findUnsupportedFormulaAsts` (mutation.ts) and `evaluateFormula`'s `#PARSE` branch
  (graph/eval.ts) are BOTH temporary** (carried, unchanged) — delete both, and `deriveEdges`'s
  matching narrowing, the moment Phase 2 wires in the real `formula/eval.ts`. Not touched this
  cycle; `lexer.ts` has no interaction with either.
- **`camera` has no WRITE-side guard** (D-027, carried) — Phase 3 must guard camera state where
  computed.
- **The journal's STRUCTURE is deliberately unvalidated** beyond `Array.isArray` (carried).
- **L-16** — nothing enforces `nonDerivedSlotPaths`/`derivedSlots` disjointness on one type
  (carried, cheapest open cleanup).
- **L-17/L-18/L-14, §5.11's `style` field, `nextObjectId` reconciliation, `noUnusedLocals` off,
  L-6–L-15 cosmetics, recursion depth, table/`cells` hardcoding — all carried unchanged. Not
  repeated here; see 0027-REVIEW's STATUS if detail is needed.**
- **A string literal cannot end in a literal backslash immediately before its closing quote**
  (`lexer.ts`, this cycle) — the one specified `\"` escape always claims that backslash. Narrow,
  disclosed in the file header, not worth a Q-NNN.
- **A purely-numeric path segment (`vertex.0.x`'s `0`) lexes as a `number` token, not an
  `identifier`** (`lexer.ts`, this cycle) — `parser.ts` must accept a `number` token's `text` as a
  path segment when reassembling a dotted reference. Disclosed in the lexer's own file header;
  binding on `parser.ts`, not yet acted on anywhere.
- **SETTLED, do not re-raise:** everything 0029-REVIEW's STATUS already listed settled (Q-005,
  Q-009/D-029, D-028, `IF` as `FunctionCallNode`, one `LiteralNode`), PLUS: whether `lexer.ts` needs
  its own keyword vocabulary for `AND`/`OR`/`NOT`/`TRUE`/`FALSE` (it does, case-sensitive exact
  uppercase) and whether `IF` gets one too (it does not — plain identifier, same as `SUM`).

## Live PROVISIONAL tags and open questions
**`PROVISIONAL(Q-007)`** → `document.ts`'s `CameraState`. **`PROVISIONAL(Q-008)`** →
`graph/node.ts`'s `isIllegalNumber`. **Q-009** ANSWERED → D-029. **Q-005** ANSWERED. **Q-006**
ANSWERED → D-025. **Q-001/Q-002** (Phase 3), **Q-004** (Phase 2) deferred. **Q-003** → D-007.
No new question raised this cycle. Next free: **Q-010**.

## Gotchas for the next model
- **`formula/lexer.ts` has NO grammar knowledge.** It does not know operator precedence, does not
  know which function names exist, does not resolve any identifier to an `Address`, and does not
  check a numeric token's `value` against D-025/D-027's `isIllegalNumber` (that's `mutate`'s job,
  and stays so — nothing this file produces is document state until a later mutation writes it in).
  `parser.ts` owns all of that.
- **`-2` lexes as `minus` then `number(2)` — never a signed number token.** Matches `ast.ts`'s
  `UnaryOpNode` reading of unary minus. Do not "fix" this by making numbers signed; it would make
  `3-2` ambiguous between subtraction and adjacent literals.
- **Keywords (`AND`/`OR`/`NOT`/`TRUE`/`FALSE`) are exact-uppercase, case-sensitive.** `IF` is
  deliberately NOT a keyword — it lexes as a plain `identifier`, same as `SUM`/`ROUND`/any other
  built-in name, because §5.3 never puts `IF` in the operator precedence chain (only `AND`/`OR`/
  `NOT` are there). `parser.ts` still needs to accept `IF(...)` as a call — that's ordinary
  identifier-then-`(` handling, not a keyword-token concern.
- **A purely-numeric path segment lexes as `number`, not `identifier`.** `vertex.0.x` arrives at
  the parser as `identifier(vertex) dot number(0) dot identifier(x)`. `parser.ts` must accept a
  `number` token's `text` as a path segment when reassembling a dotted reference — do not treat
  seeing a `number` token where a path segment is expected as automatically a `#PARSE`.
  `A1`-shaped cell refs are unaffected (they start with a letter, so they always lex as
  `identifier`) — this only bites purely-numeric segments.
- **`Token`'s four shapes are discriminated on `type`**, same principle as `FormulaAst`/`Slot`
  (D-014 extended to a new union) — narrow with `token.type === "number"` etc., never a structural
  check or an `as` cast.
- **D-029 (was Q-009), still binding, not yet touched by any file**: `IF`/`AND`/`OR` MUST be
  evaluated lazily by `formula/eval.ts` itself, never by a `functions.ts` registry entry computing
  from pre-evaluated arguments — in BOTH their operator and call syntactic forms. `NOT` is an
  ordinary registry entry. `deps.ts` stays eager and total over both forms. This binds `parser.ts`,
  `functions.ts`, and `eval.ts`, none of which exist yet — cite it in each of their headers when
  they land, per 0029-REVIEW's constraint 2.
- **`ErrorNode` still exists but nothing constructs one yet, deliberately (D-028)** — unchanged,
  not touched this cycle.
- Each PowerShell call is a fresh process; the Bash tool's `npm` is not on PATH — use PowerShell.
