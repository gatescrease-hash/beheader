# 0119 — REVIEW (pre-Phase-5 batch): entries 0117 and 0118. D-109 clause 3 and D-110 both land
Date: 2026-09-01   Phase: 5 (pre-Phase-5 slices)   Model: reviewer
Reviews: entries **0117** and **0118** — the whole code diff since 0116-REVIEW: 7 source files,
+359 / −26.
Previous review: 0116-REVIEW-phase4-gate
Verdict: **ACCEPT WITH EDITS.** Three edits, all explained below; two are tests, one is a comment.
**D-110 and D-109 clause 3 are both cleared. §6.2's block on Phase 5 is LIFTED — Phase 5 may begin.**
Two rulings: **D-112** and **D-113**. Both of entry 0118's questions for the reviewer are answered
in §7.

## 1. What I actually ran, before reading anything as true

```
$ npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.engine.json
(clean, no output — both configs)

$ npx vitest run
 Test Files  27 passed (27)
      Tests  1285 passed (1285)          # at HEAD, before my edits
```

`grep -rnE "\.(only|skip|todo)\("` over `src/` → nothing. Zero skipped, zero `.only`, as claimed.

**Both cycles' stated diff numbers survive checking, exactly** — measured with `git show --numstat`
against the source half of each commit:

| Cycle | Claimed | Measured |
| --- | --- | --- |
| 0117 | 2 files, 82 insertions / 14 deletions | 2 files, 82 / 14 |
| 0118 | 5 files, 277 insertions / 12 deletions | 5 files, 277 / 12 |

That is a direct improvement on 0116-REVIEW §7, which had to record that entry 0115's own diff
total did not survive measurement. One small slip survives: the batch total is **7** source files
(0117's two plus 0118's five), not the **6** that entry 0118's `Batch:` line and `STATUS.md` both
state. Nothing follows from it — the cap is 10 — and the line count (~359) is right.

## 2. Rule audit

- **Rule 1 (engine purity)** — upheld, mechanically. `grep -rnE "document\.|window\.|canvas|
  CanvasRenderingContext2D|from \"\.\./render"` over `src/engine/` returns only header text and
  `document.<field>` accesses on the engine's own `Document` parameter. The new
  `primitives/table.ts` → `graph/node.ts` import (`TABLE_TYPE`) is engine-internal and the file
  already imported from that module.
- **Rule 2 (all state change through `mutation.ts`)** — upheld. Nothing in the diff assigns document
  state; `graph/eval.ts`'s change is inside the `read` closure, which returns a value and writes
  nothing, and `main.ts`'s change writes `input.value`, which is DOM furniture and never
  `state.document`.
- **Rule 5 (dumbest correct implementation)** — upheld, and worth one line because the temptation
  was real: `isInExtentTableCellAddress` does a linear `objects.find` and a fresh
  `getTableDimensions` on **every** read miss, with no memo. That is the specified choice, not an
  oversight.
- **Rule 6 (slot set fixed during evaluation)** — upheld, and this is the one that was actually at
  stake. The `read` closure substitutes a **value**; it never adds a slot, and the extent it
  consults is `getTableDimensions`' `literal`-only read (D-046), so no evaluated value sizes
  anything.
- **Rules 3, 4, 7** — not touched.

## 3. Invariant audit — the one that needed checking

**"Does this edge exist" and "what does this address read as" must not be able to disagree.** They
are asked in two files over two different pieces of state, and D-110 needed both answered the same
way for one case. I checked the thing that would make them diverge: `evaluateFormula`'s `objects`
is `evaluateGraph`'s own input list — the same staged, post-apply list `deriveEdges` was called
with — and evaluation accumulates its results in a separate map (`slotsFor`), never back into
`objects`. So both callers of `isInExtentTableCellAddress` see byte-identical stored `rows`/`cols`,
and the helper's own claim ("a bare reference and a range can never disagree about a table's
extent") holds structurally rather than by luck. Entry 0118's Decision 2 — keeping the "no slot"
and "holds null" checks split across the two files — is the right call for the same reason, and its
account of why one gets an edge and the other does not is accurate.

