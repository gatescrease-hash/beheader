# STATUS — as of entry 0006-REVIEW-phase0

STATE: GREEN (compiles under both tsconfigs, all tests pass)

Current phase: 0 — Graph core (headless, no pixels)
Phase 0 acceptance criterion (quoted from PROJECT_BRIEF §6):
> you can build a graph in a unit test, bind slots, mutate a value and watch it propagate
> in correct topological order *including through derived slots*; a cycle is rejected with
> the offending slots named **and prior state is provably unchanged**; deleting a slot with
> dependents is rejected; and a document round-trips to JSON and back identically.
Status: partial. Addressing and the slot/object/edge data model are complete and reviewed.
**Nothing propagates, evaluates, or mutates yet** — that is exactly what the criterion needs
and what the remaining Phase 0 modules provide.

Last review: **0006-REVIEW-phase0, verdict ACCEPT** (no edits). `primitives/schema.ts` may begin.

## Built and reviewed
- Project scaffold: `package.json`, `tsconfig.json` (strict), `tsconfig.engine.json`
  (DOM-free, D-006), `vite.config.ts`, `index.html`, Vitest via `npm test`.
- `src/main.ts` — placeholder entry point.
- `src/engine/address.ts` + tests (§5.2) — 44 tests. Two-layer name/ID scheme, naming rules,
  D-005 surface↔stored path mapping keyed on the A1 form (D-008), exact inverses.
- `src/engine/graph/node.ts` + tests (§5.1) — 15 tests. `Value`/`Point`/`ErrorValue`,
  `ObjectType` (D-009/D-011), `TABLE_TYPE`, the three slot kinds, `GraphObject`,
  `slotKey`/`getSlot`/`resolveSlot`.
- `src/engine/graph/edge.ts` + tests (§5.1) — 2 tests. `Edge` (`sourceSlot`/`dependentSlot`).
- `src/engine/formula/ast.ts` — minimal one-variant `FormulaAst`. **`PROVISIONAL(Q-005)` —
  choice approved at 0006-REVIEW; proceed on it.** Phase 1 *widens* this union, never
  replaces it.

## Built, not yet reviewed
Nothing. The tree is fully reviewed as of 0006.

## Not started
In brief §7 order, remaining:
1. `src/engine/primitives/schema.ts` (derived-slot declaration mechanism) — **next**
2. `src/engine/graph/cycles.ts` (naive DFS) + `src/engine/graph/eval.ts` (naive full topo
   re-eval over all three slot kinds, derived slots inline, **no post-pass**)
3. `src/engine/mutation.ts` (clone / validate / commit + journal)
4. `src/engine/document.ts` round-trip test (including `nextObjectId`, D-002)

Then Phase 1 (formula engine). Do not start before Phase 0's criterion passes and is reviewed.

## Next slice (recommended)

`src/engine/primitives/schema.ts` — §5.1's "Each object type's schema declares, for every
derived slot: its address path, its dependencies, and its compute function."

Five binding constraints from review:
- **D-011** — provide real schema entries for `value` and `add`. `add` needs a genuine derived
  `out.result`; it is the fixture PROJECT_BRIEF §6 uses to prove derived slots evaluate inside
  the topological pass. Do not treat the fixture types as second-class.
- **D-010** — declare slots by **path** (`["cells","A1"]`), never by a hand-built key string.
- **Support the dynamic dependency form**, not just static lists. §5.1 names two cases that
  require it (`text.resolvedContent`, `script.out.*`). Dynamic dependency functions are
  evaluated during edge derivation, never during evaluation — that is what keeps Rule 6 true.
- **No `recompute()` phase, ever.** Derived slots are evaluated *inside* the topological pass.
  A post-pass makes every formula reading a derived value permanently one step stale.
- **D-008's lesson** — test the unspecified cases, not just the brief's examples.

## Known problems
- **L-6** — `TABLE_TYPE`'s `: ObjectType` annotation widens it from the literal `"table"`. No
  behavioural difference today (every use is an equality check); fold in an `as const` next
  time `node.ts` is open. Not worth its own commit.
- **L-7 → covered by D-010** — `slotKey`'s collision-freedom holds for paths that came through
  `parseAddress`, but nothing enforces it for hand-built keys. D-010 closes this by discipline.
- **`document.ts` forward constraint** — `DerivedSlot.value` is required, but §5.11 says
  derived values are never serialized. Load must construct derived slots with a placeholder
  (`null` is the obvious choice) before the evaluation pass. Make it explicit when you get there.
- The table/`cells` mapping in `address.ts` is still hardcoded — move it onto the schema
  registry once `schema.ts` can express slot families (D-005 §4, D-009).
- `npm run typecheck` does not cover config files themselves. Low severity, unchanged.
- `npm audit`: 5 vulnerabilities in dev deps, not runtime. Out of scope.
- **SETTLED, do not re-raise:** the flat `claude/` layout (0002-REVIEW); extracting the shared
  vocabulary out of `graph/node.ts` to break the type-level mutual reference — considered and
  declined at 0006-REVIEW §6, with a stated trigger for revisiting (a module needing
  `ObjectType`/`Value` *without* needing `GraphObject`).

## Live PROVISIONAL tags
- **`PROVISIONAL(Q-005)`** → `src/engine/formula/ast.ts`. Choice **approved** at 0006-REVIEW —
  proceed on it; it is not a live risk. Remove the tags and mark Q-005 `ANSWERED` when Phase 1
  builds the real grammar and widens `FormulaAst`.

Open questions: **Q-001, Q-002** (Phase 3, deferred). **Q-004** (Phase 2, cell-ref case
normalisation). **Q-005** (Phase 1, provisional choice approved). **Q-003** ANSWERED → D-007.

## Gotchas for the next model

- **`GraphObject`, not `Object`** — naming-collision workaround only; the vocabulary word in
  prose is still "object."
- **`address.ts` ↔ `graph/node.ts` reference each other's TYPES**, but the runtime dependency
  is one-directional (`address.ts` → `graph/node.ts`) because `node.ts` uses `import type`,
  which is fully erased — verified by transpiling both at 0006-REVIEW. **If you add a value
  import (not `import type`) from `address.ts` into `graph/node.ts` you create a real runtime
  cycle.** Don't, without checking it resolves.
- **`Value`/`Point`/`ErrorValue` live in `graph/node.ts`.** Import them; don't redefine.
  `AddressError` is already structurally assignable to `ErrorValue` and `Value` — verified at
  0006-REVIEW — so no formal tie is needed or wanted.
- **Slot keys come only from `slotKey()`** (D-010). Never write `"cells.A1"` as a key outside
  a test fixture.
- **`ObjectType` includes `value`/`add`** (D-011) — fixture types are first-class in the data
  model; only the §5.10 command registry gates what users can create.
- **`explode` sets type to `polyline`** (D-012). An object named `polygon_1` with type
  `polyline` afterwards is correct — do not "fix" it by renaming.
- `resolveSlot` returns `undefined` on a miss, not an `ErrorValue`. Turning that into `#REF` is
  the caller's job.
- Node.js and Git are installed (LTS / 2.55, via winget). Each PowerShell tool call is a fresh
  process — re-derive `$env:Path` from the Machine/User environment variables if they seem
  missing.
