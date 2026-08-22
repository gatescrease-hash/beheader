# STATUS — as of entry 0014-REVIEW-phase0

STATE: GREEN — compiles under both tsconfigs, all tests pass (119/119, 0 skipped, 0 `.only`).

Current phase: 0 — Graph core (headless, no pixels). Acceptance criterion (PROJECT_BRIEF §6):
> you can build a graph in a unit test, bind slots, mutate a value and watch it propagate
> in correct topological order *including through derived slots*; a cycle is rejected with
> the offending slots named **and prior state is provably unchanged**; deleting a slot with
> dependents is rejected; and a document round-trips to JSON and back identically.

Status: **partial — one of four clauses closed.** Treat it as a four-part gate:

1. Propagation in correct topological order, including through derived slots — **PASSING**
   since 0012-REVIEW. Pinned by `graph/eval.test.ts`'s reverse-declared-order fixture, the one
   test that fails if the topological sort is removed.
2. Cycle rejected, offending slots named, prior state provably unchanged — **NOT YET**, and
   read **D-017** before starting: `detectCycle` is correct, but can now be handed an
   *incomplete* edge set, which makes a real cycle invisible. Step 4 must close that first.
3. Deleting a slot with dependents is rejected — **NOT YET**.
4. Document round-trips to JSON identically — **NOT YET**.

Last review: **0014-REVIEW-phase0, verdict ACCEPT WITH EDITS. Next slice may begin.**

## Built and reviewed
- Scaffold: `package.json`, both tsconfigs (strict + DOM-free, D-006), `vite.config.ts`,
  `index.html`, Vitest, `src/main.ts` placeholder.
- `address.ts` + tests (§5.2) — 44 tests. Two-layer name/ID scheme, naming rules, D-005
  surface↔stored path mapping keyed on the A1 form (D-008), exact inverses.
- `graph/node.ts` + tests (§5.1) — 20 tests. `Value`/`Point`/`ErrorValue`/`isErrorValue` (D-014),
  `ObjectType`/`TABLE_TYPE` (D-009/D-011), the three slot kinds, `GraphObject`, `slotKey`/
  `getSlot`/`resolveSlot`.
- `graph/edge.ts` + tests (§5.1) — 6 tests. `Edge` and `addressKey`. **Internal-only, D-015.**
- `formula/ast.ts` — one-variant `FormulaAst`. **`PROVISIONAL(Q-005)`, approved 0006-REVIEW.**
  Phase 1 *widens* this union, never replaces it.
- `primitives/schema.ts` + tests (§5.1) — 19 tests. Derived-slot declarations
  (`DerivedSlotDependencies` static/dynamic, `DerivedSlotCompute`, `DerivedSlotSchema`,
  `derivedSlotDependencyAddresses`, `getObjectSchema`, `findDerivedSlotSchema`), plus as of 0013
  `ObjectSchema.nonDerivedSlotPaths` (a type's literal/formula slot paths, PATHS only — no
  default-kind). Real entries for `value`/`add` (D-011).
- `graph/cycles.ts` + tests (§5.1 step 5) — 11 tests. `detectCycle(edges)`: naive from-scratch DFS
  following `sourceSlot -> dependentSlot`, returning the first cycle as an ordered `Address[]`.
  Takes no object list, formats no message.
- `graph/eval.ts` + tests (§5.1 step 7) — 10 tests. `evaluate(objects, edges)`: naive full
  topological evaluation (DFS postorder reversal) over an edge set ASSUMED acyclic. All three
  slot kinds in ONE pass — no `recompute()` — D-013's read-restriction taken from `edges`.
- `mutation.ts` + tests (§5.1 step 3 ONLY) — **9 tests, reviewed at 0014.** `deriveEdges`
  rebuilds the whole `Edge[]` from scratch every call (Rule 5): binding edges from formula slots
  at schema-declared `nonDerivedSlotPaths`, dependency edges from each schema derived slot via
  `derivedSlotDependencyAddresses` (its one call site). Never throws. **Narrower than §5.1 step
  3's wording — D-017, and the two "KNOWN GAP" tests.** The loop's other seven steps do not exist.

