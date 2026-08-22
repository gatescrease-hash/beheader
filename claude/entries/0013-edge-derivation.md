# 0013 — edge-derivation
Date: 2026-08-22   Phase: 0   Model: implementer (Claude Sonnet 5)
Previous entry: 0012-REVIEW-phase0   Last review: 0012-REVIEW-phase0 (verdict: ACCEPT WITH EDITS — "`mutation.ts` may begin.")

## Declared scope
Per STATUS.md's own recommendation ("consider splitting edge derivation out
as its own slice first — the last two cycles both gained from leaving the
obvious next module alone"): build ONLY `mutation.ts`'s edge derivation
(§5.1 mutation-loop step 3) — `deriveEdges(objects) => Edge[]`, walking every
formula slot's stored AST and every schema-declared derived slot's
dependencies. Colocated tests. Widen `primitives/schema.ts` only as far as
this need requires (see "Decisions I made").

## Explicitly not in scope
The rest of the 8-step mutation loop: stage (clone), apply an operation,
validate integrity (§5.1.1), validate acyclicity (reject + format via
`formatAddress`, D-015), evaluate + commit + journal, and the batch form. No
operation shape (`setLiteral`, `link`, create/delete) exists yet — this
cycle's `deriveEdges` consumes a `GraphObject[]` it is handed; it does not
produce one. `document.ts` remains untouched. Therefore the Phase 0
acceptance criterion's remaining three clauses (cycle rejection with prior
state unchanged, slot-deletion rejection, document round-trip) are still not
demonstrable — this cycle does not attempt to claim any of them.

