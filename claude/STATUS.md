# STATUS — as of entry 0067-REVIEW-phase3

STATE: GREEN (compiles under both configs, 776/776 tests pass, 0 skipped, 0 `.only`).

**Process state: PHASE 3 OPEN. Entry 0066 (`render/interaction.ts`) is REVIEWED — ACCEPT WITH EDITS
at 0067-REVIEW, which issued D-068. `command/parser.ts` is cleared to start and is the next slice.
Nothing is built-but-unreviewed: the tree is at a clean review boundary.**

Current phase: **3 — canvas, camera, geometry, command line.** `render/` is COMPLETE for this phase
— camera, geometry, renderer, hit-testing and interaction all built and all reviewed. `command/*`
and `main.ts` are unstarted, and are the only things left before the gate. Phase 3 acceptance
criterion (§6): *"you can create a polygon and a table by command, see both drawn, pan/zoom, select,
and drag the polygon."* Every piece except the command line and the wiring now exists and is tested;
none of it is reachable from a screen. NOT claimed as passing.

Last review point: **0067-REVIEW-phase3, ACCEPT WITH EDITS** (entry 0066). Cycles since last review:
**0/3** · diff since last review: **0 lines / 0 files** (cap 800/10).

## Next slice (recommended)

**`command/parser.ts`** (§5.10: table-driven command string → command object; adding a command is one
registry entry). It fires §6.1 trigger 2 in its own right — first file of the command subsystem — so
expect a review point at the end. **Read D-038 first** (four binding conditions on how a formula is
validated at a user surface: on commit not per keystroke, carry the offending name AND position,
keep `FUNCTION_REGISTRY` enumerable, never discard rejected source text), and **D-040/D-041**, which
come due there and are already ANSWERED — reconcile, do not re-decide. Then `main.ts`, which is what
makes the Phase 3 gate claimable. Read 0067-REVIEW §10's four carry-ins first.

## Built and reviewed

Phase 0 (0027-REVIEW) · the formula engine (0037-REVIEW) · the whole table primitive, through
row/column insert/delete and `delete <table> force` (0054-REVIEW) · `render/camera.ts` and entry
0055's header audit (0058-REVIEW) · `primitives/geometry.ts` (0060-REVIEW) · `render/renderer.ts`
(0062-REVIEW) · `render/hittest.ts` (0064-REVIEW) · entry 0065's header audit (comment-only) ·
**`render/interaction.ts` (0067-REVIEW)**.

**Reviewer edits already in the tree.** 0067-REVIEW: `interaction.ts`'s HAZARD block now states what
a DRAG does at `zoom: 0` (it rejects LOUDLY and journals nothing — unlike `hitTest`, which silently
returns the wrong object) · **D-040's "dragging is NOT covered" bound and the one-batch reading of
§5.9's "independently" are now cited in the header**, both previously uncited · one test added
pinning that a branching formula's notice names ALL its dependencies (§5.3 eager/total, claimed in a
doc comment and previously undefended) · one near-tautological assertion strengthened to a key-set
pin.

## Not started

`command/*`, `main.ts` wiring, §5.9's visual-feedback trio (**D-068**: all three together, in the
renderer), §5.9's per-vertex drag path, `polyline`/`explode`/`addvertex`/`delvertex`, `style` slots,
a table's own `origin.x`/`origin.y` schema entry, point-in-polygon fill hit-testing (D-067), §5.4's
formula bar / in-place cell editing · Phases 4–7.

**Phase 4(b)'s shape already works and is unclaimed.** 0067-REVIEW §3 probe P1: a real `polygon_b`
dragged on canvas moved `origin.x` 0→10 and a real `table_x.B1` holding `= polygon_b.origin.x * 2`
went 0→20 in the same commit, no false cycle. That is "geometry drives data" end to end. The Phase 4
gate needs all three of its clauses simultaneously in one document, plus pixels — do not claim it off
this.

## Known problems