## Not started, in order
(1) The rest of `mutation.ts` — §5.1 steps 1-2 and 4-8, the batch form, an operation shape;
(2) `document.ts` + round-trip test (`nextObjectId`, D-002). Then Phase 1 — not before Phase 0's
criterion passes and is reviewed.

## Next slice (recommended)

The rest of the 8-step loop, or a first cut. **Start with step 4 (§5.1.1 integrity validation)** —
D-017 part 2 makes it a correctness prerequisite for step 5, not merely the next item in order.
It must reject (a) any edge pointing at a slot that does not exist in the clone, (b) a mutation
deleting a slot with inbound dependents and no repair pass, and (c) **any object whose actual
formula/derived slot set is not covered by its schema** (the D-017 case). Messages via
`formatAddress` over every `Address`, **never** `addressKey` (D-015).

Then steps 1-2 (deep-clone stage, apply), 5-6 (`detectCycle`, reject and discard the clone
entirely), 7 (`evaluate`), 8 (commit — swap the clone in, append to an append-only journal;
Rule 2 requires the journal from day one even though undo is not built). Start narrow: one
`setLiteral`-shaped operation plus the batch form (§5.1 requires batch from day one, and
document loading MUST use it) against the `value`/`add` fixture. Full command surface: Phase 3.

**D-016 binds this cycle hardest so far.** Two Phase 0 clauses land here — cycle rejection naming
the offending slots, and prior state provably unchanged. Before claiming either, neutralise the
code implementing it, re-run, show a *named* test fails, paste the output. "Prior state provably
unchanged" needs a deep compare against a snapshot taken **before** the call — a test that only
checks the return value's shape would miss a clone that leaked into the original before rejecting.

## Known problems
- **D-017 — the live one.** `deriveEdges` walks the SCHEMA's slot set; `eval.ts` walks the
  OBJECT's. Where they disagree edges vanish silently, and a real cycle can go invisible to
  `detectCycle` — step 5 accepts the document, step 7 writes `#REF`s (probed, 0014-REVIEW §6).
  `deriveEdges` need not change; **step 4 must make the disagreement loud.** Two tests pin the
  current behaviour — replace them with a rejection test when step 4 lands, don't delete them.
- **L-16** — nothing enforces that a schema's `nonDerivedSlotPaths` and `derivedSlots` paths are
  disjoint; a type listing one in both would not throw, and `deriveEdges` would quietly do one
  thing or the other by that slot's current `kind`. Fix: one registry-wide `slotKey`-compared
  test (D-010), same shape as L-8's.
- **L-17 / L-18** — `deriveEdges` shares path-array references with the schema registry (harmless
  now; note it if `document.ts` ever stores edges rather than re-deriving them), and does not
  deduplicate (both consumers tolerate duplicates — no dedupe pass without a case needing one).
- **L-13** — `eval.ts`'s stale-edge `continue` branch is reached by no test; replacing it with a
  `throw` still passes. Genuinely defensive. Pin it once step 4 exists; until then do not
  describe it as covered.
- **L-14** — `eval.ts`'s two `ErrorValue` messages name no slot. Unfixable there: D-015 forbids
  `addressKey` in user-facing text and `evaluate` has no object list for `formatAddress`. A real
  gap for whoever renders error badges (§5.9).
- **L-6 – L-15, carried and unchanged** — cosmetics and small unenforced assumptions, each
  written up where it was found (0006/0008/0010/0012-REVIEW §4). Two are worth acting on when
  you are already in the file: **L-8** (registry key vs `ObjectSchema.type`, fold into L-16's
  test) and **L-10** (`addressKey` assumes D-002 `obj_<n>` IDs — note it in `document.ts`).
- **`detectCycle`'s reported cycle can start at any member.** Correct either way, but a message
  wanting a specific leading slot must order it.
- **Recursion depth** — `detectCycle` and `evaluate` both recurse once per slot along the longest
  chain. Fine at the brief's scale (Rule 5), but `document.ts` can load an arbitrarily long one.
  Watch it there; do not pre-optimise either file.
