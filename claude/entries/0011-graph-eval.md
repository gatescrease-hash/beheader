# 0011 — graph-eval
Date: 2026-08-22   Phase: 0   Model: implementer (Claude Sonnet 5)
Previous entry: 0010-REVIEW-phase0   Last review: 0010-REVIEW-phase0 (verdict: ACCEPT WITH EDITS)

## Declared scope
Build `src/engine/graph/eval.ts`: naive full topological evaluation over an
already-acyclic `Edge[]` (§5.1 step 7), interleaving all three slot kinds —
literal, formula (Phase 0's bare-reference AST only), and derived — in one
pass, with the D-013 read-restriction enforced mechanically. Colocated tests
only; no other file touched.

## Explicitly not in scope
`mutation.ts` (clone/validate/commit/journal), `document.ts` (round-trip),
and therefore the full Phase 0 acceptance criterion (cycle rejection, slot-
deletion rejection, and the document round-trip are not yet demonstrable).
Also out of scope: extending `primitives/schema.ts`'s registry, touching
`graph/cycles.ts` or `graph/node.ts`, and Phase 1's real formula grammar.

## What I did
- `src/engine/graph/eval.ts` — new. Implements §5.1 step 7 and Rule 5's
  naive-evaluation directive. Exports one function, `evaluate(objects, edges)
  => readonly GraphObject[]`:
  - Builds the full slot universe directly from `objects` (every key of every
    object's `slots`, not just edge endpoints) — Rule 6 requires every slot to
    be evaluated regardless of whether it appears in any edge (an isolated
    literal still needs a result).
  - Computes topological order via DFS postorder reversal, same traversal
    family and same `sourceSlot -> dependentSlot` direction as
    `graph/cycles.ts`, but simpler: assumes acyclic input (visited/unvisited
    only, no gray/white/black), per the constraint 0010-REVIEW carried
    forward — `mutation.ts` runs `detectCycle` before this is ever called.
  - Evaluates literal slots as their stored value unchanged; formula slots by
    resolving their `ReferenceNode` AST's address against this pass's
    already-evaluated values (Phase 0's entire "formula evaluation" —
    PROVISIONAL(Q-005)); derived slots by calling their schema's `compute`
    function, **inside this same pass**, interleaved with the other kinds —
    no `recompute()` anywhere in the file.
  - D-013: the `read` callback passed to a derived slot's `compute` is scoped,
    per call, to exactly the addresses `edges` already declares as that
    slot's dependencies (every edge whose `dependentSlot` is the slot's own
    address) — never by calling `derivedSlotDependencyAddresses` again inside
    the loop. An out-of-scope read returns a `#REF` `ErrorValue` directly,
    not the real value.
  - Never throws: a dangling formula reference, a derived slot with no
    matching schema entry, and a stale edge pointing at a slot outside this
    pass's universe are all handled by returning/skipping rather than
    indexing into `undefined`.
- `src/engine/graph/eval.test.ts` — new, 9 tests. Covers: the §6 value/add
  fixture propagating end-to-end and re-propagating from scratch on a literal
  change; a two-object literal→formula→derived→formula→derived chain proving
  derived slots participate in THIS pass rather than a second one; Rule 6
  (returned slot keys exactly match input); an isolated literal passed
  through unchanged, by reference; a dangling formula reference producing
  `#REF` without throwing, with the error propagating into a dependent
  derived slot; D-013 enforcement (an under-declared edge set causes an
  otherwise-valid dependency read to fail closed); a derived-kind slot with
  no matching schema entry; and a documentation-style test pinning that
  `eval.ts`'s internal node keys match `addressKey`'s own format exactly
  (see "Decisions I made" below).

## Decisions I made
- **No path-array reconstruction from a `GraphObject.slots` key.** The full
  slot universe is built by iterating `Object.keys(object.slots)` directly
  and keying nodes as `` `${object.id}::${key}` ``. Since `GraphObject.slots`
  is keyed by `slotKey(path)` (node.ts) and `addressKey` is
  `${objectId}::${slotKey(path)}` (edge.ts), this string is *already*
  `addressKey` for that slot's real address — there is no sanctioned inverse
  of `slotKey`, so I never split a key back into a path array anywhere. Where
  a real path is actually needed (a derived slot's own address, for the
  D-013 read-restriction and for matching it against the schema), I get it
  from the schema's own `DerivedSlotSchema.path` — never by decomposing the
  map key. I added a small documentation-style test pinning that the key
  format really does match `addressKey`'s output, since this equivalence is
  the thing the whole no-reconstruction design leans on.
- **D-013's declared-dependency set is read from `edges`, not re-derived.**
  0010-REVIEW's carried-forward constraint says `derivedSlotDependencyAddresses`
  must never be called inside the evaluation loop (Rule 6 / schema.ts's own
  header). So for a given derived slot, "what it's allowed to read" is
  computed by filtering the ALREADY-GIVEN `edges` for the ones whose
  `dependentSlot` is that slot's own address — exactly the set mutation.ts
  will have built via that same function at edge-derivation time. This also
  made the D-013 test straightforward to write without touching
  `primitives/schema.ts`: I fully wire `add`'s two inputs but hand `evaluate`
  an edge set that omits `in.b -> out.result`, so `add`'s own (well-behaved,
  already-reviewed) compute function's unconditional read of `in.b` is the
  thing that gets intercepted — no mock/malicious compute function needed.
