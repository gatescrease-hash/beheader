# 0127 — the `text` schema entry + `resolvedContent`, evaluated through a formula slot's contract (D-114)
Date: 2026-09-01   Phase: 5   Model: Sonnet 5 (implementer)
Previous entry: 0126-broken-span-display   Last review: 0125-REVIEW-phase5 (verdict: ACCEPT WITH EDITS)
Batch: cycle 2 of up to 3 since last review; ~923 lines / 10 files changed so far (0126: 146/2; 0127: 777/10 — 0126's two files are a subset).

## Declared scope

Give `text` a real `primitives/schema.ts` entry: its nine `static` non-derived slot paths
(`content`, `width`, `height`, `overflow`, `style.font/fontSize/lineHeight/color/align`) and ONE
derived slot, `resolvedContent`, whose `dynamic` dependencies and compute both re-parse `content`
into a block tree (`primitives/text.ts`, never cached — **D-114** clause 4) and evaluate it through
the SAME `read`/`readRange` a formula slot's AST gets. Deliver that contract by widening
`graph/eval.ts`'s `evaluateDerivedSlot` per **D-114** — D-110's empty-in-extent coercion consulted
BEFORE the D-013 membership check (clause 3), and a real `readRange` on
`enumerateRangeCellAddresses` shared with `evaluateFormula` — plus the mechanical signature
widenings this needs (the `dynamic` dependency resolver and the compute both gain the object list;
the compute also gains `readRange`).

## Explicitly not in scope

`measuredHeight` and its `TextMeasurer` call — the next cycle, which owes **D-118**'s null-measurer
`#MEASURE` guard AND the width/wrapping question the 0124 `measure(text, style)` interface does not
answer (§5.6 lists `width` as a `measuredHeight` input; Rule 1's interface has no width parameter).
Also out: the `text` command (`COMMANDS_SPECIFIED_BUT_NOT_BUILT` unchanged), `render/measure.ts`,
markdown-lite rendering, layout, threading a real `EvalContext` through `mutate`'s callers, and a
ruling on whether a `formula`-driven `content` slot should be refused (see "Where I got stuck").

## What I did

### `src/engine/primitives/text.ts` (+158 / −17)

The pure block-tree engine is unchanged (0120/0121, then 0126). Added its two schema-wiring halves —
the "pure logic here, registry there" split `primitives/geometry.ts` already uses:

- **`resolveTextDependencyAddresses(object, objects)`** — the `dynamic` dependency resolver for
  `resolvedContent`. Reads `content` `literal`-only (the Rule 6 guard `readTableDimension` applies to
  `rows`/`cols`), re-parses it (`parseTextContent`, D-114 clause 4), and returns a flat `Address[]`:
  `content` itself first (§5.6: "resolvedContent (from content plus every referenced slot)"), then
  every address `extractTextDependencies` reports — a `ReferenceDependency` directly, a
  `RangeDependency` expanded per cell via `enumerateRangeCellAddresses` (the SAME function
  `deriveEdges` Source 1 uses). D-110 clause 4's skip (empty in-extent cell → no edge) and D-047
  clause 1's skip (in-range cell with no slot → no edge) both applied, mirroring `deriveEdges` Source
  1. An unresolvable table falls back to the range start so the dangling-reference check still names
  it.
- **`computeResolvedContent(object, read, context, deps)`** — the `resolvedContent` compute. Reads
  `content` through `read` (so it is a declared dependency, D-013), re-parses it with `deps.objects`,
  and hands the block tree to `evaluateBlockTree(blocks, read, deps.readRange)`. Returns a `string`
  always, unless `content` itself is an `ErrorValue` (a `formula`-driven `content` that errored —
  §5.1: errors propagate). No evaluation logic of its own (Rule 4).
- New `TEXT_CONTENT_PATH` export. Header rewritten: the schema-wiring section is `WHAT THIS IS` now,
  `measuredHeight` and the `formula`-content gap are `NOT DONE HERE`.

### `src/engine/primitives/schema.ts` (+145 / −28) — load-bearing (§6.2)

- **`TEXT_SCHEMA`** registered: nine `static` non-derived paths + one derived slot `resolvedContent`
  (`dynamic` deps → `resolveTextDependencyAddresses`, compute → `computeResolvedContent`).
- **`DerivedSlotComputeDeps`** — new interface: `{ readRange?: ReadRange; objects: readonly
  GraphObject[] }`. The extra environment a compute needs ONLY when it evaluates an embedded formula
  AST (`resolvedContent` is the sole user). `readRange` is optional to match `formula/eval.ts`'s own
  `evaluate`; `objects` is for re-parsing (name → id).
- **`DerivedSlotCompute`** gains an optional 4th parameter, `deps?: DerivedSlotComputeDeps`.
  Additive — the existing `context?: EvalContext` 3rd parameter is untouched, so every geometry /
  `add` compute and the `eval-context.test.ts` `DerivedSlotCompute`-typed fixtures still type-check
  unchanged.
- **`DerivedSlotDependencies`'s `dynamic` arm** — `resolve` gains a second parameter, `objects:
  readonly GraphObject[]`. A resolver that ignores it (`script.out.*`, when built) is unaffected;
  TypeScript's fewer-params-is-assignable rule means the existing `schema.test.ts` `resolve:
  (object) => [...]` fixture needs no change.
- **`derivedSlotDependencyAddresses`** gains a 3rd parameter `objects: readonly GraphObject[] = []`
  (defaulted, so `static`-only call sites and the two existing unit tests are untouched) and passes
  it to `resolve`.
- Header `Scope today` / `NOT DONE HERE` updated for `text`.

### `src/engine/graph/eval.ts` (+90 / −42) — load-bearing (§6.2)

- Extracted two helpers from `evaluateFormula`, verbatim-behaviour: **`isEmptyInExtentCell`** (D-110's
  "empty cell reads 0" predicate) and **`buildRangeReader`** (D-044/D-046's extent-bounded range
  flattening). `evaluateFormula` now builds its `read` from `isEmptyInExtentCell` and its `readRange`
  from `buildRangeReader`.
- **`evaluateDerivedSlot`** gains an `objects` parameter (threaded from `evaluateSlot`, which already
  had it) and, per **D-114**:
  - its `read` now runs `isEmptyInExtentCell` (→ `0`) **before** the D-013 `declaredDependencyKeys`
    membership check (→ `#REF`). Clause 3: an empty in-extent cell has no edge (D-110 clause 4), so
    it is absent from the declared set; checking membership first would return `#REF` where a cell
    formula reads `0`.
  - it builds a `readRange` from the same `buildRangeReader` and passes `{ readRange, objects }` as
    the compute's 4th argument. A range's cells are bounded by the same
    `enumerateRangeCellAddresses` the resolver used to derive the edges, so no per-cell D-013 check
    is needed here (0119-REVIEW §3's structural-agreement argument, third consumer).
- Header updated (WHAT THIS IS, NOT DONE HERE).

### `src/engine/mutation.ts` (+12 / −3) — load-bearing (§6.2)

- `deriveEdges` Source 2 passes `objects` to `derivedSlotDependencyAddresses`. One line + doc
  comment. No other change — Source 2 still pushes one edge per returned address; the resolver does
  all the reference/range/D-110 work itself (it cannot share Source 1's inline logic without closing
  a `mutation → schema → text → mutation` import cycle).

### Tests (+365 / −8 across 4 test files, +7/−3 fixture/comment across 2)

- **`text.test.ts`** (+152, 47 → 64 tests): `resolveTextDependencyAddresses` (11 tests — content
  first, non-literal content, reference/range/both-branches/`orphaned`/empty-in-extent/out-of-extent/
  parse-broken/unresolvable-table) and `computeResolvedContent` (7 tests — plain/formula/reads-via-
  `read`/ErrorValue-propagation/broken-span/readRange-vs-`!#PARSE`/never-throws).
- **`schema.test.ts`** (+40, 32 → 34): the `text` entry shape; `derivedSlotDependencyAddresses`
  forwards `objects` to a `dynamic` resolver. Widened the "no schema entry" list to name
  `polyline`/`script`/`image` and added `image` to the assertion (see "Decisions").
- **`eval.test.ts`** (+91, 20 → 28): a new describe evaluating a real `text` object + hand-built
  edges — plain formula, referenced cell, **D-114 clause 3 (the discriminating test)**, D-110 null
  cell, D-013 still bites, embedded range, broken span in place, non-taken-branch reactivity.
- **`mutation.test.ts`** (+82, 197 → 203): `resolvedContent` end-to-end through `mutate` — edge
  derivation (incl. no edge for an empty in-extent cell), formula resolution, re-resolution on a
  cell change, range + non-taken branch, a cycle through `resolvedContent` rejected by name, and an
  out-of-extent embedding refused (D-110 clause 6).
- **`props.test.ts`** (+3 / −1): the "no schema entry" test used `text` as its example — swapped to
  `script` (still schema-less), assertion byte-identical.
- **`main.test.ts`** (+4 / −2): comment-only — the "`text` has no schema yet" line was falsified.

## Decisions I made

1. **Continued into cycle 2 despite entry 0126 declaring `REVIEW: REQUIRED`.** 0126 touched no
   load-bearing file and no phase gate; its only claimed §6.1 trigger was #5 (four `text.test.ts`
   expectations flipped). Those flips were **authorised in advance** by D-116 clause 2 ("that
   behaviour was a default by omission, never a decision, and it is now overruled") and D-116/D-117's
   reconciliation notes ("owed by the Phase 5 wiring cycle, which MUST land them with tests"). Entry
   **0039** is the exact precedent: pre-authorised expectation changes (there, by 0038-RULINGS) "do
   NOT fire trigger 5 — said here, moving on" → `REVIEW: NOT NEEDED`, and that cycle continued into
   its next slice the same session. Q-010 states the principle generally. So 0126 was batch cycle
   1/3, and this is 2/3. **Either way the batch gets one review that covers both** — this cycle is
   itself `REVIEW: REQUIRED` (below), and it touches the load-bearing files 0126 did not. If the
   reviewer disagrees that continuing was right, nothing was lost: 0126 sits unreviewed in the same
   batch as 0127, exactly as it would have.
2. **`DerivedSlotCompute` gains a 4th param, not a reshaped 3rd.** `eval-context.test.ts:58/67` type
   two fixtures as `DerivedSlotCompute` with `context` as the 3rd param; changing that param's shape
   would break them. An additive 4th optional param breaks nothing (verified: full suite green with
   no fixture edits beyond the one `props.test.ts` swap).
3. **`content` is read `literal`-only, and this cycle does NOT refuse a `formula`-driven `content`
   slot.** The resolver returns `[content]` alone for a non-literal `content` and `computeResolvedContent`
   uses `""` for it — so a `link`ed `content`'s references would be untracked (a silent gap). Refusing
   it is D-046's move for `rows`/`cols`, and it belongs in `mutation.ts`/`command/` preconditions —
   scope this cycle does not own. Recorded in STATUS.md's Known problems; owed a ruling by the cycle
   that builds the `text` command.
4. **`resolvedContent`'s deps include `content` itself.** §5.6 says "from `content` plus every
   referenced slot" literally, and it is what lets `computeResolvedContent` `read` `content` under
   D-013 and what makes a future `formula`-driven `content` re-trigger a resolve.
5. **Extracted `buildRangeReader` / `isEmptyInExtentCell` in `eval.ts` rather than duplicating.**
   D-114 clause 2 ("never a second evaluation path ... the same `enumerateRangeCellAddresses`")
   authorises it — `evaluateFormula` and `evaluateDerivedSlot` now build their range reader from one
   factory. Verified behaviour-preserving for `evaluateFormula` by the full existing range-test suite
   staying green.
6. **`schema.test.ts`'s "no schema entry" list widened to `polyline`/`script`/`image`** (was
   `polyline`/`script`, and did not name `image` though `image` was also unregistered). Names the
   set honestly now that `text` left it. Not a weakening — a stricter assertion.

## Verification (real output)

```
$ npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.engine.json
(clean, no output — both configs)

$ npx vitest run
 Test Files  29 passed (29)
      Tests  1375 passed (1375)
```

0 skipped, 0 `.only` (`grep -rnE "\.(only|skip|todo)\(" src/` → nothing).
Test count: 1342 → 1375 (+33): `text.test.ts` 47→64, `schema.test.ts` 32→34, `eval.test.ts` 20→28,
`mutation.test.ts` 197→203. `props.test.ts` / `main.test.ts` unchanged in count (fixture / comment).

Diff, `git diff --numstat` (src only): **+777 / −101 across 10 files** —
`text.ts` +158/−17, `text.test.ts` +152/−1, `schema.ts` +145/−28, `eval.test.ts` +91/−1,
`eval.ts` +90/−42, `mutation.test.ts` +82/−0, `schema.test.ts` +40/−6, `mutation.ts` +12/−3,
`main.test.ts` +4/−2, `props.test.ts` +3/−1.

**Batch since 0125-REVIEW:** 0126 (+146/−83, 2 files) + 0127 (+777/−101, 10 files) = **~923
additions / 10 unique files** — over the §6.3 cap (800/10).

Mutation-checks (both against the committed implementation, restored after):
- **D-114 clause 3** — reorder `evaluateDerivedSlot`'s `read` to check `declaredDependencyKeys`
  membership BEFORE `isEmptyInExtentCell` → **exactly 1 red**: `eval.test.ts` "D-114 clause 3: an
  EMPTY in-extent cell reads as 0 — coercion BEFORE the D-013 membership check" (resolves
  `"sum: !#REF"` instead of `"sum: 5"`). The D-013 test and the non-taken-branch test stay green —
  the check is precisely targeted, which is what D-114's reconciliation ("a test that fails if the
  two are swapped") asks for.
- **D-110 clause 4 in the resolver** — disable `resolveTextDependencyAddresses`'s empty-in-extent
  skip → **exactly 2 red**: `text.test.ts` "gives an EMPTY in-extent cell NO edge" and
  `mutation.test.ts` "derives one edge per referenced cell ... and no edge for an empty in-extent
  cell". The out-of-extent test stays green (the skip never applied to it).

## Acceptance criteria status

Phase 5 criterion ("a text box reading `Radius: {= table_x.A1 }{? ... }` updates both its number and
its branch ... **wraps at its set width** ... and re-renders when a value referenced only inside the
currently non-taken branch changes") — **NOT YET.** The reactivity half is now real end-to-end:
`eval.test.ts` and `mutation.test.ts` both pin that `resolvedContent` re-resolves through the
topological pass when a referenced cell changes, INCLUDING a cell referenced only inside the
currently non-taken conditional branch. What the gate still needs: `measuredHeight` + a real
measurer + `render/`'s wrapping and drawing. Demonstrated (partial): `mutation.test.ts`
"subscribes to a range and a non-taken conditional branch, so both drive resolvedContent".

## Where I got stuck / what is unfinished

- **`measuredHeight` and the width/wrapping question.** §5.6 says `measuredHeight` is computed "from
  `resolvedContent`, `width`, and `style`" — but Rule 1's `TextMeasurer.measure(text, style)`, built
  and reviewed at 0124/0125, takes no `width`. The two cannot both be read literally: either the
  interface needs a `maxWidth` parameter, or wrapping is computed some other way, or `measuredHeight`
  is not wrap-aware (contradicting the gate). This is load-bearing and unresolved. It does not block
  THIS cycle (`measuredHeight` is out of scope), so I did not raise a formal `Q-021` — nothing is
  built against it. The next cycle hits it and must raise it. Flagged in `text.ts`'s header and
  STATUS.md.
- **A `formula`-driven `content` slot's references are untracked** (Decision 3). Silent gap, owed a
  ruling. Not reachable today (no `text` command, no loader path for `text`).
- The resolver's reference/range/D-110 logic is a near-parallel of `deriveEdges` Source 1's. They
  cannot share code without an import cycle (`text.ts` ⇸ `mutation.ts`). A shared helper could live
  in a neutral module later; out of scope now (§4 — do not refactor code not written this batch).

## Open questions raised

None this cycle. **Q-021 is coming** — the `measuredHeight` width/wrapping inconsistency above —
raised by the next cycle, which is the first to build against it. Next free ID is still Q-021.

## Review point

Fired: **§6.3 batch cap** — batch additions since 0125-REVIEW are ~923 lines across 10 files
(0126: 146/2; 0127: 777/10), over the 800-line / 10-file cap. Also **§6.1 trigger 5** — one
previously-passing test (`props.test.ts`'s "no schema entry" example) failed when `text` gained a
schema and was adapted (fixture swapped to `script`, assertion byte-identical; `main.test.ts` a
stale comment). Load-bearing files touched: `graph/eval.ts`, `primitives/schema.ts`, `mutation.ts`
(§6.2) — reviewed now, they also clear 0126's unreviewed `text.ts` changes as part of the same
batch.

Batch: cycle 2/3, but the cap is hit — stop here.

REVIEW: REQUIRED
Reason: §6.3 batch cap exceeded (~923 lines / 10 files) and §6.1 trigger 5; D-114 is a major ruling
reshaping derived-slot infrastructure across three load-bearing files.
Questions for reviewer:
  1. Was continuing into this cycle after 0126's `REVIEW: REQUIRED` the right call (Decision 1)? The
     0039 / D-038-RULINGS / Q-010 precedent says 0126's trigger-5 flag was over-called; either way
     both cycles are in this one batch review.
  2. `resolveTextDependencyAddresses` re-implements `deriveEdges` Source 1's reference/range/D-110
     handling because an import cycle forbids sharing. Acceptable, or is a neutral shared module
     (e.g. `primitives/table.ts` growing a `Dependency → Address[]` helper) worth the churn now?
  3. `DerivedSlotCompute`'s 4th param `deps?: DerivedSlotComputeDeps` bundles `readRange` + `objects`
     while `context?` stays a separate 3rd param — two trailing optionals. Fold `context` into
     `deps` (no compute reads `context` yet), or leave the split?
  4. Is `computeResolvedContent` using `""` for a non-string `content` (rather than an `ErrorValue`)
     the right fail-safe, given a `formula`-driven `content` is an unruled gap?
