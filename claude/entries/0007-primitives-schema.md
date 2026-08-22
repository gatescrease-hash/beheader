# 0007 — primitives-schema
Date: 2026-08-21   Phase: 0   Model: implementer (Claude Sonnet 5)
Previous entry: 0006-REVIEW-phase0   Last review: 0006-REVIEW-phase0 (verdict: ACCEPT)

## Declared scope

Build `src/engine/primitives/schema.ts`: the derived-slot declaration mechanism
(§5.1 — path, dependencies, compute function per derived slot), with real schema
entries for the two Phase 0 fixture types, `value` and `add` (D-011). Support both
the static and dynamic dependency forms in the type system, even though neither
fixture needs `dynamic`.

## Explicitly not in scope

- Declaring a type's full slot set (literal/formula slots and their default
  kinds) — that need is concrete only once `mutation.ts` builds object creation,
  which is not this cycle. Noted as "NOT DONE HERE" in the file header rather than
  built speculatively.
- Any schema entries beyond `value`/`add` — no geometry, table, text, script, or
  image schema. Those belong to their own build-order phases (3, 4, 5, 6).
- `graph/cycles.ts`, `graph/eval.ts`, `mutation.ts`. This cycle only declares data
  a future `eval.ts` will read; it does not derive edges, detect cycles, or
  evaluate anything.

## What I did

