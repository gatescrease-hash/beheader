# 0006 — REVIEW (phase 0, mid-phase)
Date: 2026-08-21   Phase: 0   Model: reviewer (Claude Opus 5)
Previous entry: 0005-graph-node-edge   Reviewing: cycle 0005
Prior review: 0004-REVIEW-phase0 (verdict: ACCEPT WITH EDITS)

Scope: `graph/node.ts`, `graph/edge.ts`, `formula/ast.ts`, the D-009 rewiring of `address.ts`.

## Rule audit
Rule 1 — UPHELD, engine tsconfig passes. Rule 3 — UPHELD, D-009 rewiring didn't regress
addressing (44 address tests untouched). Rules 2/4/6/7 — not touched / upheld.

## Invariant audit
Graph state plain/serializable/ID-referenced — UPHELD, and this is the cycle's strongest point
(`GraphObject.slots` a plain `Record`, all fields `readonly`, no `Map`s, no closures). The three
slot kinds match §5.1 exactly — `derived` has no user-settable content field at all, a stronger
guarantee than a runtime check. No `#CYCLE` value — correctly absent.

## Legibility
Strong; headers explicit about what's NOT done here. Two items: **L-6** — `TABLE_TYPE`'s type
annotation widens away its literal type (cosmetic). **L-7** — `slotKey`'s collision-freedom
argument is asserted, not enforced against a hand-built key — ruled **D-010**.

## Honesty audit
Clean, independently re-verified (61/61, arithmetic checks out). The type-only-circular-import
claim is accurate — verified by transpiling both files and reading the actual output, catching my
own first (wrong) check along the way. No scope drift: `schema.ts` correctly left alone despite
being the obvious next thing; Q-005 raised rather than guessed past.

## Observation, not acted on
`address.ts` and `graph/node.ts` now reference each other's types. Considered extracting shared
vocabulary into a dependency-free module; declined — the brief targets `engine/` at a future Rust
*crate*, where this kind of intra-crate reference is normal, and restructuring two modules to
pre-empt a third consumer that may never exist fails PROCESS_BRIEF's own "smaller diff" tie-break.
Revisit only if a module needs `ObjectType`/`Value` without needing `GraphObject`.

## Answers to implementer's questions
1. `value`/`add` stay in `ObjectType` — ruled **D-011**; `schema.ts` needs real entries for both,
   `add` needs a genuine derived `out.result`.
2. `explode` → type `polyline`, no separate path type — ruled **D-012**.
3. `AddressError` formally extending `ErrorValue` — no, documentation is enough (verified
   structural assignability already holds with no declaration change).
4. Q-005's provisional `FormulaAst` — right call, **approved**. Binding: Phase 1 widens the
   union, never replaces it.

## Forward constraint for `document.ts`
`DerivedSlot.value` is required but §5.11 says derived values are never serialized — load must
place a `null` placeholder before evaluating. Not a defect now; flagged so it isn't a surprise.

---

## Verdict: ACCEPT

Cleanest cycle so far — data model matches §5.1 member for member, port-relevant invariants held
without being asked twice, spec details most likely to be quietly normalised (the `#CYCLE`
omission, derived-has-no-content-field) were preserved. **`primitives/schema.ts` may begin.**

### Constraints carried forward
1. D-011 — real `value`/`add` schema entries; `add` needs a genuine derived `out.result`.
2. D-010 — schema declarations name slots by path, never a hand-built key.
3. D-005/D-009 — move `address.ts`'s hardcoded table/cells mapping onto the schema once it can
   express it.
4. Derived slots evaluate *inside* the topological pass — no `recompute()`. The dynamic
   dependency form (`text.resolvedContent`, `script.out.*`) must be expressible now.
5. D-008's lesson still applies — test the unspecified cases.
