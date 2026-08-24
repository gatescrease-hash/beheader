# STATUS — as of entry 0059-geometry-presets

STATE: GREEN (compiles under both configs, 714/714 tests pass, 0 skipped, 0 `.only`).

**Process state: PHASE 3 OPEN, second slice built, REVIEW REQUIRED before the next.**
`primitives/geometry.ts` — the three PARAMETRIC geometry presets (`circle`/`polygon`/`rect`, §5.5)
and their derived slots (`vertices`, `centroid.x/y`, `area`, `length`, `bounds.*`) — is built,
tested (41 tests), mutation-checked (D-016, three separate probes), and registered in
`primitives/schema.ts`'s `SCHEMAS`. This is the geometry primitive's first file, which fires
**§6.1 trigger 2** on its own: no further Phase 3 work should start until this is reviewed. See
entry 0059 for the full account, including a real mistake caught mid-cycle by mutation-testing
(a `-0` guard I first wrote defensively turned out to be dead code; found before it shipped
unverified — see that entry's Decision 4).

Current phase: **3 — canvas, camera, geometry, command line.** Two files built
(`render/camera.ts`, `primitives/geometry.ts`); the rest is unstarted.
Phase 3 acceptance criterion (§6): *"you can create a polygon and a table by command, see both
drawn, pan/zoom, select, and drag the polygon."* Camera math and the geometry primitive (engine
side) exist; nothing renders, nothing has a command line yet. NOT claimed as passing.

Last review point: **0058-REVIEW-phase3, ACCEPT WITH EDITS** (covering entries 0055, 0056, 0057).
Cycles since last review: **1/3** · diff since last review: **~1,134 lines / 5 files** (cap
800/10) — moot, since §6.1 trigger 2 already forces a review point regardless of the cap.

## Next slice (recommended)

**Do not start it before this cycle is reviewed** (§6.1 trigger 2). Once reviewed, the remaining
Phase 3 first-of-subsystem files are `render/renderer.ts`, `render/hittest.ts`/`interaction.ts`,
and `command/parser.ts` — each its own review point (0058-REVIEW-phase3 §8). `render/renderer.ts`
is the more natural next step now that both `render/camera.ts` and a real primitive
(`primitives/geometry.ts`) exist to draw with, but this is the reviewer's call to confirm or
redirect. The D-060 test-file comment sweep (13 bare "this cycle" sites + 2 stale headers,
0058-REVIEW Finding 2) is still outstanding, comment-only, and can ride along with any cycle.

## Built and reviewed

Phase 0 in full (0027-REVIEW) · the formula engine (0037-REVIEW) · `address.ts`'s column
arithmetic, `primitives/table.ts`'s first file (0041-REVIEW) · the dynamic slot family (0043-REVIEW)
· range evaluation wired end-to-end (0044+0046, reviewed 0045/0048) · row/column INSERTION (0047,
reviewed 0048/0049) · row/column DELETION (0050, reviewed 0051, fix list closed 0052) ·
`delete <table>` reject-until-`force` + D-057's broken-slot report channel (0053) — all reviewed and
accepted at 0054-REVIEW-phase2 · `render/camera.ts` (0057), entry 0055's comment/header audit, and
entry 0056's D-060 ruling — all reviewed and accepted at 0058-REVIEW-phase3.

## Built this batch, not yet reviewed

- **`primitives/geometry.ts` + `primitives/geometry.test.ts` (entry 0059).** New file, new
  subsystem. §6.1 trigger 2.
- **`primitives/schema.ts`** — `CIRCLE_SCHEMA`/`POLYGON_SCHEMA`/`RECT_SCHEMA` added and registered;
  header updated.
- **`primitives/schema.test.ts`, `mutation.test.ts`** — one existing test each updated because
  `circle`/`polygon` are no longer examples of "a type with no schema entry yet" (switched to
  `polyline`, disclosed in entry 0059 as a §6.1 trigger-5 consequence, not a silent fix).
- 0055's prose diff and the D-060 test-file sweep (Finding 2) — still outstanding, unchanged from
  before this cycle.

## Not started

`render/renderer.ts`, `render/hittest.ts`, `render/interaction.ts`, `render/measure.ts`,
`command/*`, `polyline`/`explode`/`addvertex`/`delvertex` (deferred deliberately — entry 0059) ·
Phases 4–7.

## Known problems

- **A loaded camera is not range-checked (D-062)** — only a `CameraState` `render/camera.ts`
  itself produces carries the `[MIN_ZOOM, MAX_ZOOM]` guarantee. The clamp is owed by whichever
  cycle first loads a document into a live canvas, at the `render/` boundary — not `geometry.ts`,
  not `document.ts`.
