# STATUS — as of entry 0009-graph-cycles

STATE: BLOCKED — awaiting review (0009 fired §6.2/§6.3; tree itself is GREEN —
compiles under both tsconfigs, all tests pass — 97/97, 0 skipped)

Current phase: 0 — Graph core (headless, no pixels)
Phase 0 acceptance criterion (quoted from PROJECT_BRIEF §6):
> you can build a graph in a unit test, bind slots, mutate a value and watch it propagate
> in correct topological order *including through derived slots*; a cycle is rejected with
> the offending slots named **and prior state is provably unchanged**; deleting a slot with
> dependents is rejected; and a document round-trips to JSON and back identically.
Status: partial. Addressing, the slot/object/edge data model, the derived-slot
declaration mechanism, and cycle DETECTION (not yet rejection) are built.
**Nothing propagates, evaluates, or mutates yet** — that needs `graph/eval.ts`,
`mutation.ts`, and `document.ts`, none of which exist.

Last review: **0008-REVIEW-phase0, verdict ACCEPT WITH EDITS**. **Cycle 0009
(this one) is unreviewed — awaiting review before `graph/eval.ts` begins.**

## Built and reviewed
- Project scaffold: `package.json`, `tsconfig.json` (strict), `tsconfig.engine.json`
  (DOM-free, D-006), `vite.config.ts`, `index.html`, Vitest via `npm test`.
- `src/main.ts` — placeholder entry point.
- `src/engine/address.ts` + tests (§5.2) — 44 tests. Two-layer name/ID scheme, naming rules,
  D-005 surface↔stored path mapping keyed on the A1 form (D-008), exact inverses.
- `src/engine/graph/node.ts` + tests (§5.1) — 20 tests. `Value`/`Point`/`ErrorValue`,
  `isErrorValue` (D-014), `ObjectType` (D-009/D-011), `TABLE_TYPE`, the three slot kinds,
  `GraphObject`, `slotKey`/`getSlot`/`resolveSlot`.
- `src/engine/graph/edge.ts` + tests (§5.1) — 6 tests (2 pre-existing + 4 from 0009).
  `Edge` (`sourceSlot`/`dependentSlot`).
- `src/engine/formula/ast.ts` — minimal one-variant `FormulaAst`. **`PROVISIONAL(Q-005)` —
  choice approved at 0006-REVIEW; proceed on it.** Phase 1 *widens* this union, never
  replaces it.
- `src/engine/primitives/schema.ts` + tests (§5.1) — 17 tests. The derived-slot
  declaration mechanism: `DerivedSlotDependencies` (`static`/`dynamic`),
  `DerivedSlotCompute`, `DerivedSlotSchema`, `ObjectSchema`,
  `derivedSlotDependencyAddresses`, `getObjectSchema`, `findDerivedSlotSchema`. Real
  entries for `value` and `add` (D-011). No entries yet for the eight product
  primitives; they belong to Phases 3–6.

## Built, not yet reviewed
- `src/engine/graph/edge.ts`'s new export, `addressKey(address): string` (+ 4 tests
  in `edge.test.ts`) — entry 0009. A canonical string key for a full `Address`
  (objectId + `slotKey(path)`), for graph-traversal `Map`/`Set` keys. The
  document-wide counterpart to `node.ts`'s `slotKey`, which only canonicalizes a
  path within one already-known object.
