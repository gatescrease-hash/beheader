# STATUS — as of entry 0012-REVIEW-phase0

STATE: GREEN — compiles under both tsconfigs, all tests pass (108/108, 0 skipped, 0 `.only`).

Current phase: 0 — Graph core (headless, no pixels)
Phase 0 acceptance criterion (quoted from PROJECT_BRIEF §6):
> you can build a graph in a unit test, bind slots, mutate a value and watch it propagate
> in correct topological order *including through derived slots*; a cycle is rejected with
> the offending slots named **and prior state is provably unchanged**; deleting a slot with
> dependents is rejected; and a document round-trips to JSON and back identically.

Status: **partial — one of four clauses closed.** Treat it as a four-part gate:

1. Propagation in correct topological order, including through derived slots — **PASSING**,
   as of 0012-REVIEW's edit 1. Demonstrated by `graph/eval.test.ts::"propagates correctly
   with every object AND every slot declared in reverse dependency order"`, the one test
   that fails if the topological sort is removed. (Cycle 0011 claimed this clause on tests
   that all passed with no sort at all — see 0012-REVIEW §6 and **D-016**.)
2. Cycle rejected, offending slots named, prior state provably unchanged — **NOT YET**.
3. Deleting a slot with dependents is rejected — **NOT YET**.
4. Document round-trips to JSON identically — **NOT YET**.

Clauses 2–4 all need `mutation.ts` and `document.ts`, neither of which exists.

Last review: **0012-REVIEW-phase0, verdict ACCEPT WITH EDITS. `mutation.ts` may begin.**

## Built and reviewed
- Scaffold: `package.json`, `tsconfig.json` (strict, `noUncheckedIndexedAccess`),
  `tsconfig.engine.json` (DOM-free, D-006), `vite.config.ts`, `index.html`, Vitest,
  `src/main.ts` placeholder.
- `address.ts` + tests (§5.2) — 44 tests. Two-layer name/ID scheme, naming rules, D-005
  surface↔stored path mapping keyed on the A1 form (D-008), exact inverses.
- `graph/node.ts` + tests (§5.1) — 20 tests. `Value`/`Point`/`ErrorValue`, `isErrorValue`
  (D-014), `ObjectType`/`TABLE_TYPE` (D-009/D-011), the three slot kinds, `GraphObject`,
  `slotKey`/`getSlot`/`resolveSlot`.
- `graph/edge.ts` + tests (§5.1) — 6 tests. `Edge` (`sourceSlot`/`dependentSlot`) and
  `addressKey`, the document-wide `Map`/`Set` key. **Internal-only — D-015.**
- `formula/ast.ts` — minimal one-variant `FormulaAst`. **`PROVISIONAL(Q-005)`, approved at
  0006-REVIEW.** Phase 1 *widens* this union, never replaces it.
- `primitives/schema.ts` + tests (§5.1) — 17 tests. The derived-slot declaration mechanism:
  `DerivedSlotDependencies` (`static`/`dynamic`), `DerivedSlotCompute`, `DerivedSlotSchema`,
  `ObjectSchema`, `derivedSlotDependencyAddresses`, `getObjectSchema`, `findDerivedSlotSchema`.
  Real entries for `value`/`add` (D-011).
- `graph/cycles.ts` + tests (§5.1 step 5) — 11 tests. `detectCycle(edges)`: naive from-scratch
  DFS following `sourceSlot -> dependentSlot`, returning the first cycle as an ordered
  `Address[]`. Takes no object list and formats no message.
- `graph/eval.ts` + tests (§5.1 step 7) — **10 tests, reviewed at 0012.** `evaluate(objects,
  edges)`: naive full topological evaluation (DFS postorder reversal, same direction as
  `cycles.ts`) over an edge set ASSUMED already acyclic. All three slot kinds in ONE pass —
  no `recompute()` — with D-013's read-restriction enforced from the given `edges`.

