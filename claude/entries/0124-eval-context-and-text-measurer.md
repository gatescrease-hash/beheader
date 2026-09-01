# 0124 — EvalContext and the injected TextMeasurer
Date: 2026-09-01   Phase: 5   Model: Sonnet 5 (implementer)
Previous entry: 0123-RULINGS   Last review: 0121-REVIEW-phase5 (verdict: ACCEPT WITH EDITS)
Batch: cycle 1 of up to 3 since last review; ~344 lines / 8 files changed so far
(0122 and 0123 were RULINGS entries — human decisions recorded by the reviewer — not
implementer cycles, so this is the first cycle of the batch).

## Declared scope

Build §5.1's "Evaluation context" seam and Rule 1's text-measurement interface, and thread
it: a new leaf file `src/engine/eval-context.ts` (`EvalContext`, `TextMeasurer`, `TextStyle`,
`NULL_EVAL_CONTEXT`), a third `context` parameter on `DerivedSlotCompute`, and a `context`
argument on `graph/eval.ts`'s `evaluate`, `mutation.ts`'s `deriveValidateAndEvaluate` and
`mutate`, forwarded untouched to every `derived`-slot compute. This is 0121-REVIEW §10.1's
"Rule 1's injected-measurer trap — the other thing to get right first, not last," taken as its
own slice ahead of the rest of the Phase 5 wiring.

## Explicitly not in scope

The `text` schema entry, `resolvedContent`/`measuredHeight` derived slots, the `text`
command, D-114's `evaluateDerivedSlot` widening, D-116/D-117's `!` display, markdown-lite
rendering, `render/measure.ts`'s real Canvas2D measurer, and threading a real context through
`command/commands.ts`'s `executeCommand` / `main.ts`. All of that is the next slice, which is
this seam's first behavioural consumer.

## What I did

**`src/engine/eval-context.ts` (NEW).** Three interfaces and one constant.
- `TextStyle` — the measurement-relevant subset of §5.6's `TextBox.style`: `font`, `fontSize`,
  `lineHeight`. `color`/`align` omitted deliberately (they change how text is painted, not how
  big it is).
- `TextMeasurement` — `{ width, height }`, both finite and `>= 0`.
- `TextMeasurer` — Rule 1's interface verbatim in spirit: `measure(text, style)`. The engine
  depends only on this; `render/measure.ts` will implement it; tests inject a fixed-width fake.
