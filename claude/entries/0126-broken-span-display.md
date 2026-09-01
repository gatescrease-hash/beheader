# 0126 — D-116 + D-117: a broken embedded span is marked in place, not blanked
Date: 2026-09-01   Phase: 5   Model: Sonnet 5 (implementer)
Previous entry: 0124-eval-context-and-text-measurer   Last review: 0125-REVIEW-phase5 (verdict: ACCEPT WITH EDITS)
Batch: cycle 1 of up to 3 since last review; ~146 lines / 2 files changed so far.

## Declared scope

Implement **D-116** and **D-117** in `primitives/text.ts`'s `evaluateBlockTree`: a parse-broken
`{= }`/`{? }` span now renders `!` + its own verbatim source (delimiters included) and the rest of
the tree still renders (D-116), and a span that parsed but evaluated to an `ErrorValue` — or a
conditional whose condition does, or is a non-boolean — renders `!` + that error's CODE in place
(D-117). `evaluateBlocks` therefore no longer returns an `ErrorValue` for the whole tree; it always
returns a `string`, and a broken conditional's `orphaned` branches stay dependency-only and are
never rendered.

## Explicitly not in scope

The `text` schema entry, `resolvedContent`/`measuredHeight` derived slots, **D-114**'s
`evaluateDerivedSlot` widening, **D-118**'s null-measurer `#MEASURE` guard, the `text` command,
`render/measure.ts`'s real Canvas2D measurer, and any `EvalContext` threading through `mutate`
callers — all later cycles of this batch. No load-bearing (§6.2) file was touched.

## What I did

**`src/engine/primitives/text.ts` — the only production file.**

- New `BROKEN_SPAN_MARK` constant (`"!"`) with a doc comment stating it is the *shared half of two
  DIFFERENT mechanisms* (D-116's source-verbatim rendering vs D-117's error-code rendering — D-117
  clause 3 forbids merging them) and that the mark is emitted HERE, into the resolved string, never
  by `render/` (D-116 clause 4: `measuredHeight` is measured FROM that string).
- New `renderRuntimeError(value: ErrorValue): string` — `!` + `value.error` (the CODE, not the
  `message`, not the source — D-117 clause 1).
- `evaluateBlocks`:
  - `case "error"` — was `return { error: "#PARSE", message }`. Now `result += "!" + block.source`
    and continues. `orphaned` is untouched (walked only by `extractTextDependencies`).
  - `case "formula"` — an `ErrorValue` from the AST, or a `#TYPE` from `formatValueForEmbedding`
    (the `Point`/`Point[]` case), now appends `renderRuntimeError(...)` and continues instead of
    returning it.
  - `case "conditional"` — an `ErrorValue` condition, and a non-boolean condition, now append
    `renderRuntimeError(...)` and take NEITHER branch (D-117 clause 6). The taken-branch recursion
    is unchanged in spirit (short-circuit, §5.6) — a broken span inside the taken branch is marked
    there by the same recursion (D-117 clause 6: "no new case exists there").
  - Return type narrowed `string | ErrorValue` → `string`. There is no error channel left.
- `evaluateBlockTree` return type narrowed `Value` → `string`. `DerivedSlotCompute` returns `Value`
  and `string ⊆ Value`, so `resolvedContent`'s future compute still "passes the result through
  unchanged"; D-116 clause 3 / D-117 clause 4 ("`resolvedContent` holds a `string`, not an
  `ErrorValue`") are now encoded in the type rather than merely asserted.
- Header + `BlockParseErrorBlock` doc + `finishConditional` doc + the `orphaned` field doc rewritten
  to the built behaviour, present tense (D-060): the `!` display is *done*, not owed; the
  "0122 moved the branches off the sibling list" reasoning is stated structurally, not as "once an
  error block stops poisoning the tree" (the F16/gotcha lesson — a comment that dates a future
  change).

**`src/engine/primitives/text.test.ts`.** Four existing tests changed from asserting
error-propagation to asserting `!`-mark rendering (see "Review point" — §6.1 trigger 5, authorised
by D-116 clause 2 / D-117):
- "a broken embedded formula's ErrorValue propagates as the WHOLE tree's result" → "a RUNTIME-broken
  embedded formula renders `!` + its error CODE in place": `before {= 1 / 0 } after` → `before !#DIV0 after`.
- "an error block ... propagates as #PARSE" → "a PARSE-broken span renders `!` + its own source
  verbatim": `before {= 1 + } after` → `before !{= 1 + } after`.
- "a Point/Point[] value cannot be embedded directly — #TYPE" → renders `!#TYPE` in place.
- "a non-boolean condition is #TYPE" → renders `!#TYPE` in place and takes NEITHER branch.

New tests (the three D-117 reconciliation names — a parse-broken span, a runtime-broken formula
block, a runtime-broken conditional condition — plus D-116-clause-5 and totality coverage):
- a paragraph of five embeddings, each broken span marked independently (the injury D-116 was ruled
  against): `5 ok !{= 1 + } mid !#DIV0 end`.
- `evaluateBlockTree` ALWAYS returns a string, broken spans included.
- a RUNTIME-broken conditional condition (`{? 1 / 0 }...`) → `!#DIV0`, neither branch.
- a PARSE-broken conditional renders its WHOLE construct source (`!{? 1 + }yes{:}no{?}`), never its
  branches — `orphaned` is not rendered (D-116 clause 5).
- a broken embedding inside the taken branch is marked there, recursively.
- updated the stale comment in the extractTextDependencies "false branch of a BROKEN conditional"
  test (it said "this whole tree evaluates to #PARSE").

