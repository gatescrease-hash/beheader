# 0077 — RULINGS (human): D-076 widened to every length budget
Date: 2026-08-25   Phase: 3   Model: Claude Opus 5, recording the human's ruling
Previous entry: 0076-RULINGS   Last review: 0074-REVIEW-phase3 (ACCEPT WITH EDITS)

No code was written. One ruling, widening one already made in the previous entry.

## What was ruled

Entry 0076 flagged that `STATUS.md` has its own budget in PROCESS_BRIEF §2 ("Keep < 150 lines"),
that it stands at 192, and that the human's reasoning about headers probably applied — but
declined to extend the ruling without being asked. The human then asked:

> "Fold the status.md ruling into D-076 — no need to report on length budget."

**D-076 clause 3 now withdraws every length budget in this project, not only the header one.** A
header over 40 or 80 lines is not a finding; a `STATUS.md` over 150 is not a finding; the length
of anything is not to be reported — in a review, in `STATUS.md`'s known problems, or in a log
entry's self-assessment.

**One length rule survives and is the only length finding a review may raise: `WHAT THIS IS` is
capped at 15 lines.** That distinction is the point of the ruling rather than an exception to it —
the cap sits on prose because prose is where padding accumulates, and nowhere else.

## Correcting entry 0076

Entry 0076 recorded D-076 as a header-only ruling and said so throughout. **That account is now
incomplete**, and since `entries/` is append-only this entry is the correction rather than an edit
to that one.

**D-076 was amended IN PLACE rather than superseded by a new decision, at the human's explicit
direction.** DECISIONS.md is append-only and I want the reason this was allowed on the record, in
the decision itself and here:

- No cycle had read or built on the original wording. It was ruled, and widened, in the same
  session, before the reviewer ever saw it.
- The original text is preserved verbatim in commit `0df17f0`, so the chronology the append-only
  rule protects is intact where it actually lives.
- D-076 now carries a note saying this is **not** a precedent: append-only stands, and a decision
  any cycle has consumed changes only by a new decision that supersedes it.

Had the ruling arrived one cycle later, the correct form would have been D-077 superseding D-076,
and that is what a future model should do.

## Files changed

- `claude/DECISIONS.md` — **D-076** retitled and clause 3 widened; a new rationale paragraph for
  the `STATUS.md` half; the in-place-amendment note above. Clauses 1, 2 and 4 unchanged.
- `claude/PROCESS_BRIEF.md` — §2's "Keep < 150 lines" struck; §5.2's "do not report a header for
  being long" widened to "do not report the length of anything", naming the 15-line prose cap as
  the one survivor.
- `claude/STATUS.md` — its own length known-problem DELETED (the last cycle raised it; this one
  removes it rather than carrying it), the D-076 summary and the gotcha widened.

No source file was touched.

## Verification

```
$ npx tsc --noEmit                              exit 0
$ npx tsc --noEmit -p tsconfig.engine.json      exit 0
$ npx vitest run
 Test Files  23 passed (23)
      Tests  925 passed (925)
```

## Review point

**None fired.** Documentation only. Entry 0075's §6.1 trigger 5 and its over-cap diff still stand.

**REVIEW: still REQUIRED, for entry 0075** — and entry 0075 is the whole of what the reviewer
audits. Entries 0076 and 0077 are the human's own rulings, not implementer work to be graded, and
the reviewer should read D-075 and D-076 as binding before starting: **D-076 retires two of the
things entry 0075 reports against itself**, and reporting either of them again is now a defect in
the review rather than a finding.
