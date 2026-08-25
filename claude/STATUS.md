# STATUS — as of entry 0062-REVIEW-phase3

STATE: GREEN (compiles under both configs, 732/732 tests pass, 0 skipped, 0 `.only`).

**Process state: PHASE 3 OPEN, and CLEAR TO PROCEED. Entry 0061 (`render/renderer.ts`) was
reviewed at 0062-REVIEW-phase3: ACCEPT WITH EDITS. `render/hittest.ts` is open as the next slice.**

Current phase: **3 — canvas, camera, geometry, command line.** Three files built
(`render/camera.ts`, `primitives/geometry.ts`, `render/renderer.ts` — all three reviewed).
`render/hittest.ts`, `render/interaction.ts`, `command/*` are unstarted.
Phase 3 acceptance criterion (§6): *"you can create a polygon and a table by command, see both
drawn, pan/zoom, select, and drag the polygon."* Camera math, the geometry primitive, and a tested
renderer for circle/polygon/rect/table now exist; there is still no command line to create anything
and no `main.ts` wiring to see it on an actual screen. NOT claimed as passing.

Last review point: **0062-REVIEW-phase3, ACCEPT WITH EDITS** (covering entry 0061).
Cycles since last review: **0/3** · diff since last review: **0 files / 0 lines** (cap 800/10).

## Next slice (recommended)

**`render/hittest.ts`** (screen point -> topmost object) — the next §6.1 trigger-2 file, per
0060-REVIEW §10 and 0062-REVIEW §10. Then `render/interaction.ts` (§5.9), then `command/parser.ts`;
`main.ts` wiring makes sense once a command line exists to create an object with. Carry three things
in (0062-REVIEW §10): D-064's winding is load-bearing for a winding-number test **and its pinning
test is still owed**; §5.9's "pixel tolerance" needs `camera.zoom` to reach world units, so read
**Q-012** first; and copy `renderer.test.ts`'s context fake rather than reaching for jsdom.

## Built and reviewed

Phase 0 in full (0027-REVIEW) · the formula engine (0037-REVIEW) · the whole table primitive —
column arithmetic, the dynamic slot family, range evaluation, row/column insertion and deletion,
`delete <table>`'s `force` flag (0041 through 0053) — accepted at 0054-REVIEW-phase2 ·
`render/camera.ts` plus entry 0055's header audit and entry 0056's D-060 ruling (0058-REVIEW) ·
`primitives/geometry.ts`'s three presets and their nine derived slots (0059, 0060-REVIEW) ·
**`render/renderer.ts` (0061) — accepted at 0062-REVIEW-phase3.**

## Built this batch, not yet reviewed

Nothing — the tree is fully reviewed as of 0062-REVIEW-phase3.

## Not started

`render/hittest.ts`, `render/interaction.ts`, `command/*`, `polyline`/`explode`/`addvertex`/
`delvertex` (entry 0059), `main.ts` wiring, §5.9's selection/error-badge/formula-driven-slot visual
feedback (entry 0061), `style` slots, a table's own `origin.x`/`origin.y` schema entry · Phases 4–7.

## Known problems

- **`sides` has no upper bound** (0060-REVIEW fix list 2, still open). Same class as `rows`/`cols`
  below; a rendered table/polygon this large would also be slow to DRAW, not only to evaluate — the
  fix (if any) should cover all three together, per D-064's neighbouring ruling area. **Do not fix
  in isolation.**
- **No bound on how large `rows`/`cols` may be set** via a raw `setSlot`. As of entry 0061 this also
  bounds how large a table the renderer will attempt to draw — same non-fix stance as above.
- **A loaded camera is not range-checked (D-062)** — only a `CameraState` `render/camera.ts` itself
  produces is inside `[MIN_ZOOM, MAX_ZOOM]`. The clamp is owed by whichever cycle first loads a
  document into a live canvas. `renderer.ts` never divides by `camera.zoom`, so it neither closes
  nor worsens the gap — and the clamp does NOT go inside it (see Gotchas).
- **The renderer does not clip cell text to its cell** (0062-REVIEW §4) — a long string overflows
  into its neighbour. §5.4 does not specify it, the spreadsheet idiom is split, Rule 5 says leave it.
- **The renderer's table path is pinned only against hand-built fixtures** (0062-REVIEW fix list 3)
  — the one test through `mutate()` builds a pentagon. Owed once a table-creation command exists.
- **D-060/D-063 not reconciled in test files** (0058-REVIEW Finding 2): 13 bare "this cycle" sites
  (`mutation.test.ts` ×9, `schema.test.ts` ×2, `ast.test.ts` ×1, one `describe` title). Comment-only,
  blocks nothing. That finding's OTHER half — two stale "`mutation.ts` does not exist yet" headers —
  is **closed** at 0062-REVIEW under D-065, with the two entry 0061 created.
- **Row/column deletion CAN still be REJECTED**, contradicting §5.4 — the address-repair pass is
  unbounded while the slot walk is extent-bounded. Reachable only via a raw `setSlot` writing an
  out-of-extent cell; pinned by `mutation.test.ts`'s "KNOWN INCOHERENCE" test (entry 0052). D-053
  forbids fixing one side: insertion has the identical divergence, so both close together or not.
- **A dimension write is not checked for COHERENCE with the cells that exist, in general** (D-046/
  D-053 cover less). Unguarded: a raw `setSlot` writing an incoherent count, and a same-batch
  dimension change landing after `findInvalidTableResizes` seeds its state.
- **The dangling-reference message names the DEPENDENT, not the missing SOURCE**, repeating once
  per missing cell (0045-REVIEW Finding 4, carried).
- **D-022's bounded-correctness claim does not hold for `table`** — narrowed/accepted at
  0043-REVIEW §7 Q1; the pinning test stays as a tripwire.
