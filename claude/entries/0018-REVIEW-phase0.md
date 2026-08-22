# 0018-REVIEW — phase 0
Date: 2026-08-22   Phase: 0   Model: reviewer (Claude Opus 5)
Reviewing: entries 0015 (`validate-integrity`), 0016 (`wire-mutation-sequence`), 0017 (`mutate`) —
commits `1a7bb3b`, `f9caec2`, `587ebdb`. First batched review under the Manager's 2026-08-22
cadence change.
Previous review: 0014-REVIEW-phase0

**Verdict: REVISE.** Five numbered fixes below. Five new rulings (D-018 – D-022), one new open
question (Q-006), three reviewer edits. The batch is honest, well-tested, and well-documented; the
problem is not what it built but what its one-directional integrity check still lets through.

## Rule audit
Rules 1, 3, 4, 6, 7 — not touched or upheld unremarkably. Rule 1 checked mechanically: no `document.`,
`window.`, `canvas`, `render/*`, or `structuredClone` anywhere under `src/engine/` outside header
prose; `tsconfig.engine.json` clean. Rule 3 — every user-facing slot mention goes through
`formatAddress` (D-015), with the one disclosed exception now ruled on (D-022). Rule 5 — upheld;
full rebuild every call, no memoisation, staging by real deep clone as the rule literally asks.

**Rule 2 — VIOLATED, on the accept path.** See finding 2. A committed mutation can change a slot
its operation never named. This is the rule's central promise, and it is the only rule finding
here.

## Invariant audit
Slot set fixed during evaluation, derived slots inside the topological pass, eager/total dependency
extraction, evaluation lazy, no `#CYCLE`, graph state plain and serialisable — all upheld, none
disturbed by this batch.

**"No dangling edges" — VIOLATED.** See finding 1. `validateIntegrity` checks `sourceSlot` and
never `dependentSlot`, on a stated proof that is false for half of `deriveEdges`'s own output.

**"Rejection leaves prior state bit-for-bit unchanged" — upheld, and genuinely well demonstrated.**
0017's snapshot test is the real thing, and its two-experiment mutation check (buggy
`applyOperation` with the clone → green; without the clone → three cascading failures) is the
strongest D-016 evidence this project has produced. Credit where due: the conclusion — that a
clone whose necessity rests on "everything downstream is pure" is an accident rather than a
guarantee — is correct and worth keeping.

## Spec conformance — three findings

### Finding 1 (D-018) — the schema↔slot reconciliation is one-directional, and the other direction lets a dangling edge through
D-017 made step 4 reject a slot the schema does not declare. Nothing checks the reverse: that a
declared derived path actually carries a `derived` slot.

Probed, two ways:

- An `add` object with **no `out.result` slot at all**: `deriveEdges` emitted two edges whose
  `dependentSlot` is `obj_3::out.result`, `validateIntegrity` returned `{ ok: true }`, and
  `deriveValidateAndEvaluate` accepted the document. §5.1.1's absolute invariant — "an edge must
  never point at a slot that no longer exists" — broken, silently. This is not a hypothetical
  fixture: it is exactly the shape a §5.11 load produces, because `DerivedSlot.value` is never
  serialized (STATUS.md's own forward note). `document.ts` is the next slice.
- `mutate` with `setSlot add_1.out.result ← { kind: "literal", value: 999 }`: **accepted.** The
  derived slot is now a literal frozen at 999, `deriveEdges` keeps emitting `in.a`/`in.b` edges
  into it, and nothing reports anything. §5.1 is explicit: "`derived` is fixed by schema and can
  never be converted; attempting to `link` or `set` a derived slot is rejected." Rule 2 makes
  `mutation.ts` the only place that rejection can live — a §5.10 command-layer check would be
  bypassed by dragging and by document loading.

What made this invisible is a sentence, repeated in three places in `mutation.ts`, asserting that
`dependentSlot` needs no check "because `deriveEdges` only ever builds one from a real,
currently-iterated object." That is true of `deriveEdges`'s **source 1** (a formula slot it looks
up and finds before emitting an edge) and false of its **source 2** (a derived slot, whose
`dependentSlot` path comes from the schema and is never checked against the object). A plausible
proof, written once and then cited twice more as settled. Corrected in place — edit 1.

Also note: case 1 is precisely what reaches `graph/eval.ts`'s L-13 stale-edge `continue` branch.
0014-REVIEW's constraint 8 ("pin L-13 once step 4 exists") has been open since 0015 and is not
mentioned in any of the three entries. Closing D-018 closes it too.

