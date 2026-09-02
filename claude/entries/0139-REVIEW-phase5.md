# 0139 — REVIEW (phase 5): entry 0138's text rendering — `drawText`, `textExtent`, the text hit box
Date: 2026-09-01   Phase: 5   Model: Opus 5 (reviewer)
Reviewing: entry 0138-text-render (1 cycle, ~290 source lines / 4 source files)
Previous review: 0137-REVIEW-phase5 (ACCEPT WITH EDITS)

Verdict: **ACCEPT WITH EDITS.** One new binding ruling: **D-123** (answers **Q-024**).

## Verification (re-run, not read)

```
$ npx tsc --noEmit                          -> clean, no output
$ npx tsc --noEmit -p tsconfig.engine.json  -> clean, no output
$ npx vitest run                            -> Test Files 30 passed (30)
                                               Tests     1466 passed (1466)
$ grep -rn "\.only|\.skip|it\.todo" src --include=*.test.ts  -> no matches
```

Matches entry 0138's pasted output exactly (30 files, 1466 tests, 1443 → 1466 = +23, zero skipped,
zero `.only`). The diff is 4 source files (`renderer.ts`, `extent.ts`, `hittest.ts`, `measure.ts`)
and 4 test files; `git diff --stat` puts the source side at ~287 changed lines against the entry's
"~330", i.e. the entry rounded UP against itself. No §6.2 load-bearing file touched — correct, and
correctly claimed.

## Rule audit

