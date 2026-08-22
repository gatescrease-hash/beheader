# 0007 — primitives-schema
Date: 2026-08-21   Phase: 0   Model: implementer (Claude Sonnet 5)
Previous entry: 0006-REVIEW-phase0   Last review: 0006-REVIEW-phase0 (verdict: ACCEPT)

## Declared scope
Build `src/engine/primitives/schema.ts`: the derived-slot declaration mechanism (§5.1 — path,
dependencies, compute function), with real entries for `value`/`add` (D-011). Support both
static and dynamic dependency forms, even though neither fixture needs `dynamic`.

## What I did
- `primitives/schema.ts` — new. `DerivedSlotDependencies` (`static`: fixed same-object paths, or
  `dynamic`: a function of current state); `DerivedSlotCompute`/`DerivedSlotSchema`/
  `ObjectSchema`; `derivedSlotDependencyAddresses` (the one place a dependency declaration
  becomes concrete `Address`es — documented as edge-derivation-time only, per Rule 6);
  `VALUE_SCHEMA` (empty `derivedSlots`, genuinely — not a placeholder); `ADD_SCHEMA` (`out.result`
  statically depending on `in.a`/`in.b`, matching the already-reviewed fixture in
  `graph/node.test.ts`); `getObjectSchema`/`findDerivedSlotSchema` (honest `undefined` for every
  type with no entry yet).
- `primitives/schema.test.ts` — new, 16 tests.

## Decisions I made
- `add`'s slot naming matches the already-committed `graph/node.test.ts` fixture and §5.2's own
  `in.*`/`out.*` example.
- Error precedence in `add`'s compute checks `in.a` before `in.b` — arbitrary but deterministic;
  not worth an open question.
- `Partial<Record<ObjectType, ObjectSchema>>` for the registry — a full `Record` would force
  every consumer to type-narrow eight not-yet-built entries for no benefit.
- Scope held at "derived slots only," not full per-type slot-set declaration — that need
  (object creation) isn't concrete until `mutation.ts` exists. Recorded as "NOT DONE HERE."

## Verification
`npm run typecheck` — clean, both configs. `npm test` — 77/77 (61 + 16 new), 0 skipped.

## Acceptance criteria status
Phase 0 — NOT YET. No criterion claimed this cycle.

## Where I got stuck
One disclosed judgment call: `add`'s compute doesn't distinguish "resolved to `null`" from
"didn't resolve" beyond the `undefined` check — a literal `null` input falls through to `#TYPE`
(`typeof null === "object"`). Tested for "does not throw," not for the specific code. Judged
adequate for this fixture; flagged rather than chased further.

## Open questions raised
None — all decisions reversible and internal to one new fixture's compute function.

## Review point
Fired: new load-bearing file (`primitives/schema.ts`); diff over the line-count half of the
threshold (433 source lines / 2 files).