- **`nextSlot` reuses the literal slot reference unchanged**, rather than
  constructing a new `{kind:"literal", value: slot.value}`. Literals never
  recompute (§5.1's table) — there is nothing to update, so I return the
  same object identity. Pinned by a `toBe` (not `toEqual`) test.
- **Rejected building a Kahn's-algorithm (indegree/queue) topological sort**
  in favor of DFS-postorder-reversal, to stay in the same traversal family as
  `graph/cycles.ts` (same three-color DFS lineage, same
  `sourceSlot -> dependentSlot` direction, same from-scratch-every-call
  discipline) rather than introducing a second, differently-shaped algorithm
  for the same underlying graph. Both are correct and equally "dumbest
  correct" under Rule 5; this one is the smaller conceptual diff against code
  already reviewed.

## Verification (real output)
$ npx tsc --noEmit
(exit 0, no output)
$ npx tsc --noEmit -p tsconfig.engine.json
(exit 0, no output)
$ npm test

```
 RUN  v2.1.9 C:/Users/William/Documents/Code Projects/beheader

 ✓ src/engine/graph/edge.test.ts (6 tests) 2ms
 ✓ src/engine/graph/node.test.ts (20 tests) 5ms
 ✓ src/engine/primitives/schema.test.ts (17 tests) 6ms
 ✓ src/engine/address.test.ts (44 tests) 8ms
 ✓ src/engine/graph/cycles.test.ts (11 tests) 4ms
 ✓ src/engine/graph/eval.test.ts (9 tests) 5ms

 Test Files  6 passed (6)
      Tests  107 passed (107)
```

98 pre-existing (44+20+6+17+11) + 9 new = 107. 0 skipped, 0 `.only`/`.skip`/`.todo`
(grepped across `src/`, no hits).

**Mutation check on the D-013 test**, same discipline 0010-REVIEW used on
`cycles.ts`: I temporarily removed the `declaredDependencyKeys` guard inside
`evaluateDerivedSlot`'s `read` callback (making it an unconditional
`evaluatedValues.get(key)`) and re-ran the suite:

```
 ❯ src/engine/graph/eval.test.ts (9 tests | 1 failed)
   × ... D-013 ... gets #REF, not the real value ...
     → expected { kind: 'derived', value: 15 } to match object { kind: 'derived', …(1) }
 Test Files  1 failed | 5 passed (6)
      Tests  1 failed | 106 passed (107)
```

Exactly and only the D-013 test failed (106/107, `out.result` came back `15`
instead of `#REF`). Reverted; re-ran — back to 107/107, both typechecks clean.

