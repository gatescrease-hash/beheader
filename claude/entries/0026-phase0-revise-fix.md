# 0026 — phase0-revise-fix

Date: 2026-08-22   Phase: 0   Model: implementer (Claude Sonnet 5)
Responds to: 0025-REVIEW-phase0 (verdict REVISE), commit `4c44172`.

## Declared scope

0025-REVIEW-phase0's numbered fix list, items 1-4, in order, and nothing else:

1. `mutate` rejects an operation whose PAYLOAD carries an illegal value, before staging.
2. `deserializeDocument` closes the same hole on the read side (the journal).
3. Settle Q-008 (`-0`) and enforce it in the same predicate as item 1.
4. Re-close clause 4 with a fixture whose JOURNAL carries the same value vocabulary the object
   list does, plus a literal `saveDocument(loaded) === json` check.

Item 5 ("re-claim the Phase 0 gate, in a cycle that does nothing else") is this same cycle's own
closing act — see STATUS.md below — not a separate cycle. Clauses 1-3 needed no further work; this
entry cites where they closed rather than re-testing them, per the reviewer's own instruction.

## Explicitly not in scope

- Phase 1 (formula engine) — untouched, per the reviewer's explicit gate.
- Any operation kind beyond `SetSlotOperation`/`DeleteObjectOperation`/`CreateObjectOperation`.
- Structural validation of the journal beyond `Array.isArray` — still deliberately not done;
  nothing replays the journal yet (unchanged NOT DONE HERE note in `document.ts`). This cycle
  validates journal **values** for D-025/Q-008 legality only, not journal **shape**.
- Promoting Q-008 to a `DECISIONS.md` entry — it stays `OPEN_QUESTIONS.md`, `PROVISIONAL`, same
  standing Q-005/Q-007 have, per the reviewer's own "PROVISIONAL(Q-008) on recommendation (a) is
  acceptable if the human has not ruled" — the human had not ruled by this cycle.

## What I did

**One predicate, widened, not two.** `graph/node.ts`'s `hasNonFiniteNumber` is renamed
`hasIllegalNumber` and now built on a new leaf predicate, `isIllegalNumber(n)`, which is true for
`NaN`/`Infinity`/`-Infinity` (D-025, unchanged) OR `Object.is(n, -0)` (Q-008, new) — one `||`, not
a second check run alongside the first. This is the same "widen the existing mechanism" stance
D-020 and D-026 already established for this project, applied to a predicate instead of an
operation kind. `isIllegalNumber` is exported (not just an internal helper) because `document.ts`'s
new read-side check needs the bare leaf test over raw, not-yet-typed JSON data, not the `Value`-
typed `hasIllegalNumber`.

**Fix 1 — `mutation.ts`, write side.** New `findIllegalOperationPayloads(operations, objects)`,
called in `mutate` right after the existing D-021/D-026 existence-simulation check and before
staging. It is a precondition on the RAW `operations`, never on the post-fold graph:

- `setSlot`: checks `operation.slot.value`. Named via `formatAddress` against the pre-batch
  `objects` (falls back to the raw-id-labelled `AddressError` message on the one edge case where
  the target was itself just created earlier in the same batch — same defensive handling every
  other `formatAddress` call site in this file already uses).
- `createObject`: checks every slot of `operation.object`, gathering every illegal one. Named via
  `describeUndeclaredSlot` (this function's third sanctioned call site — the object being created
  is not yet in `objects`, so there is nothing to `formatAddress` against, only the payload's own
  `object.name`).
- `deleteObject`: no value payload, skipped.

Every offending operation is gathered in one pass, matching this file's existing multi-problem
style. Rejecting the WHOLE batch is deliberate even when a later operation in the SAME batch would
have overwritten the illegal value or deleted the object carrying it — the two probes below are
exactly why: the fold's FINAL state can be perfectly legal while an operation that never survives
to the end still enters the journal untouched.

Why this cannot be folded into the existing `findNonFiniteSlotValues` (renamed
`findIllegalSlotValues`, validateIntegrity check 4): that check only ever sees the POST-FOLD
candidate graph. Two probes from 0025-REVIEW-phase0's finding 1, both now rejected:

