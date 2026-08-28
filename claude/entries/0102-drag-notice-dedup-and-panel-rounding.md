# 0102 — D-098's per-gesture notice dedup + D-099's panel-only rounding
Date: 2026-08-28   Phase: 4   Model: Claude Sonnet 5
Previous entry: 0101-vanishing-table-fix   Last review: 0100-REVIEW-phase4 (verdict: ACCEPT)
Batch: cycle 2 of up to 3 since last review; 273 insertions / 18 deletions across 6 files this
cycle — CUMULATIVE since 0100-REVIEW: 626 insertions / 51 deletions across **11 files**, which
trips §6.3's ~10-file cap (line count, 677, stays under the 800 cap). See "Review point" below.

## Declared scope

Build D-098 and D-099 exactly as ruled, per STATUS.md's "Next cycles" item 2 — the two D-103
names as "small, independent, unrelated to each other." D-098: `interaction.ts`'s `DragState`
gains a per-gesture set of already-emitted notice text, deduplicated in `pointerMove`, reset by
`pointerDown`, discarded by `pointerUp`. D-099: `props.ts`'s `describeSlotValue` gains an optional
`maxDecimals` argument; `main.ts`'s `buildPanelModel` is the one caller that passes `{maxDecimals:
4}`. Not in scope: D-100 through D-103, or anything else on STATUS.md's queue.

## Explicitly not in scope

D-098's "the human may overrule toward a timer" alternative — not built, per the ruling's own
text (a wall clock would need `Date.now()` inside a pure, deterministic transition; nothing here
asks for that unless overruled). `renderer.ts`'s `formatCellValue` — D-099 clause 5 keeps it a
disclosed, deliberate second formatter; touching it needs its own ask.

## What I did

- **`src/render/interaction.ts`** (D-098, §5.9's non-blocking feedback):
  - `DragState` gains `emittedNotices: readonly string[]` — a plain array (matching every other
    notice collection in this file), not a `Set`: a gesture drags at most two components, so
    there is no volume needing a hash structure, and a plain array keeps `DragState` comparable
    with `toEqual` the way test fixtures elsewhere already are.
  - `pointerDown` initialises every gesture's `emittedNotices` to `[]`.
  - `pointerMove` computes this step's plan notices BEFORE calling `mutate` (a skipped
    component's notice is about that component alone, independent of whether some OTHER
    component's mutation commits), filters against `drag.emittedNotices` via a new
    `widenEmittedNotices` helper, and returns only the FRESH ones in `PointerMoveOutcome.notices`
    while widening the advanced state's `emittedNotices`. The widening happens on BOTH the
    success path and the `mutate`-rejection path (D-098's own "scope" clause: only the rejection
    MESSAGE is never deduplicated, not the skipped-component notices beside it) — but when a
    rejected step has NOTHING fresh to fold in, the exact incoming `state` reference is returned
    unchanged, preserving the pre-D-098 `toBe` identity a pinned test in `interaction.test.ts`
    already asserted.
  - `pointerUp` is unchanged — ending the drag already discards the whole `DragState`, taking
    `emittedNotices` with it.
- **`src/command/props.ts`** (D-099, the panel's display-only rounding):
  - `describeSlotValue(value, options?: { readonly maxDecimals?: number })` — one switch, same as
    before, with a new `formatDisplayNumber` helper called for a bare `number` and for each
    component of a `Point`. Boolean is now its own arm (previously shared with `number`), since
    only NUMBERS round.
  - `formatDisplayNumber`: `maxDecimals` absent, or the value non-finite (D-099 clause 4 — dead
    code today, since D-025 keeps a non-finite number out of a `Value` entirely, but `toFixed`/
    `toExponential` both throw on `NaN`/`±Infinity`, so it stays guarded rather than assumed
    away) → plain `String(value)`, byte-identical to before this option existed. Otherwise:
    `toFixed(maxDecimals)` then a round-trip through `Number`/`String`, which trims trailing
    zeros for free (a JS number's default string form never carries one) — EXCEPT when that
    rounds a genuinely non-zero value to `0`, which reports in exponential form instead, at the
    same precision (D-099 clause 3).
  - `n points` summary, the table `cells` summary string, error text, and string-quoting are
    untouched (clause 4) — `maxDecimals` never reaches any of those branches.
- **`src/main.ts`** — `buildPanelModel` now calls `describeSlotValue(descriptor.value,
  { maxDecimals: 4 })`, the ONE call site D-099 authorises. `PanelRow`'s own doc comment updated
  to say so.
- **Tests** — `interaction.test.ts`: three new cases (repeated notice deduped across pointerMove
  samples while the underlying per-component behaviour keeps working; a genuinely DIFFERENT
  notice text — the operator re-links mid-gesture — still surfaces; a NEW gesture after
  `pointerUp`/`pointerDown` re-surfaces the same text). `props.test.ts`: a `describeSlotValue`
  block pinning byte-identical no-option output, rounding+trimming, the exponential fallback for
  a non-zero-rounds-to-zero value, exact zero staying plain, per-component `Point` rounding, and
  every other `Value` variant staying untouched. `main.test.ts`: one end-to-end case — `circle
  x=10 y=20 r=7`'s real `centroid.x` (`10.000000000000002`, read off the actual computed value,
  not guessed) rounds to `"10"` in the panel while the same slot's `props circle_1` line keeps
  full precision, pinning D-099 clause 5's disclosed divergence end to end.

## Decisions I made

- **D-098's dedup key is notice TEXT, not which component produced it** — the ruling's own
  wording ("a notice whose TEXT differs... is a new notice"), and the "re-link mid-gesture" test
  exists specifically because two DIFFERENT drivers could in principle render identical text,
  which text-based dedup would (correctly, per the ruling) still collapse.
- **The rejection-path `toBe` identity is preserved as a special case** rather than always
  rebuilding a new `InteractionState` object: an existing pinned test in `interaction.test.ts`
  asserts `rejected.state).toBe(state)` for a mutate-rejected drag with no notices in play, and
  D-098 gives me no reason to break that guarantee when there is genuinely nothing fresh to add —
  only when a fresh notice actually needs folding in does a new object get built.
- **`toFixed` → `Number` → `String` for rounding+trimming**, rather than a hand-rolled
  string-trim: a JS number's own default `toString` never carries a trailing zero, so round-
  tripping through `Number` does the trimming as a side effect of the representation itself,
  with no regex or string surgery to get wrong.
- **`value.toExponential(maxDecimals)` for the "rounds to zero" fallback**, reusing the SAME
  precision argument rather than a separate constant — this reproduces the ruling's own worked
  example (`1.2246e-16`) exactly when `maxDecimals` is 4, which is a good sign the reading is
  right rather than a coincidence I'm relying on.

## Verification (real output)

```
$ npx tsc --noEmit
(clean, no output)
$ npx tsc --noEmit -p tsconfig.engine.json
(clean, no output)
$ npm test
 Test Files  27 passed (27)
      Tests  1215 passed (1215)
