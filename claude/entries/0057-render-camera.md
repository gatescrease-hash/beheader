# 0057 — render/camera.ts
Date: 2026-08-24   Phase: 3   Model: implementer (Claude Sonnet 5)
Previous entry: 0056-RULINGS   Last review: 0054-REVIEW-phase2 (verdict: ACCEPT WITH EDITS, Phase 2
gate PASSED)
Batch: cycle 1 of up to 3 since last review; ~283 changed lines / 4 files so far (cap 800/10) —
moot: this cycle fires §6.1 trigger 2 on its own (first file of a new subsystem), so a review point
is mandatory regardless of the batch cap.

## Declared scope

Build `render/camera.ts` — world<->screen coordinate transform, pan, and zoom-to-cursor (§5.9) —
with its tests. In the same cycle, resolve Q-007 (`CameraState`'s shape) against the built
consumer and remove `document.ts`'s three `PROVISIONAL(Q-007)` tags, per STATUS.md's and
0054-REVIEW-phase2 §7's explicit instruction to do both together.

## Explicitly not in scope

- `render/renderer.ts`, `render/hittest.ts`, `render/interaction.ts`, `command/*`,
  `primitives/geometry.ts` — each is its own §6.1 trigger-2 review point (0054-REVIEW-phase2 §8),
  not a batch.
- Reading the mouse/wheel or any DOM event — `camera.ts` takes plain numbers; a future
  `render/interaction.ts` is the caller that reads events and computes them.
- "fit" (zoom to a bounding box) — needs a viewport size and a bounding box neither `camera.ts` nor
  anything built so far owns. Left for whichever cycle needs it.
- Widening `CameraState` — considered and NOT done; see "Decisions I made" below.

## What I did

**`src/render/camera.ts` (new file, first file of `render/`).** Implements §5.9's world<->screen
transform and its two camera-producing operations:

- `worldToScreen`/`screenToWorld` — pure reads, exact inverses of each other. Convention:
  `camera.x`/`camera.y` is the world point at the screen's top-left corner; `screen = (world -
  camera) * zoom`.
- `panByScreenDelta` — screen-space pixel delta -> new camera, zoom unchanged. Divides by zoom so
  the same screen-space drag moves less world distance at higher zoom.
- `zoomAtScreenPoint` — sets zoom to a caller-supplied target (clamped to `[MIN_ZOOM, MAX_ZOOM]`),
  repositioning the camera so the world point under `screenPoint` stays fixed on screen.
- `MIN_ZOOM`/`MAX_ZOOM` exported constants (0.01 / 100) — round numbers, not tuned (Rule 5), chosen
  only so zoom can never reach 0 (which would make `screenToWorld` divide by zero) or an unusable
  extreme.
- `finiteOrFallback`/`clampZoom` — the D-027 guard: both camera-producing functions reject a
  non-finite result in favour of the camera's own prior coordinate/zoom, per D-027's own forecast
  ("a NaN zoom out of a zoom-to-fit over an empty selection... guard it where it is computed").

**`src/render/camera.test.ts` (new file).** 14 tests: the transform's identity/scale/offset
behaviour, the exact-inverse round trip, pan's screen-delta-follows-cursor and zoom-dependent
scaling, zoom's fixed-point property, both zoom bounds (including `-0` resolving to `MIN_ZOOM`),
and the D-027 non-finite-input guard on both producers.

**`src/engine/document.ts`.** Three `PROVISIONAL(Q-007)` sites reworded to present tense, citing
`render/camera.ts` as the shape's real owner and stating the shape needed no widening (§5.2/D-060:
present tense, reason stated, citation as supplement). No behavioural change — same fields, same
`reconstructCamera` validation, same D-027 guard on load.

**`claude/OPEN_QUESTIONS.md`.** Q-007's status line updated: `RESOLVED BY IMPLEMENTATION, entry
0057 — awaiting reviewer confirmation to close as ANSWERED → D-NNN`. I did not write to
`DECISIONS.md` (PROCESS_BRIEF §2: implementers must never write to it) and did not invent a
`D-NNN` — see "Decisions I made" for why removing the tag this cycle is still correct.

## Decisions I made

- **`CameraState` needs no widening.** `{ x, y, zoom }` already suffices for every function this
  file needs, because none of `worldToScreen`/`screenToWorld`/`panByScreenDelta`/
  `zoomAtScreenPoint` requires a viewport size — only a screen-space point/delta the caller
  supplies per-call. 0025-REVIEW-phase0's constraint was "widen, never replace, if Phase 3 needs
  more" — it did not mandate widening, and I found no need for it. Reversible if a future cycle
  finds it insufficient (e.g. a "fit" helper wanting a stored default viewport size), per Q-007's
  own standing.
- **Camera-space convention: `camera.x`/`y` is the world point at the screen's top-left corner**,
  not the viewport center. Chosen because it needs no viewport size to define at all (a
  center-based convention would either need one stored or passed on every call), keeping
  `CameraState` at exactly the shape it already had.
- **Removed the `PROVISIONAL(Q-007)` tags without a `D-NNN` existing yet.** 0054-REVIEW-phase2 §7
  states directly: "The Phase 3 implementer MUST reconcile and remove the `PROVISIONAL(Q-007)` tag
  in the same cycle that lands `render/camera.ts` — not later." That is the reviewer's own binding
  instruction, issued in a review entry (not merely a STATUS.md restatement), and I judged it
  sufficient authority to act on even though Q-007 lacks a fresh `D-NNN` — the same way D-029's
  reviewer note in Q-009's own entry was treated as binding on `parser.ts`/`functions.ts` before a
  named `D-029` paragraph existed as its own citation target. I did NOT mark Q-007 `ANSWERED ->
  D-NNN` myself (that requires the reviewer or human, PROCESS_BRIEF §2) — I recorded the
  implementation as done and flagged it for confirmation. If the reviewer disagrees with this
  reading, the fix is one revert of the three doc-comment edits plus re-adding the tags — cheap,
  and disclosed here so it isn't discovered by surprise.
- **No `-0` guard alongside the non-finite guard in `finiteOrFallback`.** Proved (see the function's
  own doc comment) that subtracting or adding two already-legal (never-`-0`) finite operands cannot
  itself produce `-0` — the same proof technique D-033 already established for `add`'s `+`. Adding
  a dead branch would contradict Rule 5 ("the dumbest correct implementation," not a defensively
  padded one) without buying any real protection. Flagging this reasoning explicitly since it is
  the kind of claim D-031's history says gets checked by a probe, not taken on faith.

## Verification (real output)

```
$ npx tsc --noEmit
(clean, no output)

