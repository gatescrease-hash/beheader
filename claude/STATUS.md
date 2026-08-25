# STATUS — as of entry 0074-REVIEW-phase3

STATE: GREEN and **UNBLOCKED**. Both configs compile, 883/883 tests pass, 0 skipped, 0 `.only`. The
review entries 0072–0073 were waiting for has landed: **0074-REVIEW-phase3, ACCEPT WITH EDITS.**
Nothing on its fix list blocks `command/commands.ts`. No unreviewed source in the tree.

Current phase: **3 — canvas, camera, geometry, command line.** `render/` is complete and reviewed.
`command/` parses a line, drives AutoCAD-style prompt sequences, and carries a formula's source
untouched (D-073, discharged); **nothing executes a command.** Phase 3 criterion (§6): *"you can
create a polygon and a table by command, see both drawn, pan/zoom, select, and drag the polygon."*
Both can be composed by pointing; no pixel has ever come from one. NOT claimed.

Last review point: **0074-REVIEW-phase3, ACCEPT WITH EDITS** (reviewing entries 0072–0073).
Cycles since last review: **0/3** · diff since last review: **0 lines / 0 files** (cap 800/10).

## Next slice — `command/commands.ts` (§5.10: handlers → mutation API calls)

Its debts, unchanged across three reviews:

1. **D-040/D-041** — reconcile Q-001/Q-002, do not re-decide. `set` over a formula slot REPLACES it
   and reports what it replaced; `unlink` keeps the value last displayed, errors included.
2. **D-070** — bound `sides`/`rows`/`cols` before building an `Operation`, or `table rows=1000000`
   allocates a million slots. Both `command/` files pass counts through by design; this is the guard.
3. **D-071 clause 4** — `link` and a formula-writing `set` share ONE slot-writing path. First call
   to `parseFormula`, so **D-038's four conditions come due here.**
4. **D-069** — the ONLY place a `Command` meets a `Document`.
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
entry 0065's header audit · `render/interaction.ts` (0067) · `command/parser.ts` (0069) ·
`command/prompt.ts` + D-071's formula path (0071) · entries 0072–0073's fix-list work (0074).

## Open fix list — 0074-REVIEW §9, six items, none blocking

1. **Report a refused prompt answer with the sequence's OWN message (D-074).** `beginCommand`'s "a
   token the sequence could not read" branch returns `session.error` at the offending token's offset
   instead of `fromParse(line)`; the quoted-answer branch likewise. `usesNamedForm` and the two
   pre-sequence deferrals stay. Payoff: `usesNamedForm` becomes load-bearing and entry 0070's
   survived mutant becomes a caught one.
2. **A prompting command needs a usage line for the form it was used in.** Fold into the carried
   0069-REVIEW F3 sweep over all sixteen `usage` strings — one pass, not two.
3. **Decide what a quoted command WORD means**, and correct entry 0072's "only site discarding the
   `quoted` bit" claim in the next entry — `"list"` and `"SET" a.b 1` both parse today.
4. **Disclose 0074-REVIEW F4's two message changes** and add a test for (a).
5. **Fix `set = x`'s message** — it currently says `"set" takes no formula`.
6. **Carried:** `parser.ts`'s header citing D-069 and dropping the ~10 lines that restate it
   (0069-REVIEW fix 1) · an end-to-end test through a table-creation command · the twelve bare "this
   cycle" sites and two stale claims in test files · `render/slots.ts` at the THIRD consumer of
   `readNumber`/`asPointArray` · `.gitattributes`.

## Not started

`command/commands.ts`, `main.ts` wiring, §5.9's visual-feedback trio (**D-068**), §5.9's per-vertex
drag path, `polyline`/`explode`/`addvertex`/`delvertex`, `style` slots, a table's own
`origin.x`/`origin.y` schema entry, point-in-polygon fill hit-testing (D-067), §5.4's formula bar /
in-place cell editing · Phases 4–7. **Phase 4(b)'s shape already works and is unclaimed**
(0067-REVIEW probe P1) — the gate needs all three clauses in one document plus pixels; its authoring
path (D-071/D-073) is complete and reviewed.

## Known problems (detail lives where the pointer says)