## Decisions I made

1. **`evaluateBlocks` / `evaluateBlockTree` return `string`, not the wider `Value`/`string |
   ErrorValue`.** After D-116/D-117 there is genuinely no path that yields an `ErrorValue` for the
   whole tree, and both rulings state `resolvedContent` is always a string. Narrowing the type
   makes that structural. Reversible — widening back is one keystroke — and nothing stored depends
   on it (the block tree is never serialized, D-114 clause 4).
2. **The non-boolean-condition case still builds a full descriptive `ErrorValue`** (with the
   `describeConditionType(condition)` message) and passes it through `renderRuntimeError`, which
   extracts `.error`. The message is not rendered today (D-117: code only) but this keeps the shape
   identical to every other error path here and in `formula/eval.ts`, and 0122-RULINGS notes the
   reviewer weighed "how much of a (possibly long) message fits inline" — the data is there if that
   is ever revisited. The comment says "the `#TYPE` code alone" so a reader is not surprised.
3. **`renderRuntimeError` takes an `ErrorValue`, not an `ErrorCode`.** Call sites read
   `renderRuntimeError(value)` rather than `renderRuntimeError(value.error)` — marginally cleaner,
   and it never has to care that `formatValueForEmbedding` hands back a full `ErrorValue`.
4. **`expectError` in the test file is now unused** (all four call sites were the flipped tests).
   Left in place rather than removed: D-118's `measuredHeight` → `#MEASURE` test in the next cycle
   of this batch will use it, and removing-then-re-adding is pure diff churn. Flagged here so it is
   not silent.

## Verification (real output)

```
$ npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.engine.json
(clean, no output — both configs)

$ npx vitest run
 Test Files  29 passed (29)
      Tests  1342 passed (1342)
```

0 skipped, 0 `.only` (`grep -rnE "\.(only|skip|todo)\(" src/` → nothing).
Test count: 1337 → 1342 (+5, all in `text.test.ts`: 42 → 47 — first embedding block −3/+5, conditional
block −1/+4). File count unchanged (29).

Diff, `git diff --numstat` after the last edit: **+146 / −83 across 2 files** — `text.ts` +102/−69
(most of it header/doc-comment prose), `text.test.ts` +44/−14.

Mutation-checked, both against the committed implementation, restored after:
- Break the `!` mark on a parse-broken span (`"!"` → `"XX"` in `case "error"`) → **exactly 3 red**:
  the parse-broken-span test, the five-embeddings test, the parse-broken-conditional-whole-source
  test. The "always returns a string" test stays green (correct — it asserts the type, not the
  content).
- Render the `message` instead of the `.error` code in `renderRuntimeError` → **exactly 6 red**:
  every D-117 test (runtime-broken formula, five embeddings, Point `!#TYPE`, non-boolean `!#TYPE`,
  runtime-broken condition, nested-in-taken-branch). Pins D-117 clause 1's "the CODE, not the
  message".

## Acceptance criteria status

Phase 5 criterion ("a text box reading `Radius: {= table_x.A1 }{? ... }` updates both its number
and its branch ... wraps at its set width ... and re-renders when a value referenced only inside the
currently non-taken branch changes") — **NOT YET.** This cycle builds none of the observable text
behaviour; it makes `evaluateBlockTree` render a broken span rather than blank the box, which is
D-116/D-117, not the gate. Demonstrated by: N/A this cycle. The gate still needs the `text` object,
`resolvedContent`, `measuredHeight`, the injected measurer, and `render/`'s wrapping.

## Where I got stuck / what is unfinished

Nothing blocked me. The slice is small and entirely within one already-reviewed file.

The one judgement call worth a second look: **narrowing `evaluateBlockTree` to `string`**. It is
correct today and correct under both rulings, but if a later cycle finds a reason `resolvedContent`
should be able to hold an `ErrorValue` after all (I do not see one — D-116 clause 3 and D-117 clause
4 are explicit), that reversal touches this signature. Recorded so it is a conscious choice, not a
discovered constraint.

`describeConditionType` and the non-boolean-condition `message` are computed and then only their
existence matters (the `.error` code is what renders). See Decision 2 — kept for shape-consistency,
not an oversight.

## Open questions raised

None. D-116 and D-117 were fully ruled (the human, entries 0122/0123); this cycle only builds them.

## Review point

Fired: **§6.1 trigger 5** — four existing `text.test.ts` expectations changed from asserting
error-propagation (`#PARSE` / `#DIV0` / `#TYPE` for the whole tree) to asserting `!`-mark inline
rendering. This is **authorised in advance** by D-116 clause 2 ("that behaviour was a default by
omission, never a decision, and it is now overruled") and D-117, and by D-116's reconciliation note
("owed by the Phase 5 wiring cycle, which MUST land them with tests") — the same standing D-110 gave
the tests entry 0118 flipped. Nothing was weakened: the flipped tests assert *more* specific
behaviour (exact rendered strings, text-around-the-break survival) than the old `expectError` calls.

No other trigger fired: not a phase gate (§6.1 #1 — the Phase 5 gate needs `render/` wrapping);
`text.ts` is already a reviewed subsystem (§6.1 #2 discharged at 0121); no brief deviation (§6.1 #3
— D-116/D-117 are explicit); no §6.2 load-bearing file touched.

Batch: cycle 1/3, diff 146 lines / 2 files (cap 800/10).

REVIEW: REQUIRED — §6.1 trigger 5 (changed test expectations, authorised by D-116/D-117).
