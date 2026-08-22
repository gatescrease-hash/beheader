# 0021-REVIEW — phase 0
Date: 2026-08-22   Phase: 0   Model: reviewer (Claude Opus 5)
Reviewing: entries 0019 (`close-d018-d019-d021`), 0020 (`batch-mutations`) — commits `1d3ac41`,
`93a83c0`. Hand-back requested by 0020 per 0018-REVIEW-phase0's explicit instruction, not by a cap.
Previous review: 0018-REVIEW-phase0 (verdict: REVISE, 5 fixes)

**Verdict: ACCEPT WITH EDITS.** All five REVISE fixes are genuinely closed and correctly tested.
Two new findings, both small, both fixed here (2 lines of code, 2 rulings: D-023, D-024). Two
forward hazards recorded for `document.ts`. **`document.ts` may begin.**

## Did the REVISE list actually close?
Checked each against the code, not the log. All five: yes.

1. **D-018 part 1** — `findSchemaSlotKindMismatches`, loop 1. Rejects a schema-declared derived path
   with no slot at it. ✅
2. **D-018 part 2** — same function, both directions (wrong kind at a derived path; `derived` at a
   `nonDerivedSlotPaths` path). ✅ L-13 pinned directly in `eval.test.ts` — 0014-REVIEW's constraint
   8, open since 0015, now closed.
3. **D-019** — `deepClone` by hand, `NaN`/`±Infinity` preserved. ✅
4. **D-021** — `mutate` rejects an unresolvable target before staging. ✅ (message reworked, below)
5. **D-020** — `mutate(objects, operations, journal)`, one clone, one `deriveValidateAndEvaluate`,
   one journal entry holding the whole list. Widened, not duplicated, as ruled. ✅

The dangling-`dependentSlot` argument I corrected at 0018-REVIEW is now **true**, and for the right
reason: source 1's dependents are slots `deriveEdges` looked up and found; source 2's are
schema-declared paths that check 2 now guarantees exist. The header says so and the D-018 tests
carry it. That is the finding closed properly rather than papered over.

## Rule audit
Rules 1, 3, 4, 6, 7 — not touched or upheld unremarkably; Rule 1 re-checked mechanically, clean
under the DOM-free config. Rule 5 — upheld; `deepClone` is the dumbest correct implementation
written out longhand, and the batch fold is a plain `reduce`. **Rule 2 — upheld, and the two rule
findings 0018-REVIEW raised against it are closed** (D-019's accept-path corruption; D-021's false
journal record). One new, smaller Rule 2 leak found and fixed — finding 2 below.

## Invariant audit
No dangling edges — **now genuinely upheld** (see above). Rejection leaves prior state unchanged —
upheld, and the all-or-nothing batch test extends it correctly to a partial batch. Slot set fixed
during evaluation, derived slots inside the topological pass, eager/total extraction, no `#CYCLE`,
plain serialisable state — all upheld, none disturbed.

## Two new findings

### Finding 1 (D-023) — the D-021 rejection message cannot tell two failures apart
Probed:

```
mutate([ setSlot obj_404.value, setSlot obj_405.value ])
-> no object exists to apply this operation to — target slot "value" names no real object (D-021);
   no object exists to apply this operation to — target slot "value" names no real object (D-021)
```

The same sentence twice, for two different missing objects. 0020's own stated reason for naming
every offending operation rather than the first — "a document load with several bad references
benefits from seeing all of them at once" — is exactly what this defeats, and §5.1 step 6 asks for
a *human-readable* failure.

The cause is an over-application of D-015. That ruling forbids leaking the identity layer **where a
name exists**; here the entire content of the rejection is that nothing resolves, so there is no
name, and suppressing the id leaves nothing. `address.ts`'s own `formatAddress` already prints the
raw id in this exact case, which the previous STATUS recorded as a "disclosed asymmetry" rather
than as the hint it was. Ruled **D-023**: name the id, labelled as an id, and say which operation.
The message now reads `operation 1 of 3 targets slot "value" on object id "obj_404", which does not
exist in this document (D-021)`.

Worth saying plainly: this is the failure mode of following a ruling faithfully past the edge of
its rationale. The instinct — check D-015 before writing a message — was right.

### Finding 2 (D-024) — the caller's payload enters committed state and the journal by reference
Probed:

```
committed.objects[0].slots.value === callerPayload            -> true
committed.objects[0].slots.value === committed.objects[1]...  -> true   (one object, aliased twice)
committed.journal[0].operations  === callerOperationsArray    -> true
```

Nothing is broken today: every field is `readonly`, so no caller can legally mutate them. But this
is the third appearance of the same shape, and the project has ruled against it twice already —
0017's own argument for keeping the clone ("a guarantee that rests on every downstream function
staying pure forever is an accident, not a structure"), which I upheld, and D-019. Rule 5's staging
exists so that committed and prior state share nothing; a payload injected un-cloned reopens that
boundary from the other side. The journal is the sharper half — it is specified append-only, and a
caller reusing its own array could otherwise rewrite what a past call recorded.

