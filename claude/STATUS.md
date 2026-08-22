# STATUS — as of entry 0013-edge-derivation

STATE: GREEN — compiles under both tsconfigs, all tests pass (117/117, 0 skipped, 0 `.only`).

Current phase: 0 — Graph core (headless, no pixels)
Phase 0 acceptance criterion (quoted from PROJECT_BRIEF §6):
> you can build a graph in a unit test, bind slots, mutate a value and watch it propagate
> in correct topological order *including through derived slots*; a cycle is rejected with
> the offending slots named **and prior state is provably unchanged**; deleting a slot with
> dependents is rejected; and a document round-trips to JSON and back identically.

Status: **partial — one of four clauses closed.** Treat it as a four-part gate:

1. Propagation in correct topological order, including through derived slots — **PASSING**,
   demonstrated by `graph/eval.test.ts`'s reverse-declared-order fixture (0012-REVIEW edit 1).
2. Cycle rejected, offending slots named, prior state provably unchanged — **NOT YET**.
3. Deleting a slot with dependents is rejected — **NOT YET**.
4. Document round-trips to JSON identically — **NOT YET**.

Clauses 2-4 all need the rest of `mutation.ts` (stage/apply/validate/reject/commit) and
`document.ts`, neither of which is built yet. `mutation.ts` now has its edge-derivation
step (see below).

Last review: **0012-REVIEW-phase0, verdict ACCEPT WITH EDITS. `mutation.ts` may begin.**
Cycle 0013 (this one) is **unreviewed** — it built `mutation.ts`'s edge derivation only.

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
- `graph/cycles.ts` + tests (§5.1 step 5) — 11 tests. `detectCycle(edges)`: naive from-scratch
  DFS following `sourceSlot -> dependentSlot`, returning the first cycle as an ordered
  `Address[]`. Takes no object list and formats no message.
- `graph/eval.ts` + tests (§5.1 step 7) — 10 tests, reviewed at 0012. `evaluate(objects,
  edges)`: naive full topological evaluation (DFS postorder reversal, same direction as
  `cycles.ts`) over an edge set ASSUMED already acyclic. All three slot kinds in ONE pass —
  no `recompute()` — with D-013's read-restriction enforced from the given `edges`.

**Modified this cycle, not yet re-reviewed:**
- `primitives/schema.ts` (§5.1) — was 17 tests, now **19**. `ObjectSchema` gained
  `nonDerivedSlotPaths: readonly (readonly string[])[]` — the full set of paths a type's
  `literal`/`formula` slots occupy (PATHS only, not a default-kind declaration). Everything
  reviewed at prior cycles (`DerivedSlotDependencies`, `DerivedSlotCompute`,
  `derivedSlotDependencyAddresses`, the `value`/`add` registry entries' `derivedSlots`) is
  UNCHANGED — only the new field and its two population sites are new surface.

## Built, not yet reviewed
- `mutation.ts` + tests — **new, 7 tests.** `deriveEdges(objects) => Edge[]` (§5.1 step 3):
  rebuilds the whole edge set from scratch every call (Rule 5), from (1) every formula
  slot's stored AST (via `nonDerivedSlotPaths`, new this cycle — see above) and (2) every
  schema-declared derived slot's dependencies (via `derivedSlotDependencyAddresses`, called
  ONLY here). This is `mutation.ts`'s *entire* content so far — deliberately split out from
  the rest of the 8-step loop (stage/apply/validate/reject/evaluate/commit), per STATUS's own
  prior recommendation.

## Not started
In brief §7 order: (1) the rest of `mutation.ts` — stage (deep-clone) / apply / validate
integrity (§5.1.1) / validate acyclicity + reject (D-015: `formatAddress`, never
`addressKey`) / evaluate / commit + journal, plus the batch form — **next**; (2) `document.ts`
+ its round-trip test (including `nextObjectId`, D-002). Then Phase 1 (formula engine) — not
before Phase 0's criterion passes and is reviewed.

## Next slice (recommended)

The rest of the 8-step loop (§5.1), now that edge derivation exists to wire in. Start
narrow: one `setLiteral`-shaped operation plus the batch form (§5.1 requires batch from day
one) against the `value`/`add` fixture. A full command surface is Phase 3.

