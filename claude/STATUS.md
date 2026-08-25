# STATUS — as of entry 0071-REVIEW-phase3

STATE: GREEN (compiles under both configs, 874/874 tests pass, 0 skipped, 0 `.only`).

**Process state: entry 0070 has been REVIEWED — verdict REVISE (0071-REVIEW). Nothing is broken; the
fix list is five items and item 1 is due before or beside `command/commands.ts`. The next cycle goes
back to an IMPLEMENTER (0070 was written by the reviewer on human direction).**

Current phase: **3 — canvas, camera, geometry, command line.** `render/` is complete and reviewed.
`command/` parses a line AND drives AutoCAD-style prompt sequences, both now reviewed; **nothing
executes a command.** Phase 3 criterion (§6): *"you can create a polygon and a table by command, see
both drawn, pan/zoom, select, and drag the polygon."* Both can be composed by pointing; no pixel has
ever come from one. NOT claimed.

Last review point: **0071-REVIEW-phase3, REVISE** (reviewing entry 0070). Cycles since last review:
**0/3** · diff since last review: 0 lines / 0 files (cap 800/10).

## Next slice (recommended)

**`command/commands.ts`** (§5.10: handlers → mutation API calls), carrying fix-list item 1. It owes:

1. **Fix 1 (D-073)** — stop the command lexer at a formula's `=`. This is the cycle that first hands
   `source` to `parseFormula`, so it must land first or beside the rest.
2. **D-040/D-041** — reconcile Q-001/Q-002, do not re-decide. `set` over a formula slot REPLACES it
   and reports what it replaced; `unlink` keeps the value last displayed, errors included.
3. **D-070** — bound `sides`/`rows`/`cols` before building an `Operation`, or `table rows=1000000`
   allocates a million slots. Both `command/` files pass counts through by design; this is the guard.
4. **D-071 clause 4** — `link` and a formula-writing `set` share ONE slot-writing path. This is
   where `parseFormula` is first called, so **D-038's four conditions come due here.**
5. **D-069** — it is the ONLY place a `Command` meets a `Document`.
6. The table-creation handler owes `TABLE_SCHEMA` an `origin.x`/`origin.y` pair, at the paths
   `renderer`/`hittest`/`interaction` already read.

Then `main.ts` — ONE clamped camera to all three of `renderDocument`, `hitTest` and
`pointerDown`/`pointerMove` (D-062); reset the canvas transform before screen-space chrome; and
**wire `prompt.ts`: a canvas click during a live sequence is a `picked` response, not a selection**,
with screen→world done by `camera.ts` before it reaches `command/`.

## Built and reviewed

Phase 0 (0027-REVIEW) · formula engine (0037) · the whole table primitive through row/column
insert/delete and `delete <table> force` (0054) · `render/camera.ts` + entry 0055's header audit
(0058) · `primitives/geometry.ts` (0060) · `render/renderer.ts` (0062) · `render/hittest.ts` (0064) ·
entry 0065's header audit · `render/interaction.ts` (0067) · `command/parser.ts` (0069) ·
**`command/prompt.ts` + D-071's formula path (0071, verdict REVISE — see the fix list)**.

## Open fix list — detail in 0071-REVIEW §10; none blocking, item 1 due next cycle

1. **Stop the command lexer at a formula's `=` (F1, D-073).** `parseCommand` tokenizes the whole line
   before it learns there is a formula in it, so command quoting rules run over formula text. Only
   QUOTES are affected: `set a.b = CONCAT("a", "b")` is REJECTED while `= CONCAT( "a" , "b" )` and
   `= ((( not a formula` both pass.
2. **The prompt path's overflow message blames a token it accepted (F2)** — `circle 100,100 20 extra`
   names `100,100` at offset 7; the offender is `extra` at 18.
3. **`readResponse`'s refusal channel is a bare `string` (F3)** — a future `text` accept kind turns
   every accepted answer into an infinite re-prompt. Discriminated return, no behaviour change.
4. **A quoted prompt answer is silently accepted (F4)** — `circle "100,100" "20"` completes.
5. Carried: `usage` strings vs arity-error parameter names (0069-REVIEW F3) · `parser.ts`'s header
   citing D-069 instead of restating it (0069-REVIEW fix 1).

