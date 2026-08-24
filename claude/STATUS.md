# STATUS — as of entry 0060-REVIEW-phase3

STATE: GREEN (compiles under both configs, 714/714 tests pass, 0 skipped, 0 `.only`).

**Process state: PHASE 3 OPEN, reviewed and cleared. The next slice may start.**
Entry 0059's geometry presets were reviewed at **0060-REVIEW-phase3: ACCEPT WITH EDITS** — eight
comment-only reviewer edits, no logic touched, two rulings minted (**D-063**, **D-064**). The §6.1
trigger-2 review point that entry 0059 stopped on is closed.

Current phase: **3 — canvas, camera, geometry, command line.** Two files built and reviewed
(`render/camera.ts`, `primitives/geometry.ts`); the rest is unstarted.
Phase 3 acceptance criterion (§6): *"you can create a polygon and a table by command, see both
drawn, pan/zoom, select, and drag the polygon."* Camera math and the geometry primitive (engine
side) exist; nothing renders, nothing has a command line yet. NOT claimed as passing.

Last review point: **0060-REVIEW-phase3, ACCEPT WITH EDITS** (covering entry 0059).
Cycles since last review: **0/3** · diff since last review: **0 lines / 0 files** (cap 800/10).

## Next slice (recommended)

**`render/renderer.ts`** — confirmed by 0060-REVIEW §10 as the right next step: `render/camera.ts`
and a real primitive with a `vertices` slot both exist now, so this is the first cycle that can put
anything on screen. It is its own §6.1 trigger-2 review point, as are `render/hittest.ts` /
`interaction.ts` and `command/parser.ts` after it. 0060-REVIEW's four fix-list items (§8) are all
non-blocking and may ride along with any slice; item 1 (a winding-pin test, D-064) is the one worth
doing soonest and is about ten lines.

## Built and reviewed

Phase 0 in full (0027-REVIEW) · the formula engine (0037-REVIEW) · `address.ts`'s column
arithmetic, `primitives/table.ts`'s first file (0041-REVIEW) · the dynamic slot family (0043-REVIEW)
· range evaluation wired end-to-end (0044+0046, reviewed 0045/0048) · row/column INSERTION (0047,
reviewed 0048/0049) · row/column DELETION (0050, reviewed 0051, fix list closed 0052) ·
`delete <table>` reject-until-`force` + D-057's broken-slot report channel (0053) — all reviewed and
accepted at 0054-REVIEW-phase2 · `render/camera.ts` (0057), entry 0055's comment/header audit, and
entry 0056's D-060 ruling — accepted at 0058-REVIEW-phase3 · **`primitives/geometry.ts`'s three
parametric presets and their nine derived slots, registered in `primitives/schema.ts` (0059) —
accepted at 0060-REVIEW-phase3.**

## Built this batch, not yet reviewed

Nothing. The tree is at a clean review boundary.

## Not started

`render/renderer.ts`, `render/hittest.ts`, `render/interaction.ts`, `render/measure.ts`,
`command/*`, `polyline`/`explode`/`addvertex`/`delvertex` (deferred deliberately — entry 0059) ·
Phases 4–7.

## Known problems

- **`sides` has no upper bound** (0060-REVIEW fix list 2). `Number.isInteger(sides) && sides >= 3`
  admits `1e9`; measured at that review, `sides=1e6` takes 549ms and `1e9` allocates a billion
  `Point`s and hangs or OOMs. Same class as the `rows`/`cols` entry below. **Do not fix in
  isolation** — if a bound is ever added it covers `rows`/`cols`/`sides` in one ruling.
- **No bound on how large `rows`/`cols` may be set** via a raw `setSlot`.
- **A loaded camera is not range-checked (D-062)** — only a `CameraState` `render/camera.ts` itself
  produces carries the `[MIN_ZOOM, MAX_ZOOM]` guarantee. The clamp is owed by whichever cycle first
  loads a document into a live canvas, at the `render/` boundary.
