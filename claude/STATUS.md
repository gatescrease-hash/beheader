# STATUS — as of entry 0064-REVIEW-phase3

STATE: GREEN (compiles under both configs, 753/753 tests pass, 0 skipped, 0 `.only`).

**Process state: PHASE 3 OPEN. Entry 0063 (`render/hittest.ts`) is REVIEWED — ACCEPT WITH EDITS at
0064-REVIEW. `render/interaction.ts` is cleared to start and is the next slice.**

Current phase: **3 — canvas, camera, geometry, command line.** Four files built and all four
reviewed (`render/camera.ts`, `primitives/geometry.ts`, `render/renderer.ts`, `render/hittest.ts`);
`render/interaction.ts`, `command/*`, and `main.ts` are unstarted. Phase 3 acceptance criterion
(§6): *"you can create a polygon and a table by command, see both drawn, pan/zoom, select, and drag
the polygon."* Camera math, the geometry primitive, a tested renderer, and hit-testing all exist;
there is no command line to create anything, no drag/selection, and no `main.ts` wiring to see any of
it on a screen. NOT claimed as passing.

Last review point: **0064-REVIEW-phase3, ACCEPT WITH EDITS** (covering entry 0063).
Cycles since last review: **0/3** · diff since last review: **0 lines / 0 files** (cap 800/10).

## Next slice (recommended)

**`render/interaction.ts`** (§5.9: click to select, drag to move, escape to deselect). It fires §6.1
trigger 2 in its own right — first file of the interaction subsystem — so expect a review point at
the end of it. Then `command/parser.ts`; `main.ts` wiring makes sense once a command line exists to
create an object with. Read 0064-REVIEW §10's four carry-ins first.

## Built and reviewed

Phase 0 in full (0027-REVIEW) · the formula engine (0037-REVIEW) · the whole table primitive —
column arithmetic, the dynamic slot family, range evaluation, row/column insertion and deletion,
`delete <table>`'s `force` flag — accepted at 0054-REVIEW-phase2 · `render/camera.ts`, entry 0055's
header audit, D-060 (0058-REVIEW) · `primitives/geometry.ts`'s three presets and nine derived slots
(0060-REVIEW) · `render/renderer.ts` (0062-REVIEW) · **`render/hittest.ts` (0063, 0064-REVIEW)**.

## Built this batch, not yet reviewed

Nothing. The tree is at a clean review boundary.

## Not started

`render/interaction.ts`, `command/*`, `polyline`/`explode`/`addvertex`/`delvertex` (entry 0059),
`main.ts` wiring, §5.9's selection/error-badge/formula-driven-slot visual feedback (entry 0061),
`style` slots, a table's own `origin.x`/`origin.y` schema entry, point-in-polygon fill hit-testing
(D-067) · Phases 4–7.

**Reviewer edits already in the tree (0064-REVIEW §4, §6):** `hitTestTable` now rejects a degenerate
box (D-066) with two pinning tests · D-064's winding pinning test is written, closing 0060-REVIEW fix
list item 1 · three comment corrections in `hittest.ts`/`hittest.test.ts`.

## Known problems

- **A loaded camera is not range-checked (D-062)** — only a `CameraState` `render/camera.ts` itself
  produces is inside `[MIN_ZOOM, MAX_ZOOM]`. Owed by whichever cycle first loads a document into a
  live canvas. At `zoom: 0` the consequence in `hitTest` is that the world tolerance becomes
  `Infinity` and EVERY click returns the topmost shape (0064-REVIEW Finding 2) — deliberately not
  guarded there: 0062-REVIEW §9 puts the clamp at `main.ts`'s boundary, once.
- **`sides` has no upper bound**, and **no bound on how large `rows`/`cols` may be set** via a raw
  `setSlot` (0060-REVIEW fix list 2, carried). A shape this large is slow to DRAW as well as to
  evaluate; one ruling covers all three or none does. **Do not fix in isolation.**