```
A) mutate([ setSlot value_1.value = Infinity, setSlot value_1.value = 5 ])
   BEFORE: ok: true, committed 5, journal[0].operations[0].slot.value = Infinity (never checked)
   AFTER:  ok: false — "operation 1 of 2: value_1.value would hold an illegal value (Infinity)..."

F) mutate([ createObject obj_2 {value: NaN}, deleteObject obj_2 ])
   BEFORE: ok: true, journal payload holds NaN (obj_2 is gone from the final graph, so check 4
           never sees it)
   AFTER:  ok: false — "operation 1 of 2: value_2.value would hold an illegal value (NaN)..."
```

**Fix 2 — `document.ts`, read side.** New `rawContainsIllegalNumber(raw)`: a generic recursive walk
over the raw, parsed-but-untyped `journal` field, using `isIllegalNumber` directly on any `number`
it finds. Deliberately NOT shaped around `Operation`'s variants — a well-formed journal's only
numbers live inside a `Slot.value` (`Address.objectId`/`path` are always strings), so a generic
walk finds exactly what a fully-typed one would, without needing the journal's STRUCTURE to be
trustworthy first (which this file still, deliberately, does not require — see NOT DONE HERE,
unchanged). `deserializeDocument` calls this right after confirming `raw.journal` is an array, and
rejects the WHOLE document if it finds one — a loaded journal never passes through `mutate` at all
(only the object list does, via `CreateObjectOperation`), so fix 1 cannot reach a foreign/hand-
edited file; this closes that gap directly. Probe I, now rejected:

```
I) loadDocument(file whose JOURNAL holds the JSON number token 1e999, which JSON.parse
   evaluates to Infinity)
   BEFORE: ok: true, loaded journal value = Infinity; the VERY NEXT saveDocument(...) silently
           wrote "null" in its place
   AFTER:  ok: false — "journal contains an illegal number (non-finite, or -0)... (D-025/Q-008)"
```

**Fix 3 — Q-008.** Taken as `PROVISIONAL(Q-008)`, recommendation (a): `-0` is illegal, tagged at
`isIllegalNumber`'s own doc comment in `graph/node.ts` (the site the predicate itself lives at —
same "tag every affected site" discipline Q-005/Q-007 use, collapsed to one site here because
there is exactly one predicate). `OPEN_QUESTIONS.md` updated: provisional choice recorded, status
stays OPEN (same standing as Q-005/Q-007 — resolves for real only if something later needs a
different answer). No `DECISIONS.md` entry — this is a reversible provisional choice under the
implementer's own authority (PROCESS_BRIEF §7), not a ruling.

One consequence checked and disclaimed rather than silently ignored: does `add`'s compute need its
own `-0` guard, the way it already guards non-finite sums? No — by the time `add`'s two inputs
reach its compute function they are already-legal `Value`s (this ruling's own check 1/`mutate`
rejects `-0` before it can enter committed state), and IEEE 754 addition of two finite, non-`-0`
operands can never itself produce `-0` (only `-0 + -0` does). Documented in `schema.ts`'s
`ADD_SCHEMA` comment, explicitly scoped to `+` — a future compute using `*`/`/` must reason about
this freshly.

**Fix 4 — clause 4's re-closure.** `document.test.ts` gained a fixture whose journal exercises every
member of `Value` a journal operation payload can carry (number, string, boolean, null, `Point`,
`Point[]`, `ErrorValue`) across all three operation kinds, plus the literal one-line check the
reviewer asked for: `expect(saveDocument(result.document)).toBe(json)` — text equality, not just
shape equality, so any future value JSON cannot represent fails this test immediately rather than
silently rewriting history the way the ORIGINAL clause-4 fixture (journal holding a single finite
`3`) could not have caught.

