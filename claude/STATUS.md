# STATUS — as of entry 0061-render-renderer

STATE: GREEN (compiles under both configs, 731/731 tests pass, 0 skipped, 0 `.only`).

**Process state: PHASE 3 OPEN. Entry 0061 built `render/renderer.ts` and fired its own §6.1
trigger-2 review point (named in advance by 0060-REVIEW §10) — awaiting review.**

Current phase: **3 — canvas, camera, geometry, command line.** Three files built
(`render/camera.ts`, `primitives/geometry.ts` — both reviewed; `render/renderer.ts` — new this
batch, unreviewed). `render/hittest.ts`, `render/interaction.ts`, `command/*` are unstarted.
Phase 3 acceptance criterion (§6): *"you can create a polygon and a table by command, see both
drawn, pan/zoom, select, and drag the polygon."* Camera math, the geometry primitive, and a tested
renderer for circle/polygon/rect/table now exist; there is still no command line to create anything
and no `main.ts` wiring to see it on an actual screen. NOT claimed as passing.

Last review point: **0060-REVIEW-phase3, ACCEPT WITH EDITS** (covering entry 0059).
Cycles since last review: **1/3** · diff since last review: **2 files / ~660 lines** (cap 800/10) —
moot: entry 0061 is its own mandatory review point (§6.1 trigger 2), not a batching candidate.

## Next slice (recommended)

**Send entry 0061 to review first** — `render/renderer.ts` is a §6.1 trigger-2 file and Phase 3 may
not open `render/hittest.ts`/`render/interaction.ts` on top of unreviewed code touching the same
subsystem without one. After that clears, `render/hittest.ts` (screen point -> topmost object) is
the next §6.1 trigger-2 file per 0060-REVIEW §10's own ordering, followed by
`render/interaction.ts` (click/drag -> mutation calls, §5.9) and then `command/parser.ts`. Wiring
`main.ts` to actually show something on screen makes most sense once there is a command line to
create an object with — entry 0061 deliberately did not stub a hardcoded demo document.

## Built and reviewed

Phase 0 in full (0027-REVIEW) · the formula engine (0037-REVIEW) · `address.ts`'s column
arithmetic, `primitives/table.ts`'s first file (0041-REVIEW) · the dynamic slot family (0043-REVIEW)
· range evaluation wired end-to-end (0044+0046, reviewed 0045/0048) · row/column INSERTION (0047,
reviewed 0048/0049) · row/column DELETION (0050, reviewed 0051, fix list closed 0052) ·
`delete <table>` reject-until-`force` + D-057's broken-slot report channel (0053) — all reviewed and
accepted at 0054-REVIEW-phase2 · `render/camera.ts` (0057), entry 0055's comment/header audit, and
entry 0056's D-060 ruling — accepted at 0058-REVIEW-phase3 · `primitives/geometry.ts`'s three
parametric presets and their nine derived slots, registered in `primitives/schema.ts` (0059) —
accepted at 0060-REVIEW-phase3.

## Built this batch, not yet reviewed

