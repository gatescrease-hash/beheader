# 0117 — D-109 clause 3: a refused line stays in the input; only an accepted one clears it
Date: 2026-09-01   Phase: 5 (fix-list item, not Phase 5's own content)   Model: Claude Sonnet 5
Previous entry: 0116-REVIEW-phase4-gate   Last review: 0116-REVIEW-phase4-gate (verdict: ACCEPT WITH EDITS)
Batch: cycle 1 of up to 3 since last review; 2 files, 82 insertions / 14 deletions so far.

## Declared scope

**D-109 clause 3 only** — the smallest item on 0116-REVIEW §10's recommended order: `main.ts`'s
command-bar `keydown` listener currently clears `input.value` unconditionally before submitting the
line; it must clear only when the line was accepted, and leave a refused line in place for
correction. Not in scope: D-109 clauses 1-2 (cell decimals/clipping, `render/` only), D-110 (the
empty-cell reversal), Q-017's headers, select-all-on-refusal (D-109 clause 3 permits it but does not
require it), or anything from Phase 5 itself.

## Explicitly not in scope

Command-history recall (D-089, explicitly not discharged by this — D-109 clause 4 says so directly).
The properties panel's own row editor (`panelEditInput`) — it is a different `<input>` with its own
seed/commit path (D-102, D-107) and D-109's ruling is scoped to "`main.ts`'s command input listener"
by its own binding line, which is the command bar, not the panel.

## What I did

**`src/main.ts`**

