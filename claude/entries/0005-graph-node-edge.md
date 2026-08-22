# 0005 — graph-node-edge
Date: 2026-08-21   Phase: 0   Model: Claude (Sonnet 5)
Previous entry: 0004-REVIEW-phase0   Last review: 0004-REVIEW-phase0 (verdict: ACCEPT WITH EDITS)

## Declared scope
Build `src/engine/graph/node.ts` (three slot kinds + `GraphObject`) and `graph/edge.ts` (`Edge`),
per §5.1, carrying D-007/D-008/D-009 forward. Stop there — no `schema.ts`, `eval.ts`,
`cycles.ts`, or `mutation.ts` this cycle.

## What I did
- `graph/node.ts` — new. `Value`/`Point`/`ErrorValue`, `ObjectType` (D-009's shared vocabulary:
  the eight §5.10 command types plus Phase 0's `value`/`add` fixtures), `TABLE_TYPE`, the three
  slot kinds, `GraphObject`, `slotKey`/`getSlot`/`resolveSlot`.
- `graph/edge.ts` — new. `Edge` (`sourceSlot`/`dependentSlot`, field names from the brief's own
  sentence).
- `formula/ast.ts` — new, ahead of its declared Phase 1 slot: a minimal one-variant `FormulaAst`
  so `FormulaSlot` has something real to hold. Tagged `PROVISIONAL(Q-005)`.
- `address.ts` — modified per D-009: `AddressableObject.type` is now `ObjectType`; local
  `TABLE_TYPE` references the shared definition.
- 17 new tests across `graph/node.test.ts`/`graph/edge.test.ts`.

## Decisions I made
- `Value`/`Point`/`ErrorValue` live in `graph/node.ts` (slots hold them; no dedicated file named
  in the brief's tree).
- Exported type is `GraphObject`, not `Object` — TS's own global type would shadow confusingly;
  documented as a naming workaround, not a vocabulary synonym.
- `ObjectType` seeded with all ten members transcribed from §5.10/§6, not guessed.
- `GraphObject extends AddressableObject` — makes "structurally satisfies `address.ts`" a
  compiler fact. `graph/node.ts`'s import of `address.ts` is `import type` only (verified: fully
  erased, no runtime circular import).
- `resolveSlot` returns `undefined`, not an `ErrorValue`, on a miss — turning that into `#REF` is
  the caller's job (symmetric with `getSlot`/`findObjectById`'s existing `undefined`-on-miss).

## Verification
`npm run typecheck` — clean, both configs. `npm test` — 61/61 (44 pre-existing + 17 new). Rule 1
grep and `any` grep — clean (only prose hits).

## Acceptance criteria status
Phase 0 — NOT YET (shapes only; nothing propagates/evaluates yet). Demonstrated: the exact §6
`value`/`add` fixture shapes exist and structurally satisfy `AddressableObject`.

## Where I got stuck
Nothing blocking. Flagged for whoever builds `schema.ts`: folding `value`/`add` into `ObjectType`
means the schema registry needs entries (or a carve-out) for them too.

## Open questions raised
**Q-005** — what does `formula/ast.ts` hold before Phase 1's real grammar? Reversible; provisional
choice (a) taken (one-variant `ReferenceNode`), tagged at `src/engine/formula/ast.ts`. Full
writeup in `OPEN_QUESTIONS.md`.

## Review point
Fired: modified/created `graph/*` and `address.ts` (load-bearing); new subsystem files
(`graph/node.ts`, `graph/edge.ts`, `formula/ast.ts`); diff over threshold (8 files, 617 lines).
