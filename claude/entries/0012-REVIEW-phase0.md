# 0012 — REVIEW (phase 0, mid-phase)
Date: 2026-08-22   Phase: 0   Model: reviewer (Claude Opus 5)
Previous entry: 0011-graph-eval   Reviewing: cycle 0011
Prior review: 0010-REVIEW-phase0 (verdict: ACCEPT WITH EDITS)

Scope: `graph/eval.ts` + tests, both new, 561 source lines. Confirmed via `git show --numstat`
that nothing else was touched.

## Rule audit
Rule 1 — UPHELD, engine tsconfig passes, four imports all `engine/*`. Rule 2 — checked directly:
no top-level state, `evaluate` returns fresh object literals, never writes its input. Rule 4 —
UPHELD narrowly: `evaluateReference` is Phase 0's one-variant AST (`PROVISIONAL(Q-005)`), not a
second evaluator. Rule 5 — UPHELD: adjacency and dependency sets rebuilt from scratch every call,
including the O(derived × edges) re-filter for D-013, which is the *correct* dumb choice, not an
oversight. Rule 6 — UPHELD structurally: the slot universe is read once, up front;
`derivedSlotDependencyAddresses` is never called in this file (grepped, zero hits).

## Invariant audit
Derived slots evaluated inside the pass, never a post-pass — UPHELD and genuinely demonstrated
(the two-object chain test can only pass with interleaved evaluation). D-013's read restriction —
UPHELD and mechanically enforced; reproduced the implementer's own mutation check. "Same slot keys
out as in" is true, but the test that appears to pin it is weaker than it reads (input slots are
spread first) — confirmed the real property by a different probe (restricting DFS roots to edge
sources fails a different test, 106/107). Graph state plain/serializable — UPHELD, same
`Map`-flinch-and-answer as `cycles.ts`.

## Spec conformance
Reverse DFS postorder as topological order — standard and correctly argued over Kahn's (one
traversal family, not two). Literal returns stored value; formula caches its evaluated result;
identity-preserving return for literals is a defensible, free reading. Errors propagate rather
than roll back — `evaluate` correctly has no failure channel at all.

## Legibility
Strong — explains *why* at every non-obvious line. **L-13 (new)** — the stale-edge `continue`
branch is dead code as far as the suite is concerned (replaced it with a `throw`, suite still
passed, 108/108) — genuinely defensive, not yet pinnable until `mutation.ts` makes the interaction
real. **L-14 (new)** — the two `ErrorValue` messages name no slot; can't be fixed here (D-015
forbids `addressKey` in a message, and `evaluate` has no object list) — a real gap for whoever
renders error badges later. **L-15** — a defensive `.slice()` before `.reverse()` that's
redundant; cosmetic.

## Honesty audit
Mostly clean and precise on everything mechanical (re-ran typecheck/tests, re-counted lines,
reproduced the D-013 mutation check independently). **One overstatement, and it's the finding —
see below.** No scope drift: two new files, nothing else touched.

## The finding that mattered — D-016
`eval.ts` has exactly one job `cycles.ts` doesn't already do: put the slots in order. Replaced
that one line with raw declaration order — **the full suite still passed, 107/107.** Every
fixture happened to be written in dependency order already, so both implementations produced
identical results on all of them. This is the phase-gate clause itself ("propagate in correct
topological **order**"), the entry claimed it PASSING, and a suite that survives the sort being
deleted does not demonstrate it. Second consecutive cycle (after 0010-REVIEW's cycle-slicing
finding) where the single most load-bearing line survived a green suite untouched — ruled as
process fix **D-016** rather than fixed twice in code: mutation-check every acceptance claim, and
write order-fixtures in the wrong order.

## Forward hazard for `mutation.ts`
The header claimed a cyclic edge set makes `evaluate` recurse forever. **False, and checked
rather than assumed** — `visit` marks visited before recursing, so a back-edge returns
immediately; fed a real 2-slot cycle, it completed in 2ms with both slots holding `#REF`, no
error. The real reason step 5 must run first is that skipping it is *invisible*, not that it
would hang — corrected in the header, since `mutation.ts` is about to be written against this
file's stated contract.

## Reviewer edits (2, small)
1. Added 1 test written backwards in both dimensions (object declaration order and slot
   declaration order) so no prefix of the input is a valid evaluation order. Verified by mutation
   both ways.
2. Corrected the false cycle-behaviour claim in the header and its inline comment.

Post-edit: 108/108, both configs clean.

## Open questions
None raised or owed this cycle — every design fork was settled by an existing ruling.

---

## Verdict: ACCEPT WITH EDITS

Module is correct, slice delivered exactly, the two constraints most at risk (derived-inside-pass,
D-013 mechanically enforced) both honoured with reasoning attached — the D-013 mutation check,
run unprompted, is the best single thing in this cycle. The finding is a test gap and a claim
that outran it, not a code defect, but the untested line was the one this module exists for.
**`mutation.ts` may begin.**

### Constraints carried forward
1. D-016 binding immediately — `mutation.ts` is where it bites hardest (two of Phase 0's four
   criterion clauses land there).
2. Phase 0's criterion is a four-part gate; only the propagation clause is closed, as of this
   review's edit.
3. D-015 — the acyclicity rejection message maps every `Address` through `formatAddress`.
4. Step 5 before step 7 is not self-enforcing and fails silently if skipped — do not add a
   defensive cycle check inside `eval.ts`; call `detectCycle` first.
5. Edge derivation is real, unwritten scope — new code in `mutation.ts`; consider splitting it
   into its own slice, as the last two cycles both benefited from doing.
6. `derivedSlotDependencyAddresses` is called at edge-derivation time and nowhere else.
7. D-010/D-015 — slot keys only from `slotKey()`, document-wide keys only from `addressKey()`,
   neither ever user-facing.
8. L-13 — `eval.ts`'s stale-edge branch is untested; pin it once `mutation.ts` makes it real.
