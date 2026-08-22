# 0003 — address-cells-path-fix
Date: 2026-08-21   Phase: 0   Model: Claude (Sonnet 5)
Previous entry: 0002-REVIEW-phase0   Last review: 0002-REVIEW-phase0 (verdict: REVISE)

## Declared scope
Work 0002-REVIEW's fix list in full (items 1–7). Not starting `graph/node.ts`.

## What I did
- `address.ts`: `AddressableObject` gains `type: string`. Added `toStoredPath`/`toSurfacePath`
  (the D-005 mapping, hardcoded to the one specified case — table cells — and documented as a
  stand-in for `primitives/schema.ts`, which doesn't exist yet). `parseAddress`/`formatAddress`
  now route through them. Added `isAddressError` type guard; dropped the dead eslint-disable;
  documented the tuple cast and the no-pre-validation choice.
- `address.test.ts`: corrected the wrong table-cell assertion (now `["cells","A1"]"`) — a
  changed test expectation, explicitly instructed by 0002-REVIEW item 3, cited here per that
  instruction. Added the round-trip test over all five §5.2 address forms, a 2+-segment
  passthrough test, and a non-table-no-mapping test.
- `tsconfig.engine.json` — new (D-006): DOM-free, covers `src/engine/**` including tests.
  `package.json`'s `typecheck` script now runs both configs.

## Decisions I made
- Implemented item 1 directly (not via D-005 §4's lexical-stage escape hatch) — one type, one
  mapping, small enough to do for real now.
- A table path with 2+ segments (`table_x.cells.A1`) is left untouched, not rejected — falls out
  for free from the mapping rule and lets a user type the literal stored form.
- `isAddressError` takes `unknown`, not a narrower union, so it discriminates both
  `parseAddress`'s and `formatAddress`'s return types with one guard.

## Verification
`npm run typecheck` — clean, both configs. `npm test` — 36/36 (was 28, +8). D-006
re-verification: the reviewer's exact DOM-in-`engine/` probe now fails under the new engine
config as intended; probe file removed after, `git status` clean.

## Acceptance criteria status
Phase 0 — NOT YET. F-1 (0002-REVIEW) is resolved, demonstrated by the new round-trip test
covering all five §5.2 address forms including the table-cell row.

## Where I got stuck
Nothing significant. Flagged for whoever builds `graph/node.ts`/`schema.ts`: the object type
strings used in tests (`"polygon"`, `"circle"`, …) are illustrative only, not yet a decided
vocabulary.

## Open questions raised
None — this cycle resolves review findings.

## Review point
Fired: modified a load-bearing file (`address.ts`); changed a previously-passing test's
expectations (explicitly instructed by 0002-REVIEW item 3).
