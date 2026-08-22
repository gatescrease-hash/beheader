# 0015 — validate-integrity
Date: 2026-08-22   Phase: 0   Model: implementer (Claude Sonnet 5)
Previous entry: 0014-REVIEW-phase0   Last review: 0014-REVIEW-phase0 (verdict: ACCEPT WITH EDITS — "the next slice may begin.")

## Declared scope
Per STATUS.md's "Next slice (recommended)" and 0014-REVIEW's constraint 1
("D-017 part 2 is the first thing step 4 must do"): build `mutation.ts`'s
integrity validation (§5.1 step 4 / §5.1.1) — `validateIntegrity(objects,
edges) => IntegrityCheckResult` — covering exactly two checks: D-017 part 2
(reject an object whose actual `formula`/`derived` slot set disagrees with
its schema) and §5.1.1's dangling-reference rejection ("any formula
references a slot that does not exist"). Colocated tests, including
replacing the two 0014-REVIEW "KNOWN GAP" tests with real rejection tests per
that review's own instruction ("replaced by a rejection test — not deleted").

## Explicitly not in scope
Steps 1-2 (stage/clone, apply an operation), step 5 (`detectCycle`, already
built), step 6 (discard-and-reject on cycle), step 7 (`evaluate`, already
built), step 8 (commit + journal), the batch form, any operation shape, the
§5.1.1 REPAIR path (no Phase 0 type uses it — only table row/column deletion
does, Phase 2/4). `document.ts` remains untouched. The Phase 0 acceptance
criterion's remaining three clauses (cycle rejection with prior state
unchanged, slot-deletion rejection, document round-trip) are still not
demonstrable end-to-end — this cycle does not claim any of them; see
"Acceptance criteria status."

## What I did
- **`src/engine/mutation.ts`** — added `validateIntegrity(objects, edges) =>
  IntegrityCheckResult` (`{ ok: true } | { ok: false; message: string }`),
  plus two private helpers, run in this order and short-circuiting on the
  first failure:
  1. `findUndeclaredFormulaOrDerivedSlots` (D-017 part 2) — for every object
     with a schema entry, re-derives the declared KEY set from
     `schema.nonDerivedSlotPaths` ∪ `schema.derivedSlots` via `slotKey` (never
     the reverse — same discipline `deriveEdges` already uses), then walks
     `Object.keys(object.slots)` and flags any `formula`/`derived`-kind slot
     whose key isn't in that set. A type with no schema entry at all is
     skipped (D-017's one permitted exception).
  2. `findDanglingReferences` (§5.1.1) — for every edge, checks
     `resolveSlot(edge.sourceSlot, objects)` (`graph/node.ts`); a miss means
     the formula's reference doesn't resolve to anything. Groups by the
     missing source so several dependents on the same missing slot produce
     one problem, not several, and names only the DEPENDENT side via
     `formatAddress` — never the missing source, which may not exist to
     format, and whose raw `objectId` D-015 forbids leaking into a message
     anyway.
  Both helpers collect ALL problems of their kind before returning (not just
  the first), and `validateIntegrity` joins them with `"; "` if the first
  check's list is non-empty; only if it's empty does the second check run at
  all — so a document with problems of BOTH kinds reports only the D-017
  ones this call (pinned by a dedicated test, see "What I did" test list).
- **`describeUndeclaredSlot(object, key)`** — a small, deliberately isolated
  helper used only by check 1's message. See "Decisions I made" for why this
  exists instead of `formatAddress`.
- **`src/engine/mutation.test.ts`** — 9 tests added, 2 removed (net +7, 16
  total): kept `deriveEdges`'s existing "still derives no edge" assertion for
  an undeclared slot (renamed off "KNOWN GAP" since it's no longer a gap —
  `validateIntegrity` now closes it one layer up) and replaced the reviewer's
  two "KNOWN GAP, D-017" tests with real rejection tests covering: the
  undeclared-slot rejection naming `add_9.in.c`; the exact same cyclic
  document from 0014-REVIEW's probe, now rejected by `validateIntegrity`
  BEFORE `detectCycle` is ever reached (while confirming `detectCycle` alone
  still can't see it — that's *why* step 4 has to run first); a type with no
  schema entry passing cleanly; a dangling reference to a nonexistent object
  (naming the dependent, asserting the missing id never appears in the
  message); a dangling reference to a real object's nonexistent slot; the §6
  value/add fixture passing cleanly; the check-ordering claim itself (both
  problems present, only the D-017 one reported); and a never-throws test
  over the above documents plus the empty case.

## Decisions I made
- **`describeUndeclaredSlot` names the offending slot as `${object.name}.
  ${key}` — deliberately NOT `formatAddress`, despite D-017's own ruling text
  saying "via formatAddress."** The real tension: `formatAddress` needs an
  `Address` (`{ objectId, path }`), and an UNDECLARED slot has, by definition,
  no schema-declared path — there is nothing to look up. This project has
  twice ruled that recovering a path from a `GraphObject.slots` key means
  declaring it schema-side, never inverting the key (D-010; STATUS's "never
  `key.split(\".\")`") — but that escape hatch categorically cannot apply
  here, because the whole point of this check is a slot the schema does NOT
  know about. I did not invert the key (`key.split(".")`) even though it
  would be arithmetically exact today (`PATH_SEGMENT_PATTERN` forbids `.` in
  a segment) — that is precisely the pattern the project has ruled out twice,
  and I did not want a third site quietly reintroducing it. Instead
  `describeUndeclaredSlot` treats the object's raw key as already-surface-form
  text and concatenates it with the object's current name (rename-safe, same
  property D-015 cares about). This produces the EXACT SAME string
  `formatAddress` would for every schema-registered type today (`value`/
  `add` — neither is a table, and `address.ts`'s `toSurfacePath` is the
  identity for every non-table type), so nothing is lost for Phase 0. It
  stops being exact only if a table (or any future D-005 surface/stored
  mapping) ever gains an undeclared slot — which D-017 already forbids
  extending `nonDerivedSlotPaths` to cover, so that combination cannot arise
  before Phase 4 revisits the whole mechanism. **Flagging this explicitly for
  the reviewer** rather than treating it as settled: this is a disclosed,
  reversible deviation from the ruling's literal wording, not a silent one,
  and I'd rather it be checked than assumed correct.
- **One check, not two, for §5.1.1's dangling-reference clause.** §5.1.1's
  step 4 wording lists two things: "any formula references a slot that does
  not exist" and "the mutation would delete a slot that still has inbound
  dependents." I implemented ONE check — walk every edge, verify its
  `sourceSlot` resolves — because a slot deletion that breaks an inbound
  dependent and a plain bad reference are the SAME failure viewed from
  opposite ends of the same edge: whether the missing slot never existed or
  was just deleted, the formula that still points at it fails the identical
  `resolveSlot` check on the POST-apply state. Rule 5 (full recheck every
  time, no incremental tracking) argues directly for this: a before/after
  diff to specifically detect "was this deleted" would be exactly the
  incremental bookkeeping the brief rules out. Considered and rejected: a
  separate diff-based deletion check comparing a "previous" object list
  against `objects` — more machinery, and it would answer a question this
  single check already answers for free.
- **`validateIntegrity` takes `edges` as an already-`deriveEdges`-derived
  parameter rather than deriving them itself.** Matches `detectCycle` and
  `evaluate`'s own established shape (`(objects, edges)`, edges precomputed
  by the caller) rather than introducing a third convention. The docstring
  states the precondition (`edges` MUST be `deriveEdges(objects)` for the
  SAME `objects`) since nothing here can verify it.
