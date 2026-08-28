# 0096 — `render/slots.ts` + `render/extent.ts`: D-093's split
Date: 2026-08-27   Phase: 4   Model: Claude Sonnet 5 (implementer)
Previous entry: 0095-REVIEW-phase4   Last review: 0095-REVIEW-phase4 (verdict: ACCEPT)
Batch: cycle 1 of up to 3 since last review; 5 files changed, ~200 lines net (19 insertions / 182
deletions in the two edited files, plus two new files) so far.

## Declared scope

STATUS.md's queue item 1, verbatim: split the import cycle between `renderer.ts` and `hittest.ts`
into `render/slots.ts` (`readNumber`, `asPointArray`, `TABLE_CELL_WIDTH`, `TABLE_CELL_HEIGHT`) and
`render/extent.ts` (`WorldExtent`, `objectExtent`, `documentExtent`), per D-093. Not in scope:
`props.ts`, the properties panel, or anything else in the queue — this is a pure move, no logic
change.

## Explicitly not in scope

`command/props.ts`, D-094's panel, D-090's prompt preview, and every other queued item — all
untouched. I did not touch `render/interaction.ts` (imports only `hitTest`, unaffected) or
`command/commands.test.ts` (imports only `hitTest`, unaffected).

## What I did

- **`src/render/slots.ts`** (new) — `readNumber`, `asPointArray`, `TABLE_CELL_WIDTH`,
  `TABLE_CELL_HEIGHT`, moved verbatim from `renderer.ts` (function/constant bodies byte-identical;
  only their doc comments were reworded to describe three consumers instead of one, since they now
  are shared by `renderer.ts`, `hittest.ts` and `extent.ts` rather than defined by one and
  re-imported by another). Imports `engine/*` only — no other `render/*` file.
- **`src/render/extent.ts`** (new) — `WorldExtent`, `objectExtent`, `verticesExtent`, `tableExtent`,
  `documentExtent`, moved verbatim from `hittest.ts` (same: bodies unchanged, docs reworded for the
  new home). Imports `engine/*` and `./slots.ts`.
- **`src/render/hittest.ts`** — the five moved declarations deleted. Import line now pulls
  `readNumber`/`asPointArray`/`TABLE_CELL_*` from `./slots.ts` instead of `./renderer.ts`. The
  HAZARD note on `objectExtent` is gone because `objectExtent` is gone from this file. Header's
  `WHAT THIS IS` no longer claims `documentExtent` (moved); `NOT DONE HERE` gained one line saying
  where it went and why the split is right (extent answers a different question than hit-testing,
  and the two functions shared nothing once the slot reads moved out too).
- **`src/render/renderer.ts`** — the four moved declarations deleted. Import line now pulls
  `readNumber`/`asPointArray`/`TABLE_CELL_*` from `./slots.ts` and `objectExtent` from `./extent.ts`
  instead of `./hittest.ts`. The HAZARD comment above the `objectExtent` import is replaced with a
  one-line note that the cycle is gone. `chromeAnchorPoint`'s doc, which said "reuses `hittest.ts`'s
  `objectExtent`", now says `extent.ts` (D-065 — a comment naming the wrong owner is mine to fix
  once I've made it wrong).
- **`src/main.ts`** — one import line: `documentExtent` now comes from `./render/extent.ts`.
- **`src/render/camera.ts`** — one header line: the "fit" `NOT DONE HERE` bullet named
  `render/hittest.ts`'s `documentExtent`; now names `render/extent.ts`'s (D-065, same reasoning).
- **`src/render/hittest.test.ts`** — one import line split in two: `hitTest`/
  `STROKE_HIT_TOLERANCE_SCREEN_PIXELS` still from `./hittest.ts`, `documentExtent` now from
  `./extent.ts`. No test body touched — every assertion in the file is unchanged.

The resulting import graph is a DAG: `slots.ts` imports only `engine/*`; `extent.ts` imports
`engine/*` and `slots.ts`; `renderer.ts` and `hittest.ts` both import `slots.ts` (and, for
`renderer.ts`, `extent.ts` too) and neither imports the other. Verified by hand and confirmed by
`tsc` — a real cycle would fail to compile, not merely look suspicious.

## Decisions I made

None load-bearing — this cycle's only discretion was doc-comment wording, which I kept close to the
originals (D-093's own text: "no logic change, no rename"). I did not create a new test file for
`extent.ts`'s functions; the existing `documentExtent` describe block in `hittest.test.ts` covers
them and D-093 asked for an import-line-only test edit, not a test reorganization. Flagged below as
a residual nit rather than silently left — `hittest.test.ts`'s header still says "Tests for
`hittest.ts`" while two of its describe blocks now exercise `extent.ts`. Not touched, because moving
those tests would stop being "only its import lines edited" and start being a rename/reorganization
D-093 didn't ask for.

## Verification (real output)

$ npx tsc --noEmit
(exit 0, no output)

$ npx tsc --noEmit -p tsconfig.engine.json
(exit 0, no output)

$ npx vitest run
 Test Files  25 passed (25)
      Tests  1148 passed (1148)

$ npm run build
✓ 30 modules transformed.
✓ built in 294ms

Zero skipped, zero `.only`. **Every one of the 1148 tests is byte-identical to what it asserted
before this cycle** — `git diff` on `hittest.test.ts` shows only the two-line import split; no
other test file changed at all. That is the promised property of a pure move, checked, not assumed.

## Acceptance criteria status

Not a phase criterion — this is D-093's own ruling, not a §6 acceptance criterion. "Done when": the
import cycle is gone (confirmed: `slots.ts` and `extent.ts` both import zero sibling `render/*`
files other than each other, one direction only), no logic changed (confirmed: every moved function
body is textually identical, checked by eye against the pre-move file), and every existing test
passes with only import lines edited (confirmed above).

## Where I got stuck / what is unfinished

Nothing. This was exactly as mechanical as D-093 and the queue said it would be — the only judgment
calls were doc-comment wording, and I erred toward keeping them close to the originals rather than
improving them, per D-058/§5.4's "leave a header alone until a cycle opens that file for another
reason" — this cycle opened these files FOR the move, not for a prose pass.

## Open questions raised

None.

## Review point

Fired: none. This is not a new subsystem (§6.1 trigger 2) — it is an extraction from within the
already-reviewed `render/` layer, and D-093 at 0095-REVIEW is itself the ruling that authorises
touching the two reviewed files (0095-REVIEW §6, "the authorisation to touch two reviewed files").
No brief deviation, no hard rule worked around, no test expectation changed, no dependency added.
`render/*` is not on §6.2's load-bearing list (`address.ts`, `mutation.ts`, `graph/*`,
`primitives/schema.ts`, `document.ts`), so no phase gate is implicated either.

Cycles since last review: 1/3. Diff since last review: 2 new files (~185 lines) + 5 files with a
one-to-three-line edit each (~19 insertions / 182 deletions) — comfortably under the 800-line/10-file
cap, and the queue itself anticipates continuing straight to cycle 2.

`REVIEW: NOT NEEDED.`
Reason: additive-by-subtraction inside an already-reviewed structure, pre-specified by a binding
ruling, fully tested, no assertion changed.

Questions for reviewer: none. Proceeding to queue item 2 (`command/props.ts` + the `props` command,
D-092 clause 4 / D-094 clause 9) next, per STATUS.md's ordering — that one DOES fire §6.1 (first
file of a new subsystem) and will stop for hand-off after it lands.