## Not started
In brief §7 order: (1) `mutation.ts` — clone / validate / commit + journal, wiring
`graph/cycles.ts` + `graph/eval.ts` into §5.1's 8-step loop — **next**; (2) `document.ts` +
its round-trip test (including `nextObjectId`, D-002). Then Phase 1 (formula engine) — not
before Phase 0's criterion passes and is reviewed.

## Next slice (recommended)

`mutation.ts`, and **consider splitting edge derivation out as its own slice first** — the
last two cycles both gained from leaving the obvious next module alone. Edge derivation
(step 3) is genuinely unwritten code, not wiring: neither `eval.ts` nor `cycles.ts` builds an
`Edge[]`, both only consume one. It means walking every object's formula-slot ASTs for their
`ReferenceNode` addresses, plus calling `derivedSlotDependencyAddresses` for every
schema-declared derived slot.

Then the 8-step loop (§5.1): deep-clone (stage), apply, re-derive edges, validate integrity
(§5.1.1 — no edge may point at a nonexistent slot), `detectCycle` and reject on a hit (message
via `formatAddress`, **never** `addressKey` — D-015), then `evaluate` and commit. Start
narrow: one `setLiteral`-shaped operation plus the batch form (§5.1 requires batch from day
one), against the `value`/`add` fixture. A full command surface is Phase 3.

**D-016 binds this cycle hardest.** Two Phase 0 clauses land in `mutation.ts` — cycle
rejection naming the offending slots, and prior state provably unchanged. Before claiming
either, neutralise the code that implements it, re-run, and show a *named* test fails. Paste
that output into the entry.

## Known problems
- **L-13** — `eval.ts`'s stale-edge branch (`node === undefined` → `continue`) is reached by no
  test; replacing it with a `throw` still passes 108/108. Genuinely defensive (step 4 rejects
  dangling edges first). Pin it when `mutation.ts` makes the interaction real; until then do
  not describe it as covered.
- **L-14** — `eval.ts`'s two `ErrorValue` messages name no slot. Cannot be fixed there: D-015
  forbids `addressKey` in user-facing text and `evaluate` has no object list for
  `formatAddress`. A real gap for whoever renders error badges (§5.9).
- **L-15** — `postorder.slice().reverse()` copies a local array nothing else reads. Cosmetic.
- **L-6** — `TABLE_TYPE`'s `: ObjectType` annotation widens it from the literal `"table"`.
- **L-7 → covered by D-010** — `slotKey`'s collision-freedom holds only for paths that came
  through `parseAddress`; hand-built keys are closed off by discipline, not by a check.
- **L-8** — `ObjectSchema.type` duplicates its `SCHEMAS` registry key with nothing checking they
  agree. Cheapest fix: a test asserting `getObjectSchema(t)?.type === t` over the registry.
- **L-10** — `addressKey`'s collision-freedom assumes IDs match D-002's `obj_<n>`, but
  `objectId` is a bare `string`. Note it in `document.ts`'s header — that module owns
  `nextObjectId`.
- **L-11 / L-12** — two cosmetic items in `cycles.test.ts`'s `isGenuineCycle` (0010-REVIEW §4).
- **`detectCycle`'s reported cycle can start at any member.** Correct either way, but a message
  wanting a specific leading slot must order it.
- **Recursion depth** — `detectCycle` and `evaluate` both recurse once per slot along the
  longest dependency chain. Fine at the brief's scale under Rule 5, but `document.ts` can load
  an arbitrarily long chain from JSON. Watch it there; do not pre-optimise either file.
- **`document.ts` forward constraint** — `DerivedSlot.value` is required, but §5.11 says derived
  values are never serialized. Load must build derived slots with a `null` placeholder before
  the evaluation pass.
- The table/`cells` mapping in `address.ts` is still hardcoded — move it onto the schema
  registry once `schema.ts` can express slot families (D-005 §4, D-009).
- `npm run typecheck` does not cover config files; `npm audit` reports 5 dev-dep
  vulnerabilities, none at runtime. Both low severity, unchanged, out of scope.
