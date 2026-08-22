# STATUS — as of entry 0007-primitives-schema

STATE: BLOCKED — awaiting review (0007 fired escalation triggers §6.2/§6.3/§6.9;
tree itself is GREEN — compiles under both tsconfigs, all tests pass)

Current phase: 0 — Graph core (headless, no pixels)
Phase 0 acceptance criterion (quoted from PROJECT_BRIEF §6):
> you can build a graph in a unit test, bind slots, mutate a value and watch it propagate
> in correct topological order *including through derived slots*; a cycle is rejected with
> the offending slots named **and prior state is provably unchanged**; deleting a slot with
> dependents is rejected; and a document round-trips to JSON and back identically.
Status: partial. Addressing, the slot/object/edge data model, and the derived-slot
declaration mechanism are complete. **Nothing propagates, evaluates, or mutates
yet** — that needs `graph/cycles.ts`, `graph/eval.ts`, and `mutation.ts`, none of
which exist.

Last review: **0006-REVIEW-phase0, verdict ACCEPT** (no edits; cleared
`primitives/schema.ts` to begin). **Cycle 0007 (this one) is unreviewed —
awaiting review before `graph/cycles.ts`/`graph/eval.ts` begins.**

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
- `src/engine/primitives/schema.ts` + tests (§5.1) — 16 tests, entry 0007. The
  derived-slot declaration mechanism: `DerivedSlotDependencies` (`static`/
  `dynamic`), `DerivedSlotCompute`, `DerivedSlotSchema`, `ObjectSchema`,
  `derivedSlotDependencyAddresses`, `getObjectSchema`, `findDerivedSlotSchema`.
  Real entries for `value` (empty `derivedSlots`) and `add` (`out.result`,
  depending on `in.a`/`in.b`, matching the fixture already in
  `graph/node.test.ts`). No entries yet for the eight product primitives — see
  "Not started" below. Deliberately does NOT declare a type's full slot set
  (literal/formula slots + default kinds) — only derived slots, per §5.1's
  quoted sentence and STATUS's prior "Next slice" framing; flagged in the file's
  "NOT DONE HERE" for whoever builds `mutation.ts`'s object-creation path.

## Not started
In brief §7 order, remaining:
1. `src/engine/graph/cycles.ts` (naive DFS) + `src/engine/graph/eval.ts` (naive full topo
   re-eval over all three slot kinds, derived slots inline, **no post-pass**) — **next**
2. `src/engine/mutation.ts` (clone / validate / commit + journal)
3. `src/engine/document.ts` round-trip test (including `nextObjectId`, D-002)

Then Phase 1 (formula engine). Do not start before Phase 0's criterion passes and is reviewed.

## Next slice (recommended)

Do not start `graph/cycles.ts`/`graph/eval.ts` until 0007 is reviewed — cycles.ts
and eval.ts are exactly the two modules that consume `schema.ts`'s
`derivedSlotDependencyAddresses`/`getObjectSchema`, so a reviewer finding here
would otherwise need to be threaded through code already written against it.
Once reviewed: `graph/cycles.ts` (naive DFS over an `Edge[]`, naming every slot
in a detected cycle per §5.1 step 5) and `graph/eval.ts` (topological sort +
evaluate all three slot kinds — literal returns its value, formula evaluates
its AST via `formula/ast.ts`'s `ReferenceNode` only, derived calls its schema's
`compute` — with derived slots evaluated *inside* the pass, never in a
post-pass, per §5.1 and PROCESS_BRIEF §9's forbidden-moves list).

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
  registry once `schema.ts` can express slot families (D-005 §4, D-009). Now that
  `schema.ts` exists, this is concretely doable but was NOT done at 0007 (out of
  declared scope for that cycle — it only built the derived-slot mechanism, not a
  slot-family mechanism table addressing would need).
- **0007's under-specified corner (not chased further, see entry 0007)** — `add`'s
  compute function does not distinguish a literal `null` input from any other
  non-number, non-error input; both fall into `#TYPE`. Untested beyond "does not
  throw." Nothing currently writes `null` into `in.a`/`in.b`, so this is latent,
  not live.
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
None raised at 0007.

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
  the caller's job. **`schema.ts` follows the same convention**: `getObjectSchema` /
  `findDerivedSlotSchema` return `undefined` for "nothing declared here," not an error shape.
- **New (0007): `derivedSlotDependencyAddresses` is the ONLY place a schema's static
  dependency paths become full `Address`es (paired with the object's own id), or a
  dynamic resolver gets called.** `graph/eval.ts`'s edge-derivation step should call
  this once per derived slot per object, at step 3 of the mutation loop — never
  from inside the topological evaluation pass itself (Rule 6).
- **New (0007): `add`'s slot names are `in.a`/`in.b`/`out.result`**, matching the
  `graph/node.test.ts` fixture from cycle 0005. Don't rename them to something
  else without updating that fixture too — they are the same object shape in
  two files.
- Node.js and Git are installed (LTS / 2.55, via winget). Each PowerShell tool call is a fresh
  process — re-derive `$env:Path` from the Machine/User environment variables if they seem
  missing (`$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")`). The Bash tool's `npm` is not on PATH at all — use PowerShell for `npm`/`npx`.
