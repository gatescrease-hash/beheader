# 0167 — D-141's data-model slice: script ports, and `derivedSlots` widened to static/dynamic
Date: 2026-09-03   Phase: 6   Model: claude-sonnet-5
Previous entry: 0166-REVIEW-phase6   Last review: 0166-REVIEW-phase6 (verdict: ACCEPT WITH EDITS)
Batch: cycle 1 of up to 3 since last review; ~635 lines / 14 files changed (src only: 711 added / 76 removed).

## Declared scope

D-141 clause 7's data-model slice, and NOTHING past it: `graph/node.ts` (the structural `ports`
field), `primitives/schema.ts` (`derivedSlots` widened to `static`/`dynamic` groups, mirroring
`nonDerivedSlotPaths`), `mutation.ts` (`AddPortOperation`/`RemovePortOperation`, the two new
operation kinds D-141 clause 6 requires), and `document.ts` (serialize/deserialize `ports`, and
`withSchemaDerivedSlots` resolving per OBJECT). Every one of the seven `derivedSlots` read sites
D-141 names (`mutation.ts` ×3, `document.ts` ×2, `graph/eval.ts`, `command/commands.ts`,
`command/props.ts` — eight call sites across those seven files) migrated to `resolveDerivedSlots`
in this same cycle, per clause 7's "every existing read site migrated and green."

## Explicitly not in scope

- **`engine/script/stub.ts`, `SCRIPT_SCHEMA`, and §5.10's `script` command.** D-141 clause 7 is
  explicit that these are a SEPARATE slice, and that `engine/script/`'s first file is its own §6.1
  trigger 2 review point. Nothing under `engine/script/` exists after this cycle.
- **§5.8's `placeholders: Record<string, Value>` and its two-way reconciliation against
  `ports.out` (D-141 clause 3).** That reconciliation is about a `script` object's VALUES, which
  has nowhere to live without `SCRIPT_SCHEMA` — building it now would be building ahead of the
  slice that owns it.
- **Phase 6's acceptance criterion itself.** Nothing here binds `script_1.in.factor` to a cell or
  makes a polygon move — this cycle only builds the data model the script node needs to exist at
  all, exactly what its own scope statement says.

## What I did

**`src/engine/graph/node.ts`** — `GraphObjectPorts` (`{ in: readonly string[], out: readonly
string[] }`), `isLegalPortName` (non-empty, no `.`), and an optional `ports?: GraphObjectPorts`
field on `GraphObject`. Plain, ID-free, serializable data — the structural home D-046's scope note
already anticipated.

**`src/engine/primitives/schema.ts`** — `DerivedSlotGroup` (`static { slots }` | `dynamic {
enumerate(object) }`), the exact shape `NonDerivedSlotPathGroup` already has, and
`resolveDerivedSlots(object, groups)`, its resolver. `ObjectSchema.derivedSlots` widened from
`readonly DerivedSlotSchema[]` to `readonly DerivedSlotGroup[]`; every existing schema's
`derivedSlots` array wrapped in one `{ kind: "static", slots: [...] }` group (`value`, `add`,
`table`, `circle`, `polygon`, `rect`, `text`, `image` — all eight). `findDerivedSlotSchema` now
takes the whole `object`, not merely its `type`, so a future `dynamic` group can resolve against
it. Header updated at three places (D-137): the `nonDerivedSlotPaths` paragraph gained a D-141
sibling paragraph, NOT DONE HERE's `script` note now says the mechanism exists rather than saying
Q-026 blocks it, and `findDerivedSlotSchema`'s own doc comment explains why it takes an object now.