**`render/renderer.ts` (entry 0061)** — `renderDocument`: clear, apply the camera transform (built
from `camera.ts`'s own `worldToScreen`, D-010), draw every object in array order. `circle` draws a
true arc (§5.5); `polygon`/`rect` stroke the derived `vertices` path; `table` draws a fixed-size
grid with per-cell text (§5.4's alignment rule). 17 new tests, no jsdom (a hand-built
`CanvasRenderingContext2D`-shaped fake, cast via `as unknown as`). This is entry 0061's own §6.1
trigger-2 review point — it does not batch further regardless of the cap above.

## Not started

`render/hittest.ts`, `render/interaction.ts`, `command/*`, `polyline`/`explode`/`addvertex`/
`delvertex` (deferred deliberately — entry 0059), `main.ts` wiring, selection/error-badge/
formula-driven-slot visual feedback (§5.9, deferred — entry 0061's own NOT DONE HERE), `style`
slots on geometry objects, a table's own `origin.x`/`origin.y` schema entry (renderer falls back to
`(0,0)` until then — entry 0061 Decision 4) · Phases 4–7.

## Known problems

- **`sides` has no upper bound** (0060-REVIEW fix list 2, still open). Same class as `rows`/`cols`
  below; a rendered table/polygon this large would also be slow to DRAW, not only to evaluate — the
  fix (if any) should cover all three together, per D-064's neighbouring ruling area. **Do not fix
  in isolation.**
- **No bound on how large `rows`/`cols` may be set** via a raw `setSlot`. As of entry 0061 this also
  bounds how large a table the renderer will attempt to draw — same non-fix stance as above.
- **A loaded camera is not range-checked (D-062)** — only a `CameraState` `render/camera.ts` itself
  produces carries the `[MIN_ZOOM, MAX_ZOOM]` guarantee. The clamp is owed by whichever cycle first
  loads a document into a live canvas, at the `render/` boundary. `render/renderer.ts` does not
  itself divide by `camera.zoom` (only `worldToScreen`/`screenToWorld` do), so this cycle neither
  closes nor worsens the gap.
- **D-060/D-063 not reconciled in test files** (0058-REVIEW Finding 2): 13 bare "this cycle" sites
  (`mutation.test.ts` ×9, `schema.test.ts` ×2, `ast.test.ts` ×1, one `describe` title) and 2 stale
  headers claiming "`mutation.ts` does not exist yet" (`graph/cycles.test.ts:4`,
  `graph/eval.test.ts:4`). Non-test source, including entry 0061's two new files, is clean (checked
  directly — no "this cycle" sites). Comment-only, blocks nothing.
- **Row/column deletion CAN still be REJECTED**, contradicting §5.4's "it proceeds even when other
  objects depend on the deleted cells" — the address-repair pass is unbounded while the slot walk is
  extent-bounded. Reachable only through a raw `setSlot` writing an out-of-extent cell. Pinned by a
  test (`mutation.test.ts`, "KNOWN INCOHERENCE", entry 0052). D-053's companion ruling forbids
  fixing one side — insertion has the identical divergence; both close together or not at all.
- **A dimension write is not checked for COHERENCE with the cells that exist, in general** (D-046/
  D-053's narrower coverage). Still unguarded: a raw `setSlot` writing an incoherent literal count,
  and a same-batch dimension change landing after `findInvalidTableResizes` seeds its tracked state.
- **The dangling-reference message names the DEPENDENT, not the missing SOURCE**, repeating once
  per missing cell (0045-REVIEW Finding 4, carried).
- **D-022's bounded-correctness claim does not hold for `table`** — narrowed/accepted at
  0043-REVIEW §7 Q1; the pinning test stays as a tripwire.
- **`describeValueType` is duplicated verbatim** in `functions.ts` and `eval.ts` (0037-REVIEW
  Finding 4, carried).
- **`rewriteObjectFormulaAddresses`/`repairObjectFormulaAddresses` walk `formula`-kind slots only**
  — total today, but §5.4 requires the pass to cover text boxes too once Phase 5 lands.
- **A `table` object has no `origin.x`/`origin.y` schema entry** (entry 0061 Decision 4) —
  `render/renderer.ts` reads those paths anyway (the same ones `circle`/`polygon`/`rect` already
  use) and falls back to `(0,0)` when absent. Whoever builds the table-creation command should add
  a real `origin.x`/`origin.y` pair to `TABLE_SCHEMA` using these same paths; the renderer needs no
  change when that lands.
- **Mixed line endings**: entry 0059's two files are LF, the rest of the repo (including entry
  0061's two new files) is CRLF, and there is no `.gitattributes` (0060-REVIEW fix list 4).
  Harmless; know it before blaming a whitespace-only diff on a tool.
- **Carried unchanged:** journal STRUCTURE deliberately unvalidated beyond `Array.isArray` ·
  `lexer.ts`'s two disclosed edge cases · §5.11's `style` field · `nextObjectId` reconciliation (and,
  per D-062, its domain is unchecked too) · `noUnusedLocals` off · recursion depth.

## Settled — do not re-raise

Every ruling in `DECISIONS.md` (D-001 through **D-064**) is binding without restatement here.

## Live PROVISIONAL tags and open questions

None live. Q-008 remains OPEN, deferred, blocking nothing (unchanged since 0060-REVIEW). Q-001/
Q-002 come due at `command/parser.ts`. Next free: **Q-012**.

## Gotchas for the next model

- **`createObject` requires the caller to supply ALL derived-slot placeholders** — nine of them for
  a preset (D-018; probed at 0060-REVIEW, omitting them fails with nine "slot does not exist"
  messages). The command layer that creates a `circle` by typing `circle` must build them from
  `getObjectSchema`. Copy `geometry.test.ts`'s own `derivedPlaceholders` helper (also copied
  verbatim into `renderer.test.ts`'s one integration test) — that is the pattern.
- **All three presets wind COUNTERCLOCKWISE, and D-064 makes that a stated invariant**, not an
  accident. The renderer's fill rule, any winding-number hit test, and `explode` (which snapshots
  `vertices` in this order into user-editable slots) all inherit it. A pinning test is still owed
  (0060-REVIEW fix list 1, still open — `render/renderer.ts` did not add one; it does not fill
  shapes at all yet, so winding does not yet affect what is drawn).
