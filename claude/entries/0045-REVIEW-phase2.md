# 0045 — REVIEW (phase 2, range-evaluation wiring)
Date: 2026-08-23   Phase: 2   Model: reviewer
Reviewing: entry 0044 (`range-evaluation-wiring`), the single cycle since 0043-REVIEW-phase2.
Diff reviewed: `f9c1396..9f65009`, 14 source files, 1343 insertions / 505 deletions.

## Verdict

**REVISE.** Four numbered items in §8. Everything else in the cycle stands.

This is good work on a large, genuinely difficult slice. The three temporary bridges came down
together as D-036 required, `extractDependencies` is walked for real, D-044's bounding is correct
and well-tested, D-045 and D-031 landed where they were supposed to, and `MIN`/`MAX`'s spread is
fixed with the zero-argument answer preserved. The mutation-test discipline is the best in the log
so far — check 6 in particular (reverting `MIN` to the spread and confirming the test fails with
the actual `RangeError`) is exactly how you prove a regression test defends a real defect.

But the headline feature does not work for the ordinary case, and the gap blocks the phase gate it
was built to reach. **A range spanning an empty cell cannot be committed at all.** That is Finding
1, it is ruled on as **D-047**, and it must be fixed before the resize cycle starts — because row
insertion is precisely the operation that creates an empty cell inside a range.

## 1. Rule audit

- **Rule 1 (no DOM in `engine/`)** — upheld. Grepped `document.`/`window.`/`canvas`/`render/`:
  clean, no code access.
- **Rule 2 (all state change through `mutation.ts`)** — upheld. Grepped slot/value assignment
  outside `mutation.ts`: clean.
- **Rule 3 (two-layer addressing)** — upheld. `enumerateRangeCellAddresses` builds every address
  through `formatCellReference`; no name is stored.
- **Rule 4 (one expression evaluator)** — **upheld, and this is the cycle's central achievement.**
  `graph/eval.ts`'s old `ReferenceNode`-only `evaluateFormula` is genuinely deleted, and there is
  now exactly one evaluator. Verified by grep: no second evaluation path survives.
- **Rule 5 (dumbest correct implementation)** — upheld. `objects.find` per range read, re-enumerated
  every call, nothing cached. Correct per D-044 and deliberately un-optimised.
- **Rule 6 (slot set fixed during evaluation)** — upheld, **and it holds because of D-046.**
  `readRange` calls `enumerateRangeCellAddresses` *during* evaluation, which reads the table's
  `rows`/`cols`. That is only safe because those dimensions are `literal`-only and therefore cannot
  change mid-pass. The cycle got this right and cited it; worth stating plainly because the same
  call from a `formula` dimension would have reopened 0043-REVIEW's finding from the other side.
- **Rule 7 (no §8 deferred items)** — upheld.

## 2. Invariant audit

- Derived slots evaluated inside the topological pass, never a post-pass — upheld; untouched.
- Dependency extraction eager and total — upheld. `extractDependencies` is walked whole; the
  `IF`-branch totality is unchanged.
- Evaluation lazy per slot, `IF`/`AND`/`OR` still short-circuiting via the D-029 dispatch — upheld,
  and correctly NOT collapsed into a registry lookup. `readRange` is threaded through the lazy
  operand helpers so a range nested inside `IF` still reaches the flattening path.
- Rejection leaves prior state unchanged — upheld; untouched.
- **No dangling edges — VIOLATED in effect, see Finding 1.** Not by leaving one dangling, but by
  the opposite failure: creating edges to cells that legitimately do not exist and then rejecting
  the document for it.
- Graph state plain and serializable — upheld. `readRange`/`read` are closures built per
  evaluation pass and stored nowhere.
- No `#CYCLE` value — upheld. Range-derived cycles are rejected at mutation time, proven by two
  good tests (cross-table through ranges, and the self-inclusive `A6 = SUM(A1:A6)`).

## 3. Findings

### Finding 1 (REVISE — items 1–3; ruled as D-047) — a range spanning an EMPTY cell cannot be committed