Concretely: stage (deep-clone `GraphObject[]`) → apply the operation(s) to the clone →
`deriveEdges` (built this cycle) → validate integrity (§5.1.1 — reject if an edge points at a
slot that does not exist in the clone, or if the mutation would delete a slot with inbound
dependents and no repair pass) → `detectCycle` (already built) and reject on a hit, formatting
the message via `formatAddress` over every `Address` in `cycle`, **never** `addressKey`
(D-015) → `evaluate` (already built) → commit (swap the clone in, append to an append-only
journal — Rule 2 requires the journal exist from day one even though undo is not built).

**D-016 binds this cycle hardest of all so far.** Two Phase 0 clauses land here — cycle
rejection naming the offending slots, and prior state provably unchanged. Before claiming
either, neutralise the code that implements it, re-run, and show a *named* test fails. Paste
that output into the entry. "Prior state provably unchanged" needs its own test discipline:
assert the SAME object reference (or a deep-equal snapshot taken before the call) survives a
rejected mutation untouched — a test that only checks the return value's shape would not
catch a clone that leaked a mutation into the original before rejecting.

## Known problems
- **L-16 (new)** — nothing enforces that `ObjectSchema.nonDerivedSlotPaths` and
  `derivedSlots`' paths are disjoint. A schema entry that (buggily) listed the same path in
  both would not throw; `deriveEdges` would silently do one thing or the other depending on
  that slot's current `kind`, which is exactly the kind of quiet misbehavior this project's
  discipline hunts for elsewhere. Cheap fix, same shape as L-8's own suggested fix: a test
  over the whole registry asserting every type's two path lists are disjoint (`slotKey`-
  compared, per D-010).
- **L-13** — `eval.ts`'s stale-edge branch (`node === undefined` → `continue`) is reached by no
  test; replacing it with a `throw` still passes. Genuinely defensive (step 4 rejects
  dangling edges first). Pin it when the rest of `mutation.ts` makes the interaction real;
  until then do not describe it as covered.
- **L-14** — `eval.ts`'s two `ErrorValue` messages name no slot. Cannot be fixed there: D-015
  forbids `addressKey` in user-facing text and `evaluate` has no object list for
  `formatAddress`. A real gap for whoever renders error badges (§5.9).
- **L-15** — `postorder.slice().reverse()` (`eval.ts`) copies a local array nothing else
  reads. Cosmetic.
- **L-6** — `TABLE_TYPE`'s `: ObjectType` annotation widens it from the literal `"table"`.
- **L-7 → covered by D-010** — `slotKey`'s collision-freedom holds only for paths that came
  through `parseAddress`; hand-built keys are closed off by discipline, not by a check.
- **L-8** — `ObjectSchema.type` duplicates its `SCHEMAS` registry key with nothing checking they
  agree. Cheapest fix: a test asserting `getObjectSchema(t)?.type === t` over the registry —
  could be folded into the same new test L-16 recommends.
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
  registry once `schema.ts` can express slot families (D-005 §4, D-009). (`nonDerivedSlotPaths`,
  new this cycle, is a step toward that but does not itself solve the table-cells case, which
  is variable-arity, not a fixed path list.)
- `npm run typecheck` does not cover config files; `npm audit` reports 5 dev-dep
  vulnerabilities, none at runtime. Both low severity, unchanged, out of scope.
