# 0130 — REVIEW (Phase 5): entry 0129 — `measuredHeight`, D-118's `#MEASURE` guard, Q-021
Date: 2026-09-01   Phase: 5   Model: Sonnet 5 (reviewer)
Reviews: **0129** (`measuredHeight` derived slot + `#MEASURE` `ErrorCode` + `TextMeasurer.measure`'s
`maxWidth` + `hasRealMeasurer`). One cycle since 0128-REVIEW.
Previous review: 0128-REVIEW-phase5
Verdict: **ACCEPT WITH EDITS.** One code edit (a non-finite-height guard in `computeMeasuredHeight`,
+1 test); one ruling, **D-120**, answering **Q-021**. The §6.3 batch cap is reset. Phase 5 stays
open; §6.2's block on a later phase stays lifted (it was lifted at 0116/0125, not re-armed). The
next slice — the `text` command + `render/measure.ts` + context threading — may proceed.

## 1. What I ran, before reading anything as true

```
$ npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.engine.json
(clean, no output — both configs)

$ npx vitest run
 Test Files  29 passed (29)
      Tests  1398 passed (1398)          # at HEAD dfe5e43, before my edit

$ grep -rnE "\.(only|skip|todo)\(" src/     → nothing
```

**Every countable claim in entry 0129 survives measurement.**

