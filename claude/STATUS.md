# STATUS — as of entry 0026-phase0-revise-fix

STATE: GREEN. Compiles under both configs, 209/209 tests pass, 0 skipped, 0 `.only`, no test pins
known-broken behaviour. **The Phase 0 gate is claimed complete again — all four clauses PASS — but
this claim itself is UNREVIEWED. Do not start Phase 1 until a reviewer confirms it.**

Current phase: 0 — Graph core (headless, no pixels)
Last review point: **0025-REVIEW-phase0, verdict REVISE.** Clauses 1–3 were already closed; clause
4 was not — D-025 was never enforced over the mutation journal (finding 1), and two smaller
defects (findings 2-3) were fixed by the reviewer directly. Entry 0026-phase0-revise-fix closes the
whole REVISE fix list (items 1-4) in one cycle and re-claims the gate (item 5). **This entry is
itself the next required review point** — see below.

## Next slice — REVIEW REQUIRED first, then Phase 1
Entry 0026-phase0-revise-fix is unreviewed. Do not start Phase 1 (`formula/*`), and do not start
any further Phase 0 work, until a reviewer confirms clause 4 is genuinely closed this time. If
accepted, next slice is **Phase 1: `formula/*`**, standalone and heavily unit-tested,
`extractDependencies` from the start (PROJECT_BRIEF §6's build order).

## Built
- Scaffold: `package.json`, both tsconfigs (strict + DOM-free, D-006), Vitest. `node_modules` is
  gitignored — run `npm install` if `npm run typecheck`/`npm test` fail on a missing `tsc`.
- `address.ts` (§5.2, 44 tests) — two-layer name/ID scheme, D-005 surface↔stored mapping keyed on
  the A1 form (D-008), exact `parseAddress`/`formatAddress` inverses, `findObjectById`.
- `graph/node.ts` (§5.1, 27 tests) — `Value`/`Point`/`ErrorValue`/`isErrorValue` (D-014),
  `isIllegalNumber`/`hasIllegalNumber` (D-025/Q-006 + Q-008, renamed from `hasNonFiniteNumber` and
  widened at cycle 0026 — ONE predicate, not two), `ObjectType`/`TABLE_TYPE` (D-009/D-011), the
  three slot kinds, `GraphObject`, `slotKey`/`getSlot`/`resolveSlot`. Every field `readonly`.
- `graph/edge.ts` (§5.1, 6 tests) — `Edge`, `addressKey`. **Internal-only, D-015.**
- `formula/ast.ts` — one-variant `FormulaAst`. **`PROVISIONAL(Q-005)`**, approved 0006-REVIEW.
- `primitives/schema.ts` (§5.1, 21 tests) — `derivedSlotDependencyAddresses`, `getObjectSchema`,
  `findDerivedSlotSchema`, `ObjectSchema.nonDerivedSlotPaths`; `value`/`add` entries. `add`'s
  compute maps a non-finite sum to `#TYPE` itself (D-025) — the ONLY guard on a freshly computed
  derived value; needs no separate `-0` guard (Q-008 — its inputs are already legal, and `+` of two
  legal finite operands cannot produce `-0`); see Gotchas.
- `graph/cycles.ts` (§5.1 step 5, 11 tests) — `detectCycle(edges)`, from-scratch DFS.
- `graph/eval.ts` (§5.1 step 7, 11 tests) — `evaluate(objects, edges)`, one topological pass over
  an edge set ASSUMED acyclic; all three slot kinds; D-013 enforced mechanically.
- `mutation.ts` (§5.1's full loop, 68 tests) — `deriveEdges`; `validateIntegrity` running FOUR
  checks in order (D-017 undeclared slot → D-018 both directions of schema↔slot reconciliation →
  dangling reference → D-025/Q-008 illegal value); `deriveValidateAndEvaluate`;
  `mutate(objects, operations, journal)` — batch form (D-020), one clone (D-019), THREE
  pre-staging preconditions (empty-batch reject, D-021/D-026 existence simulation,
  **D-025/Q-008 payload legality — `findIllegalOperationPayloads`, cycle 0026**), one
  validation/evaluation pass, one journal entry with payloads cloned (D-024). **Three operation
  kinds**: `SetSlotOperation`, `DeleteObjectOperation` (0022), `CreateObjectOperation` (0024).
  Target existence is decided by ONE fold-aware `Set<id>` simulation (D-026).
- `document.ts` (§5.11, 21 tests) — `Document`, `serializeDocument`/`deserializeDocument`,
  `saveDocument`/`loadDocument`. Loading rebuilds every object as a `CreateObjectOperation` and
  calls `mutate` in ONE batch; a zero-object document bypasses `mutate` entirely. Journal VALUES
  (not shape) are checked for D-025/Q-008 legality on load — `rawContainsIllegalNumber`, cycle
  0026 — since a loaded journal never itself passes through `mutate`. `CameraState` is
  **PROVISIONAL(Q-007)** — approved 0025-REVIEW.

## Acceptance criterion, clause by clause
1. Topological propagation including derived slots — **PASSING** (0012-REVIEW).
2. Cycle rejected, offending slots named, prior state provably unchanged — **PASSING** (0017,
   accepted 0018-REVIEW).
3. Deleting a slot with dependents is rejected — **PASSING** (0022, accepted 0025-REVIEW). Uses
   `validateIntegrity`'s existing dangling-reference check; names EVERY dependent (§5.1.1).
4. Document round-trips to JSON identically — **PASSING (cycle 0026, UNREVIEWED).** 0025-REVIEW
   found this false by construction: a document `mutate` itself accepted did not round-trip its
   journal identically (D-025 was never enforced over journal payloads). Cycle 0026 closes both
   directions — `mutate` rejects an illegal operation payload before it can reach the journal
   (write side); `document.ts` rejects a loaded file whose journal already holds one (read side).
   Demonstrated by a fixture whose journal carries every member of `Value`, plus a literal
   `saveDocument(loaded) === json` text-equality check. **Needs reviewer confirmation before this
   clause is trusted again** — the previous claim of "all four PASS" (0024) was wrong about
   exactly this clause.

## Known problems
- **The journal's STRUCTURE is still deliberately unvalidated** beyond `Array.isArray` —
  `journal: ["garbage", 42, null]` still loads (no illegal NUMBER in it, and nothing replays the
  journal yet, so garbage shape is inert data). This is a stated, disclosed stance (see
  `document.ts`'s header), not a defect — distinct from journal VALUE legality, which cycle 0026
  closed.
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
  (about an operation's preconditions, now including payload VALUE legality as of cycle 0026, not
  only target existence). Correct; the file header says so. Not a defect.
- **L-6 – L-15, carried** — cosmetics (0006/0008/0010/0012-REVIEW §4). Fold in when nearby: **L-8**
  (into L-16's test), **L-10** (`addressKey` assumes `obj_<n>` ids — wants a note in `document.ts`).
- **Recursion depth** — `detectCycle`/`evaluate`/`deepClone` all recurse. Fine at brief scale; watch
  it now that `document.ts` can load an arbitrarily long chain.
- Table/`cells` mapping in `address.ts` still hardcoded; `nonDerivedSlotPaths` cannot express a slot
  family. Both wait on `schema.ts` expressing families (D-005 §4, D-009). **Do not extend
  `nonDerivedSlotPaths` to tables** (D-017's forward note).
- **SETTLED, do not re-raise:** flat `claude/` layout; shared vocabulary out of `graph/node.ts`;
  unifying `isErrorValue`/`isAddressError` (D-014); inverting a `slots` key to recover a KNOWN
  slot's path; `describeUndeclaredSlot`'s raw-key naming (D-022, now THREE call sites — see its own
  doc comment); collapsing §5.1.1's two clauses into one `resolveSlot` check; one-directional
  schema↔slot reconciliation (D-018); the JSON-based clone (D-019); a nonexistent-object operation
  as a no-op (D-021); single-operation `mutate` (D-020); suppressing an unresolvable object's id
  from a message (D-023); a payload or journal entering committed state by reference (D-024);
  checking batch targets only against the pre-batch `objects` (D-026); whether clause 3 needed a
  new rejection mechanism (it did not — 0022); whether non-finite numbers are legal state (D-025 —
  they are not); whether `-0` is legal state (Q-008, PROVISIONAL — it is not); whether
  `validateIntegrity`'s post-fold check alone was enough to enforce D-025/Q-008 (it was not — an
  operation's own payload needed its own precondition, cycle 0026); a second, parallel identity
  check beside the existence simulation (D-026).

## Live PROVISIONAL tags and open questions
**`PROVISIONAL(Q-005)`** → `formula/ast.ts`, `graph/eval.ts`, `mutation.ts`. Approved 0006-REVIEW.
**`PROVISIONAL(Q-007)`** → `document.ts`'s `CameraState`. Approved 0025-REVIEW; Phase 3 WIDENS it,
never replaces it. **`PROVISIONAL(Q-008)`** → `graph/node.ts`'s `isIllegalNumber` (one site — the
single predicate D-025 and Q-008 now share). Taken at cycle 0026, recommendation (a): `-0` is not
legal document state. **Q-006** ANSWERED → D-025 (human); both halves (object list AND journal) now
enforced as of cycle 0026.
**Q-001/Q-002** (Phase 3), **Q-004** (Phase 2) deferred; **Q-003** ANSWERED → D-007.
Next free: **Q-009**.

## Gotchas for the next model
- **`mutate` now has THREE preconditions before staging, not two**: empty-batch, D-021/D-026
  target existence, and (cycle 0026) D-025/Q-008 payload legality
  (`findIllegalOperationPayloads`). The third is why a batch like `[setSlot v=Infinity, setSlot
  v=5]` is REJECTED even though the fold's final value (5) is perfectly legal — the illegal
  INTERMEDIATE payload is what's rejected, regardless of what a later operation in the same batch
  would have done to it. Do not "simplify" this into only checking the post-fold graph; that is
  exactly the gap 0025-REVIEW-phase0 found.
- **`findIllegalSlotValues` (validateIntegrity check 4) and `findIllegalOperationPayloads` (mutate's
  precondition) are BOTH needed, checking DIFFERENT things** — the first the post-fold graph
  (catches an illegal value already sitting in `objects`, or one that survives to the end), the
  second the raw operations before any fold (catches one that does NOT survive — see the batch
  example above). Removing either one reopens a real hole; they are not redundant with each other
  despite both ultimately calling `hasIllegalNumber`.
- **`document.ts`'s journal check is a GENERIC untyped walk (`rawContainsIllegalNumber`), not a
  reconstruction of typed `Operation`s.** This works because a well-shaped journal's only numbers
  live inside a `Slot.value` — `Address.objectId`/`path` are always strings. If the journal's shape
  ever grows a new numeric field that isn't a `Value`, revisit this function; it would currently
  (harmlessly, today) flag it too.
- **`hasNonFiniteNumber` no longer exists — it is `hasIllegalNumber`** (cycle 0026), widened to
  also catch `-0`, built on a new leaf predicate `isIllegalNumber(n)`. One predicate, not two —
  extend THIS one for any future "value JSON cannot round-trip" case, never add a parallel check
  (same "widen, don't duplicate" stance as D-020/D-026).
- **`mutate` checks the post-fold GRAPH and, as of cycle 0026, the operations' own PAYLOADS — both,
  for different reasons.** Neither one alone was enough; see the two gotchas above.
- **`document.ts` trusts `mutate` for graph legality and only shape-validates what `mutate`
  cannot.** The journal is the one field `mutate` never sees at all (a loaded journal is never
  itself replayed through `mutate`) — that is why `document.ts` needed its OWN value-legality check
  over the journal (cycle 0026), not a delegation to `mutate`.
- **Object identity inside a batch is ONE `Set<id>` simulation** (D-026). `setSlot`/`deleteObject`
  require presence, `createObject` requires absence and ADDS the id. Any future kind that changes
  identity extends that same walk — never a second mechanism, never a check against the pre-batch
  `objects`.
- **Deleting an object needed NO new rejection check** — `validateIntegrity`'s dangling-reference
  check already is the mechanism, and it names every dependent (§5.1.1).
- **`validateIntegrity` runs BEFORE `evaluate` and never re-checks its output.** So a compute
  function's own guard is the ONLY protection against an illegal freshly-computed derived value;
  every future compute that does arithmetic must map overflow to `#TYPE` itself, and reason
  FRESHLY about whether its own operator can produce `-0` (`add`'s cannot — see `schema.ts`'s own
  comment — but a future `*`/`/` must not assume the same holds).
- **A derived slot's load-time placeholder is provably unobservable** — `evaluate` overwrites it
  inside the same `mutate` call. Don't try to write a test that distinguishes it.
- **A zero-object document must bypass `mutate`** — D-020's empty-batch rejection would otherwise
  make an empty document unloadable. Mutation-tested at 0024.
- **Mutation-testing proves a mechanism is load-bearing, not that it is correct.** Ask both: would
  removing it fail a named test, *and* does it do its job for every input its types admit? D-019,
  D-024, and the journal half of D-025 (0025-REVIEW finding 1, closed cycle 0026) all passed the
  first question and failed the second, at some point in this project's history.
- **A plausible claim written as a proof is this project's recurring defect** — six instances now
  (0024's "all four clauses PASS" being the sixth), several caught by the implementer before
  review. If a comment says "X cannot happen because Y", probe Y — and if a §6 clause was claimed
  PASSING once already, re-verify the SPECIFIC mechanism the previous claim relied on before
  repeating it, not just that the suite is green.
- **A fixture that LOOKS like it tests a thing may not.** 0020's "last write wins" batch; 0024's
  round-trip journal, which carried a single finite `3` through the test without ever being tested
  — fixed at 0026 with a fixture exercising the FULL `Value` vocabulary in the journal.
- **The clone is load-bearing AND faithful** — never `JSON.parse(JSON.stringify(...))` for graph
  state (D-019), never `structuredClone` (D-006).
- **PROCESS_BRIEF §8.1's `grep "document\."` Rule 1 check now hits `document.ts`'s own parameter.**
  Not violations — the real guard is `tsconfig.engine.json`, which is a compiler check.
- **Cyclic input to `evaluate` fails SILENTLY** — step 5 before step 7 is load-bearing; no defensive
  cycle check inside `eval.ts`.
- **`GraphObject`, not `Object`**; **`address.ts` ↔ `graph/node.ts` share TYPES only**;
  **`Value`/`Point`/`ErrorValue`/`isErrorValue`/`isIllegalNumber`/`hasIllegalNumber` live in
  `graph/node.ts`** — never redefine (D-014).
- **Slot keys only from `slotKey()`** (D-010); **document-wide keys only from `addressKey()`**
  (D-015). User-facing slot names come from `formatAddress` — exceptions: D-022 (now three call
  sites), D-023.
- **The schema registry stores FUNCTIONS and that is correct** (0008-REVIEW §2).
- Each PowerShell call is a fresh process; the Bash tool's `npm` is not on PATH — use PowerShell.
