# 0088 — REVIEW (phase 3)
Date: 2026-08-26   Phase: 3   Model: Claude Opus 5 (reviewer)
Previous entry: 0087-formula-depth-limits   Reviewing: entry 0087 (the two formula depth limits —
`MAX_FORMULA_PARSE_DEPTH`, `MAX_FORMULA_AST_DEPTH`, `format.ts`'s elision, and the four corrected
"ONE MEASURED EXCEPTION" sites).
Trigger: §6.1 item 3, self-reported by the entry — a stated deviation from **D-079** clause 2's
number, argued from a measurement made in the cycle.

Diff reviewed: `b358cdf` — `formula/ast.ts` (+20/-0), `formula/parser.ts` (+86/-8), `formula/format.ts`
(+42/-15), `command/commands.ts` (+10/-12), and three test files (+168/-3). Re-measured over `src/`:
**7 files, 326 added / 38 deleted = 364 changed.** The entry's own numbers are exact, and they are
counted the way 0086-REVIEW F3 asked for.

Verdict: **ACCEPT WITH EDITS.** Four findings, two fixed here, two reported. One ruling (**D-083**),
which also disposes of the trigger the entry fired. One new fix-list item, non-blocking.

The headline is that the cycle probed before it built and found that **the fix list named the wrong
recursion**, and that finding is correct. I reproduced it: `1 + 1 + ...` is a loop in
`parseLeftAssociativeExpr`, costs the descent nothing per term, and builds one AST level per term —
a depth limit on the descent alone would have left the reported line throwing exactly as before.
Two recursions, two limits, and the entry says so in the commit message rather than quietly
widening its scope. That is the behaviour §6.1 exists to produce.

## 1. Rule audit

- **Rule 1 (`engine/` is pure)** — upheld. The three engine files gain no import outside `engine/`:
  `ast.ts` gains none, `parser.ts` and `format.ts` each turn one `import type` into a value import
  from `./ast.ts`. `npx tsc --noEmit -p tsconfig.engine.json` is clean, which is the mechanical
  form of this rule and was re-run here, not read.
- **Rule 2 (state changes only through `mutation.ts`)** — upheld and directly tested: the refusal
  path returns before any `Operation` is built, and `commands.test.ts`'s new "leaves the document
  untouched" case pins it by `JSON.stringify` snapshot. Probed independently at nine pathological
  shapes; every refusal returned the failure arm with the document untouched.
- **Rule 5 (dumbest correct implementation)** — upheld, and this is the rule the cycle was most at
  risk of trading away. Neither recursion was converted to an explicit loop (**D-079** clause 4),
  no stack-size heuristic, no measurement in the code. Two integers and two comparisons.
- **Rule 3** — untouched: nothing here stores, formats or builds an `Address`. The elision is a
  display string produced *instead of* recursing, and cannot appear in a stored AST.
- **Rules 4, 6, 7** — untouched.

## 2. Invariant audit

**Never throws across the evaluation loop (§5.1).** This is the invariant the cycle exists to
restore, and the honest form of the result is: **restored for everything a user can type, not for
everything the type system permits.** See F3.

Probed rather than accepted — nine shapes through `executeCommand`, none of which appear in the
diff's tests, all against a real document:

| shape | result |
| --- | --- |
| 100,000 nested parens | `#PARSE` — "nests too deeply" |
| 100,000 unary `-` prefixes | `#PARSE` — "nests too deeply" |
| 50,000 nested `ABS(` calls | `#PARSE` — "nests too deeply" |
| 100,000-term `1 + 1 + ...` | `#PARSE` — "more than 1000 nested operations" |
| 50,000-term `table_1.B1 + ...` | `#PARSE` — same |
| 50,000-term `-1 + -1 + ...` | `#PARSE` — same |
| 50,000-argument `SUM(1, 1, ...)` | **COMMITS** — see §3 |
| 1,000-term chain (the limit exactly) | commits, evaluates, formats |
| 1,001-term chain | `#PARSE` |

