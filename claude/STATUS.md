# STATUS — as of entry 0070-prompt-sequences

STATE: GREEN (compiles under both configs, 874/874 tests pass, 0 skipped, 0 `.only`).

**Process state: `command/prompt.ts` and D-071's formula path are BUILT BUT NOT REVIEWED, and were
written by the REVIEWER on human direction (entry 0070's process note). §6.1 triggers 3 and 5 both
fired, the diff is ~962 lines against the ~800 cap, and no independent eye has seen this cycle.
Review before the next slice.**

Current phase: **3 — canvas, camera, geometry, command line.** `render/` is complete and reviewed.
`command/` now parses a line AND drives AutoCAD-style prompt sequences; **nothing executes a
command.** Phase 3 criterion (§6): *"you can create a polygon and a table by command, see both
drawn, pan/zoom, select, and drag the polygon."* Both can be composed by pointing; no pixel has ever
come from one. NOT claimed.

Last review point: **0069-REVIEW-phase3, ACCEPT WITH EDITS** (entry 0068). Cycles since last review:
**1/3** · diff since last review: **~962 lines / 5 files (cap 800/10 — over on lines)**.

## Next slice (recommended, AFTER 0070 is reviewed)

**`command/commands.ts`** (§5.10: handlers → mutation API calls) — the first file that resolves
anything, and now the only thing between a composed `Command` and a pixel. It owes:

1. **D-040/D-041** — reconcile Q-001/Q-002, do not re-decide. `set` over a formula slot REPLACES it
   and reports what it replaced; `unlink` keeps the value last displayed, errors included.
2. **D-070** — creation handlers bound `sides`/`rows`/`cols` before building an `Operation`, or
   `table rows=1000000` allocates a million slots. `prompt.ts` passes counts through untouched, by
   design, so this is the only guard.
3. **D-071 clause 4** — `link` and a formula-writing `set` share ONE slot-writing path.
   `SetFormulaCommand` carries raw source; this is where `parseFormula` is first called, so
   **D-038's four conditions come due here.**
4. **D-069** — it is the ONLY place a `Command` meets a `Document`.
5. The table-creation handler owes `TABLE_SCHEMA` an `origin.x`/`origin.y` pair, at the paths
   `renderer`/`hittest`/`interaction` already read.

Then `main.ts` — ONE clamped camera to all three of `renderDocument`, `hitTest` and
`pointerDown`/`pointerMove` (D-062); reset the canvas transform before screen-space chrome; and
**wire `prompt.ts`: a canvas click during a live sequence is a `picked` response, not a selection**,
with screen→world done by `camera.ts` before it reaches `command/`.

## Built and reviewed

Phase 0 (0027-REVIEW) · formula engine (0037) · the whole table primitive through row/column
insert/delete and `delete <table> force` (0054) · `render/camera.ts` + entry 0055's header audit
(0058) · `primitives/geometry.ts` (0060) · `render/renderer.ts` (0062) · `render/hittest.ts` (0064) ·
entry 0065's header audit · `render/interaction.ts` (0067) · `command/parser.ts` (0069).

## Built this batch, NOT yet reviewed

- **`src/command/prompt.ts` (332) + `prompt.test.ts` (250, 32 tests)** — D-072's state machine.
  `beginCommand` / `respond` / `cancelCommand`, pure, no document and no canvas. Four creation
  commands have sequences (`circle`, `polygon`, `rect`, `table`); a pick arrives as a WORLD point.
- **`src/command/parser.ts` (+265/-39)** — D-071's `set … = <source>` (raw substring, `set-formula`
  arm) and D-072's `prompts`/`buildFromPrompts` registry fields, plus `findCommandSpec`,
  `parseCommandNumber`, `tokenizeCommandLine` exported so `prompt.ts` keeps no second copy.
- **`parser.test.ts` (+59/-19)** — the Q-013 block inverted per D-071, two expectations reconciled.

## Not started

