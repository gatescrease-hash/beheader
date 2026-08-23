# 0038 — RULINGS (human)
Date: 2026-08-23   Phase: 2 (opening)   Model: reviewer (Claude Opus 5), recording the human's rulings
Previous entry: 0037-REVIEW-phase1   Last review: 0037-REVIEW-phase1 (verdict: ACCEPT WITH EDITS,
Phase 1 gate PASSED)

No code was written or reviewed in this entry. The human ruled on the four open questions that
needed a product-level answer before Phase 2's first slice, plus one standing correction to how
this project's rationale is written. All five are now binding decisions.

## What was ruled

| Question | Ruling | Decision |
| --- | --- | --- |
| Q-010 — typo'd formula: refuse at entry, or accept and show a broken cell? | **Refuse at entry** — conditioned on not foreclosing autocomplete later | D-038 |
| Q-004 — is lowercase `a1` the same cell as `A1`? | **Accept both, normalise to uppercase** | D-039 |
| Q-002 — writing a literal over a formula slot: refuse, or replace? | **Replace.** Reviewer recommended refusing; overruled | D-040 |
| Q-001 — what does `unlink` keep when the value is currently an error? | **Whatever was on screen**, errors included | D-041 |
| (standing) how rationale is written | **This is a tool with one user.** No product/market reasoning | D-042 |

Four questions closed. `OPEN_QUESTIONS.md` now has **zero open questions blocking any phase** —
the only ones left are Q-007 (camera shape, resolves when Phase 3 builds `render/camera.ts`) and
Q-008 (`-0` as stored state, provisional and approved, nothing depends on it arriving).

## The one that changed direction, and why it matters

**Q-002 went against the reviewer's recommendation, and the reasoning generalises further than the
question did.** I argued for refusing a write to a formula slot, on the grounds that there is no
undo and silently destroying work is unforgivable. The human's answer: this is a tool with one
operator, who is the same person who wrote the formula. An explicit typed command is an explicit
statement of intent, and a tool that argues with its operator about their own work is worse than
one that does what it was told.

That is D-042's principle arriving through a concrete case, which is why both were recorded: the
reviewer's argument was a *product* argument ("a user might destroy something they didn't mean
to") applied to a tool that has no users. The rule going forward: an argument that reduces to "a
user might be confused" carries no weight here; one that reduces to "this silently produces the
wrong number" carries all of it.

The two rulings also compose in a way neither question anticipated. D-041 freezes a currently-
erroring value into a literal on `unlink`, which would be an awkward dead end on its own — except
that D-040 now lets the operator type straight over it. Together they make "get me out of this
formula" a one-command operation in every case, which is a better outcome than either question
was asking for.

## The condition attached to D-038

The refuse-typos ruling came with a condition: it must not foreclose autocomplete or did-you-mean
matching in the formula entry later. That is not a footnote — it constrains the implementation in
four specific ways (validate at commit, never per keystroke; carry the offending name AND its
position in the error; keep the registry enumerable by name; never discard the rejected source
text). All four are in D-038, because three of them are cheap now and expensive to retrofit —
error positions especially.

## What this changes for the next implementer

Two rulings are executable **now** and belong together in Phase 2's first slice, because both are
small, both are contained in `formula/` + `address.ts`, and both close a question that would
otherwise be re-derived mid-cycle:

- **D-039 (lowercase cell refs)** — widen the A1 form test to accept either case; normalise to
  uppercase at the single point where the stored path is built. The test that matters is not
  "lowercase is accepted" but **"both spellings produce the identical stored `Address`"** — D-008's
  own rationale names two-slots-for-one-cell as the bug this is defending against.
- **D-038 (refuse typo'd formulas)** — `parseFormula` rejects an unknown function name and a wrong
  argument count, alongside the unresolvable reference and misplaced range it already rejects. Read
  D-038's four autocomplete constraints BEFORE writing it; the error-position one shapes the error
  type.

Both change an existing test expectation, and **both are pre-authorised** — `parser.test.ts`'s
"parses an unrecognised function name successfully" inverts, and `address.test.ts`'s "does not map
a lowercase cell ref, pending Q-004" inverts. Neither is a §6.1 trigger 5 escalation. Say so in the
entry and move on.

Two rulings are **recorded but not yet executable** — D-040 and D-041 are command-surface work
(§5.10), and the command line is Phase 3. Nothing to build now; they exist so that cycle does not
re-litigate them. `mutation.ts` gains no special handling for either: D-040's replacement is an
ordinary `setSlot`, and edge re-derivation already rebuilds the whole edge set from stored ASTs on
every mutation, so a discarded formula's edges disappear on their own.

D-042 changes no code. It changes how the next entry argues.

## Also still true, from 0037-REVIEW

Phase 2's real work is unchanged and is still the larger job: wire the formula engine into cell
slots, take down the three temporary bridges together, expand ranges under D-036's four
constraints, and extend D-031's value-legality walk to a stored AST's literals in the same cycle
that makes formulas storable. See 0037-REVIEW-phase1 §9.

## Verification

No code changed this entry. Tree unchanged from 0037-REVIEW: both configs typecheck clean,
432/432 tests pass, 0 skipped, 0 `.only`.
