# 0009 — graph-cycles
Date: 2026-08-21   Phase: 0   Model: implementer (Claude Sonnet 5)
Previous entry: 0008-REVIEW-phase0   Last review: 0008-REVIEW-phase0 (verdict: ACCEPT WITH EDITS)

## Declared scope

Build `src/engine/graph/cycles.ts`: naive DFS cycle detection over an already-
derived `Edge[]` (§5.1 step 5) — decide whether the edge set contains a cycle,
and if so, report every slot in one such cycle, in order. Add one small,
additive export, `addressKey`, to the already-reviewed `graph/edge.ts` (a
canonical string key for a full `Address`, needed by this module's DFS and
which `graph/eval.ts`'s topological sort will need identically next cycle).

## Explicitly not in scope

- `src/engine/graph/eval.ts` (topological evaluation), even though STATUS's
  "Next slice" note grouped `cycles.ts` + `eval.ts` together. Splitting into
  two independently reviewable slices produces a smaller diff and lower risk
  per one at a time, per PROCESS_BRIEF §13's "smaller diff" tie-break — and
  `eval.ts` is where D-013 (compute functions may read only their declared
  dependencies) must be mechanically enforced, which deserves its own
  undiluted review.
- Turning a detected cycle into a human-readable rejection message (resolving
  each `Address` to its current object name via `address.ts`'s
  `formatAddress`). That is `mutation.ts`'s job — it has the document's object
  list; `cycles.ts` deliberately does not take one.
- `mutation.ts` itself, and deriving the `Edge[]` this module consumes from
  stored ASTs/schema declarations (mutation step 3).

## What I did

- `src/engine/graph/edge.ts` — additive edit. Added `addressKey(address):
  string`, joining `objectId` and `slotKey(path)` with `"::"`. Placed beside
  `Edge` (the type both `cycles.ts` and the future `eval.ts` traverse) rather
  than duplicated in each — same reasoning 0008-REVIEW's D-014 already
  established for `isErrorValue`. This is the one place this cycle touches an
  already-reviewed file; it's a pure addition, no existing export changed.
- `src/engine/graph/edge.test.ts` — added 4 tests for `addressKey`: joins
  correctly, equal for structurally-equal-but-different-instance Addresses,
  distinguishes the same path on two different objects (the reason it differs
  from `node.ts`'s `slotKey`), distinguishes two different paths on the same
  object.
- `src/engine/graph/cycles.ts` — new. `CycleCheckResult` (`{ hasCycle: false }`
  or `{ hasCycle: true, cycle: readonly Address[] }`) and `detectCycle(edges)`:
  builds adjacency fresh from `edges` on every call (Rule 5 — no incremental
  bookkeeping), then runs the standard white/gray/black DFS cycle detection,
  following `sourceSlot -> dependentSlot` arcs (matching `Edge`'s own field
  names). Visits every node reachable from `edges`, across disjoint
  components, and returns the first cycle found — sufficient per §5.1's
  acceptance criterion, which asks for one cycle's slots named, not an
  exhaustive enumeration.
- `src/engine/graph/cycles.test.ts` — new, 10 tests. Acyclic cases: empty edge
  set, a simple chain, a diamond DAG (two paths converging — the case a naive
  "visited twice means cycle" check gets wrong), disjoint acyclic components,
  duplicate edges. Cyclic cases: a self-referencing edge (§5.3 — must not be
  special-cased), a direct two-slot cycle, a three-slot cycle, a cycle
  embedded among unrelated acyclic edges (full-graph DFS, not just the first
  component), and a cycle reached only after a node with an extra acyclic
  outgoing edge (defends against stopping early on the first neighbor).
  Assertions verify the reported cycle GENUINELY closes (a real edge exists
  from each element to the next, wrapping around) rather than pinning to one
  specific array literal, since the DFS's traversal order is an
  implementation detail the tests should not be coupled to.

## Decisions I made

- **`addressKey` lives in `graph/edge.ts`, not `address.ts` or `cycles.ts`.**
  `Address` and `formatAddress`/`parseAddress` already live in `address.ts`,
  but those need an object list to resolve names — `addressKey` deliberately
  does not, and is used only by graph-traversal code. Putting it in `edge.ts`
  keeps `address.ts` untouched (smaller diff, no added trigger-2 surface
  there) and puts the key beside the one type (`Edge`) both its consumers
  actually traverse.
- **`sourceSlot -> dependentSlot` is the traversal direction**, i.e. a cycle
  follows the same direction `Edge`'s own field order implies (source feeds
  dependent). Not stated explicitly as a graph-direction convention anywhere
  in the brief, but it is the only reading consistent with `Edge`'s field
  names and with topological sort needing prerequisites processed first — the
  same direction `eval.ts` will need for Kahn's-style ordering next cycle.
- **Reporting only the first cycle found**, not every cycle in a malformed
  edge set. §5.1's acceptance criterion is "a cycle is rejected... naming the
  offending slots" (singular), and Rule 5 argues for the simplest sufficient
  answer. Recorded explicitly in the file header so a future reader doesn't
  read the single-cycle behaviour as an oversight.
- **Recursive DFS**, not an iterative one with an explicit stack. Rule 5's
  "dumbest correct implementation" and the brief's own performance-non-goal
  framing (documents at "a few hundred objects" scale) both favour the more
  legible recursive form; recursion depth tracks the longest dependency chain
  in one document, which is nowhere near a stack-overflow concern at this
  scale.

## Verification (real output)

$ npm run typecheck
```
> graphpaper@0.0.0 typecheck
> tsc --noEmit && tsc --noEmit -p tsconfig.engine.json
```
(exit 0, both configs — no output is the success case)

$ npm test
```
 RUN  v2.1.9 C:/Users/William/Documents/Code Projects/beheader

 ✓ src/engine/graph/edge.test.ts (6 tests) 5ms
 ✓ src/engine/graph/node.test.ts (20 tests) 6ms
 ✓ src/engine/primitives/schema.test.ts (17 tests) 7ms
 ✓ src/engine/address.test.ts (44 tests) 12ms
 ✓ src/engine/graph/cycles.test.ts (10 tests) 6ms

 Test Files  5 passed (5)
      Tests  97 passed (97)
```
97 = 83 pre-existing (44 + 20 + 2 + 17) + 4 new (`addressKey`) + 10 new
(`detectCycle`). Zero skipped, zero `.only`.

## Acceptance criteria status

Phase 0 criterion (PROJECT_BRIEF §6) — NOT YET. This cycle builds the
cycle-detection half of "a cycle is rejected with the offending slots named
and prior state is provably unchanged"; the "rejected" part (a mutation that
actually discards its clone and returns a failure) is `mutation.ts`'s job, not
built yet. Propagation, evaluation, and deletion-rejection are similarly still
outstanding.
Demonstrated by: N/A this cycle — no acceptance criterion claimed.