- **D-060 is not reconciled in test files** (0058-REVIEW Finding 2): 13 bare "this cycle" sites
  (`mutation.test.ts` x9, `schema.test.ts` x2, `ast.test.ts` x1, one `describe` title) and 2 stale
  headers claiming "`mutation.ts` does not exist yet" (`graph/cycles.test.ts:4`,
  `graph/eval.test.ts:4`). Non-test source is clean. Comment-only, blocks nothing.
- **Row/column deletion CAN still be REJECTED**, contradicting §5.4's "it proceeds even when other
  objects depend on the deleted cells" — the address-repair pass is unbounded while the slot walk is
  extent-bounded. Reachable only through a raw `setSlot` writing an out-of-extent cell. Pinned by a
  test (`mutation.test.ts`, "KNOWN INCOHERENCE", entry 0052). D-053's companion ruling forbids
  fixing one side — insertion has the identical divergence; both close together or not at all.
- **A dimension write is not checked for COHERENCE with the cells that exist, in general** (D-046/
  D-053's narrower coverage). Still unguarded: a raw `setSlot` writing an incoherent literal count,
  and a same-batch dimension change landing after `findInvalidTableResizes` seeds its tracked state.
- **No bound on how large `rows`/`cols` may be set** via a raw `setSlot`.
- **The dangling-reference message names the DEPENDENT, not the missing SOURCE**, repeating once
  per missing cell (0045-REVIEW Finding 4, carried).
- **D-022's bounded-correctness claim does not hold for `table`** — narrowed/accepted at
  0043-REVIEW §7 Q1; the pinning test stays as a tripwire.
- **`describeValueType` is duplicated verbatim** in `functions.ts` and `eval.ts` (0037-REVIEW
  Finding 4, carried).
- **`rewriteObjectFormulaAddresses`/`repairObjectFormulaAddresses` walk `formula`-kind slots only**
  — total today, but §5.4 requires the pass to cover text boxes too once Phase 5 lands.
- **Carried unchanged:** journal STRUCTURE deliberately unvalidated beyond `Array.isArray` ·
  `lexer.ts`'s two disclosed edge cases · §5.11's `style` field · `nextObjectId` reconciliation (and,
  per D-062, its domain is unchecked too) · `noUnusedLocals` off · recursion depth.

## Settled — do not re-raise

Every ruling in `DECISIONS.md` (D-001 through **D-062**) is binding without restatement here.

## Live PROVISIONAL tags and open questions

None live. Q-007 is `ANSWERED → D-061`; Q-008 remains OPEN, deferred, blocking nothing — this
cycle's geometry math introduces no new `-0` authoring path (every candidate site was proved
unreachable or, where reachable, guarded and tested — entry 0059's Decision 4). Next free: **Q-012**.

## Gotchas for the next model

- **A preset's `vertices`/`centroid`/`area`/`length`/`bounds.*` are ALL derived slots, computed via
  `primitives/geometry.ts`, registered in `primitives/schema.ts`'s `SCHEMAS`.** `getObjectSchema`
  now returns a real entry for `circle`/`polygon`/`rect` — `polyline` is the current
  still-unregistered example if you need one for a test fixture (not `circle`/`polygon` anymore).
- **Centroid is the AREA-WEIGHTED centroid, not the vertex mean** — deliberate, so it stays correct
  once `polyline`/`explode` produce irregular shapes. See `geometry.ts`'s `computeCentroid` doc
  comment before "simplifying" it.
- **Before adding a defensive numeric guard (D-025/D-027/D-033 territory), mutation-test it before
  trusting it.** Entry 0059's own `finalizeVertices` shipped an untested `-0` guard in its first
  draft; mutation-testing found it dead (unreachable given the addition structure — see that
  function's own doc comment for the proof), while the analogous guard in `finiteOrTypeError`
  (used by `centroid.x`/`centroid.y`) is genuinely reachable and is pinned by a real, hand-derived
  `-0` fixture. Don't assume symmetry between two guards that look alike.
- **Camera convention: `camera.x`/`camera.y` is the world point at the screen's TOP-LEFT corner
  (D-061)**, not the viewport centre. Unchanged this cycle.
- **`render/` is not `engine/`, Rule 1 stops being free there — unaffected this cycle**
  (`geometry.ts` is pure `engine/`, no render dependency). Run BOTH typecheck configs every cycle.
- **Dragging calls the mutation API, per component (§5.9).** Still not built.
- **Comments describe the PRESENT (D-060, binding).** State the behaviour and the reason. A
  `(D-0XX)` citation is a supplement, never a substitute. Headers budgeted 20-40 lines ordinary,
  ~80 load-bearing (PROCESS_BRIEF §5.2).
- **State every file you touched in the log entry, comment-only edits included.**
- Each PowerShell call is a fresh process; the Bash tool's `npm`/`npx` resolve directly and don't
  need PowerShell.