- **D-060/D-063 not reconciled in test files** (0058-REVIEW Finding 2): 13 bare "this cycle" sites
  (`mutation.test.ts` ×9, `schema.test.ts` ×2, `ast.test.ts` ×1, one `describe` title) and 2 stale
  headers claiming "`mutation.ts` does not exist yet" (`graph/cycles.test.ts:4`,
  `graph/eval.test.ts:4`). **Non-test source is clean** (re-verified at 0060-REVIEW after its edit 1
  fixed the one site entry 0059 had introduced). Comment-only, blocks nothing.
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
- **Mixed line endings**: the two files from entry 0059 are LF, the rest of the repo is CRLF, and
  there is no `.gitattributes` (0060-REVIEW fix list 4). Harmless; know it before blaming a
  whitespace-only diff on a tool.
- **Carried unchanged:** journal STRUCTURE deliberately unvalidated beyond `Array.isArray` ·
  `lexer.ts`'s two disclosed edge cases · §5.11's `style` field · `nextObjectId` reconciliation (and,
  per D-062, its domain is unchecked too) · `noUnusedLocals` off · recursion depth.

## Settled — do not re-raise

Every ruling in `DECISIONS.md` (D-001 through **D-064**) is binding without restatement here.

## Live PROVISIONAL tags and open questions

None live. Q-008 remains OPEN, deferred, blocking nothing — 0060-REVIEW §5 verified that entry
0059's dropped `-0` guard depends on Q-008's provisional option (a) but is **safe under every option**
(if `-0` became legal, `hasIllegalNumber` would stop rejecting it in the same motion), so no tag is
owed. Q-001/Q-002 come due at `command/parser.ts`. Next free: **Q-012**.

## Gotchas for the next model

- **`createObject` requires the caller to supply ALL derived-slot placeholders** — nine of them for
  a preset (D-018; probed at 0060-REVIEW, omitting them fails with nine "slot does not exist"
  messages). The command layer that creates a `circle` by typing `circle` must build them from
  `getObjectSchema`. Copy `geometry.test.ts`'s own `derivedPlaceholders` helper — that is the pattern.
- **All three presets wind COUNTERCLOCKWISE, and D-064 makes that a stated invariant**, not an
  accident. The renderer's fill rule, any winding-number hit test, and `explode` (which snapshots
  `vertices` in this order into user-editable slots) all inherit it. A pinning test is owed
  (0060-REVIEW fix list 1). One consequence: no preset can drive `computeCentroid` to a negative
  signed area, so `finiteOrTypeError`'s `-0` guard is reachable through the CONTRACT
  (`verticesDerivedSlots` takes an arbitrary `Point[]`, which `polyline` will hand it) but not
  through any preset today. Keep the guard.
- **Centroid is the AREA-WEIGHTED centroid, not the vertex mean** — deliberate, confirmed correct at
  0060-REVIEW §7 Q2, so it stays right once `polyline`/`explode` produce irregular shapes. Read
  `computeCentroid`'s doc comment before "simplifying" it.
- **The geometry derived slots are deliberately redundant in their arithmetic** — `centroid.x` and
  `centroid.y` each recompute the whole centroid, the four `bounds.*` each recompute the whole
  bounds. That is Rule 5 and §4 working as intended (0060-REVIEW §1). **Do not "fix" it.**
- **Before adding a defensive numeric guard (D-025/D-027/D-033 territory), mutation-test it before
  trusting it** — entry 0059's `finalizeVertices` shipped a guard its first draft could not
  justify, and the probe, not the test, caught it. Don't assume two guards that look alike have the
  same reachability.
- **Comments describe the PRESENT (D-060, and now D-063).** A NEW file's header states what the file
  IS — never "this cycle builds X", never a pointer to a diff. Date by entry number ("entry 0059").
- **Do not self-declare a file "load-bearing per Rule 3."** §6.2's list is exactly `address.ts`,
  `mutation.ts`, `graph/*`, `primitives/schema.ts`, `document.ts`. Being a subsystem's first file
  fires §6.1 trigger 2 (a review point); it does not add you to §6.2 (a phase gate).
- **Camera convention: `camera.x`/`camera.y` is the world point at the screen's TOP-LEFT corner
  (D-061)**, not the viewport centre.
- **`render/` is not `engine/`, Rule 1 stops being free there.** Run BOTH typecheck configs every
  cycle.
- **Dragging calls the mutation API, per component (§5.9).** Still not built.
- **State every file you touched in the log entry, comment-only edits included.**
- Each PowerShell call is a fresh process; the Bash tool's `npm`/`npx` resolve directly and don't
  need PowerShell.
