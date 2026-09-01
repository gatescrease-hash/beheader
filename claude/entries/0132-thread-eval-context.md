# 0132 — Threading a real `EvalContext` through every non-test `mutate` caller
Date: 2026-09-01   Phase: 5   Model: Sonnet 5 (implementer)
Previous entry: 0131-canvas2d-text-measurer   Last review: 0130-REVIEW-phase5 (verdict: ACCEPT WITH EDITS)
Batch: cycle 2 of up to 3 since last review; ~1184 lines / 16 src files changed so far (this cycle: +406 / −72, 8 files).

## Declared scope

Thread §5.1's `EvalContext` (the injected `TextMeasurer`, §5.6) from `main.ts` through every
non-test `mutate` caller: `command/commands.ts`'s `executeCommand`, `render/interaction.ts`'s
`pointerMove`, and `engine/document.ts`'s `deserializeDocument`/`loadDocument` each gain an optional
trailing `context: EvalContext = NULL_EVAL_CONTEXT` forwarded to their `mutate` call(s). `main.ts`'s
`start` builds one `EvalContext` around `createCanvas2dTextMeasurer` (entry 0131) over its OWN
offscreen 2D context and passes it through the pure transitions (`submitLine`, `respondToPrompt`,
`pointerDownAt`, `pointerMoveTo`, `commitPanelEdit`, `unlinkPanelSlot`), which take the same optional
param. This is what makes `measuredHeight` stop being `#MEASURE` (D-118) for a `text` object that
arrives by `load`.

## Explicitly not in scope

- **The `text` command.** Still in `COMMANDS_SPECIFIED_BUT_NOT_BUILT`; there is no command-line way
  to create a `text` object, so every new test builds one by hand (the well-formed shape
  `mutation.test.ts`/`eval.test.ts` use) or loads one from JSON. Owes the F13 ruling.
- `renderer.ts`'s text-drawing pass, markdown-lite rendering, layout — a `text` object still draws
  as nothing (its box has no paint pass and no `origin` slot).
- Any change to what `mutate`, `deserializeDocument`'s shape validation, or `computeMeasuredHeight`
  do — `context` is forwarded untouched and never inspected outside `computeMeasuredHeight` (D-118
  clause 4).

## What I did

### `src/engine/document.ts` (+24 / −4) — LOAD-BEARING (§6.2), signature change

- `loadDocument(json, context = NULL_EVAL_CONTEXT)` and
  `deserializeDocument(raw, context = NULL_EVAL_CONTEXT)` — `loadDocument` forwards to
  `deserializeDocument`, which forwards to the reconstruction batch's one `mutate([], operations,
  [], context)` call (line ~386). Nothing else in the function reads `context`. The zero-object
  early return never calls `mutate`, so it is untouched.
- Header WHAT THIS IS gains a paragraph; both function doc comments say what `context` is for and
  that the `NULL_EVAL_CONTEXT` default keeps every non-`main.ts` caller's behaviour identical
  (`measuredHeight` → `#MEASURE`, D-118 — legitimate state, not a load refusal).

### `src/command/commands.ts` (+49 / −37) — NOT load-bearing, signature change

- `executeCommand(command, document, context = NULL_EVAL_CONTEXT)`. The switch forwards `context`
  to every handler that reaches `mutate`: `createCircle`/`createPolygon`/`createRect`/`createTable`
  (→ `createObjectFromCommand` → `mutate`), `setLiteral`/`setFormula`/`link`/`unlink` (→ `writeSlot`
  → `mutate`), `renameObject`, `deleteObject`. The read-only handlers (`refs`, `props`, `list`,
  `select`, `zoom`, `fit`, `save`, `load`) do not take it — they call no `mutate`.
- The internal handlers' `context` parameter is **required** (no default) so the compiler forces
  every path to thread it; only the public `executeCommand` carries the `NULL_EVAL_CONTEXT` default.
- Header WHAT THIS IS updated: `executeCommand(command, document, context?)` + a paragraph on what
  `context` is and the `#MEASURE`-until-`main.ts` consequence.

### `src/render/interaction.ts` (+9 / −1) — NOT load-bearing, signature change