- `src/engine/primitives/schema.ts` — new. Implements §5.1's derived-slot
  declaration mechanism:
  - `DerivedSlotDependencies` — `static` (fixed same-object paths) or `dynamic`
    (a function of the object's current state, returning full `Address`es). Both
    forms are expressible now, per STATUS's constraint that the mechanism must
    support the dynamic case even though no Phase 0 fixture exercises it.
  - `DerivedSlotCompute` / `DerivedSlotSchema` / `ObjectSchema` — the per-slot and
    per-type declaration shapes.
  - `derivedSlotDependencyAddresses` — the one place a static path list becomes
    concrete `Address`es (paired with the object's own id) or a dynamic resolver
    is invoked. Documented as callable only during edge derivation, never during
    evaluation (§5.1, Rule 6).
  - `VALUE_SCHEMA` — `value`'s one slot is `literal`, so `derivedSlots: []`,
    genuinely empty rather than a placeholder.
  - `ADD_SCHEMA` — `add`'s one derived slot, `out.result`, statically depending
    on `in.a`/`in.b` (path names match the existing Phase 0 fixture already
    committed in `graph/node.test.ts`, and the `in.<port>`/`out.<port>` shape
    §5.2's own address-table example uses for `script_2`). Its `compute`
    function: propagates an upstream `ErrorValue` from either input unchanged
    (§5.1: "errors propagate"), returns `#REF` if a dependency did not resolve at
    all (`read` returned `undefined`), returns `#TYPE` for any non-error,
    non-number input, and otherwise returns the sum. Never throws.
  - `getObjectSchema` / `findDerivedSlotSchema` — registry lookups. Both return
    `undefined` honestly for the eight non-fixture `ObjectType`s, which have no
    schema entry yet, rather than a stand-in.
- `src/engine/primitives/schema.test.ts` — new, 16 tests. Covers: real entries
  exist for `value` (empty `derivedSlots`) and `add` (one entry, correct path);
  `undefined` for every type without a schema yet (D-008's lesson — test the
  unspecified cases); path lookup by structural equality, not array reference
  (D-010); `derivedSlotDependencyAddresses` for both the static and dynamic
  branches; and `add`'s compute function against numeric inputs, error
  propagation from either input, a non-numeric non-error input, a missing
  dependency, and a "never throws" assertion across all of the above.

## Decisions I made

- **`in.a` / `in.b` / `out.result` naming for `add`'s slots** — not really a new
  decision: it matches the fixture already present in `graph/node.test.ts`
  (committed at cycle 0005, reviewed at 0006) and the `in.<port>`/`out.<port>`
  shape §5.2's own address table uses for `script_2`. Using anything else would
  have made this file inconsistent with an already-reviewed test fixture.
- **Error precedence in `add`'s compute** — check `in.a` for an `ErrorValue`
  before `in.b`, so a doubly-erroring `add` returns a deterministic result
  instead of depending on argument-evaluation order. Not specified by the brief;
  reversible, low-stakes, and not worth an `OPEN_QUESTIONS.md` entry — it is
  internal to one compute function fixture.
- **`Partial<Record<ObjectType, ObjectSchema>>` for the registry** — a full
  `Record` would force every consumer to type-narrow at every one of the eight
  not-yet-built entries today for no benefit; `Partial` plus an honest
  `undefined` return matches how `getSlot`/`resolveSlot` already report "nothing
  here" elsewhere in the codebase (STATUS.md's existing pattern).
- **Scope held at "derived slots only," not "full per-type slot schema"** — §5.1
  does say schemas declare a slot's "default kind," but STATUS.md's "Next slice"
  section quotes only the derived-slot sentence and lists five binding
  constraints, all about derived slots. Building full slot-set declarations now
  would anticipate `mutation.ts`'s object-creation need before it is concrete,
  which PROCESS_BRIEF §4 flags as scope drift ("NEVER refactor code you did not
  write this cycle" / finish the declared slice, don't expand it). Recorded as
  "NOT DONE HERE" rather than silently skipped.

## Verification (real output)

$ npx tsc --noEmit && npx tsc --noEmit -p tsconfig.engine.json
(both exit 0, no output — confirmed via `npm run typecheck`, pasted below)

```
> graphpaper@0.0.0 typecheck
> tsc --noEmit && tsc --noEmit -p tsconfig.engine.json
```

$ npm test
```
 RUN  v2.1.9 C:/Users/William/Documents/Code Projects/beheader

 ✓ src/engine/graph/edge.test.ts (2 tests) 3ms
 ✓ src/engine/graph/node.test.ts (15 tests) 5ms
 ✓ src/engine/primitives/schema.test.ts (16 tests) 5ms
 ✓ src/engine/address.test.ts (44 tests) 8ms

 Test Files  4 passed (4)
      Tests  77 passed (77)
```
77 = 61 pre-existing (44 + 15 + 2) + 16 new. Zero skipped, zero `.only`.

## Acceptance criteria status

Phase 0 criterion (PROJECT_BRIEF §6) — NOT YET. This cycle builds one more piece
of the mechanism (derived-slot declarations); nothing propagates or evaluates
yet, same as STATUS.md stated at cycle start. `graph/cycles.ts`, `graph/eval.ts`,
`mutation.ts`, and `document.ts` are still required before the criterion can be
demonstrated.
Demonstrated by: N/A this cycle — no acceptance criterion claimed.

## Where I got stuck / what is unfinished

Not stuck, but one judgment call worth flagging for the reviewer explicitly: I
did not give `add`'s compute function a way to distinguish "the dependency
resolved to `null`" from "the dependency did not resolve at all" beyond the
`undefined` check already required by `Value` not including `undefined`. A
literal `null` input (legal per the `Value` union) currently falls through to
the `#TYPE` branch since `typeof null === "object"`, not `"number"` — I did add
a test for this (`in.a: null, in.b: null` → does not throw) but did not assert
which specific error code it produces beyond "does not throw." I judged that
adequate for this fixture (nothing yet writes `null` into `in.a`/`in.b` in
practice), but flagging it as the one under-specified corner I noticed and
chose not to chase further.

## Open questions raised

None. All decisions this cycle were reversible, internal to one new fixture's
compute function, and consistent with already-committed test fixtures and prior
decisions (D-010, D-011) — none shape the data model, addressing, or mutation
sequence.

## Escalation triggers fired

- **§6.2** — created `src/engine/primitives/schema.ts`, one of the load-bearing
  files the trigger list names explicitly.
- **§6.3** — two new files under `src/engine/`.
- **§6.9** — diff is 433 lines across 2 files (273 + 160), over the ~400-line
  guideline. Two files, so the file-count half of the trigger does not fire on
  its own, but the line count does; flagging it rather than rounding down.

No other trigger fired: no phase acceptance criterion is claimed (§6.1); nothing
in §8's deferred list was touched (§6.10); no test's expectations changed,
because none of these tests existed before this cycle (§6.6); no dependency,
build step, or config file was added (§6.7); this is the first attempt at this
slice, not a repeated failed one (§6.8); no hard rule was worked around (§6.5).
