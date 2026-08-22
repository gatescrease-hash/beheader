# STATUS — as of entry 0008-REVIEW-phase0

STATE: GREEN (compiles under both tsconfigs, all tests pass — 83/83, 0 skipped)

Current phase: 0 — Graph core (headless, no pixels)
Phase 0 acceptance criterion (quoted from PROJECT_BRIEF §6):
> you can build a graph in a unit test, bind slots, mutate a value and watch it propagate
> in correct topological order *including through derived slots*; a cycle is rejected with
> the offending slots named **and prior state is provably unchanged**; deleting a slot with
> dependents is rejected; and a document round-trips to JSON and back identically.
Status: partial. Addressing, the slot/object/edge data model, and the derived-slot
declaration mechanism are complete and reviewed. **Nothing propagates, evaluates, or
mutates yet** — that needs `graph/cycles.ts`, `graph/eval.ts`, `mutation.ts`, and
`document.ts`, none of which exist.

Last review: **0008-REVIEW-phase0, verdict ACCEPT WITH EDITS** (3 small edits, listed
below). **`graph/cycles.ts` and `graph/eval.ts` may begin.**

## Built and reviewed
- Project scaffold: `package.json`, `tsconfig.json` (strict), `tsconfig.engine.json`
  (DOM-free, D-006), `vite.config.ts`, `index.html`, Vitest via `npm test`.
- `src/main.ts` — placeholder entry point.
- `src/engine/address.ts` + tests (§5.2) — 44 tests. Two-layer name/ID scheme, naming rules,
  D-005 surface↔stored path mapping keyed on the A1 form (D-008), exact inverses.
- `src/engine/graph/node.ts` + tests (§5.1) — 20 tests. `Value`/`Point`/`ErrorValue`,
  `isErrorValue` (D-014, moved here at 0008-REVIEW), `ObjectType` (D-009/D-011),
  `TABLE_TYPE`, the three slot kinds, `GraphObject`, `slotKey`/`getSlot`/`resolveSlot`.
- `src/engine/graph/edge.ts` + tests (§5.1) — 2 tests. `Edge` (`sourceSlot`/`dependentSlot`).
- `src/engine/formula/ast.ts` — minimal one-variant `FormulaAst`. **`PROVISIONAL(Q-005)` —
  choice approved at 0006-REVIEW; proceed on it.** Phase 1 *widens* this union, never
  replaces it.
- `src/engine/primitives/schema.ts` + tests (§5.1) — 17 tests, entry 0007, reviewed at
  0008. The derived-slot declaration mechanism: `DerivedSlotDependencies` (`static` =
  same-object paths / `dynamic` = a resolver returning full `Address`es),
  `DerivedSlotCompute`, `DerivedSlotSchema`, `ObjectSchema`,
  `derivedSlotDependencyAddresses`, `getObjectSchema`, `findDerivedSlotSchema`. Real
  entries for `value` (empty `derivedSlots` — meaningfully different from no entry) and
  `add` (`out.result` ← `in.a`/`in.b`). No entries yet for the eight product primitives;
  they belong to Phases 3–6. Deliberately does NOT declare a type's full slot set —
  see "Next slice" for where that lands.

## Built, not yet reviewed
Nothing. The tree is fully reviewed as of 0008.

## Not started
In brief §7 order, remaining:
1. `src/engine/graph/cycles.ts` (naive DFS) + `src/engine/graph/eval.ts` (naive full topo
   re-eval over all three slot kinds, derived slots inline, **no post-pass**) — **next**
2. `src/engine/mutation.ts` (clone / validate / commit + journal)
3. `src/engine/document.ts` round-trip test (including `nextObjectId`, D-002)

Then Phase 1 (formula engine). Do not start before Phase 0's criterion passes and is reviewed.

## Next slice (recommended)

`graph/cycles.ts` + `graph/eval.ts` — cleared to begin by 0008-REVIEW.

`cycles.ts`: naive DFS over an `Edge[]` (Rule 5 — from scratch on every mutation, no
incremental bookkeeping), rejecting on cycle and **naming every slot in the cycle**
(§5.1 step 5 — that message is explicit acceptance-criterion language, not a nicety).

`eval.ts`: topological sort, then evaluate every slot in order — literals return their
stored value, formula slots evaluate their AST (only `ReferenceNode` exists yet), derived
slots call their schema's `compute`. Six binding constraints:

- **Derived slots are evaluated INSIDE the pass**, interleaved with the other kinds in
  topological order. No `recompute()`, no second pass. This is the single most important
  thing in the cycle (§5.1, PROCESS_BRIEF §9).
- **D-013** — the `read` callback passed to `compute` MUST resolve only that slot's
  declared dependency addresses and MUST return `#REF` for anything else. Test it
  explicitly: a compute reading an undeclared address gets `#REF`, not a real value.
- **Call `derivedSlotDependencyAddresses` at edge-derivation time only**, never from
  inside the evaluation loop (Rule 6).
- **D-014** — import `isErrorValue` from `graph/node.ts`; do not write a local copy.
- **L-9** — when the Phase 0 acceptance fixture arrives, its `add` inputs MUST be
  **formula** slots (§6: "two formula input slots"). Copy `graph/node.test.ts`'s fixture,
  NOT `schema.test.ts`'s, which uses literals.
- Evaluation errors produce `ErrorValue`s and do **not** roll back anything (§5.1 step 7).

Note on the deferred slot-set declaration (0008-REVIEW §8, answering the implementer's
Q1): when `mutation.ts` needs to know what slots a new object gets, that declaration
belongs **in `schema.ts`**, not invented inside `mutation.ts`. Creation and mutation-step-4
validation will both want it; whichever needs it first must not declare its own.

