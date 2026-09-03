# 0164 — REVIEW (Phase 5 gate): entry 0163. The gate is CLOSED
Date: 2026-09-03   Phase: 5 → 6   Model: reviewer (Sonnet 5)
Reviews: entry **0163** — the whole diff since 0162-REVIEW, one file: `src/main.test.ts`, +112 / −0.
Previous review: 0162-REVIEW-phase5
Verdict: **ACCEPT WITH EDITS.** No code edit — the "edit" is the D-016 mutation-check entry 0163
owed and did not include; I ran it myself, below, in full, and it confirms the claim. **Phase 5's
acceptance criterion is PASSED and its gate is CLOSED. Phase 6 may begin.**

## 1. What I actually ran, before reading anything as true

```
$ npx tsc --noEmit
(clean, exit 0)
$ npx tsc --noEmit -p tsconfig.engine.json
(clean, exit 0)
$ npx vitest run
 Test Files  34 passed (34)
      Tests  1781 passed (1781)
$ npx vite build
✓ 39 modules transformed, built in 337ms
$ grep -rnE "\.(only|skip|todo)\(" src
(no matches)
$ git diff 8036632 d81a78c --stat
 claude/STATUS.md                   | 100 ++++++++++++++++------------
 claude/entries/0163-phase5-gate.md | 131 +++++++++++++++++++++++++++++++++++++
 src/main.test.ts                   | 112 +++++++++++++++++++++++++++++++
 3 files changed, 301 insertions(+), 42 deletions(-)
```

Matches entry 0163's own numbers exactly (1775 → 1781, one file, 112 insertions, 0 deletions). No
production or engine file in the diff. Rules 1–7 are therefore not at stake in the ordinary way —
audited anyway, below.

## 2. The finding — D-016's mutation check is MISSING from entry 0163

**D-016, binding since 0018-REVIEW: "Before reporting any §6 criterion (or sub-clause) as PASSING,
neutralise the implementing line(s), re-run the suite, confirm a named test fails, and paste that
output beside the claim. If nothing fails, the criterion is NOT demonstrated, however much
surrounding test coverage exists."** Entry 0163's "Verification" section pastes `tsc`/`vitest`/
`vite build` output and nothing else — no neutralised line, no red run, no table. This is the exact
shape D-016 exists to catch: a green suite that *looks* like proof but was never shown to be capable
of failing.

The gap is sharper for being avoidable: entry 0163's own "What I did" says it mirrors "0116-REVIEW's
Phase 4 gate shape" — and 0116-REVIEW's subject, entry 0115, is the one that *performed* three
mutation checks with pasted before/after output (reproduced and confirmed independently at
0116-REVIEW §1). The shape was copied; the proof step inside it was not.

**I ran D-016's check myself, three times, one per distinct claim the criterion makes** (number/
branch update, untaken-branch dependency, wrap-driven height), each reverted before the next:

| # | Neutralised | File : line | Named tests that turned red | Reverted, suite green after |
|---|---|---|---|---|
| 1 | `extractTextDependencies`'s `trueBranch` recursion, in the `conditional` case | `src/engine/primitives/text.ts:541-543` | **4**: "updates both the number and the branch…", "a value referenced ONLY inside the currently non-taken branch…", "a value changed while its branch is untaken is not stale once…", "wraps at its set width…" | yes — `git diff --stat` empty, 1781/1781 |
| 2 | `wrapLine` call in `layOutText`, forced to `[chunks.flat()]` (no wrap) | `src/render/measure.ts:461` | **1**, exactly and only: "wraps at its set width — measuredHeight comes from the real word-wrap algorithm, not a fixed-size fake" | yes |
| 3 | Branch selection in `evaluateBlocks`'s `conditional` case, forced to always `block.falseBranch` | `src/engine/primitives/text.ts:691` | **2**: "updates both the number and the branch…", "a value changed while its branch is untaken is not stale once…" | yes |

Check 1 is the one that matters most and the one D-016 is really guarding: it shows §5.3's eager/
total extraction is load-bearing for this criterion, not incidental — with it broken, the D-013
read-membership check (a derived slot's compute may read only the addresses its own dependency
declaration returned) starts refusing the TRUE branch's read of `table_1.B1`, which is *why* the
value-computation tests fail too, not only the `refs`-based edge test. That is a stronger result
than entry 0163's own account anticipated (its "Decisions I made" item 3 predicted only Test 3 and
Test 4 would distinguish eager-total from lazy — Test 2 turned out to depend on it as well, through
D-013). Check 2 isolates the wrap claim cleanly: exactly the one test naming it, nothing else. Check
3 confirms the criterion's plainest clause — the branch actually switches — is pinned and not
vacuously true.

**Tree confirmed byte-identical to HEAD after all three reverts** (`git status --short` empty, both
`tsc` configs clean, 1781/1781 again). No production file carries any trace of this review.

**Disposition: ACCEPT WITH EDITS, not REVISE.** The missing step was procedural, not a coverage gap
— rerunning it myself produced exactly the red-then-green results D-016 asks the entry to show, so
the underlying claim is sound and re-routing this back to the implementer to reproduce a result
already reproduced here would cost a cycle for no new information. This is not a precedent for
skipping D-016 going forward — the next phase-gate entry that omits it gets **REVISE**, because
by then it will be a second, disclosed instance of the same gap rather than a first one.