- **A loaded camera is not range-checked (D-062)** — only a `CameraState` `camera.ts` itself
  produces is inside `[MIN_ZOOM, MAX_ZOOM]`. Owed by `main.ts`, and now owed to **three** consumers:
  `renderDocument`, `hitTest` and `pointerDown`/`pointerMove` must be handed the SAME clamped
  camera. At `zoom: 0`, `hitTest` silently returns the topmost object (0064-REVIEW F2) while a drag
  refuses loudly with a D-025 message that names the value rather than the camera (0067-REVIEW §3).
  Deliberately not guarded in any of the three; 0062-REVIEW §9 puts the clamp at the boundary, once.
- **`sides` has no upper bound**, and **no bound on how large `rows`/`cols` may be set** via a raw
  `setSlot` (0060-REVIEW fix list 2, carried). One ruling covers all three or none does. **Do not
  fix in isolation.**
- **The renderer does not clip cell text to its cell** (0062-REVIEW §4). §5.4 does not specify it;
  Rule 5 says leave it.
- **Three files' table paths are pinned only against fixtures** (`renderer.ts`, `hittest.ts`,
  `interaction.ts`) — owed an end-to-end test through a table-creation *command*.
  (`interaction.test.ts` goes through `mutate()`, which is as far as a pre-`command/` slice reaches.)
- **A drag fires one mutation per pointer move, each deep-cloning the document** (§5.9's drag
  performance note). Untouched deliberately — Rule 5, and "visibly laggy" cannot be observed until
  `main.ts` exists. Whatever fixes it MUST throttle, never write state outside `mutation.ts`.
- **`readNumber`/`asPointArray` live in `renderer.ts`, imported by `hittest.ts`.** Still **two**
  consumers — `interaction.ts` reads `getSlot` directly because it needs slot KIND, which those two
  deliberately discard (0067-REVIEW §11.4 confirms the trigger is unfired). **At the THIRD consumer,
  extract them into `render/slots.ts`** (0064-REVIEW §5).
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
  reports every table as undraggable, for a reason unrelated to §5.9's per-vertex clause. The
  table-creation command adds the pair to `TABLE_SCHEMA` at these same paths; none of the three
  render files then needs a change.
- **The §5.2 header budget (20-40 ordinary) is not reachable** (entry 0065). Ten headers remain
  over — `mutation.ts` 151 (budget 80), `table.ts` 101, `parser.ts` 97, `document.ts` 94 and six
  more. `render/interaction.ts` is **76** (`camera.ts` 42, `hittest.ts` 62, `renderer.ts` 78) — it
  arrived at 64 and 0067-REVIEW's own edits added 12, which that review bills to itself. **Entry
  0065 puts three options to the human and recommends raising the ordinary budget to ~60-70** — a
  PROCESS_BRIEF amendment is theirs to make, and it is now overdue enough that reviewers are adding
  hazard lines to files they are simultaneously measuring as over budget.
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

Every ruling in `DECISIONS.md` (D-001 through **D-068**) binds without restatement here. Newest
three: **D-066** — an object that draws nothing is not hittable; a degenerate extent needs its own
guard. **D-067** — stroke-only hit-testing is correct while nothing can be filled, and does NOT
block Phase 3's gate. **D-068** — §5.9's visual-feedback trio (selection highlight, error badge,
formula-driven slot indicator) lands in ONE cycle, in the renderer; `render/interaction.ts` is
explicitly NOT its home, and 0064-REVIEW §10 item 4's contrary expectation is withdrawn.

## Live PROVISIONAL tags and open questions

**`PROVISIONAL(Q-012)` → `src/render/renderer.ts`** (`DEFAULT_SHAPE_STROKE_WIDTH`, the
`TABLE_CELL_*` constants). Is a stroke width / cell size / font size in WORLD units or SCREEN pixels?
Provisional choice (a) world units is what the tree does; neither `hittest.ts`'s tolerance nor
`interaction.ts` depends on it. Due with the `style`-slots cycle.

Q-008 remains OPEN, deferred, blocking nothing — and this cycle could not reopen it: a drag's
`slot.value + delta` cannot produce `-0`, because the zero-delta guard returns before any component
whose delta is `±0`. **Q-001 and Q-002 are ANSWERED (D-041, D-040) and come due at
`command/parser.ts`** — reconcile, do not re-decide. Next free: **Q-013**.

## Gotchas for the next model