### Finding 2 (D-019) — the step-1 clone is not a faithful clone, and it corrupts state on the ACCEPT path
`cloneObjects` is `JSON.parse(JSON.stringify(x))`. `NaN`, `Infinity`, and `-Infinity` are members
of `Value`'s own `number` arm, and all three come back as `null`.

Probed through the real `mutate` entry point only, in two mutations, no hand-built state:

```
mutate #1  set value_1.value 1e999   ->  ok,  value_1.value = Infinity
mutate #2  set value_2.value 7       ->  ok,  value_1.value = null
```

The second operation does not mention `obj_1` anywhere. Rule 2 says a mutation "either fully
commits or leaves prior state bit-for-bit untouched"; here an accepted mutation commits a change
to a slot it never named, and the journal records nothing about it. Reachable with nothing but
literals a user can type, and `add`'s own compute overflows two `1e308` inputs to `Infinity`
without any help.

Worth naming precisely, because 0017 did the right kind of work here and still missed it: the
mutation-testing asked whether the clone was **load-bearing** and proved that it is. It never
asked whether the clone was **faithful**. Those are different questions and only the first has a
test. D-016's discipline finds a missing mechanism; it does not find a mechanism that is present
and lossy.

Whether a non-finite number is legal document state at all is a real, separate ambiguity (§6
clause 4 wants a JSON round-trip that is *identical*, and JSON cannot represent any of the three).
That is not a reviewer's call to make — opened as **Q-006**, recommendation stated, and D-019
binds the clone either way. A clone must clone.

### Finding 3 (D-020) — the batch form has now been deferred three times, and `document.ts` cannot be built on the single-operation form
§5.1 states it as **required**, not as a later refinement: "The API must accept a list of
operations applied to a single clone, validated and evaluated once, committing all-or-nothing.
Document loading MUST use a batch." 0014-REVIEW carried it forward as constraint 7 in exactly
those words. 0016 deferred it, 0017 deferred it again while building the very entry point it
belongs in, and STATUS.md lists it third behind two other slices.

Each individual deferral was reasoned and disclosed — this is not a honesty problem. It is a
sequencing one: the batch form is the transactional boundary, not a performance feature (Rule 5
would forbid one). A `document.ts` built on single-operation `mutate` must validate every
intermediate state of a load, and intermediate states during a load are routinely invalid — object
B does not exist yet when object A's formula references it. That path ends in either rejecting
legitimate documents or bypassing validation, and Rule 2 forbids the second. Ruled: D-020, before
`document.ts` begins, widening `mutate` rather than adding a second entry point.

## Legibility audit
Strong, and above this project's already-high bar in one specific way worth naming: the file
header now explains *why* the clone exists in terms of what would break without it, which is the
kind of comment that survives a rewrite. Vocabulary locked throughout — I checked for "property",
"field", "node", "computed" and found none misused. No `any`. No `.only`, no `.skip`. Test names
are behaviour sentences that name the rule they defend. `PROVISIONAL(Q-005)` tags present at both
`mutation.ts` sites and matching STATUS.md's list.