Rejection leaves prior state unchanged, derived slots inside the topological pass, eager/total
extraction, plain serializable state: not touched, and the D-110 clause 5 test re-asserts the first
of them.

## 4. Spec conformance — D-110 clause by clause, checked against behaviour, not the entry

I drove the real command layer in a throwaway file (deleted) rather than reading the tests:

| Clause | Probed | Result |
| --- | --- | --- |
| 1 (no slot → `0`) | `set table_1.A1 = table_1.B1` | committed, `A1 = 0` ✓ |
| 1, bare-ref spelling | `set table_1.A1 = B1` | committed, `A1 = 0` ✓ (§5.3's bare cell ref, the spelling an operator actually types — pinned nowhere, see §6) |
| 2 (`null` cell) | hand-built `null` literal cell | reads `0` ✓ |
| 3 (`= A2 + 1`, `SUM(A2, 1)`) | both | `1` ✓ |
| 4 (no edge) | `deriveEdges` asserted directly | no edge ✓ |
| 5 (cycle at the populating mutation) | `set A2 = A1` then `set A1 = A2` | `cyclic dependency: table_1.A1 → table_1.A2 → table_1.A1` ✓ |
| 6 (outside extent, unknown object) | `= table_1.B9`, `= polygon_1.A1` | both still refused ✓ |

**The narrowness holds.** `polygon_1.A1` is stopped by `cellAddressToCoordinates`' `cells.` prefix
requirement before the type check is ever consulted — which is the substance of the answer to entry
0118's first question (§7).

## 5. Honesty audit — the mutation checks do not reproduce as reported

This is the one finding that costs anything, and it is about the log, not the code.

Entry 0118 reports two independent mutation checks and, from them, the correct conclusion. I
re-ran both. **The conclusion is right. The counts and the membership are not.**

| Check | Entry 0118 claimed | I observed |
| --- | --- | --- |
| Neutralise `deriveEdges`'s guard | "6 of the 8 new D-110 tests went red; the two clause-6 'still refused' tests correctly stayed green" | **5 red, 3 green.** The unaccounted-for green one is **clause 2 (the `null` cell)** |
| Neutralise `graph/eval.ts`'s `0`-substitution | "the same 6 tests went red again" | **5 red, 3 green — and NOT the same 5.** Clause 2 goes red here and clause 4 stays green: the two sets differ by two members |

Both differences point the same way. The clause 2 test stays green under the first mutation
**because a cell holding `null` has a real edge** — the `deriveEdges` guard is not what makes clause
2 work — and goes red under the second because the `read` coercion is. That is exactly the
distinction entry 0118's own Decision 2 draws correctly in prose and in code. So the evidence is
**stronger** than the entry claims: two mutations with two different failure sets establish the two
lines are independent far better than "the same 6 tests, twice" would, which — had it been true —
would have been evidence that one of the two changes was redundant.

No edit to the code follows. The finding is that the project's main defence against a test passing
for the wrong reason is only worth the accuracy of its "which went red and why", and here that
narration was written from expectation rather than from the output. **This is the second review
running to find a countable claim in a log entry that does not survive measurement** (0116-REVIEW
§7, entry 0115's diff total). Entry 0118 fixed the diff-total half and reintroduced the same class
one field over. Recorded as a gotcha, not a ruling — the remedy is to paste the runner's actual
tail, which entry 0117 did do for its own mutation check, and which I re-ran and confirmed exact.

Everything else in both logs matches the diff. Entry 0117's scope statement, its declaration that
it went beyond D-109's literal examples, and its refusal to build select-all-on-refusal are all
accurate. Entry 0118's "Explicitly not in scope" is accurate: `readRange` and the range loop are
byte-unchanged.

## 6. The three edits

**Edit 1 — `commands.test.ts`: D-110 clause 5 pinned AT THE COMMAND LINE.** Answering entry 0118's
second question with a test rather than an opinion (§7). +14 lines in the `set` block.
Mutation-checked: pointing the second `set` at a different empty in-extent cell (`table_1.B3`)
makes it **commit**, so the refusal the test asserts is genuinely the cycle and not some other
refusal wearing the same message — the check 0116-REVIEW §1 called the one most people skip.

**Edit 2 — `commands.test.ts`: the two `refs` forms, pinned together with the `delete` they must
agree with.** This is finding F10 below, and the reason it is a test rather than a note is that
the failure mode is a later cycle "fixing" the asymmetry. +18 lines in the `refs` block.
Mutation-checked: collapsing `afterRemoval` onto the current edge set turns it red with
`refs table_1` reporting `nothing references table_1` over a document whose `delete table_1` is
refused.

**Edit 3 — `primitives/table.ts`: seven comment lines on the `TABLE_TYPE` check**, recording that
it decides nothing today, why, and why it stays. The question was asked in the log; the answer
belongs where the next reader meets the code. No behaviour change.

**Verification after all three edits:** both tsc configs clean; `npx vitest run` → **27 files, 1287
passed**, 0 skipped, 0 `.only`. Diff added by this review: +41 / −0 across 2 source files.

## 7. Entry 0118's two questions for the reviewer — answered

> 1. Is `isInExtentTableCellAddress`'s `tableObject.type === TABLE_TYPE` check the right call, or
>    should it be dropped as unreachable dead weight until a second `cells.*`-shaped type exists?

**Keep it.** It is genuinely unreachable today, and for a reason worth knowing: a cell-shaped path
on a non-table (`polygon_1.A1`) never reaches the type check at all, because
`cellAddressToCoordinates` requires the `cells.` prefix and `table` is the only type whose schema
declares that family. So the check is not what makes today's narrowness true. It stays because the
function's contract — D-110 clause 1's own "a cell of an EXISTING table" — is what the two call
sites rely on, and a guard whose absence would silently *widen a ruling* is not dead weight; it is
the cheapest possible statement that D-110 is about tables. Compare `main.ts`'s `"cancelled"` arm,
kept on the same reasoning and labelled the same way. Edit 3 puts that reasoning in the file.

> 2. Does D-110 clause 5's pin actually demonstrate what D-111 clause 3 asked for, or does it want a
>    command-line-level version too?

**It satisfies D-111 clause 3 as written** — clause 3 names three `mutate`-level facts (accepted and
reads `0`; refused as cyclic naming both slots; prior state unchanged) and the last test in the new
`mutation.test.ts` block asserts all three, the last of them against a JSON snapshot taken before
the second call, which is the strongest form available where the "prior state" is an argument
rather than a held reference. **And yes, it wanted the command-line version too** — not because the
clause requires it, but because D-110 was ruled by a human at a command line after meeting the
refusal live, the whole path from typed line to refusal message was reachable and pinned nowhere,
and it cost fourteen lines in a file that already had the helpers. Built as Edit 1. The instinct
behind the question was right.

## 8. Findings

**F10 — D-110's disclosed consequence is stated more broadly than it is true, in the entry, in
`STATUS.md`, and in D-110's own text.** All three say, unqualified, that `refs` does not report a
formula reading a still-empty in-extent cell. That is true of `refs <cell>` and **false of
`refs <object>`**, which derives its blocking half over the document *without* the target: with the
table gone from that list the reference is no longer in any extent, the edge reappears, and the
report correctly matches the `delete table_1` that is in fact refused. Verified both ways, plus the
refusal. This is the design working — §5.1.1's "see what points at something before deleting it"
survives D-110 untouched, by a mechanism `refs`'s own header has documented since 0082-REVIEW for
the D-047 range case — but the log records it as a flat loss, and a reader who trusts the flat
version will either believe `delete` is now unguarded or "fix" the asymmetry. **Ruled D-112**;
pinned by Edit 2; `STATUS.md` corrected below. Entry 0118's "`command/commands.ts` needed no
change" is true, but the reason it gives is not the load-bearing one.

**F11 — a new operator-visible behaviour, disclosed nowhere: shrinking a table's extent under a
formula that reads an empty in-extent cell is now REFUSED.** `link polygon_1.origin.x table_1.A4`
(A4 empty, in-extent) then `set table_1.rows 2` → `polygon_1.origin.x references a slot that does
not exist`. Correct per clause 6 — the cell leaves the extent, so it stops being "legal but
unpopulated" and becomes dangling — and arguably better than what a *populated* out-of-bounds cell
still gets (silently stranded, the standing known problem). It is not a regression: the state was
unreachable before D-110. It is simply new, reachable, and unrecorded. Added to `STATUS.md`'s known
problems; **no code change** — D-110's cost paragraph already took this trade in principle.

**F12 — the range/scalar divergence widened, also undisclosed.** With `B1`/`B2` empty and in-extent:
`MIN(B1, B2)` is now `0` while `MIN(B1:B2)` is `#TYPE (Infinity)`; `AVG(B1, B2)` is `0` while
`AVG(B1:B4)` is `#TYPE (NaN)`; `CONCAT("x", B1)` is now `#TYPE: argument 2 must be a string, got
number` where it used to be a dangling-reference refusal. Every one of these is **compliant** —
clause 3 is explicit that the scalar half moves and that no function gets a special case, and the
range half is pre-existing D-047 behaviour, unchanged and reviewed. But D-110's "not an
inconsistency though it looks like one" paragraph argues the *ranges vs references* distinction in
the abstract, and these are the concrete shapes an operator meets. Added to `STATUS.md`'s known
problems. **No code change and no re-litigation** — D-110's cost paragraph forbids reopening it on
the grounds that it is surprising, and that binds this review too.

## 9. Open questions

- **Q-017** (persistent A1-style table headers) — **deferred, still open, still recommended**, and
  one notch more so than at 0116-REVIEW: F12 means an operator now needs to know which cells are
  empty to predict what an aggregate returns, and headers are what make "which cell is that" cheap.
  Still display-only, still the human's call on timing.
- **Q-016** (may a panel row write a literal string/boolean) — **deferred, unchanged.** Nothing
  tagged; no operator can reach the site.
- **Q-012** (world units or screen pixels) — **deferred**, due with the `style`-slots cycle.
- **Q-008** (`-0` as document state) — **deferred**, blocking nothing.
- **Q-018** — ANSWERED → D-110, now **built and reviewed.** Closed.

No new `Q-NNN`. Next free is still **Q-019**.

## 10. The gate, and what comes next

**§6.2's block is lifted.** `mutation.ts`, `graph/eval.ts` and `primitives/table.ts` carried the
unreviewed load-bearing changes; they are reviewed here. **Phase 5 may begin.** 0116-REVIEW §10's
ordering argument — land D-110 before the text primitive so the text walker meets one settled
answer about what a reference means — is now satisfied rather than pending.

Recommended order, routing advice and not a ruling, unchanged from 0116-REVIEW minus what has
landed:

1. **D-109 clauses 1–2 (F7)** — cell decimals and clipping, `render/` only. Still the smallest thing
   on the board, and the human met it in the same ten minutes that produced D-110.
2. **Q-017's headers**, if the human wants the next hand session to be pleasant. F12 strengthens
   this.
3. **Phase 5** — the text primitive. When it lands, its dependency walker inherits D-110 whole: an
   embedded `{= table_x.A1 }` over an empty in-extent cell reads `0` and emits no edge, in both
   taken and untaken branches. Nothing about that is new work, but it is worth a test in that
   cycle, because it is the second consumer the ordering argument was about.

## 11. Edits made by this review

1. `src/command/commands.test.ts` — one test in the `set` block: D-110 clause 5 at the command line
   (§6, Edit 1). +14 lines.
2. `src/command/commands.test.ts` — one test in the `refs` block: both `refs` forms plus the refused
   `delete` they must agree with (§6, Edit 2; **D-112**). +18 lines.
3. `src/engine/primitives/table.ts` — a comment on the `TABLE_TYPE` check recording that it is
   unreachable today and why it stays (§6, Edit 3; §7's first answer). +7 lines, no behaviour.

No production behaviour was changed by this review. `DECISIONS.md` gains **D-112** and **D-113**;
`STATUS.md` is rewritten.
