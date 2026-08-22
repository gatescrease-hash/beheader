# STATUS — as of entry 0011-graph-eval

STATE: GREEN — compiles under both tsconfigs, all tests pass (107/107, 0 skipped, 0 `.only`).

Current phase: 0 — Graph core (headless, no pixels)
Phase 0 acceptance criterion (quoted from PROJECT_BRIEF §6):
> you can build a graph in a unit test, bind slots, mutate a value and watch it propagate
> in correct topological order *including through derived slots*; a cycle is rejected with
> the offending slots named **and prior state is provably unchanged**; deleting a slot with
> dependents is rejected; and a document round-trips to JSON and back identically.
Status: partial. Addressing, the slot/object/edge data model, the derived-slot declaration
mechanism, cycle DETECTION, and full topological EVALUATION (including through derived slots)
are built and tested. **Nothing mutates, rejects, or round-trips yet** — that needs
`mutation.ts` and `document.ts`, neither of which exist. `graph/eval.ts` is unreviewed —
see below.

Last review: **0010-REVIEW-phase0, verdict ACCEPT WITH EDITS. `graph/eval.ts` may begin.**
Cycle 0011 (`graph/eval.ts`) has not yet been reviewed — see "Built, not yet reviewed."

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
- `src/engine/graph/eval.ts` + tests (§5.1 step 7) — 9 tests, cycle 0011. `evaluate(objects,
  edges) => readonly GraphObject[]`: naive full topological evaluation (DFS postorder
  reversal, same direction/family as `cycles.ts`) over an edge set ASSUMED already acyclic
  (does not re-run `detectCycle`). Evaluates all three slot kinds inside one pass — literal
  unchanged, formula via Phase 0's bare-`ReferenceNode` AST, derived via schema `compute` —
  with D-013's read-restriction enforced from the given `edges` (never by re-calling
  `derivedSlotDependencyAddresses`). Demonstrates the §6 value/add fixture propagating
  end-to-end, including a two-object derived→formula→derived chain. **Trigger-2/3/9 file
  (`graph/*`, new engine file, 561-line diff) — REVIEW: REQUIRED, see entry 0011.**

## Not started
In brief §7 order: (1) `mutation.ts` — clone / validate / commit + journal, wiring
`graph/cycles.ts` + `graph/eval.ts` together per §5.1's 8-step loop — **next**; (2)
`document.ts` + its round-trip test (including `nextObjectId`, D-002). Then Phase 1
(formula engine) — not before Phase 0's criterion passes and is reviewed.

## Next slice (recommended)

`mutation.ts`. This is the module that actually assembles the 8-step loop (§5.1) out of the
pieces that already exist: deep-clone the document (stage), apply the requested operation(s)
to the clone, **re-derive the edge set** (walk every object's formula-slot ASTs via
`ReferenceNode` plus every schema's derived-slot dependencies via
`derivedSlotDependencyAddresses` — this is the one piece of edge derivation that does not
exist as reusable code yet, since `eval.ts` and `cycles.ts` both only CONSUME an `Edge[]`,
neither builds one), validate integrity (§5.1.1: no edge may point at a nonexistent slot),
run `detectCycle` and reject on a hit (formatting the message via `address.ts`'s
`formatAddress` — **never** `addressKey`, per D-015), then call `evaluate` and commit. Start
narrow: a single `setLiteral`-shaped operation plus the batch form (§5.1 requires batch from
day one), proven against the `value`/`add` fixture — a full command surface is Phase 3.

## Known problems
- **L-6** — `TABLE_TYPE`'s `: ObjectType` annotation widens it from the literal `"table"`. Fold
  in an `as const` next time `node.ts` is open.
- **L-7 → covered by D-010** — `slotKey`'s collision-freedom holds only for paths that came
  through `parseAddress`; hand-built keys are closed off by discipline, not by a check.
- **L-8** — `ObjectSchema.type` duplicates its `SCHEMAS` registry key with nothing checking they
  agree. Cheapest fix: a test iterating the registry asserting `getObjectSchema(t)?.type === t`.
- **L-10** — `addressKey`'s collision-freedom assumes object IDs match D-002's `obj_<n>`, but
  `objectId` is a bare `string` and nothing checks it. Note it in `document.ts`'s header when
  that lands — `document.ts` is the module that will own `nextObjectId` allocation (D-002).
- **L-11 / L-12** — two cosmetic items in `cycles.test.ts`'s `isGenuineCycle`; see
  0010-REVIEW §4. Fold in when the file is next open.
- **`detectCycle`'s reported cycle can start at any member** (whichever the DFS reaches
  first). Correct either way, but a message wanting a specific leading slot must order it.
- **Recursion depth** — both `detectCycle` (cycles.ts) and `evaluate`'s topological-order DFS
  (eval.ts, new this cycle) recurse once per slot along the longest dependency chain.
  Deliberate under Rule 5 and fine at the brief's scale, but `document.ts` can load an
  arbitrarily long chain from JSON. Watch it there; do not pre-optimise either file.
- **`document.ts` forward constraint** — `DerivedSlot.value` is required, but §5.11 says
  derived values are never serialized. Load must build derived slots with a placeholder
  (`null`) before the evaluation pass — `eval.ts`'s `evaluate` is exactly what that pass calls.