- **Dragging calls the mutation API, PER COMPONENT (§5.9) — BUILT, in `render/interaction.ts`.** Do
  not normalise it into all-or-nothing dragging; it is pinned by three tests. **D-040 forbids the
  other normalisation**: `set` may overwrite a formula slot, a drag may never.
- **`render/interaction.ts` draws NOTHING and touches no canvas — D-068 makes that binding.** It is
  a pure state machine over screen points. §5.9's visual-feedback trio goes in ONE cycle, in the
  renderer, and `renderDocument` widens to carry the selection. Do not move drawing into
  `interaction.ts` for the highlight alone.
- **`main.ts` must reset the canvas transform** before drawing screen-space chrome after
  `renderDocument`, which returns with the CAMERA transform standing. That is not
  `interaction.ts`'s job (D-068 part 3).
- **`interaction.ts` reads `getSlot` directly, NOT `readNumber`** — it needs slot KIND, and
  `readNumber`/`asPointArray` deliberately ignore kind (0062-REVIEW §2). The `render/slots.ts`
  extraction trigger is still at two consumers, not three.
- **A rejected drag step does not advance the drag's `lastWorldPoint`** — the delta is retried on the
  next move. Do not "fix" this into advancing regardless; that silently loses distance.
- **Hold the object's `id`, not the `GraphObject`** — `mutate` returns new objects, so a held
  reference goes stale the moment the first drag lands. `DragState` already does this, and a key-set
  test pins the shape.
- **D-062's zoom clamp goes at `main.ts`'s boundary, NOT inside `renderDocument`, `hitTest`, or
  `interaction.ts`** (0062-REVIEW §9). *Once, at the boundary*: all three must be handed the SAME
  camera, or the picture, the click and the drag land in different coordinate systems.
- **A comment saying another file does not exist — or that it OWNS something — is YOURS to fix once
  you falsify it (D-065).** Grep for the name of what you just built before you log; entry 0066
  found five such sites, two of which also carried inherited debt it disclosed rather than absorbed.
- **`createObject` requires ALL derived-slot placeholders** — nine for a preset (D-018). Build them
  from `getObjectSchema`; copy `geometry.test.ts`'s or `interaction.test.ts`'s `derivedPlaceholders`.
- **An object with a slot shape its schema FORBIDS cannot go through `mutate` at all** (D-018's
  kind-mismatch check). To fixture one, use a type with NO schema entry — `polyline` — which is
  D-017's one permitted exception. Entry 0066 lost a test run to learning this.
- **All three presets wind COUNTERCLOCKWISE (D-064), PINNED** by four tests in `geometry.test.ts`
  and STATED in `geometry.ts`'s header.
- **A slot's stored key is the PATH joined with `.`** — a cell is at `cells.A1`, never `A1` (D-005).
- **Three different reasons to read a slot, and they do NOT unify** (0062-REVIEW §2, 0067-REVIEW §11):
  to DRAW or HIT-TEST it (`readNumber` — kind-blind), to SIZE the slot set (`readTableDimension` —
  `literal`-only, a Rule 6 guard), and to decide whether it may be WRITTEN (`interaction.ts` —
  kind-aware). Do not merge them.
- **A degenerate extent needs its OWN guard (D-066)** — test it at the ORIGIN of the box.
- **Close every discriminated-union `switch` with `const exhaustive: never = x; void exhaustive;`.**
- **Two geometry things that look like defects and are not** (0060-REVIEW §1, §7 Q2): the centroid
  is AREA-WEIGHTED, not the vertex mean, and the derived slots are deliberately redundant.
- **Comments describe the PRESENT (D-060, D-063, D-065)** — date by entry number, never "this cycle".
- **Load-bearing status is §6.2's list** — exactly `address.ts`, `mutation.ts`, `graph/*`,
  `primitives/schema.ts`, `document.ts`. Do not self-declare it.
- **`camera.x`/`camera.y` is the world point at the screen's TOP-LEFT corner (D-061)**, not centre.
- **`render/` is not `engine/`; Rule 1 stops being free there.** Run BOTH typecheck configs.
- **No jsdom in this repo** (adding it is a §6.1 trigger-6 escalation). Only `renderer.test.ts` needs
  a context fake; `camera`, `hittest` and `interaction` need none. **State every file you touched in
  your log entry, comment-only edits included.**
