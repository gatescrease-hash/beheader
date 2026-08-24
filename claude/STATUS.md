# STATUS — as of entry 0057-render-camera

STATE: GREEN (compiles under both configs, 667/667 tests pass, 0 skipped, 0 `.only`).

**Process state: PHASE 3 OPEN, first slice built, REVIEW REQUIRED before the next.**
`render/camera.ts` (world<->screen transform, pan, zoom-to-cursor — §5.9) is built and tested, with
its own mutation-checked tests (D-016) — see entry 0057. This is `render/`'s first file, which
fires **§6.1 trigger 2** on its own: no further Phase 3 work should start until this is reviewed.

**Q-007 (`CameraState`'s shape) is resolved by implementation, entry 0057, pending reviewer
confirmation.** `render/camera.ts` is the real consumer 0025-REVIEW-phase0 named; `{ x, y, zoom }`
needed no widening. `document.ts`'s three `PROVISIONAL(Q-007)` tags are removed, per
0054-REVIEW-phase2 §7's own instruction to do so in this same cycle — but no `D-NNN` exists yet
(implementers cannot write `DECISIONS.md`). See entry 0057's "Decisions I made" and its two
questions for the reviewer. `OPEN_QUESTIONS.md`'s Q-007 entry is updated, not deleted.

Current phase: **3 — canvas, camera, geometry, command line.** One file built
(`render/camera.ts`); the rest is unstarted.
Phase 3 acceptance criterion (§6): *"you can create a polygon and a table by command, see both
drawn, pan/zoom, select, and drag the polygon."* Camera math (the pan/zoom half) exists; nothing
else does. NOT claimed as passing — no pixels yet.

Last review point: **0054-REVIEW-phase2, ACCEPT WITH EDITS** (covering 0052 + 0053; Phase 2 gate).
Cycles since last review: **1/3** · diff since last review: **~283 lines / 4 files** (cap
800/10) — moot, since §6.1 trigger 2 already forces a review point regardless of the cap.

## Next slice (recommended)

**Do not start it before this cycle is reviewed** (§6.1 trigger 2, and Q-007's pending
confirmation). Once reviewed, the next candidate is `render/renderer.ts` or `primitives/geometry.ts`
— either is Phase 3's next first-of-subsystem file and gets its own review point in turn
(0054-REVIEW-phase2 §8). `command/parser.ts` is the third. Geometry first is likely the more
natural order (something to render before a renderer is useful to test against), but this is the
reviewer's call to confirm or redirect.

## Built and reviewed

Phase 0 in full (0027-REVIEW) · the formula engine (0037-REVIEW) · `address.ts`'s column
arithmetic, `primitives/table.ts`'s first file (0041-REVIEW) · the dynamic slot family (0043-REVIEW)
· range evaluation wired end-to-end (0044+0046, reviewed 0045/0048) · row/column INSERTION (0047,
reviewed 0048/0049) · row/column DELETION (0050, reviewed 0051, fix list closed 0052) ·
`delete <table>` reject-until-`force` + D-057's broken-slot report channel (0053) — **all reviewed
and accepted at 0054-REVIEW-phase2.** Entry 0055's comment/header condensation and entry 0056's
D-060 ruling are prose-only, not code, and carry no unreviewed executable risk (0055's own
disclosure); 0055's prose diff is still flagged for audit at the next review, per 0056.

## Built this batch, not yet reviewed

- **`render/camera.ts` + `render/camera.test.ts` (entry 0057).** New file, new subsystem
  (`render/`). §6.1 trigger 2.
- **`document.ts`'s three `PROVISIONAL(Q-007)` doc-comment sites (entry 0057).** Comment-only;
  same fields, same validation.
- **`OPEN_QUESTIONS.md`'s Q-007 status line (entry 0057).** Updated in place, not deleted.
- 0055's prose diff — still outstanding for review, unchanged from before this cycle.

## Not started

`render/renderer.ts`, `render/hittest.ts`, `render/interaction.ts`, `render/measure.ts`,
`command/*`, `primitives/geometry.ts` (all of Phase 3 besides camera math) · Phases 4–7.

## Known problems

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
  the write site, `render/camera.ts`, as of this entry — see D-027's own binding) · journal
  STRUCTURE deliberately unvalidated beyond `Array.isArray` · `lexer.ts`'s two disclosed edge cases
  · §5.11's `style` field · `nextObjectId` reconciliation · `noUnusedLocals` off · recursion depth.

## Settled — do not re-raise

Every ruling in `DECISIONS.md` (D-001 through **D-060**) is binding without restatement here.

## Live PROVISIONAL tags and open questions

**Q-007 is RESOLVED BY IMPLEMENTATION (entry 0057), pending reviewer confirmation** — see above.
Its tags are removed; do not re-add them without a reviewer ruling first.
`PROVISIONAL(Q-008)` → `graph/node.ts`'s `isIllegalNumber`, still deferred, blocking nothing —
entry 0057's camera math introduces no new `-0` authoring path (proved in its own file header/log
entry); a future drag writing straight into `origin.x`/`origin.y` still raises it if that path
appears. Next free: **Q-012**.

## Gotchas for the next model

- **`render/` is the first non-`engine/` code — Rule 1 stops being free.** `render/camera.ts`
  itself imports only `engine/document.ts` (type-only) and `engine/graph/node.ts` (type-only) — no
  DOM, no canvas. Run BOTH typecheck configs every cycle; `tsconfig.engine.json` covers `src/engine`
  only, so `render/` is checked only by the root config.
- **Every Phase 3 subsystem's first file is its own §6.1 trigger-2 review point** — camera math is
  done; `render/renderer.ts`, `render/hittest.ts`/`interaction.ts`, `command/parser.ts`,
  `primitives/geometry.ts` remain. Do not batch them.
- **Camera convention: `camera.x`/`camera.y` is the world point at the screen's TOP-LEFT corner**,
  not the viewport center (`render/camera.ts`'s own file header states why). A geometry/renderer
  file assuming a center-based convention would be wrong.
- **A camera-producing function must guard against a non-finite result (D-027)** — `camera.ts`'s
  `finiteOrFallback` is the reference shape: fall back to the camera's own PRIOR value, not an
  arbitrary constant. No separate `-0` guard is needed there — see its doc comment for the proof
  (mirrors D-033's `add` reasoning) before assuming one is missing.
- **Dragging calls the mutation API, per component (§5.9).** Still not built — carried forward
  from 0054-REVIEW-phase2, unchanged by this cycle.
- **Comments describe the PRESENT (D-060, binding).** State the behaviour and the reason. A
  `(D-0XX)` citation is a supplement, never a substitute — ranked *Okay*, not *Good*. Headers are
  budgeted: 20-40 lines ordinary, ~80 load-bearing (PROCESS_BRIEF §5.2).
- **State every file you touched in the log entry, comment-only edits included.**
- Each PowerShell call is a fresh process; the Bash tool's `npm`/`npx` resolve directly and don't
  need PowerShell.
