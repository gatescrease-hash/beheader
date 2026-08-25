# STATUS — as of entry 0066-render-interaction

STATE: GREEN (compiles under both configs, 775/775 tests pass, 0 skipped, 0 `.only`).

**Process state: PHASE 3 OPEN, at a review point. Entry 0066 (`render/interaction.ts`) fired §6.1
trigger 2 — first file of the interaction subsystem — and is BUILT BUT UNREVIEWED. `command/parser.ts`
is the next slice and should not start until this review lands.**

Current phase: **3 — canvas, camera, geometry, command line.** Five files built (`render/camera.ts`,
`primitives/geometry.ts`, `render/renderer.ts`, `render/hittest.ts`, `render/interaction.ts`); the
first four are reviewed. `command/*` and `main.ts` are unstarted. Phase 3 acceptance criterion (§6):
*"you can create a polygon and a table by command, see both drawn, pan/zoom, select, and drag the
polygon."* Every engine-side and render-side piece now exists — camera math, geometry, renderer,
hit-testing, and select/drag — but there is no command line to create anything with and no `main.ts`
wiring, so none of it is reachable from a screen. NOT claimed as passing.

Last review point: **0064-REVIEW-phase3, ACCEPT WITH EDITS** (entry 0063). Cycles since last review:
**1/3** · diff since last review: **~742 lines / 6 files** (cap 800/10 — near the line cap).

## Next slice (recommended)

**`command/parser.ts`** (§5.10: table-driven command string → command object), after this review.
It fires §6.1 trigger 2 in its own right, and **Q-001/Q-002 come due there** (both already ANSWERED
— D-041 and D-040 — so read those two rulings before writing the `set`/`unlink` handlers, and
reconcile rather than re-decide). Then `main.ts`, which is what makes the Phase 3 gate claimable and
which **owes D-062's zoom clamp at its boundary, once**.

## Built and reviewed

Phase 0 (0027-REVIEW) · the formula engine (0037-REVIEW) · the whole table primitive, through
row/column insert/delete and `delete <table> force` (0054-REVIEW) · `render/camera.ts` and entry
0055's header audit (0058-REVIEW) · `primitives/geometry.ts` (0060-REVIEW) · `render/renderer.ts`
(0062-REVIEW) · `render/hittest.ts` (0064-REVIEW) · entry 0065's header audit (comment-only).

## Built this batch, not yet reviewed

- **`render/interaction.ts` + `interaction.test.ts` (entry 0066, 22 tests)** — §5.9's four
  transitions (`pointerDown`, `pointerMove`, `pointerUp`, `deselect`) over a plain
  `InteractionState`. Dragging calls `mutate` **per component**: a `literal` `origin.x`/`origin.y`
  holding a number moves, a `formula`/`derived` one stays put and reports what drives it. The file
  draws nothing and touches no canvas.
- **Five D-065 comment corrections** in `main.ts`, `camera.ts`, `hittest.ts`, `renderer.ts` (×2) —
  every one a cross-file claim entry 0066's own work falsified. Two of them also carried a
  *hit-testing* claim falsified back at entry 0063; entry 0066 §"What I did" discloses fixing that
  half as inherited, not as its own.

## Not started

`command/*`, `main.ts` wiring, §5.9's visual-feedback trio (selection highlight, error badge,
formula-driven slot indicator — deferred **whole**, entry 0066 Decision 1), §5.9's per-vertex drag
path, `polyline`/`explode`/`addvertex`/`delvertex`, `style` slots, a table's own
`origin.x`/`origin.y` schema entry, point-in-polygon fill hit-testing (D-067), §5.4's formula bar /
in-place cell editing · Phases 4–7.

## Known problems

- **A loaded camera is not range-checked (D-062)** — only a `CameraState` `camera.ts` itself
  produces is inside `[MIN_ZOOM, MAX_ZOOM]`. Owed by whichever cycle first loads a document into a
  live canvas, i.e. `main.ts`. At `zoom: 0`, `hitTest`'s world tolerance becomes `Infinity` and
  EVERY click returns the topmost shape (0064-REVIEW Finding 2) — which now also means every
  **drag** grabs it. Deliberately not guarded in `hittest.ts` or `interaction.ts`; 0062-REVIEW §9
  puts the clamp at `main.ts`'s boundary, once.