No throw in any of them, and the boundary is where the constants say it is. Separately: 127
parenthesis levels parse and 128 refuse, which is what the `MAX_FORMULA_PARSE_DEPTH` doc claims in
words ("about 128 levels") — checked because a step-counted limit described in level terms is
exactly the kind of comment that drifts from its code.

**Graph state plain and serializable** — upheld; the two constants are module-level numbers and
nothing new is stored.

## 3. Spec conformance

§5.3 gains a size at which a formula is refused, and the brief gives none. That is the ambiguity
the entry correctly escalated. Three readings, all correct:

- **`#PARSE`, not a new error vocabulary.** A formula the parser will not accept is a parse
  failure; §5.3 has three error codes and this needed no fourth.
- **`format.ts` elides where `parser.ts` refuses.** Formatting is display of something already
  stored — refusing there would mean a loaded document could not show the operator what is in it.
  Right call, and `DEPTH_ELISION` is deliberately not `#`-prefixed for exactly that reason.
- **The limit sits at the recursion, not at `commands.ts`.** The corrected doc says so in the file
  that was tempted to bolt a check on. Ruled binding as **D-083** clause 3.

**Width is unbounded, and that is correct.** `SUM(1, 1, ... )` with 50,000 arguments commits — the
argument list is a `for` loop in the descent, in `walkForRangePlacement`, in `deps.ts` and in
`eval.ts`, so no walk over it recurses and no depth limit should catch it. Nothing here is broken.
It does mean a single command can echo a ~200 KB line, which is a `main.ts` concern about a DOM
console and not an engine one — fix-list item 5, not a finding.

**D-079, and the deviation that was not one — D-083.** The entry reports that it deviated from
clause 2's "at or below **1,000** nesting levels" by taking 256 for the descent. It did not:
256 *is* at or below 1,000. What the entry actually found is that clause 2 reads as a target when
it was written as a ceiling, and that the two recursions count in different units — 1,000
parenthesis levels is ~2,000 steps in the descent's unit, which is why the measured throw at 1,000
levels and a constant of 256 steps are not in conflict. **D-083** clause 1 records that no ruling
was broken (the entry's over-report is honest, and I would rather see this failure mode than its
opposite), clause 2 licenses two constants for two recursions, and clause 3 fixes the limit's
address. The implementer asked for a reviewer's word on this; that is the word.

## 4. Findings

### F1 — nothing tested the mechanism the descent limit actually rests on. FIXED here

