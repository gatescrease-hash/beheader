# 0087 — the two formula depth limits
Date: 2026-08-26   Phase: 3   Model: Claude Opus 5 (implementer)
Previous entry: 0086-REVIEW-phase3   Last review: 0086-REVIEW-phase3 (verdict: ACCEPT WITH EDITS)
Batch: cycle 1 of up to 3 since last review; ~364 lines (326 added / 38 deleted) / 7 files changed
so far.

## Declared scope

Fix-list item 1: stop `executeCommand` throwing on a deep formula. A fixed depth limit, refusing
with `#PARSE` instead of unwinding a `RangeError`, plus the same guard on `format.ts`'s recursion
for the loaded-file path, the constants pinned by tests, and the four sites carrying the "ONE
MEASURED EXCEPTION" sentences corrected.

## Explicitly not in scope

`main.ts` (the next slice). Converting either recursion into an explicit loop — **D-079 clause 4**
says the limit is the fix and a rewrite is its own change. Fix-list items 2, 3, 4 and the six
carried items. `deps.ts` and `eval.ts` grew no guard of their own: the parse-time limit bounds
every AST that can be stored by typing, and the loaded-file path is §5.11's cycle (see "stuck").

## What I did

**The defect is not where the fix list said it was, and that is the whole shape of this cycle.**
Probed first (D-077 clause 2's habit, applied to locating rather than to sizing): a `RangeError`
out of a 20,000-term `1 + 1 + ...` unwinds from **`parser.ts`'s `walkForRangePlacement`**, the
post-parse walk, *not* from the recursive descent. It cannot come from the descent: `1 + 1 + ...`
is a **loop** in `parseLeftAssociativeExpr`, costing the descent no stack per term while building
one AST level per term. A depth limit on the descent alone — item 1 as written — would have left
the reported line throwing exactly as before.

So there are **two** recursions over user-authored size here, and two limits:

- **`src/engine/formula/ast.ts`** — new `MAX_FORMULA_AST_DEPTH = 1000`, the deepest a stored
  `FormulaAst` may nest, declared beside the shape it bounds so `parser.ts` and `format.ts` read
  ONE number (D-010's declare-vocabulary-once). Its doc states why it is a constant and names the
  observations as observations (D-079 clause 1).
- **`src/engine/formula/parser.ts`** — new exported `MAX_FORMULA_PARSE_DEPTH = 256`, bounding the
  recursive DESCENT, counted in *nesting steps*: `parseUnaryExpr` and `parsePrimaryExpr` each cost
  one, so a parenthesis level or a call-argument level costs two and a unary prefix costs one. Both
  tiers now delegate to `parseUnaryExprInner`/`parsePrimaryExprInner` through one `withNestingStep`
  wrapper, which raises the counter, refuses past the limit, and decrements on its ONE return path
  — no error arm can leave the counter raised. `walkForRangePlacement` takes a `depth` and refuses
  past `MAX_FORMULA_AST_DEPTH` before recursing, which is simultaneously the bound on the shape
  that gets STORED and the guard on that walk's own stack. Header rewritten to state both limits.
- **`src/engine/formula/format.ts`** — `formatNode` takes a `depth` and returns a new
  `DEPTH_ELISION` (`"..."`) past the same constant instead of recursing. Not an error code: a
  formula that deep is unreadable, not broken, and inventing a fourth `#`-vocabulary for a case
  only a hand-edited saved file can reach is more than §5.3 has. The header's SIZE exception is
  replaced by the guard.
- **`src/command/commands.ts`** — the three sentences that named the measured band (the file
  header, `executeCommand`'s doc, `writeSlot`'s doc) now say there is no exception, and say that
  this file adds no depth check of its own because the limit belongs to the recursion it bounds.

Tests (+15, 1058 to 1073): `parser.test.ts` pins both constants directly, the refusal at each
limit, the parse that still succeeds one step inside each, the 20,000- and 80,000-term lines that
used to throw, and that a refusal leaves the counter unraised. `format.test.ts` formats a
hand-built ladder at the limit unelided and a 40,000-level one without throwing. `commands.test.ts`
carries the end-to-end claim — the typed line refused through the failure arm, the document
untouched, and a 1,000-term formula that still **commits and evaluates**, which is what says
`deps.ts`, `eval.ts` and `format.ts` all survive the depth the constant permits.

## Decisions I made

1. **Two constants, not one.** They bound different recursions with different frame costs and
   different smallest-observed failures (~2,000 steps for the descent, ~6,000 levels for the walk).
   One number would have had to be the smaller of the two, which would refuse `A1 + A2 + ...`
   at ~250 terms for no reason the code could point at.
2. **256 descent steps, not D-079's 1,000.** See "stuck" — 1,000 is not a safe number for THIS
   recursion, and clause 2's actual instruction (well below the smallest observed failure) beats
   the illustrative ceiling in the same clause.
3. **The AST limit is checked in the range-placement walk** rather than in a new walk of its own.
   That walk already exists, already runs exactly once on the success path, and is already the
   first recursion over the finished tree. A second walk to measure depth would recurse just as
   deep to answer the question.
4. **`format.ts` elides, `parser.ts` refuses.** Formatting is display of something already stored;
   refusing there would mean a loaded document could not show the operator what is in it.
5. **No guard in `deps.ts`/`eval.ts`.** Nothing they can be handed is deeper than the parse limit
   unless §5.11's loader hands it to them, and the test at exactly 1,000 shows they survive what a
   parse can produce. Adding two more depth parameters for a path that does not exist yet is the
   speculative half of D-079 clause 4.

## Verification (real output)

```
$ npx tsc --noEmit
(no output, exit 0)
$ npx tsc --noEmit -p tsconfig.engine.json
(no output, exit 0)
$ npx vitest run
 Test Files  24 passed (24)
      Tests  1073 passed (1073)
```

Zero skipped, zero `.only`.

**Mutation check** (the suite passed first try, so it was checked, and the checker was checked —
assertions on the stripped `Tests  N failed` line): three faults seeded at once — the descent guard
forced false, the walk's depth guard forced false, `format.ts`'s guard forced false — gives
`Test Files  3 failed | 21 passed (24)` / `Tests  9 failed | 1064 passed (1073)`. Restored, green
again.

## Acceptance criteria status

Phase 3 criterion: *"create a polygon and a table by command, see both drawn, pan/zoom, select, and
drag the polygon."* — **NOT YET**, and untouched by this cycle. No pixel has come out of this
project. This slice removes the last throw from `executeCommand`, which is the thing 0086-REVIEW
§10 put before `main.ts`; it demonstrates nothing visible.

## Where I got stuck / what is unfinished

1. **D-079's own number is unsafe for one of the two recursions, and I did not use it there.**
   Clause 2 says "for `formula/parser.ts` and `format.ts` today that constant is at or below
   **1,000** nesting levels". Measured here: the recursive descent throws at **1,000 parenthesis
   levels** (500 committed, 1,000 threw, same process). A limit of 1,000 nesting levels in the
   descent is therefore a limit that still throws — the exact failure mode D-079's rationale
   describes for "3,000, from the worst term". I read clause 2's binding instruction as *a fixed
   constant well below the smallest observed failure*, took 256 steps (~128 parenthesis levels)
   for the descent, and used 1,000 for the AST walk, where the smallest observation is ~6,000.
   The ruling's ceiling holds for one recursion and not the other. **This wants a reviewer's word**
   — it is a number in a binding ruling that a measurement in this cycle contradicts, and I have
   deviated from it rather than followed it off the edge.
2. **Every number in this entry is an OBSERVATION, in one process, warm** (D-079 clause 1). The
   descent survived 500 parenthesis levels and died at 1,000; the walk survived 8,000 terms in one
   run and died at 20,000 in the next call of the same run; `format.ts` survived 5,000 levels here
   and was seen dying near there at entry 0079. None of these licenses "below N is safe" and none
   of them set either constant.
3. **`main.ts` still performs no effect and holds no canvas.** Unchanged by this cycle.
4. **The elision does not re-parse.** `formatFormula`'s round-trip property now has a fourth
   disclosed exception, reachable only for an AST no parse could have built. The header says so.
5. **I did not measure whether a REAL formula ever wants more than 128 parenthesis levels.** I do
   not believe one does, and the brief gives no shape that would; if a reviewer disagrees the
   constant is one line and one test.

## Open questions raised

None. Q-008 and Q-012 remain open and untouched; no new `PROVISIONAL` tag.

## Review point

**Fired: §6.1 trigger 3** — the brief is silent on formula size, and the binding ruling that stands
in for it (D-079 clause 2) names a constant this cycle measured to be unsafe for the descent. I
deviated from the number and kept the principle; that is a deviation, on a reviewed subsystem.
Also worth the reviewer's eye: 0086-REVIEW §10 item 2 and the fix list both describe this work as
a limit on the recursive descent, and the defect they were written about is not in the descent.

No test expectation changed (trigger 5 did NOT fire — fifteen tests added, none altered, none
removed). Batch would otherwise be cycle 1/3, diff 364 lines / 7 files, well inside the cap.