- **SETTLED, do not re-raise:** the flat `claude/` layout (0002-REVIEW); extracting the shared
  vocabulary out of `graph/node.ts` (0006-REVIEW §6); unifying `isErrorValue` with
  `isAddressError` (D-014); reconstructing a path array from a `GraphObject.slots` key —
  solved for derived slots at 0011 (`findDerivedSlotSchemaByKey`) and for formula slots at
  0013 (`primitives/schema.ts`'s `nonDerivedSlotPaths`) — **both times by declaring the path
  on the schema side, never by inverting `slotKey`. There is still no sanctioned inverse of
  `slotKey`, and the next slot kind that needs its own address should follow the same pattern,
  not invent one.**

## Live PROVISIONAL tags
- **`PROVISIONAL(Q-005)`** → `src/engine/formula/ast.ts` and `src/engine/graph/eval.ts`
  (`evaluateReference`). Choice **approved** at 0006-REVIEW; not a live risk. Both tags come
  out together when Phase 1 widens `FormulaAst` and replaces `evaluateReference` with a real
  `formula/eval.ts`.

Open questions: **Q-001, Q-002** (Phase 3, deferred — fourth reaffirmation). **Q-004** (Phase 2,
cell-ref case normalisation). **Q-005** (Phase 1, approved). **Q-003** ANSWERED → D-007. None
raised at 0011, 0012, or 0013.

## Gotchas for the next model
- **D-016 is binding on every acceptance-criterion claim, and hits hardest exactly where
  `mutation.ts` is headed next.** Mutation-check before claiming; write order/state fixtures
  in the form that could NOT pass by accident (wrong declared order for an ordering claim;
  a pre-mutation snapshot compared byte-for-byte for a "prior state unchanged" claim).
- **Cyclic input to `evaluate` fails SILENTLY, not loudly.** Step 5 (`detectCycle`) before
  step 7 (`evaluate`) is load-bearing, not conventional. Do not add a defensive cycle check
  inside `eval.ts` to compensate.
- **There is no sanctioned inverse of `slotKey`, and there still isn't one — by design.** Two
  cycles in a row (0011, 0013) hit a place that looked like it needed one (recovering a real
  `path` array from a `GraphObject.slots` string key) and solved it the same way both times:
  declare the path on the SCHEMA side (`DerivedSlotSchema.path` for derived slots;
  `ObjectSchema.nonDerivedSlotPaths` for literal/formula slots, added this cycle) and match by
  re-deriving that path's OWN key via `slotKey`, never by decomposing the key you already
  have. If a THIRD such need shows up, follow this pattern rather than reaching for
  `key.split(".")` — even though it would work arithmetically (`PATH_SEGMENT_PATTERN`
  forbids `.` in a path segment), it would be a second, ad hoc way to do something the schema
  registry already has one sanctioned way to do.
- **`GraphObject`, not `Object`** — a naming-collision workaround; the word in prose is still
  "object."
- **`address.ts` ↔ `graph/node.ts` reference each other's TYPES**, but the runtime dependency is
  one-directional (`node.ts` uses `import type`, fully erased). **A value import from
  `address.ts` into `graph/node.ts` creates a real runtime cycle.**
- **`Value`/`Point`/`ErrorValue`/`isErrorValue` live in `graph/node.ts`** — import, never
  redefine (D-014).
- **Slot keys come only from `slotKey()`** (D-010); **document-wide keys only from
  `addressKey()`** (D-015). Neither key ever reaches a user-facing string; slot names in
  messages come from `formatAddress`. `obj_3::cells.A1` in a rejection message is a defect.
- **`ObjectType` includes `value`/`add`** (D-011). **`explode` sets type to `polyline`** (D-012)
  — do not "fix" either.
- `resolveSlot`/`getObjectSchema`/`findDerivedSlotSchema` return `undefined` on a miss, not an
  `ErrorValue` — turning that into `#REF` is the caller's job, as `eval.ts` does.
- **The schema registry stores FUNCTIONS and that is correct** — the prohibition on closures is
  on `GraphObject`/`Slot`/document state, not a module-level registry (0008-REVIEW §2). Same
  answer for `cycles.ts`'s, `eval.ts`'s, and now `mutation.ts`'s own `Map`/`Set`/array
  accumulators: function-local scratch keyed by string is not graph state. Don't "fix" any of
  them.
- **`derivedSlotDependencyAddresses` runs at edge-derivation time only** (Rule 6).
  `mutation.ts`'s `deriveEdges` is the ONLY call site for it in this cycle's code; `eval.ts`
  still never calls it — a derived slot's read-restriction there is filtered from the `Edge[]`
  `deriveEdges` produces.
- **Any future `ObjectSchema` entry (Phase 3+ geometry, Phase 4 table, ...) must populate BOTH
  `nonDerivedSlotPaths` and `derivedSlots`**, not just the latter — `deriveEdges` silently
  derives zero binding edges for a type that forgot the former, which would present as
  "formulas on this type never seem to propagate," not a compile error or a thrown exception.
- Each PowerShell tool call is a fresh process. The Bash tool's `npm` is not on PATH — use
  PowerShell for `npm`/`npx`.
