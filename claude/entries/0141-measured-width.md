# 0141 — measuredWidth: D-123 built, Q-024 reconciled
Date: 2026-09-01   Phase: 5   Model: Opus 5 (implementer)
Previous entry: 0140-RULINGS-phase5   Last review: 0139-REVIEW-phase5 (verdict: ACCEPT WITH EDITS)
Batch: cycle 1 of up to 3 since last review; ~429 lines added / 118 removed across 14 files.

## Declared scope

Build **D-123**: `TEXT_SCHEMA` gains a third derived slot, `measuredWidth`, computed from the same
`TextMeasurer.measure` call `measuredHeight` already makes, and `render/extent.ts`'s `textExtent`
reads it for the auto-width case. Remove every `PROVISIONAL(Q-024)` tag. Nothing else.

## Explicitly not in scope

D-125 (in-place text entry) and D-124 (`text` placed by pointing) — the human's priority, and the
next cycle's work; this one is the prerequisite 0140 named, because D-125's overlay is positioned
from the box fixed here. Markdown-lite rendering, `overflow` clip/ellipsis, the Phase 5 gate test.
D-109 clauses 1–2, D-104, D-108. The `#MEASURE`-vs-fallback style divergence between `measure.ts`
and `renderer.ts` (0139-REVIEW's disclosed problem) is untouched — it needs a ruling on which file
owns the fallbacks, and D-123 does not give one.

## What I did

**`src/engine/primitives/text.ts` (§5.6, D-123).** Added `TEXT_MEASURED_WIDTH_PATH`. Extracted the
body of `computeMeasuredHeight` into a private `measureTextBox(object, read, context, slotLabel)`
returning either `{ ok: true, width, height }` or `{ ok: false, error }`; `computeMeasuredHeight`
and the new `computeMeasuredWidth` are now two three-line pass-throughs over it, each taking its own
component. `slotLabel` is what puts the right slot name in an error message. Headers and the
derived-path constants' doc updated to say three derived slots, not two.

**`src/engine/primitives/schema.ts` (§6.2 load-bearing).** `TEXT_SCHEMA.derivedSlots` gains a third
entry, `measuredWidth`, with the same `static` dependency list `measuredHeight` has
(`resolvedContent`, `width`, `style.font`/`fontSize`/`lineHeight`) — D-123 clause 1. Its doc comment
now covers the pair as one measurement and states why `measuredWidth` is the one derived slot §5.6
does not name.

**`src/render/extent.ts` (D-123 clause 3).** `textExtent`'s width now reads, in order: the `width`
slot when positive-finite → `measuredWidth` when positive-finite → `TEXT_AUTO_BOX_WIDTH`. Both axes
now have the identical three-source shape. Both `PROVISIONAL(Q-024)` tags are gone; the two
constants survive as ordinary documented fallbacks for the no-real-measurer (`#MEASURE`) case, which
is what the header and their doc comment now say.

**`src/render/hittest.ts`** — the third `PROVISIONAL(Q-024)` mention (in its NOT DONE HERE), now
describing the real mechanism. **`src/engine/graph/node.ts`** — `#MEASURE`'s doc names both computes.
**`src/command/commands.ts`** — `createText`'s doc said "both derived placeholders"; it is three now,
and it names why `measuredWidth` is the normal path (`DEFAULT_TEXT_WIDTH` is `"auto"`).

**Test fixtures (six files).** Every hand-built `text` object that goes through `mutate` needed a
`measuredWidth: { kind: "derived", value: null }` placeholder — without it D-018 refuses the object,
which is exactly the check working. `mutation.test.ts`, `commands.test.ts`, `main.test.ts`,
`document.test.ts`, `interaction.test.ts`. `schema.test.ts`'s `text` expectation moved from two
derived slots to three and now asserts the two static dependency lists are identical.

**New tests (13).**
- `text.test.ts` — a `computeMeasuredWidth` block (8): returns `.width`; takes its width from the
  same measurement the height comes from; `#MEASURE` under the null measurer and under
  `context === undefined`, with the message naming `measuredWidth`; `maxWidth` still threaded
  (D-120); upstream-error and `#TYPE` ordering identical to the height's; **the pair never splits** —
  a non-finite width `#TYPE`s both slots and so does a non-finite height; non-string
  `resolvedContent` measures `""`.
- `mutation.test.ts` (3) — `measuredWidth` is `#MEASURE` end-to-end through `mutate` alongside
  `measuredHeight`; it subscribes to the same five sources (asserted as set equality against
  `measuredHeight`'s, not a second hand-written list); a missing `measuredWidth` placeholder is
  refused by D-018.
- `commands.test.ts` (1) — a `text` object created with a real measurer threaded carries a real
  `measuredWidth`, on the default `width: "auto"` path.
- `hittest.test.ts` (4+1) — the two operator-visible defects D-123's rationale names are now pinned:
  a short auto-width label no longer swallows a click 100 units to its right, and a long one is
  clickable past 240; the `width` slot the operator SET still wins over `measuredWidth`; a
  `#MEASURE` `measuredWidth` still lands on the fallback; and `documentExtent` (what `fit` frames)
  bounds an auto-width object by its measurement.

## Decisions I made

**One shared `measureTextBox` rather than two parallel computes.** D-123 clause 2 says the pair's
failure order must mirror exactly and forbids "one of the pair succeeding while the other fails."
Two functions with two copies of a five-step failure ladder satisfy that only while someone keeps
them in step by hand — the D-119 hazard, and here there was no reason to accept it. One helper makes
it true by construction and the compiler enforces it.

**That widened `measuredHeight`'s non-finite guard, deliberately.** It previously checked only
`.height`; it now `#TYPE`s if EITHER component is non-finite. So a (buggy) measurer returning
`{ width: NaN, height: 20 }` now makes `measuredHeight` `#TYPE` where it used to return `20`. This
is a behaviour change to a reviewed function, made because clause 2 requires it — the alternative is
`measuredWidth` erroring while `measuredHeight` reports a good number off the same broken
measurement. Pinned by a test that names the rule. **Flagging it for the reviewer explicitly**; no
existing test changed expectation (the two non-finite tests already used a finite `width: 0`).

**`slotLabel` as a plain string parameter, not a path or an enum.** It only ever reaches a message.
A path would invite `slotKey`-inverting, which D-010 rules out.

**Fallback constants kept, not deleted.** D-123 clause 3 says the fallback survives for the
`#MEASURE` / no-measurer case as an ordinary constant. `TEXT_AUTO_BOX_WIDTH`/`_HEIGHT` are unchanged
in value; only their doc comment and their `PROVISIONAL` status moved.

## Verification (real output)

```
$ npx tsc --noEmit
--- default config exit: 0
$ npx tsc -p tsconfig.engine.json --noEmit
--- engine config exit: 0

$ npm test
 Test Files  30 passed (30)
      Tests  1482 passed (1482)
   Duration  1.28s
```

1469 → 1482 tests (+13). Zero skipped, zero `.only` (grepped). Both configs clean.

## Acceptance criteria status

Phase 5 criterion ("a text box reading `Radius: {= table_x.A1 }{? table_x.A1 > 50 } — **LARGE**{:} —
small{?}` updates both its number and its branch as the cell changes, wraps at its set width, **and
re-renders when a value referenced only inside the currently non-taken branch changes**") — **NOT YET
CLAIMED.** This cycle removes the blocker D-123 placed in front of it (a knowingly-wrong bounding
box), and nothing more. Markdown-lite, `overflow`, and the gate test itself are still owed, as are
the human's D-125 and D-124, which now come first.

## Where I got stuck / what is unfinished

Nothing stuck. Two things worth being unflattering about:

1. **I did not verify the new box on screen.** Every claim here is engine-side or through
   `objectExtent`; `main.ts`'s `start` is untested by construction (D-001), so "an auto-width label's
   click box is now the right size in the running app" rests on the measurer wiring reviewed at 0133
   plus these unit tests, not on anyone having looked. A human running the app and clicking beside a
   short text label is the check I cannot perform.
2. **The `measure.ts` / `renderer.ts` fallback divergence is now slightly more visible and still
   unfixed.** For a loaded `text` object with a `#TYPE` style, `measure.ts` returns a zero box, so
   `measuredWidth` and `measuredHeight` are both `0`, so `extent.ts` falls back to 240×20 — while
   `renderer.ts` substitutes its own defaults and draws N lines of real ink. The box and the ink
   disagree in that one case exactly as 0139-REVIEW disclosed. D-123 clause 5 forbids "fixing" it
   from the renderer's side, and which file owns the fallbacks is still unruled, so I left it.

## Open questions raised

None. **Q-024 is now fully reconciled** — ruled (b) at 0139-REVIEW as D-123, built here, all three
`PROVISIONAL(Q-024)` tags removed (`extent.ts` ×2, `hittest.ts` ×1 — the third was in a header, not
in code, and is easy to miss with a narrow grep). Next free: **Q-025**.

## Review point

**Fired: §6.1 trigger 3** (a deliberate, ruled extension of §5.6's derived-slot list) and **§6.2**
(`primitives/schema.ts` is load-bearing; D-123's own reconciliation note requires
`REVIEW: REQUIRED`). Also **trigger 5** in the narrow sense: `schema.test.ts`'s `text` expectation
changed from two derived slots to three, and six test files gained a fixture slot — all forced by
the schema change, none weakened. Batch would otherwise be 1/3, 429 lines / 14 files.