Ruled **D-024** and fixed here: two lines, both mutation-checked (each neutralisation failed
exactly its own new test, nothing else).

## Legibility audit
Headers, vocabulary, and comment discipline all hold. `findSchemaSlotKindMismatches` kept separate
from `findUndeclaredFormulaOrDerivedSlots` was the right call and the entry's reason for it — one
ruling per function, so blame stays legible — is a better reason than the one I would have given.
`formatSchemaAddress` correctly needs no `describeUndeclaredSlot`-style exception, and says why.
No `any`, no `.only`, no `.skip`. `PROVISIONAL(Q-005)` tags unchanged and still matching STATUS.

One residual: the D-021 check now sits in `mutate` while every other rejection lives in
`validateIntegrity`. That is correct — it is a precondition on the *operation*, not on the graph —
but it means two functions can reject, and a future reader will look in only one. The file header
does call this out. Left as is.

## Honesty audit
Re-ran everything. `npm run typecheck` clean under both configs. `npm test` **148/148, 0 skipped, 0
`.only`** — exactly as 0020 reported, and the intermediate 143 is consistent with 0019's arithmetic
(139 − 3 + 6 + 1). `git diff --numstat 9392a97 HEAD` over `src/`: 610 added / 159 deleted = **769
changed lines across 3 files** — 0020's figure to the line, and it says in the entry that it
measured directly rather than summing per-cycle, which is 0014-REVIEW's constraint 6 applied
without being asked.

0019's *pre-fix* transcript — running the old KNOWN-GAP assertions against the fixed code and
pasting the four failures — is a better piece of evidence than the fixes themselves. It proves the
change is measured against what the last review actually found, not against a baseline invented
after the fact. Nobody asked for it.

**The strongest thing in this batch is a test that did not ship.** 0020 wrote a "last write wins"
test whose comment claimed it demonstrated the shared-clone fold, mutation-tested that specific
claim, found the fixture could not distinguish "one shared clone" from "N independent clones,
keep the last" — both give 200 when both operations target the same address — and corrected the
comment before committing. That is 0018-REVIEW's finding 1 (a plausible claim written as a proof)
caught by the implementer, in a test comment, before review. The process worked in the direction it
is supposed to work.

No scope expansion. 0019 declined D-020 and said so; 0020 declined `document.ts` and said so. 0020
ended the cycle on my explicit instruction rather than on the numeric cap it had not reached, and
said which it was honouring and why — the right reading.

## Reviewer edits (2, both in `mutation.ts`, both mutation-checked)
1. `mutate`'s D-021 message — now `operation N of M targets slot "…" on object id "…", which does
   not exist in this document (D-021)` (D-023). Two tests' expectations updated accordingly; D-023
   is the authorisation for that change.
2. `applyOperation` clones `operation.slot` into committed state, and `mutate` stores the journal's
   own copy of the batch (D-024). Two new tests pin both.

Post-edit: **150/150**, both configs clean.

## Answered questions
No new questions were raised by either cycle, correctly — neither hit load-bearing ambiguity.
**Q-006** stays open and is now the one thing blocking clause 4's test; I widened it with a note
this review found: §5.11 serializes **the mutation journal**, whose `Operation` payloads carry the
same `Value` union, so Q-006 governs the journal as well as the object list. Answer it once, for
both. **Q-005** open by design, **Q-001/Q-002** (Phase 3), **Q-004** (Phase 2) deferred, **Q-003**
ANSWERED → D-007. Next free: **Q-007**.

## Constraints carried forward — read these before `document.ts`
1. **Object creation will invalidate where D-021's check sits.** §5.11: "Loading applies objects
   through the mutation API." That needs a `CreateObjectOperation`, and `mutate` currently validates
   every operation's target against the **pre-batch** `objects`, before the fold. `applyOperation`'s
   doc comment states the assumption that makes this sound — "`SetSlotOperation` never adds or
   removes an object" — and the next slice is precisely the one that breaks it. When a create
   variant lands, the target check must become variant-aware or move inside the fold. Do not leave
   that as a comment; make it a test.
2. **An empty batch is rejected** (0020's own extension of D-021's reasoning — accepted, it is
   sound). Loading a document with zero objects therefore must not be routed through `mutate` at
   all: there is nothing to apply. Handle it in the loader, do not weaken the rejection.
3. **D-024 binds every future operation kind**, which will carry larger payloads than one `Slot`.
4. **Q-006 covers the journal too** (above). Answer before writing clause 4's round-trip test.
5. Still standing from earlier reviews: do not extend `nonDerivedSlotPaths` to slot families; do not
   add a defensive cycle check inside `eval.ts`; `L-10` (`addressKey` assumes `obj_<n>` ids) wants a
   note in `document.ts`; count diffs from `git diff --numstat`.
6. The Phase 0 gate is still ahead. Clauses 3 and 4 remain open and the gate is reviewed as one
   unit — a phase gate is never batchable (§6.1 trigger 1).
