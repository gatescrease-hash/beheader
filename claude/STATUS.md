# STATUS — as of entry 0058-REVIEW-phase3

STATE: GREEN (compiles under both configs, 670/670 tests pass, 0 skipped, 0 `.only`).

**Process state: PHASE 3 OPEN, reviewed and clear to continue.** Entry 0057 (`render/camera.ts`)
fired §6.1 trigger 2 and has been reviewed: **0058-REVIEW-phase3, ACCEPT WITH EDITS.** Entries 0055
and 0056 were reviewed in the same pass and are closed out — 0055's prose diff is no longer
outstanding.

**Q-007 is CLOSED: `ANSWERED → D-061`.** `CameraState` stays `{ x, y, zoom }`, and D-061 pins the
CONVENTION as well as the shape — `camera.x`/`camera.y` is the world point at the screen's
**top-left corner**, never the viewport centre. Entry 0057's removal of the `PROVISIONAL(Q-007)`
tags ahead of a minted `D-NNN` was confirmed correct (0054-REVIEW-phase2 §7 was binding authority).

Current phase: **3 — canvas, camera, geometry, command line.** One file built
(`render/camera.ts`); the rest is unstarted.
Phase 3 acceptance criterion (§6): *"you can create a polygon and a table by command, see both
drawn, pan/zoom, select, and drag the polygon."* Camera math (the pan/zoom half) exists; nothing
else does. NOT claimed as passing — no pixels yet.

Last review point: **0058-REVIEW-phase3, ACCEPT WITH EDITS** (covering 0055 + 0056 + 0057).
Cycles since last review: **0/3** · diff since last review: **0 lines / 0 files** (cap 800/10).

## Next slice (recommended)

**`primitives/geometry.ts`** — confirmed by 0058-REVIEW §8: something must exist to be drawn before
a renderer is testable against anything. It is its own §6.1 trigger-2 review point, as are
`render/renderer.ts`, `render/hittest.ts`, `render/interaction.ts`, and `command/parser.ts`. Do not
batch them. The D-060 test-file comment sweep (below) is comment-only and can ride along with any
cycle.

## Built and reviewed

Phase 0 in full (0027-REVIEW) · the formula engine (0037-REVIEW) · `address.ts`'s column
arithmetic, `primitives/table.ts`'s first file (0041-REVIEW) · the dynamic slot family (0043-REVIEW)
· range evaluation wired end-to-end (0044+0046, reviewed 0045/0048) · row/column INSERTION (0047,
reviewed 0048/0049) · row/column DELETION (0050, reviewed 0051, fix list closed 0052) ·
`delete <table>` reject-until-`force` + D-057's broken-slot report channel (0053) — all reviewed and
accepted at 0054-REVIEW-phase2 · **`render/camera.ts` + its tests (0057), entry 0055's comment and
header audit, and entry 0056's D-060 ruling — all reviewed and accepted at 0058-REVIEW-phase3.**

## Built this batch, not yet reviewed

Nothing. The tree is fully reviewed as of 0058-REVIEW-phase3.

## Not started

`render/renderer.ts`, `render/hittest.ts`, `render/interaction.ts`, `render/measure.ts`,
`command/*`, `primitives/geometry.ts` (all of Phase 3 besides camera math) · Phases 4–7.

## Known problems

- **A LOADED camera is not range-checked, and `render/` must not assume it is (D-062).**
  `deserializeDocument` enforces number LEGALITY only (finite, not `-0` — D-027), so `camera.zoom`
  of `0`, `-5`, or `1e-300` all load clean. At `zoom: 0`, `screenToWorld` returns `Infinity`
  without throwing; a renderer at `zoom: 0` collapses every object onto the origin. **Pinned by
  tests** (`render/camera.test.ts`, "KNOWN GAP (D-062)" describe block). The clamp is owed by
  whichever cycle first loads a document into a live canvas, at the `render/` boundary — NOT by
  `document.ts`, which cannot import `MIN_ZOOM` without violating Rule 1.
- **D-060 is not reconciled in test files** (0058-REVIEW Finding 2), despite D-060's own
  reconciliation clause saying it is: 13 bare "this cycle" sites (`mutation.test.ts` x9,
  `schema.test.ts` x2, `ast.test.ts` x1, one `describe` title) and 2 stale headers claiming
  "`mutation.ts` does not exist yet" (`graph/cycles.test.ts:4`, `graph/eval.test.ts:4`). Non-test
  source is clean (0 sites). Comment-only, blocks nothing.
- **Row/column deletion CAN still be REJECTED**, contradicting §5.4's "it proceeds even when other
  objects depend on the deleted cells": the address-repair pass is unbounded while the slot walk is
  extent-bounded, so a reference to an out-of-extent cell slot shifts to an empty position and
  dangles. Reachable only through a raw `setSlot` writing an out-of-extent cell. **Pinned by a test**
  (`mutation.test.ts`, "KNOWN INCOHERENCE" describe block, entry 0052). **D-053's companion ruling
  forbids fixing one side** — insertion has the identical divergence (0048-REVIEW case 4); both
  close together or not at all.