- `pointerMove(state, screenPoint, objects, journal, camera, context = NULL_EVAL_CONTEXT)` →
  `mutate(objects, plan.operations, journal, context)` (the file's one `mutate` call).
- `pointerMove`'s doc comment gains the reason: a drag re-evaluates the whole graph (Rule 5), so a
  co-resident `text` object's `measuredHeight` is re-stamped `#MEASURE` on every drag step without a
  real measurer threaded.

### `src/main.ts` (+97 / −30) — the wiring layer

- `start` builds `evalContext`: `document.createElement("canvas").getContext("2d")` (a SEPARATE
  offscreen context — `render/measure.ts`'s header requires its own, because it sets `ctx.font` per
  line and would corrupt a draw sharing the renderer's `context`), wrapped as
  `{ measurer: createCanvas2dTextMeasurer(measureContext) }`. If that second `getContext` returns
  `null` (near-impossible — the renderer's already succeeded), it falls back to `NULL_EVAL_CONTEXT`:
  loud `#MEASURE`, not a silent wrong height.
- The pure transitions gain `context: EvalContext = NULL_EVAL_CONTEXT` as a trailing optional param,
  following `Viewport`'s "supplied per call rather than stored" precedent — `EvalContext` carries a
  function-bearing `measurer`, so it does NOT go on `AppState` (which is "plain data, replaced
  wholesale"). `submitLine`/`respondToPrompt`/`pointerDownAt`/`pointerMoveTo`/`commitPanelEdit`/
  `unlinkPanelSlot` (public); `advance`/`runPanelCommand` (internal, required param). Every existing
  call site keeps compiling and behaving identically via the default.
- `start`'s DOM listeners pass `evalContext` into each: the command `keydown` (`submitLine`), the
  canvas `pointerdown` (`pointerDownAt`) and `pointermove` (`pointerMoveTo`), the panel paperclip
  handlers (`commitPanelEdit`, `unlinkPanelSlot`), and the load path — `openDocument` grew a
  `context` param it hands to `loadDocument`.
- Header NOT DONE HERE: the "Injecting a Canvas2D `TextMeasurer`" bullet is rewritten — the
  injection is DONE; what remains is the `text` command and `renderer.ts`'s text pass.

### Tests (+227, four files, 9 new tests)

- **`command/commands.test.ts`** (+3): a hand-built `text` object in the document; `executeCommand`
  with a real fake measurer → `measuredHeight` is a real height, without one → `#MEASURE`. Covers
  the `writeSlot` path (`set text_1.style.fontSize`), the `createObject` path (`circle …` re-evals
  the co-resident text object), and D-120's `maxWidth` (`set text_1.width 120` → the fake's
  wrap-aware branch).
- **`render/interaction.test.ts`** (+1): `commit([rect, text])`, `pointerDown` on the rect,
  `pointerMove` with / without a real measurer → the text object's `measuredHeight` follows suit,
  and the drag itself still commits.
- **`engine/document.test.ts`** (+3): `saveDocument` a document with a `text` object, then
  `loadDocument` / `deserializeDocument` with / without a measurer → `#MEASURE` vs a real height;
  plus D-120's `maxWidth` on the load path.
- **`main.test.ts`** (+2): `submitLine` and `pointerMoveTo` with a `context` arg thread it end to
  end to `executeCommand` / `pointerMove`.

All nine use a constant-height fake so the assertion turns purely on *whether the measurer was
reached*, except the D-120 ones, whose fake returns `maxWidth === undefined ? 10 : 20`.

## Decisions I made

1. **`EvalContext` is threaded per call, not stored on `AppState`.** `AppState`'s doc comment says
   "plain data ... replaced wholesale"; a `TextMeasurer` is a function-bearing object. `Viewport` is
   already "supplied per call rather than stored" for a structurally similar reason (a service the
   pure half consumes but should not own), and this follows it. The cost is a trailing param on six
   public functions; the alternative makes `AppState` non-plain.
2. **`main.ts` builds its OWN offscreen 2D context for measurement**, never the renderer's. This is
   `render/measure.ts`'s header instruction (entry 0131 Decision) made real: `measure` sets
   `ctx.font` per line, and sharing `context` would change font mid-draw.
3. **A `null` second `getContext` falls back to `NULL_EVAL_CONTEXT`**, not a thrown error or a
   `logElement.textContent` fatal message (the renderer's own null-context path). `measuredHeight`
   is then `#MEASURE` — D-118's loud, self-explaining failure — which is strictly better than the
   app refusing to start over a measurer it may never need.
4. **The loader (`document.ts`) is threaded in the SAME slice as the command / drag paths**, even
   though it is load-bearing (§6.2), because "thread through every non-test `mutate` caller" is one
   coherent piece of work and a partial thread (commands wired, load not) would be a confusing
   in-between state. This is the slice 0130-REVIEW §7 named ("a real `EvalContext` threaded through
   the non-test `mutate` callers") and it makes the batch a clean review unit: the measurer, built
   (0131) and wired (0132).
5. **The internal handlers in `commands.ts` take a REQUIRED `context`**, not an optional one — the
   compiler then rejects any new `mutate`-reaching handler that forgets to thread it. Only the
   public entry points (`executeCommand`, and `main.ts`'s six) carry the `NULL_EVAL_CONTEXT`
   default, at the boundary where a real caller either supplies one or accepts the documented
   `#MEASURE` behaviour.

## Verification (real output)

```
$ npm run typecheck
> tsc --noEmit && tsc --noEmit -p tsconfig.engine.json
(clean, no output — both configs)

$ npx vitest run
 Test Files  30 passed (30)
      Tests  1427 passed (1427)
```

0 skipped, 0 `.only` (`grep -rnE "\.(only|skip|todo)\(" src/` → nothing).
Test count: 1418 → 1427 (+9): commands.test.ts 161→164, interaction.test.ts 33→34, main.test.ts
72→74, document.test.ts 32→35. No test file lost a test; no assertion changed.
Test files: 30 → 30 (no new file).

Diff, `git diff --numstat` (src only, this cycle): **+406 / −72 across 8 files** — commands.ts
+49/−37, commands.test.ts +68, document.ts +24/−4, document.test.ts +57, interaction.ts +9/−1,
interaction.test.ts +41, main.ts +97/−30, main.test.ts +61.

Batch since 0130-REVIEW: **16 src files, +792 / −100** (0131's 9 + this cycle's 8, `main.ts`
overlaps). The §6.3 cap is 3 cycles / ~800 lines / 10 files — the FILE count (16) is past 10 and
the line count (792) is at the limit, so this cycle ends the batch.

Mutation-check: removed `, context` from `deserializeDocument`'s `mutate([], operations, [])` call
→ **exactly 3 red**, all the new `document.test.ts` tests ("regenerates measuredHeight as #MEASURE
… and as a real height", "deserializeDocument takes the same context", "passes a numeric `width`
through as maxWidth on load"); `main.test.ts` (a different path) stayed green. Restored, 1427/1427.

## Acceptance criteria status

Phase 5 criterion ("a text box reading `Radius: {= table_x.A1 }{? … }` updates both its number and
its branch … **wraps at its set width** … re-renders when a value referenced only inside the
currently non-taken branch changes") — **NOT YET**, but closer: a `text` object loaded from JSON
now gets a real `measuredHeight` (wrap-aware via D-120's `maxWidth`) instead of `#MEASURE`.
Demonstrated (integration level): `document.test.ts` "regenerates measuredHeight … as a real height
once a measurer is threaded" and "passes a numeric `width` through as maxWidth on load". What still
blocks the gate: no `text` command to author one, and no text-drawing pass to see it.

## Where I got stuck / what is unfinished

- **Still no `text` command**, so the whole thread is exercised only through hand-built or
  JSON-loaded `text` objects. The wiring is correct and tested, but a `text` object is not yet
  reachable from the running app's command line — that is the next slice, and it owes the F13
  ruling (a `formula`-driven `content` slot — §6.1 trigger 3).
- **`main.ts`'s `start` is untested by construction (D-001).** The `evalContext` construction, the
  offscreen-canvas fallback, and every `evalContext` argument in a DOM listener are checked by hand
  and by the pure-half tests that prove the same functions thread `context` when given one — not by
  any assertion over `start` itself. Same standing gap as the rest of `start`.
- **`pointerMove`'s `context` only matters when a `text` object shares the document with the
  geometry being dragged.** A `text` object has no `origin` slot (§5.6), so it cannot itself be
  dragged; the thread is there so an *unrelated* drag does not clobber its `measuredHeight`. The
  interaction test builds exactly that two-object document to pin it.
- **`main.ts`'s broader "nothing evaluates text yet" framing** (noted stale since 0127 in entry
  0131) — the one bullet this cycle owns is now correct; the rest of that batch's doc debt is
  untouched, as before.

## Open questions raised

None. This cycle builds the contract D-118 and D-120 already ruled.

## Review point

Fired: **none from §6.1** — the change is an additive optional parameter, no brief deviation, no
test expectation changed, no dependency. But the **§6.3 batch cap is reached** (16 src files > 10;
792 lines ≈ 800) and the batch carries an unreviewed **load-bearing `document.ts`** signature
change (§6.2). Cycles since last review: 2/3.

REVIEW: REQUIRED
Reason: §6.3 batch cap hit (file count past 10, line count at ~800) and the batch includes a
load-bearing `document.ts` change (§6.2); this is also the Phase 5 measurer-wiring slice
0130-REVIEW §7 named, best reviewed as one unit with 0131's `render/measure.ts`.
Questions for reviewer:
  1. Threading `EvalContext` per call through `main.ts`'s pure half (six trailing optional params)
     vs. storing it on `AppState` — I took per-call to keep `AppState` plain, following `Viewport`'s
     precedent. Right call, or is a field on `AppState` (never serialized) the cleaner shape?
  2. The `null` second-`getContext` fallback to `NULL_EVAL_CONTEXT` (silent-ish degradation to
     `#MEASURE`) — acceptable, or should `start` surface it in the log the way it does the fatal
     renderer-context case?
  3. Loader threaded in the same slice as commands/drag despite `document.ts` being load-bearing —
     one coherent "wire the measurer everywhere" cycle, or should the load path have been its own?
  4. `render/measure.ts` (0131) is only now getting its first real caller. Does building it unwired
     one cycle earlier read as the right sequencing in hindsight, or should 0131 + 0132 have been
     one cycle?