- **The renderer does not clip cell text to its cell** (0062-REVIEW §4) — a long string overflows
  into its neighbour. §5.4 does not specify it; Rule 5 says leave it.
- **The table paths of BOTH `renderer.ts` and `hittest.ts` are pinned only against hand-built
  fixtures** — owed an end-to-end test through `mutate()` once a table-creation command exists.
- **`readNumber`/`asPointArray` live in `renderer.ts` and are imported by `hittest.ts`** — correct
  for now (0064-REVIEW §5). **At the THIRD consumer, extract them into `render/slots.ts`.**
- **Comment debt in test files, blocking nothing**: 13 bare "this cycle" sites (D-060/D-063,
  0058-REVIEW Finding 2 — `mutation.test.ts` ×9, `schema.test.ts` ×2, `ast.test.ts` ×1, one
  `describe` title), plus two stale "`graph/eval.ts` does not exist yet" claims in
  `schema.test.ts` (~line 7, ~249). D-065's class but predates the ruling — belongs to whoever's
  slice next touches that file, not to a drive-by (PROCESS_BRIEF §4).
- **Row/column deletion CAN still be REJECTED**, contradicting §5.4 — the address-repair pass is
  unbounded while the slot walk is extent-bounded. Reachable only via a raw `setSlot` writing an
  out-of-extent cell; pinned by `mutation.test.ts`'s "KNOWN INCOHERENCE" test (entry 0052). D-053
  forbids fixing one side. Relatedly, **a dimension write is not checked for COHERENCE with the
  cells that exist** (D-046/D-053 cover less): a raw `setSlot` writing an incoherent count, and a
  same-batch dimension change landing after `findInvalidTableResizes` seeds its state.
- **A `table` object has no `origin.x`/`origin.y` schema entry** (entry 0061 Decision 4) — both
  `renderer.ts` and `hittest.ts` read those paths anyway and fall back to `(0,0)`. The
  table-creation command should add the pair to `TABLE_SCHEMA` at these same paths; neither
  render-layer file then needs a change.
- **File headers are systematically over §5.2's budget** (`hittest.ts` 86, `renderer.ts` 104,
  `geometry.ts` 104, `mutation.ts` 151). 0064-REVIEW §7 recommends an audit pass before Phase 4,
  scoped like entry 0055's. **Human's call, not an implementer's to start.**
- **Mixed line endings in the WORKING TREE only** (0062-REVIEW §7) — `core.autocrlf=true`, so git
  stores LF and converts on checkout. Harmless. A `.gitattributes` is a §6.1 trigger-6 escalation.
- **Carried unchanged, each with its pointer:** the dangling-reference message names the DEPENDENT,
  not the missing SOURCE, once per missing cell (0045-REVIEW Finding 4) · D-022's bounded-correctness
  claim does not hold for `table` (0043-REVIEW §7 Q1; its pinning test stays as a tripwire) ·
  `describeValueType` is duplicated verbatim in `functions.ts` and `eval.ts` (0037-REVIEW Finding 4)
  · `rewriteObjectFormulaAddresses`/`repairObjectFormulaAddresses` walk `formula`-kind slots only,
  total today but owed text boxes at Phase 5 (§5.4) · journal STRUCTURE unvalidated beyond
  `Array.isArray` · `lexer.ts`'s two disclosed edge cases · §5.11's `style` field · `nextObjectId`
  reconciliation · `noUnusedLocals` off · recursion depth.

## Settled — do not re-raise

Every ruling in `DECISIONS.md` (D-001 through **D-067**) is binding without restatement here. The
two newest: **D-066** — an object that draws nothing is not hittable; drawn extent and clickable
extent are the same extent, and a degenerate extent needs its own guard. **D-067** — stroke-only
hit-testing is CORRECT while nothing can be filled, it does NOT block Phase 3's gate, and
point-in-polygon lands together with D-064's winding in the `style`-slots cycle.

## Live PROVISIONAL tags and open questions

