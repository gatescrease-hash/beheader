# 0065 — AUDIT (file headers against §5.2)
Date: 2026-08-25   Phase: 3   Model: Claude Opus 5 (reviewer)
Previous entry: 0064-REVIEW-phase3   Last review: 0064-REVIEW-phase3 (verdict: ACCEPT WITH EDITS)
Scope: comment-only. No logic, no signatures, no tests changed. 753/753 before and after.

Requested by the human off 0064-REVIEW §7's recommendation. A **light** pass: measure every header
against §5.2, classify what the over-budget lines are actually doing, condense where the excess is
retellable story, and report the rest honestly rather than churning twelve files.

## What §5.2 actually asks

The budget is "20-40 lines for an ordinary file, up to ~80 for a load-bearing one," and — this is
the part that decides the whole audit — **"Over budget is a signal to check what the extra lines are
doing," followed by "Keep, always, regardless of budget: hazard notes, rejected alternatives and why
they were rejected, invariants, and `PROVISIONAL(Q-NNN)` tags. Those are the expensive knowledge.
Sequencing is not."**

So the audit question is never "is this over 40." It is "is the excess *knowledge* or *story*."

## Measurement (all 40 source files)

Test files are uniformly fine — 4 to 16 lines, none over budget, none touched. Every over-budget
header was a non-test file. Fourteen were over at the start of this pass.

## The three things the excess was doing

**1. A catalogue of the file's own functions.** The single largest category. `geometry.ts` spent 17
lines listing each exported function and what it computes; `renderer.ts` spent 14 on per-type
drawing; `eval.ts` spent 12 walking its own `switch` arm by arm. Every one of those lines exists
again, better, in the doc comment directly above the code it describes. This is the clearest cut in
the audit: a header states what the file is FOR, and §5.3 already owns what each function does.

**2. Rulings restated instead of cited.** §5.2 says a `(D-047)` is a cheap, stable pointer and "do
not retell the story around them." `eval.ts`'s IMPLEMENTS block restated the content of D-028,
D-029, D-033 and D-034 in full — 15 lines to say what `Upholds D-028, D-029, D-033, D-034.` says in
one, given that DECISIONS.md is where those rulings live and is read every cycle.

**3. Process metadata, which goes stale by construction.** Eight headers carried
`Load-bearing per Rule 3 (§6 trigger-2 file)`. Two separate problems. Trigger 2 is "the first file
of a new subsystem" — a one-time review-scheduling event that fired and expired for every one of
these files long ago, so it now tells a reader something untrue about the present. And §6.2 is what
makes them load-bearing, attributing it to "Rules 2, 3, 6" collectively, not to Rule 3 alone —
`graph/edge.ts` is not load-bearing *per Rule 3*, it is load-bearing per §6.2. Corrected to
`Load-bearing (§6.2).` in all eight. This is D-065's preventive half exactly: prefer a sentence that
cannot expire.

## Two things found that are not about line count, and matter more

### Finding 1 — `geometry.ts` denied D-064, the invariant it owns

`computePolygonVertices`'s doc comment said the winding direction was **"this file's own disclosed
convention: §5.5 does not specify either, and nothing downstream reads winding yet,"** and
`computeRectVertices` said this file is **"agnostic to which one the renderer uses."**

Both were true when written and are now false. D-064 (0060-REVIEW) ruled the counterclockwise
winding a **stated invariant** that the renderer's fill rule, `explode`, and any point-in-polygon
hit test inherit, and that a cycle may not change silently. 0064-REVIEW added four tests pinning it.
Meanwhile the file header — the place a reader opens to learn the contract — did not mention D-064
at all, while spending 17 lines cataloguing functions.

The danger is not that the comment is dated. It is that it actively invites the exact refactor D-064
forbids: a model reading "nothing downstream reads winding yet" concludes reversing the corner order
is free, and four tests in another file are all that stand between that and a silently mirrored
renderer. Fixed in all three places: the invariant is now the first entry in the header's INVARIANTS
block, and both function docs state that the winding is binding and name what depends on it.

This is the same class as D-065 (a comment falsified by work done elsewhere) arriving through a new
door: falsified not by a new FILE but by a new RULING. Not proposed as its own decision — D-065's
"a cycle owns every comment its own work makes false" already covers a ruling as much as a file, and
one more D-number for the same idea would be worse than citing the existing one.

### Finding 2 — the header/function inversion in `eval.ts`

`evaluateFunctionCall`'s own doc comment read: *"See the file header's WHAT THIS IS for the exact,
ordered rationale; this function's structure IS that order."* The function pointed UP; the header
held 20 lines describing the function's four-step contract. That is backwards, and it is a large
part of why the header was 105 lines. The ordered contract now sits on `evaluateFunctionCall`,
where the order it describes is the code immediately below it, and the header keeps a one-sentence
pointer down. Net knowledge: unchanged. Header: 37 lines shorter.

`grep "see the file header"` finds ~20 more such pointers across `document.ts`, `ast.ts`, `deps.ts`,
`functions.ts` and `eval.ts`. Not all are wrong — "see the file header's INVARIANTS" is a legitimate
cheap pointer, the same shape as citing a D-number. The bad ones are specifically where a function
defers its OWN contract upward. Those are listed as owed work below rather than fixed blind.

### Also fixed: one D-060 violation in non-test source

`evaluateNot`'s doc ended with *"(Corrected at 0037-REVIEW-phase1: this comment previously claimed
both forms route through here.)"* — a pure diary sentence, D-060's "Bad" tier, in non-test source.
STATUS.md has been claiming non-test source is D-060-clean; that claim was wrong. Replaced with the
present-tense reason the two forms agree and why neither may grow its own negation logic.

