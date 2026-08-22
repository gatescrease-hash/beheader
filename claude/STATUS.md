# STATUS — as of entry 0005

STATE: GREEN (compiles under both tsconfigs, all tests pass)

Current phase: 0 — Graph core (headless, no pixels)
Phase 0 acceptance criterion (quoted from PROJECT_BRIEF §6):
> you can build a graph in a unit test, bind slots, mutate a value and watch it propagate
> in correct topological order *including through derived slots*; a cycle is rejected with
> the offending slots named **and prior state is provably unchanged**; deleting a slot with
> dependents is rejected; and a document round-trips to JSON and back identically.
Status: partial. Addressing is complete and reviewed. The slot/object/edge data shapes now
exist (this cycle) but are unreviewed. No propagation, cycle detection, mutation, or
evaluation exists yet — those are what the acceptance criterion actually needs next.

Last review: 0004-REVIEW-phase0, verdict ACCEPT WITH EDITS (addressing only).
**Cycle 0005 (this entry) is unreviewed and reports REVIEW: REQUIRED** — it touches `graph/*`
and `address.ts`, both trigger-2 files, and the diff exceeds §6.9's size threshold.

## Built and reviewed
- Project scaffold: `package.json`, `tsconfig.json` (strict), `tsconfig.engine.json`
  (DOM-free, D-006), `vite.config.ts`, `index.html`, Vitest via `npm test`.
- `src/main.ts` — placeholder entry point.
- `src/engine/address.ts` + `src/engine/address.test.ts` (§5.2) — reviewed at 0004-REVIEW.
  **Note: modified again in cycle 0005** (D-009: `AddressableObject.type` is now `ObjectType`,
  imported from `graph/node.ts`, instead of bare `string`). That specific change is
  unreviewed and should be checked alongside the rest of 0005.

## Built, not yet reviewed
- `src/engine/graph/node.ts` + `src/engine/graph/node.test.ts` (§5.1) — new. `Value`/`Point`/
  `ErrorValue`, `ObjectType` (D-009's shared vocabulary — 8 product types from §5.10 + `value`/
  `add` fixture types), `TABLE_TYPE`, the three slot kinds, `GraphObject`, `slotKey`/`getSlot`/
  `resolveSlot`. 15 tests.
- `src/engine/graph/edge.ts` + `src/engine/graph/edge.test.ts` (§5.1) — new. `Edge`
  (`sourceSlot`/`dependentSlot`). 2 tests.
- `src/engine/formula/ast.ts` — new, ahead of its Phase 1 slot. Minimal one-variant
  `FormulaAst` (`ReferenceNode`), needed so `FormulaSlot` has something to hold before Phase
  1's real grammar exists. **`PROVISIONAL(Q-005)`** — see Live PROVISIONAL tags below.

## Not started
In brief §7 order, remaining:
1. `src/engine/primitives/schema.ts` (derived-slot declaration mechanism) — **next, once 0005
   is reviewed**
2. `src/engine/graph/cycles.ts` (naive DFS) + `src/engine/graph/eval.ts` (naive full topo
   re-eval over all three slot kinds, derived slots inline, no post-pass)
3. `src/engine/mutation.ts` (clone / validate / commit + journal)
4. `src/engine/document.ts` round-trip test (including `nextObjectId`, D-002)

Then Phase 1 (formula engine — including the REAL `formula/ast.ts`, which widens rather than
replaces the Phase 0 `FormulaAst` stand-in per Q-005). Do not start Phase 1 before Phase 0's
criterion passes and is reviewed.

## Next slice (recommended)

Send cycle 0005 for review first (it touches `graph/*` and `address.ts`). If accepted:
`src/engine/primitives/schema.ts` — the derived-slot declaration mechanism (§5.1: "Each object
type's schema declares, for every derived slot: its address path, its dependencies, and its
compute function"). This is where `ObjectType`'s members each need to say what slots they
have — including whether `value`/`add` (Phase 0 fixture-only types) get real schema entries or
an explicit carve-out (flagged, unresolved, in entry 0005's "Where I got stuck").

## Known problems
- **`ObjectType` includes `value`/`add`, fixture-only types never reachable from the command
  line**, alongside the eight real product types. Whoever builds `primitives/schema.ts` needs
  to decide whether these get real schema entries or a carve-out. Not resolved; flagged in
  entry 0005.
- The table/`cells` path mapping in `address.ts` is still hardcoded (documented stand-in for
  `primitives/schema.ts`, per D-005 §4 and D-009).
- `npm run typecheck` still does not cover config files themselves. Low severity, unchanged.
- `npm audit`: 5 vulnerabilities in dev deps, not runtime. Not investigated; out of scope.
- **Layout question — SETTLED, do not re-raise.** `claude/` stays flat; ruled at 0002-REVIEW.

## Live PROVISIONAL tags
- **`PROVISIONAL(Q-005)`** → `src/engine/formula/ast.ts`. Question: what does `formula/ast.ts`
  contain before Phase 1's real grammar exists? Provisional choice: a one-variant `FormulaAst`
  (`ReferenceNode` only, representing a binding — §5.1's "degenerate formula `= other.slot`").
  Reversible; resolve/remove the tag when Phase 1 actually builds the formula engine and widens
  this union for real, per Q-005's writeup in OPEN_QUESTIONS.md.

Open questions: **Q-001, Q-002** (Phase 3, deferred). **Q-004** (Phase 2, cell-ref case
normalisation). **Q-005** (this cycle, see above). **Q-003** is ANSWERED → D-007.

## Gotchas for the next model

- **`GraphObject` (in `graph/node.ts`), not `Object`** — the brief's vocabulary word is
  "object," but `Object` is TypeScript's global type. Keep saying "object" in prose/comments;
  the TS identifier is `GraphObject` for exactly one reason (avoiding shadowing), not a
  synonym drift PROCESS_BRIEF §5.1 would otherwise forbid.
- **`address.ts` and `graph/node.ts` have a type-only circular reference**, resolved cleanly:
  `graph/node.ts` type-imports `Address`/`AddressableObject` from `address.ts` (erased at
  runtime, since it's `import type`), while `address.ts` value-imports `TABLE_TYPE` and
  type-imports `ObjectType` from `graph/node.ts` (a real runtime import). At runtime the
  dependency is one-directional: `address.ts` → `graph/node.ts`. If you add a VALUE import
  (not `import type`) from `address.ts` into `graph/node.ts`, you will create a real circular
  module dependency — don't, without checking it actually resolves.
- **`Value`/`Point`/`ErrorValue` live in `graph/node.ts`.** Don't redefine them elsewhere
  (formula evaluation, geometry, script stubs) — import from here.
- **`ObjectType` is seeded from PROJECT_BRIEF §5.10's eight command names, plus `value`/`add`
  for Phase 0 fixtures.** `explode` (D-007) is assumed to change a preset's type to
  `"polyline"` specifically (§5.5 calls polyline "editable path, per-vertex literal slots") —
  this is a documented interpretation, not something the brief states in as many words. Flag
  it if `primitives/schema.ts` reveals it's wrong.
- `resolveSlot` (`graph/node.ts`) returns `undefined` on a stale reference or missing slot, not
  an `ErrorValue`. Turning that into `#REF` is the caller's job (formula evaluation, most
  likely) — this file stays a pure lookup with no opinion on error semantics.
- Node.js and Git are installed (LTS / 2.55, via winget) but were absent at cycle 0001's start.
  Each PowerShell tool call is a fresh process — re-derive `$env:Path` from the Machine/User
  environment variables if `node`/`npm`/`git` seem missing.