- `AppTransition` (§5.10/§5.11's transition-result type) gains a third field, `refused: boolean`,
  alongside the existing `state`/`fileRequest` — the same "return a description, let the DOM half
  act on it" shape `fileRequest` already established (D-075's own reasoning), applied one layer up
  for D-109 clause 3.
- `transition()`, the one helper nearly every branch of `advance()`/`performEffect()` returns
  through, takes `refused` as an optional second parameter defaulting to `false` — so every branch
  that was never about a refusal (a selection effect, a zoom, a fit, a plain canvas click) needed no
  change at its own call site.
- `advance()` — the one place that already knows whether a submitted line was accepted or refused —
  sets it explicitly at the three places that know the answer:
  - `"complete"` + `!outcome.ok` → `true` (a mistyped address, a cyclic formula, a D-097 dimension
    refusal, a `#PARSE` — D-109 clause 3's own list of examples, all reached here).
  - `"prompting"` → `session.error !== undefined`. This extends clause 3's principle one step
    further than its own worked examples reach: a live multi-step sequence (`circle`, then a point,
    then a radius) re-asks the SAME step with `session.error` set when that step's own answer was
    refused (D-072 clause 7), and clears it — moving to the next step — when the answer was
    accepted. Losing a mistyped radius answer is the identical pain D-109 describes for a mistyped
    `set`; I read the ruling's general sentence ("a refused command leaves the typed line... only a
    SUCCESSFUL one clears it") as covering this case too, and I'm recording the read here rather than
    treating it as self-evidently in scope, since the ruling's own examples don't include it.
  - `"failed"` / `"cancelled"` → `true`. `"cancelled"` is not actually reachable through this path —
    `respond()` never returns it, and `escape()` builds `cancelled` directly without going through
    `advance()` — so this is the safe default for TypeScript's exhaustiveness, not an exercised
    branch. Said so in the code comment rather than leaving it to look load-bearing.
- `performEffect()`'s two direct object-literal returns (`save`, `load`) get `refused: false`
  explicitly, since `performEffect` is reached only after `outcome.ok` was already `true` — every
  path through it is a successful command by construction.
- The `keydown` listener itself: captures `input.value` into `line` as before, calls `submitLine`,
  and now clears `input.value` only `if (!outcome.refused)`. `applyTransition(outcome)` runs either
  way, unchanged.
- File header: added D-109 clause 3 to the "Binding here" list and one line to "INVARIANTS UPHELD
  HERE" naming the mechanism (`AppTransition.refused`), matching the header's existing per-ruling
  bullet style rather than leaving the new field undocumented at the top of the file.

**`src/main.test.ts`** — one new `describe` block, seven tests, all going through `submitLine` as the
file's own convention requires (never hand-building `AppTransition`s): an accepted complete command,
a refused complete command, an unparseable line, a bare command word entering its prompt sequence
(not refused — nothing was refused yet), an accepted prompt-step answer (not refused, moves to the
next step), a refused prompt-step answer (refused, re-asks the same step), and an accepted command
that also requests a file (`save` — not refused, `fileRequest` still `"save"`).

## Decisions I made

1. **`refused` lives on `AppTransition`, not on a narrower type returned only by `submitLine`.**
   `advance()` is the single place that computes it and it is shared by `submitLine` and
   `respondToPrompt` (a canvas pick answering a prompt step). Narrowing the type to `submitLine`
   alone would have meant either duplicating `advance()`'s logic or threading a second return value
   through every intermediate function. Widening the existing, already-generic transition-result type
   is the smaller diff and matches the file's own precedent (`fileRequest`).
2. **Extended clause 3 to a refused prompt-step answer**, not only a refused complete command — see
   the `"prompting"` bullet above. This is the one place I went beyond the ruling's literal examples;
   recorded here per PROCESS_BRIEF §5's "decisions I made" rather than silently assumed. Reversible
   in one line (drop the `session.error !== undefined` and pass `false`) if the human reads clause 3
   narrower than I did.
3. **Did not implement select-all-on-refusal.** D-109 clause 3 explicitly permits it without
   requiring it ("Select-all-on-refusal is permitted... silently re-running anything is not"). Left
   for a later cycle if the human wants it — it's a one-line addition (`input.select()`) once decided.

## Verification (real output)

```
$ npx tsc --noEmit -p tsconfig.json
(clean, no output)
$ npx tsc --noEmit -p tsconfig.engine.json
(clean, no output)
```

```
$ npx vitest run
 Test Files  27 passed (27)
      Tests  1276 passed (1276)
```

`grep -rnE "\.(only|skip|todo)\(" src/` → nothing. Zero skipped, zero `.only`.

**Mutation check**, per the standing rule that a test passing on its first run is not yet trusted:
reverted the two `advance()` sites that pass `true`/`session.error !== undefined` back to a hardcoded
`false` (the pre-fix behaviour), leaving everything else — including the new tests — untouched, and
ran only the new describe block:

```
$ npx vitest run src/main.test.ts -t "REFUSED"
 × IS refused for a complete command the handler rejects
   → expected false to be true
 × IS refused when a prompt step's own answer is refused, so the same step re-asks (D-072 clause 7)
   → expected false to be true
 Tests  2 failed | 5 passed (7)
```

Both of the tests that assert `refused: true` went red exactly as expected; the five asserting
`refused: false` correctly stayed green (nothing about them changed). Reverted the mutation; full
suite re-run afterward and confirmed green again (output above is post-revert).

## Acceptance criteria status

Not a phase acceptance criterion — this is a `DECISIONS.md` ruling (D-109 clause 3), not a §6
criterion. Demonstrated by the seven tests above plus the mutation check.

## Where I got stuck / what is unfinished

Nothing got stuck. What's left of D-109 is clauses 1-2 (cell text decimals/clipping in
`render/renderer.ts`), unstarted, and unrelated to this file. `STATUS.md`'s known-problems entry for
"a refused command DISCARDS what the operator typed" is now false and is removed below; F8 in the
open fix list is marked done, mirroring how fix-list item 1 was marked done-and-listed at entry 0112.

## Open questions raised

None.

## Review point

Fired: none — no §6.1 trigger. `main.ts` is not on §6.2's load-bearing list (`address.ts`,
`mutation.ts`, `graph/*`, `primitives/schema.ts`, `document.ts`), no test's *expectation* changed
(all 1269 previously-passing tests still pass unchanged; 7 were added), no hard rule was worked
around, no dependency/build step/config file was added, and this is not a phase gate. Cycles since
last review: 1/3. Diff since last review: 82 lines / 2 files (cap 800/10).

REVIEW: NOT NEEDED
Reason: additive work inside an already-reviewed file (`main.ts`, last touched under review at
0113-REVIEW), fully tested, no §6.1 trigger, well under the §6.3 cap.
