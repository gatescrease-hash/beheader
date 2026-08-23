# 0025-REVIEW — phase 0
Date: 2026-08-22   Phase: 0   Model: reviewer (Claude Opus 5)
Reviewing: entries 0022 (`delete-object`), 0023 (`answer-q006`), 0024 (`document`) — commits
`691cdf1`, `32f80e9`, `da05820`. Hand-back forced by §6.1 trigger 2 (new file `document.ts`) AND
§6.1 trigger 1 (the Phase 0 gate claimed complete), correctly identified by 0024 itself.
Previous review: 0021-REVIEW-phase0 (verdict: ACCEPT WITH EDITS)

**Verdict: REVISE.** Three findings; one blocks the gate. Phase 0 acceptance clause 4 ("a document
round-trips to JSON and back **identically**") is falsifiable today by a document `mutate` itself
accepts — the mutation journal escapes D-025, and `saveDocument`/`loadDocument` silently rewrites
its history. Clauses 1–3 are genuinely closed and correctly tested. Two smaller findings fixed here
(3 comment corrections, 1 message defect, 2 tests). One new ruling (**D-026**), one new question
(**Q-008**), Q-007 answered.

**The Phase 0 gate is NOT signed off. Phase 1 MUST NOT start.** Fix list at the bottom; it is
short, and the next cycle should be able to close it and re-claim the gate.

## What these three cycles got right
Worth stating first, because the fix list is not proportional to the quality of the batch.

- **Clause 3 (0022) is closed the right way and for the right reason.** No new rejection mechanism
  was added: `DeleteObjectOperation` simply produces the shape `validateIntegrity`'s existing
  dangling-reference check was already built to reject. §5.1.1's own worked example is
  `delete <object>`, so this is the spec's own reading, not a convenient substitution for
  per-slot deletion. Re-verified by probe that the rejection names **every** dependent as §5.1.1
  requires, not just the first: `add_1.in.a, add_1.in.b reference a slot that does not exist`.
- **The fold-aware existence simulation (0022) is the correct fix to 0021-REVIEW's constraint 1**,
  and 0024 extended it in the one legal direction rather than adding a second mechanism. Ruled
  **D-026** so the next variant does not have to rediscover it. Probe: `[deleteObject obj_1,
  createObject obj_1]` in one batch is accepted and yields a replacement object — behaviour nobody
  wrote a branch for; it falls out of both halves feeding one simulation.
- **0023's self-caught overclaim is the strongest thing in the batch.** Three separate comments
  claimed `validateIntegrity` would back-stop a non-finite value that slipped past `add`'s own
  guard. Mutation-testing `add`'s guard disproved it (`mutate` returned `ok: true` holding a raw
  `Infinity`), and all three were corrected before commit rather than after review. That is D-016's
  "ask both questions" working exactly as intended, and it is the second consecutive batch where
  the implementer caught this project's recurring defect before I did.
- **`document.ts`'s "validate only what `mutate` cannot" split is the right boundary** — for the
  object list. See finding 1 for the one field it leaves uncovered.

## Rule audit
Rules 3, 4, 6, 7 — not touched. Rule 1 — upheld; re-checked mechanically, clean under
`tsconfig.engine.json`, and `document.ts` correctly refuses the file-input/download half of §5.11
by name. (One note for future audits, not a defect: PROCESS_BRIEF §8.1's prescribed
`grep "document\."` now returns five hits inside `document.ts` itself — its own `document`
parameter. The real Rule 1 guard is the DOM-free config, which is a compiler check and stronger;
do not read those hits as violations.) Rule 5 — upheld; the existence simulation is explicitly the
dumbest thing that answers the one question it asks, and `document.ts` refuses to duplicate
`validateIntegrity`. **Rule 2 — upheld on the object list, and this is where finding 1 lands**: the
journal is specified append-only history, and today a saved-then-loaded document's history is not
what was recorded.

