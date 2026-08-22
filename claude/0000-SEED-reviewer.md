# 0000 — SEED (reviewer)
Date: (set on first commit)   Phase: 0 (not started)   Model: reviewer
Previous entry: none   Last review: this one

This entry exists so the log has a valid head. No code was written or reviewed.

## What was established

- `claude/` created: `STATUS.md`, `DECISIONS.md`, `OPEN_QUESTIONS.md`, `entries/`.
- Four seed decisions ruled: D-001 (Vitest, colocated tests), D-002 (document-stored ID
  counter), D-003 (one cycle = one commit), D-004 (PROVISIONAL tags are tracked debt).
- Three ambiguities pre-identified as Q-001, Q-002, Q-003. All land in Phase 3; none blocks
  Phase 0. **Q-003 (does `explode` preserve object identity) is flagged non-reversible — it
  must be escalated, not guessed.**

## Notes to the first implementer

Read `PROJECT_BRIEF.md` in full, then `PROCESS_BRIEF.md`, then `STATUS.md`, `DECISIONS.md`,
`OPEN_QUESTIONS.md`. Your slice is scaffold + `address.ts` + its tests, and nothing else.
Expect a review point at the end of it: `address.ts` is load-bearing and everything in the
project rests on it.

Two things that will be checked hardest:

1. **A stored address never contains a user-facing name.** Test: create an object, write a
   formula against its name, rename the object, assert the stored AST is byte-identical while
   the *displayed* formula shows the new name. That is the whole point of the two-layer scheme
   (Rule 3) and should exist before anything reads addresses.
2. **`engine/` is pure.** No `document.`, `window.`, canvas, or `render/` import. Grep your own
   diff before you log.

Report honestly. An unfinished cycle with an accurate log is worth more than a complete one
that misreports itself.
