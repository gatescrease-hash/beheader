# STATUS — as of entry 0010-REVIEW-phase0

STATE: GREEN — compiles under both tsconfigs, all tests pass (98/98, 0 skipped, 0 `.only`).

Current phase: 0 — Graph core (headless, no pixels)
Phase 0 acceptance criterion (quoted from PROJECT_BRIEF §6):
> you can build a graph in a unit test, bind slots, mutate a value and watch it propagate
> in correct topological order *including through derived slots*; a cycle is rejected with
> the offending slots named **and prior state is provably unchanged**; deleting a slot with
> dependents is rejected; and a document round-trips to JSON and back identically.
Status: partial. Addressing, the slot/object/edge data model, the derived-slot declaration
mechanism, and cycle DETECTION are built. **Nothing propagates, evaluates, mutates, or is
rejected yet** — that needs `graph/eval.ts`, `mutation.ts`, `document.ts`, none of which exist.

Last review: **0010-REVIEW-phase0, verdict ACCEPT WITH EDITS. `graph/eval.ts` may begin.**

## Built and reviewed
- Project scaffold: `package.json`, `tsconfig.json` (strict, `noUncheckedIndexedAccess`),
  `tsconfig.engine.json` (DOM-free, D-006), `vite.config.ts`, `index.html`, Vitest.
- `src/main.ts` — placeholder entry point.
- `src/engine/address.ts` + tests (§5.2) — 44 tests. Two-layer name/ID scheme, naming rules,
  D-005 surface↔stored path mapping keyed on the A1 form (D-008), exact inverses.
- `src/engine/graph/node.ts` + tests (§5.1) — 20 tests. `Value`/`Point`/`ErrorValue`,
  `isErrorValue` (D-014), `ObjectType`/`TABLE_TYPE` (D-009/D-011), the three slot kinds,
  `GraphObject`, `slotKey`/`getSlot`/`resolveSlot`.
- `src/engine/graph/edge.ts` + tests (§5.1) — 6 tests. `Edge` (`sourceSlot`/`dependentSlot`)
  and `addressKey(address)`, the document-wide `Map`/`Set` key (objectId + `slotKey(path)`,
  joined `"::"`). **Internal-only — D-015.**
- `src/engine/formula/ast.ts` — minimal one-variant `FormulaAst`. **`PROVISIONAL(Q-005)` —
  choice approved at 0006-REVIEW; proceed on it.** Phase 1 *widens* this union, never
  replaces it.
- `src/engine/primitives/schema.ts` + tests (§5.1) — 17 tests. The derived-slot declaration
  mechanism: `DerivedSlotDependencies` (`static`/`dynamic`), `DerivedSlotCompute`,
  `DerivedSlotSchema`, `ObjectSchema`, `derivedSlotDependencyAddresses`, `getObjectSchema`,
  `findDerivedSlotSchema`. Real entries for `value`/`add` (D-011); the eight product primitives
  belong to Phases 3–6.
- `src/engine/graph/cycles.ts` + tests (§5.1 step 5) — 11 tests. `CycleCheckResult` /
  `detectCycle(edges)`: naive from-scratch DFS over an `Edge[]` (white/gray/black) following
  `sourceSlot -> dependentSlot` arcs, returning the first cycle found as an ordered
  `Address[]`. Takes no object list and formats no message — `mutation.ts`'s job.

## Built, not yet reviewed
Nothing — the whole tree is reviewed as of 0010.

## Not started
In brief §7 order: (1) `graph/eval.ts` — naive full topo re-eval over all three slot kinds,
derived slots inline, **no post-pass** — **next**; (2) `mutation.ts` — clone / validate /
commit + journal; (3) `document.ts` + its round-trip test (including `nextObjectId`, D-002).
Then Phase 1 (formula engine) — not before Phase 0's criterion passes and is reviewed.

## Next slice (recommended)

`graph/eval.ts`. Topologically sort an **already-acyclic** `Edge[]` — `mutation.ts` step 5
runs `detectCycle` before step 7, so `eval.ts` does not re-detect cycles and must not add a
defensive check duplicating one — then evaluate every slot in that order:

- Literal slots return their stored value; derived slots call their schema's `compute`.
- Formula slots evaluate their AST (only `ReferenceNode` exists yet — a bare reference
  resolves to its target's already-evaluated value).
- **Derived slots are evaluated INSIDE the pass**, interleaved with the other kinds in
  topological order. No `recompute()`, no second pass — the single most important thing in
  this cycle (§5.1, PROCESS_BRIEF §9).
- **D-013, binding** — the `read` callback passed to `compute` MUST resolve only that slot's
  declared dependency addresses (from `derivedSlotDependencyAddresses`) and MUST return `#REF`
  for anything else. Test it: a compute reading an undeclared address gets `#REF`.
- **Call `derivedSlotDependencyAddresses` at edge-derivation time only**, never from inside
  the evaluation loop (Rule 6). `eval.ts` consumes an edge set that already reflects it.
- Evaluation errors produce `ErrorValue`s and do **not** roll back anything (§5.1 step 7).
- **D-014** — import `isErrorValue` from `graph/node.ts`; do not write a local copy.
- **Walk `sourceSlot -> dependentSlot`**, the same direction `detectCycle` does, and use
  `addressKey` (`graph/edge.ts`) for `Map`/`Set` keys — do not reimplement it.
- **L-9** — when the Phase 0 acceptance fixture arrives, its `add` inputs MUST be **formula**
  slots (§6). Copy `graph/node.test.ts`'s fixture, not `schema.test.ts`'s.

## Known problems
- **L-6** — `TABLE_TYPE`'s `: ObjectType` annotation widens it from the literal `"table"`. Fold
  in an `as const` next time `node.ts` is open.
- **L-7 → covered by D-010** — `slotKey`'s collision-freedom holds only for paths that came
  through `parseAddress`; hand-built keys are closed off by discipline, not by a check.
- **L-8** — `ObjectSchema.type` duplicates its `SCHEMAS` registry key with nothing checking they
  agree. Cheapest fix: a test iterating the registry asserting `getObjectSchema(t)?.type === t`.
- **L-10 (new, 0010)** — `addressKey`'s collision-freedom assumes object IDs match D-002's
  `obj_<n>`, but `objectId` is a bare `string` and nothing checks it. D-010's gap one layer
  up, held closed the same way. Note it in `document.ts`'s header when that lands.
- **L-11 / L-12 (new, 0010)** — two cosmetic items in `cycles.test.ts`'s `isGenuineCycle`; see
  0010-REVIEW §4. Fold in when the file is next open.
- **`detectCycle`'s reported cycle can start at any member** (whichever the DFS reaches
  first). Correct either way — every slot in the cycle IS named, and only those slots are
  (pinned by test at 0010) — but a message wanting a specific leading slot must order it.