- **Both problem lists are fully collected before returning**, not
  short-circuited on the first hit within a single check, so a document with
  three undeclared slots gets one message naming all three, not three
  separate rejections one retry apart. Matches `detectCycle`'s own "no
  hand-holding through a rejection loop" posture applied to a case where
  collecting everything costs nothing extra.

## Verification (real output)
```
$ npx tsc --noEmit
(exit 0, no output)
$ npx tsc --noEmit -p tsconfig.engine.json
(exit 0, no output)
$ npm test

 RUN  v2.1.9 C:/Users/William/Documents/Code Projects/beheader

 ✓ src/engine/primitives/schema.test.ts (19 tests) 5ms
 ✓ src/engine/graph/node.test.ts (20 tests) 5ms
 ✓ src/engine/graph/edge.test.ts (6 tests) 3ms
 ✓ src/engine/graph/cycles.test.ts (11 tests) 5ms
 ✓ src/engine/address.test.ts (44 tests) 8ms
 ✓ src/engine/graph/eval.test.ts (10 tests) 6ms
 ✓ src/engine/mutation.test.ts (16 tests) 8ms

 Test Files  7 passed (7)
      Tests  126 passed (126)
```
119 (0014-REVIEW) − 2 (removed KNOWN GAP tests) + 9 (new) = 126. 0 skipped;
grepped `.only(`/`.skip(`/`.todo(` across `src/` — no hits.

**D-016 mutation checks, both new checks in `validateIntegrity`, run before
writing this entry (backed up `mutation.ts` first, restored via `cp` after
each, confirmed clean 126/126 at the end):**

1. Disabled check 1 (D-017 undeclared-slot check — replaced its result with
   `[]` unconditionally):
   ```
    FAIL  src/engine/mutation.test.ts > validateIntegrity — D-017 part 2... > rejects an object carrying a formula slot its own schema does not declare, naming it
    FAIL  src/engine/mutation.test.ts > validateIntegrity — D-017 part 2... > was previously a KNOWN GAP (0014-REVIEW-phase0)...
    FAIL  src/engine/mutation.test.ts > ...runs the D-017 check before the dangling-reference check, on a document with both problems
    Test Files  1 failed | 6 passed (7)
         Tests  3 failed | 123 passed (126)
   ```
   Exactly the 2 tests directly asserting the D-017 rejection, plus the
   ordering test (which, with check 1 disabled, falls through to check 2 and
   gets a DIFFERENT message — correctly failing its `toContain("add_9.in.c")`
   assertion). Nothing else moved. Reverted via `cp` from the backup.
