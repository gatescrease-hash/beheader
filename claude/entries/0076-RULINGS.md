# 0076 — RULINGS (human)
Date: 2026-08-25   Phase: 3   Model: Claude Opus 5, recording the human's rulings
Previous entry: 0075-command-handlers-creation   Last review: 0074-REVIEW-phase3 (ACCEPT WITH EDITS)

No code behaviour was written or reviewed in this entry. The human ruled on the three things entry
0075 handed up, having asked for the consequences of each first. One was a confirmation, two are
new binding decisions.

## What was ruled

| Question | Ruling | Decision |
| --- | --- | --- |
| Entry 0075 decision 1 — does a created table get cell slots? | **Confirmed as built: no cell slots.** Conditioned explicitly on "it behaves identically", which D-047 clause 3 requires and a test pins. | — (confirms D-047) |
| Entry 0075 question 2 — where do `select`/`zoom`/`fit`/`save`/`load` land? | **The plan as proposed.** `commands.ts` resolves and refuses; it returns an EFFECT as plain data; `main.ts` performs it. | **D-075** |
| The header budget, carried by five consecutive reviews | **Leave the files as they are, stop flagging it, amend the rule — and cap the PROSE at 15 lines.** | **D-076** |

## D-075 — non-document commands return an effect

The human took the recommended option over the two alternatives I laid out. The two rejected ones
are recorded inside the decision, because the reason they were rejected is the load-bearing part:
handing those five commands to `main.ts` would create a second name-resolution site in the one
file no test reaches, and passing the camera, viewport and a file-IO callback INTO `executeCommand`
would force either a DOM import into `command/` or a growing signature.

Consequence for the next cycle: nothing yet. Entry 0075 stated this only as an intent in
`commands.ts`'s NOT DONE HERE. That paragraph now cites D-075 and states the shape, which is the
only change made to source in this entry.

## D-076 — the header budget, settled

The human's direction, in substance: the program's complexity has outgrown the number; do not
shrink the files, do not run a verbosity audit, stop reporting it — but cap the prose, because
prose is where padding accumulates.

Measured across all 24 non-test source files before ruling, so the cap was set against evidence
rather than instinct:

```
21 of 24 files exceed 40 lines of HEADER      (the old rule's ordinary budget)
12 of 24 files exceed 15 lines of PROSE       (the new rule's cap)
worst prose blocks:  mutation.ts 111 · primitives/table.ts 69
                     formula/parser.ts 52 · formula/functions.ts 49
worst headers that are NOT worst prose:  primitives/geometry.ts 74 header / 13 prose
                                         render/hittest.ts 62 / 18 · graph/eval.ts 77 / 22
```

That last line is the whole argument: `geometry.ts` reads as a 74-line offender under the old rule
and is 13 lines of prose plus long, one-line-per-item lists. The old number was measuring the
wrong thing. `commands.ts`, written yesterday, is 56 header / **11 prose** and complies as built.

The cap binds new and edited headers. It is deliberately **not** a sweep — twelve files miss it
today and stay as they are until a cycle opens them for another reason, exactly D-058's stance.

## Files changed

- `claude/DECISIONS.md` — **D-075**, **D-076** appended. (Written by me at the human's direction
  and in the human's name, on the precedent of entries 0038, 0056 and 0070; PROCESS_BRIEF §2's
  "implementers never write to this file" is not a bar on recording a ruling the human made.)
- `claude/PROCESS_BRIEF.md` §5.2 — the 20–40 / ~80 budget replaced by the 15-line prose cap, with
  an explicit "do not report a header for being long" and an explicit no-sweep clause. **The
  amendment is the human's; I am the scribe.**
- `src/command/commands.ts` — NOT DONE HERE now cites D-075 and states the effect shape, instead
  of describing an unratified intent. Comment only; no behaviour changed.
- `claude/STATUS.md` — the header-budget known problem DELETED per D-076 clause 3, not carried.

## Verification

```
$ npx tsc --noEmit                              exit 0
$ npx tsc --noEmit -p tsconfig.engine.json      exit 0
$ npx vitest run
 Test Files  23 passed (23)
      Tests  925 passed (925)
```

Unchanged from entry 0075, as expected: the only source edit was a comment.

## Review point

**None fired.** No behaviour changed, no test expectation changed, no new file, no dependency.
Entry 0075's own trigger 5 and its over-cap diff still stand and still require review — this entry
does not clear them and does not add to them.

**REVIEW: still REQUIRED, for entry 0075.** The reviewer should read D-075 and D-076 as binding
before auditing 0075, since D-076 retires one of the findings 0075 reports against itself.