- **`sides` has no upper bound**, and **no bound on how large `rows`/`cols` may be set** via a raw
  `setSlot` (0060-REVIEW fix list 2, carried). One ruling covers all three or none does. **Do not
  fix in isolation.**
- **The renderer does not clip cell text to its cell** (0062-REVIEW §4). §5.4 does not specify it;
  Rule 5 says leave it.
- **`renderer.ts`'s and `hittest.ts`'s table paths are pinned only against hand-built fixtures** —
  owed an end-to-end test through a table-creation *command*. (`interaction.test.ts` goes through
  `mutate()`, which is as far as a pre-`command/` slice can reach.)
- **A drag fires one mutation per pointer move, each deep-cloning the document** (§5.9's drag
  performance note). Untouched deliberately — Rule 5, and "visibly laggy" cannot be observed until
  `main.ts` exists. Whatever fixes it MUST throttle, never write state outside `mutation.ts`.
- **`readNumber`/`asPointArray` live in `renderer.ts`, imported by `hittest.ts`.** Still **two**
  consumers: `interaction.ts` reads `getSlot` directly because it needs slot KIND, which those two
  helpers deliberately ignore (entry 0066 Decision 7). **At the THIRD consumer, extract them into
  `render/slots.ts`** (0064-REVIEW §5).
- **Comment debt in test files, blocking nothing** (non-test source is D-060-clean): 13 bare "this
  cycle" sites (D-060/D-063, 0058-REVIEW Finding 2 — `mutation.test.ts` ×9, `schema.test.ts` ×2,
  `ast.test.ts` ×1, one `describe` title), plus two stale "`graph/eval.ts` does not exist yet" claims
  in `schema.test.ts` (~line 7, ~249). D-065's class but predates the ruling — belongs to whoever's
  slice next touches that file, not to a drive-by (PROCESS_BRIEF §4).
- **Row/column deletion CAN still be REJECTED**, contradicting §5.4 — the address-repair pass is
  unbounded while the slot walk is extent-bounded. Reachable only via a raw `setSlot` writing an
  out-of-extent cell; pinned by `mutation.test.ts`'s "KNOWN INCOHERENCE" test (0052), and D-053
  forbids fixing one side. Relatedly, **a dimension write is not checked for COHERENCE with the
  cells that exist** (D-046/D-053 cover less).
- **A `table` has no `origin.x`/`origin.y` schema entry** (0061 Decision 4) — `renderer.ts` and
  `hittest.ts` read those paths anyway and fall back to `(0,0)`, and `interaction.ts` therefore
  reports every table as undraggable. The table-creation command adds the pair to `TABLE_SCHEMA` at
  these same paths; none of the three render files then needs a change.
- **The §5.2 header budget (20-40 ordinary) is not reachable** (entry 0065). Ten headers remain
  over — `mutation.ts` 151 (budget 80), `table.ts` 101, `parser.ts` 97, `document.ts` 94 and six
  more. `render/interaction.ts` lands at **64** after a trim pass (`camera.ts` 42, `hittest.ts` 62,
  `renderer.ts` 78). **Entry 0065 puts three options to the human and recommends raising the
  ordinary budget to ~60-70** — a PROCESS_BRIEF amendment is theirs to make.
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
Provisional choice (a) world units is what the tree does; neither `hittest.ts`'s tolerance nor
`interaction.ts` depends on it. Due with the `style`-slots cycle.

Q-008 remains OPEN, deferred, blocking nothing. **Q-001 and Q-002 are ANSWERED (D-041, D-040) and
come due at `command/parser.ts`** — reconcile, do not re-decide. Next free: **Q-013**.

## Gotchas for the next model

- **Dragging calls the mutation API, PER COMPONENT (§5.9) — this is now BUILT, in
  `render/interaction.ts`.** Do not normalise it into all-or-nothing dragging; constrained-axis
  behaviour is the payoff, and it is pinned by three tests.
