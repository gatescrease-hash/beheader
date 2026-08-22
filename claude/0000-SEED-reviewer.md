# 0000 — SEED (reviewer)
Date: (set on first commit)   Phase: 0 (not started)   Model: reviewer
Previous entry: none   Last review: this one

This entry exists so the log has a valid head and every later entry has something to point
back to. No code was written or reviewed.

## What was established

- `claude-log/` created: `STATUS.md`, `DECISIONS.md`, `OPEN_QUESTIONS.md`, `entries/`.
- Four seed decisions ruled: D-001 (Vitest, colocated tests), D-002 (document-stored ID
  counter), D-003 (one cycle = one commit), D-004 (PROVISIONAL tags are tracked debt).
- Three ambiguities in `PROJECT_BRIEF.md` pre-identified as Q-001, Q-002, Q-003. All three
  land in Phase 3; none blocks Phase 0. **Q-003 (does `explode` preserve object identity)
  is flagged non-reversible — it must be escalated, not guessed.**

## Rule audit
Rules 1–7: not touched — no code exists.

## Verdict
N/A. Baseline only. The first implementation cycle is 0001.

## Notes to the first implementer

Read `PROJECT_BRIEF.md` in full, then `PROCESS_BRIEF.md`, then `STATUS.md`, `DECISIONS.md`,
`OPEN_QUESTIONS.md`. Your slice is scaffold + `address.ts` + its tests, and nothing else —
`STATUS.md` says why. Expect `REVIEW: REQUIRED` at the end of it: `address.ts` is a §6
trigger-2 file and everything in the project rests on it.

Two things that will be checked hardest in review of cycle 0001, so build for them:

1. **A stored address never contains a user-facing name.** There should be a test that
   creates an object, writes a formula against its name, renames the object, and asserts
   the stored AST is byte-identical while the *displayed* formula shows the new name. That
   test is the whole point of the two-layer scheme (Rule 3) and it should exist before
   anything reads addresses.
2. **`engine/` is pure.** No `document.`, no `window.`, no canvas, no import from
   `render/`. Grep your own diff for these before you log.

Report honestly. An unfinished cycle with an accurate log is worth more than a complete
one that misreports itself.
