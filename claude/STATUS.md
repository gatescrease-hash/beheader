# STATUS — as of entry 0027-REVIEW-phase0

STATE: GREEN. Compiles under both configs, 213/213 tests pass, 0 skipped, 0 `.only`, no test pins
known-broken behaviour.

Current phase: **0 is COMPLETE.** Last review point: **0027-REVIEW-phase0, verdict ACCEPT WITH
EDITS — the Phase 0 gate is SIGNED OFF.** All four §6 acceptance clauses pass and are confirmed by
review. Cycle 0026 closed 0025-REVIEW's REVISE list; the reviewer closed the same rule's last two
uncovered fields (`camera`, `nextObjectId`) and ruled **D-027**.

## Next slice — Phase 1: the formula engine (`formula/`)
Standalone and heavily unit-tested, `extractDependencies` from the start (§5.3, §6's build order).
Read `claude/entries/0027-REVIEW-phase0.md`'s "Constraints carried into Phase 1" first. In short:
- **`formula/`'s first real file is a §6.1 trigger 2 review point.** Stop there; do not batch the
  grammar behind it.
- **Q-005 resolves in Phase 1: WIDEN `FormulaAst`, never replace it.** A binding must stay
  representable as a bare reference under the full §5.3 grammar. Clear every `PROVISIONAL(Q-005)`
  tag (`formula/ast.ts`, `graph/eval.ts`, `mutation.ts`) in that cycle and mark the question
  ANSWERED.
- **`extractDependencies` is eager and TOTAL across both `IF` branches.** A cycle in an untaken
  branch is a real cycle. Never lazy, never branch-aware (§5.3, §9).
- **One engine (Rule 4)** — text and table cells share it. Never a second evaluator.

## Built
- Scaffold: `package.json`, both tsconfigs (strict + DOM-free, D-006), Vitest. `node_modules` is
  gitignored — run `npm install` if `npm run typecheck`/`npm test` fail on a missing `tsc`.
- `address.ts` (§5.2, 44 tests) — two-layer name/ID scheme, D-005 surface↔stored mapping keyed on
  the A1 form (D-008), exact `parseAddress`/`formatAddress` inverses, `findObjectById`.
- `graph/node.ts` (§5.1, 27 tests) — `Value`/`Point`/`ErrorValue`/`isErrorValue` (D-014),
  `isIllegalNumber`/`hasIllegalNumber` (D-025 + Q-008 — ONE predicate, widened, not two),
  `ObjectType`/`TABLE_TYPE` (D-009/D-011), the three slot kinds, `GraphObject`,
  `slotKey`/`getSlot`/`resolveSlot`. Every field `readonly`.
- `graph/edge.ts` (§5.1, 6 tests) — `Edge`, `addressKey`. **Internal-only, D-015.**
- `formula/ast.ts` — one-variant `FormulaAst`. **`PROVISIONAL(Q-005)`** — Phase 1 widens it.
- `primitives/schema.ts` (§5.1, 21 tests) — `derivedSlotDependencyAddresses`, `getObjectSchema`,
  `findDerivedSlotSchema`, `ObjectSchema.nonDerivedSlotPaths`; `value`/`add` entries. `add`'s
  compute maps a non-finite sum to `#TYPE` itself — the ONLY guard on a freshly computed derived
  value. It needs no `-0` guard (its inputs are already legal and `+` cannot produce `-0`); a
  future `*`/`/` compute MUST re-derive that (`-1 * 0` is `-0`).
- `graph/cycles.ts` (§5.1 step 5, 11 tests) — `detectCycle(edges)`, from-scratch DFS.
- `graph/eval.ts` (§5.1 step 7, 11 tests) — `evaluate(objects, edges)`, one topological pass over
  an edge set ASSUMED acyclic; all three slot kinds; D-013 enforced mechanically.
- `mutation.ts` (§5.1's full loop, 68 tests) — `deriveEdges`; `validateIntegrity` running FOUR
  checks in order (D-017 undeclared slot → D-018 schema↔slot reconciliation, both directions →
  dangling reference → D-025/Q-008 illegal slot value); `deriveValidateAndEvaluate`;
  `mutate(objects, operations, journal)` — batch form (D-020) with THREE preconditions before
  staging (empty batch; D-021/D-026 existence simulation; D-025/Q-008 payload legality), ONE clone
  (D-019), one validation/evaluation pass, one journal entry with payloads cloned (D-024). Three
  operation kinds: `SetSlotOperation`, `DeleteObjectOperation`, `CreateObjectOperation`.
- `document.ts` (§5.11, 25 tests) — `Document`, `serializeDocument`/`deserializeDocument`,
  `saveDocument`/`loadDocument`. Loading rebuilds every object as a `CreateObjectOperation` and
  calls `mutate` in ONE batch; a zero-object document bypasses `mutate` entirely. Journal VALUES
  (not structure) checked on load via `rawContainsIllegalNumber`; `camera` and `nextObjectId`
  checked on load too (**D-027**, 0027-REVIEW). `CameraState` is **PROVISIONAL(Q-007)**.

## Acceptance criterion — Phase 0, all four PASSING and REVIEWED
1. Topological propagation including derived slots — closed 0012-REVIEW.
2. Cycle rejected, offending slots named, prior state provably unchanged — closed 0017/0018-REVIEW.
3. Deleting a slot with dependents is rejected — closed 0022/0025-REVIEW. Uses the pre-existing
   dangling-reference check; names EVERY dependent (§5.1.1).
4. Document round-trips to JSON identically — closed 0026 + 0027-REVIEW. Pinned as TEXT
   (`expect(saveDocument(loaded)).toBe(json)`), not just shape.

## Known problems
- **`camera` has no WRITE-side guard** (D-027): `saveDocument` returns a `string` and has no
  failure channel, so nothing can reject an in-memory illegal camera. Harmless today
  (`DEFAULT_CAMERA` is the only writer in the tree) — **Phase 3 must guard camera state where it is
  computed**; a `NaN` zoom saves as `null` and makes the document unloadable.
- **The journal's STRUCTURE is deliberately unvalidated** beyond `Array.isArray` —
  `journal: ["garbage", 42, null]` loads, and nothing replays the journal yet, so garbage shape is
  inert. A disclosed stance (`document.ts`'s header), distinct from journal VALUE legality, which
  is enforced.
- **L-16** — nothing enforces `nonDerivedSlotPaths`/`derivedSlots` disjointness on one type. One
  registry-wide `slotKey`-compared test (D-010) fixes it; cheapest open cleanup.
- **L-17 / L-18** — `deriveEdges` shares path-array references with the registry (harmless) and
  does not deduplicate (both consumers tolerate it).
- **L-14** — `eval.ts`'s two `ErrorValue` messages name no slot; a real gap for §5.9's error badges.
- **§5.11's `style` field** has no data-model counterpart yet; the serializer is field-by-field and
  will silently drop it unless whoever adds `style` also adds it there.
- **`nextObjectId` is not reconciled against a loaded file's ids** — fails loudly later
  (`createObject` rejects a duplicate), but Phase 3's minting must consult the object list.
- **`noUnusedLocals` is off**, so a dead import compiles (one was found and removed at
  0027-REVIEW). Turning it on is a config change — §6.1 trigger 6, not a silent fix.
- **Four places can reject a mutation** — three `mutate` preconditions plus `validateIntegrity`.
  Correct (each is about a different thing) and enumerated in the file header. If a FIFTH appears,
  give them one named section.
- **L-6 – L-15, carried** — cosmetics. Fold in when nearby: **L-8** (into L-16's test), **L-10**
  (`addressKey` assumes `obj_<n>` ids — wants a note in `document.ts`).
- **Recursion depth** — `detectCycle`/`evaluate`/`deepClone` recurse; fine at brief scale.
- Table/`cells` mapping in `address.ts` still hardcoded; `nonDerivedSlotPaths` cannot express a slot
  family. Both wait on `schema.ts` expressing families (D-005 §4, D-009). **Do not extend
  `nonDerivedSlotPaths` to tables.**
- **SETTLED, do not re-raise:** flat `claude/` layout; shared vocabulary out of `graph/node.ts`;
  unifying `isErrorValue`/`isAddressError` (D-014); inverting a `slots` key to recover a KNOWN
  slot's path; `describeUndeclaredSlot`'s raw-key naming (D-022, three call sites); collapsing
  §5.1.1's two clauses into one `resolveSlot` check; one-directional schema↔slot reconciliation
  (D-018); the JSON-based clone (D-019); a nonexistent-object operation as a no-op (D-021);
  single-operation `mutate` (D-020); suppressing an unresolvable object's id from a message
  (D-023); a payload or journal entering committed state by reference (D-024); checking batch
  targets only against the pre-batch `objects`, or adding a second identity mechanism (D-026);
  whether clause 3 needed a new rejection mechanism (no — 0022); non-finite numbers as legal state
  (D-025 — no); `-0` as legal state (Q-008 PROVISIONAL — no); whether the post-fold check alone
  enforces D-025 (no — payloads need their own precondition, 0026); whether value legality stops at
  slot values (no — D-027, it is the whole document's rule).

## Live PROVISIONAL tags and open questions
**`PROVISIONAL(Q-005)`** → `formula/ast.ts`, `graph/eval.ts`, `mutation.ts`. **Due now** — Phase 1
resolves it. **`PROVISIONAL(Q-007)`** → `document.ts`'s `CameraState`; approved 0025-REVIEW, Phase
3 WIDENS it. **`PROVISIONAL(Q-008)`** → `graph/node.ts`'s `isIllegalNumber` (one site, correctly);
approved 0027-REVIEW, open only for the human's option to overrule. **Q-006** ANSWERED → D-025,
both halves enforced. **Q-001/Q-002** (Phase 3), **Q-004** (Phase 2) deferred; **Q-003** → D-007.
Next free: **Q-009**.

## Gotchas for the next model
- **Value legality is the whole DOCUMENT's rule, not the slot's** (D-027). Every number reachable
  from a `Document` — slot value, journal payload, `camera`, `nextObjectId`, whatever is added next
  — must pass `isIllegalNumber`. A new numeric field extends the existing check; it does not get an
  exemption for "not really being document state."
- **`mutate` has THREE preconditions before staging**: empty batch, target existence (D-021/D-026),
  payload legality (D-025/Q-008). The third is why `[setSlot v=Infinity, setSlot v=5]` is REJECTED
  even though the final value is legal: the illegal payload still enters the journal. Do not
  "simplify" it into only checking the post-fold graph — that was 0025-REVIEW's blocking finding.
- **`findIllegalSlotValues` and `findIllegalOperationPayloads` are both needed** — post-fold graph
  vs. raw operations. Removing either reopens a real hole; they are not redundant.
- **Object identity inside a batch is ONE `Set<id>` simulation** (D-026). `setSlot`/`deleteObject`
  require presence, `createObject` requires absence and ADDS the id. Extend that same walk.
- **`validateIntegrity` runs BEFORE `evaluate` and never re-checks its output** — a compute
  function's own guard is the ONLY protection for a freshly computed value.
- **Deleting an object needed NO new rejection check**; the dangling-reference check already is it.
- **A derived slot's load-time placeholder is provably unobservable** — don't test for it.
- **A zero-object document must bypass `mutate`** (D-020's empty-batch rejection).
- **Mutation-testing proves a mechanism is load-bearing, not that it is correct.** Ask both: would
  removing it fail a named test, *and* does it do its job for every input its types admit? D-019,
  D-024, and D-025's journal half each passed the first and failed the second.
- **A plausible claim written as a proof is this project's recurring defect** — and a §6 clause
  claimed PASSING once already deserves re-verification of the SPECIFIC mechanism, not just a green
  suite (0024's "all four PASS" was wrong about exactly one clause; 0026's was right).
- **A fixture that LOOKS like it tests a thing may not** — 0020's "last write wins" batch; 0024's
  round-trip journal, which carried a finite `3` through the test without testing it.
- **The clone is load-bearing AND faithful** — never `JSON.parse(JSON.stringify(...))` (D-019),
  never `structuredClone` (D-006).
- **Cyclic input to `evaluate` fails SILENTLY** — step 5 before step 7 is load-bearing; no
  defensive cycle check inside `eval.ts`.
- **PROCESS_BRIEF §8.1's `grep "document\."` Rule 1 check hits `document.ts`'s own parameter** —
  not violations; the real guard is `tsconfig.engine.json`.
- **`GraphObject`, not `Object`**; **`address.ts` ↔ `graph/node.ts` share TYPES only**;
  **`Value`/`Point`/`ErrorValue`/`isErrorValue`/`isIllegalNumber`/`hasIllegalNumber` live in
  `graph/node.ts`** — never redefine (D-014).
- **Slot keys only from `slotKey()`** (D-010); **document-wide keys only from `addressKey()`**
  (D-015). User-facing names come from `formatAddress` — exceptions: D-022, D-023.
- **The schema registry stores FUNCTIONS and that is correct** (0008-REVIEW §2).
- Each PowerShell call is a fresh process; the Bash tool's `npm` is not on PATH — use PowerShell.
