# STATUS — as of entry 0029-REVIEW-phase1

STATE: GREEN. Compiles under both configs, 235/235 tests pass, 0 skipped, 0 `.only`, no test pins
known-broken behaviour. **Cycle 0028 is REVIEWED — 0029-REVIEW-phase1, ACCEPT WITH EDITS.
`lexer.ts` is UNBLOCKED.**

Current phase: **1 — Formula engine (`formula/*`), standalone.** Phase 0 is COMPLETE and SIGNED OFF
(0027-REVIEW-phase0). Last review point: **0029-REVIEW-phase1, verdict ACCEPT WITH EDITS** — it
added `ErrorNode` to `FormulaAst` (**D-028**) and answered **Q-009** (**D-029**).
Cycles since last review: 0/3 · diff since last review: 0 lines / 0 files (cap 800/10). For the
record, cycle 0028's own diff was **722 lines / 7 files**, not the 557/6 its entry stated — see
0029-REVIEW §5; anything touching `mutation.ts`/`graph/eval.ts` next starts near the cap.

## Next slice — `lexer.ts` (unblocked)
0027-REVIEW's carried constraint 1 is discharged; 0029-REVIEW's constraint 1 replaces it: build
`formula/lexer.ts` (tokenizer) alone and do NOT batch `parser.ts` behind it — `parser.ts` is where
D-029, Q-004, and §5.3's range-placement rule all land at once. After it: `parser.ts`, `deps.ts`
(`extractDependencies`, eager/total per §5.3/§9), `functions.ts`, and `formula/eval.ts` — each
standalone, heavily unit-tested, per PROJECT_BRIEF §6's Phase 1 build order. Phase 1's acceptance
criterion needs ALL of these; none is claimed yet.

## Built
- Scaffold, `address.ts` (44 tests), `graph/node.ts` (27 tests, `Value`/`isIllegalNumber`/
  `hasIllegalNumber`/slot kinds), `graph/edge.ts` (6 tests), `primitives/schema.ts` (21 tests,
  `value`/`add` schema entries), `graph/cycles.ts` (11 tests), `mutation.ts` (§5.1's full loop, 74
  tests), `document.ts` (§5.11, 26 tests) — all reviewed and unchanged in substance since
  0027-REVIEW, except as noted below. See 0025/0026/0027's entries for their own detail; not
  repeated here (STATUS stays short — full history is `claude/entries/`).
- **`graph/eval.ts`** (§5.1 step 7, 12 tests) — `evaluate(objects, edges)`. THIS cycle:
  `evaluateSlot`'s `"formula"` case now calls `evaluateFormula`, which narrows to `ReferenceNode`
  (unchanged `evaluateReference`) or returns `#PARSE` for any other AST shape — a defensive,
  provably-unreachable-for-any-accepted-document fallback (see mutation.ts below).
- **`mutation.ts`** — THIS cycle: `deriveEdges`'s source-1 loop narrows to `ReferenceNode`
  (compiler-enforced, not just tested — see Gotchas). `validateIntegrity` gained a FIFTH,
  deliberately TEMPORARY check, `findUnsupportedFormulaAsts` (run as check 2, right after D-017,
  same family) — rejects a `formula`-kind slot whose AST is not yet a shape this build's evaluator
  understands. Deleted whole-cloth once Phase 2 wires in the real formula engine.
