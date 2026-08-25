# STATUS — as of entry 0069-REVIEW-phase3

STATE: GREEN (compiles under both configs, 837/837 tests pass, 0 skipped, 0 `.only`).

Current phase: **3 — canvas, camera, geometry, command line.** `render/` and `command/parser.ts` are
both COMPLETE and REVIEWED. **Nothing executes a command yet** — `command/commands.ts` and `main.ts`
are unstarted. Phase 3 criterion (§6): *"you can create a polygon and a table by command, see both
drawn, pan/zoom, select, and drag the polygon."* `polygon …` and `table …` PARSE; no pixel has ever
come from a typed line. NOT claimed.

Last review point: **0069-REVIEW-phase3, ACCEPT WITH EDITS** (entry 0068). Cycles since last review:
**0/3** · diff since last review: **0 lines / 0 files** (cap 800/10). No gate is blocking; the next
slice may start immediately.

## Next slice (recommended)

**`command/commands.ts`** (§5.10: handlers → mutation API calls) — the first file that resolves
anything. **Read 0069-REVIEW §11 before starting; it owes five things.** The two that will bite:
**D-040/D-041 come due** (reconcile Q-001/Q-002, do not re-decide — `set` over a formula slot
REPLACES it and reports what it replaced; `unlink` keeps the value last displayed, errors included),
and **D-070 lands in the SAME cycle** (creation handlers bound `sides`/`rows`/`cols` before building
an `Operation`, or `table rows=1000000` allocates a million slots from one typed line). Also owed:
D-069 governs the file · the table-creation handler owes `TABLE_SCHEMA` an `origin.x`/`origin.y`
pair · §5.10's "name the specific slots involved" gets real slots for the first time.

Then `main.ts` — ONE clamped camera to all three of `renderDocument`, `hitTest` and
`pointerDown`/`pointerMove` (D-062), and reset the canvas transform before screen-space chrome.

## Built and reviewed

Phase 0 (0027-REVIEW) · formula engine (0037) · the whole table primitive through row/column
insert/delete and `delete <table> force` (0054) · `render/camera.ts` + entry 0055's header audit
(0058) · `primitives/geometry.ts` (0060) · `render/renderer.ts` (0062) · `render/hittest.ts` (0064) ·
entry 0065's header audit · `render/interaction.ts` (0067) · **`src/command/parser.ts` (811) +
`parser.test.ts` (296, 61 tests) — §5.10's parsing half, sixteen commands (0069)**.

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
- **An arity error names a parameter its own usage line never shows** — `"link" needs <source> —
  usage: link <address> <address>` (0069-REVIEW F3). One pass over sixteen `usage` strings.
- **Row/column deletion CAN still be REJECTED**, contradicting §5.4 — repair unbounded, slot walk
  extent-bounded; reachable only via a raw `setSlot`, pinned by `mutation.test.ts`'s "KNOWN
  INCOHERENCE" test, and D-053 forbids a one-sided fix. Relatedly a dimension write is not checked
  for COHERENCE with the cells that exist.
- **The §5.2 header budget (20-40 ordinary) is not reachable** — `command/parser.ts` arrived at 65;
  ten others are over (`mutation.ts` 151 against 80, `table.ts` 101, `parser.ts` 97, `document.ts`
  94, `interaction.ts` 76…). Entry 0065 and 0069-REVIEW §7 both recommend **~60-70 for a
  first-of-subsystem file; the amendment is the human's.** `parser.ts`'s header may separately drop
  ~10 lines by citing D-069 instead of restating it (0069-REVIEW fix 1).