- `src/engine/graph/cycles.ts` + tests (§5.1 step 5) — 10 tests, entry 0009.
  `CycleCheckResult` / `detectCycle(edges)`: naive DFS over an `Edge[]`
  (white/gray/black coloring), following `sourceSlot -> dependentSlot` arcs,
  reporting the first cycle found as an ordered `Address[]`. Does NOT take an
  object list and does NOT format a rejection message — that's `mutation.ts`'s
  job (resolving names via `address.ts`'s `formatAddress`). Reports only the
  first cycle found, not every cycle a malformed edge set might contain.

## Not started
In brief §7 order, remaining:
1. `src/engine/graph/eval.ts` (naive full topo re-eval over all three slot kinds,
   derived slots inline, **no post-pass**) — **next**
2. `src/engine/mutation.ts` (clone / validate / commit + journal)
3. `src/engine/document.ts` round-trip test (including `nextObjectId`, D-002)

Then Phase 1 (formula engine). Do not start before Phase 0's criterion passes and is reviewed.

## Next slice (recommended)

Do not start `graph/eval.ts` until 0009 is reviewed — it is the module D-013
binds most directly (a compute function's `read` callback must resolve only
its declared dependencies, returning `#REF` for anything else), so a finding
there should land before code is written against a shape the reviewer hasn't
seen yet.

Once reviewed, `graph/eval.ts`: topological sort over an ALREADY-ACYCLIC
`Edge[]` (mutation.ts's step 5, using `cycles.ts`, runs before this — `eval.ts`
does not need to re-detect cycles, only order and evaluate), then evaluate
every slot in that order:

- Literal slots return their stored value.
- Formula slots evaluate their AST (only `ReferenceNode` exists yet — a bare
  reference resolves to its target's already-evaluated value).
- Derived slots call their schema's `compute` (`primitives/schema.ts`).
- **Derived slots are evaluated INSIDE the pass**, interleaved with the other
  kinds in topological order. No `recompute()`, no second pass — the single
  most important thing in this cycle (§5.1, PROCESS_BRIEF §9).
- **D-013, binding** — the `read` callback passed to `compute` MUST resolve
  only that slot's declared dependency addresses (from
  `derivedSlotDependencyAddresses`) and MUST return `#REF` for anything else.
  Test it explicitly: a compute reading an undeclared address gets `#REF`.
- **Call `derivedSlotDependencyAddresses` at edge-derivation time only**,
  never from inside the evaluation loop (Rule 6) — `eval.ts` consumes an
  edge set that already reflects this; it does not call it itself mid-pass.
- Evaluation errors produce `ErrorValue`s and do **not** roll back anything
  (§5.1 step 7).
- **D-014** — import `isErrorValue` from `graph/node.ts`; do not write a local
  copy.
- **L-9 (from 0008-REVIEW)** — when the Phase 0 acceptance fixture arrives,
  its `add` inputs MUST be **formula** slots (§6). Copy `graph/node.test.ts`'s
  fixture, not `schema.test.ts`'s (which uses literals).
- **Use `graph/edge.ts`'s `addressKey`** for any Map/Set keying — do not
  reimplement it (same reasoning as D-014).

## Known problems
- **L-6** — `TABLE_TYPE`'s `: ObjectType` annotation widens it from the literal `"table"`.
  Fold in an `as const` next time `node.ts` is open. Not worth its own commit.
- **L-7 → covered by D-010** — `slotKey`'s collision-freedom holds for paths that came through
  `parseAddress`, but nothing enforces it for hand-built keys. D-010 closes this by discipline.
- **L-8** — `ObjectSchema.type` duplicates its `SCHEMAS` registry key with nothing
  checking they agree. Cheapest fix: a test iterating the registry asserting
  `getObjectSchema(t)?.type === t`. Fold in when `schema.ts` is next open.
- **L-9** — the `add` fixture's slot *kinds* differ between test files:
  `node.test.ts` uses **formula** inputs (per §6), `schema.test.ts` uses **literal**.
  Harmless where it sits; the "Next slice" constraint above is where it matters.
- **`cycles.ts`'s reported cycle can start at any member** (whichever the DFS
  reaches first), not necessarily the slot the user most recently edited
  (entry 0009, "Where I got stuck"). Correct either way — every slot IS named —
  but a future rejection-message design that wants a specific leading slot
  would need to impose that ordering itself.
- **`document.ts` forward constraint** — `DerivedSlot.value` is required, but §5.11 says
  derived values are never serialized. Load must construct derived slots with a placeholder
  (`null` is the obvious choice) before the evaluation pass. Make it explicit when you get there.
- The table/`cells` mapping in `address.ts` is still hardcoded — move it onto the schema
  registry once `schema.ts` can express slot families (D-005 §4, D-009). Still needs the
  full slot-set declaration `schema.ts` currently defers (see 0008-REVIEW §8's answer to Q1:
  it belongs in `schema.ts`, not `mutation.ts`, whenever it becomes concrete).
