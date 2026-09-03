# 0163 — the Phase 5 gate: one document, through `mutate`, with a real measurer
Date: 2026-09-03   Phase: 5   Model: Sonnet 5 (implementer)
Previous entry: 0162-REVIEW-phase5   Last review: 0162-REVIEW-phase5 (verdict: ACCEPT WITH EDITS)
Batch: cycle 1 of up to 3 since last review; 112 lines / 1 file changed so far.

## Declared scope

Write the Phase 5 gate as an executable test: PROJECT_BRIEF §6's criterion, verbatim, over one
document, through `mutate`, with a real (non-null) `TextMeasurer`. Not doing: any production code
change — `resolvedContent`, `measuredHeight`/`measuredWidth`, the dependency walker, and the
markdown/wrap pipeline are all already built and reviewed (0121 through 0162); this cycle only
proves they compose the way §6 demands. Not doing: touching anything on §6.2's load-bearing list.

## Explicitly not in scope

- No engine or render-layer source change. `git diff --stat` below shows one file:
  `src/main.test.ts`.
- Phase 6/7 — not started, not implied by anything here.
- The "re-renders" clause's PIXEL half (an actual repaint). `main.ts`'s `start` is untested by
  construction (D-001); see "Decisions I made" for what stands in for it here.

## What I did

Added one `describe` block to `src/main.test.ts` — six tests sharing one `gateDocument()` builder,
mirroring 0116-REVIEW's Phase 4 gate shape (one document, several angles, not four fixtures):

- **`gateDocument()`** — a `table` (`rows=1 cols=3`), `table_1.A1`/`B1`/`C1` populated BEFORE the
  `text` object is created (so every edge exists from the creating mutation on, D-110 clause 4),
  then one `text` object whose content is PROJECT_BRIEF §6's own string, extended (see below).
  Every step is typed through `submitLine` with a REAL `EvalContext` — `createCanvas2dTextMeasurer`
  (`render/measure.ts`, the production implementation) wired to a fake `MeasurementContext` whose
  `measureText` reports a fixed 10px/character, the same fake shape `render/measure.test.ts` uses.
  Not a hand-rolled height stub: "wraps at its set width" is proved against the real word-wrap
  algorithm (D-120) or it proves nothing.
- **Test 1** — `resolvedContent` resolves the number and the taken FALSE branch inside the
  creating mutation (D-114).
- **Test 2** — the criterion's own wording: raising `table_1.A1` past 50 updates both the number
  and the branch.
- **Test 3** — `refs table_1.B1` (a reference that sits ONLY in the untaken TRUE branch) names
  `text_1.resolvedContent` as a dependent while that branch is inactive — the end-to-end,
  render-independent proof that §5.3's eager/total extraction reaches the block-tree walker
  (already unit-tested in `text.test.ts`; this is the same claim through the command line).
- **Test 4** — changing `table_1.B1` while its branch is untaken leaves `resolvedContent`
  unaffected (correct — that branch is not active), and the value is NOT stale once `table_1.A1`
  later takes that branch: the box shows the FRESH `777`, not the `999` present at creation.
- **Test 5** — "wraps at its set width": with `table_1.A1` raised and `text_1.width` set to `100`,
  `measuredHeight` is exactly `60` — three lines (`"Radius: 80"` / `"— LARGE"` / `"(max 999)"`) at
  the default `lineHeight` of `20`, computed by the real greedy word-wrap (`wrapLine`,
  `render/measure.ts`) against the fake's 10px/character, and confirmed by running the test rather
  than trusted by hand-derivation alone (PROCESS_BRIEF §3 step 5).
- **Test 6** — the whole document never once logs `"cyclic"`.

## Decisions I made

