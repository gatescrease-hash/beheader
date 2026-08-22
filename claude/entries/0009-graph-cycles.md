# 0009 — graph-cycles
Date: 2026-08-21   Phase: 0   Model: implementer (Claude Sonnet 5)
Previous entry: 0008-REVIEW-phase0   Last review: 0008-REVIEW-phase0 (verdict: ACCEPT WITH EDITS)

## Declared scope
Build `src/engine/graph/cycles.ts`: naive DFS cycle detection over an already-derived `Edge[]`
(§5.1 step 5). Add one additive export, `addressKey`, to the already-reviewed `graph/edge.ts`.

## Explicitly not in scope
`graph/eval.ts` — split out as its own slice deliberately (smaller diff, and D-013's enforcement
in `eval.ts` deserves an undiluted review). Turning a detected cycle into a rejection message
(that's `mutation.ts`'s job — it has the object list; `cycles.ts` doesn't take one).

## What I did
- `graph/edge.ts` — additive: `addressKey(address)`, joining `objectId` + `slotKey(path)`.
  4 new tests.
- `graph/cycles.ts` — new. `CycleCheckResult`; `detectCycle(edges)`: adjacency built fresh every
  call (Rule 5), standard white/gray/black DFS, following `sourceSlot -> dependentSlot`. Returns
  the first cycle found, ordered.
- `graph/cycles.test.ts` — new, 10 tests: acyclic cases (chain, diamond, disjoint components,
  duplicate edges), cyclic cases (self-edge — must not be special-cased per §5.3, two/three-slot
  cycles, a cycle among unrelated acyclic edges, a cycle reached past an extra outgoing edge).
  Assertions check the reported cycle genuinely closes, not a specific array literal.

## Decisions I made
- `addressKey` lives in `edge.ts`, not `address.ts` (doesn't need an object list) or `cycles.ts`
  (shared with `eval.ts` next cycle).
- Traversal direction `sourceSlot -> dependentSlot` — not stated explicitly in the brief, but the
  only reading consistent with `Edge`'s own field order and with prerequisites-first ordering.
- Reports only the first cycle found, not every cycle — §5.1's criterion asks for one, and Rule 5
  favours the simplest sufficient answer.
- Recursive DFS, not an explicit stack — more legible at the brief's stated scale.

## Verification
`npm run typecheck` — clean, both configs. `npm test` — 97/97 (83 pre-existing + 4 + 10).

## Acceptance criteria status
Phase 0 — NOT YET. This builds detection only; rejection needs `mutation.ts`.

## Where I got stuck
Flagged for `mutation.ts`: `detectCycle`'s reported cycle can start at any member (whichever DFS
reaches first) — still correct, but not necessarily "the slot the user just edited."

## Open questions raised
None — the one interpretive call (traversal direction) follows directly from `Edge`'s already-
reviewed field names.

## Review point
Fired: new load-bearing file (`graph/cycles.ts`); modified `graph/edge.ts` (load-bearing,
additive).
