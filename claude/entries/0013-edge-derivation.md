# 0013 — edge-derivation
Date: 2026-08-22   Phase: 0   Model: implementer (Claude Sonnet 5)
Previous entry: 0012-REVIEW-phase0   Last review: 0012-REVIEW-phase0 (verdict: ACCEPT WITH EDITS — "`mutation.ts` may begin.")

## Declared scope
Per STATUS.md's own recommendation to split it out: build ONLY `mutation.ts`'s edge derivation
(§5.1 step 3) — `deriveEdges(objects) => Edge[]`. Widen `primitives/schema.ts` only as far as
this need requires.

## What I did
- `primitives/schema.ts` — widened `ObjectSchema` with `nonDerivedSlotPaths: readonly (readonly
  string[])[]` (the full set of paths a type's literal/formula slots occupy), populated for
  `value`/`add`. Paths only, not a default-kind declaration — that need (object creation) still
  isn't concrete.
- `mutation.ts` — new. `deriveEdges(objects) => Edge[]`: rebuilds the whole edge set from scratch
  by walking, per object, `schema.nonDerivedSlotPaths` (emitting a binding edge only where the
  slot is currently `formula`-kind) and `schema.derivedSlots` (via
  `derivedSlotDependencyAddresses` — the only call site, matching Rule 6). A type with no schema
  entry contributes no edges. Never throws: a declared path missing from the object's actual
  slots is skipped, not indexed into.
- `mutation.test.ts` — new, 7 tests, including feeding `deriveEdges`'s own output into the
  already-reviewed `evaluate()` and getting the identical propagation result `eval.test.ts`
  asserts — a real integration check, not a shape check.
- `schema.test.ts` — 2 new tests pinning `nonDerivedSlotPaths` for both fixture types.

## Decisions I made
- Widened `schema.ts` rather than inverting a `GraphObject.slots` key — a binding edge's
  `dependentSlot` needs the formula slot's own path, and `schema.ts`'s own header had already
  flagged this exact extension point as deferred-until-concrete. Considered and rejected: adding
  `path` directly to `FormulaSlot` in `graph/node.ts` — bigger, touches an already-reviewed
  file, for a need the schema module already anticipated solving differently.
- `deriveEdges` makes no ordering promise — both consumers (`cycles.ts`, `eval.ts`) already build
  their own adjacency and are proven order-agnostic.
- A schema-declared path missing from an object's actual slots is silently skipped, not an
  error — `mutation.ts`'s own future creation step should make this impossible, but this
  function doesn't trust that, matching `eval.ts`'s existing "never throws, fails closed" posture.

## Verification
`npm run typecheck` — clean, both configs. `npm test` — 117/117 (108 pre-existing + 2 + 7).
D-016 mutation checks on both load-bearing branches of `deriveEdges` (binding-edge loop,
derived-dependency loop): disabling each in turn failed exactly the tests exercising that branch
and no others (5/117 and 4/117 respectively); reverted both, back to 117/117.

## Acceptance criteria status
No §6 clause claimed this cycle — edge derivation is one internal step inside a loop that
doesn't fully exist yet.

## Where I got stuck
Not stuck — the `nonDerivedSlotPaths` fork resolved cleanly because `schema.ts`'s own header had
already named the right extension point. `mutation.ts` still needs steps 1, 2, 4–8 and the batch
form before any of Phase 0's remaining three criterion clauses is attemptable.

## Open questions raised
None — resolved by following `schema.ts`'s own written forward guidance.

## Review point
Fired: modified `primitives/schema.ts`, created `mutation.ts` — both load-bearing; new subsystem
file.
