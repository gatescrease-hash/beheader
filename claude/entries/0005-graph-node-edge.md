# 0005 — graph-node-edge
Date: 2026-08-21   Phase: 0   Model: Claude (Sonnet 5)
Previous entry: 0004-REVIEW-phase0   Last review: 0004-REVIEW-phase0 (verdict: ACCEPT WITH EDITS)

## Declared scope

Build `src/engine/graph/node.ts` (the three slot kinds + the GraphObject shape) and
`src/engine/graph/edge.ts` (the Edge shape), per PROJECT_BRIEF §5.1 and STATUS.md's
recommended next slice, carrying forward D-007 (mutable `type`), D-008 (test unspecified
cases), and D-009 (object type vocabulary defined once). Stop there — no `primitives/
schema.ts`, `graph/eval.ts`, `graph/cycles.ts`, or `mutation.ts` this cycle.

## Explicitly not in scope

Deriving edges from ASTs/schema declarations, cycle detection, evaluation order, mutation,
document round-trip. All still "Not started" per STATUS.md. Also explicitly not in scope: the
real formula lexer/parser/evaluator (Phase 1) — see Decisions below for what this cycle needed
instead and why.

## What I did

- `src/engine/graph/node.ts` — new. Implements §5.1: `Value`/`Point`/`ErrorValue` (the runtime
  value union), `ObjectType` (D-009's shared vocabulary, seeded from §5.10's eight command
  names plus Phase 0's `value`/`add` fixture types), `TABLE_TYPE`, the three slot kinds
  (`LiteralSlot`/`FormulaSlot`/`DerivedSlot`/`Slot`), `GraphObject`, and the helpers `slotKey`,
  `getSlot`, `resolveSlot`.
- `src/engine/graph/edge.ts` — new. Implements §5.1's `Edge` (`sourceSlot`/`dependentSlot`,
  field names taken verbatim from the brief's own sentence).
- `src/engine/formula/ast.ts` — new, ahead of its declared Phase 1 slot. A minimal
  `FormulaAst` (one variant, `ReferenceNode`) so `FormulaSlot` has something real to hold.
  Tagged `PROVISIONAL(Q-005)` — see Open Questions below.
- `src/engine/address.ts` — modified per D-009: `AddressableObject.type` is now `ObjectType`
  (was bare `string`); the local `TABLE_TYPE`/`toStoredPath`/`toSurfacePath` type-parameter now
  reference the shared definition from `graph/node.ts` instead of a duplicated literal.
- `src/engine/address.test.ts` — modified: the `objects()` test helper's `type` parameter is
  now `ObjectType` instead of bare `string` (required by the `AddressableObject` change; no
  test assertions changed).
- `src/engine/graph/node.test.ts`, `src/engine/graph/edge.test.ts` — new. 17 tests total (15 +
  2). Cover: `slotKey`/`getSlot`/`resolveSlot`; each of the three slot kinds, including an
  `ErrorValue` held in a literal slot (§5.1: "legitimate state, not a reason to reject a
  mutation"); the Phase 0 `value`/`add` fixture shapes named explicitly in PROJECT_BRIEF §6;
  that a `GraphObject` structurally satisfies `AddressableObject` and can be passed directly
  into `parseAddress`/`formatAddress`; and that two `GraphObject` values may share `id`/`name`
  while differing only in `type` (the data-shape half of D-007's mutability requirement).

## Decisions I made

- **`Value`/`Point`/`ErrorValue` live in `graph/node.ts`**, not a separate file — the brief's
  tree doesn't name one, and these types exist because slots hold them, so "slot/object data
  model" (the file's own tree-comment description) covers them. Other modules (formula
  evaluation, geometry compute functions, script stubs) should import from here rather than
  redefining.
- **The exported type is `GraphObject`, not `Object`.** PROCESS_BRIEF §5.1's vocabulary lock
  says use "object," but `Object` is TypeScript's own global type — shadowing it would be
  confusing every time a reader saw `Object.keys(...)` used nearby (which the tests do). This
  is a naming-collision workaround, documented as such in the file header, not a synonym.
- **`ObjectType` seeded with ten members**, not left open or guessed at: the eight product
  primitives are transcribed directly from PROJECT_BRIEF §5.10's command-line syntax (`circle`,
  `polygon`, `polyline`, `rect`, `text`, `table`, `script`, `image` — not invented), plus
  `value`/`add`, the two fixture-only types §6 (Phase 0) names explicitly. Per §5.5, `polyline`
  is already described as "editable path, per-vertex literal slots" — I read this as meaning
  D-007's explode changes a preset's type *to* `"polyline"`, not to some separate `"path"`
  type; documented as a decision in `node.ts`'s `ObjectType` doc comment for the reviewer to
  confirm or correct, since nothing in the brief says this in as many words.
- **`GraphObject extends AddressableObject`** rather than duplicating `id`/`name`/`type`. This
  makes the "structurally satisfies" claim a compiler-checked fact instead of a comment, and it
  is what let the D-009 wiring (`address.ts` importing `TABLE_TYPE`/`ObjectType` from
  `graph/node.ts`, `graph/node.ts` type-importing `Address`/`AddressableObject` from
  `address.ts`) resolve as a type-only circular reference with **no runtime circular import** —
  `graph/node.ts`'s import of `address.ts` is `import type` only, which is fully erased, so at
  runtime the dependency is one-directional (`address.ts` → `graph/node.ts`). Verified this
  compiles clean under both tsconfigs before relying on it.
- **`resolveSlot` returns `undefined`, not an `ErrorValue`, for a stale reference.** This file
  has no opinion on when a missing slot is an error versus an expected lookup miss — that
  judgment belongs to whatever calls it (formula evaluation would turn `undefined` into
  `#REF`; a UI hover-check might just treat it as "nothing there"). Keeping `resolveSlot` pure
  data-lookup, symmetric with `getSlot`'s `undefined`-on-miss and with `address.ts`'s
  `findObjectById`/`findObjectByName`.
- **Tied `AddressError`'s docstring to `graph/node.ts`'s `ErrorValue`** (it already claimed to
  match the "`#REF` arm of the engine's ErrorValue union" before `ErrorValue` existed as a real
  type) without restructuring `AddressError`'s declaration to formally extend it. The shapes
  already match structurally; introducing an `extends`/intersection felt like it would touch
  `address.ts` more than the actual goal (closing the loop the existing comment already
  promised) warranted. Flagging this in case the reviewer wants the formal tie instead of the
  documentation-only one.

## Verification (real output)

$ npm run typecheck
```
> graphpaper@0.0.0 typecheck
> tsc --noEmit && tsc --noEmit -p tsconfig.engine.json

exit=0
```

$ npm test
```
 ✓ src/engine/graph/edge.test.ts (2 tests) 2ms
 ✓ src/engine/graph/node.test.ts (15 tests) 6ms
 ✓ src/engine/address.test.ts (44 tests) 8ms

 Test Files  3 passed (3)
      Tests  61 passed (61)
```
(44 pre-existing + 17 new: 15 in node.test.ts, 2 in edge.test.ts.)

Rule 1 hygiene — grepped every new/changed file under `src/engine/` for `document.`,
`window.`, `canvas`, `CanvasRenderingContext`, and any `render/*` import:
```
$ rg "document\.|window\.|canvas|CanvasRenderingContext|from ['\"].*render" src/engine/**/*.ts
ast.ts:6, ast.ts:12, edge.ts:6, node.ts:6   — all inside the file-header "NEVER imports: ...
                                               DOM, window, ... canvas, render/*" boilerplate
node.ts:184                                — "A user-visible thing on the canvas (§5.1)" — the
                                               brief's own product-language "canvas", not the
                                               CanvasRenderingContext API
```
All five hits are prose describing the rule or quoting the brief's product vocabulary, not
actual DOM/canvas usage. Clean.

`any` usage check:
```
$ rg ":\s*any\b|as any" src/engine/**/*.ts
node.ts:79 — "...any formula reading an error slot yields an error..." — English "any", not a
              TypeScript `any` type. No actual `any` usage anywhere in the new/changed files.
```

## Acceptance criteria status

Phase 0 criterion (PROJECT_BRIEF §6) — NOT YET. This cycle builds the data shapes the
criterion's fixtures need (`value`, `add`); it does not yet propagate, detect cycles, or reject
a mutation, all of which need `graph/eval.ts`, `graph/cycles.ts`, and `mutation.ts`.

Demonstrated this cycle (shape-level, not behavioral): `node.test.ts`'s "Phase 0 fixture
shapes" block builds the exact `value` and `add` objects PROJECT_BRIEF §6 names, and the
"GraphObject satisfies address.ts's AddressableObject" block demonstrates the addressing seam
works end-to-end against a real (if minimal) `GraphObject`.

## Where I got stuck / what is unfinished

Nothing blocking. The one real design gap — `FormulaSlot` needing an AST type before Phase 1's
formula engine exists — is handled via Q-005 (below) rather than guessed past silently.

Worth flagging for whoever builds `primitives/schema.ts` next: this cycle's `ObjectType`
choice to fold `value`/`add` into the same union as the eight real product types means a
schema registry keyed by `ObjectType` will need `value`/`add` entries too (or an explicit
carve-out), even though they never appear on the command line. Noted in `node.ts`'s doc comment
but not resolved here — that's the next cycle's problem, not this one's.

## Open questions raised

**Q-005** — What does `formula/ast.ts` contain before Phase 1 builds the real grammar? Brief
section: §5.1/§5.3/§6. Reversible (widening a discriminated union is additive). Provisional
choice taken: a one-variant `FormulaAst` (`ReferenceNode` only), representing exactly what a
binding is per §5.1 ("the degenerate formula `= other.slot`"). Tagged at
`src/engine/formula/ast.ts`. Full writeup in `OPEN_QUESTIONS.md`.

## Escalation triggers fired

- §6.2 — created/modified `graph/*` files (`graph/node.ts`, `graph/edge.ts`) and modified
  `address.ts`. Both are explicitly named trigger-2 files.
- §6.3 — created new files under `src/engine/`: `graph/node.ts`, `graph/edge.ts`,
  `formula/ast.ts` (plus their colocated test files).
- §6.4 — raised Q-005 (formula AST scope) rather than guessing; made interpretive calls on
  `ObjectType`'s membership and on tying `AddressError` to `ErrorValue` only in documentation,
  both flagged explicitly above for the reviewer to confirm or correct.
- §6.9 — diff is 8 files changed, 600 insertions / 17 deletions (617 changed lines), over both
  thresholds (6 files, 400 lines).
- §6.6 — does NOT fire: `address.test.ts`'s only change is the `objects()` helper's type
  annotation (`string` → `ObjectType`); no existing test's assertions changed.
