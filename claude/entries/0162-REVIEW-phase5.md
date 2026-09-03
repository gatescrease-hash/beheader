# 0162 — REVIEW (phase 5): entries 0159–0161, markdown-lite parsed, wired and hung

Date: 2026-09-03   Phase: 5   Model: Sonnet 5 (reviewer)
Previous entry: 0161-hanging-indent   Last review: 0157-REVIEW-phase5 (verdict: ACCEPT WITH EDITS)
Reviewed: the diff `3ace76c..c0e05ec` — **1,312 added / 235 removed across 8 source files**, three
cycles (0159, 0160, 0161; 0159+0160 share one commit) plus their headers.

## Verdict: **ACCEPT WITH EDITS**

The code is right, the tests are real, and the header discipline D-137 demanded actually held this
time. The one edit owed — Q-025's `D-NNN` — is made: **D-139**. Everything else below is
confirmation, not correction.

## 1. Honesty audit — re-run, not read

```
$ npx tsc --noEmit && npx tsc --noEmit -p tsconfig.engine.json     (clean, exit 0)
$ npx vitest run                                                    Test Files 34 passed (34)
                                                                          Tests 1775 passed (1775)
$ grep -rnE "\.(only|skip|todo)\(" src                              (no matches)
$ grep -rn "PROVISIONAL(Q-025)" src                                 (no matches)
$ git diff --shortstat 3ace76c..HEAD -- src/                        8 files, 1312(+), 235(-)
```

**1775/1775 is real**, 34 files, 0 skipped, 0 `.only` — exactly what 0161 claimed, and matches
`STATUS.md`'s header. Q-025's reconciliation claim checks out by grep, not by trust.

**One count is wrong, and it is the only discrepancy found.** 0161 claims `renderer.test.ts` went
"94 → 95". The actual history (checked against the commit boundary, since 0159+0160 share one
commit): 89 (baseline) → 93 (after 0159+0160, not 94) → 94 (after 0161, not 95) — one test short of
the entry's own count at both ends, self-cancelling. The file itself is exactly right (94 tests, all
named and all real); the entry's arithmetic is off by one. Harmless — no test is missing, weakened, or
misdescribed — and not worth a `D-NNN`, but D-137 clause 4's "a count is a claim, and a claim gets
checked" applies to a log entry's own numbers as much as to a header's, so it is recorded rather than
waved through. Not an edit: entries are append-only (§2); this paragraph is the correction.