- **`render/interaction.ts` draws NOTHING and touches no canvas.** It is a pure state machine over
  screen points. §5.9's visual-feedback trio (highlight, error badge, formula-driven indicator) is
  deferred WHOLE and belongs with the renderer, in one cycle (entry 0066 Decision 1). This
  contradicts 0064-REVIEW §10 item 4's expectation that the file would need a context fake — it
  did not, because it draws nothing.
- **`interaction.ts` reads `getSlot` directly, NOT `readNumber`** — it needs slot KIND, and
  `readNumber`/`asPointArray` deliberately ignore kind (0062-REVIEW §2). So the `render/slots.ts`
  extraction trigger is still at two consumers, not three.
- **A rejected drag step does not advance the drag's `lastWorldPoint`** — the delta is retried on
  the next move. Do not "fix" this into advancing regardless; that silently loses distance.
- **Hold the object's `id`, not the `GraphObject`** — `mutate` returns new objects, so a held
  reference goes stale the moment the first drag lands. `DragState` already does this.
- **`renderDocument` leaves `ctx` holding the CAMERA transform on return, not identity.**
  SCREEN-space chrome drawn after it in the same frame comes out camera-warped unless the caller
  resets first. This is owned by whoever first draws chrome — NOT by `interaction.ts`.
- **D-062's zoom clamp goes at `main.ts`'s boundary, NOT inside `renderDocument`, `hitTest`, or
  `interaction.ts`** (0062-REVIEW §9). *Once, at the boundary*: all three must be handed the SAME
  camera, or the picture, the click, and the drag land in different coordinate systems.
- **A comment saying another file does not exist — or that it OWNS something — is YOURS to fix once
  you falsify it (D-065).** Grep for the name of what you just built before you log; entry 0066
  found five such sites.
- **`createObject` requires ALL derived-slot placeholders** — nine for a preset (D-018). Build them
  from `getObjectSchema`; copy `geometry.test.ts`'s (or `interaction.test.ts`'s) `derivedPlaceholders`.
- **An object with a slot shape its schema forbids cannot go through `mutate` at all** (D-018's
  kind-mismatch check). To fixture one, use a type with NO schema entry — `polyline` — which is
  D-017's one permitted exception. Entry 0066 lost a test run to learning this.
- **All three presets wind COUNTERCLOCKWISE (D-064), PINNED** by four tests in `geometry.test.ts`
  and STATED in `geometry.ts`'s header.
- **A slot's stored key is the PATH joined with `.`** — a cell is at `cells.A1`, never `A1` (D-005).
- **Reading a value to DRAW or HIT-TEST it is not the same as reading one to size the SLOT SET**
  (0062-REVIEW §2), and neither is reading one to decide whether it may be WRITTEN. Do not "unify"
  `readNumber`, `readTableDimension`, and `interaction.ts`'s kind check.
- **A degenerate extent needs its OWN guard (D-066)** — test it at the ORIGIN of the box.
- **Close every discriminated-union `switch` with `const exhaustive: never = x; void exhaustive;`.**
- **Two geometry things that look like defects and are not** (0060-REVIEW §1, §7 Q2): the centroid
  is AREA-WEIGHTED, not the vertex mean, and the derived slots are deliberately redundant.
- **Comments describe the PRESENT (D-060, D-063, D-065)** — date by entry number, never "this cycle".
- **Load-bearing status is §6.2's list** — exactly `address.ts`, `mutation.ts`, `graph/*`,
  `primitives/schema.ts`, `document.ts`. Do not self-declare it.
- **`camera.x`/`camera.y` is the world point at the screen's TOP-LEFT corner (D-061)**, not centre.
- **`render/` is not `engine/`; Rule 1 stops being free there.** Run BOTH typecheck configs.
- **No jsdom in this repo** (adding it is a §6.1 trigger-6 escalation). Only `renderer.test.ts`
  needs a context fake; `camera`, `hittest` and `interaction` need none. **State every file you
  touched in your log entry, comment-only edits included.**
