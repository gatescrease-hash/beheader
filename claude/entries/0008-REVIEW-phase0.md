# 0008 — REVIEW (phase 0, mid-phase)
Date: 2026-08-21   Phase: 0   Model: reviewer (Claude Opus 5)
Previous entry: 0007-primitives-schema   Reviewing: cycle 0007
Prior review: 0006-REVIEW-phase0 (verdict: ACCEPT)

Scope: cycle 0007 — `primitives/schema.ts` and `primitives/schema.test.ts`, both new.

---

## 1. Rule audit

| Rule | Verdict |
| --- | --- |
| **Rule 1** — `engine/` is pure, no DOM/window/canvas/`render/` | **UPHELD.** Grepped `document.`/`window.`/`canvas`/`CanvasRenderingContext`/`render/`/`HTMLElement` across all of `src/engine/`: eight hits, every one prose — five are the file-header "NEVER imports" boilerplate, two are references to the *filename* `document.ts`, one is §5.1's own product phrase "on the canvas". I read each hit rather than counting them. `tsc -p tsconfig.engine.json` (DOM-free lib, D-006) exits 0, which is the real enforcement. |
| **Rule 2** — all state change through `mutation.ts` | **NOT TOUCHED.** Nothing here mutates. `derivedSlotDependencyAddresses` allocates new `Address` objects; `compute` returns a new `Value`. No assignment to any document state anywhere in the diff. |
| **Rule 3** — addressing is load-bearing | **UPHELD.** Dependencies are declared as paths and become `Address`es only via `derivedSlotDependencyAddresses`; no address string is built anywhere. All 44 address tests still pass untouched. |
| **Rule 4** — one formula engine | **NOT TOUCHED**, and correctly not pre-empted — `compute` is a TypeScript function, not a second expression evaluator. `add`'s summation is a schema compute function of the kind §5.1 mandates, not a formula-language implementation. |
| **Rule 5** — performance is a non-goal | **UPHELD.** `findDerivedSlotSchema` does a linear `find` over `derivedSlots` and re-joins both paths through `slotKey` on every comparison — no index, no memo. Correct, and the header does not apologise for it. |
| **Rule 6** — slot set fixed during evaluation | **UPHELD in what it can control, and this is the cycle's best judgement call.** §5.1 requires dynamic dependency resolvers to run at edge-derivation time and never during evaluation. `schema.ts` cannot enforce that — the caller decides when to call — so the implementer put the constraint in the file header *and* on `derivedSlotDependencyAddresses`'s own docstring, and routed both dependency kinds through that one function precisely so the rule has one home. That is the right structural move given it cannot be typed. |
| **Rule 7** — no §8 deferred items | **UPHELD.** |

## 2. Invariant audit

- **Derived slots evaluated INSIDE the topological pass; no `recompute()`** — UPHELD, and
  stated as a named invariant in the header. Nothing here provides or implies a post-pass. The
  `compute` seam is shaped as "called once per derived slot during the pass," which is correct.