**Message rendering.** `describeNonFiniteValue`/`describePoint` (0025-REVIEW's own reviewer edit)
renamed `describeIllegalValue`/`describePoint`, now routed through a new `formatIllegalNumber(n)`
that special-cases `-0` → the string `"-0"` — `String(-0)` is `"0"`, which would make a rejection
message claiming to say what it found indistinguishable from legal state (Q-008's whole point, one
layer further into the message-formatting code).

## Verification

```
> npm run typecheck
> tsc --noEmit && tsc --noEmit -p tsconfig.engine.json
(clean, both configs)

> npm test -- --run
 Test Files  8 passed (8)
      Tests  209 passed (209)
```

209/209, up from 195 at 0025-REVIEW's commit (`4c44172`). 0 skipped, 0 `.only`. Breakdown of the
+14: `mutation.test.ts` 59→68 (+9: probe A, probe F, createObject-payload naming, gather-every-
illegal-slot, gather-every-offending-operation, a non-over-broad sanity check, and 3 Q-008 tests),
`document.test.ts` 16→21 (+5: the widened round-trip fixture, probe I, -0-in-journal, illegal-
createObject-in-journal, and the structurally-garbled-but-value-legal negative case), `node.test.ts`
27 (net +2 versus 25 at the last count in STATUS.md's Built section: a new `isIllegalNumber`
describe block, and `hasIllegalNumber`'s existing block gained `-0` cases in place, not as new
`it`s beyond the two above — the exact per-block delta is not separately worth tracking against
STATUS's Built-section number, which already just says "25 tests" loosely).

## D-016 mutation-check transcripts

Four experiments, each: neutralize → `npm test -- --run` → confirm exact named failures → revert →
confirm `grep -rn "MUTATION-TEST" src/engine/` clean.

**1. Fix 1 (`findIllegalOperationPayloads`'s call in `mutate`)** — replaced with a hardcoded empty
array. Failed exactly 3, all and only the tests whose illegal payload does NOT survive to the
post-fold graph (proving check 4 alone cannot catch these — the whole point of fix 1):
```
✗ (probe A) rejects a batch where an EARLIER setSlot carries an illegal value...
✗ (probe F) rejects a batch that creates an object with an illegal slot...
✗ gathers EVERY offending operation across the whole batch, not just the first
```
The OTHER new payload tests (createObject-alone, gather-every-slot, both Q-008 setSlot tests)
passed even with this neutralized — expected and correct: in those fixtures the illegal value DOES
survive to the final committed graph, so check 4 (`findIllegalSlotValues`) independently catches
them too. This is the intended redundancy, not a weak test — only probes A/F/gather-across-batch
are UNIQUELY fix 1's.

**2. Fix 2 (`rawContainsIllegalNumber`'s call in `deserializeDocument`)** — gated behind `false &&`.
Failed exactly 3, all and only the new read-side journal tests:
```
✗ rejects a document whose JOURNAL holds a raw non-finite number — probe I...
✗ rejects a document whose journal holds -0 (Q-008), nested inside a Point
✗ rejects an illegal number inside a createObject payload sitting in the journal...
```

**3. Fix 3 (`isIllegalNumber`'s `-0` arm)** — removed `|| Object.is(n, -0)`. Failed exactly 9,
spread across all three files that consume the predicate — proof the widening is load-bearing
everywhere it is used, not only where it was written:
```
node.test.ts:     isIllegalNumber "is true for NaN, +Infinity, -Infinity, and -0"
node.test.ts:     hasIllegalNumber "is true for a bare NaN, +Infinity, -Infinity, or -0"
node.test.ts:     hasIllegalNumber "...Point whose x OR y is non-finite or -0..."
node.test.ts:     hasIllegalNumber "...Point[] with ANY illegal point..."
mutation.test.ts: "rejects a setSlot writing a bare -0 literal..."
mutation.test.ts: "rejects a -0 nested inside a Point literal (x or y)"
mutation.test.ts: "gathers EVERY illegal slot on a createObject payload..." (one of its two
                    offending slots is a bare -0)
mutation.test.ts: "gathers EVERY offending operation across the whole batch..." (one of its three
                    offending operations is a bare -0)
document.test.ts: "rejects a document whose journal holds -0 (Q-008), nested inside a Point"
```

**4. Message correctness (`formatIllegalNumber`'s `-0` special case)** — replaced with plain
`String(n)`. Failed exactly 1:
```
✗ rejects a -0 nested inside a Point literal (x or y)
```
(Only one, not more, because most `-0` test assertions check `result.ok === false` or substring
`"D-025/Q-008"`, not the rendered number itself — this experiment specifically isolates the ONE
test that asserts the message text says `"-0"` rather than the misleading `"0"`.)

All four reverted; `grep -rn "MUTATION-TEST" src/engine/` returns no matches.

## Acceptance criteria status

Unchanged from 0025-REVIEW-phase0's own findings, cited rather than re-tested, per the fix list's
own item 5 instruction:

1. Topological propagation — **PASSING** (0012-REVIEW). Untouched this cycle.
2. Cycle rejection, prior state unchanged — **PASSING** (0017, accepted 0018-REVIEW). Untouched.
3. Delete-with-dependents rejected — **PASSING** (0022, accepted 0025-REVIEW). Untouched.
4. Document round-trips to JSON identically — **NOW PASSING.** 0025-REVIEW-phase0 found this false
   by construction (a document `mutate` itself accepts did not round-trip its journal identically).
   Fixes 1+2 close both directions of that gap at the source (no document this software produces
   can hold an illegal value anywhere; no foreign file claiming one loads). Fix 4's widened fixture,
   plus the literal `saveDocument(loaded) === json` check, demonstrates it directly.

**All four Phase 0 acceptance clauses PASS**, and this time the claim is backed by having actually
closed the specific gap the previous claim of this same fact (0024's) was wrong about.

## Where I got stuck / unfinished

Nothing. The fix list was fully specified and fully closed in this one cycle.

## Open questions raised

None new. Q-008 (raised at 0025-REVIEW) is settled provisionally, not newly raised here.

## Review point

**REVIEW: REQUIRED.** Two independent reasons, either alone sufficient:

- This cycle directly answers a REVISE verdict on the Phase 0 gate — closing that gate is §6.1
  trigger 1 ("a phase gate... never batchable"), regardless of diff size.
- `git diff --numstat 4c44172 -- src/` reports **798 changed lines across 7 files** since the last
  review point — under the 800-line cap by 2 lines, but irrelevant given the trigger above; stated
  for the record per 0014-REVIEW's constraint 6 (numstat alone, no double-counting — no new files
  this cycle, so there is no separate "brand-new file" line count to add).

**Do not start Phase 1** until this cycle is reviewed and the Phase 0 gate is confirmed signed off.

## Questions for reviewer

1. `findIllegalOperationPayloads` rejects the WHOLE batch when ANY operation's payload is illegal,
   even if a later operation in the SAME batch would have overwritten it or deleted the object
   carrying it (probes A/F). Confirm this is the right reading of "reject an operation whose
   payload carries an illegal value, before staging" — the alternative (only reject if the illegal
   value would have survived to the final graph) would require re-implementing something close to
   the post-fold fold itself just to check payload legality, defeating the point of a pre-staging
   check, but I want the "reject unconditionally, regardless of what happens later in the batch"
   semantics confirmed rather than assumed.
2. `rawContainsIllegalNumber` is a generic untyped walk rather than a reconstruction of typed
   `Operation`s. This means it would also (correctly, I believe) flag an illegal number sitting
   somewhere structurally odd in the journal that isn't really a `Slot.value` at all, if the
   journal's shape were ever to grow a new numeric field that ISN'T a `Value` — today there is no
   such field, so this cannot currently produce a false positive, but flagging it in case the
   journal's shape changes before this function is revisited.
3. Q-008 is tagged `PROVISIONAL` at exactly one site (`isIllegalNumber`'s doc comment in
   `graph/node.ts`), rather than at every call site the way Q-005/Q-007 are — because there is
   exactly one predicate now, not several places independently encoding the choice. Confirm this
   single-site tagging satisfies D-004's "every provisional choice... tagged in code" requirement,
   or whether `hasIllegalNumber` (the more commonly imported name) should carry its own tag too.