- `EvalContext` — `{ measurer: TextMeasurer }`. One service today (§5.1: "currently just the
  `TextMeasurer`"); the header's NOT DONE HERE says to widen only when a second exists.
- `NULL_EVAL_CONTEXT` — a deep-frozen null-object whose measurer reports `{ 0, 0 }`. This is
  the documented default for the many evaluation call sites that touch no `text` object (every
  current one). It is NOT a module-level mutable global — it is passed explicitly or accepted
  as a parameter default, so §5.1's "rather than reaching for module-level globals" holds.

**`src/engine/primitives/schema.ts`.** `DerivedSlotCompute` gains a third parameter,
`context?: EvalContext`. Typed **optional** for one reason, stated in its doc comment:
`graph/eval.ts` always supplies it (defaulting to `NULL_EVAL_CONTEXT`), but ~37 existing unit
tests call a compute function directly as `compute(OBJECT, read)` and §5.1 makes "keeps tests
trivial" an explicit goal of this design. A compute that reads `context` must treat its
absence as `NULL_EVAL_CONTEXT`; in the real pipeline it is never absent. Header's `compute`
invariant updated ("a pure function of (object, resolved inputs, injected `EvalContext`
services)").

**`src/engine/graph/eval.ts`.** `evaluate(objects, edges, context = NULL_EVAL_CONTEXT)`.
Threaded through `evaluateSlot` → `evaluateDerivedSlot` → `schemaEntry.compute(object, read,
context)`. `formula`/`literal` slots do not receive it (nothing in the formula language
measures text). Header's derived-slot bullet updated.

**`src/engine/mutation.ts`.** `deriveValidateAndEvaluate(objects, context =
NULL_EVAL_CONTEXT)` and `mutate(objects, operations, journal, context = NULL_EVAL_CONTEXT)`,
each forwarding `context` untouched to the next step. Both doc comments updated to say a
caller that creates or evaluates a `text` object MUST pass a real one. No other logic
touched — `context` is never inspected in `mutation.ts`, only passed.

**`src/engine/primitives/geometry.ts`.** One comment falsified and fixed (D-065): line ~107
said "Rule 1: no injected `EvalContext` reaches a derived-slot compute." One now does. Rewrote
it to say the `EvalContext` carries a `TextMeasurer` and nothing about the camera, so it would
not help a circle's tessellation decision even if this were the place to make it.

**Tests (`eval-context.test.ts` NEW, `graph/eval.test.ts`, `mutation.test.ts`).**
- `NULL_EVAL_CONTEXT` measures every box as zero, never throws, is frozen (a write to it
  throws in strict mode). Mutation-checked: changing the null measurer's return to `{5,5}`
  turns 3 of the 4 tests red.
- A `DerivedSlotCompute`-shaped stand-in for a future `measuredHeight` measures "hello"
  through an injected fixed-width measurer and gets the injected result; called with no
  context it falls back to zero.
- `evaluate` / `deriveValidateAndEvaluate` / `mutate` each: default to `NULL_EVAL_CONTEXT`
  when the argument is omitted (result identical to passing it explicitly), forward a
  caller-supplied context, and never touch its measurer on a pass over context-ignoring slots
  (`add`).

## Decisions I made

1. **`eval-context.ts` is a new leaf file, not additions to `graph/eval.ts` or
   `primitives/schema.ts`.** `TextMeasurer` is referenced by schema (the compute signature),
   eval (threading), render (the implementation) and main (wiring). A standalone file that
   imports nothing from `engine/` avoids an import cycle and gives every consumer one place to
   import from. The brief's §4 structure does not list it; §5.1 names the concept without
   placing it. This is a §6.1 trigger 2 (first file of a new subsystem) — reported below.

2. **`context` is defaulted, not required, at every call site.** A required parameter would
   have forced ~53 test call sites (`evaluate` ×25, `deriveValidateAndEvaluate` ×16, `mutate`
   ×12) to thread a context that, for a non-text document, is inert. `NULL_EVAL_CONTEXT` as an
   explicit exported frozen default is the standard null-object pattern and keeps §5.1's
   "keeps tests trivial" true. It is reversible: making it required later is a mechanical
   change, and no stored data depends on it.

3. **`NULL_EVAL_CONTEXT`'s measurer returns zero rather than an `ErrorValue` or a throw.** A
   throw would violate the never-throw discipline. An `ErrorValue` is not in `measure`'s
   return type (`TextMeasurement` is two plain numbers, deliberately — a measurement is not
   graph state). Returning zero is the least-wrong inert answer for a caller that has no text.
   **The risk this creates is real and I am flagging it, not hiding it:** if the next cycle
   wires `measuredHeight` and a real context fails to reach it, the slot silently reads height
   0 — a silent wrong value, which this project hates. That cycle owns the fix (see "Questions
   for reviewer").

4. **`context` is typed `context?` on `DerivedSlotCompute` but non-optional on the internal
   `evaluate`/`evaluateSlot`/`evaluateDerivedSlot` chain.** The optionality exists only at the
   public compute boundary, for the isolated-unit-test path; inside `graph/eval.ts` it is
   always a real value.

## Verification (real output)

```
$ npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.engine.json
(clean, no output — both configs)

$ npx vitest run
 Test Files  29 passed (29)
      Tests  1337 passed (1337)
```

0 skipped, 0 `.only` (`grep -rnE "\.(only|skip|todo)\(" src` → nothing).
Test count: 1329 → 1337 (+8: 4 in `eval-context.test.ts`, 2 in `graph/eval.test.ts`, 2 in
`mutation.test.ts`). File count 28 → 29 (`eval-context.test.ts`).

Diff, `git diff --numstat` after the last edit: **+344 / −20 across 8 files** — source:
`eval-context.ts` +121, `graph/eval.ts` +22/−5, `mutation.ts` +18/−3, `schema.ts` +22/−10,
`geometry.ts` +3/−2; tests: `eval-context.test.ts` +66, `mutation.test.ts` +52,
`graph/eval.test.ts` +40.

Mutation-check performed: `NULL_EVAL_CONTEXT`'s zero measurement (broken → 3/4 red in
`eval-context.test.ts`, reverted). The `evaluate`/`mutate` forwarding tests **cannot** be
mutation-checked against a threading regression this cycle — see "Where I got stuck".

## Acceptance criteria status

Phase 5 criterion ("a text box reading `Radius: {= table_x.A1 }{? ... }` updates both its
number and its branch ... wraps at its set width ... and re-renders when a value referenced
only inside the currently non-taken branch changes") — **NOT YET.** This cycle builds none of
the observable behaviour; it builds the measurement seam the `measuredHeight`/`wraps at its
set width` half will consume. Demonstrated by: N/A this cycle.

## Where I got stuck / what is unfinished

**The threading has no behavioural test, and cannot have one this cycle.** No schema `compute`
function reads `context.measurer` — the first that will is `measuredHeight`, deliberately the
next slice. So `evaluate` → `compute` context forwarding is guaranteed by `tsc` (every call
site updated, signatures aligned) and by a direct `DerivedSlotCompute`-level contract test,
but a full `evaluate(objects, edges, spyMeasurer)` → "the measurer was called with this text"
assertion is impossible until a consumer exists. The `graph/eval.test.ts` and
`mutation.test.ts` additions assert the weaker "accepted, forwarded, inert for `add`, measurer
untouched" — real, but they would stay green if `evaluateDerivedSlot` passed
`NULL_EVAL_CONTEXT` instead of `context`. I considered adding a throwaway consumer schema to
close this and rejected it as building-ahead the next slice would immediately rework; the
honest disclosure is the better trade. The next cycle's `measuredHeight` test IS the
end-to-end threading test, and it must be written to fail if the context is not threaded.

**`engine/document.ts`'s `loadDocument` calls `mutate([], operations, [])` with no context.**
A loaded document with a `text` object would evaluate `measuredHeight` against
`NULL_EVAL_CONTEXT`. Not reachable today (no `text` schema, so no `text` object serializes or
loads). The next slice owns giving `loadDocument` a context path.

## Decisions I made that the reviewer should rule on

Raised as a question below rather than `OPEN_QUESTIONS.md`: none of this shapes the data
model, addressing, or the mutation sequence (the block tree is derived, never stored — D-114
clause 4), so it is reversible implementer territory. But the seam is load-bearing and the
reviewer should confirm the shape before the next slice builds on it.

## Open questions raised

None in `OPEN_QUESTIONS.md`. See "Questions for reviewer" in the cycle summary.

## Review point

Fired: **§6.1 trigger 2** — `src/engine/eval-context.ts` is the first file of a new subsystem
(the injected-services seam), with no prior reviewed code to extend. Also §6.2: `mutation.ts`,
`graph/eval.ts` and `primitives/schema.ts` (all load-bearing) have unreviewed changes, so no
later phase may begin until this is reviewed — though Phase 5 is already open, so that blocks
only Phase 6. Batch: cycle 1/3, diff 344 lines / 8 files (cap 800/10). Stopping here for
review.