- **`formula/ast.ts`** (real content, 14 tests, cycle 0028 + 0029-REVIEW's edits) — `FormulaAst`
  widened from Phase
  0's one-variant stand-in to the FULL §5.3 grammar: `LiteralNode`, `ReferenceNode` (byte-for-byte
  unchanged), `RangeNode` (endpoint pair, never pre-expanded), `BinaryOpNode` (one node, one
  `operator` field spanning the WHOLE precedence chain), `UnaryOpNode` (`-`/`NOT`),
  `FunctionCallNode` (`IF` is an ordinary call, not a dedicated node), and — added by
  0029-REVIEW — **`ErrorNode`** (`{ type: "error"; error: "#REF" }`, **D-028**), the node §5.1.1's
  repair path and §5.4's reference-adjustment pass write in place of ONE invalidated reference.
  `isReferenceNode` is the ONE sanctioned narrowing predicate (D-014). **Q-005 is ANSWERED**
  (0006-REVIEW's own ruling, executed now).

## Acceptance criterion — Phase 0, all four PASSING and REVIEWED (unchanged, see 0027-REVIEW)
Phase 1's criterion is NOT YET claimed — see Next slice. `ast.ts` alone cannot satisfy any of it
(needs a lexer/parser/evaluator/function registry, none built yet).

## Known problems
- **`findUnsupportedFormulaAsts` (mutation.ts) and `evaluateFormula`'s `#PARSE` branch
  (graph/eval.ts) are BOTH temporary.** Both exist only because `FormulaAst` is now wider than
  this build's evaluator. Delete both — and `deriveEdges`'s matching narrowing — the moment Phase
  2 wires in the real `formula/eval.ts` and every `FormulaAst` shape is genuinely supported. Do not
  let them survive past that point as dead defensive code with a stale reason.
- **Q-009 is no longer open — ANSWERED → D-029** (0029-REVIEW). Binding on
  `parser.ts`/`functions.ts`/`eval.ts`, which must cite it in their headers and test it with the
  code, not after. See Gotchas for the half that bites.
- **`camera` has no WRITE-side guard** (D-027, carried, unchanged) — Phase 3 must guard camera
  state where it is computed.
- **The journal's STRUCTURE is deliberately unvalidated** beyond `Array.isArray` (carried,
  unchanged) — distinct from journal VALUE legality, which is enforced.
- **L-16** — nothing enforces `nonDerivedSlotPaths`/`derivedSlots` disjointness on one type
  (carried, cheapest open cleanup).
- **L-17/L-18/L-14, §5.11's `style` field, `nextObjectId` reconciliation, `noUnusedLocals` off,
  L-6–L-15 cosmetics, recursion depth, table/`cells` hardcoding — all carried unchanged from
  0027-REVIEW's STATUS. Not repeated here; see that entry if detail is needed.**
- **Five places can reject a mutation now** — four `mutate`/`validateIntegrity` checks that
  existed at 0027-REVIEW, plus THIS cycle's `findUnsupportedFormulaAsts`. Still correct (each is
  about a different thing), still enumerated in the file header. TEMPORARY, unlike the other four
  — see above.
- **SETTLED, do not re-raise:** everything 0027-REVIEW's STATUS already listed settled, PLUS: Q-005
  (formula AST widening — ANSWERED); whether widening `FormulaAst` needed matching changes to
  `mutation.ts`/`graph/eval.ts` (it did — the compiler enforces `deriveEdges`'s narrowing; see
  Gotchas); whether `IF` needs its own AST node (it does not — an ordinary `FunctionCallNode`);
  whether `LiteralNode` should be three node types instead of one (it should not — §5.3 groups
  number/string/boolean as one grammar category).

## Live PROVISIONAL tags and open questions
**`PROVISIONAL(Q-007)`** → `document.ts`'s `CameraState`. **`PROVISIONAL(Q-008)`** →
`graph/node.ts`'s `isIllegalNumber`. **Q-009** ANSWERED → D-029 (0029-REVIEW); no tag was ever
taken. **Q-005** ANSWERED at cycle 0028 — all its tags removed.
**Q-006** ANSWERED → D-025. **Q-001/Q-002** (Phase 3), **Q-004** (Phase 2) deferred. **Q-003** →
D-007. Next free: **Q-010**.