$ npx tsc --noEmit -p tsconfig.engine.json
(clean, no output)

$ npx vitest run --reporter=dot
 Test Files  16 passed (16)
      Tests  667 passed (667)
```

667 = 653 (0054's count) + 14 new. 0 skipped, 0 `.only`.

**Mutation-checked** (D-016), not merely run:

1. Flipped `zoomAtScreenPoint`'s `x`/`y` subtraction to addition (breaking the fixed-point
   property). Result: exactly 1 test failed — "keeps the world point under the cursor fixed on
   screen after the zoom changes" — the other 13 stayed green. Reverted; full suite back to
   667/667.
2. Replaced `finiteOrFallback`'s body with a bare passthrough (removing the D-027 guard). Result:
   exactly 1 test failed — "ignores a non-finite delta component and leaves that component of the
   camera unchanged (D-027)" — the other 13 stayed green. Reverted; full suite back to 667/667,
   both typechecks re-confirmed clean.

Both probes hit the single test written to defend the property being broken, and nothing else —
the load-bearing lines are the ones the tests actually pin, not merely lines a passing suite
happens to execute.

## Acceptance criteria status

Phase 3's criterion ("you can create a polygon and a table by command, see both drawn, pan/zoom,
select, and drag the polygon") is NOT claimed here — this cycle builds one piece of it
(world<->screen transform, pan, zoom-to-cursor) with no pixels yet. N/A for a phase-gate claim;
tracked as partial progress in STATUS.md.

## Where I got stuck / what is unfinished

- **Q-007's formal closure is incomplete by process letter.** I removed the `PROVISIONAL` tags and
  reworded the shape's doc comment on the reviewer's own prior instruction, but no `D-NNN` exists
  yet to cite — see "Decisions I made" above for the full reasoning and the cheap revert path if
  the reviewer disagrees with treating that instruction as sufficient authority.
- **The camera-space convention (top-left corner vs. viewport center) is an implementation choice,
  not tested against any brief wording beyond "world-space pan offset."** §5.9 does not specify
  it. Reversible — nothing outside this file and its own tests depends on which convention was
  picked, and the alternative is a small, local rewrite if a future cycle prefers it.
- **No integration with an actual `<canvas>` yet.** This file is pure math; `render/renderer.ts`
  (not started) is what will call `worldToScreen` per object and apply the transform via
  `CanvasRenderingContext2D.setTransform` or per-point math — I did not decide which, since that is
  that file's own call to make.

## Open questions raised

None new. Q-007 updated per above; Q-008 untouched, still OPEN, still deferred (nothing in this
cycle authors a `-0` through any new path — see "Decisions I made"). Next free: Q-012 (unchanged).

## Review point

**Fired: §6.1 trigger 2 — first file of a new subsystem (`render/camera.ts`, first file of
`render/`).** Per 0054-REVIEW-phase2 §8 clause 2, this stops immediately rather than batching, and
per 0025-REVIEW-phase0's own binding constraint, Q-007's resolution in this cycle needs reviewer
confirmation.

```
CYCLE 0057 COMPLETE
Slice: render/camera.ts (world<->screen transform, pan, zoom-to-cursor) + tests; Q-007 resolution
Files: 4 changed (src/render/camera.ts [new], src/render/camera.test.ts [new],
  src/engine/document.ts, claude/OPEN_QUESTIONS.md)
Tests: 667/667, 0 skipped   Typecheck: clean (both configs)
Phase 3 criterion: NOT claimed — partial progress only
Review point: §6.1 trigger 2 (first file of render/)
Open questions: Q-007 resolved-by-implementation, pending reviewer confirmation
REVIEW: REQUIRED
Reason: first file of a new subsystem (render/) — 0054-REVIEW-phase2 §8 names this explicitly
Questions for reviewer:
  1. Is 0054-REVIEW-phase2 §7's "reconcile and remove the PROVISIONAL(Q-007) tag in the same
     cycle" instruction sufficient authority to remove the tags without a fresh D-NNN, or should
     Q-007 have stayed tagged pending a numbered ruling in this same review?
  2. Does the camera-space convention (camera.x/y as the screen-origin world point, not the
     viewport center) need to be a DECISIONS.md entry, given a future geometry/render file could
     plausibly assume the other convention?
```