- **Graph state plain, serializable, ID-referenced** — UPHELD. I checked this one specifically
  because the file stores **functions** (`compute`, and `dynamic`'s `resolve`) and that
  superficially resembles the forbidden pattern. It is not: the prohibition is on closures and
  class instances inside **graph state** (`GraphObject`/`Slot`/the document). The schema registry
  is module-level *code*, keyed by type, and §5.1 explicitly requires it to hold "its compute
  function." No `GraphObject` gained a function-valued field. Correct, and the distinction is
  worth recording because the next reader will have the same flinch.
- **Slots declared by path, never by hand-built key (D-010)** — UPHELD, and tested directly:
  `findDerivedSlotSchema` matches a freshly-built array rather than the schema's own instance,
  with a test whose name says so. No string key is written anywhere outside test fixtures.
- **Errors propagate and never throw (§5.1)** — UPHELD. `add`'s compute returns the upstream
  `ErrorValue` *unchanged* rather than wrapping it, which is the correct reading of "any formula
  reading an error slot yields an error," and there is an explicit "never throws" test.
- **`undefined` is not a `Value`** — UPHELD and handled at the boundary: `read` returning
  `undefined` (an unresolvable address) is converted to a `#REF` `ErrorValue` before anything
  else touches it, so no `undefined` can leak into the graph as a value.
- **Both dependency forms expressible** — UPHELD, and this was the constraint most at risk of
  being quietly skipped, since neither Phase 0 fixture needs `dynamic`. It is implemented, and
  tested via a synthetic dynamic dependency. Good.

## 3. Spec conformance

Conformant. Two readings I checked closely because they were interpretations rather than
transcriptions, and both are right:

- **`static` = same-object paths, `dynamic` = full `Address`es.** §5.1 says static deps are "a
  fixed list of paths within the same object" — so the asymmetry is the brief's, not invented.
  Dynamic must return full addresses because `text.resolvedContent` references arbitrary other
  objects. Correct.
- **`value` gets an entry with an empty `derivedSlots`, not no entry.** §6 says the `value`
  fixture has one *literal* slot, so having nothing to declare is the right answer, and an empty
  array is meaningfully different from `undefined` (which means "no schema at all"). The
  distinction is tested. Correct.

The eight product primitives having no entries is correct build-order discipline, not an
omission — they belong to Phases 3–6.

## 4. Legibility audit

Strong, and the headers are doing real work — the Rule 6 note on
`derivedSlotDependencyAddresses` is the kind of comment PROCESS_BRIEF §5.4 asks for (which rule
this protects, not what the line does). Vocabulary locked throughout; no `any`; tests named as
behaviour sentences.

Three items, none blocking:

- **L-8 — `ObjectSchema.type` duplicates its registry key with nothing checking them.**
  `SCHEMAS` is keyed by `ObjectType` *and* each entry restates `type`. A future copy-pasted entry
  could say `{ type: "polygon" }` under the `rect` key and nothing would notice. Cheapest fix is a
  test iterating the registry and asserting `getObjectSchema(t)?.type === t`; fold it in when
  `schema.ts` is next open. Not worth its own commit — same disposition as L-6.
- **L-9 — the `add` fixture's slot *kinds* differ between the two test files.**
  `graph/node.test.ts` builds `in.a`/`in.b` as **formula** slots (matching §6's "two formula input
  slots"); `schema.test.ts` builds them as **literal**. Functionally irrelevant there — that
  fixture is only read for `id` and `type` — but entry 0007's STATUS gotcha calls them "the same
  object shape in two files," which is loose. Flagged mainly as a **forward constraint**: the real
  Phase 0 acceptance test MUST use formula input slots, because propagating a value *through a
  binding into a derived slot* is the specific thing §6's criterion demands. A future implementer
  copying the `schema.test.ts` fixture would build the wrong acceptance fixture.
- **L-6 (carried, unchanged)** — `TABLE_TYPE`'s annotation still widens it from the literal
  `"table"`. `node.ts` was open this cycle for my own edit, but folding L-6 in would have been my
  scope creep, not a review finding. Still not worth its own commit.

## 5. Honesty audit

**Clean.** Independently re-verified rather than read off the entry:

- `npx tsc --noEmit` → exit 0. `npx tsc --noEmit -p tsconfig.engine.json` → exit 0. ✓
- `npm test` → 77/77, 4 files, 0 skipped. ✓ Arithmetic checks out: 61 pre-existing (44+15+2) + 16.
- I counted `schema.test.ts`'s `it` blocks by hand: 3 + 4 + 2 + 7 = 16. ✓
- Grepped `.only`/`.skip`/`.todo` across `src/` → none. ✓
- No pre-existing test's expectations changed; `address.test.ts` and `edge.test.ts` are untouched
  by the diff. §6.6 correctly does not fire. ✓

**The entry's self-criticism is accurate and, unusually, understated.** Its "Where I got stuck"
flags the `null`-input gap unprompted and describes it correctly (`typeof null === "object"`, so
it reaches the `#TYPE` branch; tested only for "does not throw"). I traced the branch myself to
confirm rather than trusting the description, and it is right.

**One imprecision, recorded rather than waved through:** the §6.9 trigger is reported as "433
lines across 2 files," which is the source-only count; the commit is 644 insertions / 29 deletions
across 4 files once `STATUS.md` and the log entry are included. The trigger fired and was
reported either way, and the entry discloses the real per-file numbers, so this is a
counting-convention difference and not a misreport — but "433 lines" and the commit stat do not
match, and a reader comparing them deserves to know why. Source-only is the more useful
convention for §6.9; noting it so it stays consistent.

No scope drift. `graph/cycles.ts`/`eval.ts` were left alone despite being the obvious next thing
and despite this file being written specifically to feed them.

## 6. The finding that mattered: compute/dependency drift → **D-013**

The one substantive issue, and it is a forward hazard rather than a present defect.

A derived slot states what it reads **twice**: once as `dependencies`, once as the actual
`read(...)` calls inside `compute`. `graph/eval.ts` will build its topological order from the
*declared* half. Nothing anywhere requires the two halves to agree.

`add` gets this right — both halves share the `ADD_IN_A_PATH`/`ADD_IN_B_PATH` constants, which is
exactly the right defensive habit. But `DerivedSlotCompute`'s `read` parameter accepts **any**
`Address`, and it has to: §5.1's dynamic case genuinely reads other objects, so the parameter
cannot be narrowed by type. The constraint is therefore unenforceable by the type system and
must be enforced at the call site.

The consequence if it drifts: a compute function reads a slot the topological sort was never
asked to order before it, and gets either this pass's value or the previous pass's, depending on
sort order. That is intermittent staleness presenting as flaky reactivity — the *same* bug
PROCESS_BRIEF §9 forbids a `recompute()` pass for causing, reached by a different route. One
route was closed; this one was open.

Ruled as **D-013**: a compute function may read only its declared dependencies, and
`graph/eval.ts` MUST enforce it by passing a `read` that returns `#REF` for anything undeclared.
That is a set-membership check against an array the evaluator already has in hand.

Ruled **now**, before `eval.ts` exists, deliberately: the check is nearly free to build in and
expensive to retrofit once an evaluator has been written against a looser contract. This is the
same timing argument D-006 made for the DOM-free tsconfig.

## 7. Reviewer edits (3, all small, each explained)

1. **Moved `isErrorValue` from `primitives/schema.ts` to `graph/node.ts` and exported it**
   (+ updated schema.ts's import). Its body was **byte-identical** to `address.ts`'s
   `isAddressError` — I diffed them to confirm rather than eyeballing. §5.1 requires errors to
   propagate, so every future compute function (geometry, text, script) and `formula/eval.ts`
   must make this exact check; copies three and four were already scheduled for Phases 3 and 5.
   Ruled as **D-014** so the fix generalises. `address.ts`'s `isAddressError` deliberately stays
   put — different input type, different narrowed type, and 0006-REVIEW §6 declined to deepen
   that coupling.
2. **Added 5 tests for `isErrorValue`** in `graph/node.test.ts`, covering the whole `Value` union
   rather than just the error case. A newly exported function with no direct test is a module
   that is not done (PROCESS_BRIEF §5.6), and per D-008's lesson the cases worth testing are the
   *unspecified* ones: `null` and `readonly Point[]` are both object-typed, and a copy of this
   predicate that drops the `value !== null` guard reports `null` as an error.
3. **Added 1 test pinning `null` → `#TYPE`** in `schema.test.ts`, answering the implementer's own
   Q2 (below). Four lines, and it converts a flagged unknown into asserted behaviour.

Post-edit verification, run by me: `npm run typecheck` exit 0 (both configs); `npm test` →
**83/83 passed**, 4 files, 0 skipped (77 + 5 + 1).

## 8. Answers to the implementer's questions

**Q1 — Is scoping this file to derived-slots-only (deferring full slot-set / default-kind
declarations to `mutation.ts`) the right cut?**

**Yes — right cut, with one correction to where the deferred work lands.** §5.1 does say schemas
declare a slot's default kind, but the only consumer of that is object *creation*, which is
`mutation.ts`'s job and does not exist. Building it now would have been speculation, and
`STATUS.md`'s "Next slice" quoted only the derived-slot sentence. The header's "NOT DONE HERE"
records it honestly, which is the right way to defer.

The correction: when `mutation.ts` needs it, the slot-set declaration belongs **in `schema.ts`**,
not invented inside `mutation.ts`. Two things will want it — creation (what slots does a new
`polygon` get?) and the validation in mutation step 4 — and if the first one to need it declares
its own, the second gets a second source of truth. Same reasoning as D-009.

**Q2 — Is the `null`-input handling in `add`'s compute acceptable to leave as a known gap?**

**It is not a gap, and it is not a defect — but it should be pinned, so I pinned it** (edit 3).
`#TYPE` is the correct fail-closed answer, and the branch order producing it is right. The reason
to assert it rather than leave it implicit is that the *tempting* alternative is real: spreadsheets
treat a blank cell as `0`, and someone will eventually ask why `add` doesn't. The answer is that
`add` is a Phase 0 fixture (§6), not a product primitive, so it has no user-facing blank-cell
semantics to match — and that reasoning now lives in the test comment where it will actually be
read. Q-004 got the same treatment (pinned by test rather than by a `PROVISIONAL` tag); this
follows that precedent.

No new open questions raised this cycle, and none of the four standing ones (Q-001, Q-002, Q-004,
Q-005) are touched by this work or newly answerable.

---

## Verdict: ACCEPT WITH EDITS

The declared slice was delivered exactly and nothing else was. The two constraints most likely to
have been quietly skipped — the `dynamic` dependency form that no Phase 0 fixture exercises, and
`value` getting a real empty entry rather than no entry — were both honoured, with their reasons
attached. The Rule 6 timing constraint that `schema.ts` cannot enforce was handled the right way:
routed through one function so the rule has one home, and documented there. Error propagation is
correct in the detail that matters (upstream errors returned unchanged, not rewrapped).

The one finding, D-013, is a hazard the implementer could not reasonably have been expected to
close from inside this file — enforcement belongs in a module that does not exist yet — and it is
now ruled before that module is written, which was the whole point of catching it here.

**`graph/cycles.ts` and `graph/eval.ts` may begin.**

### Constraints carried into the next cycle

1. **D-013 is binding on `eval.ts`.** The `read` callback passed to a derived slot's `compute`
   MUST resolve only that slot's declared dependency addresses and MUST return a `#REF`
   `ErrorValue` for anything else. Test it: a compute function reading an undeclared address gets
   `#REF`, not a real value.
2. **Derived slots are evaluated INSIDE the topological pass** (§5.1, PROCESS_BRIEF §9). No
   `recompute()`, no second pass, no "derived values updated after evaluation." This is the single
   thing the next cycle most needs to get right.
3. **Call `derivedSlotDependencyAddresses` during edge derivation only** — never from inside the
   evaluation loop (Rule 6). Dynamic resolvers read the object's current state.
4. **L-9 — the Phase 0 acceptance fixture MUST use formula input slots**, per §6's "two formula
   input slots." Copy `graph/node.test.ts`'s `add` fixture, not `schema.test.ts`'s.
5. **Cycle rejection must name every slot in the cycle** (§5.1 step 5) and **prior state must be
   provably unchanged** (§6). Both are explicit acceptance-criterion language and both need a test
   whose name says which property it defends.
6. **D-014** — `Value` predicates live in `graph/node.ts`. Import `isErrorValue`; do not write a
   local copy in `eval.ts`.