Every other claimed number checks out against the actual file history: `markdown.test.ts` 0 → 30 →
38 (0159, then 0160 — matches exactly), `measure.test.ts` 29 → 44 → 51 (0160, then 0161 — matches
exactly). Spot-checked three of the more load-bearing claims by reading the code, not the entry: the
flanking-rule fix (0160's Decision 4) is real and the test it claims to have caught it
(`"2 * 3 and **bold"`) does fail without `opensEmphasis`'s non-space check; the hanging-indent's
"folded into `run.x`, not a new `LaidOutLine` field" claim (0161) is exactly how `layOutText` does
it; `renderer.ts`'s `alignmentOffset` replacing `ctx.textAlign` is exactly the arithmetic the entry
and the test both describe.

No silent scope expansion. Each entry's "What I did" matches its diff file for file. **No engine file
changed** — confirmed by `git diff --stat 3ace76c..HEAD -- src/engine/` returning nothing — so §6.2's
load-bearing list was never at risk this batch.

Vocabulary is locked: `MarkdownRun` never "span" (0159's Decision 4 is correct that "span" is already
D-115/D-116's word), `Piece`/`chunk`/`run`/`line` used consistently and distinctly across
`markdown.ts` and `measure.ts`.

## 2. Rule audit

- **Rule 1 (`engine/` is pure)** — UPHELD, and untouched: zero engine files in the diff. The
  markup-aware measurer becoming §5.6-aware happened entirely inside `render/measure.ts`, which is
  the whole point of Rule 1's seam (D-120's framing, followed to its end per 0160's Decision 1).
- **Rule 2 (all state change through `mutation.ts`)** — not touched; no new write path.
- **Rule 3 (addressing)** — not touched.
- **Rule 4 (one formula engine)** — not touched.
- **Rule 5 (dumbest correct)** — UPHELD. The heading scale and the flanking rule are each a named,
  specified CSS/CommonMark rule adopted wholesale rather than tuned (D-138 clause 4's exact
  permission, correctly exercised twice and named at both sites). The hanging indent is a measured
  width, not a constant (0161's Decision 1) — the one number in this batch that could have been a
  tuned guess and was not. `measure.ts`'s O(line²) measure-call shape is unchanged and still
  disclosed.
- **Rule 6 (slot set fixed during evaluation)** — not touched; no schema change.
- **Rule 7 (nothing from §8)** — UPHELD; nothing from the deferred list was opened.

## 3. Invariant audit

Nothing engine-side to check (no engine file touched). The render-layer invariant this batch actually
lives or dies by — **a line can never be measured wider than it draws** — holds by construction:
`mergeRuns` returns `{ runs, width }` from the SAME summed measurements, `layOutText` folds the
hanging indent into both the runs' `x` and the line's `width` before either measurer or renderer sees
it, and `renderer.ts`'s `drawText` positions every run at `lineLeft + run.x` with no second
computation. I traced this by hand rather than trusting the header's claim: for a wrapped list item,
`measuredWidth` (via `createCanvas2dTextMeasurer` → `layOutText`) and the pixels `drawText` actually
places (`layOutText` again, same function) are provably the same number, because they are the same
call. There is no second implementation to drift.

**Two design calls I want to record as correct**, because a future cycle will be tempted to simplify
them:

- **The hanging indent is computed at `wrapLine`'s fitting stage, not applied at draw time.** 0161's
  own "Where I got stuck" names the alternative (indent at draw time) and why it is wrong — it would
  push a continuation's last word out through the box, the exact defect `overflow-wrap: break-word`
  exists to prevent. `wrapLine`'s test for this (`"wraps the continuation at the NARROWER width"`)
  is a regression guard for exactly that mistake.
- **The wrap residual (D-138) was not touched, even though `wrapLine` was open for another reason
  twice in this batch** (0160 for the flanking rule, 0161 for the indent). No epsilon, no rounding
  step, no per-platform branch appeared. This is the third and fourth time D-138 predicted a cycle
  would be tempted and it was not.

## 4. Spec conformance

- **§5.6's markdown-lite list** — implemented exactly, and its exactness is tested directly:
  `markdown.test.ts`'s "§5.6's list is exact" group asserts a link, an image, a blockquote, a table
  row and an underscore-emphasis all draw verbatim. No feature crept in beyond the six named forms.
- **Heading levels 1–3, no more** — `#### x` reads as a paragraph, tested and correct.
- **No nested lists, no escaping** — both correctly read as "§5.6 doesn't say, so don't build it"
  rather than as gaps to fill. The `\*soft\*` test (0159) is honest documentation of the consequence,
  not a hidden feature.
- **The flanking rule is not in §5.6 at all** — it is CommonMark's, imported to fix a real bug 0159's
  own tests missed (an inert module's tests agree with its author, as 0160's "Where I got stuck"
  says). This is the correct kind of brief-silence resolution: §5.6 says what markers exist, not how
  an ambiguous one resolves, and D-138 clause 4 already sanctions borrowing a *specified* external
  rule over inventing one. I checked the rule itself against real CommonMark spec behaviour for the
  cases this project's tests do NOT cover (nested same-marker runs like `*a**b*`) and found the
  reduced implementation takes a defensible, if not fully CommonMark-faithful, reading — acceptable,
  because §5.6 asks for "markdown-lite," not full CommonMark, and no test claims the full spec.
- **Layout: "auto width + auto height means no wrapping"** — `layOutText` returns `[chunks.flat()]`
  unwrapped when `wrapWidth` is `undefined`, and the hanging indent is never computed into that case
  (`continuation` stays `false` for a single unwrapped line). Correct and tested.
- **Q-025 / D-132's colour clause** — `editor.ts`'s header now states the narrowed scope precisely
  ("matches EXACTLY for text with no markup in it") rather than leaving the old, now-partially-false
  blanket claim standing. This is D-137 clause 4 applied correctly to a *qualitative* claim, not just
  a count.

## 5. Legibility audit — this is where the batch earns its verdict

D-137 was ruled four entries ago, against this exact class of failure, and this batch is the first
real test of whether it stuck. **It did.** I read all five touched headers (`measure.ts`,
`markdown.ts`, `renderer.ts`, `editor.ts`, `main.ts`) end to end against the current code, not just
the diff, specifically hunting for the D-137 failure mode (a header describing a design the same
cycle replaced):

- `renderer.ts`'s header no longer says markdown is drawn verbatim "the next cycle" — it says markup
  IS honoured and names who chooses the font (`measure.ts`, not this file). Correct and current.
- `editor.ts`'s header states the *narrowed* scope of the "drawn and typed text lay out the same"
  invariant rather than leaving the old absolute claim in place next to a `NOT DONE HERE` that
  contradicts it. This is precisely the class of edit D-137 was written to force and 0157-REVIEW had
  to make by hand; 0160 made it unprompted.
- `measure.ts`'s `NOT DONE HERE` correctly lists the fallback-divergence disclosure (moved, not
  dropped) and the D-138 prohibition, both inherited faithfully from the pre-batch header.
- No declaration was inserted between a doc comment and what it documents — I grepped every new
  function in `markdown.ts` and `measure.ts` for an orphaned comment above it and found none.
- **No unjustified `any`** anywhere in the diff (checked all five touched files; every `any`
  occurrence is the English word in prose, not a type).
- Tests are named as behaviour sentences throughout, and the naming is unusually pointed at the rule
  being defended: `"wraps the continuation at the NARROWER width, so the indent cannot push a word
  out of the box"` names the exact regression it guards against, not just what it asserts.

One thing I checked and did NOT find a problem with, because it was raised as a live risk: **0160's
Decision 2 admits `layOutLines`'s deletion counts under §6.1 trigger 5** ("test expectations
changed") rather than arguing it away, even though the ported tests are expectation-for-expectation
identical. That is the right call and the right instinct — a test file being edited is the trigger's
condition, not whether the assertions moved.

## 6. Spec/process questions the implementer put to the reviewer

1. **Q-025 needs a `D-NNN`.** Done — **D-139**, above. Option (a) is now binding, not provisional.
2. **Is CSS's heading scale (2em/1.5em/1.17em) the right adoption?** Confirmed on screen by the human
   at 0161 ("markdown-lite renders correctly... heading scaled and bold") — no further ruling needed.
   D-138 clause 4 already permits adopting a specified rule over tuning one, and this is that move,
   correctly named at its site (`measure.ts`'s `HEADING_FONT_SCALES` comment).
3. **Does `markdown.ts` being a new file trigger §6.1 point 2 (first file of a new subsystem)?**
   **No.** `render/` is an already-reviewed layer (reviewed as far back as 0058's `camera.ts`); a new
   *file* inside it is the same footing as `textbox.ts`/`handles.ts` landing at 0153, which correctly
   batched without stopping. Point 2 is about a subsystem's *design choices* being expensive to get
   wrong on the first file — `markdown.ts` had no such choice to make that `render/`'s existing
   conventions (pure function, no DOM, one `MarkdownLine`/`MarkdownRun` shape) didn't already settle.
   0159 read this correctly; the question was worth asking anyway, and this makes the reading
   explicit for the next implementer who hits the same shape of question.
4. **(0161) Does a centred list item's continuation being centred *including* its indent want a
   rule?** No — it is correctly beneath notice. It is consistent (the indent lives inside the line's
   own width, the one number both files agree on) and no operator has asked for centred lists to
   behave any particular way. `STATUS.md`'s Known Problems entry for it stays as a disclosure, not a
   fix-list item.

## 7. What I did NOT do, deliberately

- **I did not touch the wrap residual (D-138).** `wrapLine` was open twice this batch for unrelated
  reasons and nothing compensating appeared in either. Correctly left alone.
- **I did not open the fallback-divergence question** between `measure.ts` and `renderer.ts` for a
  broken `style.*` slot (0139-REVIEW's still-open item). Untouched by this batch, not this review's
  to solve unprompted.
- **I did not re-litigate the name-label/table-header size "keep as is."** The human closed it in the
  same sentence they raised it; `STATUS.md` already records it as a decided non-change and that is
  sufficient — it needs no `D-NNN`, because it was never in dispute.
- **I did not touch `primitives/text.ts`'s header** or any other engine file — none was opened by
  this batch, so D-137 does not reach them.

## 8. For the human — still owed

**Entry 0161's hanging indent has not been seen on screen.** Everything else in this batch (0159's
parser, 0160's rendering, alignment, headings, the bullet) was confirmed by the human at 0161 and
needs no repeat. One wrapped list item in a box with a set width is the whole check: the second line
should start under the item's *text*, level with where "milk" starts, not under its bullet.

## Next slice

**The Phase 5 gate**, unclaimed and unchanged from what 0160/0161 already stated: one executable test
over one document, through `mutate`, proving the criterion in §6 verbatim. `REVIEW: REQUIRED` when it
lands — no batch absorbs a phase gate (§6.1 trigger 1). Nothing in this review blocks it from
starting now.
