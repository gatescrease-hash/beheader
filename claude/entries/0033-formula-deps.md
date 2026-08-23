# 0033 — formula deps

Date: 2026-08-23   Phase: 1   Model: implementer (Claude Sonnet 5)
Previous entry: 0032-REVIEW-phase1 (reviewer, verdict: ACCEPT WITH EDITS — `deps.ts` UNBLOCKED)
Batch: cycle 1 of up to 3 since last review; **393 lines / 2 files changed (`src/` only)** — well
under the §6.3 cap (800/10).

## Declared scope

Build `formula/deps.ts` (`extractDependencies`): §5.3/§9's eager, total dependency extraction over
a `FormulaAst`, per STATUS.md's own "Next slice" section — the file PROJECT_BRIEF §6 names next in
Phase 1's build order, after `ast.ts`/`lexer.ts`/`parser.ts`.

## Explicitly not in scope

`functions.ts`, `formula/eval.ts` — not built. No wiring into `mutation.ts`'s `deriveEdges` or
`graph/eval.ts` — both are explicitly Phase 2 work (STATUS.md's own carried note: `deriveEdges`
still derives an edge only from the narrower `ReferenceNode` shape, and `findUnsupportedFormulaAsts`
is deleted only when Phase 2 wires in the real evaluator). No expansion of a `RangeNode` into
concrete per-cell dependencies — §5.3 states that happens "at edge-derivation time," a different
file and a later moment; see Decisions below.

## What I did

- **`src/engine/formula/deps.ts`** (new, 163 lines) — one exported function,
  `extractDependencies(ast): readonly Dependency[]`, walking the entire `FormulaAst` unconditionally
  and returning every address it could read. `Dependency` is a two-member union:
  `ReferenceDependency` (`{ kind: "reference", address }`) and `RangeDependency`
  (`{ kind: "range", start, end }`) — see Decision 1. `IF`/`AND`/`OR`/`NOT` need no special-casing
  in either syntactic form (D-029): the walk recurses into every `FunctionCallNode`'s `args` and
  every `BinaryOpNode`/`UnaryOpNode`'s operands unconditionally, so both `IF` branches and both
  `AND`/`OR` forms fall out for free. `ErrorNode` (D-028) and `LiteralNode` both yield nothing.
  Never throws; compile-time-exhaustive `switch` with a defensive (non-throwing) default arm,
  mirroring `parser.ts`'s `walkForRangePlacement`.