## Acceptance criteria status
Phase 0 criterion (§6, quoted): "you can build a graph in a unit test, bind
slots, mutate a value and watch it propagate in correct topological order
*including through derived slots*; a cycle is rejected with the offending
slots named **and prior state is provably unchanged**; deleting a slot with
dependents is rejected; and a document round-trips to JSON and back
identically."

- Propagation "in correct topological order including through derived
  slots" — **PASSING**. Demonstrated by
  `graph/eval.test.ts::"evaluate — PROJECT_BRIEF §6's value/add fixture"`
  (both its tests) and
  `graph/eval.test.ts::"evaluate — derived slots are evaluated INSIDE the
  same pass, not a separate post-pass"`.
- Cycle rejection naming the offending slots, with prior state unchanged —
  **NOT YET**. `graph/cycles.ts` (0009/0010) detects a cycle; nothing yet
  *rejects* a mutation or proves prior state survives, because `mutation.ts`
  does not exist.
- Slot deletion with dependents rejected — **NOT YET**. No deletion
  mutation exists yet.
- Document round-trip — **NOT YET**. `document.ts` does not exist yet.

Overall Phase 0 status: **still partial**, unchanged in kind from 0010's
assessment, but the propagation piece — arguably the mechanically hardest
part (derived-slot interleaving, D-013) — is now built and tested.

## Where I got stuck / what is unfinished
Not stuck, but one real design fork worth recording: I initially reached for
`findDerivedSlotSchema(type, path)` (schema.ts's existing lookup, which takes
a path array) to identify a derived slot during evaluation, then realized I
had no real path array to give it — only the `Object.keys(object.slots)`
map key, which schema.ts's `slotKey`-based lookup has no sanctioned inverse
for. Reconstructing one by splitting on `"."` would have worked arithmetically
(path segments can't contain `.`, per `PATH_SEGMENT_PATTERN`) but would have
duplicated `slotKey`'s join format outside `node.ts`, which is exactly the
kind of hand-rolled parsing D-010 rules against for the forward direction.
Iterating the schema's OWN `derivedSlots` array and matching by re-deriving
*its* key (`findDerivedSlotSchemaByKey` in the final file) sidesteps needing
an inverse at all. Flagging this because it's the one place in this cycle
where the "obvious" first move would have quietly reintroduced exactly the
kind of unsanctioned key-building D-010 forbids elsewhere.

`mutation.ts` is next per STATUS's own build order, and is a `REVIEW:
REQUIRED` trigger-2 file by definition — same as this cycle.

## Open questions raised
None. No ambiguity in the brief was hit this cycle; every design fork above
was resolved by an existing ruling (D-010, D-013, Rule 6) rather than a new
judgment call on load-bearing structure.

## Escalation triggers fired
- **§6 trigger 2** — modified/created a `graph/*` file (`graph/eval.ts`).
- **§6 trigger 3** — new file under `src/engine/` (`graph/eval.ts`).
- **§6 trigger 9** — diff is 561 source lines across 2 files (334 + 227),
  over the ~400-line guideline. Reporting this honestly rather than trimming
  test coverage to dodge the number: the file is one module (`eval.ts`) plus
  its full colocated test suite, matching the "one module plus its tests"
  definition of a single slice (PROCESS_BRIEF §3 step 2), and is comparable in
  shape to cycle 0009's `cycles.ts` + `cycles.test.ts` (353 lines, same
  trigger-2/3 status, not trigger-9). No other trigger this cycle turns on
  scope; this one is a byproduct of the file-header/docstring documentation
  standard (§5.2/§5.3) applied to a module with five distinct evaluation
  cases (three slot kinds, plus the two defensive fallbacks) each needing its
  own "why/guarantees/failure" comment.
- All other triggers (1, 4–8, 10): none fired. No phase criterion is being
  claimed complete (trigger 1 does not apply); nothing in the brief was
  deviated from or found ambiguous (4); no hard rule was worked around (5); no
  test's expectations changed, nor did any previously-passing test start
  failing (6); no dependency/build step/config added (7); no bug was
  attempted twice (8); nothing in §8's deferred list was approached (10).
