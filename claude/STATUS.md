# STATUS — as of entry 0068-command-parser

STATE: GREEN (compiles under both configs, 835/835 tests pass, 0 skipped, 0 `.only`).

**Process state: PHASE 3 OPEN, and `command/parser.ts` is BUILT BUT NOT REVIEWED. Review is REQUIRED
before the next slice — §6.1 trigger 2 (first file of the `command/` subsystem) and §6.3's diff cap
(~1103 lines in one cycle, against ~800) both fire. Do not start `command/commands.ts` until 0068 is
reviewed.**

Current phase: **3 — canvas, camera, geometry, command line.** `render/` is COMPLETE and reviewed.
`command/parser.ts` turns a typed line into a typed command object; **nothing executes one** —
`command/commands.ts` and `main.ts` are unstarted. Phase 3 criterion (§6): *"you can create a polygon
and a table by command, see both drawn, pan/zoom, select, and drag the polygon."* `polygon …` and
`table …` now PARSE; no pixel has ever come from a typed line. NOT claimed.

Last review point: **0067-REVIEW-phase3, ACCEPT WITH EDITS** (entry 0066). Cycles since last review:
**1/3** · diff since last review: **~1103 lines / 4 files (cap 800/10 — over on lines)**.

## Next slice (recommended, AFTER 0068 is reviewed)

**`command/commands.ts`** (§5.10: handlers → mutation API calls) — the first file that resolves
anything: `parseAddress`/`checkNameAvailable` over the strings `parser.ts` passes through verbatim,
then `Operation` building and `mutate`. **D-040/D-041 come due there, not in the parser**: `set` over
a formula slot REPLACES it and must report what it replaced; `unlink` keeps the value last displayed,
errors included. It owes §5.10's "name the specific slots involved" with real slots for the first
time, and reads D-057's `brokenSlots` for a `delete … force` echo. Then `main.ts` — read 0067-REVIEW
§10's carry-ins 1–3 first (ONE clamped camera to all three render consumers; reset the canvas
transform; `TABLE_SCHEMA` owes `origin.x`/`origin.y`).

## Built and reviewed

Phase 0 (0027-REVIEW) · formula engine (0037) · the whole table primitive through row/column
insert/delete and `delete <table> force` (0054) · `render/camera.ts` + entry 0055's header audit
(0058) · `primitives/geometry.ts` (0060) · `render/renderer.ts` (0062) · `render/hittest.ts` (0064) ·
entry 0065's header audit · `render/interaction.ts` (0067).

## Built this batch, NOT yet reviewed

**`src/command/parser.ts` (801) + `src/command/parser.test.ts` (284, 59 tests)** — §5.10's parsing
half; sixteen commands registered (`circle`, `polygon`, `rect`, `table`, `link`, `unlink`, `set`,
`rename`, `delete [force]`, `refs`, `list`, `select`, `zoom`, `fit`, `save`, `load`). Plus two
comment-only edits owed under D-065 (`main.ts` said `command/` did not exist; `primitives/table.ts`
said a table command's missing piece was the command word).

## Not started

`command/commands.ts`, `main.ts` wiring, §5.9's visual-feedback trio (**D-068**: all three together,
in the renderer), §5.9's per-vertex drag path, `polyline`/`explode`/`addvertex`/`delvertex`, `style`
slots, a table's own `origin.x`/`origin.y` schema entry, point-in-polygon fill hit-testing (D-067),
§5.4's formula bar / in-place cell editing · Phases 4–7. **Phase 4(b)'s shape already works and is
unclaimed** (0067-REVIEW probe P1: dragging `polygon_b` moved `origin.x` 0→10 while `table_x.B1`
holding `= polygon_b.origin.x * 2` went 0→20, one commit, no false cycle) — the gate needs all three
clauses in one document plus pixels, and **clause (b) has no authoring path yet: Q-013.**

## Known problems (detail lives where the pointer says)

- **Eight §5.10 commands have no registry entry** — `polyline`/`text`/`script`/`image`/`explode`/
  `addvertex`/`delvertex` wait on a schema or an `Operation` kind; **`pan` waits on Q-012**, since
  §5.10 states no argument grammar and `pan <dx> <dy>` must first say world units or screen pixels.
  All eight report "not built", not "unknown command" (`COMMANDS_SPECIFIED_BUT_NOT_BUILT`).
