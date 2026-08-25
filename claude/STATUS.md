# STATUS — as of entry 0065-AUDIT-header-budget

STATE: GREEN (compiles under both configs, 753/753 tests pass, 0 skipped, 0 `.only`).

**Process state: PHASE 3 OPEN. Entry 0063 (`render/hittest.ts`) is REVIEWED — ACCEPT WITH EDITS at
0064-REVIEW; entry 0065 was a comment-only reviewer audit. `render/interaction.ts` is cleared to
start and is the next slice.**

Current phase: **3 — canvas, camera, geometry, command line.** Four files built and all four
reviewed (`render/camera.ts`, `primitives/geometry.ts`, `render/renderer.ts`, `render/hittest.ts`);
`render/interaction.ts`, `command/*`, and `main.ts` are unstarted. Phase 3 acceptance criterion
(§6): *"you can create a polygon and a table by command, see both drawn, pan/zoom, select, and drag
the polygon."* Camera math, the geometry primitive, a tested renderer, and hit-testing all exist;
there is no command line, no drag/selection, and no `main.ts` wiring to see any of it on a screen.
NOT claimed as passing.

Last review point: **0064-REVIEW-phase3, ACCEPT WITH EDITS** (entry 0063). Cycles since last review:
**0/3** · diff since last review: **0 lines / 0 files** (cap 800/10).

## Next slice (recommended)

**`render/interaction.ts`** (§5.9: click to select, drag to move, escape to deselect). It fires §6.1
trigger 2 in its own right — first file of the interaction subsystem — so expect a review point at
the end. Then `command/parser.ts`; `main.ts` wiring makes sense once a command line exists to create
an object with. Read 0064-REVIEW §10's four carry-ins first.

## Built and reviewed

Phase 0 (0027-REVIEW) · the formula engine (0037-REVIEW) · the whole table primitive, through
row/column insert/delete and `delete <table> force` (0054-REVIEW) · `render/camera.ts` and entry
0055's header audit (0058-REVIEW) · `primitives/geometry.ts` (0060-REVIEW) · `render/renderer.ts`
(0062-REVIEW) · **`render/hittest.ts` (0064-REVIEW)**. Nothing is built-but-unreviewed: the tree is
at a clean review boundary.

## Not started

`render/interaction.ts`, `command/*`, `polyline`/`explode`/`addvertex`/`delvertex` (entry 0059),
`main.ts` wiring, §5.9's selection/error-badge/formula-driven-slot visual feedback (entry 0061),
`style` slots, a table's own `origin.x`/`origin.y` schema entry, point-in-polygon fill hit-testing
(D-067) · Phases 4–7.

**Reviewer edits already in the tree.** 0064-REVIEW: `hitTestTable` rejects a degenerate box (D-066,
two pinning tests) · D-064's winding test written · three comment corrections. 0065-AUDIT
(comment-only): four headers condensed (`eval.ts` 105->68, `geometry.ts` 104->74, `renderer.ts`
104->74, `hittest.ts` 91->62) · **`geometry.ts` now STATES D-064, which it had omitted while two of
its own function docs denied it** · `eval.ts`'s four-step contract moved onto
`evaluateFunctionCall`, which had pointed UP at the header for its own rationale · eight headers'
expired `(§6 trigger-2 file)` metadata corrected · one D-060 diary comment removed.

## Known problems

- **A loaded camera is not range-checked (D-062)** — only a `CameraState` `camera.ts` itself
  produces is inside `[MIN_ZOOM, MAX_ZOOM]`. Owed by whichever cycle first loads a document into a
  live canvas. At `zoom: 0`, `hitTest`'s world tolerance becomes `Infinity` and EVERY click returns
  the topmost shape (0064-REVIEW Finding 2) — deliberately not guarded there; 0062-REVIEW §9 puts
  the clamp at `main.ts`'s boundary, once.
- **`sides` has no upper bound**, and **no bound on how large `rows`/`cols` may be set** via a raw
  `setSlot` (0060-REVIEW fix list 2, carried). A shape this large is slow to DRAW as well as to
  evaluate; one ruling covers all three or none does. **Do not fix in isolation.**