## Invariant audit
No dangling edges — upheld, and now genuinely exercised by object deletion. Rejection leaves prior
state unchanged — upheld, including 0023's careful decision NOT to snapshot via JSON in the D-025
tests (a JSON snapshot would have turned the test's own `Infinity` fixture into `null`; that is the
kind of detail that decides whether a test proves anything). Slot set fixed during evaluation,
derived-inside-the-topological-pass, eager/total extraction, no `#CYCLE` — untouched. **Graph state
plain and serializable — this is the invariant finding 1 falsifies**, and it is the one Phase 0
exists to establish.

## Spec conformance
§5.1.1 — conformant, including "a message naming every dependent" (probed above) and the deliberate
non-implementation of the REPAIR path and `force` flag (Phase 2/4; correctly declared out of scope).
§5.11 — conformant on `formatVersion` from the first commit, the object list, derived values never
serialized, and "loading applies objects through the mutation API" as ONE batch. Two gaps, one
harmless: **style** is listed by §5.11 in the object list and does not exist in the data model yet
(nothing lost today — carried forward); and **the mutation journal**, which §5.11 names as part of
the format, is the half nothing validates (finding 1).

## Findings

### Finding 1 (BLOCKING — clause 4 is not closed) — the mutation journal escapes D-025
D-025's own ruling text, written at 0023, says non-finite numbers are illegal "in the object list
**AND in the serialized mutation journal** (0021-REVIEW's widening of Q-006's scope)". The object
list half was implemented. The journal half was not, and 0023's entry does not mention the journal
at all. 0021-REVIEW-phase0's carried constraint 4 said the same thing in advance: "Q-006 covers the
journal too. Answer before writing clause 4's round-trip test."

This is not theoretical. Three probes, all through the real public API:

```
A) mutate([ setSlot value_1.value = Infinity, setSlot value_1.value = 5 ])   -> ok: true
     committed value                       -> 5          (correct; the fold's last write wins)
     journal[0].operations[0].slot.value    -> Infinity   (D-025 never sees it — it checks the
                                                           POST-FOLD objects, not the payloads)
     saveDocument(...)                      -> ..."slot":{"kind":"literal","value":null}...
     loadDocument(...) journal value        -> null       (history silently rewritten)

F) mutate([ createObject obj_2 {value: NaN}, deleteObject obj_2 ])           -> ok: true
     journal payload stringifies to         -> ..."value":null...

I) loadDocument(file whose JOURNAL holds 1e999)                              -> ok: true
     loaded journal value                   -> Infinity
     saveDocument(that document)            -> ..."value":null...
```

Probe I is the sharpest: **the same file, the same `1e999`.** In the object list it is rejected with
a good message (`value_1.value holds a non-finite number (Infinity), which is not legal document
state (D-025)`); in the journal it loads, and the very next save corrupts it. A document that
`mutate` accepted and `saveDocument` wrote does not reload identically — §6 clause 4, falsified.

Two distinct holes, and item 1 alone does not close both: `mutate` never inspects an operation's
payload for value legality (the write side), and `deserializeDocument` carries a file's journal
through with an unchecked cast (the read side — a loaded journal never passes through `mutate` at
all). Both are in the fix list.

Note what is NOT wrong here: the existing round-trip test is honest and its fixture-through-a-real-
evaluation-pass construction is exactly right. `toEqual` would have caught this. The fixture's
journal simply holds a single finite `3`, so the journal is round-tripped in the test without ever
being tested.

### Finding 2 (fixed here) — `document.ts` claims two checks it does not perform
Same recurring shape as 0018-REVIEW's finding 1 and 0020's self-caught test comment, in a new file:

- The header claimed the journal is validated as "an array of objects holding an `operations`
  array". Probe: `deserializeDocument({ ...serialized, journal: ["garbage", 42, null] })` →
  `ok: true`. Only `Array.isArray` runs. Carrying the journal unvalidated is a defensible Rule 5
  call while nothing replays it; claiming a check that does not exist is the defect.
- `saveDocument`'s doc comment claimed `JSON.stringify` "cannot silently lose information here"
  because D-025 forbids non-finite numbers from committed state. Finding 1 is that sentence's
  counterexample, and this comment is what would have persuaded the next reader not to look.

Both corrected in place, pointing at the probe and at the fix list. I did not add the missing
checks — where they belong is a fix-list decision, not a comment's.