- **`describeValueType` is duplicated verbatim** in `functions.ts` and `eval.ts` (0037-REVIEW
  Finding 4, carried).
- **`rewriteObjectFormulaAddresses`/`repairObjectFormulaAddresses` walk `formula`-kind slots only**
  — total today, but §5.4 requires the pass to cover text boxes too once Phase 5 lands.
- **A `table` object has no `origin.x`/`origin.y` schema entry** (entry 0061 Decision 4) — the
  renderer reads those paths anyway (the same ones `circle`/`polygon`/`rect` use) and falls back to
  `(0,0)`. The table-creation command should add the pair to `TABLE_SCHEMA` at these same paths; the
  renderer then needs no change.
- **Mixed line endings in the WORKING TREE only** (corrected at 0062-REVIEW §7 — the earlier claim
  that entry 0061's files were CRLF was false; they are LF). `core.autocrlf=true`, so git stores LF
  and converts on checkout; a file written by a tool and never re-checked-out stays LF locally while
  the committed content is uniform. Harmless. A `.gitattributes` is a §6.1 trigger-6 escalation.
- **Carried unchanged:** journal STRUCTURE deliberately unvalidated beyond `Array.isArray` ·
  `lexer.ts`'s two disclosed edge cases · §5.11's `style` field · `nextObjectId` reconciliation (and,
  per D-062, its domain is unchecked too) · `noUnusedLocals` off · recursion depth.

## Settled — do not re-raise

Every ruling in `DECISIONS.md` (D-001 through **D-065**) is binding without restatement here.

## Live PROVISIONAL tags and open questions

**`PROVISIONAL(Q-012)` → `src/render/renderer.ts`** (`DEFAULT_SHAPE_STROKE_WIDTH`, the
`TABLE_CELL_*` constants). Is a stroke width / cell size / font size in WORLD units or SCREEN pixels?
Raised and deferred at 0062-REVIEW; provisional choice (a) world units is what the tree does. Comes
due with the `style`-slots cycle; blocks nothing — nothing can author a width yet.

Q-008 remains OPEN, deferred, blocking nothing. Q-001/Q-002 come due at `command/parser.ts`. Next
free: **Q-013**.

## Gotchas for the next model

- **`renderDocument` leaves `ctx` holding the CAMERA transform on return, not identity.** Harmless
  frame to frame, but SCREEN-space chrome drawn after it in the same frame — a selection handle, an
  error badge, a HUD — comes out camera-warped unless the caller resets the transform first. Lands
  on `render/interaction.ts`.
- **D-062's zoom clamp does NOT go inside `renderDocument`** (0062-REVIEW §9). *Once, at the
  boundary*: the renderer and `hittest`'s `screenToWorld` must get the SAME camera, or the picture
  and the click land in different coordinate systems with nothing logged. The boundary is
  `main.ts`'s wiring cycle.
- **A comment saying another file does not exist is YOURS to fix once you create that file
  (D-065).** Grep for the name of what you just built before you log. Four sites found at
  0062-REVIEW.
- **`createObject` requires the caller to supply ALL derived-slot placeholders** — nine for a preset
  (D-018; omitting them fails with nine "slot does not exist" messages). Build them from
  `getObjectSchema`; copy `geometry.test.ts`'s `derivedPlaceholders` helper (`renderer.test.ts` did).
- **All three presets wind COUNTERCLOCKWISE, and D-064 makes that a stated invariant.** The
  renderer's fill rule, any winding-number hit test, and `explode` all inherit it. A pinning test
  is still owed (0060-REVIEW fix list 1).
- **A slot's stored key is the PATH joined with `.` (`slotKey`), not the surface form the user
  types** — a table cell is stored at `cells.A1`, never bare `A1` (D-005). Entry 0061 lost a test
  run to exactly this.
- **Reading a value to DRAW it is not the same as reading one to size the SLOT SET** (0062-REVIEW
  §2). `readNumber` honours any slot kind, so a formula-driven `origin.x` renders where §5.9 says it
  should; `table.ts`'s `readTableDimension` is `literal`-only because D-046 is a **Rule 6** guard.
  Do not "unify" them.
- **Close every discriminated-union `switch` with `const exhaustive: never = x; void exhaustive;`**
  — the codebase-wide idiom. A `void`-returning switch does NOT error on a missing case without it.
- **Two geometry things that look like defects and are not** (0060-REVIEW §1, §7 Q2): the centroid is
  the AREA-WEIGHTED one, not the vertex mean (read `computeCentroid`'s doc comment first), and the
  derived slots are deliberately redundant in their arithmetic. **Do not "fix" either.**
- **Comments describe the PRESENT (D-060, D-063, D-065).** A header states what the file IS — never
  "this cycle builds X", never a pointer to a diff. Date by entry number ("entry 0061").
- **Do not self-declare a file "load-bearing per Rule 3."** §6.2's list is exactly `address.ts`,
  `mutation.ts`, `graph/*`, `primitives/schema.ts`, `document.ts`. A subsystem's first file fires
  §6.1 trigger 2 (a review point), not §6.2 (a phase gate).
- **Camera convention: `camera.x`/`camera.y` is the world point at the screen's TOP-LEFT corner
  (D-061)**, not the viewport centre.
- **`render/` is not `engine/`, Rule 1 stops being free there.** Run BOTH typecheck configs.
- **No jsdom in this repo.** `render/renderer.test.ts` fakes `CanvasRenderingContext2D` by hand — a
  plain object with only the members called, cast `as unknown as`; copy it for
  `hittest.ts`/`interaction.ts`. Adding jsdom is a §6.1 trigger-6 escalation.
- **Dragging calls the mutation API, per component (§5.9).** Still not built.
- **State every file you touched in the log entry, comment-only edits included.**
