# 0131 — `render/measure.ts`: the Canvas2D `TextMeasurer`, and Q-021's reconciliation
Date: 2026-09-01   Phase: 5   Model: Sonnet 5 (implementer)
Previous entry: 0130-REVIEW-phase5   Last review: 0130-REVIEW-phase5 (verdict: ACCEPT WITH EDITS)
Batch: cycle 1 of up to 3 since last review; ~392 lines / 9 files changed so far.

## Declared scope

Build `src/render/measure.ts` — the Canvas2D-backed `TextMeasurer` (`engine/eval-context.ts`'s
interface, Rule 1's text-measurement seam): `createCanvas2dTextMeasurer(ctx)` returns a `measure`
that lays text out (hard newlines, then greedy word-wrap to `maxWidth` per **D-120**), measures each
line with `ctx.measureText`, and returns `{ width: widestLine, height: lineCount * lineHeight }`,
never throwing and always finite/non-negative. Reconcile **D-120** (answering **Q-021**): remove every
`PROVISIONAL(Q-021)` tag and swap it for a `(D-120)` citation, keeping the prose that explains why
`maxWidth` exists.

## Explicitly not in scope

WIRING the measurer — `main.ts` building an `EvalContext` around it and threading that through
`executeCommand`, `document.ts`'s loader, and the drag path — is the next slice; `measuredHeight`
still reports `#MEASURE` for every real document until it lands (D-118). The `text` command,
markdown-lite parsing/rendering, `renderer.ts`'s text-drawing pass, and the F13 ruling
(`formula`-driven `content`) are all untouched.

## What I did

### `src/render/measure.ts` (NEW, 188 lines) — render layer

`createCanvas2dTextMeasurer(ctx: MeasurementContext)` -> a `TextMeasurer`. `MeasurementContext` is a
narrow structural type (`{ font: string; measureText(text): { width } }`) that a real
`CanvasRenderingContext2D` satisfies with no cast and a test fake satisfies with two members —
avoiding `renderer.test.ts`'s `as unknown as` for its wider fake.

- **Width** = widest laid-out line, via `ctx.measureText` after `ctx.font` is set to
  `` `${fontSize}px ${family}` `` (so measured widths are numerically in the `fontSize` unit —
  world units, `eval-context.ts`'s `TextStyle`). **Height** = `lineCount * style.lineHeight`,
  `lineHeight` read as an ABSOLUTE length (not a ratio) — that reading is `eval-context.ts`'s
  `TextStyle` doc, inherited, not re-decided here.
- **Line-breaking (D-120)** in `layOutLines`: split on `/\r?\n/` first (the operator's hard
  breaks), then — only when `maxWidth` is a positive finite number — greedily word-wrap each hard
  line, measuring candidate lines with `ctx.measureText`. A word wider than `maxWidth` sits alone
  and overflows (no mid-word breaking / hyphenation — Rule 5). Lines are appended one at a time,
  never `push(...lines)` / `Math.max(...lines)`: the line count follows `content`'s length, which
  the operator controls (D-077 clause 1).
- **The `eval-context.ts` contract, defensively**: a non-finite/non-positive `fontSize` (or an
  empty string) -> `{ width: 0, height: 0 }` and `ctx.font` untouched; a non-finite/non-positive
  `lineHeight` -> single-spaced fallback (`fontSize`); a non-positive/non-finite `maxWidth` -> no
  wrap (same as `"auto"`); a non-finite width back from `measureText` -> `0`; a blank `style.font`
  -> generic `sans-serif` so the measurement is deterministic regardless of what `font` the shared
  context last held (D-062's `finiteOrFallback` posture, applied to a font string).

### `src/render/measure.test.ts` (NEW, 162 lines, 19 tests) — env `node`, hand-rolled fake

`fakeContext()` records every `font` it is set to and reports `text.length * 10` px from
`measureText` — the same fixed-width posture `renderer.test.ts` uses. Covers: single-line width,
widest-of-hard-lines, the `font` shorthand; height as `lineCount * lineHeight` with blank lines and
`\r\n` counted; empty string -> zero box (and `font` not even set); no-wrap without `maxWidth`;
greedy wrap growing height; an over-long word overflowing alone; per-hard-line independent wrap;
space-run collapsing; `maxWidth` of `0`/`-5`/`Infinity` == no wrap; and the contract guards
(NaN/`0`/negative `fontSize` -> zero box, NaN/negative `lineHeight` -> `fontSize` fallback,
non-finite `measureText` width -> `0`, blank family -> `sans-serif`, never throws on 5 000-char /
2 000-line / zero-`lineHeight` inputs).

### Q-021 reconciliation — `PROVISIONAL(Q-021)` removed, `(D-120)` cited (doc/comment only, no logic)

- `src/engine/eval-context.ts` — the `TextMeasurer.measure` `maxWidth` doc and the NOT DONE HERE
  block: tag -> `D-120`, present-tense ("D-120 resolves that inconsistency by widening the
  interface HERE"). Its NOT DONE HERE also updated to say `render/measure.ts` is BUILT (entry 0131)
  and only its WIRING is pending (D-065 — a comment my work made stale).
- `src/engine/primitives/text.ts` — `computeMeasuredHeight`'s doc (×2) and the one inline
  `// PROVISIONAL(Q-021)` at the `maxWidth` line: all -> `D-120`, noting `render/measure.ts` is the
  real measurer. No code change.
- `src/engine/primitives/schema.ts` — `TEXT_SCHEMA`'s `measuredHeight` doc comment: tag -> `D-120`.
- Test descriptions carrying the tag as a label (`eval-context.test.ts`, `primitives/text.test.ts`
  ×2, `graph/eval.test.ts` ×2): `PROVISIONAL(Q-021)` / `Q-021` -> `D-120`. No assertion changed.
- `src/main.ts` — the "Injecting a Canvas2D `TextMeasurer`" NOT DONE HERE bullet: was "Nothing
  evaluates text yet" (false since 0127); now names `render/measure.ts` as built and the wiring as
  the next slice. Comment only (D-065).

`grep -rnE "PROVISIONAL\(Q-021\)" src/` -> nothing. `OPEN_QUESTIONS.md` already marks Q-021
`ANSWERED → D-120` (0130-REVIEW).

## Decisions I made

1. **`lineHeight` is an absolute length, not a ratio.** Not my call to make freshly —
   `eval-context.ts`'s `TextStyle` doc (reviewed 0125) already says `fontSize` and `lineHeight` are
   "in the same length unit"; `height = lineCount * lineHeight` follows. Cited, not re-argued.
2. **Whitespace: a run of spaces is collapsed for wrap FITTING** (`"aaa    bbb"` does not break at
   the double space). D-120 clause 2 lists "no whitespace collapsing" among the things that are
   "`render/measure.ts`'s" to decide — i.e. delegated here, not forbidden. This is the dumbest
   correct wrap (Rule 5); un-wrapped hard lines are still measured verbatim.
3. **A blank `style.font` falls back to `sans-serif`.** Not the measurer inventing a typeface (the
   concern `computeMeasuredHeight`'s own comment raises for the COMPUTE) — `computeMeasuredHeight`
   already `#TYPE`s a non-string `font`, so only `""` reaches here, from a hand-built/loaded object.
   The fallback is for DETERMINISM: an invalid `ctx.font` assignment is silently ignored by the
   canvas, which would leave the measurement running against whatever the previous `measure` call
   set. D-062's `finiteOrFallback` posture.
4. **`MeasurementContext` is a hand-written structural type, not `Pick<CanvasRenderingContext2D, …>`.**
   A real context satisfies it; a fake needs only `font` + `measureText` and no cast.
5. **Built `measure.ts` now, unwired.** D-120's reconciliation note names "the `render/measure.ts` /
   `text` command cycle" as the owner, and Q-021 option (a) (the ruled one) describes exactly this
   file. Reconciling the tags without the file existing would cite a file that isn't there. Wiring
   is a separate, larger slice (load-bearing `document.ts`, a signature change through
   `executeCommand`) — kept out deliberately.

## Verification (real output)

```
$ npm run typecheck
> tsc --noEmit && tsc --noEmit -p tsconfig.engine.json
(clean, no output — both configs)

$ npx vitest run
 Test Files  30 passed (30)
      Tests  1418 passed (1418)
```

0 skipped, 0 `.only` (`grep -rnE "\.(only|skip|todo)\(" src/` -> nothing).
Test count: 1399 -> 1418 (+19): all in the new `src/render/measure.test.ts`. No other test file's
count moved (the `PROVISIONAL(Q-021)` -> `D-120` swaps are description text only).
Test files: 29 -> 30 (+1, `measure.test.ts`).

Diff, `git diff --cached --numstat` (src only): **+392 / −34 across 9 files** (2 new, 7 modified) —
`measure.ts` +188, `measure.test.ts` +162, `eval-context.ts` +17/−15, `text.ts` +9/−7, `main.ts`
+6/−2, `schema.ts` +3/−3, and three test files +3/−3 or +1/−1 each (label swaps).

Mutation-check: replace `layOutLines`'s `if (wrapWidth === undefined) { return hardLines; }` with an
unconditional `return hardLines` (wrap disabled) -> **exactly 3 red** in `measure.test.ts`
("greedily wraps a hard line to fit maxWidth", "puts a word wider than maxWidth alone on its line",
"wraps each hard line independently"); the other 16 stay green. Restored, 19/19.

## Acceptance criteria status

Phase 5 criterion ("a text box reading `Radius: {= table_x.A1 }{? … }` updates both its number and
its branch … **wraps at its set width** … and re-renders when a value referenced only inside the
currently non-taken branch changes") — **NOT YET.** The wrapping half now has a real, tested
implementation (`render/measure.ts`), but it is not wired into any `mutate` caller, so
`measuredHeight` still reports `#MEASURE` and nothing draws text. Demonstrated (unit level):
`measure.test.ts` "greedily wraps a hard line to fit maxWidth, growing the height".

## Where I got stuck / what is unfinished

- **`measure.ts` has zero consumers.** It is a "module plus its tests" slice (PROCESS_BRIEF §3) and
  the concrete thing D-120's reconciliation note names, but nothing calls it until the wiring slice.
  The value now: the wrap algorithm the Phase 5 gate leans on, and the `eval-context.ts` contract
  it must honour, are pinned and reviewable before the render/threading work builds on them.
- **Markdown markup is measured verbatim** (`**bold**`, `# heading` count toward the string).
  §5.6 says `measuredHeight` is "from `resolvedContent`", which holds the markup; stripping it is a
  markdown-aware measurer's job, and D-120's "the measurer's job" framing allows a later cycle to
  add that. Not decided here; flagged in `measure.ts`'s NOT DONE HERE.
- **`main.ts:92`'s stale rationale is only half-fixed.** I corrected the bullet about injecting a
  measurer (my work made it stale); the broader "nothing evaluates text yet" framing there was
  already falsified by 0127/0129 and is that batch's debt, not mine — but the bullet I touched now
  reads true.
- **`eval-context.ts` line ~32** ("A document with real `text` objects is meant to get a
  Canvas2D-backed measurer instead") is still accurate (wiring is unbuilt) — left as-is.

## Open questions raised

None. Q-021 is answered (D-120) and reconciled by this cycle.

## Review point

Fired: **none — batching.** Cycles since last review: 1/3. Diff 392 lines / 9 files (cap 800/10).

- §6.1 trigger 2 (first file of a new subsystem) — considered and **not claimed**: `render/` has
  seven reviewed files and the `TextMeasurer` interface `measure.ts` implements was designed and
  reviewed at 0124/0125. `measure.ts` extends an already-reviewed structure. Flagged for the
  reviewer below in case that reading is too generous.
- §6.1 trigger 5 (changed test expectations) — **not fired**: the `PROVISIONAL(Q-021)` -> `D-120`
  swaps are `it(...)` / doc-comment text; no assertion moved. Reconciling an answered question is
  explicitly mandated (PROCESS_BRIEF §7 clause 4), not a trigger-5 escalation.
- §6.2 — `primitives/schema.ts` (load-bearing) touched, comment-only. No later phase begins on it
  unreviewed; the Phase 5 gate review covers it.

REVIEW: NOT NEEDED
Reason: additive new module + its full test suite inside the already-reviewed `render/` subsystem,
plus the mandated Q-021 tag reconciliation (doc/comment only) — no §6.1 trigger, well under the
§6.3 cap.
Questions for reviewer:
  1. Is `render/measure.ts` "the first file of a new subsystem" (§6.1 trigger 2)? I read it as a
     new file extending reviewed `render/` against a reviewed interface, so NOT NEEDED — confirm, or
     was REVIEW: REQUIRED the honest call for a file that establishes the wrap algorithm the Phase 5
     gate depends on?
  2. Whitespace collapsing in wrap (Decision 2) and the blank-font `sans-serif` fallback
     (Decision 3) — both within D-120's "the measurer's job" grant. Acceptable, or does either want
     a different call?
  3. Building `measure.ts` unwired (Decision 5) — right sequencing, or should the wiring have come
     in the same cycle despite the load-bearing `document.ts` signature change it needs?
