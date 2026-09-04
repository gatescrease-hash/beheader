# 0171 — Phase 6 gate: claiming PROJECT_BRIEF §6's Phase 6 acceptance criterion
Date: 2026-09-04   Phase: 6   Model: implementer (Claude Sonnet 5)
Previous entry: 0170-REVIEW-phase6   Last review: 0170-REVIEW-phase6 (verdict: ACCEPT)
Batch: cycle 1 of up to 3 since last review; 0 lines / 0 files changed (a neutralisation was made
and fully restored — see "Verification" — so the tracked diff is empty; this is a §6.1 trigger 1
phase gate regardless of batch state, per §12).

## Declared scope

Write the Phase 6 phase-gate entry itself: state the acceptance-criterion claim, back it with a
fresh D-016 mutation check (not merely a citation of 0169's/0170-REVIEW's), and decide the one
open scope question STATUS.md left for whoever writes this entry — whether `image` rendering is
required before Phase 6 can be called done. Not in scope: building anything (`image` rendering,
`script` rendering, `addport`/`removeport`) — this entry is a claim, not a slice of code.

## Explicitly not in scope

- `image` rendering + the §5.7 file picker — decided below to be independent of this gate, tracked
  in STATUS.md's "Not started" regardless of the decision.
- `script` rendering (a labelled box with ports) and a real `addport`/`removeport` UI mechanism —
  unscoped future work, unchanged by this entry.
- `command/props.ts`'s D-077 walk not summarising `script`'s two dynamic non-derived families —
  disclosed in that file's own header (0169), not this entry's to fix.

## What I did

Nothing in `src/`. This entry is the formal §12 claim that Phase 6's acceptance criterion, as
PROJECT_BRIEF §6 states it, passes — the code, the schema, the command, and the integration test
that demonstrates it were all built and reviewed at entries 0167–0170. What this cycle added is the
gate declaration itself, plus one thing 0169/0170-REVIEW had not yet done specifically *for this
claim*: I ran D-016's mutation check myself, fresh, today, rather than resting the gate on the two
prior runs — see "Verification" below.

## Decisions I made

1. **The scope question STATUS.md raised — does Phase 6 require `image` rendering before the gate
   can be claimed — is answered NO, and the gate is claimed on the criterion text alone.**
   PROJECT_BRIEF §6's own framing sentence is unambiguous on which text is the contract: "Each
   phase has an acceptance criterion... ✅ **Done when:**" — and PROCESS_BRIEF §12 repeats it
   verbatim: "The brief's §6 acceptance criteria are the contract." Phase 6's ✅ line reads in full:
   *"`script_1.in.factor` is bound to a cell, `polygon_1.radius` is bound to `script_1.out.result`,
   and changing the placeholder output value moves the polygon — with no script-specific code in
   `eval.ts`"* — three clauses, all about `script`/`polygon`, none mentioning `image`. The phase's
   PROSE TITLE ("Phase 6 — Script stub + image / Both small. Ports must be ordinary slots.") is the
   build-order section's description of what work was expected to fit in the phase's slot in the
   schedule, not a restatement or a widening of the ✅ line — every other phase in §6 follows the
   same shape (a prose sentence naming the phase's subject matter, then a separately-labelled ✅
   sentence that is the actual test). Treating the prose title as part of the contract would make
   every phase's gate criterion say more than its own ✅ line says, which is not how any earlier gate
   in this project's history was read (Phase 4's gate, for instance, was claimed and reviewed on
   its three lettered sub-clauses alone, entry 0116-REVIEW, with no requirement that every primitive
   named in that phase's build-order prose also be complete).
   This is an implementation-level, documentation-facing call, not a Q-NNN escalation — it decides
   how a phase gate is WORDED and WHEN it is claimed, not the data model, addressing, or mutation
   sequence PROCESS_BRIEF §7 clause 3 reserves for escalation. It is reversible: if the human
   disagrees, un-claiming this gate costs one entry saying so, with no code or stored state to
   unwind. `image` rendering stays exactly as open as it already was in STATUS.md's "Not started"
   list — this decision changes nothing about when that work happens, only when the phase-6 LABEL
   is allowed to read "gated."