## Gotchas for the next model
- **`FormulaAst` is a SEVEN-variant union now, not one.** Any code reading `.address` off a
  `FormulaSlot.ast` MUST first narrow via `isReferenceNode` (`formula/ast.ts`) — the compiler
  enforces this (verified: removing the narrowing in `deriveEdges` is a `tsc` error, not just a
  failing test — a STRONGER guarantee than mutation-testing can show). Do not add a second
  narrowing pattern; reuse `isReferenceNode`.
- **Two places in this codebase currently reject EVERY `FormulaAst` shape except `ReferenceNode`,
  and both are TEMPORARY**: `mutation.ts`'s `findUnsupportedFormulaAsts` (write side — a document
  is never accepted with an unsupported shape) and `graph/eval.ts`'s `evaluateFormula` (a
  defensive `#PARSE` fallback, provably unreachable for anything `mutate` accepted, but written
  anyway since `eval.ts` cannot see `mutate`'s check run from where it sits). When Phase 2 wires in
  the real formula engine, DELETE both rather than widen them — they exist to be deleted, not
  extended.
- **`ErrorNode` EXISTS but nothing constructs one yet, deliberately (D-028).** It is written only
  by §5.1.1's repair path and §5.4's reference-adjustment pass, both Phase 2. Repairing at
  FORMULA level instead of NODE level is the trap it exists to prevent: `= A1 + B1` whose `B1`
  column was deleted must keep deriving its edge from `A1`. An `ErrorNode` evaluates to `#REF`,
  never `#PARSE`, and `extractDependencies` yields nothing for it.
- **`RangeNode` now EXISTS in the type system but nothing expands one into edges yet.** A formula
  slot holding a `RangeNode` is rejected the same way any other unsupported shape is, by the same
  temporary check. Range expansion is Phase 2/4.
- **`IF` is `FunctionCallNode { name: "IF", args: [...] }` — there is no `ConditionalNode`.** Do
  not invent one; §5.3 lists `IF` among the built-in FUNCTIONS.
- **`BinaryOpNode`/`UnaryOpNode` do not encode precedence.** One node, one `operator` field, spanning
  the WHOLE §5.3 chain (`OR` through `^`) — precedence is `parser.ts`'s job to resolve INTO this
  flat shape, not something the AST type itself expresses.
- **D-029 (was Q-009)**: `AND`/`OR`/`NOT` get BOTH forms and both mean the same thing — but
  `IF`/`AND`/`OR` are evaluated LAZILY by `formula/eval.ts` at the call site, never by a
  `functions.ts` registry implementation (a table-driven registry gets already-evaluated args, so
  it cannot short-circuit; §5.3 requires short-circuiting). `NOT` is an ordinary registry entry.
  This is the single easiest way to build a formula engine that looks right and is wrong.
- **`mutate` checks the post-fold GRAPH, the operations' PAYLOADS, and (now) whether a formula
  slot's AST shape is one this build can walk at all** — three genuinely different things, in
  `validateIntegrity` plus two pre-staging preconditions. The file header enumerates all of them;
  read it before adding a sixth.
- **`document.ts` trusts `mutate` for graph legality and only shape-validates what `mutate`
  cannot** (unchanged) — a formula slot's `ast` CONTENT is one of the things it trusts, which is
  exactly why a hand-edited file can reach `findUnsupportedFormulaAsts` today even though nothing
  else in this build can construct a non-reference AST.
- **Mutation-testing proves a mechanism is load-bearing, not that it is correct** (carried). This
  cycle's `deriveEdges` narrowing is a case where the COMPILER, not a test, is the proof — worth
  distinguishing: a compile error is a stronger guarantee than a red test.
- **A derived slot's load-time placeholder is provably unobservable; a zero-object document must
  bypass `mutate`; the clone is load-bearing AND faithful; cyclic input to `evaluate` fails
  SILENTLY without step 5; slot keys only from `slotKey()`; document-wide keys only from
  `addressKey()`.** All carried unchanged from 0027-REVIEW's STATUS — not repeated in full here.
- Each PowerShell call is a fresh process; the Bash tool's `npm` is not on PATH — use PowerShell.