## Not started

`command/commands.ts`, `main.ts` wiring, §5.9's visual-feedback trio (**D-068**), §5.9's per-vertex
drag path, `polyline`/`explode`/`addvertex`/`delvertex`, `style` slots, a table's own
`origin.x`/`origin.y` schema entry, point-in-polygon fill hit-testing (D-067), §5.4's formula bar /
in-place cell editing · Phases 4–7. **Phase 4(b)'s shape already works and is unclaimed**
(0067-REVIEW probe P1) — the gate needs all three clauses in one document plus pixels, and **its
authoring path now exists (D-071), subject to fix 1**.

## Known problems (detail lives where the pointer says)

- **Eight §5.10 commands have no registry entry** — `polyline`/`text`/`script`/`image`/`explode`/
  `addvertex`/`delvertex` wait on a schema or an `Operation` kind; **`pan` waits on Q-012**. All
  eight report "not built", not "unknown command" (`COMMANDS_SPECIFIED_BUT_NOT_BUILT`).
- **`usesNamedForm` in `prompt.ts` changes no behaviour today** — mutation-confirmed twice.
  **RULED: keep it** (0071-REVIEW §5) — fix 1 moves when tokenization happens and would silently
  break the accident that currently serves §5.10's documented form.
- **Prompt order, wording and the `<8>` default form are a reading of AutoCAD, not the brief's.**
  Cheap to change; the human should say if any reads wrong in use. **No repeat-last-command
  gesture** (AutoCAD's Enter); it needs the input bar.
- **Row/column deletion CAN still be REJECTED**, contradicting §5.4 — repair unbounded, slot walk
  extent-bounded; reachable only via a raw `setSlot`, pinned by `mutation.test.ts`'s "KNOWN
  INCOHERENCE" test, and D-053 forbids a one-sided fix.
- **The §5.2 header budget (20-40 ordinary) is not reachable** — `parser.ts` **69**, `prompt.ts` 52,
  and ten others over. Entries 0065, 0069-REVIEW §7, 0070 and 0071-REVIEW §7 all recommend **~60-70
  for a first-of-subsystem file; the amendment is the human's.**
- **Three carried render gaps, all deliberate:** one `mutate` per pointer move, each deep-cloning the
  document (§5.9's perf note — any fix MUST throttle, never write outside `mutation.ts`) · cell text
  is not clipped to its cell (§5.4 silent, Rule 5) · `readNumber`/`asPointArray` still have two
  consumers, and move to `render/slots.ts` at the THIRD (0064-REVIEW §5).
- **An end-to-end test through a table-creation command** is still owed by `renderer`, `hittest` and
  `interaction`, which pin their table paths against FIXTURES only. Needs the handler.
- **Carried unchanged, each with its pointer:** a loaded camera is not range-checked (D-062,
  0062-REVIEW §9) · `set-formula` is a `kind` that is not a registry name, so the "every command has
  an example" test does not reach it (0070 "stuck" #6) · comment debt in TEST files only — 13 bare
  "this cycle" sites and two stale claims in `schema.test.ts` (0058-REVIEW F2) · mixed line endings
  in the WORKING TREE only (`core.autocrlf=true`; a `.gitattributes` is a §6.1 trigger-6 escalation)
  · dangling-reference messages name the DEPENDENT, not the missing SOURCE (0045-REVIEW F4) ·
  D-022's bounded-correctness claim fails for `table` (0043-REVIEW §7 Q1) · `describeValueType`
  duplicated in `functions.ts`/`eval.ts` (0037-REVIEW F4) · `rewrite`/`repairObjectFormulaAddresses`
  walk `formula` slots only, owed text boxes at Phase 5 · journal structure unvalidated beyond
  `Array.isArray` · `lexer.ts`'s two edge cases · §5.11's `style` field · `nextObjectId`
  reconciliation · `noUnusedLocals` off · recursion depth.

## Settled — do not re-raise

Every ruling in `DECISIONS.md` (D-001 through **D-073**) binds without restatement here. Newest:
**D-069** `command/parser.ts` resolves NOTHING · **D-070** creation counts are bounded by the
HANDLER and out of range REJECTS (provisional: `sides` 3–1000, `rows`/`cols` 1–1000) · **D-071** a
formula is authored with `set <address> = <formula source>`, captured as a RAW SUBSTRING · **D-072**
a command word alone enters an AutoCAD-style prompt sequence; both forms produce the identical
`Command` · **D-073** a formula's source is NEVER subject to command-line tokenization — the lexer
stops at the `=`, and arity is the only formula rejection the command layer may make.

## Live PROVISIONAL tags and open questions

**`PROVISIONAL(Q-012)` → `src/render/renderer.ts`** (`DEFAULT_SHAPE_STROKE_WIDTH`, the
`TABLE_CELL_*` constants): world units or screen pixels? Provisional (a) world units. Due with the
`style`-slots cycle — and also blocking `pan`'s argument grammar.
**`PROVISIONAL(Q-008)` → `src/engine/graph/node.ts`** (`-0`): open, deferred, blocking nothing.
**Q-013 is ANSWERED (D-071)** and reconciled — no tag remains. **Q-001/Q-002 are ANSWERED (D-041,
D-040) and come due at `command/commands.ts`** — reconcile, do not re-decide. Next free: **Q-014**.

## Gotchas for the next model

- **A command word alone is not an error any more (D-072).** `beginCommand` in `command/prompt.ts`
  is the entry point for a typed line, not `parseCommand`; `main.ts` calls it. **A pick reaches
  `command/` as a WORLD point, already converted** by `camera.ts` — do not import `render/` into
  `command/`. **A live prompt sequence changes what a canvas click MEANS** (a `picked` response, not
  a selection); `main.ts` owns that switch.
- **`command/parser.ts` resolves NOTHING and takes no document — D-069.** `set polygon_1 42` (no
  dot) and `rename polygon_1 3bad` both PARSE by design.
- **Quoting decides TYPE**, and **a quoted argument ends at its closing quote** — `a"b` and `"a"b`
  both rejected (0069-REVIEW F1). **Two exceptions, both on the fix list:** a formula's source is
  still quote-checked (F1/D-073), and a quoted PROMPT answer is accepted (F4). **Positionals fill
  BEFORE flags**, so `delete force` deletes the object *named* `force`. **`COMMAND_NAMES` and
  `COMMANDS_SPECIFIED_BUT_NOT_BUILT` must stay disjoint**; a test pins it.
- **A non-finite or `-0` number, and a fractional or negative count, all reach the command object
  unchanged** — D-031 clause 3. **D-070 is the one exception and it is the HANDLER's.**
- **`render/interaction.ts` draws NOTHING — D-068.** **`main.ts` must reset the canvas transform**
  before screen-space chrome. **A rejected drag step does not advance `lastWorldPoint`**, and a drag
  holds the object's `id`, never the `GraphObject`.
- **A comment saying another file does not exist — or OWNS something — is YOURS once you falsify it
  (D-065).** Grep the whole file, not just the line you came for.
- **Three different reasons to read a slot, and they do NOT unify** (0062-, 0067-REVIEW): to
  DRAW/HIT-TEST (`readNumber`, kind-blind), to SIZE the slot set (`readTableDimension`,
  `literal`-only), to decide whether it may be WRITTEN (`interaction.ts`, kind-aware).
- **Cite the ruling you actually mean.** Standing: D-064 (presets wind counterclockwise) · D-005 (a
  slot's stored key is the PATH joined with `.`) · D-066 (a degenerate extent needs its OWN guard) ·
  D-061 (`camera.x`/`.y` is the world point at the screen's TOP-LEFT corner). House style: close
  every union `switch` with `const exhaustive: never = x; void exhaustive;`, and **`render/` and
  `command/` are not `engine/`** — run BOTH tsconfigs anyway.
- **Mutation-check a suite that passes first try — and check the checker.** Entry 0070's first run
  reported all seven mutants surviving; the detector was grepping past vitest's ANSI codes. Strip
  ANSI (`sed 's/\x1b\[[0-9;]*m//g'`) and assert on the `Tests  N failed` line. A checker that
  silently always passes certifies whatever you point it at (D-016's lesson, one layer up).