2. **The D-016 mutation check is run fresh in this entry rather than only cited from 0169/0170.**
   D-016 says a criterion claim "MUST be backed by a mutation check" before it is reported as
   PASSING; the check was already performed twice (entry 0169, independently re-derived at
   0170-REVIEW), but neither of those was itself the phase-gate claim — 0169 explicitly declined to
   make this claim ("not claimed here... that audit belongs to whoever writes the gate entry"), and
   0170-REVIEW is a review of 0169, not a gate entry. Re-running it costs one edit-and-revert and
   removes any doubt that this specific entry's claim rests on evidence rather than a citation of
   someone else's.

## Verification (real output)

Full suite, clean tree, before touching anything:

```
$ npx tsc --noEmit
(clean, exit 0)
$ npx tsc --noEmit -p tsconfig.engine.json
(clean, exit 0)
$ npm test -- --run
 Test Files  35 passed (35)
      Tests  1844 passed (1844)
```

"No script-specific code in `eval.ts`" clause, checked directly:

```
$ grep -n "script" src/engine/graph/eval.ts
(no matches)
```

D-016 mutation check, run fresh for this claim — removed the `placeholder.<port>` dependency line
from `scriptOutDependencies` in `src/engine/script/stub.ts` (the one line the criterion's third
clause, "changing the placeholder output value moves the polygon," depends on):

```
$ npx vitest run src/command/commands.test.ts -t "Phase 6's acceptance criterion"
 ❯ ... Phase 6's acceptance criterion, its exact shape: ...
   AssertionError: expected { error: '#REF', …(1) } to be 10
   + Received:
     { "error": "#REF", "message": "derived slot's compute function read an
       address outside its declared dependencies (D-013)" }
 Tests  1 failed | 197 skipped (198)
```

Named test failed exactly as predicted, at exactly the line reading `script_1.out.result`. Restored
the line (`git diff` against the file is empty; `git status --porcelain` is empty), re-ran the full
suite:

```
$ npm test -- --run
 Test Files  35 passed (35)
      Tests  1844 passed (1844)
```

## Acceptance criteria status

**Phase 6 criterion** *("`script_1.in.factor` is bound to a cell, `polygon_1.radius` is bound to
`script_1.out.result`, and changing the placeholder output value moves the polygon — with no
script-specific code in `eval.ts`")* — **PASSING.** Demonstrated by
`src/command/commands.test.ts`'s `"Phase 6's acceptance criterion, its exact shape..."` test
(built at entry 0169), which reproduces the criterion's exact shape end to end: a table cell drives
`script_1.in.factor` via `link`, `polygon_1.radius` is bound to `script_1.out.result` via `link`,
and `set script_1.placeholder.result 25` moves the polygon's radius from 10 to 25 while
`table_1.A1`'s own binding into `script_1.in.factor` still holds. Backed by this entry's own D-016
mutation check (above), not merely the two prior runs (0169, 0170-REVIEW) that also confirmed it.
The "no script-specific code in `eval.ts`" clause is confirmed by direct grep, this entry and
0170-REVIEW agreeing.

**PHASE 6 IS THEREFORE GATED**, on the criterion text alone — see "Decisions I made" #1 for why
`image` rendering is not a precondition of this claim. `image` rendering, `script` rendering, and a
real port-declaration UI remain open work, tracked in STATUS.md exactly as before this entry.

## Where I got stuck / what is unfinished

Nothing — this cycle was the gate claim itself, and the evidence it rests on already existed and
re-verified cleanly. The scope call in "Decisions I made" #1 is the one place a future reader might
disagree; if the human reads Phase 6's build-order prose as binding rather than descriptive, this
gate should be un-claimed pending `image` rendering, and that costs one more entry, not a revert of
any code.

## Open questions raised

None.

## Review point

Fired: **§6.1 trigger 1 — a phase acceptance criterion is claimed complete.** Always mandatory,
never absorbed into a batch, per §12: "Every phase gate is reviewed before the next phase begins.
No exceptions." The reviewer should independently re-run the D-016 check above rather than take it
on this entry's word (per §8's honesty audit), and should confirm or overturn "Decisions I made" #1
— the reading that the ✅ line, not the phase's prose title, is Phase 6's binding contract.