**`src/engine/mutation.ts`** — `AddPortOperation`/`RemovePortOperation` (D-141 clause 6), widening
`Operation` to nine kinds. `applyOperation` gained two branches: `addPort` appends to the named
family's list (creating `{ in: [], out: [] }` implicitly if `ports` was absent); `removePort`
removes the name AND drops the corresponding `in.<name>`/`out.<name>` slot if present — no separate
reject-if-referenced mechanism, because dropping an out port's slot is exactly what makes
`validateIntegrity`'s EXISTING dangling-reference check (§5.1.1 clause 1) reject the whole batch
when something else still points at it, the same way `delete <object>` without `force` already
works. `findInvalidPortOperations` (new, called from `mutate` before staging) simulates the batch
left-to-right (D-050's posture): rejects an illegal name, a duplicate within the SAME family, or
removing a name that is not there — and, symmetrically to `findInvalidNames`, ALLOWS a batch that
removes then re-adds the same name in one call. The three `schema.derivedSlots` reads inside this
file (`deriveEdges`'s Source 2, `findUndeclaredFormulaOrDerivedSlots`, `findSchemaSlotKindMismatches`)
now call `resolveDerivedSlots(object, schema.derivedSlots)`. Header's operation-kind count and
precondition count both updated (nine kinds, eight preconditions) — D-137.

**`src/engine/document.ts`** — `SerializedGraphObject.ports?` (serialized unchanged, absent when
the object has none); `reconstructObject` parses an optional `ports` field via the new
`reconstructPorts` (structural validation only: each of `in`/`out` an array of legal, per-family-
unique names — `undefined` is the legal, expected case for every document saved before this
ruling, D-126's own posture extended to a new field). `withSchemaDerivedSlots` now takes the whole
`GraphObject` rather than a bare `type`, so it can hand `resolveDerivedSlots` a real object.

**`src/command/commands.ts`** — `resolveWritableSlot` and `declaresSlotPath`'s
`findDerivedSlotSchema` calls now pass `object` instead of `object.type`. `createObjectFromCommand`
resolves its derived-slot fill via `resolveDerivedSlots(objectSoFar, schema.derivedSlots)`.

**`src/command/props.ts`** — `buildSlotDescriptors`'s `schema.derivedSlots` loop now calls
`resolveDerivedSlots(object, schema.derivedSlots)`.

**`src/engine/graph/eval.ts`** — `evaluateDerivedSlot` resolves the schema's derived slots via
`resolveDerivedSlots(object, schema.derivedSlots)` before looking one up by key, instead of reading
`schema.derivedSlots` raw.

**Tests.** New: `node.test.ts` (`isLegalPortName`, `GraphObject.ports` optionality/shape — 5 tests);
`schema.test.ts` (`resolveDerivedSlots` exercised directly — static-only, static+dynamic
concatenation, a dynamic group resolved against `ports.out` rather than `Object.keys(object.slots)`
per D-010, and the empty-groups case — 4 tests, plus every existing `schema?.derivedSlots` read in
this file updated to resolve through a stub object); `mutation.test.ts` (`AddPortOperation`/
`RemovePortOperation` — append, family independence, illegal-name rejection, duplicate rejection,
slot-drop on remove, nonexistent-port rejection, the dangling-reference rejection for a referenced
out port, the remove-then-readd-in-one-batch legality, and the untouched-on-rejection guarantee —
10 tests); `document.test.ts` (`ports` absent/round-trips/malformed/illegal-name/duplicate/
cross-family-allowed/save-load-round-trip — 7 tests). Updated in place (no assertion weakened, only
re-plumbed through `resolveDerivedSlots`/an object argument): `interaction.test.ts`,
`renderer.test.ts` (×2), `geometry.test.ts`.

## Decisions I made

None requiring a ruling. Every choice here follows directly from D-141's own seven clauses; where
the ruling left a mechanical question open (e.g., exactly how `removePort` avoids a separate
reject-if-referenced check), I reasoned it through at the operation's own doc comment rather than
treating it as a fresh decision, and verified it holds by neutralisation (below) rather than by
assertion alone.

## Verification (real output)

```
$ npm run typecheck
> tsc --noEmit && tsc --noEmit -p tsconfig.engine.json
(no output — clean, both configs, D-006)

$ npm test
 Test Files  34 passed (34)
      Tests  1815 passed (1815)
   Duration  1.77s
(0 failed, 0 skipped; grep -rn "\.only|\.skip" src --include=*.test.ts returns nothing)

$ npx vite build
✓ 40 modules transformed.
dist/index.html                 10.56 kB │ gzip:  3.89 kB
dist/assets/index-cqWGuQWO.js  126.73 kB │ gzip: 37.54 kB
✓ built in 379ms
```

**Mutation checks — two neutralisations, one at a time, each reverted before the next, tree
confirmed identical after (`git diff` empty against the pre-check state):**

| neutralised | tests turned red | anything else red |
|---|---|---|
| `findInvalidPortOperations`'s call removed from `mutate` (the whole pre-staging port gate) | 4, named: illegal-name rejection, duplicate-in-family rejection, nonexistent-port-removal rejection, untouched-on-rejection | no |
| `removePort`'s slot-drop loop stopped excluding the removed port's own key (`existing !== key` dropped) | 2, named: the slot-drop-on-remove test AND the referenced-out-port dangling-rejection test | no |

The second is the load-bearing one: it is what proves D-141 clause 6's "no new mechanism" claim —
`validateIntegrity`'s EXISTING dangling-reference check is genuinely what rejects removing a
referenced out port, not a check this cycle merely asserts exists.

## Acceptance criteria status

**Phase 6's own criterion is untouched and unclaimed by this cycle** — nothing here builds a
`script` object, a `script` command, or anything `eval.ts` can evaluate. This cycle's own claim is
narrower and stated in full above: the data model D-141 rules for a script node's ports exists,
compiles, is exercised by real tests (not merely typed), and every pre-existing `derivedSlots`
consumer still agrees after the widening (proven by the full, unmodified 1789-test suite still
passing before these tests were added, then 1815 after).

## Where I got stuck / what is unfinished

Nothing. The slice was fully specified by D-141's seven clauses; the only judgment calls were
mechanical (how `removePort` avoids inventing a second dangling check, how `findInvalidPortOperations`
mirrors `findInvalidNames`'s left-to-right simulation) and are reasoned at their own sites.

## Open questions raised

None. Q-026 is answered (D-141) and stays answered; nothing here reopens it.

## Review point

**Fired: §6.2 (load-bearing files touched) and D-141 clause 7's own instruction** ("the data-model
change is its OWN slice... every existing `derivedSlots` read site migrated and green" — a phase-
gate-shaped instruction, §6.1 trigger 2's spirit even though no new SUBSYSTEM directory was
created). Four of §6.2's load-bearing files are touched in this one cycle: `graph/node.ts`,
`mutation.ts`, `document.ts`, `primitives/schema.ts`. Per the memory note on review verdicts, this
is **REVIEW: REQUIRED**, not RECOMMENDED — the objective trigger (§6.2 load-bearing touch, at this
scale, on a ruling that explicitly scopes itself as "its own reviewed batch") is unambiguous.

Batch position, for the record: cycle 1/3, ~635 lines / 14 files (cap 800/10, and this is close
enough to the line cap that the next slice — `engine/script/stub.ts` — should not be fused onto
this one even if the review comes back ACCEPT rather than ACCEPT WITH EDITS.