`deriveEdges` emits one edge per enumerated range cell unconditionally
([mutation.ts:542-544](src/engine/mutation.ts#L542-L544)), with no check that the cell exists as a
slot. `readRange` likewise returns `#REF` for the whole range if any enumerated cell is missing
from `evaluatedValues` ([graph/eval.ts:307-310](src/engine/graph/eval.ts#L307-L310)). Verified
against the submitted code:

**A 5×1 table with `A1`, `A2`, `A5` populated and `B1 = SUM(A1:A5)` is rejected outright:**

```
EDGES derived: 5
    ["cells","A1"] -> ["cells","B1"]     ["cells","A2"] -> ["cells","B1"]
    ["cells","A3"] -> ["cells","B1"]     ["cells","A4"] -> ["cells","B1"]
    ["cells","A5"] -> ["cells","B1"]
validateIntegrity: {"ok":false,"message":"table_x.B1 references a slot that does not exist;
                                          table_x.B1 references a slot that does not exist"}
mutate ok? false
```

`A3` and `A4` were never written. The document cannot be committed at all.

**The other representation of "empty" fails too.** With `A3`/`A4` present holding `null`, the
mutation commits and `SUM` returns:

```
SUM over [10,20,null,null,50] = {"error":"#TYPE","message":"SUM: argument 3 must be a number, got null"}
```

So there is no way to write a working aggregate over a partially-filled table — which is the
ordinary state of every spreadsheet anyone has ever used.

**Why this blocks the phase gate rather than being a nice-to-have.** Phase 2's criterion requires
"`SUM(A1:A5)` recomputes correctly **after inserting a row inside the range**." Inserting a row
inside a range necessarily creates an empty cell inside that range. Under the current behaviour
that insertion makes the document invalid, so the clause cannot be satisfied. The resize cycle —
the declared next slice — would have hit this on its first test. Better to settle it now.

**Why it wasn't caught.** Every range test in the cycle populates *every* cell of the range: the
5×1 `SUM(A1:A4)` test fills A1–A4, the D-044 `SUM(A1:Z99)` test fills all four cells of its 2×2
table. The sparse case — the common case — is untested. This is not a testing slip so much as a
missing question: the brief is silent on empty cells, which is a §6.1 trigger 3 ("ambiguous,
silent, or self-contradictory on something load-bearing") and should have surfaced as a `Q-NNN`
rather than being settled by omission. Flagging that specifically because this cycle's judgement
was otherwise careful and well-disclosed — the miss was in not noticing there was a decision here
at all.

**Ruled as D-047:** a range SKIPS an absent cell, and skips a `null`-valued one, in both edge
derivation and evaluation; an explicit scalar `null` argument and a plain dangling `ReferenceNode`
are untouched. See the ruling for the full boundary.

### Finding 2 (fixed here) — `deps.ts`'s NOT DONE HERE block was stale and actively misleading

It still described the wiring as unbuilt, named `findUnsupportedFormulaAsts` as a live TEMPORARY
check, and called `functions.ts` and `formula/eval.ts` "not built" — all false as of this cycle.
That is the exact class of stale forward-note this project has twice been bitten by. Rewritten to
describe the four separate range concerns as they now actually stand, with a short note that the
old text was corrected rather than silently replaced. Comment-only; no behaviour change.

Credit where due: the cycle *did* retire the matching stale note in `lexer.ts` — it just missed
this one (and did not disclose the `lexer.ts` edit either, see §6).

### Finding 3 (REVISE — item 4; ruled as D-048) — the `findIllegalOperationPayloads` asymmetry should close now

Answered as question 1 in §7.

### Finding 4 (no change required this cycle) — the dangling-reference message is unhelpful at range scale

`table_x.B1 references a slot that does not exist; table_x.B1 references a slot that does not
exist` names the DEPENDENT twice and never names the missing SOURCE. For a range this scales
badly — a 100-cell range missing 50 cells produces 50 identical strings identifying nothing. D-047
removes the common path into this message, so it is not urgent, but the message should name the
missing source address when it is next touched. Recorded in STATUS.md's Known problems, not in the
fix list.

## 4. Spec conformance

- §5.3 aggregates over ranges — conformant in mechanism, wrong at the empty-cell boundary
  (Finding 1). The eager, left-to-right, stop-at-first-error flattening is right and matches the
  file's existing argument semantics.
- §5.3's "a self-inclusive range is a genuine self-edge — do not special-case it" — **conformant,
  and properly tested.** `A6 = SUM(A1:A6)` is rejected as a cycle with no special-casing. This is
  one of the brief's "deliberate" notes and it survived intact, which is the thing most likely to
  get normalised away.
- §5.4's "do not write a special-case intra-table evaluator" — conformant. Intra- and inter-table
  ranges go through identical code.
- D-036's five constraints — all five discharged: expansion through `read`/`readRange`,
  re-derivation from current dimensions never cached, the placeholder DELETED not extended,
  storability landing in the same cycle, and the `MIN`/`MAX` spread fixed.
- D-044 bounding — conformant and well-tested, including the clamp-to-nothing case.
- D-045 parse-time cross-object rejection — conformant, with the enumeration-layer check correctly
  retained as the defensive arm.
- D-046 `literal`-only dimension reads — conformant at both new call sites.

## 5. Legibility audit

Headers present and updated on every changed file. `mutation.ts`'s `validateIntegrity` doc block
was correctly renumbered from five checks to four when one was deleted — easy to forget, not
forgotten. Vocabulary locked. No `any` in `src/engine/`. No `throw` in engine code. Zero `.only`,
zero skips, no `MUTATION-TEST` residue — all verified by grep.

One stale doc block found and fixed (Finding 2). Test names remain behaviour sentences, and several
name the rule they defend, which is the standard this project asks for.

## 6. Honesty audit

The claimed verification is real. Re-ran independently:

- `npm run typecheck` — clean under both configs, as claimed.
- `npm test -- --run` — 15 files, **536 passed**, exactly as claimed. 0 skipped, 0 `.only`.
- The three bridges are genuinely deleted, verified by grep, not merely disabled:
  `findUnsupportedFormulaAsts` survives only in historical header prose; `isReferenceNode` no
  longer appears in `mutation.ts` at all.
- D-045, D-031's `collectIllegalAstLiterals`, and the `MIN`/`MAX` `.reduce` are all present as
  described.

**Two discrepancies, both minor, neither concealing anything:**

1. **The file count is wrong: 14 changed, not 13** (and 1848 lines, not 1834). The missing file is
   `formula/lexer.ts`, which is **not mentioned anywhere in the entry** — not in "What I did," not
   in scope, not in the not-in-scope list. The change itself is a comment-only correction of a
   stale note, it is correct, and I am keeping it. But an undisclosed file edit is exactly what the
   honesty audit exists to catch, and the log is the project's only continuity: if a file is worth
   editing it is worth one line in the entry. State every touched file, including comment-only ones.

2. The acceptance-criterion section is scrupulous — PARTIAL, not claimed complete, with each clause
   marked and the unreachable half named honestly. Given Finding 1, clause 3's "recomputes
   correctly" is weaker than it reads (it holds only for a fully-populated range), but the entry
   did not overclaim it: it stated exactly which half was demonstrated by which test.

**No silent scope expansion.** The not-in-scope list is real — no resize, no creation command, no
dimension-coherence work appears in the diff. Decision 4 (declining the payload walk) was disclosed
rather than quietly skipped or quietly scope-crept, and the entry argued both sides. That is the
right instinct, and §7 Q1 rules for closing it, not against having asked.

## 7. Answers to entry 0044's four reviewer questions

**Q1 — Close the `findIllegalOperationPayloads`/D-031 asymmetry now? YES, close it.** Your reading
of D-031's binding text was correct, and stopping to ask was right. But your own stated reason for
worrying is the stronger argument: D-025/Q-008's history is the same defect found four times, and
this is a real fifth instance now that a range-containing formula is storable. An illegal literal
in a `setSlot` payload's AST that a later operation in the same batch overwrites reaches the
journal without the post-fold check ever seeing it. D-031 omitted it only because D-031 predates
storable ASTs. Ruled as **D-048**; fix list item 4.

**Q2 — `Address[]` vs. paths plus a `tableObjectId`? `Address[]` is right. Keep it.** Both consumers
need a full address, the function already knows the `objectId`, and pairing `{objectId, path}` at
two call sites is duplication with two chances to diverge. This also settles the signature question
0041-REVIEW §5 left open — closed, no longer an open design note.

**Q3 — Should `readRange` be required rather than optional? Keep it optional, for now.** The
fallback is honest (a distinct `#PARSE` naming the actual cause, "no readRange callback was
supplied"), documented, and tested, and the sole production caller always supplies a real one.
Threading a third argument through ~70 unrelated test call sites buys nothing today and loses on
every §13 tiebreaker (smaller diff, easier to delete later). The real risk you are sensing is a
FUTURE second production caller silently getting `#PARSE` — so make it required at the moment a
second one appears, not before. Recorded in STATUS.md's gotchas so that trigger is not forgotten.

**Q4 — Is fallback-to-one-edge-from-`start` the right mechanism for an unresolvable range table?
Yes. Keep it.** It reuses the §5.1.1 dangling-reference path rather than inventing a parallel one,
and it is what keeps `delete <table>` correctly rejected while a range elsewhere still names the
table — you demonstrated that with a test, which is what made it easy to confirm. The message it
produces is poor at range scale (Finding 4), but that is the message's problem, not the
mechanism's. Do not give ranges a separate failure path.

## 8. REVISE — fix list

1. **`deriveEdges` (`mutation.ts`): skip an enumerated range cell that has no slot on the object.**
   Per D-047 item 1. Do not emit an edge for it. Leave the unresolvable-TABLE fallback (Decision 3)
   exactly as it is — that is a different case and it is correct.
2. **`readRange` (`graph/eval.ts`): omit an absent cell from the returned `Value[]` instead of
   returning `#REF` for the whole range.** Per D-047 item 2.
3. **`readRange`: omit a cell whose value is `null`.** Per D-047 item 3, so both representations of
   an empty cell behave identically. Do NOT change `asNumberList` or any scalar-argument path —
   `SUM(a, null)` stays `#TYPE` (D-047 item 4).
4. **`findIllegalOperationPayloads` (`mutation.ts`): walk a `setSlot`/`createObject` payload's
   `formula`-kind slot AST via the existing `collectIllegalAstLiterals`.** Per D-048.

**Tests required with the fix** — the gap in Finding 1 was a testing gap as much as a design one:

- A `SUM` over a range with genuinely absent cells commits and returns the sum of the cells that
  exist.
- The same with `null`-valued cells present, returning the same answer — the two representations
  must be shown to agree.
- `AVG` over a range with empty cells divides by the count of non-empty cells (this falls out of
  item 3, but it is the clause most likely to regress silently).
- A range over a table where NO cell in the range exists returns the aggregate's own empty answer,
  not `#REF`.
- A plain `ReferenceNode` to an absent slot is STILL rejected as dangling — pinning D-047 item 4's
  boundary so the fix cannot over-reach.
- Item 4's payload walk: an illegal AST literal in a `setSlot` payload that a later operation in
  the same batch overwrites is still rejected.

Everything else in entry 0044 stands as written. Do not restructure the range wiring; do not
revisit Decisions 1–3, all confirmed in §7.

## 9. Next slice

**The fix list above, first — it is small and surgical, and the resize cycle would trip over
Finding 1 immediately.** It is not a full cycle's work; fold it into one cycle with its tests and
log it normally.

Then the table resize/creation slice STATUS.md has now deferred across four cycles, which is what
actually closes Phase 2's gate: a creation mutation populating `rows`/`cols` and the cell family
(§5.10); row/column insert/delete; §5.4's reference-adjustment pass over every stored AST in the
document; deletion taking the §5.1.1 REPAIR path with `#REF` rewriting, not rejection; and the
`force` flag Phase 2's criterion names but no `Operation` yet carries.

Two standing constraints for that cycle: **a bare `setSlot` on `rows`/`cols` is not an adequate
resize primitive** (entry 0042 Decision 3 + D-046 — the KIND is settled, COHERENCE is not), and
whatever creation does about empty cells, **D-047 now guarantees aggregates behave the same either
way** — so that choice is no longer load-bearing for the formula engine, which is most of why it
was worth settling here.

## Verification (real output, after the reviewer's own edit)

```
$ npm run typecheck
> tsc --noEmit && tsc --noEmit -p tsconfig.engine.json
(clean, no output)

$ npm test -- --run
 Test Files  15 passed (15)
      Tests  536 passed (536)
```

536/536, unchanged — my only edit was a comment. 0 skipped, 0 `.only`, no `MUTATION-TEST` residue,
all verified by grep. The tree is green; it is the SEMANTICS that need the fix list, not the build.
