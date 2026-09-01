# 0125 — REVIEW (Phase 5): the batch since 0121-REVIEW — 0122's error-span shape and 0124's `EvalContext` seam
Date: 2026-09-01   Phase: 5   Model: reviewer
Reviews: **0122-RULINGS** (D-116's data-shape change to `primitives/text.ts`), **0123-RULINGS**
(D-117, no code), **0124** (`src/engine/eval-context.ts` + the `context` threading). Source diff
since 0121-REVIEW: **7 files** (`text.ts` +62/−23 and `text.test.ts` +34/−19 from 0122; the eight
0124 files).
Previous review: 0121-REVIEW-phase5
Verdict: **ACCEPT WITH EDITS.** Four edits across 5 files, all comment/prose except a one-word code
fix (`Object.freeze`) and two added test assertions. One ruling: **D-118**. No new open question.
**§6.1 trigger 2 is discharged (`eval-context.ts` reviewed); §6.2's block on Phase 6 is cleared.
The Phase 5 wiring slice may proceed.**

## 1. What I ran, before reading anything as true

```
$ npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.engine.json
(clean, no output — both configs)

$ npx vitest run
 Test Files  29 passed (29)
      Tests  1337 passed (1337)          # at HEAD, before my edits
```

`grep -rnE "\.(only|skip|todo)\(" src` → nothing.

**Every countable claim in the batch survives measurement, exactly.**

| Claim | Source | Measured |
| --- | --- | --- |
| 0124 diff `+344 / −20`, 8 files | entry 0124 | `git show f71c672 --numstat`: 66+121+40+22+52+18+3+22 = **344** ins, 0+0+0+5+0+3+2+10 = **20** del, **8** files ✓ |
| 0124 test delta `+8` (4 `eval-context` / 2 `graph/eval` / 2 `mutation`) | entry 0124 | counted `it(` in the diff: 4 / 2 / 2; 1329 → **1337** ✓ |
| 0122 diff `+96 / −42`, 2 source files | entry 0122 | `text.ts` +62/−23, `text.test.ts` +34/−19 ✓ |
| 0122 mutation check: dropping the `orphaned` recursion → exactly 1 red | entry 0122 | re-ran (`block.orphaned` → `[]`): **1 red**, "a reference living ONLY in the false branch of a BROKEN conditional is still reported" — the one named ✓ |
| 0124 mutation check: null measurer returns `{5,5}` → 3 of 4 `eval-context` tests red | entry 0124 | not re-run against `{5,5}`; re-verified the stronger property directly (F17 below) |

This is the second consecutive batch whose numbers all hold (0121-REVIEW was the first). The
`STATUS.md` gotcha — "paste the runner's tail, don't trust the sentence" — was followed by both
0122 and 0124.

## 2. Rule audit

- **Rule 1 (engine purity / no canvas for text measurement)** — **upheld, and this is the rule
  0124 exists to serve.** `grep -nE "document\.|window\.|canvas|CanvasRenderingContext2D|from
  \"\.\./render"` over all seven changed engine files: every hit is prose in a header or doc
  comment (the "NEVER imports" line, or a sentence naming what `render/` will do). `eval-context.ts`
  imports nothing — a true leaf. The seam is exactly §5.1's shape: an interface defined in the
  engine, an implementation injected through a `context` argument, `NULL_EVAL_CONTEXT` passed as a
  parameter default rather than reached for as a module global.
- **Rule 2 (mutation-only state change)** — not touched. `mutate`/`deriveValidateAndEvaluate`/
  `evaluate` gained a forwarded parameter; no new state assignment anywhere.
- **Rule 4 (one evaluator, no second for text)** — not touched by this batch. `text.ts`'s
  `evaluateBlocks` is byte-identical; 0122 changed only parse-time shape and dependency walking.
- **Rule 3 (addressing)** — not touched.
- **Rule 5 (dumbest correct implementation)** — upheld. `NULL_EVAL_CONTEXT` is the plainest
  null-object; no caching of the block tree (D-114 clause 4 re-affirmed by the `orphaned` reshape,
  which is still a fresh parse every call).
- **Rule 6 (slot set fixed during evaluation)** — upheld. `context` is threaded into the *same*
  `evaluateDerivedSlot`, inside the *same* topological pass — no post-pass, no recompute. Verified:
  the only call site of `evaluateDerivedSlot` is `evaluateSlot`'s `derived` arm.
- **Rule 7** — not touched.

Vocabulary lock: `grep -Ei "\b(property|properties|field)\b"` over the changed engine source →
"field" appears only as `BlockParseErrorBlock.orphaned` *field* (a TS interface field, not a slot)
and in `TextStyle`'s doc naming its own fields. No *slot* synonym drift.

## 3. Invariant and spec audit — the `EvalContext` seam against §5.1

§5.1's "Evaluation context" is one sentence in the brief: *"Evaluation needs injected services
(currently just the `TextMeasurer`). Pass an `EvalContext` object down through evaluation rather
than reaching for module-level globals."* The build matches it clause by clause:

| §5.1 says | Built |
| --- | --- |
| "injected services" | `EvalContext { measurer: TextMeasurer }` — an interface, not a concrete class |
| "currently just the `TextMeasurer`" | one field; `eval-context.ts`'s NOT DONE HERE forbids widening until a second service exists |
| "pass ... down through evaluation" | `evaluate` → `evaluateSlot` → `evaluateDerivedSlot` → `compute(object, read, context)`; `formula`/`literal` slots correctly do not receive it |
| "rather than reaching for module-level globals" | `NULL_EVAL_CONTEXT` is a parameter default and an explicit argument — no code path *reads* a module-level context; the only module-level value is the frozen null-object itself, which is data, not behaviour |

**Derived slots still evaluate inside the topological pass** (Rule 6 / PROCESS_BRIEF §9's "never a
post-pass") — the threading did not move the call. **No graph state was added**: a `TextMeasurement`
is two plain numbers, explicitly *not* `Value`/`ErrorValue` (`eval-context.ts` invariant 3), so
nothing here becomes serializable state that could drift.

**D-116 clause 5 conformance (0122's shape change).** Checked against behaviour, not the tests: a
broken conditional now produces exactly one `error` block whose `source` round-trips
(`content.slice(start, start+source.length) === source`, covered) and whose `orphaned` holds both
parsed branches; `extractTextDependencies` recurses into `orphaned` (mutation-checked, §1);
`evaluateBlocks` never reads it. The span is computed once, in `parseConditional`, where `state.pos`
already sits past the closing `{?}` — no consumer re-derives where the construct ended. This is the
right shape for D-116, and the dependency-totality test needed no change, which is the evidence the
reshape preserved the edge set rather than papering over a loss.

## 4. Honesty audit — the logs match the diffs

0122 and 0124 both describe what they did accurately, including what they could not do:

- **0124 is candid about the gap it cannot close.** "The threading has no behavioural test, and
  cannot have one this cycle ... they would stay green if `evaluateDerivedSlot` passed
  `NULL_EVAL_CONTEXT` instead of `context`." That is true, and the mitigation is sound: `tsc`
  catches a signature mismatch at every call site, and the next slice's `measuredHeight` test is
  the real end-to-end check (and D-118 clause 4 now *requires* that test to exercise the threading).
  Building a throwaway consumer schema to get an assertion today would be building ahead of the
  next slice — the entry considered exactly that and rejected it for the right reason. **Accepted.**
- **0124 flagged its own riskiest choice rather than burying it** (Decision 3, the silent-zero
  hazard). That flag is answered here as **D-118** — see §6.
- **0122's test-expectation changes are §6.1 trigger 5 material and it says so**, correctly leaning
  on D-116's own reconciliation note for authorisation (the same standing D-110 gave the tests it
  flipped). Nothing was weakened: the two behaviour claims are asserted *more* strictly.

## 5. Findings

**F16 — 0122 changed `finishConditional`'s shape but left the prose describing the old one, citing
a closed question as open.** 0122 (a reviewer-authored entry) moved a broken conditional's branches
from inline siblings into `orphaned`, and updated five test expectations — but not
`text.ts`'s file-header invariant or the `finishConditional` doc comment, both of which still said
"keeps BOTH already-parsed branches inline after its `error` block" and "What a broken conditional
would DISPLAY is **Q-019**, the human's, and is deliberately not decided here." Q-019 was answered
(D-116) in the same entry. A reader who greps `finishConditional` or skims the header lands on a
statement false about the current code (D-060's present-tense rule) and on a question that no longer
exists. This is **precisely the shape F13 named one entry earlier** — a recovery choice reasoned
about against a consumer's *current* behaviour ("rendering is unaffected, the error block
short-circuits first"), which the human then changed — and the reviewer's own write-up in 0122 §
"the lesson" spotted the pattern in the *code* while leaving it live in the *comments*. Fixed by
Edit 1; recorded as a `STATUS.md` gotcha. No new decision: **D-060** and **D-065** already bind
every author, reviewer included.

**F17 — `NULL_EVAL_CONTEXT` is not deep-frozen, though the header, the log, the commit message and
`STATUS.md` all say it is.** `Object.freeze` was applied to the outer object only; `NULL_TEXT_MEASURER`
was a bare object literal. So `NULL_EVAL_CONTEXT.measurer = x` throws (covered by the one freeze
test) but `NULL_EVAL_CONTEXT.measurer.measure = x` **succeeds silently** — and since every
context-free evaluation pass shares that one measurer, this corrupts all of them. That is the exact
failure the invariant ("a stray write to it fails loudly ... rather than corrupting every later
pass that shares the default") claims to prevent. Fixed by Edit 2: freeze `NULL_TEXT_MEASURER` too,
and strengthen the test to assert `Object.isFrozen(NULL_EVAL_CONTEXT.measurer)` and that the nested
write throws. Mutation-checked: reverting the inner `Object.freeze` turns the strengthened test red.

**F18 — `evaluateBlockTree`'s "no adapter" comment, flagged optimistic at 0121-REVIEW and formally
corrected by D-114, was never fixed in the code.** The comment still told the next implementer the
future `resolvedContent` entry "can pass this function's result straight through with no adapter."
D-114's rationale says in as many words: "the return TYPE composes, the callback contract does not
... Decision 4 ... is corrected here." The return-type half is fine; the "no adapter" half sends
the wiring cycle in the wrong direction on the half that matters (D-110 coercion, a real
`readRange`, D-013 ordering — all `evaluateDerivedSlot` work). Fixed by Edit 3.

**Minor — new/edited doc comments stated unbuilt `main.ts` wiring in the present tense.**
`eval-context.ts` ("`main.ts` injects the real Canvas2D-backed measurer"), `graph/eval.ts`
("`main.ts` threads a real one through `mutate`"), `mutation.ts` ("`main.ts` does, via the
Canvas2D-backed `render/measure.ts`"). No such caller exists — every `mutate`/`evaluate` call site
takes the `NULL_EVAL_CONTEXT` default today. Tightened to future/intent phrasing (Edit 4). This is
the same present-tense discipline F16 is about, caught in a new file before it sets.

**Not a finding, recorded: the `mutate` call sites the wiring cycle must not miss.** 0124's
"where I got stuck" names `document.ts`'s `loadDocument`; `STATUS.md` names `executeCommand` /
`main.ts`. The full list of non-test `mutate` callers is: `command/commands.ts` ×4 (lines 374, 571,
706, 753), `engine/document.ts:380`, `render/interaction.ts:291` (the drag path). Every one passes
no context today. The drag path especially — dragging a `text` object re-evaluates `measuredHeight`
— must thread a real context, and **D-118 is what makes a miss there loud instead of silent.**

## 6. D-118 — the silent-zero risk 0124 flagged, ruled

`NULL_EVAL_CONTEXT`'s measurer returns `{0, 0}` for every string. Correct and inert for a document
with no `text` object; a **silent wrong value** for a `measuredHeight` compute that runs against it
for a real `text` object with non-empty `content`. 0124 raised this deliberately ("the risk this
creates is real and I am flagging it, not hiding it") and left it to the consuming cycle. It should
not be an open choice at the keyboard — the project's whole posture answers it. **D-118** rules:
a compute that genuinely needs a measurement MUST return an `ErrorValue` when it can see only the
null measurer, never a height it did not earn; the detection mechanism is the implementer's to
choose; `evaluate`/`mutate` still forward `context` untouched and never inspect it. Full text in
`DECISIONS.md`. Reversible, compute-internal; the human can overrule the "must error" stance if a
silent zero is genuinely preferred, but the default should be loud.

## 7. Open questions

None raised by this batch. Standing:

- **Q-019 → D-116**, **Q-020 → D-117** — closed (the human, entries 0122/0123).
- **Q-016** (panel row literal string/boolean), **Q-017** (persistent table headers) — the
  human's, unchanged, non-blocking, untouched here.
- **Q-012** (world units vs screen pixels) — deferred, due with the `style`-slots cycle;
  `TextStyle`'s doc restates provisional (a) without settling it, which is correct.
- **Q-008** (`-0` as document state) — deferred, blocking nothing.

Next free is **Q-021**.

## 8. The gate

- **§6.1 trigger 2 (first file of a new subsystem — `eval-context.ts`) is DISCHARGED.** The seam is
  reviewed; the injected-services subsystem may be extended by later files without each one
  re-triggering.
- **§6.2:** `mutation.ts`, `graph/eval.ts` and `primitives/schema.ts` had unreviewed load-bearing
  changes. They are now reviewed. Phase 5 was already open, so this only ever blocked Phase 6 —
  that block is lifted.
- The Phase 5 **wiring slice** may proceed. It is itself a §6.1 trigger (load-bearing files) and
  inherits **D-114** (whole, including clause 3's ordering), **D-116 clauses 1–4 + D-117** (the `!`
  display, together, with the three tests D-117's reconciliation names), and now **D-118** (the
  null-measurer guard, with its own test). Recommended order is unchanged from 0121-REVIEW §10 and
  restated in `STATUS.md`.

## 9. Edits made by this review

1. **`primitives/text.ts`** — file-header invariant and `finishConditional` doc comment rewritten
   to the `orphaned` shape and to D-116/D-117 as *ruled* (F16); NOT DONE HERE updated (the
   `EvalContext` seam is *done* as of 0124; the `!` display and D-114's closures are what remain).
   Comment-only.
2. **`eval-context.ts`** — `NULL_TEXT_MEASURER` wrapped in `Object.freeze` so "deep-frozen" is true
   (F17); header invariant reworded to name both freeze layers.
   **`eval-context.test.ts`** — the freeze test now asserts the measurer is frozen and that the
   nested write throws. +2 assertions, mutation-checked.
3. **`primitives/text.ts`** — `evaluateBlockTree`'s "no adapter" comment replaced with what D-114
   actually requires (F18). Comment-only.
4. **`eval-context.ts` / `graph/eval.ts` / `mutation.ts`** — doc comments that stated unbuilt
   `main.ts` wiring in the present tense reworded to future/intent. Comment-only.

Verification after all edits: both `tsc` configs clean; `npx vitest run` → **29 files, 1337
passed**, 0 skipped, 0 `.only` (test count unchanged — Edit 2 added assertions to an existing
`it`, not a new one). Diff added by this review, `git diff --numstat`: **+88 / −58 across 5 files**
(`text.ts` +55/−37, `eval-context.ts` +12/−8, `mutation.ts` +8/−7, `eval-context.test.ts` +7/−1,
`graph/eval.ts` +6/−5).

`DECISIONS.md` gains **D-118**. `OPEN_QUESTIONS.md` unchanged (Q-019/Q-020 already marked
`ANSWERED` by 0122/0123). `STATUS.md` rewritten.