1. **Extended the criterion's content string.** §6's own text — `` Radius: {= table_x.A1 }{?
   table_x.A1 > 50 } — **LARGE**{:} — small{?} `` — has no reference inside EITHER branch, so it
   cannot exercise its own closing clause ("re-renders when a value referenced only inside the
   currently non-taken branch changes") as written. I added one embedded reference per branch —
   `` (max {= table_1.B1 }) `` in the TRUE branch, `` (min {= table_1.C1 }) `` in the FALSE branch —
   keeping the brief's exact numbers, condition, and `**LARGE**` markup untouched otherwise. This
   is a test-fixture choice, not an engine behavior deviation, so I did not raise it as an
   `OPEN_QUESTIONS.md` item — but flagging it for the reviewer below, since it does mean the test
   is not literally the brief's string character-for-character.
2. **`refs` as the observable stand-in for "re-renders."** A derived slot's dependency edge is
   what makes `mutate`'s topological pass re-evaluate it on the source's next change — that
   mechanism, not a pixel repaint, is what Phase 5's clause is actually asking to be proven, and
   `main.ts`'s `start` (which owns the real repaint) is untested by construction (D-001,
   PROCESS_BRIEF §4: no test dependency for a DOM). `refs table_1.B1` names `text_1.resolvedContent`
   as a dependent while B1's branch is inactive, which is the edge existing — end to end, through
   the command line, not by calling `extractTextDependencies` directly the way `text.test.ts`
   already does at the unit level.
3. **Test 4 exists as a disclosed belt-and-suspenders check, not the clause's real proof.** Its own
   comment says so: because `table_1.A1` changing ALSO changes `text_1.resolvedContent` regardless
   of whether `table_1.B1`'s edge existed (evaluation re-walks the whole block tree fresh every
   time), this test would pass even under a broken (lazy/branch-aware) extractor. Test 3 is the
   test that actually distinguishes eager-total from lazy extraction; Test 4 only guards against a
   staleness regression once the branch is taken.
4. **`CHAR = 10` and `wrapWidth = 100`** were chosen, then the exact line count was CONFIRMED by
   running the test (not asserted from hand arithmetic alone) — three lines was my hand-derivation
   too, but PROCESS_BRIEF §3 step 5 wants the real run, and the numbers below are that run's output.

## Verification (real output)

```
$ npx tsc --noEmit
(clean, exit 0)
$ npx tsc --noEmit -p tsconfig.engine.json
(clean, exit 0)
$ npx vitest run
 Test Files  34 passed (34)
      Tests  1781 passed (1781)
$ grep -rnE "\.(only|skip|todo)\(" src
(no matches)
$ npx vite build
✓ 39 modules transformed. built in 333ms
$ git diff --stat
 src/main.test.ts | 112 +++++++++++++++++++++++++++++++++++++++++++++++++++++++
 1 file changed, 112 insertions(+)
```

1775 → 1781 (six new tests), 34 files unchanged, 0 skipped, 0 `.only`.

## Acceptance criteria status

**Phase 5 criterion**, §6 verbatim: "a text box reading `Radius: {= table_x.A1 }{? table_x.A1 > 50
} — **LARGE**{:} — small{?}` updates both its number and its branch as the cell changes, wraps at
its set width, and re-renders when a value referenced only inside the currently non-taken branch
changes." — **PASSING**. Demonstrated by `src/main.test.ts`'s `describe("PHASE 5'S ACCEPTANCE
CRITERION — one text box, through mutate, with a REAL measurer", ...)`, all six `it`s, run above.
See "Decisions I made" item 1 for the one honest gap: the content string is the brief's own
extended by two embedded references, not character-for-character identical to it.

## Where I got stuck / what is unfinished

Nothing engine-side. The one genuine soft spot is item 1 above: I could not make the brief's
LITERAL string exercise its own last clause, because that string has no reference in either
branch. I chose to extend rather than to write a second, separate test with different content,
because STATUS.md's own next-slice note says "not four tests over four fixtures" and a second
fixture is the shape that note is warning against. If the reviewer would rather see the untouched
literal string in one test and the untaken-branch proof in a visibly separate one, that is a small
edit, not a re-approach.

## Open questions raised

None. Item 1 above is a disclosed implementation-level test-fixture choice, not load-bearing
ambiguity in the brief's engine-facing behavior (PROCESS_BRIEF §7's threshold).

## Review point

Fired: **§6.1 trigger 1 — a phase acceptance criterion is claimed complete.** No batch absorbs a
phase gate; this stops here regardless of the 1/3 cycles, 112/800 lines running total.
