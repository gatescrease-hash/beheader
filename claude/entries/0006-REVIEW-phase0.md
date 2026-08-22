# 0006 — REVIEW (phase 0, mid-phase)
Date: 2026-08-21   Phase: 0   Model: reviewer (Claude Opus 5)
Previous entry: 0005-graph-node-edge   Reviewing: cycle 0005
Prior review: 0004-REVIEW-phase0 (verdict: ACCEPT WITH EDITS)

Scope: cycle 0005 — `graph/node.ts`, `graph/edge.ts`, `formula/ast.ts`, and the D-009 rewiring
of `address.ts`.

---

## 1. Rule audit

| Rule | Verdict |
| --- | --- |
| **Rule 1** — `engine/` is pure, no DOM/window/canvas/`render/` | **UPHELD.** Grepped all new files; five hits, all prose (four are the file-header "NEVER imports" boilerplate, one is §5.1's own product phrase "a user-visible thing on the canvas"). The engine tsconfig (D-006) passes, which is now the real enforcement. |
| **Rule 2** — all state change through `mutation.ts` | **NOT TOUCHED.** These are type declarations plus three pure lookup functions. Nothing mutates. |
| **Rule 3** — addressing is load-bearing | **UPHELD.** The D-009 rewiring is correct and, importantly, did not regress addressing: all 44 address tests still pass unchanged. |
| **Rule 4** — one formula engine | **NOT TOUCHED** (and correctly *not* pre-empted — see §5 on `formula/ast.ts`). |
| **Rule 5** — performance is a non-goal | **UPHELD.** `resolveSlot` does a linear `find` over the object array with no index. Correct. |
| **Rule 6** — slot set fixed during evaluation | **NOT TOUCHED**, but the data model is shaped to permit it: slot cardinality lives in `GraphObject.slots`, which only a mutation can rebuild. Nothing here lets evaluation add or remove a slot. |
| **Rule 7** — no §8 deferred items | **UPHELD.** |

## 2. Invariant audit

- **Graph state plain, serializable, ID-referenced** — UPHELD, and this is the cycle's
  strongest point. `GraphObject.slots` is a plain `Record`, not a `Map`. Every field is
  `readonly`. `Edge` holds two `Address`es (IDs), not object references. No closures, no class
  instances. This would serialize and port to Rust unchanged.
- **The three slot kinds match §5.1's table exactly** — UPHELD. `literal` (stored constant),
  `formula` (stored AST), `derived` (no user-settable content field at all — the type system
  makes writing one impossible, which is a stronger guarantee than a runtime check).
- **`Value` union matches §5.1** — UPHELD, verified member by member:
  `number | string | boolean | Point | readonly Point[] | null | ErrorValue`. The `readonly` on
  `Point[]` is a strengthening consistent with the plain-data rule, not a deviation.
- **No `#CYCLE` error code** — UPHELD and documented with its reason (cycles are rejected at
  mutation time, never enter the graph as state). This is a spec detail models routinely
  "helpfully" add; it was correctly not added.
- **`ObjectType`'s eight product types are transcribed, not invented** — VERIFIED against
  §5.10's command list: `circle`, `polygon`, `polyline`, `rect`, `text`, `table`, `script`,
  `image`. Exactly the eight commands that create objects. Accurate.
- **`GraphObject` covers §5.1's "stable ID, a type, a user-facing name, and a set of slots"** —
  UPHELD, all four. I checked §5.11's serialization list for a missing field and found none:
  "style" is not a separate field because §5.1 lists `fillColor` as an example *slot*, so style
  properties are slots like any other. Correct.

## 3. Spec conformance

No deviations found. I went looking specifically at the places where a model normally
over-normalises the brief and found the opposite each time — the `#CYCLE` omission, the
`derived`-has-no-content-field shape, and the eager/lazy distinction being left untouched
rather than pre-empted.

## 4. Legibility audit

Strong. File headers in the §5.2 format on all three new modules, each with an explicit
"NOT DONE HERE". Vocabulary locked. Spec sections cited at the point of the claim, not
vaguely. Tests named as behaviour sentences.

Two items worth recording, neither blocking:

- **L-6 — `TABLE_TYPE`'s annotation widens its type.** `export const TABLE_TYPE: ObjectType =
  "table"` gives it the full union type; dropping the annotation (or `as const`) would infer
  the literal `"table"` while remaining assignable to `ObjectType`. No behavioural difference
  today — every use is an equality comparison — so this is precision lost, not correctness.
  Fold it in whenever `node.ts` is next open; not worth a commit on its own.
- **L-7 — the `slotKey` collision-freedom argument is asserted, not enforced.** The header's
  reasoning is sound *for paths that came through `parseAddress`*, but `getSlot`/`slotKey`
  accept any `string[]`, and `GraphObject.slots` can be built with literal keys. A hand-built
  `"a.b"` would silently alias the real path `["a","b"]`. Ruled as **D-010** (discipline, not
  a runtime check — the cheap half of the fix, per Rule 5).

## 5. Honesty audit

**Clean.** Independently re-verified:

- `npm run typecheck` → exit 0, both configs. ✓
- `npm test` → 61/61, 0 skipped, 3 files. ✓ Arithmetic checks out: 44 pre-existing + 15 + 2.
- The Rule 1 grep hits are genuinely all prose — I re-ran the grep and read every hit rather
  than accepting the summary. ✓
- The single `any` grep hit really is the English word "any" in a sentence, not a type. ✓
- `address.test.ts`'s only change is the helper's type annotation; no assertion changed, so
  the entry is right that **§6.6 does not fire**. Verified by diff. ✓

**The type-only circular import claim — verified, and my first attempt to check it was wrong.**
The entry claims `graph/node.ts`'s import of `address.ts` is fully erased, leaving a
one-directional runtime dependency. I tried to confirm with `esbuild --loader=ts`, which
errored; the empty output looked like confirmation and I nearly recorded it as such. Re-running
it correctly gives the real answer:

```
graph/node.ts transpiled →  (no import/require lines at all)
address.ts   transpiled →  import { TABLE_TYPE } from "./graph/node.ts";
```

So the claim is **accurate**: runtime direction is `address.ts` → `graph/node.ts`, one way.
Recording my own bad check here because an empty result that agrees with the claim under
review is exactly the trap this audit exists to catch.

No scope drift: `primitives/schema.ts` was correctly left alone despite being the obvious
next thing. Q-005 was raised rather than guessed past. The entry's "Where I got stuck" flags
the `value`/`add` schema-registry consequence unprompted — that became D-011.

## 6. Observation not acted on: the type-level mutual dependency

`address.ts` and `graph/node.ts` now reference each other's types (runtime dependency is
one-way, as verified above). My first instinct was to extract the shared vocabulary
(`ObjectType`, `Value`, `ErrorValue`) into a dependency-free module and break it entirely.

I decided against it, and record the reasoning so it is not silently re-opened. The brief
targets `src/engine/` at a future Rust **crate** (§2), and circular type references *within* a
crate are normal and legal in Rust — so this is not the port hazard it first looks like. The
concrete cost is one documented landmine (STATUS.md: don't add a value import back the other
way), not a correctness or portability problem. Speculatively restructuring a two-module
layout to pre-empt a third consumer that may never need it fails PROCESS_BRIEF §13's
"smaller diff" and "simplest to delete later" tests.

**Trigger for revisiting:** if a module ever needs `ObjectType` or `Value` *without* needing
`GraphObject`, extract the vocabulary then. `address.ts` is currently the only such module and
it is already wired.

## 7. Answers to the implementer's questions

**Q1 — should `value`/`add` be in `ObjectType`, or carved out before `schema.ts` keys on it?**
Keep them in. Ruled as **D-011**. Command-line reachability is decided by §5.10's command
registry having no entry for them — it is not a data-model property and must not be expressed
by excluding them from the type. A separate fixture union would force the schema registry to
handle two unions and convert between them, and would make the Phase 0 fixtures second-class
exactly where §6 wants them load-bearing. `schema.ts` must give both real entries; `add` needs
a genuine derived `out.result`, since it is *the* designated derived-slot fixture.

**Q2 — does `explode` change type to `polyline`, or is there a separate path type?**
`polyline`. Ruled as **D-012**. §5.5 introduces editable paths as "polyline, or any exploded
preset" — one category with one slot exposure. A separate type would duplicate `polyline`'s
schema exactly. The interpretation in `node.ts`'s doc comment is correct. One consequence to
*not* "fix" later: after explode, an object named `polygon_1` will have type `polyline`. That
is required by D-007's identity preservation and is correct.

**Q3 — should `AddressError` formally extend `ErrorValue`, or is documentation enough?**
Documentation is enough — do **not** add the formal tie. I verified with a throwaway probe
that `AddressError` is *already* assignable to both `ErrorValue` and `Value` with no
declaration change (structural typing, since `"#REF"` is a member of `ErrorCode`), so a formal
`extends` would buy zero functional capability while making `address.ts` import a value-model
type from `graph/node.ts` — deepening exactly the coupling discussed in §6. The implementer's
instinct was right.

**Q4 — was the Q-005 provisional `FormulaAst` the right call, or should `FormulaSlot.ast` have
stayed less concrete?** Right call — **approved, proceed on it** (noted in `OPEN_QUESTIONS.md`
so it does not read as a live risk). §6's Phase 0 fixture requires formula slots, so
`FormulaSlot` must hold something; deferring meant either a useless slot kind or omitting one
§5.1 mandates from the start. `ReferenceNode` is the brief's own construct, not an invented
grammar (§5.1: a binding is "just the degenerate formula `= other.slot`"). Creating
`formula/ast.ts` ahead of its §6 slot is not a phase-order violation — Phase 1 is the
lexer/parser/evaluator, not a type declaration. **Binding constraint: Phase 1 widens this
union, never replaces it.**

## 8. Forward constraint for `document.ts` (not a defect now)

`DerivedSlot.value` is a required field, but §5.11 says "**Derived slot values are never
serialized** — they are regenerated by a full evaluation pass on load." So load must construct
derived slots with a placeholder before evaluation runs. `null` is in `Value` and is the
obvious choice, but nothing has written that down. Whoever builds `document.ts` should make it
explicit rather than discovering it. Flagging here so it is not a surprise.

---

## Verdict: ACCEPT

No reviewer edits. Cycle 0005 is the cleanest cycle of the project so far: the data model
matches §5.1 member for member, the invariants that matter for the Rust port (plain,
serializable, ID-referenced) are upheld without being asked twice, the spec details most
likely to be quietly normalised away were preserved with their reasons attached, the log is
accurate against the diff, and all four questions raised were real judgment calls rather than
requests for reassurance.

The one thing I would have written differently — extracting the shared vocabulary — I talked
myself out of on the brief's own terms (§6 above), and the two legibility items (L-6, L-7) are
a lost `as const` and a discipline gap now covered by D-010.

**`primitives/schema.ts` may begin.**

### Constraints carried into the next cycle

1. **D-011** — `schema.ts` provides real entries for `value` and `add`; `add` needs a genuine
   derived `out.result` slot. It is the fixture §6 uses to prove derived slots evaluate inside
   the topological pass.
2. **D-010** — schema declarations name slots by **path**, never by a hand-built key string.
3. **D-005/D-009** — when the schema registry can express a type's slot families, move
   `address.ts`'s hardcoded table/`cells` mapping onto it.
4. **The derived-slot rule is the one to get right**: §5.1 requires derived slots be evaluated
   *inside* the topological pass. There is no `recompute()` phase. `schema.ts` declares the
   dependencies that make that ordering possible — static lists now, but the dynamic form
   (§5.1: `text.resolvedContent`, `script.out.*`) must be expressible, because two later
   primitives require it.
5. **D-008's lesson still applies** — test the unspecified cases, not just the brief's examples.