## 3. Rule audit

- **Rule 1 (engine purity)** — not touched by the diff; `grep -n "document\.\|window\.\|canvas\|CanvasRenderingContext2D" src/engine` still returns only `document.<field>` accesses on the engine's own `Document` parameter. `src/main.test.ts` importing `createCanvas2dTextMeasurer` from `render/measure.ts` is a test file exercising the real measurer through the sanctioned injection point (`EvalContext.measurer`), not an engine import of `render/`.
- **Rule 2 (mutation-only state change)** — exercised, not merely upheld: every state change in `gateDocument()` and every `it` arrives through `submitLine`, never a hand-built `Document`. Right shape for a gate test, per the same reasoning 0116-REVIEW gave for the Phase 4 gate.
- **Rules 3, 4, 5, 6, 7** — not touched.

## 4. Invariant audit

- **Eager/total dependency extraction** — the criterion's central invariant, and the one check 1 above actually exercises end to end (not just at the unit level `text.test.ts` already covers).
- **Evaluation is lazy/short-circuit** — Test 6 ("no false cycle") and the branch-selection check (3, above) together confirm the untaken branch's own runtime error surface is never touched at evaluation time, only at dependency-extraction time — matching §5.3 exactly.
- **Derived slots evaluate inside the topological pass** — `resolvedContent` and `measuredHeight` both come from `getSlot` post-`submitLine`, never a second recompute call.
- Slot set fixed during evaluation, no dangling edges, plain serializable state — not touched by this diff.

## 5. Spec conformance — the criterion, clause by clause

§6 Phase 5, checked against the tests rather than the entry's summary:

- **"updates both its number and its branch as the cell changes"** — Test 2, directly. ✓
- **"wraps at its set width"** — Test 5, against the real `wrapLine` (D-120), confirmed by mutation check 2 to be a genuine dependency on that algorithm rather than a hand-derived constant. ✓
- **"re-renders when a value referenced only inside the currently non-taken branch changes"** — Tests 3+4 together, confirmed by mutation check 1 to depend on real eager/total extraction rather than passing vacuously (the "belt-and-suspenders" caveat entry 0163 itself raised about Test 4 is accurate — Test 3 plus check 1 is what actually proves this clause, and it does). ✓

**The content-string extension (entry 0163 "Decisions I made" item 1)** — accepted as a disclosed
test-fixture choice, not an engine deviation. The brief's own string has no reference in either `{?
}` branch and literally cannot exercise its own last clause; keeping the brief's exact numbers,
condition and `**LARGE**` markup while adding one embedded reference per branch is the smaller
change against STATUS.md's standing "one document, not four fixtures" guidance, and a separate test
asserting the untouched literal string would only re-confirm what `text.test.ts`'s existing
no-reference-content tests already cover. No edit requested here; STATUS.md correctly flagged this
for my judgment and I'm exercising it the way it was offered.

## 6. Legibility audit

Headers not touched (no source file added or edited). The new `describe` block: locked vocabulary
throughout (block tree, derived, dependency, address), every `it` name is a behaviour sentence citing
the clause or decision it defends, comments cite D-013/D-110/D-114/D-120 rather than restating them.
No `any` introduced. Nothing to flag.

## 7. Honesty audit

Log matches diff: one file, 112 insertions, six tests, real measurer wired as described, no
production code. `1775 → 1781` checks out. STATUS.md's rewrite is accurate and — unusually well —
front-loads exactly the judgment call (the content-string extension) I needed to make, rather than
burying it. **The one real gap is D-016's missing mutation check, covered in full at §2.** Nothing
else to report; a clean diff earns a short honesty section.

## 8. Open questions

None raised by 0163. Existing open items (Q-008, Q-012, Q-016, Q-017) are untouched by this diff and
unchanged from STATUS.md's own accounting — not re-litigated here.

## 9. The gate

**Phase 5's criterion — "a text box... updates both its number and its branch as the cell changes,
wraps at its set width, and re-renders when a value referenced only inside the currently non-taken
branch changes" — is PASSED**, demonstrated by entry 0163's six tests plus this review's three
mutation checks (§2), all reproducible from the table above. **The gate is CLOSED and Phase 6 is
OPEN** (§12.3): script stub + image, ports as ordinary slots, no script-specific code in `eval.ts`.

## 10. Edits made by this review

None to source or tests — the tree is byte-identical to `d81a78c`. `claude/STATUS.md` IS rewritten
by this review (0116-REVIEW's own precedent: the reviewer rewrites it when a gate closes, rather
than leaving a stale "REVIEW: REQUIRED" for the next cold reader) — top state block, "What the last
cycle did," "Next slice," "Built and reviewed," and the "Settled" ruling range (D-138 → D-139, a
pre-existing one-behind slip, corrected in passing). No new `DECISIONS.md` entry — D-016 already
says everything this review needed it to say; §2 above applies it, it doesn't extend it.