- **Recursion depth** — `detectCycle` recurses once per slot along the longest dependency
  chain. Deliberate under Rule 5 and fine at the brief's scale, but `document.ts` can load an
  arbitrarily long chain from JSON. Watch it there; do not pre-optimise.
- **`document.ts` forward constraint** — `DerivedSlot.value` is required, but §5.11 says
  derived values are never serialized. Load must build derived slots with a placeholder
  (`null`) before the evaluation pass.
- The table/`cells` mapping in `address.ts` is still hardcoded — move it onto the schema
  registry once `schema.ts` can express slot families (D-005 §4, D-009), which needs the
  slot-set declaration `schema.ts` defers (0008-REVIEW §8: it belongs in `schema.ts`).
- `npm run typecheck` does not cover config files; `npm audit` reports 5 dev-dep
  vulnerabilities, none at runtime. Both low severity, unchanged, out of scope.
- **SETTLED, do not re-raise:** the flat `claude/` layout (0002-REVIEW); extracting the shared
  vocabulary out of `graph/node.ts` (0006-REVIEW §6); unifying `isErrorValue` with
  `isAddressError` (D-014).

## Live PROVISIONAL tags
- **`PROVISIONAL(Q-005)`** → `src/engine/formula/ast.ts`. Choice **approved** at 0006-REVIEW —
  proceed on it; not a live risk. Remove the tags and mark Q-005 `ANSWERED` when Phase 1 widens
  `FormulaAst`.

Open questions: **Q-001, Q-002** (Phase 3, deferred). **Q-004** (Phase 2, cell-ref case
normalisation). **Q-005** (Phase 1, approved). **Q-003** ANSWERED → D-007. None at 0009/0010.

## Gotchas for the next model
- **`GraphObject`, not `Object`** — a naming-collision workaround; the word in prose is still
  "object."
- **`address.ts` ↔ `graph/node.ts` reference each other's TYPES**, but the runtime dependency
  is one-directional (`address.ts` → `graph/node.ts`) because `node.ts` uses `import type`,
  which is fully erased. **A value import from `address.ts` into `graph/node.ts` creates a real
  runtime cycle.** `edge.ts` value-imports `slotKey` from `node.ts` — safe, one-directional.
- **`Value`/`Point`/`ErrorValue`/`isErrorValue` live in `graph/node.ts`** — import, never
  redefine (D-014).
- **Slot keys come only from `slotKey()`** (D-010); **full-document graph keys come only from
  `addressKey()`** (`graph/edge.ts`) — don't reimplement either. **Per D-015 neither ever
  reaches a user-facing string: slot names in messages come from `formatAddress`.
  `obj_3::cells.A1` in a rejection message is a defect.**
- **`ObjectType` includes `value`/`add`** (D-011) — fixture types are first-class in the data
  model; only the §5.10 command registry gates what users can create. **`explode` sets type to
  `polyline`** (D-012) — do not "fix" it by renaming.
- `resolveSlot`/`getObjectSchema`/`findDerivedSlotSchema` return `undefined` on a miss, not an
  `ErrorValue` — turning that into `#REF` is the caller's job.
- **`add`'s slots are `in.a`/`in.b`/`out.result`** in both test files; their *kinds* differ —
  see L-9.
- **The schema registry stores FUNCTIONS and that is correct** — the prohibition on closures is
  on `GraphObject`/`Slot`/document state, not on a module-level registry (0008-REVIEW §2).
  **Same answer for `cycles.ts`'s `Map`s** (0010-REVIEW §2): function-local traversal scratch
  keyed by string is not graph state. Don't try to "fix" either.
- **`derivedSlotDependencyAddresses` is the ONLY place static dependency paths become full
  `Address`es, or a dynamic resolver runs** — call it during edge derivation (mutation step 3),
  never inside the topological evaluation pass (Rule 6).
- **`detectCycle` follows `sourceSlot -> dependentSlot` arcs.** `eval.ts`'s topological sort
  uses the SAME direction (process sourceSlot before dependentSlot) — one graph, two purposes.
  It **takes no object list and produces no message** — it returns raw `Address[]`; formatting
  the rejection text is `mutation.ts`'s job, via `address.ts`'s `formatAddress`.
- **Test the case your fixtures do not happen to produce** (0010-REVIEW §6, D-008 before it).
  Ten passing tests did not distinguish "the cycle" from "the whole path the DFS walked." If
  one line carries a module's contract, build the fixture that would break it.
- Each PowerShell tool call is a fresh process — re-derive `$env:Path` from the Machine/User
  environment variables if it seems missing. The Bash tool's `npm` is not on PATH — use
  PowerShell for `npm`/`npx`.