- **The renderer does not clip cell text to its cell** (0062-REVIEW §4) — a long string overflows
  into its neighbour. §5.4 does not specify it; Rule 5 says leave it.
- **`renderer.ts`'s and `hittest.ts`'s table paths are pinned only against hand-built fixtures** —
  owed an end-to-end test through `mutate()` once a table-creation command exists.
- **`readNumber`/`asPointArray` live in `renderer.ts`, imported by `hittest.ts`** — correct for now.
  **At the THIRD consumer, extract them into `render/slots.ts`** (0064-REVIEW §5).
- **Comment debt in test files, blocking nothing** (non-test source is D-060-clean as of entry 0065,
  which found and fixed the one real violation `evaluateNot` was carrying): 13 bare "this cycle" sites (D-060/D-063,
  0058-REVIEW Finding 2 — `mutation.test.ts` ×9, `schema.test.ts` ×2, `ast.test.ts` ×1, one
  `describe` title), plus two stale "`graph/eval.ts` does not exist yet" claims in
  `schema.test.ts` (~line 7, ~249). D-065's class but predates the ruling — belongs to whoever's
  slice next touches that file, not to a drive-by (PROCESS_BRIEF §4).
- **Row/column deletion CAN still be REJECTED**, contradicting §5.4 — the address-repair pass is
  unbounded while the slot walk is extent-bounded. Reachable only via a raw `setSlot` writing an
  out-of-extent cell; pinned by `mutation.test.ts`'s "KNOWN INCOHERENCE" test (0052), and D-053
  forbids fixing one side. Relatedly, **a dimension write is not checked for COHERENCE with the
  cells that exist** (D-046/D-053 cover less).
- **A `table` has no `origin.x`/`origin.y` schema entry** (0061 Decision 4) — `renderer.ts` and
  `hittest.ts` read those paths anyway and fall back to `(0,0)`. The table-creation command adds the
  pair to `TABLE_SCHEMA` at these same paths; neither render file then needs a change.
- **The §5.2 header budget (20-40 ordinary) is not reachable** (entry 0065). Ten headers remain over
  — `mutation.ts` 151 (budget 80), `table.ts` 101, `parser.ts` 97, `document.ts` 94 and six more,
  all unexamined beyond measurement. Even the four CONDENSED files are still over 40, because what
  remains is §5.2's own keep-always list. **Entry 0065 puts three options to the human and
  recommends raising the ordinary budget to ~60-70** — a PROCESS_BRIEF amendment is theirs to make.
- **~20 more "see the file header" pointers** (`document.ts`, `ast.ts`, `deps.ts`, `functions.ts`,
  `eval.ts`). Only those where a function defers its OWN contract upward are defects (0065 F2); each
  needs reading, not grepping.
- **Mixed line endings in the WORKING TREE only** (0062-REVIEW §7) — `core.autocrlf=true`, so git
  stores LF and converts on checkout. Harmless. A `.gitattributes` is a §6.1 trigger-6 escalation.
- **Carried unchanged, each with its pointer:** dangling-reference messages name the DEPENDENT, not
  the missing SOURCE (0045-REVIEW F4) · D-022's bounded-correctness claim fails for `table`
  (0043-REVIEW §7 Q1) · `describeValueType` duplicated in `functions.ts`/`eval.ts` (0037-REVIEW F4)
  · `rewrite`/`repairObjectFormulaAddresses` walk `formula` slots only, owed text boxes at Phase 5
  · journal structure unvalidated beyond `Array.isArray` · `lexer.ts`'s two edge cases · §5.11's
  `style` field · `nextObjectId` reconciliation · `noUnusedLocals` off · recursion depth.

## Settled — do not re-raise

Every ruling in `DECISIONS.md` (D-001 through **D-067**) binds without restatement here. Newest two:
**D-066** — an object that draws nothing is not hittable, and a degenerate extent needs its own
guard. **D-067** — stroke-only hit-testing is correct while nothing can be filled, does NOT block
Phase 3's gate, and point-in-polygon lands with D-064's winding in the `style`-slots cycle.

## Live PROVISIONAL tags and open questions