- **`src/engine/formula/deps.test.ts`** (new, 230 lines, 20 tests) — literals/references/ErrorNode
  yield-nothing-or-one-entry tests; range tests (endpoint pair, not expanded, including nested
  inside `SUM`); operator tests (binaryOp walks both sides, unaryOp walks the operand, a deep nested
  tree, non-deduplication of a repeated reference); function-call tests (zero-arg, ordinary
  multi-arg, and the two central `IF` totality tests — both the taken-looking and untaken-looking
  branch contribute, and the condition argument itself is walked too); D-029's dual-form tests (`AND`,
  `OR`, `NOT`, each pairing the infix/prefix form against the call form and asserting identical
  output, plus one N-ary call test); three integration tests building the AST via the real
  `parseFormula` (a nested `IF`, `AND`'s two forms, and a `SUM` over a real parsed table range) to
  prove this file agrees with `parser.ts` at the boundary they actually share.

## Decisions I made

1. **A `RangeNode` is reported as its own `RangeDependency` shape (the endpoint pair), never
   flattened into per-cell `ReferenceDependency` entries.** §5.3 says a range is stored as an
   endpoint pair and "expand[s] to concrete slot dependencies at edge-derivation time (step 3 of the
   mutation loop)" — a different file (`mutation.ts`) and a later moment, needing the target table's
   CURRENT dimensions, which this file is never handed (`extractDependencies` takes only an `ast`,
   matching §5.3's "write it once, use it identically for cell formulas, text formulas, and
   bindings," none of which is a table object). Collapsing a range into just its two endpoints would
   silently lose every cell between them — the same D-017 failure class (an edge silently missing)
   reached from a new angle — so a distinct, disclosed shape was the only correct option here; I did
   not invent a third one (e.g. a magic sentinel inside `ReferenceDependency`). Nothing consumes this
   shape yet (`deriveEdges` doesn't call this file this cycle — see Explicitly not in scope), so this
   is a forward-looking, reversible design choice for whichever cycle wires the two files together,
   not a mechanical translation of the brief's one sentence on it. Verified structurally correct by
   test (a range nested inside `SUM` still reports the endpoint pair, not per-cell entries) and by
   mutation check (below).
2. **Dependencies are NOT deduplicated** (`a.v + a.v` yields two entries, not one). Matches the only
   existing precedent in this codebase: `mutation.ts`'s `deriveEdges` pushes one `Edge` per resolved
   address from `derivedSlotDependencyAddresses` with no dedup step, and a duplicate edge is harmless
   to every graph algorithm that consumes `Edge[]` (`detectCycle`, `evaluate` both build their own
   adjacency). Deduplicating here would be extra work for a property nothing downstream currently
   needs (Rule 5).
3. **`IF`/`AND`/`OR`/`NOT` get zero special-casing by name, in either syntactic form.** This isn't
   really a "decision" so much as the natural consequence of walking `FunctionCallNode.args`
   unconditionally — but it's worth stating plainly since D-029 explicitly requires `deps.ts` to
   treat both forms identically, and the simplest correct implementation (walk every arg, every
   operand, always) achieves that by construction rather than needing a rule enumerating which
   function names are "special." Verified by the D-029 dual-form test group and by mutation check.

## Verification (real output)

```
$ npm run typecheck
> tsc --noEmit && tsc --noEmit -p tsconfig.engine.json
(clean, no output)

$ npm test -- --run
 Test Files  12 passed (12)
      Tests  341 passed (341)
```
341 total, up from 321 (+20, all new; none changed or removed). 0 skipped, 0 `.only`, 0 `it.todo`
(confirmed by `grep -rn "\.only(\|\.skip(\|it\.todo(" src/` — no matches).

## D-016-style mutation checks (not required for an acceptance-criterion claim this cycle — see
Acceptance criteria status below — done anyway, on the two lines judged least obviously correct on
inspection alone)

1. **The `functionCall` arg loop restricted to only the first argument** (`for (const arg of
   node.args)` replaced with walking only `node.args[0]`): `npm test -- --run` → **8 named tests
   fail** (333/341) — every ordinary multi-arg call test, both `IF`-totality tests, all three D-029
   dual-form tests (`AND`/`OR`/N-ary), and both affected integration tests. Every other test
   unaffected. Reverted; `grep -rn "MUTATION-TEST" src/engine/` clean before and after.
2. **The `range` case collapsed into two `ReferenceDependency` entries** (its endpoints) instead of
   one `RangeDependency`: `npm test -- --run` → **3 named tests fail** (338/341) — the direct
   `RangeDependency`-shape test, the range-nested-in-`SUM` test, and the real-`parseFormula`
   range integration test. Everything else unaffected. Reverted; grep clean.

## Acceptance criteria status

Phase 1's criterion is NOT claimed. This cycle demonstrates, in isolation, the "dependency
extraction is total across both `IF` branches" clause and D-029's dual-form rider — NOT lazy/
short-circuit evaluation (needs `eval.ts`, still unbuilt) and NOT the full built-in registry (needs
`functions.ts`, still unbuilt).

## Where I got stuck / what is unfinished

Nothing incomplete. The one real design call — Decision 1, the `RangeDependency` shape — cost genuine
thought (the brief states WHERE range expansion happens but not what a pre-expansion dependency
report should look like), but it's confined to this file and consumed by nothing yet, so I judged it
implementer-level rather than escalation-worthy. Flagging it here rather than presenting it as the
only possible reading.

## Open questions raised

None. Nothing here touches Q-004 or any other open question.

## Review point

No §6.1 trigger fired: `deps.ts` is an ordinary file inside the already-reviewed `formula/`
subsystem (not a new subsystem's first file), no brief deviation needed escalating, no hard rule was
worked around, no test expectation changed, no new dependency/build step/config. Batch total since
0032-REVIEW-phase1: **393 lines / 2 files**, cycle 1 of up to 3 — nowhere near the 800/10 cap.

**REVIEW: NOT NEEDED** this cycle.

One note for whoever picks up the next cycle (`functions.ts`): it is very likely denser than the
~400 lines of remaining headroom under the cap, and it carries D-029's own subtle, binding
correctness rule (`IF`/`AND`/`OR` must be registered for arity-checking only, never given an
eager-evaluation implementation in the registry, while `NOT` gets an ordinary one) — worth treating
as its own cycle with room to think, and worth ending the batch immediately after it (per STATUS's
own "stop if under ~200 lines are left" guidance) rather than reflexively continuing to `eval.ts`
in the same batch.

## Questions for reviewer

None outstanding.
