# 0121 — REVIEW (Phase 5, first file of a new subsystem): entry 0120's block-tree engine
Date: 2026-09-01   Phase: 5   Model: reviewer
Reviews: entry **0120** — `src/engine/primitives/text.ts` + its tests, 2 source files, +886 / −0.
Previous review: 0119-REVIEW-phase5
Verdict: **ACCEPT WITH EDITS.** Three edits, all in the reviewed file and its tests; two fix real
defects, one pins the brief's own criterion string. Two rulings: **D-114** and **D-115**. One new
open question for the human: **Q-019**. Entry 0120's question for the reviewer is answered in §7.
**§6.1 trigger 2 is discharged. Phase 5 may continue.**

## 1. What I actually ran, before reading anything as true

```
$ npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.engine.json
(clean, no output — both configs)

$ npx vitest run
 Test Files  28 passed (28)
      Tests  1322 passed (1322)          # at HEAD, before my edits
```

`grep -rnE "\.(only|skip|todo)\("` over `src/` → nothing.

**The diff numbers survive checking, exactly.** `git show --numstat` on `4be8379`: the source half
is `text.ts` 547 + `text.test.ts` 339 = **886 lines, 2 files**, which is what the entry's `Batch:`
line claims. **This is the first entry in three reviews whose countable claims all survive
measurement** — 0116-REVIEW had to correct entry 0115's diff total, 0119-REVIEW had to correct entry
0118's mutation counts. Nothing to report here, which is the point of reporting it.

## 2. Rule audit

- **Rule 1 (engine purity)** — upheld, mechanically. `grep -nE "document\.|window\.|canvas|
  CanvasRenderingContext2D|from \"\.\./render"` over both new files returns one hit: the file
  header's own prose naming what it must never import.
