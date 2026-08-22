# 0008 — REVIEW (phase 0, mid-phase)
Date: 2026-08-21   Phase: 0   Model: reviewer (Claude Opus 5)
Previous entry: 0007-primitives-schema   Reviewing: cycle 0007
Prior review: 0006-REVIEW-phase0 (verdict: ACCEPT)

Scope: `primitives/schema.ts` and its tests, both new.

## Rule audit
Rule 1 — UPHELD (engine tsconfig passes). Rule 2 — not touched, nothing mutates. Rule 5 —
UPHELD, `findDerivedSlotSchema` is a plain linear `find`, no index. **Rule 6 — the file's best
judgement call**: it can't enforce "dynamic resolvers run at edge-derivation time only" by
itself (the caller decides when to call), so the constraint lives in the header and on
`derivedSlotDependencyAddresses`'s own docstring — the right structural move given it can't be
typed.

## Invariant audit
Derived slots evaluated inside the topological pass — stated as a named invariant, nothing here
implies a post-pass. Graph state plain/serializable — checked deliberately, since the file
stores *functions* (`compute`); confirmed this is module-level code, not graph state — no
`GraphObject` gained a function-valued field. Both dependency forms genuinely expressible and
tested, including the one (`dynamic`) no Phase 0 fixture needs.

## Legibility
Strong. **L-8** — `ObjectSchema.type` duplicates its registry key with nothing checking
agreement (cheap fix: fold into a future registry-wide test). **L-9** — `add`'s slot *kinds*
differ between `node.test.ts` (formula) and `schema.test.ts` (literal) — functionally
irrelevant there, but a **forward constraint**: the real Phase 0 acceptance fixture MUST use
formula input slots, matching §6's actual wording. Copy `node.test.ts`'s fixture, not
`schema.test.ts`'s.

## Honesty audit
Clean, independently re-verified (77/77, arithmetic and `.only`/`.skip` grep both checked). The
entry's own self-criticism (the `null`-input gap) is accurate and, unusually, understated — I
traced the branch to confirm. No scope drift.

## The finding that mattered — D-013
A derived slot states what it reads *twice*: once as `dependencies`, once as the real `read(...)`
calls inside `compute`. Nothing requires the two to agree, and `eval.ts` will build its
topological order from the declared half only. `add` gets this right (shared path constants),
but the type system can't enforce it generally, because `dynamic`'s real use case genuinely
needs to read other objects. Ruled **D-013**, now, before `eval.ts` exists: the `read` callback
`eval.ts` hands to `compute` MUST return `#REF` for anything not in the slot's declared
dependencies.

## Reviewer edits (3, small)
1. Moved `isErrorValue` from `schema.ts` to `graph/node.ts` (its body was byte-identical to
   `address.ts`'s `isAddressError`) — ruled **D-014**.
2. Added 5 tests for `isErrorValue` covering the whole `Value` union, including `null` and
   `Point[]` (both object-typed — the exact trap a naive copy falls into).
3. Added 1 test pinning `null` → `#TYPE` in `add`'s compute, answering the implementer's own Q2.

Post-edit: 83/83, both configs clean.

## Answers to implementer's questions
1. Scoping to derived-slots-only — right cut. Correction: when `mutation.ts` needs full
   slot-set declarations, they belong **in `schema.ts`**, not invented in `mutation.ts` — same
   reasoning as D-009.
2. `null`-input handling — not a gap, but worth pinning (edit 3). `#TYPE` is the right
   fail-closed answer; `add` is a Phase 0 fixture with no blank-cell semantics to match.

---

## Verdict: ACCEPT WITH EDITS

Declared slice delivered exactly; the constraints most at risk of being quietly skipped (the
`dynamic` form, `value`'s real empty entry) were both honoured with reasons attached. D-013 is a
hazard the implementer couldn't reasonably have closed from inside this file — enforcement
belongs in `eval.ts`, which doesn't exist yet, so it's ruled before that module is written.
**`graph/cycles.ts` and `graph/eval.ts` may begin.**

### Constraints carried forward
1. D-013 binding on `eval.ts` — enforce mechanically, test that an undeclared read gets `#REF`.
2. Derived slots evaluate INSIDE the topological pass — no `recompute()`, ever.
3. Call `derivedSlotDependencyAddresses` at edge-derivation time only (Rule 6).
4. L-9 — the Phase 0 acceptance fixture MUST use formula input slots; copy `node.test.ts`'s.
5. Cycle rejection must name every slot; prior state must be provably unchanged (§6) — both need
   a test whose name says which property it defends.
6. D-014 — import `isErrorValue` from `graph/node.ts`; no local copies.