- **A loaded camera is not range-checked (D-062)** — `main.ts` owes ONE clamped camera to all three
  of `renderDocument`, `hitTest`, `pointerDown`/`pointerMove`. At `zoom: 0` the hit test silently
  returns the topmost object; the drag refuses loudly. Clamp at the boundary, once (0062-REVIEW §9).
- **`sides` has no upper bound, nor `rows`/`cols` via a raw `setSlot`** — and `polygon`/`table` now
  parse arbitrary counts, so handlers make it reachable from a typed line. One ruling covers all
  three or none. **Do not fix in isolation** (0060/0062/0064-REVIEW).
- **A `table` has no `origin.x`/`origin.y` schema entry** (0061 Decision 4) — `renderer`/`hittest`
  fall back to `(0,0)` and `interaction.ts` calls every table undraggable; the table-creation HANDLER
  adds the pair. Those same three files pin their table paths against FIXTURES only, and are owed an
  end-to-end test through a table-creation command (0067-REVIEW fix 2).
- **Row/column deletion CAN still be REJECTED**, contradicting §5.4 — repair unbounded, slot walk
  extent-bounded; reachable only via a raw `setSlot`, pinned by `mutation.test.ts`'s "KNOWN
  INCOHERENCE" test, and D-053 forbids a one-sided fix. Relatedly a dimension write is not checked
  for COHERENCE with the cells that exist.
- **The §5.2 header budget (20-40 ordinary) is not reachable** (entry 0065) — `command/parser.ts`
  arrived at 65; ten others are over (`mutation.ts` 151 against 80, `table.ts` 101, `parser.ts` 97,
  `document.ts` 94, `interaction.ts` 76…). **0065 recommends ~60-70; the amendment is the human's.**