2. Disabled check 2 (dangling-reference check — replaced its result with `[]`
   unconditionally):
   ```
    FAIL  src/engine/mutation.test.ts > validateIntegrity — §5.1.1... > rejects a formula whose reference resolves to no object at all, naming the DEPENDENT slot
    FAIL  src/engine/mutation.test.ts > validateIntegrity — §5.1.1... > rejects a formula referencing a real object's slot that does not exist on it
    Test Files  1 failed | 6 passed (7)
         Tests  2 failed | 124 passed (126)
   ```
   Exactly the 2 tests exercising a dangling reference failed; the ordering
   test stayed green (correctly — it never reaches check 2, since check 1's
   D-017 problem is what it's built to hit first). Reverted; re-ran both
   typechecks and the full suite after both reversions — back to 126/126,
   both configs clean (pasted above is the final, reverted state), and
   deleted the backup file.

## Acceptance criteria status
No PROJECT_BRIEF §6 acceptance-criterion clause is claimed this cycle.
Integrity validation is one internal step (§5.1 step 4) inside a loop that
still has no stage/apply/commit around it — clause 2 ("a cycle is rejected
... and prior state is provably unchanged") needs steps 1, 2, 5, 6 wired
together before it is even attemptable, and "prior state provably unchanged"
specifically needs a deep-compare-against-a-pre-mutation-snapshot test that
does not yet have anything to snapshot (no stage/clone exists). Clause 3
(slot deletion rejected) and clause 4 (document round-trip) are equally
untouched. Per D-016, nothing is claimed here that the two mutation checks
above don't back.

## Where I got stuck / what is unfinished
Not stuck, but one real fork needed a disclosed judgment call rather than a
clean application of existing guidance: naming an undeclared slot via
`formatAddress` (D-017's literal wording) turned out to be impossible by
construction (no schema-declared path exists to format), and the project's
twice-established alternative ("declare it schema-side instead of inverting
the key") categorically can't apply to a slot the schema doesn't know about.
I resolved it with `describeUndeclaredSlot` — see "Decisions I made" for the
full reasoning — and am flagging it explicitly rather than treating it as
settled.

`mutation.ts` still needs steps 1, 2, 5-8 and the batch form before any of
Phase 0's remaining three acceptance clauses is attemptable. Steps 5-6-7 (run
`detectCycle`, reject-and-discard-clone on a cycle it finds, else `evaluate`)
are the natural next slice — `validateIntegrity` now runs upstream of them,
so wiring `deriveEdges → validateIntegrity → detectCycle → evaluate` in
sequence (still with no clone/journal yet) is the next incremental step
before stage/apply/commit make it a real transactional loop.

## Open questions raised
None formally opened in `OPEN_QUESTIONS.md` — the `formatAddress` tension
above is reversible (message wording only; nothing about the data model,
addressing scheme, or mutation sequence) and disclosed in full in "Decisions
I made" rather than blocking the cycle, per CLAUDE.md's guidance for
reversible ambiguity. I judged it didn't warrant a new `Q-NNN` entry because
it isn't an unresolved ambiguity in PROJECT_BRIEF.md (OPEN_QUESTIONS.md's own
scope) — it's a tension between D-017's literal text and an established
convention (D-010) — but I'm surfacing it prominently for the reviewer rather
than deciding unilaterally that my reading wins.

## Escalation triggers fired
- **§6 trigger 2** — modified `mutation.ts`, an explicitly named trigger-2
  file.
- **§6 trigger 3** — does NOT fire; no new file under `src/engine/` this
  cycle (both changed files already existed).
- **§6 trigger 9** — diff via `git diff --numstat`: `mutation.ts` +212/−11,
  `mutation.test.ts` +130/−39 → 342 net added source lines across 2 files.
  Under the ~400-line guideline and under the ~6-file guideline both; NOT
  fired on its own terms, though moot regardless since trigger 2 already
  fires.
- All other triggers (1, 4-8, 10): none fired. No phase criterion claimed
  complete (1 does not apply, see "Acceptance criteria status"); no
  deviation from or ambiguity in the brief was found and acted on without
  disclosure (4 — the `formatAddress` tension is disclosed above, not acted
  on silently); no hard rule worked around (5); no previously-passing test's
  expectations changed (6 — the two removed tests were REPLACED per
  0014-REVIEW's own explicit instruction, not weakened or deleted to reach
  green; every other existing test is untouched); no dependency/build
  step/config added (7); no bug attempted twice (8); nothing in §8's deferred
  list was approached (10).

**REVIEW: REQUIRED** (trigger 2).

## Questions for reviewer
1. Is `describeUndeclaredSlot`'s raw-key-based message (§"Decisions I made")
   an acceptable, disclosed exception to D-017's "via formatAddress" wording,
   or should this have been escalated as a formal open question before
   proceeding?
2. Is collapsing §5.1.1's two stated clauses ("references a slot that does
   not exist" / "would delete a slot that still has inbound dependents") into
   one `resolveSlot`-based check the right reading, or does the brief intend
   a structurally separate deletion-specific check even though this one
   subsumes it in every case I could construct?