## Where I got stuck / what is unfinished

Not stuck. One thing flagged for whoever builds `mutation.ts`'s rejection
message: `detectCycle`'s `cycle` array can start at ANY of the cycle's
members (whichever the DFS happened to reach first) — it is not guaranteed to
start at, say, the slot the user most recently edited. A rejection message
listing them in this order is still correct (every slot IS named), but if a
future reviewer or user expects the message to lead with "the formula you
just typed," that ordering is not what this function provides and would need
to be imposed by the caller.

## Open questions raised

None. The one interpretive call not explicitly stated in the brief — the
`sourceSlot -> dependentSlot` traversal direction — follows directly from
`Edge`'s own already-reviewed field names and is reversible (an internal
detail of one function's implementation, not observable through any public
contract other than "does this edge set contain a cycle").

## Escalation triggers fired

- **§6.2** — modified `graph/edge.ts` (additive) and created `graph/cycles.ts`,
  both named `graph/*` under the trigger-2 list.
- **§6.3** — two new files under `src/engine/` (`cycles.ts`, `cycles.test.ts`).

No other trigger fired: no phase acceptance criterion is claimed (§6.1); diff
is 383 lines across 4 files, under the ~400/6 guideline (§6.9, does not fire);
nothing in §8's deferred list was touched (§6.10); no pre-existing test's
expectations changed (§6.6); no dependency, build step, or config file was
added (§6.7); first attempt at this slice (§6.8); no hard rule was worked
around (§6.5).