`withNestingStep` is correct because it decrements on its one return path, so nesting that has
already *closed* costs nothing — without that, 300 sequential `((1))` terms would total well past
256 steps and refuse a line whose deepest point is four. The added test for this ("leaves the
nesting counter unraised after a refusal") **cannot fail**, and its own comment says so: each parse
gets a fresh `ParserState`, so it re-asserts that two independent parses are independent. Honest,
and empty. Added one `it` in the same block that parses 300 sibling nestings on one line and
asserts it succeeds. Verified it bites: deleting `state.depth -= 1` turns it red (with two others).
Left the original test in place — it says something small and true about the intent.

### F2 — a tautological assertion dressed as a margin check. FIXED here

`expect(MAX_FORMULA_AST_DEPTH).toBeLessThanOrEqual(1000)`, two lines under
`expect(MAX_FORMULA_AST_DEPTH).toBe(1000)`, under a comment about the observed failure depths. It
cannot fail while the line above passes, and the property its comment describes — a margin below a
`RangeError` seen once, in one process — is not a property of the code and is not assertable at
all. That is **D-079** clause 1's whole point. Removed the assertion, kept the comment, and said
in it why there is nothing to assert.

### F3 — `deps.ts` and `eval.ts` throw on exactly the input `format.ts` was guarded for. Reported; **D-083** clause 4; fix-list item 1

The cycle's decision 4 guards `format.ts` because §5.11's load path casts a saved `ast` unchecked
and a hand-edited file can deliver an AST no parse could build. Its decision 5 declines to guard
`deps.ts` and `eval.ts` because that path "does not exist yet". Both cannot be true of one path.
Probed at review with a hand-built 40,000-level ladder — the same fixture `format.test.ts` uses:

```
formatFormula:          ok
extractDependencies:    THREW RangeError
rewriteAddressesInAst:  THREW RangeError
evaluate:               THREW RangeError
```

**Nothing is broken today** — `parser.ts` refuses anything that deep, so no user-reachable path
produces one, and I have not asked for a guard. The fix is not three more depth parameters (that
is the speculative half of D-079 clause 4, and the entry is right to refuse it); it is that a
loaded document is validated once, where it is read. Ruled: **D-083** clause 4 — the loader checks
depth against `MAX_FORMULA_AST_DEPTH` at the boundary, `deps.ts` and `eval.ts` never grow a depth
parameter, and `format.ts`'s guard stands as built. What the diff should not carry unchallenged is
the *argument*, and `format.ts`'s header and `formatNode`'s comment both still state the load path
as this file's private concern. They are accurate about the file; they are now also incomplete
about the path, which is why this is a finding rather than a note.

### F4 — the §6.1 trigger the entry fired was not a deviation. Reported, not fixed (entries are append-only)

Covered above and ruled in **D-083** clause 1. Recording it as a finding because STATUS carried
"principle kept, number deviated from" as its first cold-read item and that sentence, left
standing, would read three entries from now as a binding ruling this project overrode. It did not.
Rewritten in STATUS; the entry itself stands as written.

Everything else in the entry re-measures exact. `npx tsc --noEmit` clean on both configs;
`npx vitest run` gives **1073/1073**, zero skipped, zero `.only`, re-run here rather than read. The
line counts (326/38, 7 files), the test delta (1058 → 1073, +15) and the batch position (cycle 1 of
3) are all correct. The mutation check reproduces in kind: one mutant (`state.depth -= 1` deleted)
kills three tests, so the new block bites and the checker is real.

## 5. Legibility audit

Headers rewritten where the work falsified them, and this cycle's whole visible surface was
sentences other cycles wrote — four sites carrying a claim that a measurement had licensed. All
four now say the same thing, and it is the true thing. **D-065** applied without prompting again.

Two things worth naming:

- **The constants are declared where the shape they bound is declared, not where they are
  enforced.** `MAX_FORMULA_AST_DEPTH` lives in `ast.ts` beside `FormulaAst`, which is why
  `parser.ts` and `format.ts` can read one number without either importing the other. That is
  D-010's principle applied to a number rather than to a string.
- **`withNestingStep` is a wrapper rather than a count at each call site**, and its doc says why in
  one sentence: one return path, so no error arm can leak the counter. The alternative — a
  `depth++` at each of the sites that recurse — is where this bug class actually lives.

Vocabulary locked. No `any`. The two refusal messages both name a remedy the operator can act on
("split it across cells, or use SUM over a range"), which is the standard fix-list item 2 keeps
asking the rest of the codebase to reach.

## 6. Honesty audit

**The strongest entry in this phase on this axis.** It reports that the defect was not where the
fix list said it was, names the fix list as wrong rather than reinterpreting it, states every
number in it as an observation with the process it came from, and flags its own constant as
something it wants ruled instead of settling it. Its "where I got stuck" section contains a real
admission (item 5: it did not measure whether a real formula ever wants 128 parenthesis levels) —
which I also did not measure, and which nothing in §5.3 suggests.

Declared scope matches the diff exactly: `main.ts` untouched, `deps.ts`/`eval.ts` untouched,
fix-list items 2-4 untouched. No test altered or removed; trigger 5 correctly reported as NOT
fired. The only correction the audit produces is F4, and it is an over-report, not an over-claim.

Phase 3's criterion is correctly **not claimed** — the entry says no pixel has come out of this
project and that this slice demonstrates nothing visible.

## 7. Open questions

Q-008 and Q-012 remain OPEN and untouched; neither is reachable from a depth limit. No new question
is raised by this diff, and none should be: the ambiguity this cycle hit was settled by ruling
(D-083), which is the right instrument for a number the brief is silent on.

## 8. Edits made

1. `src/engine/formula/parser.test.ts` — one new `it` asserting siblings do not accumulate nesting
   steps (F1), with the reason and the mutant that kills it named in an adjacent comment.
2. `src/engine/formula/parser.test.ts` — removed the tautological `toBeLessThanOrEqual` assertion
   and rewrote the comment to say why the property is not assertable (F2).

Verification after my edits, run here:

```
$ npx tsc --noEmit
(no output, exit 0)
$ npx tsc --noEmit -p tsconfig.engine.json
(no output, exit 0)
$ npx vitest run
 Test Files  24 passed (24)
      Tests  1074 passed (1074)
```

## 9. Fix list

**Old item 1 (the parser depth limit) is CLOSED by entry 0087.** Items renumbered.

1. **NEW — §5.11's loader validates a loaded formula's AST depth once, at the boundary**
   (F3, **D-083** clause 4). `deps.ts` and `eval.ts` get no depth parameter. Owned by the loader's
   own cycle; blocks nothing, because no user-reachable path produces such an AST today.
2. **Give the missing-slot refusal a remedy.** Message only; **D-047 clause 4 does not move**.
3. **`findDanglingReferences` names a dependent once per missing source.** Now visibly worse than
   0082-REVIEW knew: a refused 1,000-term formula produces a refusal message that repeats
   `table_1.A1` a thousand times. Group by dependent or dedupe within the message. `mutation.ts`.
4. **`zoom`'s refusal names `Infinity` rather than what was typed.** Message only.
5. **NEW — a single command can echo a ~200 KB line** (`SUM` with 50,000 arguments commits, and
   `writeSlot` echoes the formula). Nothing throws; it is a question of what `main.ts` puts in a
   DOM console. Owned by the `main.ts` cycle, non-blocking, and possibly answered by doing nothing.
6. **Carried from 0074-REVIEW §9, all six unchanged, none blocking:** (1) D-074's refused prompt
   answer · (2) the usage line for the form a prompting command was used in · (3) what a quoted
   command WORD means · (4) disclose 0074-REVIEW F4's two message changes and test (a) · (5)
   `set = x`'s self-contradictory message · (6) `parser.ts`'s header restating D-069 · the twelve
   bare "this cycle" sites in test files · `render/slots.ts` at the THIRD consumer of
   `readNumber`/`asPointArray` · `.gitattributes`.

## 10. Where Phase 3 stands, and the next slice

**`executeCommand` no longer throws on anything a user can type, and that is now checked at nine
shapes rather than claimed.** 0086-REVIEW §10 put this slice before `main.ts` precisely because a
throw stops being a test failure and starts being a dead input bar; it is closed.

**Nothing stands between here and `main.ts`.** Its shape is unchanged from 0086-REVIEW §10 item 3
and STATUS restates it: one clamped camera into `renderDocument`/`hitTest`/`pointerDown`/
`pointerMove` (D-062), the exhaustive effect `switch` with the `never` default (**D-082** clause 3)
resolving no name (clause 4), `zoom`/`fit` writing `Document.camera` directly and never through
`mutate` (D-027 clause 2), D-066's guard on a degenerate single-point extent, the transform reset
before screen-space chrome, and `prompt.ts` wired so a canvas click during a live sequence is a
`picked` response with screen→world done in `camera.ts`.

## 11. Verdict

**ACCEPT WITH EDITS.**

The cycle's value is not the two constants — it is that it went looking for the defect instead of
implementing the fix list, found the fix list describing the wrong recursion, and said so in the
first line of its log. Both limits are fixed constants, both are pinned by tests on the numbers
themselves, both sit under D-079's ceiling, and the guard is at each recursion rather than bolted
onto the caller. The two test defects I fixed are the same defect twice — an assertion that cannot
fail, standing in for a property that is real — and the one substantive gap (F3) is an argument the
entry made in two directions rather than a line of code that is wrong.

D-083 settles the number question the implementer stopped to ask, and answers it in the direction
the code already took.