## What I did
- **`src/engine/primitives/schema.ts`** — widened `ObjectSchema` with a new
  field, `nonDerivedSlotPaths: readonly (readonly string[])[]`: the full set
  of paths a type's `literal`/`formula` slots occupy. Populated for both
  Phase 0 fixture types (`VALUE_SCHEMA`: `[["value"]]`; `ADD_SCHEMA`:
  `[["in","a"], ["in","b"]]`). This is exactly the widening the file's own
  header had flagged as deferred ("Declaring an object type's FULL slot
  set... Widen this file when that need is concrete rather than
  speculatively now") — see "Decisions I made" for why this cycle IS that
  concrete need. PATHS only, not a default-kind declaration: §5.1 says
  literal/formula are interchangeable at runtime, so which one a given path
  currently holds is still read from the object's actual `slots`, never from
  this list.
- **`src/engine/mutation.ts`** — new. Exports one function so far,
  `deriveEdges(objects: readonly GraphObject[]) => readonly Edge[]`,
  rebuilding the entire edge set from scratch (Rule 5) by walking, per
  object: (1) `schema.nonDerivedSlotPaths`, looking up each path's current
  slot and emitting a binding edge only if it is `formula`-kind (a `literal`
  slot has no inbound edges); (2) `schema.derivedSlots`, calling
  `derivedSlotDependencyAddresses` for each entry — the only call site for
  that resolver in this cycle's code, matching its own header's "edge-
  derivation time only" rule. An object whose type has no schema entry yet
  contributes no edges at all (honest, matching `getObjectSchema`'s own
  `undefined` stance). Never throws: a `nonDerivedSlotPaths` entry missing
  from an object's actual `slots` (a malformed fixture) is skipped, not
  indexed into blindly.
- **`src/engine/mutation.test.ts`** — new, 7 tests. Covers: the §6 value/add
  fixture deriving exactly the four edges `graph/eval.test.ts` has always
  had to hand-build (binding edges for `in.a`/`in.b`, dependency edges for
  `out.result`); an isolated `value` object deriving zero edges; feeding
  `deriveEdges`'s OWN output (not a hand-built edge set) into the
  already-reviewed `evaluate()` across the two-object literal→formula→
  derived→formula→derived chain and getting the identical propagation result
  `graph/eval.test.ts` asserts — a real end-to-end integration check, not
  just a shape check; a type with no schema entry (`circle`) deriving zero
  edges without throwing; a `literal`-kind slot at a non-derived path
  correctly producing no binding edge while the derived slot's dependency
  edges still appear (schema-driven, independent of the input slots'
  current kind); a schema-declared path missing from an object's actual
  slots being skipped rather than throwing; and a formula referencing an
  address with no corresponding object still being derived verbatim (address
  *validity* is step 4's job, not edge derivation's).
- **`src/engine/primitives/schema.test.ts`** — 2 new tests pinning
  `nonDerivedSlotPaths` for both fixture types (17 → 19 tests).

## Decisions I made
- **Widened `primitives/schema.ts` rather than inverting a
  `GraphObject.slots` key.** The concrete problem: a binding edge's
  `dependentSlot` needs the formula slot's OWN address, which needs a real
  `path` array — and `GraphObject.slots` only carries the joined string key
  (`slotKey(path)`). Derived slots already have an escape hatch for this
  exact problem (`DerivedSlotSchema.path`, which is how `graph/eval.ts`'s
  `findDerivedSlotSchemaByKey` avoided inverting a key at 0011). Formula
  slots had no equivalent declaration anywhere, because
  `primitives/schema.ts` had deliberately deferred declaring a type's full
  slot set until something concrete needed it (its own header, NOT DONE
  HERE). This cycle is that concrete need, so I added the missing
  declaration where the existing one already lives, rather than reaching for
  `key.split(".")` in `mutation.ts` — which would work arithmetically
  (`PATH_SEGMENT_PATTERN` forbids `.` in a segment) but would duplicate
  `slotKey`'s join format outside `node.ts`/`schema.ts`'s established
  pattern, and would give every future caller a second, ad hoc way to
  recover a path from a key instead of the one sanctioned way (declare it).
  Considered and rejected: adding `path` directly onto `FormulaSlot` in
  `graph/node.ts` instead. That would touch the object/slot data model
  itself — a bigger, more load-bearing change to an already-reviewed file,
  for a need `primitives/schema.ts`'s own header already anticipated solving
  differently. Widening the registry is the smaller, already-signposted
  move.
- **`nonDerivedSlotPaths` is PATHS only, deliberately not a default-kind or
  default-value declaration.** §5.1 does ask schemas to declare a slot's
  "default kind" too, but that need (object *creation*) is still not
  concrete — no create-mutation exists yet. Adding it now would be
  speculative widening, the exact thing the file's header warns against;
  I widened only as far as `deriveEdges` actually needs.
- **`deriveEdges` makes no ordering promise and the tests compare edge sets,
  not edge arrays.** Both consumers (`graph/cycles.ts`, `graph/eval.ts`)
  build their own adjacency from `edges` and are already proven order-
  agnostic (0012-REVIEW's probe on `eval.ts` targeted the topological
  *sort*, not `edges`' input order). Promising an order here would be a
  contract nothing needs and nothing was asked to keep.
- **A schema-declared path missing from an object's actual `slots` is
  silently skipped, not an error.** `mutation.ts`'s own future object-
  creation step should make this impossible, but this function does not
  trust that — same "never throws, fails closed" posture `graph/eval.ts`
  already established for its own defensive arms (L-13).

## Verification (real output)
```
$ npx tsc --noEmit
(exit 0, no output)
$ npx tsc --noEmit -p tsconfig.engine.json
(exit 0, no output)
$ npm test

 RUN  v2.1.9 C:/Users/William/Documents/Code Projects/beheader

 ✓ src/engine/graph/node.test.ts (20 tests) 5ms
 ✓ src/engine/graph/edge.test.ts (6 tests) 2ms
 ✓ src/engine/primitives/schema.test.ts (19 tests) 5ms
 ✓ src/engine/address.test.ts (44 tests) 8ms
 ✓ src/engine/graph/cycles.test.ts (11 tests) 4ms
 ✓ src/engine/graph/eval.test.ts (10 tests) 6ms
 ✓ src/engine/mutation.test.ts (7 tests) 5ms

 Test Files  7 passed (7)
      Tests  117 passed (117)
```
108 pre-existing (as of 0012-REVIEW) + 2 (schema.test.ts) + 7 (mutation.test.ts,
new file) = 117. 0 skipped; grepped `.only(`/`.skip(`/`.todo(` across `src/` —
no hits.

**D-016 mutation checks, both load-bearing branches of `deriveEdges`,
run before writing this entry:**

1. Disabled the formula-slot binding-edge branch (the loop over
   `nonDerivedSlotPaths`) — commented out the `edges.push` for source 1 only:
   ```
   ❯ src/engine/mutation.test.ts (7 tests | 5 failed)
     × ...derives the binding edges (in.a/in.b) and the derived-slot dependency edges (out.result), and nothing else
     × ...feeds evaluate() the same propagation graph/eval.test.ts's hand-built edges produce...
     × ...derives no binding edge for that path, but still derives the derived slot's schema-declared dependency edges
     × ...skips it rather than throwing, for a malformed fixture missing in.b entirely
     × ...still derives the edge verbatim — an address's VALIDITY is step 4's job (§5.1.1), not edge derivation's
   Test Files  1 failed | 6 passed (7)
        Tests  5 failed | 112 passed (117)
   ```
   Exactly the 5 tests that exercise a binding edge failed; the 2 tests that
   only touch the no-schema-yet / isolated-value cases passed. Reverted.
2. Disabled the derived-slot dependency-edge branch (the loop over
   `schema.derivedSlots`):
   ```
   ❯ src/engine/mutation.test.ts (7 tests | 4 failed)
     × ...derives the binding edges (in.a/in.b) and the derived-slot dependency edges (out.result), and nothing else
     × ...feeds evaluate() the same propagation graph/eval.test.ts's hand-built edges produce...
     × ...derives no binding edge for that path, but still derives the derived slot's schema-declared dependency edges
     × ...skips it rather than throwing, for a malformed fixture missing in.b entirely
   Test Files  1 failed | 6 passed (7)
        Tests  4 failed | 113 passed (117)
   ```
   Exactly the 4 tests asserting an `out.result` dependency edge failed (the
   "no corresponding object at all" test only asserts the `in.a` binding edge
   via `toContainEqual`, so it stayed green — correctly, since it never
   claimed anything about derived-slot edges). Reverted; re-ran
   `npm run typecheck` and `npm test` after both reversions — back to
   117/117, both configs clean (pasted above is the final, reverted state).

## Acceptance criteria status
No PROJECT_BRIEF §6 acceptance-criterion clause is claimed this cycle.
Edge derivation is one internal step (§5.1 step 3) inside a larger loop that
does not exist yet; none of the four clauses (propagation order — already
PASSING per 0012-REVIEW; cycle rejection with prior state unchanged; slot
deletion rejected; document round-trip) is decided by this file alone. Per
D-016, no claim is made here that a mutation check has not backed — the two
checks above cover this cycle's only new load-bearing logic.

## Where I got stuck / what is unfinished
Not stuck. The one real fork was the `nonDerivedSlotPaths` decision above,
and it resolved cleanly because `primitives/schema.ts`'s own header had
already named the correct extension point in advance — this cycle recognized
"the need is concrete now" rather than inventing a new mechanism.

`mutation.ts` still needs steps 1, 2, 4-8 and the batch form before any of
Phase 0's remaining three acceptance clauses is even attemptable. Per
STATUS.md's carried-forward D-016 warning, cycle rejection (naming the
offending slots via `formatAddress`, D-015) and prior-state-unchanged are
both going to need their own mutation checks before being claimed, and
`document.ts`'s round-trip has not been started at all.

## Open questions raised
None. The `nonDerivedSlotPaths` fork was resolved by following
`primitives/schema.ts`'s own already-written forward guidance, not by a new
judgment call on load-bearing structure — same standard 0012-REVIEW §9
applied to cycle 0011's forks.

## Escalation triggers fired
- **§6 trigger 2** — modified `primitives/schema.ts` and created
  `mutation.ts`, both explicitly named trigger-2 files.
- **§6 trigger 3** — new file under `src/engine/` (`mutation.ts`).
- **§6 trigger 9** — diff: `mutation.ts` (137 lines) + `mutation.test.ts`
  (169 lines) + `schema.ts` changes (~35 lines net) + `schema.test.ts`
  (+13 lines) ≈ 354 source lines across 4 files. Under the ~400-line
  guideline on lines but over on file count in one reading (4 files); I am
  reporting trigger 9 as fired regardless, on the same "report honestly
  rather than argue the edge" principle 0011/0012-REVIEW established,
  because `mutation.ts` and `primitives/schema.ts` are BOTH independently
  trigger-2 files and trigger 9 would be moot either way.
- All other triggers (1, 4-8, 10): none fired. No phase criterion claimed
  complete (1 does not apply, see "Acceptance criteria status"); no
  deviation from or ambiguity in the brief was found (4 — the
  `nonDerivedSlotPaths` fork was resolved by existing written guidance, not
  a guess); no hard rule worked around (5); no previously-passing test's
  expectations changed (6 — `schema.test.ts`'s existing assertions are
  untouched, only new tests were added); no dependency/build step/config
  added (7); no bug attempted twice (8); nothing in §8's deferred list was
  approached (10).