- **SETTLED, do not re-raise:** the flat `claude/` layout (0002-REVIEW); extracting the shared
  vocabulary out of `graph/node.ts` (0006-REVIEW §6); unifying `isErrorValue` with
  `isAddressError` (D-014); reconstructing a path array from a `GraphObject.slots` key (0011 —
  match schema entries by re-deriving their OWN key, per `findDerivedSlotSchemaByKey`).

## Live PROVISIONAL tags
- **`PROVISIONAL(Q-005)`** → `src/engine/formula/ast.ts` and `src/engine/graph/eval.ts`
  (`evaluateReference`). Choice **approved** at 0006-REVIEW; not a live risk. Both tags come
  out together when Phase 1 widens `FormulaAst` and replaces `evaluateReference` with a real
  `formula/eval.ts`.

Open questions: **Q-001, Q-002** (Phase 3, deferred — fourth reaffirmation). **Q-004** (Phase 2,
cell-ref case normalisation). **Q-005** (Phase 1, approved). **Q-003** ANSWERED → D-007. None
raised at 0011.

## Gotchas for the next model
- **D-016 is the newest ruling and the one most likely to change how you work.** A test can
  cover a behaviour, pass, and still not *demonstrate* it — reading the test will not tell you
  which; only running the mutation does. Two consecutive cycles (0009, 0011) shipped a green
  suite whose single most load-bearing line was unpinned, both caught the same way. Where the
  behaviour is an ORDER, also write the fixture in the *wrong* order: a fixture in dependency
  order cannot tell a real sort from no sort.
- **Cyclic input to `evaluate` fails SILENTLY, not loudly.** `visit` marks visited before
  recursing, so a back-edge returns early: the pass completes and quietly emits `#REF`s. Step 5
  (`detectCycle`) before step 7 (`evaluate`) is load-bearing, not conventional. Do not add a
  defensive cycle check inside `eval.ts` to compensate.
- **`GraphObject`, not `Object`** — a naming-collision workaround; the word in prose is still
  "object."
- **`address.ts` ↔ `graph/node.ts` reference each other's TYPES**, but the runtime dependency is
  one-directional (`node.ts` uses `import type`, fully erased). **A value import from
  `address.ts` into `graph/node.ts` creates a real runtime cycle.**
- **`Value`/`Point`/`ErrorValue`/`isErrorValue` live in `graph/node.ts`** — import, never
  redefine (D-014).
- **Slot keys come only from `slotKey()`** (D-010); **document-wide keys only from
  `addressKey()`** (D-015) — and **there is no sanctioned inverse of `slotKey`**. To match a
  `GraphObject.slots` key against a schema path, re-derive the KEY from the path and compare
  keys. Neither key ever reaches a user-facing string; slot names in messages come from
  `formatAddress`. `obj_3::cells.A1` in a rejection message is a defect.
- **`ObjectType` includes `value`/`add`** (D-011). **`explode` sets type to `polyline`** (D-012)
  — do not "fix" either.
- `resolveSlot`/`getObjectSchema`/`findDerivedSlotSchema` return `undefined` on a miss, not an
  `ErrorValue` — turning that into `#REF` is the caller's job, as `eval.ts` does.
- **The schema registry stores FUNCTIONS and that is correct** — the prohibition on closures is
  on `GraphObject`/`Slot`/document state, not a module-level registry (0008-REVIEW §2). Same
  answer for `cycles.ts`'s and `eval.ts`'s `Map`s/`Set`s: function-local traversal scratch keyed
  by string is not graph state. Don't "fix" any of them.
- **`derivedSlotDependencyAddresses` runs at edge-derivation time only** (Rule 6). `eval.ts`
  never calls it — a derived slot's read-restriction is filtered from the `Edge[]` it is handed.
- Each PowerShell tool call is a fresh process. The Bash tool's `npm` is not on PATH — use
  PowerShell for `npm`/`npx`.