- **Three carried render gaps, all deliberate:** one `mutate` per pointer move, each deep-cloning the
  document (§5.9's perf note — any fix MUST throttle, never write outside `mutation.ts`) · cell text
  is not clipped to its cell (§5.4 silent, Rule 5) · `readNumber`/`asPointArray` still have two
  consumers, and move to `render/slots.ts` at the THIRD (0064-REVIEW §5).
- **Comment debt in test files** (non-test source is D-060-clean): 13 bare "this cycle" sites and two
  stale "`graph/eval.ts` does not exist yet" claims in `schema.test.ts` (0058-REVIEW F2) — owned by
  whoever next touches those files. Plus ~20 "see the file header" pointers, of which only those
  deferring a function's OWN contract upward are defects (0065 F2).
- **Carried unchanged, each with its pointer:** mixed line endings in the WORKING TREE only
  (`core.autocrlf=true`; a `.gitattributes` is a §6.1 trigger-6 escalation) · dangling-reference
  messages name the DEPENDENT, not the missing SOURCE (0045-REVIEW F4) · D-022's bounded-correctness
  claim fails for `table` (0043-REVIEW §7 Q1) · `describeValueType` duplicated in
  `functions.ts`/`eval.ts` (0037-REVIEW F4) · `rewrite`/`repairObjectFormulaAddresses` walk `formula`
  slots only, owed text boxes at Phase 5 · journal structure unvalidated beyond `Array.isArray` ·
  `lexer.ts`'s two edge cases · §5.11's `style` field · `nextObjectId` reconciliation ·
  `noUnusedLocals` off · recursion depth.

## Settled — do not re-raise

Every ruling in `DECISIONS.md` (D-001 through **D-068**) binds without restatement here. Newest:
**D-066** an object that draws nothing is not hittable · **D-067** stroke-only hit-testing is correct
while nothing can be filled and does NOT block Phase 3's gate · **D-068** §5.9's visual-feedback trio
lands in ONE cycle, in the renderer, and `render/interaction.ts` is not its home.

## Live PROVISIONAL tags and open questions

**`PROVISIONAL(Q-013)` → `src/command/parser.ts`** (`matchArguments`'s formula guard). How is a
general formula (`= polygon_b.origin.x * 2`) authored, when §5.10 has no command that takes one and
§5.4's formula bar is unbuilt? Provisional: **refuse any unquoted argument beginning with `=`**,
naming `link` in the message. Reversible — accepting `=` later changes the meaning of nothing that
parses today. **Phase 4(b) cannot be authored until this is answered.**

**`PROVISIONAL(Q-012)` → `src/render/renderer.ts`** (`DEFAULT_SHAPE_STROKE_WIDTH`, the
`TABLE_CELL_*` constants): world units or screen pixels? Provisional (a) world units. Due with the
`style`-slots cycle — and now also blocking `pan`'s argument grammar.

Q-008 stays OPEN, deferred, blocking nothing; 0068 did not reopen it (a `-0` typed into `set` reaches
the command object and `mutate` refuses it, exactly as option (a) says). **Q-001/Q-002 are ANSWERED
(D-041, D-040) and come due at `command/commands.ts`** — reconcile, do not re-decide. Next free:
**Q-014**.

## Gotchas for the next model

- **`command/parser.ts` resolves NOTHING and takes no document — deliberate** (0068 Decision 1). Do
  not add an `objects` parameter: a creation command's fresh id and default name come from
  `nextObjectId`, so resolving there splits resolution across two files. §5.2's "resolve at parse
  time" governs a STORED AST; a command object is never stored. **Grammar failures are the parser's,
  identity failures the handler's** — `set polygon_1 42` (no dot) and `rename polygon_1 3bad` both
  PARSE, following `address.ts`'s L-4 precedent; re-checking the address form in `command/` would be
  a second definition of it (D-043).
- **`command/parser.ts` does NOT call `parseFormula`, contradicting 0067-REVIEW §10 item 4** — no
  §5.10 command takes a formula expression (0068 "Where I got stuck" #1). D-038's four conditions
  come due wherever it IS first called: `commands.ts` if Q-013 lands as (a), else the formula-bar
  cycle. **Read that disclosure before assuming either way.**
- **Quoting decides TYPE on the command line**: `set v.x 42` is the number, `"42"` the string, and a
  quoted token is refused where a number is declared; a token is a bare word or a WHOLE quoted string
  (no shell-style concatenation). **Positionals fill BEFORE flags**, so `delete force` deletes the
  object *named* `force` — reordering makes such an object silently undeletable. **`COMMAND_NAMES`
  and `COMMANDS_SPECIFIED_BUT_NOT_BUILT` must stay disjoint**; a test pins it.
- **A non-finite or `-0` number typed into `set` reaches the command object unchanged** — D-031
  clause 3: a text-scanning stage does not enforce document-state policy, `mutate` refuses it
  (D-025). Do not add a guard in `command/`.
- **`render/interaction.ts` draws NOTHING and touches no canvas — D-068 binds it.** The trio goes in
  ONE cycle, in the renderer, and `renderDocument` widens to carry the selection. **`main.ts` must
  reset the canvas transform** before screen-space chrome; `renderDocument` returns with the camera
  transform standing. **A rejected drag step does not advance `lastWorldPoint`** (the delta is
  retried, not lost), and a drag **holds the object's `id`, never the `GraphObject`**.
- **A comment saying another file does not exist — or OWNS something — is YOURS once you falsify it
  (D-065)**; 0068 grepped for `command` before logging, fixed two sites and left four alone. And
  **`createObject` requires ALL derived-slot placeholders** — nine for a preset (D-018), built from
  `getObjectSchema`; **an object with a slot shape its schema FORBIDS cannot go through `mutate` at
  all**, so fixture one on `polyline`, which has no schema (D-017's exception).
- **Three different reasons to read a slot, and they do NOT unify** (0062-REVIEW §2, 0067-REVIEW
  §11): to DRAW/HIT-TEST (`readNumber`, kind-blind), to SIZE the slot set (`readTableDimension`,
  `literal`-only), to decide whether it may be WRITTEN (`interaction.ts`, kind-aware).
- **Four rulings the code depends on constantly, stated in DECISIONS.md and not restated here:**
  D-064 (all three presets wind counterclockwise, pinned) · D-005 (a slot's stored key is the PATH
  joined with `.` — `cells.A1`, never `A1`) · D-066 (a degenerate extent needs its OWN guard, tested
  at the ORIGIN of the box) · D-061 (`camera.x`/`camera.y` is the world point at the screen's
  TOP-LEFT corner, not centre). Also house style: close every discriminated-union `switch` with
  `const exhaustive: never = x; void exhaustive;`, and **`render/` and `command/` are not `engine/`**
  — `command/` is outside `tsconfig.engine.json`, so run BOTH configs anyway.
- **When a suite passes on its first run, mutation-check it.** 0068 neutralised six load-bearing
  lines one at a time; each was caught by a named test — the only evidence a green suite
  discriminates (D-016's own lesson).