- **Rule 4 (ONE formula engine, no second evaluator for text)** — upheld, and this is the rule the
  cycle was most exposed to. Every embedded expression goes through `formula/parser.ts`'s
  `parseFormula` and `formula/eval.ts`'s `evaluate`; nothing here re-implements precedence,
  arithmetic, laziness or arity. The block-level `{? }{:}{?}` branch selection is NOT a second
  evaluator — §5.6 defines it as a block construct, and `formula/ast.ts`'s own reviewed header
  already drew that line ("Text's OWN `{? }{:}{?}` block-tree conditional... is a block-tree node,
  not a formula AST node"). The implementer landed on the correct side of a line drawn before the
  file existed.
- **Rule 5 (dumbest correct implementation)** — upheld. Fresh parse every call, no memo, linear
  scan, no adjacent-text-block merging (correctly declined — nothing consumes it).
- **Rule 6 (slot set fixed during evaluation)** — not at stake: this file creates no slots and
  touches no document state. Worth one line anyway, because the block tree LOOKS like state and is
  not: it is re-derived from `content` on demand, never stored (now ruled explicitly, D-114 clause
  4, so no later cycle caches it).
- **Rule 3 (addressing)** — upheld: every address arrives via `parseFormula` → `parseAddress` /
  `bareCellAddress`. No path is hand-built anywhere in the file. Verified by probe: `table_x.A1`
  inside text resolves to the stored `["cells","A1"]` shape (D-005), not `["A1"]`.
- **Rules 2, 7** — not touched.

Vocabulary lock: `grep -Ei "\b(property|properties|field)\b"` over the new file → zero. No synonym
drift for *slot*.

## 3. Spec conformance — §5.6, clause by clause, checked against behaviour

I drove the real functions in a throwaway file (deleted) rather than reading the tests:

| §5.6 requires | Probed | Result |
| --- | --- | --- |
| `{= expression }` | `Radius is {= 2 * 3 } units.` | text/formula/text ✓ |
| `{? c } ... {:} ... {?}`, **nesting** | the brief's own nested worked example | parses, both branches reachable ✓ |
| block tree shape | — | §5.6's three variants, plus one (see §5 / D-115) |
| dependency walker, **untaken branches included** | a ref in each branch | both reported ✓ |
| evaluation short-circuits | poison in the untaken branch | never surfaces ✓ |
| bare refs in text are a parse error (§5.3) | `{= A1 }` | `#PARSE` ✓ — and for the right reason: no `tableObjectId` is passed, so the mechanism is `parser.ts`'s, not a special case here |
| unresolvable name is PARSE-time (§5.3) | `{= nosuch.v }` | `no object named "nosuch"` at parse ✓ |

**Markdown-lite is absent, and that is correct, not an omission.** §5.6's own `Block` union has no
markdown node — bold/heading/list carry no dependency and no reactive value, so they stay literal
characters for `render/` to interpret. The implementer's reading is what the brief's own type says.

**The brief's literal Phase 5 criterion string had never been run.** The tests exercised paraphrases
the implementer chose. I ran §6's own words —
`Radius: {= table_x.A1 }{? table_x.A1 > 50 } — **LARGE**{:} — small{?}` — and it parses to
`[text, formula, conditional]`, extracts both `table_x.cells.A1` references, and evaluates to
`Radius: 80 — **LARGE**` / `Radius: 12 — small`. Pinned as Edit 3; see §6.

## 4. Invariant audit — the one that was actually broken

**Dependency extraction is EAGER and TOTAL.** It was not, in one case, and the case is exactly the
one §5.3's totality rule exists for. Measured, before my edit:

```
{? TRUE }{= table_1.rows }{:}{= poly_1.radius }{?}   -> both references reported
{? 1 + }{= table_1.rows }{:}{= poly_1.radius }{?}    -> ONLY table_1.rows
{? 1 + }x{:}{= poly_1.radius }{?}                    -> []            <- nothing at all
```

A broken CONDITION made `finishConditional` keep the true branch and **drop the false branch
entirely**, so a text object subscribed to strictly fewer slots than its own `content` names. Entry
0120 disclosed dropping the false branch as a *rendering* choice ("no principled way to pick one
without a working condition") and did not notice it was also a *dependency* choice — which is the
half that matters, because the true branch it keeps is never rendered either (the `error` block
short-circuits evaluation first). So the decision as built had no rendering effect at all; its only
observable effect was to make extraction half-total. Fixed by Edit 1, ruled **D-115** clause 3.

Nothing else is violated. In particular this was **not** a live invariant break: no dangling edge is
created (edges are missing, not extra), and the missing ones reappear on their own the moment the
condition parses, because edges are re-derived from `content` on every mutation. It is the D-017
failure class — *an edge silently missing* — reached through a new door, and it becomes real
reactivity loss the instant Q-019 is answered any way but (a).

Lazy evaluation, error propagation, no stored graph state: checked, all hold.

## 5. Honesty audit — the log matches the diff, and both mutation checks reproduce

I re-ran both of entry 0120's mutation checks against its own committed state:

| Check | Entry 0120 claimed | I observed |
| --- | --- | --- |
| Conditional always takes the true branch | 2 red | **2 red**, the two named |
| `extractTextDependencies` drops `falseBranch` recursion | 1 red | **1 red**, the one named |

Exact, both. After two consecutive reviews finding a countable claim that did not survive
measurement, this entry's do. The gotcha carried in `STATUS.md` ("write that section from the
runner's output, not from what you expected") was followed.

Everything else in the log matches the diff. The scope statement is accurate — no schema entry, no
`TextMeasurer`, no command, nothing in `render/` — and the "Where I got stuck" section raises the
D-110 question rather than guessing at it, which is the behaviour §7 of PROCESS_BRIEF asks for and
the reason that question is answered here instead of discovered mid-wiring.

**One claim is optimistic and is corrected**: Decision 4 says the wider `Value` return type means a
future `resolvedContent` "can pass this function through directly with no adapter." The return TYPE
composes; the CALLBACK contract does not. See F15.

Two details the entry got right that were easy to get wrong, worth recording because they cost
nothing to lose and are expensive to notice later: booleans embed as `TRUE`/`FALSE`, agreeing with
`renderer.ts`'s `formatCellValue` and `format.ts` (`props.ts`'s lowercase is the pre-existing
outlier, unchanged); and the quote-aware brace scan genuinely handles `{= "{:}" }` and
`{= CONCAT("a}b", 1) }`, which I probed directly rather than trusting.

## 6. The three edits

**Edit 1 — `finishConditional` keeps BOTH branches, not just the true one.** §4's defect. Zero
rendering change (verified: a broken conditional evaluates to `#PARSE` either way), pure restoration
of totality. +1 test. Mutation-checked: reverting to the true-branch-only form turns exactly the new
test red and nothing else.

**Edit 2 — the `error` block carries `source` and `start`.** It carried a message only, discarding
both the offending expression text and its position. **D-038 clause 4** says the layer that rejects
a formula never discards its source; **clause 2** says the rejection carries the offending name *and
its position*, because "retrofitting positions is the expensive kind of change." Measured before the
fix: `aaaaaaaaaaaaaaaaaaaa{= SUMM(1) }bbbb` produced `{"type":"error","message":"unknown function
\"SUMM\""}` — nothing to underline with, in either content-space or source-space. `start` is an
offset into `content`, so a consumer highlights the operator's own text without rescanning. +2
tests. Mutation-checked: making `start` source-relative instead of content-relative turns the new
test red. The compiler found the one hand-built fixture that needed widening (D-006 earning its
keep).

**Edit 3 — PROJECT_BRIEF §6's Phase 5 criterion string, verbatim, as four tests.** §12 makes the
criterion itself the contract, and a fixture an implementer chose cannot show that the SPEC's own
string parses. It does, and both branches evaluate. Mutation-checked via the number-embedding path
(3 tests red, including this one). This is the engine-side half of Phase 5's gate landing early —
it does **not** discharge the gate, which still needs a real `text` object, `resolvedContent`,
`measuredHeight` and the injected measurer.

**Verification after all three edits:** both tsc configs clean; `npx vitest run` → **28 files, 1329
passed**, 0 skipped, 0 `.only`. Diff added by this review, measured with `git diff --numstat` after
the last edit rather than estimated during it: **+145 / −20 across 2 source files** (`text.ts`
+75/−19, `text.test.ts` +70/−1). Recorded plainly because the first draft of this section said
"+101 / −13" — a number taken before Edit 3 was written and not re-measured after. It is the same
defect §5 credits this entry for avoiding, caught in the reviewer's own write-up by running the
command instead of trusting the sentence.

## 7. Entry 0120's question for the reviewer — answered

> Does `resolvedContent`'s dynamic dependency resolution and its `read` closure need **D-110**'s
> empty-in-extent-cell treatment, given `graph/eval.ts`'s `evaluateDerivedSlot` `read` does not
> apply it?

**Yes, and the question is better than it knew — the answer is ruled as D-114.** Three parts:

1. **Yes to D-110.** `STATUS.md`'s forward note and 0116-REVIEW §10's ordering argument both say a
   reference must mean the same thing in a cell and in a text box; anything else makes the decision
   to land D-110 before Phase 5 worthless.
2. **And the same applies to ranges, which the question did not reach.** `evaluateDerivedSlot`
   supplies no `readRange` at all, so under entry 0120's own stated wiring plan an embedded
   `SUM(table_1.A1:table_1.A4)` derives its edges correctly and then evaluates to `#PARSE`
   (measured). That is an edge/value disagreement — the class this project has now ruled against
   three times.
3. **And the ORDER of the two checks is load-bearing and non-obvious.** D-110 clause 4 gives an
   empty in-extent cell NO edge, so its address is not in `evaluateDerivedSlot`'s declared-dependency
   set, so D-013's membership check rejects it with `#REF` before D-110 could return `0`. The
   coercion must be consulted first for exactly that address class. Had the wiring cycle discovered
   this at the keyboard it would most likely have "fixed" it by weakening D-013.

The right shape is to WIDEN `evaluateDerivedSlot`, never to grow a second evaluation path or give
text its own extent arithmetic. D-114 states all of it.

## 8. Findings

**F13 — dependency extraction was silently non-total across a broken conditional.** §4. Fixed by
Edit 1; ruled **D-115** clause 3. The lesson worth keeping: *the entry reasoned about the recovery
as a display choice and never asked what it did to the edge set* — and the display half turned out
to be inert. When a recovery path drops a subtree, ask what else reads that subtree.

**F14 — the `error` block discarded the offending source and its position**, against **D-038**
clauses 4 and 2. Fixed by Edit 2; ruled **D-115** clause 2. Cheapest possible moment: the shape had
zero consumers. It is also what keeps Q-019 answerable in both directions.

**F15 — ranges inside text would evaluate to `#PARSE` under the entry's own stated wiring plan**,
while their edges derive correctly. No code change here — nothing is wired yet, and `text.ts` is
already correct (it takes an optional `readRange` and has no opinion on its origin). Ruled
**D-114**; the correction to Decision 4's "no adapter" claim is recorded in §5.

**Not a finding, recorded so it is met on paper: three flavours of malformed markup get three
different recoveries.** A stray `{?}` and an unterminated `{=` degrade to literal text; a `{= 1 + }`
that closes correctly poisons the whole object with `#PARSE`. That is operator-visible behaviour and
therefore **D-042**'s territory, not mine — raised as **Q-019** with a recommendation, not ruled.

## 9. Open questions

- **Q-019** (does one broken embedded formula blank the whole text box?) — **NEW, the human's,
  non-blocking.** Recommendation (b): render the broken span literally. Nothing is built against it;
  D-115 clause 2 keeps every option one line away.
- **Q-017** (persistent A1-style table headers) — **deferred, still open, still recommended.**
  Unchanged by this cycle.
- **Q-016** (may a panel row write a literal string/boolean) — **deferred, unchanged.**
- **Q-012** (world units or screen pixels) — **deferred**, due with the `style`-slots cycle.
- **Q-008** (`-0` as document state) — **deferred**, blocking nothing.

Next free is **Q-020**.

## 10. The gate, and what comes next

**§6.1 trigger 2 is discharged — `primitives/text.ts` is reviewed, and Phase 5 may continue.** No
load-bearing file (§6.2) was touched by this cycle at all, so nothing else is owed before the next
slice.

Recommended order, routing advice and not a ruling:

1. **The wiring slice** — `text` schema entry, `resolvedContent` + `measuredHeight`,
   `TextMeasurer` through an `EvalContext` into `graph/eval.ts`, the `text` command. It is a §6.1
   trigger of its own (`graph/eval.ts` and `primitives/schema.ts` are load-bearing, §6.2) and
   inherits **D-114** whole, including clause 3's ordering, which it must pin with a test that fails
   if the two checks are swapped. Rule 1's injected-measurer trap is the other thing to get right
   first, not last.
2. **Q-019**, if the human wants to answer it before the wiring cycle bakes in (a). Cheap either way
   now; not cheap once `render/` draws text.
3. **D-109 clauses 1–2** (cell decimals + clipping, `render/` only) and **Q-017**'s headers remain
   the smallest independent items on the board.

## 11. Edits made by this review

1. `src/engine/primitives/text.ts` — `finishConditional` keeps both branches; header invariant
   rewritten to match (§6, Edit 1; **D-115** clause 3). +1 test in `text.test.ts`.
2. `src/engine/primitives/text.ts` — `BlockParseErrorBlock` gains `source` and `start`, threaded
   through `parseBlockSequence`/`parseConditional`/`finishConditional` (§6, Edit 2; **D-115** clause
   2, **D-038** clauses 2 and 4). +2 tests in `text.test.ts`; one existing hand-built fixture widened.
3. `src/engine/primitives/text.test.ts` — PROJECT_BRIEF §6's Phase 5 criterion string, verbatim, as
   four tests (§6, Edit 3).

No production behaviour changed except F13's fix, which changes only the dependency set of a broken
conditional. `DECISIONS.md` gains **D-114** and **D-115**; `OPEN_QUESTIONS.md` gains **Q-019**;
`STATUS.md` is rewritten.