A sweep of the same class across all non-test source found this to be the only clear violation. The
other ~30 grep hits are false positives — "before this is ever called" is a precondition in the
present tense, "no longer resolves" describes a current condition. Reported so the next sweep does
not re-walk them.

## Files condensed

| file | header before | after | what came out |
|---|---|---|---|
| `formula/eval.ts` | 105 | 68 | function catalogue; 4-step contract moved onto its function; rulings cited not restated |
| `primitives/geometry.ts` | 104 | 74 | function catalogue; process metadata. **D-064 invariant added** |
| `render/renderer.ts` | 104 | 74 | per-type drawing catalogue; process metadata; NOT-DONE verbosity |
| `render/hittest.ts` | 91 | 62 | per-type dispatch block restating three function docs |

404 header lines to 278. Every hazard, rejected alternative, invariant and deferral-with-an-owner in
those four files survives — several are now *more* prominent, having stopped competing with a
catalogue. `renderer.ts`'s PROVISIONAL(Q-012) tags are untouched and still on the constants they
tag.

## The honest result: the budget is not reachable, and that is the real finding

All four condensed files are still over 40. Not because I stopped early — because what remains is
almost entirely §5.2's own keep-always list. `hittest.ts` at 62 is: layer rationale (a rejected
alternative — why it is not in `engine/`), the §5.5 verbatim clause, the Q-012 non-dependency, four
invariants including two hazards (D-062's zoom gap, D-066's degenerate extent), and three deferrals
with named owners. There is no line in it I can delete without deleting knowledge.

**So the 20-40 budget appears unreachable for this codebase's non-test files, and the escape clause
swallows the rule.** These files carry an unusual density of ruled invariants — 67 decisions and
counting, most of which bind a specific file — and §5.2 says to keep every one of them regardless of
budget. A file with eight binding invariants cannot have a 30-line header and also state them.

I am not amending PROCESS_BRIEF; §8 reserves that for the human. Three options as I see them:

1. **Raise the ordinary-file budget to ~60-70 and keep the keep-always clause.** Matches where
   careful condensation actually lands. Simplest, and makes the budget mean something again.
2. **Keep 20-40 and move invariants out of headers** into a per-subsystem `INVARIANTS.md`. Cheaper
   headers, but it breaks §5's stated goal — "a reader who opens any one file understands what it is
   for" — by making the expensive knowledge a second file away. I do not recommend it.
3. **Leave the budget as an explicit soft signal** and delete the numbers, keeping only "check what
   the extra lines are doing." Honest about how it is actually used, but gives a future audit no
   threshold to measure against.

I would take (1). It is the only one where the number stays checkable AND the knowledge stays in the
file.

## Not done in this pass, and why

Ten headers remain over budget. `mutation.ts` (151, budget 80) is the largest and I deliberately did
not touch it: condensing it responsibly means holding 1,888 lines of the most load-bearing file in
the project in context, which is not a light pass and is not something to do in the same cycle as
eleven other files. `parser.ts` (97), `table.ts` (101), `document.ts` (94), `schema.ts` (83),
`functions.ts` (81), `lexer.ts` (75), `deps.ts` (68), `ast.ts` (60) and `camera.ts` (41) are
unexamined beyond measurement — I did not read them closely enough this pass to say which of their
lines are catalogue and which are knowledge, and guessing would be exactly the "polished cycle that
misreports itself" the process brief warns about.

The three anti-patterns above are the search terms for whoever picks this up: a function catalogue,
a restated ruling, and a function that defers its own contract upward.

## Verification (real output)

```
$ npx tsc --noEmit
(exit 0, no output)
$ npx tsc --noEmit -p tsconfig.engine.json
(exit 0, no output)
$ npx vitest run
 Test Files  19 passed (19)
      Tests  753 passed (753)
```

753/753 both before and after — this pass changed no executable line. 12 files touched, all
comment-only: 4 headers condensed, 8 single-line process-metadata corrections.

Line-ending note: `eval.ts`, `geometry.ts`, `hittest.ts` and `renderer.ts` are now LF in the working
tree where some were CRLF. `core.autocrlf=true` means git stores LF regardless, so the committed
content is unaffected — the same harmless working-tree-only condition STATUS has carried since
0062-REVIEW. The eight single-line edits preserved their files' existing endings deliberately, to
keep those diffs to one line each.

## Where I got stuck / what is unfinished

Nothing got stuck. What is unfinished is stated above and is most of the codebase by header count —
ten files, ~830 header lines, unexamined. This pass covered four files and one mechanical sweep, and
its most valuable output is probably not the 126 lines removed but Finding 1, which was a live
invitation to break a ruled invariant sitting in the file that owns it.

## Open questions raised

None. The budget question above is a PROCESS_BRIEF amendment for the human, not a `Q-NNN` — Q-NNN is
for ambiguity in `PROJECT_BRIEF`, and this is a procedure document the human owns outright.

## Review point

This entry IS reviewer work, so it needs no review gate of its own. No §6.1 trigger fired: no logic
changed, no test changed, no dependency or config added, no phase criterion claimed. Phase 3 remains
open with `render/interaction.ts` as the next implementer slice, exactly as 0064-REVIEW left it.

## Postscript — the same problem, one document over

`STATUS.md` is 153 lines against §2's "Keep < 150." I trimmed it from 170 across four passes and
stopped there rather than cut real content to buy three lines — which is the identical trade this
entry has just spent 2,000 words describing for source headers. Recording it rather than quietly
sitting on it: the pattern is not specific to headers, and whichever way the human rules on the
budget question above should probably cover this cap too.
