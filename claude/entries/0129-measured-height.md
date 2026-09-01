# 0129 — `measuredHeight`: §5.6's second derived slot, D-118's `#MEASURE` guard, Q-021 raised
Date: 2026-09-01   Phase: 5   Model: Sonnet 5 (implementer)
Previous entry: 0128-REVIEW-phase5   Last review: 0128-REVIEW-phase5 (verdict: ACCEPT WITH EDITS)
Batch: cycle 1 of up to 3 since last review; ~586 lines / 10 files changed so far.

## Declared scope

Add `text`'s second derived slot, **`measuredHeight`** (§5.6): a `static`-dependency slot on
`resolvedContent` + `width` + `style.font`/`fontSize`/`lineHeight`, whose compute
(`primitives/text.ts`'s `computeMeasuredHeight`) hands those to the injected `TextMeasurer` and
returns `.height`. Build **D-118**'s guard — a compute that can see only `NULL_EVAL_CONTEXT`'s
zero-box measurer returns `#MEASURE` (a sixth `ErrorCode`, sanctioned by D-118), never a height it
did not earn. Raise **Q-021** (§5.6 makes `measuredHeight` depend on `width` but 0124's
`measure(text, style)` interface has no width parameter) and take the reversible provisional choice
(a): widen the interface with an optional `maxWidth`, wrapping is the measurer's job.

## Explicitly not in scope

The real Canvas2D `TextMeasurer` (`render/measure.ts`) and threading a real `EvalContext` through
the non-test `mutate` callers — so `measuredHeight` reports `#MEASURE` in the running app until that
lands. The `text` command. Markdown-lite rendering, layout, actual line-breaking (it lives in the
measurer implementation now). The F13 gap (a `formula`-driven `content` slot's inner references).

## What I did

### `src/engine/graph/node.ts` (+13 / −4) — load-bearing (§6.2: `graph/*`)

`ErrorCode` gains a sixth member, **`#MEASURE`**. §5.1 enumerates five; this is the same move
**D-028** made for `formula/ast.ts`'s `ErrorNode` (not in §5.3's grammar), for the same reason —
the type system needs a case the brief's list did not foresee, and **D-118** clause 2 sanctions it
by name. It is only ever produced by a `derived` slot (`measuredHeight`), whose value is never
serialized (§5.11), so no saved document can carry it. Header rewritten to say all six and why the
sixth. No exhaustive `switch` over `ErrorCode` values exists anywhere (`grep` — every `: never`
check is over `FormulaAst` node types), so nothing else needed a case added; `isErrorValue` tests
`"error" in value`, not the code, so no runtime validation changed.

### `src/engine/eval-context.ts` (+48 / −12)

- **`TextMeasurer.measure` gains an optional 3rd parameter, `maxWidth?: number`** —
  `PROVISIONAL(Q-021)`. Optional and trailing, so every existing `measure(text, style)` call still
  type-checks and behaves identically (`NULL_TEXT_MEASURER` and the test fakes just ignore it). The
  provisional call: `width` reaches the measurer as `maxWidth` and LINE-BREAKING lives in the
  measurer implementation, not `src/engine/`.
- **`hasRealMeasurer(context)`** — new exported type guard (`context is EvalContext`): `context !==
  undefined && context.measurer !== NULL_TEXT_MEASURER`. The D-118 detector. It lives here, next to
  the private `NULL_TEXT_MEASURER`, so the "is this the null one" check is co-located rather than an
  identity compare scattered through every measuring compute — D-118 clause 3 leaves the mechanism
  to the implementer and names exactly this option. Checks the *measurer*, not the *context object*,
  so wrapping the null measurer in a fresh `EvalContext` does not sneak past.
- Header / `NULL_TEXT_MEASURER` doc / `TextMeasurer` doc / NOT DONE HERE rewritten to the built
  state: `measuredHeight` is DONE and consumes `measurer`; wrapping is the measurer's; `#MEASURE`
  until real wiring.

### `src/engine/primitives/text.ts` (+129 / −17) — reviewed subsystem

- **`TEXT_*_PATH` constants** — all nine non-derived + both derived slot paths, moved here from
  `primitives/schema.ts` to join `TEXT_CONTENT_PATH` (which already lived here since 0127).
  `text.ts` reads five of them in `computeMeasuredHeight`, so one spelling must serve both files;
  `TEXT_SCHEMA` now imports the list. (**D-096**: this is a divergence from the "compute in
  `primitives/text.ts`" slice sketch — named here, motivated by the shared-spelling need, and the
  pattern `TEXT_CONTENT_PATH` already set.)
- **`computeMeasuredHeight(object, read, context, _deps)`** — a pass-through. Reads the five declared
  slots; propagates any upstream `ErrorValue` (deterministic order, like `add`'s compute); then
  `!hasRealMeasurer(context)` → `#MEASURE` (**D-118**); then a wrong-shaped/absent style → `#TYPE`
  (fail-closed — the `text` command owns defaults); then `measure(resolvedText, style, maxWidth)`
  where `maxWidth` is the `width` slot iff numeric (`PROVISIONAL(Q-021)`; `"auto"` → `undefined` →
  no wrap, §5.6 layout). No layout logic of its own (Rule 4 posture).
- Header WHAT THIS IS / schema-wiring section / NOT DONE HERE updated: `measuredHeight` is built.

### `src/engine/primitives/schema.ts` (+72 / −57) — load-bearing (§6.2)

- Imports the `TEXT_*_PATH` constants and `computeMeasuredHeight` from `primitives/text.ts`; deletes
  the local path-constant block.
- **`TEXT_SCHEMA.derivedSlots` gains `measuredHeight`**: `static` deps on `[resolvedContent, width,
  style.font, style.fontSize, style.lineHeight]` (§5.6: "from `resolvedContent`, `width`, and
  `style`"; `color`/`align` omitted — they do not affect size, matching `TextStyle`), compute
  `computeMeasuredHeight`.
- `DerivedSlotCompute`'s doc corrected: a compute that NEEDS a measurement must not treat
  `undefined`/`NULL_EVAL_CONTEXT` as "measure as zero" — D-118 requires `#MEASURE`. Header "Scope
  today" / NOT DONE HERE updated (both `text` derived slots built).

### `src/engine/graph/eval.ts` (+6 / −5) — load-bearing (§6.2)

Header only — the `derived`-slot paragraph now says `measuredHeight` is built (`computeMeasuredHeight`,
entry 0129) and reports `#MEASURE` until a real measurer is threaded through `mutate`. No code
change: `evaluateDerivedSlot` already passes `context` through (0124) and `{ readRange, objects }`
(0127); `computeMeasuredHeight` uses `context` and ignores `deps`.

### The consequence worth stating: five `text` slots became effectively-required

`measuredHeight`'s `static` deps make `deriveEdges` emit an edge from `width`/`style.font`/
`style.fontSize`/`style.lineHeight` (and `resolvedContent`) into `measuredHeight` on every mutation.
An edge may never point at a slot that does not exist (§5.1.1, absolute), so a `text` object created
without one of those five is **refused** — the same mechanism that refuses an `add` node with no
`in.a`. This **narrows 0128's F20 observation** ("missing style slots are accepted"): the four that
feed `measuredHeight` are now required; `height`/`overflow`/`style.color`/`style.align` stay
optional (nothing computes from them). The `text` command cycle must create all nine non-derived
slots plus both derived placeholders. Pinned by `mutation.test.ts` "a text object missing a
measuredHeight input slot (style.font) is REFUSED".

## Decisions I made

1. **`#MEASURE` as a sixth `ErrorCode`, not an existing code.** `#TYPE`/`#REF`/`#SCRIPT` all
   misdescribe "no real measurer is wired" — a wiring/environment failure, not a type or reference
   or script error. D-118 clause 2 suggests `#MEASURE` explicitly, and clause 2's "widen
   `graph/node.ts`" is one of the two options it offers. Derived values never serialize, so it is
   reversible and cannot reach disk.
2. **Q-021 provisional choice (a): widen `measure` with `maxWidth?`.** The alternatives — no
   wrap-awareness (contradicts the Phase 5 gate) or an engine-side word-wrap loop (a layout
   algorithm in `src/engine/`, the exact render concern Rule 1/§9 push out) — are worse.
   `eval-context.ts` is not on §6.2's list; the parameter is optional and trailing so nothing
   existing breaks; `measuredHeight` is a `derived` slot whose value never serializes. Reversible,
   tagged at the two sites `OPEN_QUESTIONS.md` names.
3. **`#MEASURE` fires BEFORE the `#TYPE` style check, but AFTER upstream-`ErrorValue` propagation.**
   With no measurer the style shape cannot matter (nothing is measured either way), so `#MEASURE` is
   the more useful report. But an errored input (`resolvedContent`/`width`/a `formula`-driven style
   field reading `#REF`) is a real error that §5.1 propagates unconditionally, and it is reported
   first. Both orderings pinned by tests.
4. **`measuredHeight` does NOT depend on the `height` slot.** `height` is the operator's
   fixed-height/`overflow` choice; `measuredHeight` answers "how tall if it grew to fit" — a
   different question. Only `resolvedContent` + `width` + the three size-relevant style fields.
5. **Moved the `TEXT_*_PATH` constants into `text.ts`.** `computeMeasuredHeight` reads five of them;
   `TEXT_CONTENT_PATH` already lived in `text.ts` since 0127; splitting the vocabulary across two
   files is worse than either extreme. `TEXT_SCHEMA` imports the full list. Divergence named per
   D-096.

## Verification (real output)

```
$ npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.engine.json
(clean, no output — both configs)

$ npx vitest run
 Test Files  29 passed (29)
      Tests  1398 passed (1398)
```

0 skipped, 0 `.only` (`grep -rnE "\.(only|skip|todo)\(" src/` → nothing).
Test count: 1375 → 1398 (+23): `text.test.ts` 64→74 (`computeMeasuredHeight`, 10),
`eval.test.ts` 28→34 (`measuredHeight` end-to-end, 6), `mutation.test.ts` 203→207 (through `mutate`,
4), `eval-context.test.ts` 4→7 (`hasRealMeasurer` + `maxWidth`, 3). `schema.test.ts` unchanged in
count — the `text` entry-shape test was widened in place (§6.1 trigger 5, see Review point).

Diff, `git diff --numstat` (src only): **+586 / −101 across 10 files** —
`text.ts` +129/−17, `mutation.test.ts` +101/−2, `eval.test.ts` +92/−0, `text.test.ts` +96/−0,
`schema.ts` +72/−57, `eval-context.ts` +48/−12, `eval-context.test.ts` +19/−1, `node.ts` +13/−4,
`schema.test.ts` +10/−3, `eval.ts` +6/−5.

Mutation-checks (both against the committed implementation, restored after):
- **D-118 threading / clause 5** — change `graph/eval.ts`'s `evaluateDerivedSlot` to pass
  `NULL_EVAL_CONTEXT` instead of `context` → **exactly 3 red**, all in the `measuredHeight`
  end-to-end block, all the ones needing a real measurer ("threads a real (fake) measurer",
  "PROVISIONAL(Q-021): numeric width reaches maxWidth", "measures resolvedContent AFTER the embedded
  formula resolves"). The `#MEASURE` tests stay green — they assert `#MEASURE` regardless. This is
  the end-to-end proof that `context` is threaded at all (0124's identified test).
- **D-118 guard** — disable `computeMeasuredHeight`'s `!hasRealMeasurer(context)` branch → **exactly
  6 red**: every test asserting `#MEASURE` (3 in `text.test.ts`, 2 in `eval.test.ts`, 1 in
  `mutation.test.ts`) now gets a height off the zero-box measurer instead. Pins "measured non-empty
  text, got 0, returned 0 is not acceptable" (D-118).

## Acceptance criteria status

Phase 5 criterion ("a text box reading `Radius: {= table_x.A1 }{? ... }` updates both its number
and its branch ... **wraps at its set width** ... and re-renders when a value referenced only inside
the currently non-taken branch changes") — **NOT YET.** `measuredHeight` is now a real derived slot
ordered correctly in the topological pass (after `resolvedContent` and after any `formula`-driven
`width`/`style` field), and it is width-aware through `maxWidth`. What the gate still needs: a real
`TextMeasurer` (`render/measure.ts`), that context threaded through `mutate`, and `render/`'s
actual drawing/wrapping. Demonstrated (partial): `eval.test.ts` "threads a real (fake) measurer ...
returns its height" and "PROVISIONAL(Q-021): a numeric `width` slot reaches the measurer as
maxWidth".

## Where I got stuck / what is unfinished

- **`measuredHeight` reports `#MEASURE` for every real document today**, because no `mutate` caller
  threads a real context. That is D-118 working exactly as ruled — a loud error beats a silent
  zero — but it means the slot is not *useful* until `render/measure.ts` + the context-threading
  cycle land. The value in building it now is that the schema entry, the edge wiring, the topological
  ordering, and the `#MEASURE`/`#TYPE`/propagation contract are all pinned and reviewed before the
  render work leans on them.
- **Q-021 is a provisional choice, not a ruling.** If the human rules (c) (engine-side wrap),
  `computeMeasuredHeight`'s body changes and `maxWidth` comes off the interface; if (b) (no
  wrap-awareness), `maxWidth` and the `width` dependency both come off. Two sites tagged.
- **The five-slots-now-required consequence** (above) is real and I did not spend a cycle making it
  explicit anywhere but the schema declaration + a test + this entry + STATUS. The `text` command
  cycle owns making it a non-issue (create the slots). A reader who hand-builds a `text` object and
  omits `style.lineHeight` gets a refusal whose message names the dangling edge, which is
  informative but not obvious.
- **Markup still counts toward measurement.** `computeMeasuredHeight` measures `resolvedContent`
  verbatim, `**bold**`/`# heading` markers included, because §5.6 says "from `resolvedContent`" and
  markdown parsing is `render/`'s. The real measurer may strip markup later; not this cycle's call.

## Open questions raised

**Q-021** — how `measuredHeight` becomes width-aware given `measure(text, style)` has no width.
Provisional choice **(a)**: widen to `measure(text, style, maxWidth?)`, wrapping is the measurer's
job. Reversible (`eval-context.ts` not §6.2; optional trailing param; derived value never
serialized). Tagged at: `src/engine/eval-context.ts` (`TextMeasurer.measure`'s `maxWidth`),
`src/engine/primitives/text.ts` (`computeMeasuredHeight`, the `width` → `maxWidth` line).

## Review point

Fired:
- **§6.1 trigger 3** — a brief inconsistency on something load-bearing (§5.6 vs. Rule 1's
  `TextMeasurer` interface — Q-021), and a brief deviation (`#MEASURE` not in §5.1's `ErrorCode`
  list). Q-021's provisional choice is reversible and tagged; `#MEASURE` is pre-sanctioned by D-118
  clause 2, not an unratified deviation.
- **§6.1 trigger 5** — `schema.test.ts`'s `text` entry-shape test asserted "one derived slot,
  resolvedContent" and now asserts two; `mutation.test.ts`'s 0127 `textObject` helper was widened
  (minimal → well-formed) so the 0127 tests keep exercising what they mean to. Both are the honest
  consequence of adding `measuredHeight`, and neither weakens anything (the schema test is stricter;
  the 0127 helper more complete).
- **§6.2** — load-bearing `graph/node.ts` and `primitives/schema.ts` touched.

Batch: cycle 1/3, diff 586 lines / 10 files (cap 800/10).

REVIEW: REQUIRED
Reason: §6.1 trigger 3 (Q-021 + `#MEASURE`), trigger 5, and §6.2 load-bearing files; a new
`ErrorCode` and a new interface parameter both deserve a reviewer's eyes.
Questions for reviewer:
  1. Q-021 provisional choice (a) — widen `measure` with `maxWidth?`, wrapping in the measurer.
     Acceptable pending the human, or should the interface question go to the human before ANY
     `measuredHeight` code (i.e. was proceeding right)?
  2. `#MEASURE` as a sixth `ErrorCode` vs. reusing `#TYPE` — D-118 c2 suggests `#MEASURE`; confirm
     the brief-list widening is within D-118's sanction and not its own escalation.
  3. Making `width`/`style.font`/`style.fontSize`/`style.lineHeight` effectively-required on a
     `text` object (via `measuredHeight`'s static deps → dangling-edge refusal). Right call, or
     should `measuredHeight`'s deps be `dynamic` and tolerate an absent input slot?
  4. `#MEASURE` fires before the `#TYPE` style check but after upstream-error propagation — is that
     the ordering you want?