| Claim | Source | Measured |
| --- | --- | --- |
| src diff `+586 / −101`, 10 files | entry 0129 | `git show dfe5e43 --numstat -- src`: ins 19+48+92+6+13+101+10+72+96+129 = **586**; del 1+12+0+5+4+2+3+57+0+17 = **101**; **10** files ✓ (the commit's own `--stat` total, 1065/332, includes the three `claude/*` docs) |
| test count 1375 → 1398 (+23) | entry 0129 | **1398** at HEAD ✓ — `text.test.ts` 64→74, `eval.test.ts` 28→34, `mutation.test.ts` 203→207, `eval-context.test.ts` 4→7; `schema.test.ts` 34→34 (widened in place) |
| mutation-check: `evaluateDerivedSlot` passes `NULL_EVAL_CONTEXT` instead of `context` → **exactly 3 red** | entry 0129 | reproduced: **3 red**, all `eval.test.ts` — "threads a real (fake) measurer…", "PROVISIONAL(Q-021): a numeric `width` slot reaches the measurer as maxWidth", "measures resolvedContent AFTER the embedded formula resolves". The `#MEASURE` tests stay green. This is 0124's end-to-end "is `context` threaded at all" proof. ✓ |
| mutation-check: disable `computeMeasuredHeight`'s `!hasRealMeasurer(context)` branch → **exactly 6 red** | entry 0129 | reproduced: **6 red** — 3 in `text.test.ts`, 2 in `eval.test.ts`, 1 in `mutation.test.ts`, every one asserting `#MEASURE`. ✓ |

Fourth consecutive batch (0121, 0125, 0128, now 0129) whose numbers all hold on re-run.

## 2. Rule audit

- **Rule 1 (engine purity / no canvas for text measurement)** — **upheld, and this cycle is
  entirely about honouring it.** `grep -nE "document\.|window\.|canvas|CanvasRenderingContext2D|from \"\.\./render"`
  over the four changed engine files: every hit is a header "NEVER imports" line or prose.
  `primitives/text.ts`'s new imports are `hasRealMeasurer` + `TextStyle` from `eval-context.ts` — a
  pure engine leaf that imports nothing. `computeMeasuredHeight` never measures anything itself; it
  calls `context.measurer.measure`. Line-breaking is pushed to the measurer implementation
  (`PROVISIONAL(Q-021)` → **D-120**), which is where Rule 1's own text-measurement trap says
  glyph-metric work belongs.
- **Rule 2 (mutation-only state change)** — **not touched.** No new state assignment. `graph/eval.ts`
  is header-only. `computeMeasuredHeight` reads via the `read` callback and returns a `Value`.
- **Rule 3 (addressing)** — not touched. Every address `computeMeasuredHeight` builds is
  `{ objectId, path }` with a `TEXT_*_PATH` constant; comparison is via the `read` callback's own
  `addressKey`. No string concatenation.
- **Rule 4 (one formula engine)** — not touched. `computeMeasuredHeight` evaluates nothing; it reads
  already-computed slot values. `computeResolvedContent` (D-114's path) is unchanged.
- **Rule 5 (dumbest correct implementation)** — **upheld.** `computeMeasuredHeight` is a
  pass-through: read five slots, propagate, guard, return `.height`. No caching, no wrap loop, no
  layout machinery. The `TEXT_*_PATH` move into `text.ts` is a spelling-consolidation, not new logic.
- **Rule 6 (slot set fixed during evaluation)** — **upheld.** `measuredHeight`'s dependencies are
  `static` — a fixed path list resolved from the schema alone, no object-state inspection, so
  nothing here can be tempted to run at evaluation time. `graph/eval.ts`'s universe-of-slots read is
  unchanged.
- **Rule 7** — not touched.

**Vocabulary lock.** `grep -iE "\b(property|properties|field|computed)\b"` over the new lines: "style
field" and "size-relevant style fields" quote/paraphrase §5.6; "wrap boundary" is new but is not a
*slot* synonym; "the height computation" is a description, not a rename of `derived`. No drift.

## 3. Invariant and spec audit

**§5.1 — derived slots are graph nodes evaluated inside the topological pass.** `measuredHeight` is
`kind: "derived"`, wired into `TEXT_SCHEMA.derivedSlots` with a `static` dependency list, evaluated
by `evaluateDerivedSlot` inside the one pass. No `recompute()`. Its edge into the pass
(`resolvedContent`/`width`/`style.*` → `measuredHeight`, Source 2 of `deriveEdges`) is what orders
it after a `formula`-driven `width` or style field. `= text_1.measuredHeight` in a formula is
therefore legal and correctly ordered — §5.6's stated payoff.

**§5.6 — `measuredHeight` "from `resolvedContent`, `width`, and `style`, computed via the injected
`TextMeasurer`".** Dependencies are exactly `resolvedContent` + `width` + `style.font`/`fontSize`/
`lineHeight`. `style.color`/`style.align` are omitted — they change how text is *painted*, not how
much room it takes, and `eval-context.ts`'s `TextStyle` (0124, reviewed 0125) already drew that line.
`height` is omitted — it is the operator's fixed-height/overflow choice, a different question from
"how tall to fit". All three exclusions are sound and disclosed.

**D-118 — a compute needing a real measurement surfaces an `ErrorValue`, never a height it did not
earn.** Built exactly as ruled:
- `hasRealMeasurer(context)` (`eval-context.ts`) checks the *measurer* against the module-private
  `NULL_TEXT_MEASURER` by identity, and treats `context === undefined` (the isolated-unit-test path)
  as "no real measurer" too — D-118 clause 3 names exactly this option and calls the two equivalent.
  A hand-built `{ measurer: NULL_EVAL_CONTEXT.measurer }` does not sneak past (tested).
- `computeMeasuredHeight` returns `{ error: "#MEASURE", message: … names the object }` — clause 2's
  "message naming the object" — before ever calling `measure`.
- `evaluate` / `deriveValidateAndEvaluate` / `mutate` forward `context` untouched and never inspect
  it — clause 4. `graph/eval.ts` is header-only this cycle; the threading `evaluateDerivedSlot`
  already did (0124) is what the 3-red mutation-check proves is real.
- Clause 5's "one test discharges both (`#MEASURE` AND is-`context`-threaded)" — `eval.test.ts`
  "D-118: evaluated with NULL_EVAL_CONTEXT … is #MEASURE — never height 0" plus the 3-red check.

**`#MEASURE` as a sixth `ErrorCode` (`graph/node.ts`) — within D-118's sanction, confirmed.** D-118
clause 2 suggests the code by name and its rationale contemplates widening `graph/node.ts`; this is
**D-028**'s move (`ErrorNode`'s `#REF` is not in §5.3's grammar) at a boundary the brief's §5.1 list
did not foresee, not an unratified deviation of its own. Checked mechanically: no exhaustive
`switch` over `ErrorCode` *values* exists anywhere (`grep` — every `: never` is over `FormulaAst`
node types), `isErrorValue` tests `"error" in value` not the code, and `render/renderer.ts` /
`command/props.ts` / `formula/format.ts` all render `value.error` as an opaque string. `#MEASURE` is
only ever produced by `measuredHeight` (a `derived` slot) and `document.ts`'s `serializeObject`
drops every `derived` slot's value — so `#MEASURE` provably cannot reach disk (§5.11). Nothing else
needed a case added.

**Q-021 / `TextMeasurer.measure(text, style, maxWidth?)` — reversible, correctly tagged, now ruled
(D-120).** The parameter is optional and trailing; `NULL_TEXT_MEASURER` and every test fake ignore
it; `eval-context.ts` is not on §6.2's load-bearing list; `measuredHeight` never serializes. The
`PROVISIONAL(Q-021)` tags sit at the two sites `OPEN_QUESTIONS.md` names. Ruled here rather than
escalated — see §6 and D-120.

**The "five slots became effectively-required" consequence — real, correctly mechanised, sound.**
`measuredHeight`'s `static` deps make `deriveEdges` Source 2 emit an edge from `width`/`style.font`/
`style.fontSize`/`style.lineHeight`/`resolvedContent` into `measuredHeight` unconditionally. I
verified the refusal path by reading it end to end: Source 2 emits the edge whether or not the
source slot exists → `findDanglingReferences` resolves each edge's `sourceSlot` via `resolveSlot` →
an absent `width` slot is `undefined` → "text_1.measuredHeight references a slot that does not
exist", mutation refused. This is the *same* mechanism that refuses an `add` node with no `in.a`
(0018-REVIEW / D-018's neighbour), and it is a feature: a `text` object without a `width` slot is
malformed per §5.6, and the refusal names the dangling edge. `height`/`overflow`/`style.color`/
`style.align` stay optional — nothing derives from them (D-047's absent spelling). Tested through
`mutate` ("a text object missing a measuredHeight input slot (style.font) is REFUSED"). The `text`
command cycle owns creating all nine non-derived slots + both derived placeholders with defaults;
STATUS and the entry both flag this clearly.

**D-114 / D-115 / D-116 / D-117 — not touched.** `computeResolvedContent`, `resolveTextDependencyAddresses`,
`evaluateBlockTree`, the D-119 pair — all byte-unchanged this cycle (verified against the diff).

## 4. Honesty audit — the log matches the diff

- **Scope was not expanded silently.** The four engine files changed are exactly the ones the entry
  names, at the sizes it names. The two collateral test touches — `schema.test.ts`'s `text`
  entry-shape assertion (now "two derived slots", *stricter*) and `mutation.test.ts`'s 0127
  `textObject` helper (minimal → well-formed, so the 0127 end-to-end tests keep committing) — are
  both disclosed as §6.1-trigger-5 material and neither weakens anything. I read every 0127 text
  test against the widened helper: none asserted "a minimal `text` object commits" as a property;
  the `expectSameEdges` case correctly gained the five new `measuredHeight` edges.
- **The entry is candid about what it did NOT do:** `measuredHeight` reports `#MEASURE` for every
  real document until `render/measure.ts` + context threading land (D-118 working as ruled, not a
  bug); the five-slots consequence is only mechanised in the schema + one test + the entry + STATUS,
  not made a non-issue anywhere; markdown markup still counts toward the measured string. All three
  are in the entry, the header, and STATUS.
- **`expectError` in `text.test.ts`:** 0128 predicted the `#MEASURE` test would use it; 0129 used
  `toMatchObject` instead, and *says so* in STATUS ("`expectError` is now genuinely unused"). Honest
  self-correction, not a hidden change.
- **The mutation-checks are real** — I reproduced both, exactly (§1).

## 5. Findings

**F21 — `computeMeasuredHeight` returned `context.measurer.measure(…).height` on trust, with no
non-finite guard.** `eval-context.ts`'s `TextMeasurer` contract promises a finite, non-negative
height, and every measurer that exists today (`NULL_TEXT_MEASURER`, the test fakes) honours it — but
`render/measure.ts` is unbuilt, an injected measurer is precisely the kind of component **D-118**
just ruled the engine cannot trust blindly, and `mutation.ts`'s D-025 slot-value check runs BEFORE
`evaluate` and never re-inspects a derived result. A buggy future measurer returning `NaN`/`Infinity`
would cache that straight into `measuredHeight` and then propagate it through any
`= text_1.measuredHeight` binding, uncaught — the exact gap `add`'s compute carries its own
`Number.isFinite(sum)` guard against, and which `primitives/schema.ts`'s header instructs "every
FUTURE compute function" to close via `hasIllegalNumber`. **Fixed by Edit 1**: a step-4 guard
mapping a non-finite height to `#TYPE`, mirroring `add`. +1 test (`text.test.ts`).

**Not a finding, recorded:** `computeMeasuredHeight` does not `#TYPE` a wrong-shaped `width` (a
`boolean`, a `Point`) the way it does a wrong-shaped style field — a non-number `width` is silently
`undefined` `maxWidth` (no wrap). This is defensible: `width` has a *legitimate* non-number value
(`"auto"`), style fields do not, so "not a number → no wrap" is a real branch rather than an error.
The `text` command owns creating `width` with a sane default. Leave it.

**Not a finding, recorded:** markdown-lite markup (`**bold**`, `# heading`) in `resolvedContent` is
measured verbatim, because §5.6 says "from `resolvedContent`" and markdown rendering is `render/`'s
(unbuilt). Once `render/measure.ts` exists it receives `resolvedContent` and *can* be markdown-aware
— D-120's "the measurer's job" framing accommodates that. The measurer cycle should decide it
explicitly; not this cycle's call.

**Not a finding, recorded:** a real `text` document today lights §5.9's error badge (any slot
holding an `ErrorValue`, and `measuredHeight` holds `#MEASURE`). That is D-118 working as intended —
loud, not silent — and self-resolves when the measurer is wired. Distinct from D-116/D-117, which
deliberately keep the badge dark because `resolvedContent` holds a *string*.

## 6. Answered questions

**Q-021 → D-120.** How does `measuredHeight` become width-aware, given the 0124 `TextMeasurer`
interface has no width parameter? **Ruled: the implementer's provisional choice (a) is confirmed** —
`measure` gains an optional trailing `maxWidth`, and line-breaking lives in the measurer
implementation, never in `src/engine/`.

Ruled by the reviewer rather than escalated to the human because it is not a product-facing choice:
the operator sees identically-wrapped text whichever way the seam is drawn. It is an internal
interface-shape question, and Rule 1 settles it — measuring text needs glyph metrics, Rule 1 puts
glyph-metric work behind the `TextMeasurer` interface, and line-breaking *is* glyph-metric work.
Option (c) (engine-side wrap loop) would put a layout algorithm in `src/engine/`; option (b) trades
away the Phase 5 gate. Reversible if the human overrules (the parameter is optional, the slot never
serializes). Reconciliation: the `render/measure.ts` / `text` command cycle greps `PROVISIONAL(Q-021)`
and swaps the tag for a `(D-120)` citation.

**Was proceeding on the provisional right (reviewer question 1)?** Yes. PROCESS_BRIEF §7 clause 2
authorises taking a reversible provisional and tagging every site; §6.1 trigger 3 is exactly the
checkpoint where it gets ratified. Blocking the whole cycle to ask first would have been
over-cautious for a reversible, optional-parameter change.

Standing questions, unchanged: **Q-016** (panel row literal string/boolean), **Q-017** (persistent
table headers) — the human's, non-blocking. **Q-012** (world vs screen units), **Q-008** (`-0`) —
deferred, blocking nothing. Next free ID is **Q-022**.

## 7. The gate

- **§6.3 batch cap** — 1 cycle / 586 lines / 10 files since 0128-REVIEW. Well under 3 / 800 / 10.
  Reset by this review regardless.
- **§6.1 trigger 3** (brief inconsistency: §5.6 `width` vs. the 0124 interface; brief deviation:
  `#MEASURE` not in §5.1's list) — both resolved here (D-120; `#MEASURE` confirmed within D-118 c2).
- **§6.1 trigger 5** (`schema.test.ts` assertion + `mutation.test.ts` 0127 helper) — adapted, not
  weakened. Cleared.
- **§6.2** — `graph/node.ts` and `primitives/schema.ts` (load-bearing) had unreviewed changes;
  `graph/eval.ts` header-only. All reviewed here. Phase 5 was already open; no later-phase block is
  armed.
- The next slice — **the `text` command + `render/measure.ts` + a real `EvalContext` threaded
  through the non-test `mutate` callers** — may proceed. It owns: creating a `text` object with all
  nine non-derived slots + both derived placeholders and sane style defaults (settles F13/F20 and
  0129's five-required-slots consequence); `render/measure.ts` honouring **D-120**'s `maxWidth`;
  reconciling `PROVISIONAL(Q-021)`. The render-only alternative (**D-109 clauses 1–2** + **Q-017**
  headers) is unchanged and still the smallest un-owed item.

## 8. Edits made by this review

1. **`src/engine/primitives/text.ts`** — `computeMeasuredHeight`: added a step-4 guard mapping a
   non-finite height back from `measure` to `#TYPE` (F21), mirroring `add`'s own non-finite guard
   and `primitives/schema.ts`'s header instruction. Imported `hasIllegalNumber` from `graph/node.ts`.
   Doc comment's "Order of failure" list gains item 4; the trailing "`measure` … returns finite …
   as-is" comment is replaced with the guard's own rationale. `+21 / −4`.
2. **`src/engine/primitives/text.test.ts`** — one test: "fails closed with `#TYPE` if a (buggy)
   measurer returns a non-finite height". `+7`.

Verification after edits:

```
$ npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.engine.json
(clean, both configs)

$ npx vitest run
 Test Files  29 passed (29)
      Tests  1399 passed (1399)          # 1398 + the one added here
```

0 skipped, 0 `.only`. Review diff, `git diff --numstat` (src): `+28 / −4` across 2 files
(`text.ts` +21/−4, `text.test.ts` +7/−0).

`DECISIONS.md` gains **D-120**. `OPEN_QUESTIONS.md` marks Q-021 `ANSWERED → D-120`. `STATUS.md`
rewritten.