One defect, and it is the important one: **a load-bearing claim was documented as a proof and was
wrong** (finding 1's three-times-repeated sentence). Everything else in these headers is careful
enough that the sentence read as settled. Correcting it is edit 1; the general lesson is that "X
never needs checking because Y" is a claim to test, not to comment.

## Honesty audit
Re-ran everything rather than reading it. `npm run typecheck` clean under both configs; `npm test`
**136/136, 0 skipped, 0 `.only`** — exactly as 0017 reported. Diff since 0014-REVIEW from
`git diff --numstat`: 876 added / 58 deleted = **934 changed lines across 2 files**, matching 0017's
"~934" to the line. Per-cycle test deltas (+7, +5, +5) match all three entries' claims. 0016's
"~620 lines so far" was actually 634 — an understatement of 2%, immaterial.

0017's entry catches and corrects its own test-count arithmetic mid-paragraph ("wait, 6 new tests
were added... Correction:"). Leaving that visible instead of quietly fixing the number is exactly
what this log is for, and it is the reason the rest of the entry's numbers are worth trusting on
sight.

No silent scope expansion found in any of the three cycles. No optimistic completion claim: 0016
explicitly declined to claim clause 2 when half of it was demonstrable, and 0017's clause-2 claim
is backed by the strongest evidence in the project. The three questions raised for the reviewer
across 0015 and 0017 are real questions, correctly not self-answered.

## Reviewer edits (3, small)
1. `mutation.ts` — corrected the three copies of the false `dependentSlot` claim (file header,
   `formatCycleRejection`'s doc, `findDanglingReferences`' doc). Each now states what is actually
   guaranteed, names the gap as D-018, and says whose job closing it is. No behaviour change.
2. `mutation.test.ts` — added a `KNOWN GAPS pinned by 0018-REVIEW` block, 3 tests, asserting what
   the code does today for D-018 (both cases) and D-019, with a header saying a green run here is
   not good news and each test is to be **replaced, not deleted**, by its rejection test. Same
   device 0014-REVIEW used for D-017's gap: an executable gap beats a prose one.
3. No third code edit. `STATUS.md` rewritten and `OPEN_QUESTIONS.md` extended with Q-006.

Post-edit: **139/139**, both configs clean.

## REVISE — the fix list
1. **D-018, part 1.** `validateIntegrity` rejects any object missing a slot at a schema-declared
   derived path. Replace the corresponding KNOWN GAP test with a rejection test.
2. **D-018, part 2.** `validateIntegrity` rejects a slot whose kind disagrees with its schema-
   declared position (a non-`derived` slot at a derived path; a `derived` slot at a
   `nonDerivedSlotPaths` path). Replace the corresponding KNOWN GAP test. Pin `graph/eval.ts`'s
   L-13 branch while here — part 1's fixture is what reaches it.
3. **D-019.** Replace `cloneObjects`'s JSON round-trip with an explicit recursive clone, and pin
   it with a fidelity test covering every member of `Value` — `NaN`, `±Infinity`, `null`, `Point`,
   `Point[]`, `ErrorValue`. Point its doc comment at Q-006.
4. **D-021.** `mutate` rejects an operation whose target object does not exist. The existing
   "never throws... (a no-op...)" test's expectation changes; D-021 is the authorisation, name it
   in the log entry.
5. **D-020.** Widen `mutate` to the batch form (list of operations, one clone, one validation, one
   evaluation, one journal entry). This one is a slice of its own — do 1-4 first, in one cycle if
   they fit, then 5, then `document.ts`.

Items 1-4 are all inside `mutation.ts`'s already-reviewed surface. Item 5 changes the signature of
the project's only mutation entry point; end that cycle and hand it back.

## Answered questions
- **Cycle 0015 Q1** — `describeUndeclaredSlot` vs. `formatAddress`: **approved as a bounded
  exception, D-022.** The reasoning was right and the disclosure was right. What was missing is
  durability: the equivalence claim lives in a doc comment, and doc comments do not fail a test
  run. Pin it with a test across every registered type.
- **Cycle 0015 Q2** — collapsing §5.1.1's two clauses into one `resolveSlot` check: **correct
  reading, keep it** (D-018 covers the part of it that was genuinely incomplete). A deleted slot
  with dependents and a never-existing one are the same failure seen from opposite ends of the same
  edge, and Rule 5's "recheck the whole graph" is what makes the collapse legitimate rather than a
  shortcut. §5.1.1's *repair* path (option 2) is a genuinely separate mechanism and stays NOT DONE.
- **Cycle 0017 Q2** — `applyOperation`'s no-op on an unknown `objectId`: **no, reject it. D-021.**
  The journal is specified as a record of committed mutations; an entry for an operation that
  changed nothing is a false record, and later indistinguishable from one that did.
- **Q-005** — still open by design, unchanged; Phase 1 widens it. **Q-001/Q-002** (Phase 3),
  **Q-004** (Phase 2) — deferrals reaffirmed, nothing in this batch touches them.
- **Q-006** — newly opened by this review, not answered by it. Next free ID: **Q-007**.

## Constraints carried forward
1. D-018 before `document.ts`. The missing-derived-slot case IS the document-load case.
2. D-020 before `document.ts`. Loading needs the batch form to exist.
3. D-016 still binds hardest here — but note finding 2's lesson: mutation-testing proves a
   mechanism is load-bearing, not that it is correct. Ask both questions of a new mechanism.
4. Carried from 0014-REVIEW and still open: **L-13 unpinned** (constraint 8) — fold into fix 2.
   Do not extend `nonDerivedSlotPaths` to slot families (constraint 5). Count diffs from
   `git diff --numstat` (constraint 6) — done correctly all three cycles.
5. Do not add a defensive cycle check inside `eval.ts`. Unchanged, and none was added.
6. The Phase 0 gate is still ahead: clause 3 (delete-with-dependents) and clause 4 (round-trip)
   remain open, and the gate is reviewed as one unit. Clause 2 is accepted as PASSING on 0017's
   evidence — findings 1 and 2 do not touch the cycle-rejection path it demonstrates.