- **A slot's stored key is the PATH joined with `.` (`slotKey`), not the surface form the user
  types** — a table cell is stored at `cells.A1`, never bare `A1` (D-005). Entry 0061's own first
  test-writing mistake was building fixtures with the bare form; see that entry's "Where I got
  stuck" for the concrete failure shape.
- **Centroid is the AREA-WEIGHTED centroid, not the vertex mean** — deliberate, confirmed correct at
  0060-REVIEW §7 Q2. Read `computeCentroid`'s doc comment before "simplifying" it.
- **The geometry derived slots are deliberately redundant in their arithmetic** — Rule 5 and §4
  working as intended (0060-REVIEW §1). **Do not "fix" it.**
- **Comments describe the PRESENT (D-060, and now D-063).** A NEW file's header states what the file
  IS — never "this cycle builds X", never a pointer to a diff. Date by entry number ("entry 0061").
- **Do not self-declare a file "load-bearing per Rule 3."** §6.2's list is exactly `address.ts`,
  `mutation.ts`, `graph/*`, `primitives/schema.ts`, `document.ts`. Being a subsystem's first file
  (or, per 0060-REVIEW §10, the first file with real drawing logic under `render/`) fires §6.1
  trigger 2 (a review point); it does not add you to §6.2 (a phase gate). `render/renderer.ts`'s own
  header states this explicitly, following `geometry.ts`'s corrected precedent.
- **Camera convention: `camera.x`/`camera.y` is the world point at the screen's TOP-LEFT corner
  (D-061)**, not the viewport centre.
- **`render/` is not `engine/`, Rule 1 stops being free there.** Run BOTH typecheck configs every
  cycle.
- **No jsdom in this repo.** `render/renderer.test.ts` fakes `CanvasRenderingContext2D` by hand
  (a plain object implementing only the members actually called, cast via `as unknown as`) rather
  than adding a jsdom dev dependency — adding one would be a §6.1 trigger-6 escalation
  (PROCESS_BRIEF: "you added a dependency"). Copy this pattern for `hittest.ts`/`interaction.ts`'s
  own tests rather than reaching for jsdom.
- **Dragging calls the mutation API, per component (§5.9).** Still not built.
- **State every file you touched in the log entry, comment-only edits included.**
- Each PowerShell call is a fresh process; the Bash tool's `npm`/`npx` resolve directly and don't
  need PowerShell.