**`PROVISIONAL(Q-012)` → `src/render/renderer.ts`** (`DEFAULT_SHAPE_STROKE_WIDTH`, the
`TABLE_CELL_*` constants). Is a stroke width / cell size / font size in WORLD units or SCREEN pixels?
Provisional choice (a) world units is what the tree does; `hittest.ts`'s tolerance is unconditionally
screen-space and does NOT depend on it (0064-REVIEW §3). Due with the `style`-slots cycle.

Q-008 remains OPEN, deferred, blocking nothing. Q-001/Q-002 come due at `command/parser.ts`. Next
free: **Q-013**.

## Gotchas for the next model

- **Hold the object's `id`, not the `GraphObject` `hitTest` returns.** `mutate` returns new objects;
  a held reference goes stale the moment the first drag lands.
- **`renderDocument` leaves `ctx` holding the CAMERA transform on return, not identity.** SCREEN-space
  chrome drawn after it in the same frame comes out camera-warped unless the caller resets first.
- **D-062's zoom clamp goes at `main.ts`'s boundary, NOT inside `renderDocument` or `hitTest`**
  (0062-REVIEW §9, 0064-REVIEW Finding 2). *Once, at the boundary*: `renderDocument` and `hitTest`
  must be handed the SAME camera, or the picture and the click land in different coordinate systems
  with nothing logged.
- **Dragging calls the mutation API, PER COMPONENT (§5.9).** `literal` component writes; `formula`
  or `derived` component skips with non-blocking feedback; only an all-driven object doesn't move.
  Do not normalise this into all-or-nothing dragging — the constrained-axis behaviour is the payoff.
- **A comment saying another file does not exist is YOURS to fix once you create it (D-065).** Grep
  for the name of what you just built before you log.
- **`createObject` requires the caller to supply ALL derived-slot placeholders** — nine for a preset
  (D-018). Build them from `getObjectSchema`; copy `geometry.test.ts`'s `derivedPlaceholders` helper.
- **All three presets wind COUNTERCLOCKWISE (D-064), now PINNED** by four tests in
  `geometry.test.ts`. A cycle that changes a preset's corner order fails them — that is the point.
- **A slot's stored key is the PATH joined with `.` (`slotKey`)** — a table cell is stored at
  `cells.A1`, never bare `A1` (D-005).
- **Reading a value to DRAW or HIT-TEST it is not the same as reading one to size the SLOT SET**
  (0062-REVIEW §2). `readNumber`/`asPointArray` honour any slot kind; `readTableDimension` is
  `literal`-only because D-046 is a **Rule 6** guard. Do not "unify" them.
- **A degenerate extent needs its OWN guard (D-066)** — inclusive bounds mean a zero-area box still
  contains points. Test it at the ORIGIN of the degenerate box; a far-away point passes either way.
- **Close every discriminated-union `switch` with `const exhaustive: never = x; void exhaustive;`**
  — the codebase-wide idiom.
- **Two geometry things that look like defects and are not** (0060-REVIEW §1, §7 Q2): the centroid is
  AREA-WEIGHTED, not the vertex mean, and the derived slots are deliberately redundant. **Don't "fix".**
- **Comments describe the PRESENT (D-060, D-063, D-065).** Date by entry number, never "this cycle".
- **Do not self-declare a file "load-bearing per Rule 3."** §6.2's list is exactly `address.ts`,
  `mutation.ts`, `graph/*`, `primitives/schema.ts`, `document.ts`.
- **Camera convention: `camera.x`/`camera.y` is the world point at the screen's TOP-LEFT corner
  (D-061)**, not the viewport centre.
- **`render/` is not `engine/`, Rule 1 stops being free there.** Run BOTH typecheck configs.
- **No jsdom in this repo.** `interaction.ts` will need a context fake; copy `renderer.test.ts`'s
  (adding jsdom is a §6.1 trigger-6 escalation). **State every file you touched in your log entry,
  comment-only edits included.**
