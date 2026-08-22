# 0010 — REVIEW (phase 0, mid-phase)
Date: 2026-08-21   Phase: 0   Model: reviewer (Claude Opus 5)
Previous entry: 0009-graph-cycles   Reviewing: cycle 0009
Prior review: 0008-REVIEW-phase0 (verdict: ACCEPT WITH EDITS)

Scope: `graph/cycles.ts` + tests (new), plus the additive `addressKey` in `graph/edge.ts`.

## Rule audit
Rule 1 — UPHELD, engine tsconfig passes; only two imports, both `engine/*`. Rule 2 — checked, not
assumed: no top-level state, nothing written outside function-local scratch. Rule 5 — UPHELD, and
this is the rule the module is most exposed on (Rule 5 names cycle detection specifically as
"from-scratch DFS, no incremental bookkeeping") — held exactly. Rules 3/4/6/7 — not touched /
upheld.

## Invariant audit
No `#CYCLE` value (grepped — only prose forbidding it). The `Map`s here are function-local
traversal scratch, not stored graph state — same flinch-and-answer as 0008-REVIEW's schema
registry. `gray ⟺ on the stack` verified rather than assumed (the `findIndex`/`slice` pairing is
safe because push/pop are adjacent and unconditional). Deterministic output — not required, but
load-bearing for `mutation.ts`'s rejection messages being reproducible.

## Spec conformance
Three interpretive calls checked and confirmed right: traversal direction (over-determined by
`Edge`'s field names and topological-order needs), self-edge not special-cased (§5.3 requires
this explicitly, and there's a test named for it), reporting one cycle not all (§5.1 asks for
one). The scope split away from `eval.ts` is correct and well-argued — second consecutive cycle
to leave the obvious next module alone.

## Legibility
Strong; the "NOT DONE HERE" section draws the `cycles.ts`/`eval.ts` line precisely. **L-10** —
`addressKey`'s collision-safety rests on an unenforced premise (`objectId` is `obj_<n>` by
convention, not by type) — same shape as D-010, one layer up; note for `document.ts`. **L-11/
L-12** — a long test line, an unexplained-but-correct cast; cosmetic.

## Honesty audit
Clean, and measurably more precise than last cycle — line counts now match `git show --numstat`
exactly, a discrepancy the previous review flagged. The cycle-detection/cycle-rejection
distinction is drawn correctly, not rounded up.

## The finding that mattered
`detectCycle`'s one non-obvious line — `stack.slice(cycleStart)` — is what makes the returned
array *the cycle* rather than the whole path walked to find it. Replaced it with `slice(0)` and
ran the suite: **97/97 still passed.** Every cyclic fixture happened to have its DFS root inside
the cycle, so the two expressions coincided in all five. This matters because the output becomes
the rejection message, and naming an innocent upstream slot sends a user to unlink the wrong
thing. Closed by reviewer edit 1, verified in both directions (98/98 with the fix; 1 new failure
against the mutant). Same lesson as D-008, from a different angle: test the case the fixtures
don't happen to produce.

## Forward hazard — D-015
`mutation.ts` will need to turn `detectCycle`'s bare `Address[]` into a message. `addressKey` is
the path of least resistance and produces `obj_3::cells.A1` — comprehensible enough to pass
review, and wrong the moment a user renames anything. Ruled **D-015**: `addressKey` never
reaches the user; every user-facing slot mention goes through `formatAddress`.

## Reviewer edits (2, small)
1. Added 1 test to `cycles.test.ts` pinning that the reported cycle names ONLY the cycle's own
   members, not the upstream tail that led to it. Verified by mutation both ways.
2. Corrected an overstated header claim ("visits every node in at least one edge" — false the
   moment a cycle is found and the traversal returns early). Now states the true, narrower claim.

Post-edit: 98/98, both configs clean.

---

## Verdict: ACCEPT WITH EDITS

Declared slice delivered exactly; the two constraints most at risk (the self-edge rule, Rule 5's
from-scratch requirement) both honoured with reasons attached. The one finding is a test gap, not
a code defect — the implementation was correct throughout, confirmed by mutation rather than by
reading. **`graph/eval.ts` may begin.**

### Constraints carried forward
1. D-013 binding on `eval.ts` (unchanged, now the immediate next thing).
2. Derived slots evaluate INSIDE the topological pass — still the single most important thing.
3. Call `derivedSlotDependencyAddresses` at edge-derivation time only.
4. `eval.ts`'s sort walks `sourceSlot -> dependentSlot`, same direction as `detectCycle`; use
   `addressKey` for `Map`/`Set` keys, don't reimplement it.
5. `eval.ts` may assume its `Edge[]` is already acyclic — `mutation.ts` runs `detectCycle` first.
   Do not add a defensive check inside `eval.ts`.
6. D-015 (new) — `addressKey` never reaches a user-facing string; use `formatAddress`.
7. D-014 — import `isErrorValue`, no local copies.
8. L-9 — the Phase 0 acceptance fixture MUST use formula input slots.
9. Cycle rejection must name every slot AND prior state must be provably unchanged (§6) — both
   need a dedicated test.