- `npm run typecheck` does not cover config files themselves. Low severity, unchanged.
- `npm audit`: 5 vulnerabilities in dev deps, not runtime. Out of scope.
- **SETTLED, do not re-raise:** the flat `claude/` layout (0002-REVIEW); extracting the shared
  vocabulary out of `graph/node.ts` to break the type-level mutual reference (0006-REVIEW §6);
  unifying `isErrorValue` with `address.ts`'s `isAddressError` (D-014).

## Live PROVISIONAL tags
- **`PROVISIONAL(Q-005)`** → `src/engine/formula/ast.ts`. Choice **approved** at 0006-REVIEW —
  proceed on it; it is not a live risk. Remove the tags and mark Q-005 `ANSWERED` when Phase 1
  builds the real grammar and widens `FormulaAst`.

Open questions: **Q-001, Q-002** (Phase 3, deferred). **Q-004** (Phase 2, cell-ref case
normalisation). **Q-005** (Phase 1, provisional choice approved). **Q-003** ANSWERED → D-007.
None raised at 0009.

## Gotchas for the next model

- **`GraphObject`, not `Object`** — naming-collision workaround only; the vocabulary word in
  prose is still "object."
- **`address.ts` ↔ `graph/node.ts` reference each other's TYPES**, but the runtime dependency
  is one-directional (`address.ts` → `graph/node.ts`) because `node.ts` uses `import type`,
  which is fully erased. **If you add a value import (not `import type`) from `address.ts`
  into `graph/node.ts` you create a real runtime cycle.** Don't, without checking it resolves.
  (`graph/edge.ts` now also value-imports `slotKey` from `node.ts` — one-directional and safe,
  since `node.ts` does not import `edge.ts`.)
- **`Value`/`Point`/`ErrorValue`/`isErrorValue` live in `graph/node.ts`.** Import them; don't
  redefine (D-014).
- **Slot keys come only from `slotKey()`** (D-010); **full-document graph-node keys come only
  from `addressKey()`** (`graph/edge.ts`, new at 0009) — don't reimplement either.
- **`ObjectType` includes `value`/`add`** (D-011) — fixture types are first-class in the data
  model; only the §5.10 command registry gates what users can create.
- **`explode` sets type to `polyline`** (D-012). Do not "fix" it by renaming.
- `resolveSlot`/`getObjectSchema`/`findDerivedSlotSchema` return `undefined` on a miss, not an
  `ErrorValue`. Turning that into `#REF` is the caller's job.
- **The schema registry stores FUNCTIONS and that is correct** — the prohibition on closures
  is on `GraphObject`/`Slot`/document state, not on this module-level registry (§5.1 requires
  the schema to hold "its compute function"). Checked at 0008-REVIEW §2. Don't try to "fix" it.
- **`derivedSlotDependencyAddresses` is the ONLY place a schema's static dependency paths
  become full `Address`es, or a dynamic resolver gets called** — call it during edge
  derivation (mutation step 3), never from inside the topological evaluation pass (Rule 6).
- **`add`'s slot names are `in.a`/`in.b`/`out.result`** in both `graph/node.test.ts` and
  `schema.test.ts`. The slot *kinds* differ between those two files — see L-9.
- **New (0009): `detectCycle` follows `sourceSlot -> dependentSlot` arcs.** `eval.ts`'s
  topological sort should use the SAME direction (process sourceSlot before dependentSlot) —
  they are the same graph, walked for two different purposes.
- **New (0009): `detectCycle` takes no object list and produces no message** — it returns raw
  `Address[]`. Formatting "slot X depends on slot Y" text is `mutation.ts`'s job, via
  `address.ts`'s `formatAddress`.
- Node.js and Git are installed (LTS / 2.55, via winget). Each PowerShell tool call is a fresh
  process — re-derive `$env:Path` from the Machine/User environment variables if they seem
  missing (`$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")`). The Bash tool's `npm` is not on PATH at all — use PowerShell for `npm`/`npx`.