`command/commands.ts`, `main.ts` wiring, §5.9's visual-feedback trio (**D-068**), §5.9's per-vertex
drag path, `polyline`/`explode`/`addvertex`/`delvertex`, `style` slots, a table's own
`origin.x`/`origin.y` schema entry, point-in-polygon fill hit-testing (D-067), §5.4's formula bar /
in-place cell editing · Phases 4–7. **Phase 4(b)'s shape already works and is unclaimed**
(0067-REVIEW probe P1) — the gate needs all three clauses in one document plus pixels, and **its
authoring path now exists (D-071)**.

## Known problems (detail lives where the pointer says)

- **Eight §5.10 commands have no registry entry** — `polyline`/`text`/`script`/`image`/`explode`/
  `addvertex`/`delvertex` wait on a schema or an `Operation` kind; **`pan` waits on Q-012**. All
  eight report "not built", not "unknown command" (`COMMANDS_SPECIFIED_BUT_NOT_BUILT`).
- **`usesNamedForm` in `prompt.ts` changes no behaviour today** — a mutation check at 0070 proved
  §5.10's `key=value` form is also served by the prompt path's error fallback. Kept deliberately with
  a hazard note; **a reviewer may delete it and the note together** (entry 0070 "stuck" #1).
- **Prompt order, wording and the `<8>` default form are the reviewer's reading of AutoCAD, not the
  brief's** — §5.10 specifies none of them. All cheap to change; the human should say if any reads
  wrong in use. **No repeat-last-command gesture** (AutoCAD's Enter); it needs the input bar.
- **A loaded camera is not range-checked (D-062)** — `main.ts` owes ONE clamped camera to all three
  of `renderDocument`, `hitTest`, `pointerDown`/`pointerMove` (0062-REVIEW §9).
- **An arity error names a parameter its own usage line never shows** — `"link" needs <source> —
  usage: link <address> <address>` (0069-REVIEW F3). One pass over sixteen `usage` strings.
- **`set-formula` is a `kind` that is not a registry name** — the "every registered command has an
  example" coverage test does not reach it (entry 0070 "stuck" #6). The union still typechecks
  exhaustively; only the test symmetry is weaker.
- **Row/column deletion CAN still be REJECTED**, contradicting §5.4 — repair unbounded, slot walk
  extent-bounded; reachable only via a raw `setSlot`, pinned by `mutation.test.ts`'s "KNOWN
  INCOHERENCE" test, and D-053 forbids a one-sided fix.
- **The §5.2 header budget (20-40 ordinary) is not reachable** — `parser.ts` 65, `prompt.ts` 52, and
  ten others over. Entries 0065, 0069-REVIEW §7 and 0070 all recommend **~60-70 for a
  first-of-subsystem file; the amendment is the human's.**
- **Three carried render gaps, all deliberate:** one `mutate` per pointer move, each deep-cloning the
  document (§5.9's perf note — any fix MUST throttle, never write outside `mutation.ts`) · cell text
  is not clipped to its cell (§5.4 silent, Rule 5) · `readNumber`/`asPointArray` still have two
  consumers, and move to `render/slots.ts` at the THIRD (0064-REVIEW §5).
- **Comment debt in test files** (non-test source is D-060-clean): 13 bare "this cycle" sites and two
  stale "`graph/eval.ts` does not exist yet" claims in `schema.test.ts` (0058-REVIEW F2).
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

Every ruling in `DECISIONS.md` (D-001 through **D-072**) binds without restatement here. Newest:
**D-069** `command/parser.ts` resolves NOTHING — grammar failures are the parser's, identity failures
the handler's · **D-070** creation counts are bounded by the HANDLER and out of range REJECTS
(bounds provisional: `sides` 3–1000, `rows`/`cols` 1–1000) · **D-071** a formula is authored with
`set <address> = <formula source>`, source captured as a RAW SUBSTRING · **D-072** a command word
alone enters an AutoCAD-style prompt sequence; every prompt takes a typed value or a picked world
point, a bad answer re-prompts without losing what was gathered, and both forms of a command produce
the identical `Command`.

## Live PROVISIONAL tags and open questions

**`PROVISIONAL(Q-012)` → `src/render/renderer.ts`** (`DEFAULT_SHAPE_STROKE_WIDTH`, the
`TABLE_CELL_*` constants): world units or screen pixels? Provisional (a) world units. Due with the
`style`-slots cycle — and also blocking `pan`'s argument grammar.

**Q-013 is ANSWERED (D-071)** and reconciled at 0070 — no tag remains. Q-008 stays OPEN, deferred,
blocking nothing. **Q-001/Q-002 are ANSWERED (D-041, D-040) and come due at `command/commands.ts`**
— reconcile, do not re-decide. Next free: **Q-014**.

## Gotchas for the next model

- **A command word alone is not an error any more (D-072).** `beginCommand` in `command/prompt.ts`
  is the entry point for a typed line, not `parseCommand` — the parser still answers only "is this
  complete line a command?", and `prompt.ts` routes to it. `main.ts` calls `beginCommand`.
- **A pick reaches `command/` as a WORLD point, already converted.** `camera.ts` does screen→world
  and `main.ts` calls it. Do not import `render/` into `command/` — that is what keeps the machine
  testable with no canvas fake, the property D-068 protects for `render/interaction.ts`.
- **A live prompt sequence changes what a canvas click MEANS.** During one, a click is a `picked`
  response; otherwise it is selection/drag (`render/interaction.ts`). `main.ts` owns that switch and
  nothing else can.
- **`command/parser.ts` resolves NOTHING and takes no document — D-069, not a preference.**
  `set polygon_1 42` (no dot) and `rename polygon_1 3bad` both PARSE by design.
- **Quoting decides TYPE**, and **a quoted argument ends at its closing quote** — `a"b` and `"a"b`
  are both rejected (0069-REVIEW F1). **Positionals fill BEFORE flags**, so `delete force` deletes
  the object *named* `force`. **`COMMAND_NAMES` and `COMMANDS_SPECIFIED_BUT_NOT_BUILT` must stay
  disjoint**; a test pins it.
- **A non-finite or `-0` number, and a fractional or negative count, all reach the command object
  unchanged** — D-031 clause 3: a text-scanning stage does not enforce document-state policy.
  **D-070 is the one exception and it is the HANDLER's, not `command/`'s.**
- **`render/interaction.ts` draws NOTHING and touches no canvas — D-068 binds it.** **`main.ts` must
  reset the canvas transform** before screen-space chrome. **A rejected drag step does not advance
  `lastWorldPoint`**, and a drag holds the object's `id`, never the `GraphObject`.
- **A comment saying another file does not exist — or OWNS something — is YOURS once you falsify it
  (D-065).** Entry 0068 swept for this and still missed one in a file it was already editing
  (0069-REVIEW F2): grep the whole file, not just the line you came for.
- **Three different reasons to read a slot, and they do NOT unify** (0062-REVIEW §2, 0067-REVIEW
  §11): to DRAW/HIT-TEST (`readNumber`, kind-blind), to SIZE the slot set (`readTableDimension`,
  `literal`-only), to decide whether it may be WRITTEN (`interaction.ts`, kind-aware).
- **Cite the ruling you actually mean.** Entry 0068 attributed "declare vocabulary once" to D-010,
  which is about `slotKey()` (0069-REVIEW F4). Also standing: D-064 (presets wind counterclockwise) ·
  D-005 (a slot's stored key is the PATH joined with `.`) · D-066 (a degenerate extent needs its OWN
  guard) · D-061 (`camera.x`/`.y` is the world point at the screen's TOP-LEFT corner). House style:
  close every discriminated-union `switch` with `const exhaustive: never = x; void exhaustive;`, and
  **`render/` and `command/` are not `engine/`** — run BOTH tsconfigs anyway.
- **Mutation-check a suite that passes first try — and check the checker.** Entry 0070's first
  mutation run reported all seven mutants surviving; the detector was grepping past vitest's ANSI
  codes and never matched a failure. A mutation check that silently always passes certifies whatever
  you point it at (D-016's lesson, one layer up).