$ npm run build
✓ 32 modules transformed.
✓ built in 256ms
```

Mutation-checked both changes before calling this done:

- **D-098**: replaced `widenEmittedNotices`'s filter with a pass-through (`const fresh =
  notices;`). Two of the three new `interaction.test.ts` cases correctly failed (repeated-notice
  dedup, and the same-text-dedupes-again tail of the relink case); the "new gesture re-surfaces
  the notice" case correctly did NOT fail, since that assertion holds with or without dedup
  (it's testing the RESET, not the dedup). Restored the real filter, re-ran: 1215/1215 again.
- **D-099**: replaced `formatDisplayNumber`'s `Number(value.toFixed(maxDecimals))` with the raw
  `value` (no rounding). Four tests correctly failed — three in `props.test.ts` (rounding+
  trimming, the exponential fallback, per-component `Point` rounding) and the one end-to-end case
  in `main.test.ts` — while the byte-identical-with-no-options and exact-zero cases correctly
  stayed green. Restored the real line, re-ran: 1215/1215 again.

## Acceptance criteria status

Not a phase-gate cycle. No PROJECT_BRIEF acceptance criterion is claimed here; D-098/D-099 are
reviewer rulings from the human's 0100 session, both now PASSING, demonstrated by the pinned
tests above (mutation-checked, not merely present).

## Where I got stuck / what is unfinished

One real gap I found and fixed rather than shipped: my first version of the "repeated notice
dedup" test moved the pointer along Y only between samples (`{x:25,y:5}` then `{x:25,y:9}`),
which meant `origin.x`'s own delta was zero on the second sample — `planComponent` skips a
zero-delta component BEFORE it can even produce a notice, so the test passed whether or not the
dedup fix existed at all (I caught this only by mutation-checking and seeing it did not flip red).
Fixed by moving x too on every sample. Left as a note in this entry because it's exactly the
"mutation-check a suite that passes first try" discipline STATUS.md's gotchas already name, and
this is a fresh instance of it.

## Open questions raised

None.

## Review point

Fired: **§6.3's file-count cap.** Neither cycle 0101 nor this one hit a §6.1 trigger on its own
(no phase gate, no new subsystem, no deviation, no changed test EXPECTATION — only mechanical
literal-shape widenings forced by `DragState`'s new field and `describeSlotValue`'s new optional
parameter — no broken hard rule, no dependency, no repeated failed attempt). But the two cycles
TOGETHER have now touched **11 distinct files** since 0100-REVIEW-phase4 (0101: `mutation.ts`,
`primitives/table.ts`, `commands.ts`, `mutation.test.ts`, `commands.test.ts`; 0102: `props.ts`,
`props.test.ts`, `main.ts`, `main.test.ts`, `interaction.ts`, `interaction.test.ts`) — over
§6.3's ~10-file cap, even though the cumulative line count (626 insertions / 51 deletions = 677)
stays under the 800-line half of that same cap. Per §6.3's "whichever comes first," the file
count is what fires here. Cycles since last review: 2/3. **REVIEW: REQUIRED** — stopping before
entry 0103 (D-100), which STATUS.md already separately flags as needing its own end-of-cycle
review point regardless.
