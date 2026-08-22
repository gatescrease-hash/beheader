# DECISIONS

Binding rulings that extend `PROJECT_BRIEF.md` where it is silent or under-specified.

**Implementers: treat every entry here as part of the brief.** You may read it; you may
NEVER write to it. Only the reviewer or the human adds entries. If you believe a decision
here is wrong, raise a question in `OPEN_QUESTIONS.md` — do not act against it.

Append only. Never edit or delete a past decision. To change one, add a new decision that
supersedes it and mark the old one `SUPERSEDED BY D-NNN` in place.

---

## D-001 — Test runner is Vitest; tests are colocated `*.test.ts` files
Answers: (seed)   Ruled: entry 0000-SEED-reviewer   Binding on: all future cycles

Ruling: Use Vitest as the test runner (dev dependency only). Test files live next to the
code they test as `<module>.test.ts` — `src/engine/address.test.ts`, not a parallel
`test/` tree. Run the full suite with `npm test`; typecheck with `npx tsc --noEmit`. Both
MUST be runnable independently and both MUST be clean at the end of every cycle.

Rationale: The brief says "a test runner such as Vitest" and leaves it open. Settling it
now prevents two implementers from choosing differently. Colocation is chosen because the
engine is a 1:1 Rust port target and Rust colocates tests with modules — the file layout
should rehearse the destination. Note that colocated tests do not violate Rule 1: test
files may import a fake `TextMeasurer`, but the module under test still may not touch DOM.

---

## D-002 — Object IDs come from a counter stored in the document
Answers: (seed)   Ruled: entry 0000-SEED-reviewer   Binding on: all future cycles

Ruling: Object IDs are `obj_<n>` where `n` comes from a monotonically increasing integer
`nextObjectId` stored **in the document itself** and serialized with it. It increments on
every object creation and NEVER decrements, is NEVER reset, and IDs are NEVER reused —
including across a save/load round trip and including after the object holding an ID is
deleted. Loading a document restores the counter as-is; it is not recomputed from the
object list.

Rationale: §5.2 requires IDs be "opaque, stable, never-reused" but does not say where the
allocator lives. If the counter is module-level state, or is rederived on load as
`max(existing) + 1`, then save → delete an object → load → create reuses a dead ID. Any
mutation-journal entry or stale reference naming the old ID would then silently bind to a
different object. This is exactly the class of bug that surfaces months later and is
untraceable, so the counter is document state, like everything else (Rule: graph state is
plain and serializable).

Consequence for `document.ts`: `nextObjectId` is part of the round-trip test. A document
that round-trips its objects but not its counter fails Phase 0.

---

## D-003 — One cycle is one commit; the commit message names the log entry
Answers: (seed)   Ruled: entry 0000-SEED-reviewer   Binding on: all future cycles

Ruling: Each work cycle produces exactly one commit, on `main`, whose first line is
`NNNN <slug>` matching the log entry filename (`0004 formula-lexer` ↔
`claude-log/entries/0004-formula-lexer.md`). The commit includes the code, the tests, the
new log entry, and the rewritten `STATUS.md`. Reviewer edits are a separate commit,
`NNNN-REVIEW <phase>`. Do not create branches; do not amend or rebase past commits.

Rationale: The log is the project's only continuity, and it is only trustworthy if the
history and the log line up one-to-one. Rewriting history breaks that mapping. A single
linear branch is also the honest representation of a single-threaded workflow — there is
no parallel work to merge.

---

## D-004 — `PROVISIONAL` tags are a build-visible debt, not a comment style
Answers: (seed)   Ruled: entry 0000-SEED-reviewer   Binding on: all future cycles

Ruling: Every provisional choice taken against an open question MUST be tagged in code as
`// PROVISIONAL(Q-NNN): <one line>`. Every such tag MUST also be listed in `STATUS.md`
under *Live PROVISIONAL tags* with its file paths. A cycle is not complete if a tag exists
for a question that has already been answered in this file.

Rationale: Provisional choices are the mechanism that lets an implementer keep moving
through ambiguity without silently committing the project to a guess. They only work if
they are findable later by `grep`, and if `STATUS.md` surfaces them without anyone having
to grep at all.