**`PROVISIONAL(Q-012)` → `src/render/renderer.ts`** (`DEFAULT_SHAPE_STROKE_WIDTH`, the
`TABLE_CELL_*` constants). Is a stroke width / cell size / font size in WORLD units or SCREEN pixels?
Provisional choice (a) world units is what the tree does; `hittest.ts`'s tolerance is unconditionally
screen-space and does NOT depend on it (0064-REVIEW §3). Due with the `style`-slots cycle.

Q-008 remains OPEN, deferred, blocking nothing. Q-001/Q-002 come due at `command/parser.ts`. Next
free: **Q-013**.

## Gotchas for the next model

- **Hold the object's `id`, not the `GraphObject` `hitTest` returns** — `mutate` returns new
  objects, so a held reference goes stale the moment the first drag lands.
- **`renderDocument` leaves `ctx` holding the CAMERA transform on return, not identity.** SCREEN-space
  chrome drawn after it in the same frame comes out camera-warped unless the caller resets first.
- **D-062's zoom clamp goes at `main.ts`'s boundary, NOT inside `renderDocument` or `hitTest`**
  (0062-REVIEW §9). *Once, at the boundary*: both must be handed the SAME camera, or the picture and
  the click land in different coordinate systems with nothing logged.
- **Dragging calls the mutation API, PER COMPONENT (§5.9).** A `literal` component writes; a
  `formula`/`derived` one skips with non-blocking feedback; only an all-driven object stays put. Do
  not normalise into all-or-nothing dragging — constrained-axis behaviour is the payoff.
- **A comment saying another file does not exist is YOURS to fix once you create it (D-065).** Grep
  for the name of what you just built before you log.
- **`createObject` requires ALL derived-slot placeholders** — nine for a preset (D-018). Build them
  from `getObjectSchema`; copy `geometry.test.ts`'s `derivedPlaceholders` helper.
- **All three presets wind COUNTERCLOCKWISE (D-064), now PINNED** by four tests in
  `geometry.test.ts` and STATED in `geometry.ts`'s header. A cycle that changes a preset's corner
  order fails those tests — that is the point. Until entry 0065 the file's own function docs said
  the opposite ("nothing downstream reads winding yet"); do not reintroduce that reading.
- **A slot's stored key is the PATH joined with `.`** — a cell is at `cells.A1`, never `A1` (D-005).
- **Reading a value to DRAW or HIT-TEST it is not the same as reading one to size the SLOT SET**
  (0062-REVIEW §2). `readNumber`/`asPointArray` honour any slot kind; `readTableDimension` is
  `literal`-only because D-046 is a **Rule 6** guard. Do not "unify" them.
- **A degenerate extent needs its OWN guard (D-066)** — inclusive bounds mean a zero-area box still
  contains points. Test it at the ORIGIN of the box; a far-away point passes either way.
- **Close every discriminated-union `switch` with `const exhaustive: never = x; void exhaustive;`.**
- **Two geometry things that look like defects and are not** (0060-REVIEW §1, §7 Q2, now stated in
  `geometry.ts`'s own header): the centroid is AREA-WEIGHTED, not the vertex mean, and the derived
  slots are deliberately redundant. **Do not "fix" either.**
- **Comments describe the PRESENT (D-060, D-063, D-065)** — and a comment can be falsified by a new
  RULING, not just a new file (entry 0065 Finding 1). Date by entry number, never "this cycle".
- **Load-bearing status is §6.2's list** — exactly `address.ts`, `mutation.ts`, `graph/*`,
  `primitives/schema.ts`, `document.ts`. Do not self-declare it, and do not write review-scheduling
  metadata into a header: it expires (entry 0065).
- **`camera.x`/`camera.y` is the world point at the screen's TOP-LEFT corner (D-061)**, not centre.
- **`render/` is not `engine/`; Rule 1 stops being free there.** Run BOTH typecheck configs.
- **No jsdom in this repo.** `interaction.ts` will need a context fake; copy `renderer.test.ts`'s
  (adding jsdom is a §6.1 trigger-6 escalation). **State every file you touched in your log entry,
  comment-only edits included.**