- **Three carried render gaps, all deliberate:** one `mutate` per pointer move, each deep-cloning the
  document (§5.9's perf note — any fix MUST throttle, never write outside `mutation.ts`) · cell text
  is not clipped to its cell (§5.4 silent, Rule 5) · `readNumber`/`asPointArray` still have two
  consumers, and move to `render/slots.ts` at the THIRD (0064-REVIEW §5).
- **Comment debt in test files** (non-test source is D-060-clean): 13 bare "this cycle" sites and two
  stale "`graph/eval.ts` does not exist yet" claims in `schema.test.ts` (0058-REVIEW F2) — owned by
  whoever next touches those files. Plus ~20 "see the file header" pointers, of which only those
  deferring a function's OWN contract upward are defects (0065 F2).
- **An end-to-end test through a table-creation command** is still owed by `renderer`, `hittest` and
  `interaction`, which pin their table paths against FIXTURES only. Needs the handler.
- **Carried unchanged, each with its pointer:** mixed line endings in the WORKING TREE only
  (`core.autocrlf=true`; a `.gitattributes` is a §6.1 trigger-6 escalation) · dangling-reference
  messages name the DEPENDENT, not the missing SOURCE (0045-REVIEW F4) · D-022's bounded-correctness
  claim fails for `table` (0043-REVIEW §7 Q1) · `describeValueType` duplicated in
  `functions.ts`/`eval.ts` (0037-REVIEW F4) · `rewrite`/`repairObjectFormulaAddresses` walk `formula`
  slots only, owed text boxes at Phase 5 · journal structure unvalidated beyond `Array.isArray` ·
  `lexer.ts`'s two edge cases · §5.11's `style` field · `nextObjectId` reconciliation ·
  `noUnusedLocals` off · recursion depth.

## Settled — do not re-raise

Every ruling in `DECISIONS.md` (D-001 through **D-070**) binds without restatement here. Newest:
**D-069** `command/parser.ts` resolves NOTHING and takes no document — grammar failures are the
parser's, identity failures the handler's, and `commands.ts` is the only place a `Command` meets a
`Document` · **D-070** a creation command's `sides`/`rows`/`cols` are bounded by the HANDLER, and
out of range REJECTS the mutation rather than producing an `ErrorValue` — bounds are provisional
(`sides` 3–1000, `rows`/`cols` 1–1000) and the human may overrule the numbers, not the structure.

## Live PROVISIONAL tags and open questions

**`PROVISIONAL(Q-013)` → `src/command/parser.ts`** (`matchArguments`'s formula guard). How is a
general formula (`= polygon_b.origin.x * 2`) authored, when §5.10 has no command that takes one?
**ESCALATED TO THE HUMAN at 0069-REVIEW — awaiting a ruling, tag stays live; full text and the
reviewer's endorsement of (a) `set <address> = <formula source>` are in `OPEN_QUESTIONS.md`.** Three
constraints bind either way: the source is the RAW SUBSTRING from `=` to end-of-line, never
re-joined tokens (D-038 clause 4) · the parser stays document-free (D-069) · `link` and a
formula-writing `set` share ONE path. **Phase 4(b) cannot be authored until this is answered.**

**`PROVISIONAL(Q-012)` → `src/render/renderer.ts`** (`DEFAULT_SHAPE_STROKE_WIDTH`, the
`TABLE_CELL_*` constants): world units or screen pixels? Provisional (a) world units. Due with the
`style`-slots cycle — and also blocking `pan`'s argument grammar.

Q-008 stays OPEN, deferred, blocking nothing. **Q-001/Q-002 are ANSWERED (D-041, D-040) and come due
at `command/commands.ts`** — reconcile, do not re-decide. Next free: **Q-014**.

## Gotchas for the next model

- **`command/parser.ts` resolves NOTHING and takes no document — this is D-069 now, not a preference.**
  Do not add an `objects` parameter. `set polygon_1 42` (no dot) and `rename polygon_1 3bad` both
  PARSE by design, following `address.ts`'s L-4 precedent; re-checking the address form in `command/`
  would be a second definition of it (D-043).
- **`command/parser.ts` does NOT call `parseFormula`. 0067-REVIEW §10 item 4 said it would; that
  carry-in was WRONG and is withdrawn** (0069-REVIEW §5). D-038's four conditions come due wherever
  `parseFormula` IS first called — `commands.ts` if Q-013 lands as (a), else the formula-bar cycle.
- **Quoting decides TYPE on the command line**: `set v.x 42` is the number, `"42"` the string, and a
  quoted token is refused where a number is declared. **A quoted argument ends at its closing quote**
  — `a"b` and `"a"b` are both rejected (0069-REVIEW F1 fixed the second; it used to parse
  `delete "a"force` as `force: true` silently). **Positionals fill BEFORE flags**, so `delete force`
  deletes the object *named* `force`. **`COMMAND_NAMES` and `COMMANDS_SPECIFIED_BUT_NOT_BUILT` must
  stay disjoint**; a test pins it.
- **A non-finite or `-0` number typed into `set` reaches the command object unchanged** — D-031
  clause 3: a text-scanning stage does not enforce document-state policy, `mutate` refuses it
  (D-025). Do not add a guard in `command/`. **D-070 is the one exception and it is the HANDLER's,
  not the parser's.**
- **`render/interaction.ts` draws NOTHING and touches no canvas — D-068 binds it.** The trio goes in
  ONE cycle, in the renderer. **`main.ts` must reset the canvas transform** before screen-space
  chrome. **A rejected drag step does not advance `lastWorldPoint`**, and a drag holds the object's
  `id`, never the `GraphObject`.
- **A comment saying another file does not exist — or OWNS something — is YOURS once you falsify it
  (D-065).** Entry 0068 swept for this and still missed one in a file it was already editing
  (0069-REVIEW F2): grep the whole file, not just the line you came for. And **`createObject`
  requires ALL derived-slot placeholders** — nine for a preset (D-018); **an object with a slot shape
  its schema FORBIDS cannot go through `mutate` at all**.
- **Three different reasons to read a slot, and they do NOT unify** (0062-REVIEW §2, 0067-REVIEW
  §11): to DRAW/HIT-TEST (`readNumber`, kind-blind), to SIZE the slot set (`readTableDimension`,
  `literal`-only), to decide whether it may be WRITTEN (`interaction.ts`, kind-aware).
- **Cite the ruling you actually mean.** Entry 0068 attributed "declare vocabulary once" to D-010,
  which is about `slotKey()` (0069-REVIEW F4). A wrong `(D-0XX)` sends the next reader to the wrong
  argument. Also standing: D-064 (presets wind counterclockwise) · D-005 (a slot's stored key is the
  PATH joined with `.`) · D-066 (a degenerate extent needs its OWN guard) · D-061 (`camera.x`/`.y` is
  the world point at the screen's TOP-LEFT corner). House style: close every discriminated-union
  `switch` with `const exhaustive: never = x; void exhaustive;`, and **`render/` and `command/` are
  not `engine/`** — `command/` is outside `tsconfig.engine.json`, so run BOTH configs anyway.
- **When a suite passes on its first run, mutation-check it.** Entry 0068 neutralised six
  load-bearing lines; 0069-REVIEW neutralised its own new guard. Every mutant was caught by a NAMED
  test — the only evidence a green suite discriminates (D-016's own lesson).