- **`document.ts` forward constraint** — `DerivedSlot.value` is required, but §5.11 says derived
  values are never serialized. Load must place a `null` placeholder before the evaluation pass.
- The table/`cells` mapping in `address.ts` is still hardcoded, and `nonDerivedSlotPaths` cannot
  express a slot family either (D-017's Phase 4 note — do not extend it for tables). Both wait on
  `schema.ts` expressing families (D-005 §4, D-009). `npm run typecheck` does not cover config
  files; `npm audit`'s 5 dev-dep advisories are low severity, unchanged, out of scope.
- **SETTLED, do not re-raise:** the flat `claude/` layout (0002-REVIEW); extracting the shared
  vocabulary out of `graph/node.ts` (0006-REVIEW §6); unifying `isErrorValue` with
  `isAddressError` (D-014); **inverting a `GraphObject.slots` key to recover a path** — solved
  twice by declaring the path schema-side instead (0011 `DerivedSlotSchema.path`, 0013
  `nonDerivedSlotPaths`). A third such need follows that pattern; never `key.split(".")`.

## Live PROVISIONAL tags and open questions
**`PROVISIONAL(Q-005)`** → `formula/ast.ts`, `graph/eval.ts` (`evaluateReference`), `mutation.ts`
(both AST-reading sites). Approved at 0006-REVIEW, not a live risk; all tags come out together
when Phase 1 widens `FormulaAst`. Questions: **Q-001/Q-002** (Phase 3, fifth deferral),
**Q-004** (Phase 2), **Q-005** (Phase 1, approved), **Q-003** ANSWERED → D-007. None raised at
0011-0013. Next free: **Q-006**.

## Gotchas for the next model
- **Two answers to "which slots exist," and they can disagree (D-017).** `deriveEdges` reads the
  schema; `evaluate` reads the object. Nothing reconciles them until step 4 does. Corollary: a
  type that forgets `nonDerivedSlotPaths` gets zero binding edges silently — no error, no throw.
- **D-016** — a test can cover a behaviour, pass, and still not *demonstrate* it; only the mutation
  tells you which. ORDER claims need a *wrong*-order fixture; "state unchanged" needs a snapshot.
- **Cyclic input to `evaluate` fails SILENTLY** — `visit` marks visited before recursing, so a
  back-edge returns early and the pass completes, quietly emitting `#REF`s. Step 5 before step 7
  is load-bearing, not conventional; do not add a defensive cycle check inside `eval.ts`.
- **`GraphObject`, not `Object`** — naming-collision workaround; the prose word is still "object."
- **`address.ts` ↔ `graph/node.ts` share TYPES only** (`import type`, fully erased). **A value
  import from `address.ts` into `graph/node.ts` creates a real runtime cycle.**
- **`Value`/`Point`/`ErrorValue`/`isErrorValue` live in `graph/node.ts`** — never redefine (D-014).
- **Slot keys come only from `slotKey()`** (D-010), **document-wide keys only from
  `addressKey()`** (D-015); both stay internal. User-facing slot names come from
  `formatAddress` — `obj_3::cells.A1` in a rejection message is a defect.
- **`ObjectType` includes `value`/`add`** (D-011); **`explode` sets type to `polyline`** (D-012).
  Do not "fix" either. `resolveSlot`/`getObjectSchema`/`findDerivedSlotSchema` return `undefined`
  on a miss, not an `ErrorValue` — turning that into `#REF` is the caller's job, as `eval.ts` does.
- **The schema registry stores FUNCTIONS and that is correct** — the closure prohibition covers
  `GraphObject`/`Slot`/document state, not a module-level registry (0008-REVIEW §2); same for
  the three modules' function-local scratch `Map`s. Don't "fix" any of them.
- **`derivedSlotDependencyAddresses` runs at edge-derivation time only** (Rule 6) — inside
  `deriveEdges`, its one call site. `eval.ts` never calls it.
- Each PowerShell call is a fresh process; the Bash tool's `npm` is not on PATH — use PowerShell.
