# STATUS — as of entry 0025-REVIEW-phase0

STATE: GREEN to build on, but **the Phase 0 gate is NOT signed off** (compiles under both configs,
193/193 tests pass, 0 skipped, 0 `.only`; no test pins known-broken behaviour).

Current phase: 0 — Graph core (headless, no pixels)
Last review point: **0025-REVIEW-phase0, verdict REVISE.** Clauses 1–3 closed; **clause 4 is NOT**
— a document `mutate` accepts does not round-trip identically, because the mutation journal escapes
D-025. Read that entry's findings and fix list before writing any code.

## Next slice — the REVISE fix list, in order, and nothing else
1. `mutate` rejects an operation whose PAYLOAD carries an illegal value, before staging — a
   precondition on the operation (like D-021's target check), not another pass over the post-fold
   graph. A payload that never survives the fold still enters the journal.
2. `deserializeDocument` closes the same hole on the read side — a loaded journal never passes
   through `mutate`, so fix 1 does not reach it. Validate journal payload values on load, or reject
   the document; state which and test it.
3. Settle **Q-008** (`-0`) and enforce it in the same predicate as fix 1. `PROVISIONAL(Q-008)` on
   recommendation (a) is acceptable if the human has not ruled.
4. Re-close clause 4 with a fixture whose JOURNAL carries the same value vocabulary the object list
   does, plus `expect(saveDocument(loaded)).toBe(json)` — one line, catches the whole class.
5. Then re-claim the Phase 0 gate in a cycle that does nothing else.

**Phase 1 (formula engine) MUST NOT start until the gate is signed off** (§6.1 trigger 1).

## Built
- Scaffold: `package.json`, both tsconfigs (strict + DOM-free, D-006), Vitest. `node_modules` is
  gitignored — run `npm install` if `npm run typecheck`/`npm test` fail on a missing `tsc`.
- `address.ts` (§5.2, 44 tests) — two-layer name/ID scheme, D-005 surface↔stored mapping keyed on
  the A1 form (D-008), exact `parseAddress`/`formatAddress` inverses, `findObjectById`.
- `graph/node.ts` (§5.1, 25 tests) — `Value`/`Point`/`ErrorValue`/`isErrorValue` (D-014),
  `hasNonFiniteNumber` (D-025), `ObjectType`/`TABLE_TYPE` (D-009/D-011), the three slot kinds,
  `GraphObject`, `slotKey`/`getSlot`/`resolveSlot`. Every field `readonly`.
- `graph/edge.ts` (§5.1, 6 tests) — `Edge`, `addressKey`. **Internal-only, D-015.**
- `formula/ast.ts` — one-variant `FormulaAst`. **`PROVISIONAL(Q-005)`**, approved 0006-REVIEW.
- `primitives/schema.ts` (§5.1, 21 tests) — `derivedSlotDependencyAddresses`, `getObjectSchema`,
  `findDerivedSlotSchema`, `ObjectSchema.nonDerivedSlotPaths`; `value`/`add` entries. `add`'s
  compute maps a non-finite sum to `#TYPE` itself (D-025) — the ONLY guard on a freshly computed
  derived value; see Gotchas.
- `graph/cycles.ts` (§5.1 step 5, 11 tests) — `detectCycle(edges)`, from-scratch DFS.
- `graph/eval.ts` (§5.1 step 7, 11 tests) — `evaluate(objects, edges)`, one topological pass over
  an edge set ASSUMED acyclic; all three slot kinds; D-013 enforced mechanically.
- `mutation.ts` (§5.1's full loop, 59 tests) — `deriveEdges`; `validateIntegrity` running FOUR
  checks in order (D-017 undeclared slot → D-018 both directions of schema↔slot reconciliation →
  dangling reference → D-025 non-finite value); `deriveValidateAndEvaluate`;
  `mutate(objects, operations, journal)` — batch form (D-020), one clone (D-019), one validation/
  evaluation pass, one journal entry with payloads cloned (D-024). **Three operation kinds**:
  `SetSlotOperation`, `DeleteObjectOperation` (0022), `CreateObjectOperation` (0024). Target
  existence is decided by ONE fold-aware `Set<id>` simulation (**D-026**).
- `document.ts` (§5.11, 16 tests, 0024) — `Document`, `serializeDocument`/`deserializeDocument`,
  `saveDocument`/`loadDocument`. Loading rebuilds every object as a `CreateObjectOperation` and
  calls `mutate` in ONE batch; a zero-object document bypasses `mutate` entirely. `CameraState` is
  **PROVISIONAL(Q-007)** — approved 0025-REVIEW.

## Acceptance criterion, clause by clause
1. Topological propagation including derived slots — **PASSING** (0012-REVIEW).
2. Cycle rejected, offending slots named, prior state provably unchanged — **PASSING** (0017,
   accepted 0018-REVIEW).
3. Deleting a slot with dependents is rejected — **PASSING** (0022, accepted 0025-REVIEW). Uses
   `validateIntegrity`'s existing dangling-reference check; names EVERY dependent (§5.1.1).
4. Document round-trips to JSON identically — **NOT PASSING** (0025-REVIEW finding 1). The object
   half is sound; the journal half is not. See the fix list.

## Known problems
- **The journal is the least-guarded field in the document** — D-025 is not enforced over operation
  payloads (write side) or over a loaded file's journal (read side), and `deserializeDocument`
  checks only `Array.isArray`. Fix list items 1–2. Until then, do not treat a saved journal as
  faithful history.
- **`-0` (Q-008)** — accepted by `mutate`, becomes `0` across a save/load. Fix list item 3.
- **L-16** — nothing enforces `nonDerivedSlotPaths`/`derivedSlots` paths are disjoint on one type.
  Fix: one registry-wide `slotKey`-compared test (D-010). Open.
- **L-17 / L-18** — `deriveEdges` shares path-array references with the registry (harmless) and
  does not deduplicate (both consumers tolerate it).
- **L-14** — `eval.ts`'s two `ErrorValue` messages name no slot; a real gap for §5.9's error badges.
- **§5.11's `style` field** has no data-model counterpart yet; the serializer is field-by-field, so
  it will silently drop `style` unless whoever adds it also adds it there.
- **`nextObjectId` is not reconciled against a loaded file's ids** — fails loudly later
  (`createObject` rejects a duplicate), but Phase 3's minting must consult the object list.
- **Two functions can reject a mutation** — `validateIntegrity` (about the graph) and `mutate`
  (about an operation's preconditions). Correct; the file header says so. Not a defect.
- **L-6 – L-15, carried** — cosmetics (0006/0008/0010/0012-REVIEW §4). Fold in when nearby: **L-8**
  (into L-16's test), **L-10** (`addressKey` assumes `obj_<n>` ids — wants a note in `document.ts`).
- **Recursion depth** — `detectCycle`/`evaluate`/`deepClone` all recurse. Fine at brief scale; watch
  it now that `document.ts` can load an arbitrarily long chain.
- Table/`cells` mapping in `address.ts` still hardcoded; `nonDerivedSlotPaths` cannot express a slot
  family. Both wait on `schema.ts` expressing families (D-005 §4, D-009). **Do not extend
  `nonDerivedSlotPaths` to tables** (D-017's forward note).
- **SETTLED, do not re-raise:** flat `claude/` layout; shared vocabulary out of `graph/node.ts`;
  unifying `isErrorValue`/`isAddressError` (D-014); inverting a `slots` key to recover a KNOWN
  slot's path; `describeUndeclaredSlot`'s raw-key naming (D-022); collapsing §5.1.1's two clauses
  into one `resolveSlot` check; one-directional schema↔slot reconciliation (D-018); the JSON-based
  clone (D-019); a nonexistent-object operation as a no-op (D-021); single-operation `mutate`
  (D-020); suppressing an unresolvable object's id from a message (D-023); a payload or journal
  entering committed state by reference (D-024); checking batch targets only against the pre-batch
  `objects` (D-026); whether clause 3 needed a new rejection mechanism (it did not — 0022);
  whether non-finite numbers are legal state (D-025 — they are not); a second, parallel identity
  check beside the existence simulation (D-026).

## Live PROVISIONAL tags and open questions
**`PROVISIONAL(Q-005)`** → `formula/ast.ts`, `graph/eval.ts`, `mutation.ts`. Approved 0006-REVIEW.
**`PROVISIONAL(Q-007)`** → `document.ts`'s `CameraState`. Approved 0025-REVIEW; Phase 3 WIDENS it,
never replaces it. **Q-008** (`-0`) OPEN and on the fix list. **Q-006** ANSWERED → D-025 (human).
**Q-001/Q-002** (Phase 3), **Q-004** (Phase 2) deferred; **Q-003** ANSWERED → D-007.
Next free: **Q-009**.

## Gotchas for the next model
- **`mutate` checks the post-fold GRAPH, never the operations' payloads.** That is why an illegal
  value can reach the journal while committed state stays clean (0025-REVIEW finding 1). Fix list
  item 1 is where that changes; until it does, do not assume "accepted" means "every payload was
  legal."
- **`document.ts` trusts `mutate` for graph legality and only shape-validates what `mutate` cannot.**
  Right boundary — with one hole: the journal is the field `mutate` never sees.
- **Object identity inside a batch is ONE `Set<id>` simulation** (D-026). `setSlot`/`deleteObject`
  require presence, `createObject` requires absence and ADDS the id. Any future kind that changes
  identity extends that same walk — never a second mechanism, never a check against the pre-batch
  `objects`.
- **Deleting an object needed NO new rejection check** — `validateIntegrity`'s dangling-reference
  check already is the mechanism, and it names every dependent (§5.1.1).
- **`validateIntegrity` runs BEFORE `evaluate` and never re-checks its output.** So a compute
  function's own guard is the ONLY protection against a non-finite freshly-computed derived value;
  every future compute that does arithmetic must map overflow to `#TYPE` itself. (A doc-comment
  overclaim to the contrary was caught and fixed at 0023, before commit.)
- **A derived slot's load-time placeholder is provably unobservable** — `evaluate` overwrites it
  inside the same `mutate` call. Don't try to write a test that distinguishes it.
- **A zero-object document must bypass `mutate`** — D-020's empty-batch rejection would otherwise
  make an empty document unloadable. Mutation-tested at 0024.
- **Mutation-testing proves a mechanism is load-bearing, not that it is correct.** Ask both: would
  removing it fail a named test, *and* does it do its job for every input its types admit? D-019,
  D-024, and now the journal half of D-025 all passed the first question and failed the second.
- **A plausible claim written as a proof is this project's recurring defect** — five instances now,
  three of them caught by the implementer before review. If a comment says "X cannot happen because
  Y", probe Y.
- **A fixture that LOOKS like it tests a thing may not.** 0020's "last write wins" batch; 0024's
  round-trip journal, which was carried through the test without being tested.
- **The clone is load-bearing AND faithful** — never `JSON.parse(JSON.stringify(...))` for graph
  state (D-019), never `structuredClone` (D-006).
- **PROCESS_BRIEF §8.1's `grep "document\."` Rule 1 check now hits `document.ts`'s own parameter.**
  Not violations — the real guard is `tsconfig.engine.json`, which is a compiler check.
- **Cyclic input to `evaluate` fails SILENTLY** — step 5 before step 7 is load-bearing; no defensive
  cycle check inside `eval.ts`.
- **`GraphObject`, not `Object`**; **`address.ts` ↔ `graph/node.ts` share TYPES only**;
  **`Value`/`Point`/`ErrorValue`/`isErrorValue`/`hasNonFiniteNumber` live in `graph/node.ts`** —
  never redefine (D-014).
- **Slot keys only from `slotKey()`** (D-010); **document-wide keys only from `addressKey()`**
  (D-015). User-facing slot names come from `formatAddress` — exceptions: D-022, D-023.
- **The schema registry stores FUNCTIONS and that is correct** (0008-REVIEW §2).
- Each PowerShell call is a fresh process; the Bash tool's `npm` is not on PATH — use PowerShell.