## Known problems
- **L-6** — `TABLE_TYPE`'s `: ObjectType` annotation widens it from the literal `"table"`. No
  behavioural difference today (every use is an equality check); fold in an `as const` next
  time `node.ts` is open. Not worth its own commit.
- **L-7 → covered by D-010** — `slotKey`'s collision-freedom holds for paths that came through
  `parseAddress`, but nothing enforces it for hand-built keys. D-010 closes this by discipline.
- **L-8 (new, 0008-REVIEW)** — `ObjectSchema.type` duplicates its `SCHEMAS` registry key with
  nothing checking they agree; a copy-pasted entry could say `type: "polygon"` under the
  `rect` key silently. Cheapest fix is a test iterating the registry asserting
  `getObjectSchema(t)?.type === t`. Fold in when `schema.ts` is next open.
- **L-9 (new, 0008-REVIEW)** — the `add` fixture's slot *kinds* differ between test files:
  `node.test.ts` uses **formula** inputs (per §6), `schema.test.ts` uses **literal**.
  Harmless where it sits, but see the "Next slice" constraint — the acceptance fixture must
  use formula inputs.
- **`document.ts` forward constraint** — `DerivedSlot.value` is required, but §5.11 says
  derived values are never serialized. Load must construct derived slots with a placeholder
  (`null` is the obvious choice) before the evaluation pass. Make it explicit when you get there.
- The table/`cells` mapping in `address.ts` is still hardcoded — move it onto the schema
  registry once `schema.ts` can express slot families (D-005 §4, D-009). Now that
  `schema.ts` exists this is closer, but it needs the slot-set declaration that is still
  deferred (see "Next slice"), not just the derived-slot mechanism.
- `npm run typecheck` does not cover config files themselves. Low severity, unchanged.
- `npm audit`: 5 vulnerabilities in dev deps, not runtime. Out of scope.
- **SETTLED, do not re-raise:** the flat `claude/` layout (0002-REVIEW); extracting the shared
  vocabulary out of `graph/node.ts` to break the type-level mutual reference — considered and
  declined at 0006-REVIEW §6, with a stated trigger for revisiting (a module needing
  `ObjectType`/`Value` *without* needing `GraphObject`). Unifying `isErrorValue` with
  `address.ts`'s `isAddressError` — declined at D-014, different input and narrowed types.

## Live PROVISIONAL tags
- **`PROVISIONAL(Q-005)`** → `src/engine/formula/ast.ts`. Choice **approved** at 0006-REVIEW —
  proceed on it; it is not a live risk. Remove the tags and mark Q-005 `ANSWERED` when Phase 1
  builds the real grammar and widens `FormulaAst`.

Open questions: **Q-001, Q-002** (Phase 3, deferred). **Q-004** (Phase 2, cell-ref case
normalisation). **Q-005** (Phase 1, provisional choice approved). **Q-003** ANSWERED → D-007.
None raised at 0007; none newly answerable at 0008.

## Gotchas for the next model

- **`GraphObject`, not `Object`** — naming-collision workaround only; the vocabulary word in
  prose is still "object."
- **`address.ts` ↔ `graph/node.ts` reference each other's TYPES**, but the runtime dependency
  is one-directional (`address.ts` → `graph/node.ts`) because `node.ts` uses `import type`,
  which is fully erased — verified by transpiling both at 0006-REVIEW. **If you add a value
  import (not `import type`) from `address.ts` into `graph/node.ts` you create a real runtime
  cycle.** Don't, without checking it resolves.
- **`Value`/`Point`/`ErrorValue`/`isErrorValue` live in `graph/node.ts`.** Import them; don't
  redefine (D-014). `AddressError` is already structurally assignable to `ErrorValue` and
  `Value` — verified at 0006-REVIEW — so no formal tie is needed or wanted.
- **Slot keys come only from `slotKey()`** (D-010). Never write `"cells.A1"` as a key outside
  a test fixture.
- **`ObjectType` includes `value`/`add`** (D-011) — fixture types are first-class in the data
  model; only the §5.10 command registry gates what users can create.
- **`explode` sets type to `polyline`** (D-012). An object named `polygon_1` with type
  `polyline` afterwards is correct — do not "fix" it by renaming.
- `resolveSlot` returns `undefined` on a miss, not an `ErrorValue`. Turning that into `#REF` is
  the caller's job. **`schema.ts` follows the same convention**: `getObjectSchema` /
  `findDerivedSlotSchema` return `undefined` for "nothing declared here," not an error shape.
- **The schema registry stores FUNCTIONS (`compute`, `dynamic`'s `resolve`) and that is
  correct** — it looks like it violates "no closures in graph state," but the prohibition is
  on `GraphObject`/`Slot`/document state, and §5.1 explicitly requires the schema to hold
  "its compute function." Checked at 0008-REVIEW §2. Don't try to "fix" it.
- **`derivedSlotDependencyAddresses` is the ONLY place a schema's static dependency paths
  become full `Address`es (paired with the object's own id), or a dynamic resolver gets
  called.** Call it during edge derivation (mutation step 3) — never from inside the
  topological evaluation pass (Rule 6).
- **`add`'s slot names are `in.a`/`in.b`/`out.result`**, in both `graph/node.test.ts` and
  `schema.test.ts`. The slot *kinds* differ between those two files though — see L-9.
- Node.js and Git are installed (LTS / 2.55, via winget). Each PowerShell tool call is a fresh
  process — re-derive `$env:Path` from the Machine/User environment variables if they seem
  missing (`$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")`). The Bash tool's `npm` is not on PATH at all — use PowerShell for `npm`/`npx`.