- **A dimension write is not checked for COHERENCE with the cells that exist, in general.** D-046
  settles the KIND; D-053 makes a resize reject unless BOTH dimensions are literal. Still unguarded:
  (a) a raw `setSlot` writing an INCOHERENT `literal` count, (b) a `setSlot` EARLIER IN THE SAME
  BATCH that changes a table's `rows`/`cols` value/kind AFTER `findInvalidTableResizes` has seeded
  its per-table tracked state.
- **No bound on how large `rows`/`cols` may be set** via a raw `setSlot`.
- **The dangling-reference message names the DEPENDENT, not the missing SOURCE**, and repeats once
  per missing cell (0045-REVIEW Finding 4, carried).
- **D-022's bounded-correctness claim does not hold for `table`** — narrowed/accepted at
  0043-REVIEW §7 Q1. Do not "fix" it; the pinning test stays as a tripwire.
- **`describeValueType` is duplicated verbatim** in `functions.ts` and `eval.ts` (0037-REVIEW
  Finding 4, carried).
- **`rewriteObjectFormulaAddresses`/`repairObjectFormulaAddresses` walk `formula`-kind slots only**
  — total TODAY, but §5.4 requires the pass to cover text boxes too once Phase 5 lands.
- **Carried unchanged:** `camera` has no WRITE-side guard inside `mutate` itself (D-027; guarded at
  the write site, `render/camera.ts`) · journal STRUCTURE deliberately unvalidated beyond
  `Array.isArray` · `lexer.ts`'s two disclosed edge cases · §5.11's `style` field ·
  `nextObjectId` reconciliation (and, per D-062, its domain is unchecked too — a non-integer or
  negative `nextObjectId` loads) · `noUnusedLocals` off · recursion depth.

## Settled — do not re-raise

Every ruling in `DECISIONS.md` (D-001 through **D-062**) is binding without restatement here.

## Live PROVISIONAL tags and open questions

Q-007 is **CLOSED (`ANSWERED → D-061`)**; its tags are gone and must not be re-added.
`PROVISIONAL(Q-008)` → `graph/node.ts`'s `isIllegalNumber`, still deferred, blocking nothing — no
new `-0` authoring path exists yet. Note `worldToScreen` can return a `-0` SCREEN coordinate
(0058-REVIEW §3); that is not a Q-008 concern, because a screen point is never document state. A
future drag writing straight into `origin.x`/`origin.y` still raises Q-008 if that path appears.
Next free: **Q-012**.

## Gotchas for the next model

- **A `CameraState` is only trustworthy if `render/camera.ts` produced it (D-062).** One that came
  off a loaded document is not range-checked. Do not write `screenToWorld`'s precondition off as
  paranoia — read its doc comment, which states exactly which cameras satisfy it.
- **Camera convention is now BINDING, not a gotcha: `camera.x`/`camera.y` is the world point at the
  screen's TOP-LEFT corner (D-061)**, not the viewport centre. A geometry/renderer file assuming a
  centre-based convention is off by half a viewport, and that bug looks like a drifting camera
  rather than a wrong constant. A future "fit" helper takes a viewport size PER CALL; it does not
  widen `CameraState`.
- **`render/` is not `engine/`, and Rule 1 stops being free here.** `render/camera.ts` imports only
  type-only from `engine/`. Run BOTH typecheck configs every cycle; `tsconfig.engine.json` covers
  `src/engine` only, so `render/` is checked by the root config alone.
- **Every Phase 3 subsystem's first file is its own §6.1 trigger-2 review point** — camera math is
  done; `primitives/geometry.ts`, `render/renderer.ts`, `render/hittest.ts`/`interaction.ts`,
  `command/parser.ts` remain. Do not batch them.
- **A camera-producing function must guard against a non-finite result (D-027)** —
  `finiteOrFallback` is the reference shape: fall back to the camera's own PRIOR value, not an
  arbitrary constant. No separate `-0` guard is needed there; see its doc comment for the proof
  (mirrors D-033's `add` reasoning) before assuming one is missing.
- **Dragging calls the mutation API, per component (§5.9).** Still not built.
- **Comments describe the PRESENT (D-060, binding — in TEST files too).** State the behaviour and
  the reason. A `(D-0XX)` citation is a supplement, never a substitute — ranked *Okay*, not *Good*.
  Never a bare "this cycle": name the entry. Headers are budgeted: 20-40 lines ordinary, ~80
  load-bearing (PROCESS_BRIEF §5.2).
- **Changing the world a neighbouring comment describes makes that comment stale.** `main.ts` said
  "`render/` does not exist yet" until 0057 created it and 0058-REVIEW caught it. When you add the
  first file of a subsystem, grep for the subsystem's name and re-read what you find.
- **State every file you touched in the log entry, comment-only edits included.**
- Each PowerShell call is a fresh process; the Bash tool's `npm`/`npx` resolve directly and do not
  need PowerShell.