- **Eight §5.10 commands have no registry entry** — `polyline`/`text`/`script`/`image`/`explode`/
  `addvertex`/`delvertex` wait on a schema or an `Operation` kind; **`pan` waits on Q-012**. All
  eight report "not built", not "unknown command" (`COMMANDS_SPECIFIED_BUT_NOT_BUILT`).
- **A refused prompt answer is reported by the wrong grammar** — `circle 100,100 abc` blames
  `100,100`. Ruled **D-074**, fix-list item 1; no test pins the current behaviour.
- **`usesNamedForm` in `prompt.ts` changes no behaviour today** — mutation-confirmed three times.
  **RULED: keep it** (0071-REVIEW §5). Fix-list item 1 makes it load-bearing and closes this.
- **Prompt order, wording and the `<8>` default form are a reading of AutoCAD, not the brief's.**
  Cheap to change; the human should say if any reads wrong in use. **No repeat-last-command
  gesture** (AutoCAD's Enter); it needs the input bar.
- **Row/column deletion CAN still be REJECTED**, contradicting §5.4 — repair unbounded, slot walk
  extent-bounded; reachable only via a raw `setSlot`, pinned by `mutation.test.ts`'s "KNOWN
  INCOHERENCE" test, and D-053 forbids a one-sided fix.
- **The §5.2 header budget (20-40 ordinary) is not reachable anywhere** — counted whole-tree at
  0074-REVIEW: **21 of 23 non-test source files are over 40**, six over the 80-line load-bearing
  allowance, `mutation.ts` at **151**; `parser.ts` **76**, `prompt.ts` **62**. Four reviews now
  recommend amending §5.2 to 20–40 ordinary / ~80 first-of-subsystem / ~150 load-bearing.
  **The amendment is the human's.**
- **Three carried render gaps, all deliberate:** one `mutate` per pointer move, each deep-cloning the
  document (§5.9's perf note — any fix MUST throttle, never write outside `mutation.ts`) · cell text
  is not clipped to its cell (§5.4 silent, Rule 5) · `readNumber`/`asPointArray` still have two
  consumers, and move to `render/slots.ts` at the THIRD (0064-REVIEW §5).
- **An end-to-end test through a table-creation command** is still owed by `renderer`, `hittest` and
  `interaction`, which pin their table paths against FIXTURES only. Needs the handler.
- **Carried unchanged, each with its pointer:** a loaded camera is not range-checked (D-062,
  0062-REVIEW §9) · `set-formula` is a `kind` that is not a registry name, so the "every command has
  an example" test does not reach it (0070 "stuck" #6) · comment debt in TEST files only — 12 bare
  "this cycle" sites and two stale claims in `schema.test.ts` (0058-REVIEW F2) · mixed line endings
  in the WORKING TREE only (`core.autocrlf=true`; a `.gitattributes` is a §6.1 trigger-6 escalation)
  · dangling-reference messages name the DEPENDENT, not the missing SOURCE (0045-REVIEW F4) ·
  D-022's bounded-correctness claim fails for `table` (0043-REVIEW §7 Q1) · `describeValueType`
  duplicated in `functions.ts`/`eval.ts` (0037-REVIEW F4) · `rewrite`/`repairObjectFormulaAddresses`
  walk `formula` slots only, owed text boxes at Phase 5 · journal structure unvalidated beyond
  `Array.isArray` · `lexer.ts`'s two edge cases · §5.11's `style` field · `nextObjectId`
  reconciliation · `noUnusedLocals` off · recursion depth.

## Settled — do not re-raise

Every ruling in `DECISIONS.md` (D-001 through **D-074**) binds without restatement here. Newest:
**D-069** `parser.ts` resolves NOTHING · **D-070** creation counts are bounded by the HANDLER and out
of range REJECTS (provisional: `sides` 3–1000, `rows`/`cols` 1–1000) · **D-071** a formula is authored
with `set <address> = <formula source>`, captured as a RAW SUBSTRING · **D-072** a command word alone
enters an AutoCAD-style prompt sequence; both forms produce the identical `Command` · **D-073** a
formula's source is NEVER subject to command-line tokenization — **implemented and discharged at
entry 0072** · **D-074** once a prompt sequence has begun reading a line, its own refusal IS the
message; deferral to `parseCommand` is only for a line the sequence never began to read.

## Live PROVISIONAL tags and open questions

**`PROVISIONAL(Q-012)` → `src/render/renderer.ts`** (`DEFAULT_SHAPE_STROKE_WIDTH`, the
`TABLE_CELL_*` constants): world units or screen pixels? Provisional (a) world units. Due with the
`style`-slots cycle — and also blocking `pan`'s argument grammar.
**`PROVISIONAL(Q-008)` → `src/engine/graph/node.ts`** (`-0`): open, deferred, blocking nothing.
**Q-001/Q-002 are ANSWERED (D-041, D-040) and come due at `command/commands.ts`** — reconcile, do
not re-decide. Next free: **Q-014**.

## Gotchas for the next model

- **A command word alone is not an error any more (D-072).** `beginCommand` in `command/prompt.ts`
  is the entry point for a typed line, not `parseCommand`; `main.ts` calls it. **A pick reaches
  `command/` as a WORLD point, already converted** by `camera.ts` — do not import `render/` into
  `command/`. **A live prompt sequence changes what a canvas click MEANS**; `main.ts` owns that switch.
- **`command/parser.ts` resolves NOTHING and takes no document — D-069.** `set polygon_1 42` (no
  dot) and `rename polygon_1 3bad` both PARSE by design.
- **A formula's source is opaque to `command/` past its `=` — D-073.** The lexer reads ONE TOKEN AT
  A TIME (`nextToken`); the moment the `literal-or-formula` position's character is an unquoted `=`,
  the rest of the line is sliced verbatim and never tokenized. `CONCAT("a", "b")` parses. Only
  formula ARITY (nothing after the `=`) is rejected at this layer.
- **No prompting command may declare a `literal-or-formula` position** — that is what lets
  `beginCommand` tokenize the rest of its line at all; a test in `prompt.test.ts` pins it (0074-REVIEW).
- **A quoted prompt answer is refused, not silently reinterpreted**, and **`readResponse` returns a
  discriminated `ResponseRead`, not a bare `string`** — widening `PromptValue` to include `string` is
  a compile error now, not an infinite re-prompt.
- **Quoting decides TYPE** — except the command WORD, read with its `quoted` bit dropped (fix-list
  item 3). **A quoted argument ends at its closing quote**; `a"b` and `"a"b` both rejected.
  **Positionals fill BEFORE flags**, so `delete force` deletes the object *named* `force`.
  **`COMMAND_NAMES` and `COMMANDS_SPECIFIED_BUT_NOT_BUILT` must stay disjoint**; a test pins it.
- **A non-finite or `-0` number, and a fractional or negative count, all reach the command object
  unchanged** — D-031 clause 3. **D-070 is the one exception and it is the HANDLER's.**
- **`render/interaction.ts` draws NOTHING — D-068.** **`main.ts` must reset the canvas transform**
  before screen-space chrome. **A rejected drag step does not advance `lastWorldPoint`**, and a drag
  holds the object's `id`, never the `GraphObject`.
- **A comment saying another file does not exist — or OWNS something — is YOURS once you falsify it
  (D-065)**, a comment describing a now-fixed HAZARD included. Grep the whole file, not just the line
  you came for.
- **Three different reasons to read a slot, and they do NOT unify** (0062-, 0067-REVIEW): to
  DRAW/HIT-TEST (`readNumber`, kind-blind), to SIZE the slot set (`readTableDimension`,
  `literal`-only), to decide whether it may be WRITTEN (`interaction.ts`, kind-aware).
- **Cite the ruling you actually mean.** Standing: D-064 (presets wind counterclockwise) · D-005 (a
  slot's stored key is the PATH joined with `.`) · D-066 (a degenerate extent needs its OWN guard) ·
  D-061 (`camera.x`/`.y` is the world point at the screen's TOP-LEFT corner). House style: close
  every union `switch` with `const exhaustive: never = x; void exhaustive;`, and **`render/` and
  `command/` are not `engine/`** — run BOTH tsconfigs anyway.
- **Mutation-check a suite that passes first try — and check the checker.** Strip ANSI
  (`sed 's/\x1b\[[0-9;]*m//g'`) and assert on the `Tests  N failed` line. A checker that silently
  always passes certifies whatever you point it at (D-016's lesson, one layer up).
- **A review's fix list authorises a CHANGE, never an exemption from the trigger that change fires**
  (entry 0073). Apply §6.1 mechanically, not by feel.