- **`mutation.ts` forward constraint (new, 0011)** — edge derivation (mutation step 3) is NOT
  reusable code yet. `eval.ts` and `cycles.ts` both consume an already-built `Edge[]`; the walk
  over every formula AST's `ReferenceNode` plus every schema's `derivedSlotDependencyAddresses`
  call has to be written fresh in `mutation.ts`. Budget for it as real scope in that cycle, not
  a one-line wiring step.
- The table/`cells` mapping in `address.ts` is still hardcoded — move it onto the schema
  registry once `schema.ts` can express slot families (D-005 §4, D-009), which needs the
  slot-set declaration `schema.ts` defers (0008-REVIEW §8: it belongs in `schema.ts`).
- `npm run typecheck` does not cover config files; `npm audit` reports 5 dev-dep
  vulnerabilities, none at runtime. Both low severity, unchanged, out of scope.
- **SETTLED, do not re-raise:** the flat `claude/` layout (0002-REVIEW); extracting the shared
  vocabulary out of `graph/node.ts` (0006-REVIEW §6); unifying `isErrorValue` with
  `isAddressError` (D-014); reconstructing a path array from a `GraphObject.slots` key
  (0011 — there is no sanctioned inverse of `slotKey`; match derived-slot schema entries by
  re-deriving their OWN key instead, per `eval.ts`'s `findDerivedSlotSchemaByKey`).

## Live PROVISIONAL tags
- **`PROVISIONAL(Q-005)`** → `src/engine/formula/ast.ts`, and now also `src/engine/graph/eval.ts`
  (its `evaluateReference` function, which assumes `FormulaAst` has exactly one variant).
  Choice **approved** at 0006-REVIEW — proceed on it; not a live risk. Remove the tags and mark
  Q-005 `ANSWERED` when Phase 1 widens `FormulaAst` and replaces `evaluateReference` with a real
  `formula/eval.ts`.

Open questions: **Q-001, Q-002** (Phase 3, deferred). **Q-004** (Phase 2, cell-ref case
normalisation). **Q-005** (Phase 1, approved). **Q-003** ANSWERED → D-007. None raised at 0011.

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
  `addressKey()`** (`graph/edge.ts`) — don't reimplement either. **There is no sanctioned
  inverse of `slotKey`** — if you need to know whether a `GraphObject.slots` key matches a
  schema-declared path, re-derive the KEY from the schema's path and compare keys (as
  `eval.ts`'s `findDerivedSlotSchemaByKey` does); do not split the stored key back into a path
  array. Per D-015 neither key ever reaches a user-facing string: slot names in messages come
  from `formatAddress`. `obj_3::cells.A1` in a rejection message is a defect.
- **`ObjectType` includes `value`/`add`** (D-011) — fixture types are first-class in the data
  model; only the §5.10 command registry gates what users can create. **`explode` sets type to
  `polyline`** (D-012) — do not "fix" it by renaming.
- `resolveSlot`/`getObjectSchema`/`findDerivedSlotSchema` return `undefined` on a miss, not an
  `ErrorValue` — turning that into `#REF` is the caller's job. **`eval.ts` is the first place
  this actually happens**: a dangling formula reference or a schema-less derived slot becomes
  `#REF` inside `evaluate`, never a thrown error or a bare `undefined` in the result.
- **`add`'s slots are `in.a`/`in.b`/`out.result`** in all three test files now (`node.test.ts`,
  `schema.test.ts`, `eval.test.ts`); their *kinds* differ by file — `eval.test.ts`'s fixture
  uses genuine `formula` slots with a `ReferenceNode` AST, matching §6's "two formula input
  slots" exactly (L-9, now resolved).
- **The schema registry stores FUNCTIONS and that is correct** — the prohibition on closures is
  on `GraphObject`/`Slot`/document state, not on a module-level registry (0008-REVIEW §2).
  **Same answer for `cycles.ts`'s and `eval.ts`'s `Map`s/`Set`s** (0010-REVIEW §2): function-
  local traversal scratch keyed by string is not graph state. Don't try to "fix" any of them.
- **`derivedSlotDependencyAddresses` is the ONLY place static dependency paths become full
  `Address`es, or a dynamic resolver runs** — call it during edge derivation (mutation step 3),
  never inside the topological evaluation pass (Rule 6). **`eval.ts` does NOT call it** — a
  derived slot's read-restriction is computed by filtering the `Edge[]` `eval.ts` is handed,
  which `mutation.ts` will have built using that function already.
- **`detectCycle` follows `sourceSlot -> dependentSlot` arcs; so does `eval.ts`'s topological
  sort** — one graph, two purposes, same direction. `cycles.ts` takes no object list and
  produces no message — it returns raw `Address[]`; formatting the rejection text is
  `mutation.ts`'s job, via `address.ts`'s `formatAddress`. **`eval.ts` assumes its input is
  already acyclic and does not re-check** — `mutation.ts` must call `detectCycle` (step 5)
  before calling `evaluate` (step 7), never the reverse and never neither.
- **Test the case your fixtures do not happen to produce** (0010-REVIEW §6, D-008 before it).
  Ten passing tests did not distinguish "the cycle" from "the whole path the DFS walked." If
  one line carries a module's contract, build the fixture that would break it. (`eval.ts`'s
  D-013 test follows the same lesson: it doesn't mock a malicious `compute` function, it feeds
  the real, well-behaved `add` compute an under-declared `edges` set and lets the existing code
  path expose the gap.)
- Each PowerShell tool call is a fresh process — re-derive `$env:Path` from the Machine/User
  environment variables if it seems missing. The Bash tool's `npm` is not on PATH — use
  PowerShell for `npm`/`npx`.