### Finding 3 (fixed here) — D-025's rejection cannot say what it rejected
```
mutate([ setSlot value_1.value = {x: NaN, y: 2} ])
-> value_1.value holds a non-finite number ([object Object]), which is not legal document state
```
The message interpolates the value directly, so every non-finite number nested in a `Point`/
`Point[]` prints as `[object Object]` — the slot is named, the problem is not. Same defect and same
§5.1 step 6 requirement as D-023 fixed for D-021's message; no new ruling needed, D-023 already
covers "a rejection must say what it found." Fixed with a four-line `describeNonFiniteValue`
(`{ x: NaN, y: 2 }`), and note that `JSON.stringify` is unusable here for precisely the reason this
check exists: it renders all three offending values as `null`.

## Reviewer edits (all mutation-checked or comment-only)
1. `mutation.ts` — `describeNonFiniteValue`/`describePoint` + the check-4 message (finding 3), and
   two new tests pinning a `Point` and a `Point[]` message. Mutation check: gating both branches
   off failed exactly those two tests and nothing else.
2. `document.ts` — the two false claims in finding 2, corrected in place.
Post-edit: **193/193**, typecheck clean under both configs.

## Honesty audit
Re-ran everything before touching anything. `npm run typecheck` clean under both configs.
`npx vitest run` → **191 passed (191), 8 files, 0 skipped, 0 `.only`** — exactly 0024's number, and
0022's 157 and 0023's 169 are consistent with their own stated arithmetic. No `any`, no
`@ts-ignore`, no test weakened; the one changed test expectation (D-019's fidelity fixture, split
at 0023) is pre-authorized by D-025 itself and was disclosed under §6.1 trigger 5 as it should be.
The ten mutation experiments in 0024 and four in 0023 are described precisely enough to re-run, and
`grep -rn "MUTATION-TEST" src/engine/` is clean.

One discrepancy, in the safe direction: 0024 reports "~1609 changed lines across 10 files."
`git diff --numstat 1c7c621 HEAD -- src/` gives 1437 added / 105 deleted = **1542 changed lines
across 8 source files**. The entry's own method — "numstat, plus the two brand-new files' own line
counts" — double-counts, since numstat already counts a new file's lines as added. It over-reports,
which triggers review sooner rather than later, so nothing was hidden; but 0014-REVIEW's constraint
6 asked for the numstat figure alone, and this is the first time since that it has drifted.

No scope expansion in any of the three cycles. 0022 declined `document.ts` and said why (Q-006 was
not its call to settle — correct, and it stopped rather than guessing). 0023 declined to
re-litigate the human's ruling. 0024 declined the DOM half of §5.11, format migration, and
`nextObjectId` minting, each by name.

**0024's claim "ALL FOUR Phase 0 acceptance clauses now PASS" is where the honesty audit lands.**
Clauses 1–3: true, and demonstrated end-to-end. Clause 4: the test that exists is real, passes, and
tests something worth testing — but the criterion says "identically", and a document this codebase
itself produces does not. The gap is between the fixture and the claim, not between the log and the
diff.

## Answered questions
- **Q-007 (camera shape) — ANSWERED: (a) approved as PROVISIONAL**, same standing as Q-005. Stays
  OPEN because it only truly resolves when Phase 3 builds `render/camera.ts`. Constraints recorded
  on the question: Phase 3 widens, never replaces; stays plain and serializable; no second reader
  inside `document.ts`. Rejecting a malformed camera on load is right — a document whose camera is
  garbage is a document that cannot be opened where the user left it; do not default it away.
- **Q-008 (raised this review): is `-0` legal document state?** Found while probing finding 1, and
  it is the same defect one step further out — `Number.isFinite(-0)` is `true`, so D-025 does not
  cover it, and JSON cannot represent it either:
  ```
  mutate([setSlot value_1.value = -0]) -> ok: true, Object.is(committed, -0) -> true
  save -> "value":0    reload -> Object.is(reloaded, -0) -> false
  ```
  A second live counterexample to clause 4, this one in the object list. Recommendation (a):
  illegal, one more arm on the same predicate as finding 1's fix. Reversible, so unlike Q-006 it
  does not need to block — take (a) as `PROVISIONAL(Q-008)` if the human has not ruled by then.
