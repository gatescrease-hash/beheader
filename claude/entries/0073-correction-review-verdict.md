# 0073 — Correction: entry 0072's verdict was wrong
Date: 2026-08-25   Phase: 3   Model: Claude Sonnet 5 (implementer)
Previous entry: 0072-fix-list-command-lexer   Last review: 0071-REVIEW-phase3 (verdict: REVISE)
Batch: cycle 2 of up to 3 since last review; ~447 lines / 4 files changed so far (unchanged — no
code touched by this entry).

## What happened

Entry 0072's cycle summary stated `REVIEW: RECOMMENDED`. The human pointed out that is not a valid
verdict — PROCESS_BRIEF §6.4 only has two states here: a §6.1 trigger fired (REQUIRED) or it didn't
(NOT NEEDED, or RECOMMENDED only for genuine uncertainty with no trigger). `RECOMMENDED` was hedging,
not a decision.

Re-checked against §6.1 honestly rather than by feel: entry 0072 **did** fire trigger 5 —
"You changed a test's expectations, or a previously-passing test now fails." F2's fix replaced
`prompt.test.ts`'s "reports too many arguments with the parser's own message rather than a second
one" test with one asserting a different message (naming the surplus token, not the first one). That
test was passing before entry 0072 and asserts something different after it. 0071-REVIEW §10 item 2
said as much directly: "it is a §6.1 trigger-5 change and belongs to the cycle that makes it" — the
review authorised the CHANGE, not an exemption from the trigger it named. Compare D-021's own
reconciliation note, which draws the same distinction: a ruling can pre-authorise a changed test
expectation; the trigger still fires and the cycle must still say so.

`§6.1`'s own header is unconditional: "Some things demand an immediate stop, no matter how much of
the batch cap (§6.3) is left." Trigger 5 is one of them. This was never a "genuinely unsure" cycle
(§6.4's bar for `RECOMMENDED`) — it was a fired, mechanical trigger, and the correct verdict was
knowable at the time from the same fact I already had in the log entry.

## Correction

**REVIEW: REQUIRED**, not RECOMMENDED. Reason: §6.1 trigger 5, fired by entry 0072's change to
`prompt.test.ts`'s "reports too many arguments" test (F2).

No code changes in this entry — this is a documentation correction to `STATUS.md` only, entry 0072
itself is left as written (append-only; the record of what I concluded at the time, wrong verdict
included, has its own value per PROCESS_BRIEF's closing line). Behaviourally nothing changes: entry
0072 already stopped and handed a cycle summary to the human rather than starting `commands.ts`,
which is what trigger 5 requires regardless of which label was on it.

## Verification

Not applicable — no source file touched. `git diff --stat` for this entry is `STATUS.md` and this
file only.

## Review point

Fired: **§6.1 trigger 5** (entry 0072, restated correctly here). REQUIRED, not RECOMMENDED.
