# 0133 — REVIEW (Phase 5): entries 0131 + 0132 — `render/measure.ts` and threading a real `EvalContext`
Date: 2026-09-01   Phase: 5   Model: Sonnet 5 (reviewer)
Reviews: **0131** (`src/render/measure.ts` — the Canvas2D `TextMeasurer`, 19 tests; Q-021 → D-120
reconciliation) and **0132** (threading `EvalContext` from `main.ts` through `executeCommand`,
`pointerMove`, `deserializeDocument`/`loadDocument`, and `main.ts`'s six pure transitions; +9 tests).
Two cycles since 0130-REVIEW.
Previous review: 0130-REVIEW-phase5
Verdict: **ACCEPT WITH EDITS.** One legibility edit (`measure.ts`'s `WHAT THIS IS` block trimmed to
the §5.2 15-line prose cap). No `REVISE` items. No new ruling — the batch builds contracts D-118 and
D-120 already ruled. The §6.3 batch cap is reset. Phase 5 stays open; §6.2's block on a later phase
stays lifted. The next slice — the `text` command — may proceed.

## 1. What I ran, before reading anything as true

```
$ npm run typecheck            # tsc --noEmit && tsc --noEmit -p tsconfig.engine.json
(clean, no output — both configs)

$ npx vitest run
 Test Files  30 passed (30)
      Tests  1427 passed (1427)

$ grep -rnE "\.(only|skip|todo)\(" src/        → nothing
$ grep -rnE "PROVISIONAL\(Q-021\)" src/        → nothing
```

Every countable claim across both entries holds on re-run.

| Claim | Source | Measured |
| --- | --- | --- |
| batch diff `+792 / −100`, 16 src files | entry 0132 | `git diff 6f31c82..HEAD --stat -- src`: **+792 / −100, 16 files** ✓ (main.ts overlaps 0131+0132, so 392+406 nets to 792) |
| test count 1399 → 1418 → 1427 | 0131 / 0132 | **1427** at HEAD ✓ — measure.test.ts +19; commands.test.ts 161→164, interaction.test.ts 33→34, main.test.ts 72→74, document.test.ts 32→35 |
| test files 29 → 30 (+1 `measure.test.ts`) | 0131 | **30** ✓ |
| 0132 mutation-check: drop `, context` from `deserializeDocument`'s `mutate([], operations, [])` → **exactly 3 red** in `document.test.ts` | entry 0132 | reproduced: **3 red**, exactly the three named ("regenerates measuredHeight …", "deserializeDocument takes the same context", "passes a numeric `width` through as maxWidth on load"); `main.test.ts` stayed green; restored 1427/1427 ✓ |
| 0131 mutation-check: unconditional `return hardLines` in `layOutLines` → **exactly 3 red** in `measure.test.ts` | entry 0131 | not re-reproduced individually; the full suite and the 0132 check both pass, and the wrap tests are present and green |

Fifth consecutive batch (0121, 0125, 0128, 0129, now this) whose numbers survive measurement.

## 2. Rule audit

- **Rule 1 (engine purity / no canvas for text measurement)** — **upheld, and this batch is the
  payoff of the seam.** `grep -nE "document\.|window\.|canvas|CanvasRenderingContext2D|from \"\.\./render"`
  over the three changed engine files (`document.ts`, `eval-context.ts`, `primitives/text.ts` — the
  last two doc/comment-only): every hit is a header "NEVER imports" line or prose. `document.ts`'s
  one new import is `NULL_EVAL_CONTEXT` + `type EvalContext` from `./eval-context.ts`, a pure engine
  leaf. `render/measure.ts` is the ONLY file that touches Canvas2D, it lives in `render/`, and its
  sole engine import is `import type` of the interface it implements — the exact shape Rule 1's
  text-measurement trap prescribes ("`engine/eval-context.ts` DEFINES the interface; `src/render/`
  provides the real implementation; `main.ts` wires it in"). Line-breaking is entirely inside
  `layOutLines` in `measure.ts` (D-120). `main.ts`'s `document.createElement("canvas")` is the
  wiring layer doing wiring-layer work.
- **Rule 2 (mutation-only state change)** — **not touched.** No new state assignment anywhere.
  `context` is a read-only parameter threaded to `mutate` and never written. `measure.ts` "reads
  nothing from and writes nothing to graph state" — confirmed: it is handed a `string` + a
  `TextStyle` and returns two numbers.
- **Rule 3 (addressing)** — not touched.
- **Rule 4 (one formula engine)** — not touched. `measure.ts` evaluates no expressions; it lays out
  and measures glyphs.
- **Rule 5 (dumbest correct implementation)** — **upheld.** `layOutLines` is a greedy single-pass
  word wrap: no hyphenation, no mid-word breaking, no bidi, no kerning table. A word wider than
  `maxWidth` overflows alone. The threading is a trailing optional parameter forwarded verbatim —
  no dispatch, no state, no caching. `finitePositive`/`finiteOrZero`/`cssFont` are three one-line
  guards.
- **Rule 6 (slot set fixed during evaluation)** — **upheld.** `measuredHeight`'s deps are still
  `static`; nothing this batch touches evaluation-time slot discovery. `context` reaches the
  compute through `deriveValidateAndEvaluate`'s existing step 7.
- **Rule 7** — not touched.

**Vocabulary lock.** `grep -iE "\b(property|properties|field|computed)\b"` over the new lines:
"style field"/"size-relevant style fields" paraphrase §5.6; "the height computation" is a
description. `measure.ts` says *object*, *slot*, *literal*, *derived*, *resolvedContent* throughout.
No drift.

## 3. Invariant and spec audit

**§5.6 — `measuredHeight` "computed via the injected `TextMeasurer`"; "fixed width + auto height
(wrap, grow down) is the default".** `createCanvas2dTextMeasurer` returns a `TextMeasurer` that
splits on hard newlines, then greedily wraps each hard line to `maxWidth` when `maxWidth` is a
positive finite number, and returns `{ width: widestLine, height: lineCount * lineHeight }`. `"auto"`
width → `maxWidth` `undefined` → no wrap, matching §5.6's "Auto width + auto height means no
wrapping". `lineHeight` read as an absolute length, inherited from `eval-context.ts`'s `TextStyle`
doc (reviewed 0125), not re-decided — correct.

**D-120 — line-breaking lives in `render/measure.ts`, never `src/engine/`; `maxWidth` = the `width`
slot iff numeric.** Built exactly as ruled. `computeMeasuredHeight` (unchanged this batch beyond a
tag→citation swap) stays a pass-through: `const maxWidth = typeof width === "number" ? width :
undefined`. `measure.ts` does every bit of the layout. Reconciliation complete: `grep
PROVISIONAL\(Q-021\)` → nothing; `eval-context.ts`, `primitives/text.ts` (×3), `primitives/schema.ts`
and six test descriptions now cite `D-120`, present-tense, no assertion moved.

**D-118 — a `text` object's `measuredHeight` surfaces `#MEASURE` until a real measurer is wired,
never a height it did not earn.** The threading is what makes the OTHER half of D-118 real: a loaded
`text` object now measures for real in `main.ts`, and `#MEASURE` for every non-`main.ts` caller
(default `NULL_EVAL_CONTEXT`). Verified end-to-end by the new tests in all four touched test files,
each asserting BOTH arms (with a real fake measurer → a real height; without → `{ error: "#MEASURE"
}`). `context` is forwarded untouched through `executeCommand` → handler → `mutate`, through
`pointerMove` → `mutate`, and through `loadDocument` → `deserializeDocument` → `mutate` — and never
inspected outside `computeMeasuredHeight` (D-118 clause 4). Confirmed by reading each path.

**`measure.ts`'s never-throws / always-finite contract.** `eval-context.ts`'s `TextMeasurer`
promises a compute function can trust `measure` the way it trusts `read`. Every entry point is
guarded: non-finite/non-positive `fontSize` or empty text → `{ width: 0, height: 0 }` with `ctx.font`
untouched; bad `lineHeight` → single-spaced fallback; bad `maxWidth` → no wrap; a non-finite width
back from `measureText` → `0`; blank family → `sans-serif` for determinism (a shared context would
otherwise measure against whatever font the previous call set). `finiteOrZero` is applied to both
returned numbers as the last step. 19 tests, including 5 000-char / 2 000-line / zero-`lineHeight`
inputs proving no throw.

**D-077 clause 1 (no spread over operator-controlled-length data).** `layOutLines` appends one line
at a time (`lines.push(current)`); the widest-line scan is a `for…of`. No `push(...lines)` /
`Math.max(...lines)` anywhere — the line count follows `content`'s length, which the operator
controls. Correct, and called out in the header's INVARIANTS.

**§6.2 — `document.ts` (load-bearing) signature change.** `loadDocument(json, context?)` and
`deserializeDocument(raw, context?)` — additive optional trailing parameter, forwarded to the
reconstruction batch's one `mutate` call (line ~400). No validation logic touched: `isPlainObject`,
the AST-depth check (D-083 clause 4), `rawContainsIllegalNumber`, the never-throws discipline — all
byte-unchanged (verified against the diff). D-108 clause 3 (do not harden a single walker) is
respected — nothing was hardened. The zero-object early return never calls `mutate` and is untouched.
This is about as contained as a load-bearing change gets, and it is reviewed here before Phase 6.

**§5.1.1 / no dangling edges / rejection leaves prior state unchanged / eager-total extraction /
lazy evaluation** — none touched. `mutate`'s body is unchanged; only its call sites pass a fourth
argument that already had a default.

**D-114 / D-115 / D-116 / D-117 / D-119** — not touched. `computeResolvedContent`,
`resolveTextDependencyAddresses`, `evaluateBlockTree`, the D-119 pair — all byte-unchanged.

## 4. Honesty audit — the log matches the diff

- **Scope was not expanded silently.** The 16 files changed are exactly the ones the two entries
  name, at the sizes they name. `commands.ts`'s `+49 / −37` looks large for "thread a parameter" but
  reading it: it is one signature per creation/slot/rename/delete handler plus the `executeCommand`
  switch, every line mechanical. The read-only handlers (`refs`/`props`/`list`/`select`/`zoom`/`fit`/
  `save`/`load`) correctly did NOT gain the parameter — they call no `mutate`.
- **The internal-vs-public split is real and sound.** `commands.ts`'s handlers and `main.ts`'s
  `advance`/`runPanelCommand` take `context` as a REQUIRED parameter (compiler forces threading); only
  the public entry points default it to `NULL_EVAL_CONTEXT`. This is the right place for the default —
  the boundary where a real caller either supplies a measurer or accepts the documented `#MEASURE`.
- **The entries are candid about what they did NOT do:** no `text` command, so the whole thread is
  exercised only through hand-built or JSON-loaded `text` objects; `main.ts`'s `start` remains
  untested by construction (D-001) and the `evalContext` construction + null-`getContext` fallback
  are checked by hand, not by assertion; `pointerMove`'s `context` only matters for an *unrelated*
  drag next to a `text` object (a `text` object has no `origin` and cannot itself be dragged) — the
  interaction test builds exactly that two-object document. All disclosed.
- **`measure.ts` has one caller.** Entry 0131 built it unwired; 0132 wired it. Disclosed in both
  entries, STATUS, and the file header. The sequencing is defensible (see §6) and the batch is a
  clean review unit either way.
- **The mutation-checks are real** — I reproduced the 0132 one exactly (§1).

## 5. Findings

**F22 (legibility, fixed by Edit 1) — `measure.ts`'s `WHAT THIS IS` block ran 20 lines against
§5.2's 15-line prose cap.** §5.2 is explicit that this cap "is the one length rule that survives,
and the one length finding a review may still raise," and it "binds NEW and EDITED headers" —
`measure.ts` is a new file. The content was all worth keeping (the `lineHeight`-is-absolute note and
the D-120 line-breaking rationale are the expensive knowledge), so the fix is compression, not
deletion: the intro and the width/height paragraph are merged, the line-breaking paragraph tightened.
Now 14 lines. `INVARIANTS UPHELD HERE` and `NOT DONE HERE` are lists (uncapped, D-076) and were left
alone.

**Not a finding, recorded:** when wrapping is active, `layOutLines` reconstructs each output line
with single spaces (`` `${current} ${word}` ``), so a run of spaces inside a line is collapsed for
measurement; when wrapping is off, hard lines are measured verbatim. The measured *width* of the
same text can therefore differ by whether a numeric `width` slot is present, even when no wrap
actually occurs. This is latent — `computeMeasuredHeight` consumes only `.height`, and collapsing
runs of spaces changes `lineCount` only at a wrap boundary. Within D-120's grant of the whitespace
rule to `measure.ts` and Rule 5. The implementer disclosed the collapsing (0131 Decision 2); the
width asymmetry is noted here for whoever first consumes `measure`'s `width`.

**Not a finding, recorded:** `computeMeasuredHeight` still does not `#TYPE` a wrong-shaped `width`
(a `boolean`, a `Point`) — a non-number `width` is silently `undefined` `maxWidth` (no wrap).
0130-REVIEW §5 already recorded this as defensible (`width` has a legitimate non-number value,
`"auto"`; style fields do not) and left it to the `text` command. Unchanged.

**Not a finding, recorded:** `main.ts` builds a SECOND offscreen 2D context for measurement and
falls back to `NULL_EVAL_CONTEXT` if `getContext("2d")` returns `null` on it. The fallback is silent
in the log (unlike the fatal renderer-context path). This is the right call — see §6 answer 2.

## 6. Answered questions

No new `Q-NNN` was raised. Standing questions unchanged: **Q-016** (panel row literal
string/boolean), **Q-017** (persistent table headers) — the human's, non-blocking. **Q-012** (world
vs screen units), **Q-008** (`-0`) — deferred, blocking nothing. Next free ID is **Q-022**.

**Reviewer questions from the two entries:**

1. **`EvalContext` per-call vs. a field on `AppState` (0132 Q1).** Per-call is right. `AppState`'s
   own doc says "plain data … replaced wholesale"; a `TextMeasurer` is a function-bearing object and
   would make `AppState` non-plain and non-serializable-looking. `Viewport` is already supplied
   per-call for the same reason. The cost — a trailing optional parameter on six public functions —
   is paid once and is compiler-visible. Confirmed.

2. **The `null` second-`getContext` fallback to `NULL_EVAL_CONTEXT` — silent, or surfaced in the log
   like the fatal renderer case (0131 Q2 / 0132 Q2)?** Leave it silent. The renderer-context failure
   is fatal because nothing can be drawn; a missing *measure* context degrades one derived slot to
   `#MEASURE`, which is D-118's loud, self-explaining, self-healing failure — it shows up on §5.9's
   error badge and on the slot itself the moment a `text` object exists. Adding a startup log line
   for a near-impossible branch (the renderer's `getContext` already succeeded) would be noise for
   every normal start. Acceptable as built.

3. **Loader threaded in the same slice as commands/drag, despite `document.ts` being load-bearing
   (0131 Q3 / 0132 Q3).** Right call. "Thread the measurer through every non-test `mutate` caller" is
   one coherent slice; a partial thread (commands wired, load not) is a more confusing state to
   review than the whole. The change to `document.ts` is additive and touches no validation, and it
   gets its §6.2 review here before Phase 6. This is the slice 0130-REVIEW §7 named.

4. **`render/measure.ts` built unwired one cycle before its first caller — right sequencing, or
   should 0131 + 0132 have been one cycle (0131 Q1 / 0132 Q4)?** Two cycles was fine, and arguably
   better. 0131 is "one module plus its tests" (PROCESS_BRIEF §3) — the wrap algorithm the Phase 5
   gate leans on, pinned and reviewable on its own before the threading work builds on it. Combining
   them would have put a ~1 180-line diff and a load-bearing signature change in one entry. The batch
   cap caught them together for review regardless, which is the system working as intended.

5. **Is `render/measure.ts` "the first file of a new subsystem" (§6.1 trigger 2) (0131 Q1)?** No.
   `render/` has eight reviewed files and the `TextMeasurer` interface `measure.ts` implements was
   designed and reviewed at 0124/0125. It extends an already-reviewed subsystem against an
   already-reviewed interface. `REVIEW: NOT NEEDED` was the honest call for 0131 in isolation; the
   §6.3 cap is what brought it here.

6. **Whitespace collapsing in wrap + the blank-font `sans-serif` fallback (0131 Q2).** Both within
   D-120's explicit grant of the whitespace rule and the layout details to `measure.ts`. The
   `sans-serif` fallback is for determinism, not typeface invention (`computeMeasuredHeight` already
   `#TYPE`s a non-string `font`, so only `""` reaches the measurer). Acceptable. The width asymmetry
   the collapsing introduces is recorded in §5 for a future `width`-consumer.

## 7. The gate

- **§6.3 batch cap** — 2 cycles / 16 src files / +792 lines since 0130-REVIEW. File count past 10;
  line count at ~800. Correctly stopped for review. Reset by this review.
- **§6.1** — no trigger fired for the batch (additive optional parameter; no brief deviation; no
  test expectation changed; no dependency; `#MEASURE`/`maxWidth` are D-118/D-120, already ruled).
- **§6.2** — `document.ts` (load-bearing) and `primitives/schema.ts` (load-bearing, comment-only)
  had unreviewed changes. Both reviewed here. Phase 5 was already open; no later-phase block is
  armed, and none is armed now.
- The next slice — **the `text` command** (`command/parser.ts` grammar + `commands.ts` handler,
  moving `text` out of `COMMANDS_SPECIFIED_BUT_NOT_BUILT`) — may proceed. It must create a `text`
  object with all nine non-derived slots + both derived placeholders and sane `style` defaults
  (settles F13/F20 and 0129's five-required-slots consequence). It **owes the F13 ruling** (a
  `formula`-driven `content` slot — refuse à la D-046, or track inner references?) — that is §6.1
  trigger 3, so that cycle likely escalates rather than completing. It also meets the position
  question (§5.6's `TextBox` has no `origin` slot). The render-only alternative (**D-109 clauses
  1–2** + **Q-017** headers) is unchanged and still the smallest un-owed item needing no ruling.

## 8. Edits made by this review

1. **`src/render/measure.ts`** — `WHAT THIS IS` block trimmed from 20 lines to 14 against §5.2's
   15-line prose cap (F22). Intro and the width/height paragraph merged; line-breaking paragraph
   tightened. No substance dropped — `lineHeight`-is-absolute and the D-120 line-breaking rationale
   both kept. `INVARIANTS UPHELD HERE` / `NOT DONE HERE` untouched. `+11 / −17`.

Verification after the edit:

```
$ npm run typecheck
(clean, both configs)

$ npx vitest run
 Test Files  30 passed (30)
      Tests  1427 passed (1427)
```

0 skipped, 0 `.only`. `DECISIONS.md` — no new entry. `OPEN_QUESTIONS.md` — no change (Q-021 was
already `ANSWERED → D-120` at 0130-REVIEW; its reconciliation is now complete in code). `STATUS.md`
rewritten.