- **Q-006 — stays ANSWERED.** Added a note recording that its ruling is enforced over one of the
  two halves it was written for. The ruling is not in doubt; its implementation is.
- **Q-005** open by design; **Q-001/Q-002** (Phase 3), **Q-004** (Phase 2) deferred, unchanged.
  Next free: **Q-009**.

### 0024's three questions
1. **`CreateObjectOperation`'s mirrored precondition** — correct, and the right generalization, not
   a special case. D-021 ("an operation whose target does not resolve is rejected, never a silent
   no-op") and D-002 ("ids are unique and never reused") are the same sentence read from opposite
   sides. Ruled **D-026** to bind the mechanism rather than this instance of it.
2. **Q-007's provisional camera** — answered above; provisional is the right level.
3. **"Validate only what `mutate` cannot"** — the right boundary, and the reasoning (don't
   duplicate `validateIntegrity`; Rule 5) is correct. But it has a hole exactly where the boundary
   is drawn: **the journal is the one field `mutate` never sees.** "Trust `mutate`" is a complete
   answer for the object list and no answer at all for the journal, which is why finding 1 needs
   fixes on both sides of that line. The instinct was right; the coverage of it was not.

### 0023's procedural question
Recording a human's in-session ruling directly in `DECISIONS.md`, attributed as such ("Ruled: the
human, directly"), with the question marked `ANSWERED → D-NNN` in place, is exactly right — keep
doing it. The attribution line is what matters, and it was there. Note that D-025's text was
written more completely than D-025's implementation; that is a caution about the implementing
cycle, not about the record-keeping shape.

## REVISE — numbered fix list
1. **Reject an operation whose payload carries an illegal value, before staging.** A payload that
   never survives the fold still enters the journal (probes A and F), so this is a precondition on
   the OPERATION — same place and same shape as D-021's target check — not another pass over the
   post-fold graph. Applies to `setSlot`'s `slot` and `createObject`'s whole `object`. Name the
   offending operation the way D-023 requires. Both probe shapes become named tests.
2. **Close the read side too.** `deserializeDocument` carries a file's journal through with an
   unchecked cast, and a loaded journal never passes through `mutate`, so fix 1 does not reach it
   (probe I). Either validate journal payload values on load or reject the document — your call,
   but state which and test it. The asymmetry to remove is the one probe I shows: the same
   `1e999`, rejected in one half of the file and accepted in the other.
3. **Settle Q-008 (`-0`)** and enforce it in the same predicate as fix 1. `PROVISIONAL(Q-008)` on
   recommendation (a) is acceptable if the human has not ruled.
4. **Re-close clause 4 with a fixture that exercises the journal**, carrying the same value
   vocabulary the object list does. Add `expect(saveDocument(loaded)).toBe(json)` — save→load→save
   text equality is one line and catches this entire class, including whatever the next
   unrepresentable value turns out to be.
5. **Then re-claim the Phase 0 gate**, in a cycle that does nothing else. Clauses 1–3 need no
   further work; say so and cite where they were closed rather than re-testing them.

## Constraints carried forward
1. **D-026 binds every future operation kind** that can add, remove, or re-key an object: extend
   the one existence simulation; never add a parallel check.
2. **§5.11's `style` field** does not exist in the data model yet. When it lands, `serializeObject`
   and `reconstructObject` must carry it — the serializer is field-by-field, so it will silently
   drop anything nobody adds.
3. **`nextObjectId` is not reconciled against the ids present in a loaded file.** A file claiming
   `nextObjectId: 1` while holding `obj_1` is loadable today. That fails loudly later —
   `createObject` rejects a duplicate id — which is acceptable, but Phase 3's minting must consult
   the object list or the loader must reconcile. One test when minting lands.
4. **L-16 still open** (nothing enforces `nonDerivedSlotPaths`/`derivedSlots` disjointness) — fold
   in when nearby, per 0012-REVIEW.
5. Standing: do not extend `nonDerivedSlotPaths` to slot families; no defensive cycle check inside
   `eval.ts`; count diffs from `git diff --numstat` alone.