- **Rule 1 (no DOM/canvas in `engine/`)** — upheld, checked mechanically. The whole diff is
  `src/render/`. The new imports all run render → engine (`primitives/text.ts`'s `TEXT_*_PATH`,
  `geometry.ts`'s `ORIGIN_*_PATH`); nothing in `src/engine/` changed, and `primitives/text.ts`
  imports no render file. `drawText` measures with the renderer's own `ctx` — legal here, and it is
  the whole point of Rule 1's seam that this is the layer allowed to.
- **Rule 2 (mutation-only state change)** — upheld. Every new function reads `GraphObject` and calls
  `ctx` methods; there is no assignment to a slot anywhere in the diff. The `text` drag that now
  works goes through `interaction.ts`'s existing `planOriginDrag` → `mutate` path, untouched.
- **Rule 3 (addressing)** — not touched.
- **Rule 4 (one formula engine)** — upheld, and this was the place to get it wrong. `drawText` draws
  the already-evaluated `resolvedContent` string and parses nothing. No second evaluator, no
  re-resolution at paint time.
- **Rule 5 (dumbest correct implementation)** — upheld. A `for` loop over lines, `Math.max` over
  measured widths, five round untuned constants. `drawText` measures every line for `boxWidth` even
  when `align` is `left` and the number is unused; that is the correct trade here, not a defect.
- **Rule 6 (slot set fixed during evaluation)** — not touched. No slot is created or removed.
- **Rule 7 (§8 deferred list)** — upheld. Markdown-lite and `overflow` clip/ellipsis are §5.6 work,
  not §8 work, and both were correctly declared out of scope rather than half-built.

## Invariant audit

Derived-slot participation, eager/total dependency extraction, transactional rollback, dangling
edges, plain serializable state — none touched by a render-only diff.

Two render-layer invariants ARE at stake and both hold:

- **D-066 / D-010 — the drawn extent and the clickable extent are ONE extent.** `hitTestBoundingBox`
  and the `text` selection highlight both call `objectExtent`; neither builds a second box. This is
  the correct shape and it is what makes the Q-024 defect below a single-site fix rather than three.
- **Never throws.** `textExtent` and `drawText` return early on unset/non-string/empty
  `resolvedContent`, guard every numeric read through `readNumber`, and default every style field.
  An `ErrorValue` in any slot degrades that one object, never the frame.

## Spec conformance

- **§5.6 layout** — "fixed width + auto height (wrap, grow down) is the default" and "auto width +
  auto height means no wrapping" are implemented literally: `layOutLines` wraps only for a positive
  finite `width`. "Fixed width + fixed height applies `overflow`" is NOT implemented; with
  `createText`'s `overflow: "visible"` default the current behaviour is the compliant one for every
  object that exists today, and clip/ellipsis is honestly deferred.
- **§5.6 `style`** — all five fields consumed (`font`, `fontSize`, `lineHeight`, `color`, `align`).
  `align` clamped to `left`/`center`/`right`: §5.6 does not enumerate it, three is the honest reading
  of a `ctx.textAlign`, and an unknown value degrading to `left` is right.
- **§5.6 markdown-lite** — not built, and drawn verbatim to stay consistent with what `measure.ts`
  still measures. Correct call: making the renderer markup-aware while the measurer is not would put
  drawn and measured out of agreement, which is worse than showing `**bold**` as typed.
- **§5.9 "bounding box for text"** — delivered, and this is where the diff is weakest. See D-123.
- **§5.9 selection highlight / error badge / formula indicator** — all three now reach `text` for
  free through `objectExtent`, exactly as D-092/D-068 are written. Nothing type-specific was added.

## Legibility audit

Headers present and rewritten in the present tense on all four files; the `NOT DONE HERE` moves
(`text` out of "draws nothing", markdown/overflow in) are exactly what §5.2 asks for. Vocabulary
locked — slot, derived, extent, object throughout; no "property", no "field", no "node". Comments
explain why (the `noUncheckedIndexedAccess` note, the D-010 citations on both extent readers, the
alignment box-width comment). No `any`. Test names are behaviour sentences.

One overstatement, corrected by reviewer edit (below): both `measure.ts`'s header and `drawText`'s
doc claimed drawn ≡ measured without qualification. It holds only while the object's `style.*` slots
are usable, because the two files fall back DIFFERENTLY when they are not — `measure.ts` takes an
unusable `lineHeight` as `fontSize` and returns a zero box for an unusable `fontSize`, while
`resolveTextStyle` substitutes `DEFAULT_TEXT_LINE_HEIGHT` (20) and `DEFAULT_TEXT_FONT_SIZE` (16) and
draws anyway. For a loaded document carrying a `#TYPE` style on a multi-line `text` object, the box
is one line tall and the ink is N lines tall. Narrow, reachable, and it was being claimed away.

## Honesty audit

The log matches the diff, including the parts that are unflattering. Both §6.1 triggers were called
correctly and neither was soft-pedalled:

- **Trigger 5 (changed test expectations)** — real, and both changes are widenings, not weakenings.
  `hittest.test.ts`'s "never hits" loop dropped `text` because `text` acquired a visual definition,
  and the slotless-`text` no-hit case is re-pinned inside the new describe (I checked it is actually
  asserted, not just mentioned). `interaction.test.ts`'s `textObject()` moved to (500, 500) and
  gained its D-121 origin slots so a now-hittable text object stops intercepting a drag aimed at a
  co-resident rect; every assertion in that block is byte-identical.
- **Trigger 3 (brief silent)** — Q-024 raised rather than guessed, provisional tagged at both sites.

The Phase 5 criterion is reported NOT YET with a specific list of what remains. Nothing is claimed
passing without a test. The panel consequence (a selected `text` object now shows a D-094 panel) was
volunteered rather than left for me to find — that is the behaviour this process wants.

**One claim does not survive checking, and it is the load-bearing one.** Entry 0138 and Q-024 both
justify provisional (a) as an edge affordance, on the grounds that "most `text` objects carry a
numeric `width`." `command/commands.ts`'s `DEFAULT_TEXT_WIDTH` is `"auto"` (line 250), so every
object `text x=… y=… "…"` creates is auto-width and lands on the 240×20 fallback box. The provisional
is on the DEFAULT path, not the edge of it. That is not dishonesty — it is an estimate made without
re-reading a constant from the previous cycle — but it inverts the cost/benefit the question was
recommended on, and it is why Q-024 is ruled (b) rather than confirmed at (a).

## Reviewer edits

Two, both header/doc prose, no behaviour change; `tsc` clean and 1466/1466 after.

1. **`src/render/measure.ts`** — the `WHAT THIS IS` claim that the drawn text "occupies exactly the
   box that was measured" now states the condition it holds under (usable `style.*` slots) and names
   the divergent fallbacks that break it otherwise.
2. **`src/render/renderer.ts`** — `drawText`'s doc carries the same qualification, pointing at
   `measure.ts`'s header rather than repeating it.

## Answers to the implementer's four questions

1. **Q-024 — fixed fallback, or a `measuredWidth` slot?** Ruled **D-123: option (b)**, and it must
   land before the Phase 5 gate is claimed. The reasoning is in the ruling; the short form is that
   the fallback is the default path (above), the measurer already computes the width and throws it
   away, and D-066 means one wrong box is simultaneously the wrong click target, the wrong highlight
   and the wrong `fit` contribution. Provisional (a) stands until that cycle lands — it was the right
   call for THIS cycle, and (b) was correctly identified as an escalation a render slice should not
   make on its own.
2. **Should the renderer draw exactly `measuredHeight / lineHeight` lines instead of what it
   wrapped?** No — and this is now **D-123 clause 5** so it stays answered. The box follows the text;
   the text never follows the box. Clamping the drawn line count to a stored measurement would DROP
   an operator's text to make a number true, which is precisely the injury D-116 and D-118 are ruled
   against. `overflow: "clip"`/`"ellipsis"` is the only mechanism allowed to reduce what is drawn,
   and only on the `overflow` slot's instruction.
3. **A selected `text` object now shows a D-094 properties panel — intended?** Yes. D-094 clause 2
   makes the panel a function of having a drawn extent, and `main.ts`'s `panelledObjectIds` is
   deliberately type-agnostic. `text` is a first-class object now; a panel listing its thirteen slots
   is the ruling working as written, not a leak. No change, no new test needed.
4. **`measure.ts` exporting `layOutLines`/`cssFont`, or a new `render/text-layout.ts` leaf?** Keep
   the export. `measure.ts` is already a render leaf (it imports only `engine/eval-context.ts` types),
   so there is no cycle risk and a third file would buy nothing today — §13's "smaller diff" and
   "easier to delete later" both point here. Revisit only if the markdown-lite cycle grows the shared
   layout enough that "measure" stops describing the module; if it does, extract then and move both
   consumers in one cycle.

## Open questions

- **Q-024 → D-123.** ANSWERED, marked in place in `OPEN_QUESTIONS.md`. Reconciliation owed by the
  `measuredWidth` cycle: `grep PROVISIONAL(Q-024)` and remove both tags; `schema.test.ts`'s `text`
  derived-slot count moves 2 → 3.
- **Q-012** (world units vs screen pixels) — still open, still deferred, and the new
  `DEFAULT_TEXT_*` constants join it without changing it. `text` font size in world units is the
  same reading `drawTable` already takes; the `style`-slots cycle settles all of them together.
- **Q-008, Q-016, Q-017** — unchanged, none blocking. Q-016/Q-017 remain the human's.
- **Next free: Q-025.**

## Noted, not findings

Recorded in `STATUS.md`'s known problems; none is a defect in this diff.

- **An empty-`content` `text` object is invisible AND unselectable.** No ink, no extent, so no hit
  box, no chrome, no name label, no panel. `text 0 0 ""` and `set text_1.content ""` both reach it.
  Consistent with `measure.ts`'s zero box and correct per D-066, and recoverable by command
  (`list`, `set`, `delete`) — but the operator has no mouse affordance to get it back. Worth a
  ruling only if it is ever hit in practice; not one this cycle should have solved.
- **`renderer.test.ts`'s `bodyText` helper filters `fillText` calls by text content** (dropping
  `"text_1"`, `"!"`, and anything containing `•`) to separate body from chrome. A fixture whose
  content collided with the object's own name would silently assert over zero lines. Fixture-only
  fragility; leave it until it bites.
- **`drawText` returns with `ctx.textBaseline`/`textAlign`/`font`/`fillStyle` still set**, like the
  chrome pass before it (open fix-list item 9). Harmless — every other draw path sets all of them
  before use.

## Verdict

**ACCEPT WITH EDITS.**

A clean, well-scoped cycle. The one structural decision that mattered — read the click box, the
highlight and the chrome anchor off ONE `objectExtent` instead of three — was made correctly, which
is why D-123 is a change to one function rather than a rework. The escalation discipline was right:
both triggers called, the irreversible option declined, the reversible one tagged. The single
correction is that the tagged provisional was mis-sized as an edge case when it is what every `text`
command produces, and D-123 closes it.

Phase 5 remains OPEN. Remaining before the gate, in the order I recommend: **D-123's `measuredWidth`
cycle** (small, engine + `primitives/schema.ts`, closes Q-024 and unblocks a correct bounding box),
then **markdown-lite** in `renderer.ts` + a markup-aware `measure.ts` in the same cycle, then
**`overflow` clip/ellipsis**, then the **gate test** (§6.1 trigger 1, its own cycle). Only the "before
the gate" part is binding; the rest is sequencing advice.
